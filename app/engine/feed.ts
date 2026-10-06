// Поллер ленты CSFloat. Один ключ, один домашний IP — поэтому консервативно:
// фиксированный интервал, экспоненциальный backoff на 429, дедуп по id.
// Прокси-ротации здесь нет и не будет: на домашнем IP это прямой путь к бану ключа.

import { CsfloatListing } from './types';

const BASE_URL = 'https://csfloat.com/api/v1';
const SEEN_TTL_MS = 10 * 60 * 1000;
const MAX_BACKOFF_MS = 60_000;

export interface Quota {
  remaining: number;
  limit: number;
  resetUnix: number;
}

export interface FeedEvents {
  onListings: (listings: CsfloatListing[]) => void;
  onQuota?: (q: Quota) => void;
  onError?: (message: string, fatal: boolean) => void;
}

export interface FeedOptions {
  apiKey: string;
  intervalMs: number;
  limit: number;
  minPriceUsd?: number;
  maxPriceUsd?: number;
  marketHashName?: string;
}

export class ListingsFeed {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private seen = new Map<string, number>();
  private consecutive429 = 0;
  private consecutiveAuthFails = 0;
  private currentDelayMs: number;

  constructor(private opts: FeedOptions, private events: FeedEvents) {
    this.currentDelayMs = opts.intervalMs;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Текущая задержка — UI показывает её, когда CSFloat нас притормаживает. */
  get delayMs(): number {
    return this.currentDelayMs;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.currentDelayMs = this.opts.intervalMs;
    void this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Новые параметры запроса «на лету». Цена, акцентный предмет и размер страницы
   * уходят на сервер прямо в запросе — без этого правка настроек у работающего
   * мониторинга действовала бы только после перезапуска, а лоты за пределами
   * старого диапазона так и не приходили бы.
   */
  updateOptions(patch: Partial<FeedOptions>): void {
    const intervalChanged = patch.intervalMs !== undefined && patch.intervalMs !== this.opts.intervalMs;
    this.opts = { ...this.opts, ...patch };
    // Идёт backoff — не сбиваем его новым интервалом, он сам вернётся к норме.
    if (intervalChanged && this.consecutive429 === 0) this.currentDelayMs = this.opts.intervalMs;
  }

  private schedule(): void {
    if (!this.running) return;
    // Джиттер, чтобы запросы не выстраивались в идеальную сетку.
    const jitter = Math.floor(Math.random() * 500);
    this.timer = setTimeout(() => void this.tick(), this.currentDelayMs + jitter);
  }

  private buildUrl(): string {
    const p = new URLSearchParams();
    p.append('type', 'buy_now');
    p.append('sort_by', 'most_recent');
    p.append('limit', String(this.opts.limit));
    if (this.opts.marketHashName) p.append('market_hash_name', this.opts.marketHashName);
    const min = Math.round((this.opts.minPriceUsd ?? 0) * 100);
    const max = Math.round((this.opts.maxPriceUsd ?? 0) * 100);
    if (min > 0) p.append('min_price', String(min));
    if (max > 0) p.append('max_price', String(max));
    return `${BASE_URL}/listings?${p.toString()}`;
  }

  private readQuota(headers: Headers): void {
    const remaining = parseInt(String(headers.get('x-ratelimit-remaining') || ''), 10);
    if (!Number.isFinite(remaining)) return;
    this.events.onQuota?.({
      remaining,
      limit: parseInt(String(headers.get('x-ratelimit-limit') || '0'), 10) || 0,
      resetUnix: parseInt(String(headers.get('x-ratelimit-reset') || '0'), 10) || 0
    });
  }

  /** Новые листинги из ответа: то, чего мы ещё не отдавали наверх. */
  private takeFresh(listings: CsfloatListing[]): CsfloatListing[] {
    const now = Date.now();
    for (const [id, ts] of this.seen) {
      if (now - ts > SEEN_TTL_MS) this.seen.delete(id);
    }
    const fresh: CsfloatListing[] = [];
    for (const l of listings) {
      const id = String(l?.id || '');
      if (!id || this.seen.has(id)) continue;
      this.seen.set(id, now);
      fresh.push(l);
    }
    return fresh;
  }

  private async tick(): Promise<void> {
    if (!this.running) return;

    try {
      const resp = await fetch(this.buildUrl(), {
        headers: { Authorization: this.opts.apiKey },
        signal: AbortSignal.timeout(20_000)
      });

      this.readQuota(resp.headers);

      if (resp.status === 429) {
        this.consecutive429 = Math.min(this.consecutive429 + 1, 6);
        this.currentDelayMs = Math.min(
          this.opts.intervalMs * Math.pow(2, this.consecutive429),
          MAX_BACKOFF_MS
        );
        this.events.onError?.(
          `CSFloat: 429, притормаживаю до ${Math.round(this.currentDelayMs / 1000)}с`,
          false
        );
        this.schedule();
        return;
      }

      if (resp.status === 401 || resp.status === 403) {
        this.consecutiveAuthFails++;
        // Три отказа подряд — ключ мёртвый, молча долбиться дальше бессмысленно.
        const fatal = this.consecutiveAuthFails >= 3;
        this.events.onError?.(`CSFloat: ${resp.status} — проверь API-ключ`, fatal);
        if (fatal) {
          this.stop();
          return;
        }
        this.schedule();
        return;
      }

      if (!resp.ok) {
        this.events.onError?.(`CSFloat: HTTP ${resp.status}`, false);
        this.schedule();
        return;
      }

      this.consecutive429 = 0;
      this.consecutiveAuthFails = 0;
      this.currentDelayMs = this.opts.intervalMs;

      const body: any = await resp.json();
      // Пока ждали ответ, пользователь мог нажать «Стоп». Результат запроса,
      // улетевшего до остановки, наверх не отдаём: иначе после «Стоп» пришла бы
      // сделка, а с ней — уведомление и автопокупка.
      if (!this.running) return;
      const listings: CsfloatListing[] = Array.isArray(body) ? body : (body?.data ?? []);
      const fresh = this.takeFresh(listings);
      if (fresh.length > 0) this.events.onListings(fresh);
    } catch (e: any) {
      this.events.onError?.(`Сеть: ${e?.message || e}`, false);
    }

    this.schedule();
  }
}
