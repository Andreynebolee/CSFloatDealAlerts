// Движок целиком: подписался на события — получил сделки.
// Ничего не знает ни про Telegram, ни про Electron, ни про пользователей.

import { EventEmitter } from 'events';
import { ListingsFeed, Quota } from './feed';
import { evaluate } from './filter';
import { Settings, validateSettings } from './settings';
import { CsfloatListing, Deal } from './types';

export interface EngineStats {
  scanned: number;
  matched: number;
  startedAt: number | null;
  lastListingAt: number | null;
  quota: Quota | null;
  delayMs: number;
}

export declare interface DealEngine {
  on(e: 'deal', fn: (deal: Deal) => void): this;
  on(e: 'rejected', fn: (name: string, reason: string) => void): this;
  on(e: 'stats', fn: (stats: EngineStats) => void): this;
  on(e: 'error', fn: (message: string, fatal: boolean) => void): this;
}

export class DealEngine extends EventEmitter {
  private feed: ListingsFeed | null = null;
  private settings: Settings;
  private apiKey: string;
  private stats: EngineStats = {
    scanned: 0,
    matched: 0,
    startedAt: null,
    lastListingAt: null,
    quota: null,
    delayMs: 0
  };

  constructor(apiKey: string, settings: Settings) {
    super();
    this.apiKey = apiKey;
    this.settings = settings;
  }

  getStats(): EngineStats {
    return { ...this.stats, delayMs: this.feed?.delayMs ?? 0 };
  }

  get isRunning(): boolean {
    return this.feed?.isRunning ?? false;
  }

  /** Настройки на лету: фильтр читает их на каждом листинге, а запросы ленты — из параметров поллера. */
  updateSettings(settings: Settings): void {
    this.settings = settings;
    this.feed?.updateOptions({
      intervalMs: settings.poll.intervalMs,
      limit: settings.poll.limit,
      minPriceUsd: settings.price.minUsd,
      maxPriceUsd: settings.price.maxUsd,
      marketHashName: settings.accentMarketHashName || undefined
    });
  }

  start(): string[] {
    const problems = validateSettings(this.settings);
    if (problems.length > 0) return problems;
    if (!this.apiKey) return ['Не задан CSFloat API-ключ'];
    if (this.feed?.isRunning) return [];

    this.stats = { scanned: 0, matched: 0, startedAt: Date.now(), lastListingAt: null, quota: null, delayMs: 0 };

    this.feed = new ListingsFeed(
      {
        apiKey: this.apiKey,
        intervalMs: this.settings.poll.intervalMs,
        limit: this.settings.poll.limit,
        minPriceUsd: this.settings.price.minUsd,
        maxPriceUsd: this.settings.price.maxUsd,
        marketHashName: this.settings.accentMarketHashName || undefined
      },
      {
        onListings: (listings) => this.handle(listings),
        onQuota: (q) => {
          this.stats.quota = q;
          this.emit('stats', this.getStats());
        },
        onError: (msg, fatal) => this.emit('error', msg, fatal)
      }
    );

    this.feed.start();
    return [];
  }

  stop(): void {
    this.feed?.stop();
    this.feed = null;
    this.emit('stats', this.getStats());
  }

  /** Прогон готового набора листингов через фильтр — для dry-run по истории. */
  handle(listings: CsfloatListing[]): Deal[] {
    const found: Deal[] = [];
    const now = Date.now();

    for (const listing of listings) {
      this.stats.scanned++;
      const result = evaluate(listing, this.settings, now);
      if (result.ok) {
        this.stats.matched++;
        found.push(result.deal);
        this.emit('deal', result.deal);
      } else {
        this.emit('rejected', listing?.item?.market_hash_name || '?', result.reason);
      }
    }

    this.stats.lastListingAt = now;
    this.emit('stats', this.getStats());
    return found;
  }
}

export { evaluate } from './filter';
export * from './settings';
export * from './types';
