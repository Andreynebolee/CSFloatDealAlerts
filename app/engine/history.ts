// Постраничная выгрузка недавних листингов для dry-run.
// В отличие от ListingsFeed здесь не поток, а разовый забор истории:
// идём по курсору назад во времени, пока не упрёмся в границу окна.

import { CsfloatListing } from './types';

const BASE_URL = 'https://csfloat.com/api/v1';

export interface HistoryOptions {
  apiKey: string;
  /** Насколько назад забираем ленту, минут. */
  windowMinutes: number;
  /** Листингов за страницу, максимум 50. */
  limit: number;
  /** Потолок страниц — защита от бесконечного листания и от 429. */
  maxPages: number;
  /** Пауза между страницами, мс. */
  spacingMs: number;
  minPriceUsd?: number;
  maxPriceUsd?: number;
  marketHashName?: string;
}

export interface HistoryProgress {
  page: number;
  fetched: number;
  oldestAgeMinutes: number;
}

export interface HistoryResult {
  listings: CsfloatListing[];
  pages: number;
  /** Дошли ли до границы окна или остановились раньше (лимит страниц / 429). */
  complete: boolean;
  note: string | null;
}

/** У CSFloat курсор в разное время назывался по-разному — берём что найдём. */
function readCursor(body: any): string | undefined {
  const candidates = [
    body?.cursor,
    body?.next_cursor,
    body?.nextCursor,
    body?.meta?.cursor,
    body?.meta?.next_cursor,
    body?.meta?.nextCursor
  ];
  return candidates.find((c) => typeof c === 'string' && c.length > 0);
}

function buildUrl(opts: HistoryOptions, cursor?: string): string {
  const p = new URLSearchParams();
  p.append('type', 'buy_now');
  p.append('sort_by', 'most_recent');
  p.append('limit', String(Math.min(50, Math.max(1, opts.limit))));
  if (opts.marketHashName) p.append('market_hash_name', opts.marketHashName);
  const min = Math.round((opts.minPriceUsd ?? 0) * 100);
  const max = Math.round((opts.maxPriceUsd ?? 0) * 100);
  if (min > 0) p.append('min_price', String(min));
  if (max > 0) p.append('max_price', String(max));
  if (cursor) p.append('cursor', cursor);
  return `${BASE_URL}/listings?${p.toString()}`;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function fetchHistory(
  opts: HistoryOptions,
  onProgress?: (p: HistoryProgress) => void
): Promise<HistoryResult> {
  const cutoffMs = Date.now() - opts.windowMinutes * 60_000;
  const listings: CsfloatListing[] = [];
  const seen = new Set<string>();

  let cursor: string | undefined;
  let pages = 0;
  let note: string | null = null;
  let complete = false;

  while (pages < opts.maxPages) {
    const resp = await fetch(buildUrl(opts, cursor), {
      headers: { Authorization: opts.apiKey },
      signal: AbortSignal.timeout(20_000)
    });

    if (resp.status === 429) {
      note = 'CSFloat ответил 429 — выгрузил столько, сколько успел';
      break;
    }
    if (resp.status === 401 || resp.status === 403) {
      throw new Error(`CSFloat: ${resp.status} — проверьте API-ключ`);
    }
    if (!resp.ok) {
      throw new Error(`CSFloat: HTTP ${resp.status}`);
    }

    const body: any = await resp.json();
    const page: CsfloatListing[] = Array.isArray(body) ? body : (body?.data ?? []);
    pages++;

    if (page.length === 0) {
      complete = true;
      note = note ?? 'Лента закончилась раньше границы окна';
      break;
    }

    let oldestMs = Date.now();
    let reachedCutoff = false;

    for (const l of page) {
      const id = String(l?.id || '');
      if (!id || seen.has(id)) continue;
      const createdMs = Date.parse(l?.created_at ?? '');
      if (Number.isFinite(createdMs)) {
        oldestMs = Math.min(oldestMs, createdMs);
        if (createdMs < cutoffMs) {
          reachedCutoff = true;
          continue; // за границей окна — не берём
        }
      }
      seen.add(id);
      listings.push(l);
    }

    onProgress?.({
      page: pages,
      fetched: listings.length,
      oldestAgeMinutes: (Date.now() - oldestMs) / 60_000
    });

    if (reachedCutoff) {
      complete = true;
      break;
    }

    cursor = readCursor(body);
    if (!cursor) {
      note = note ?? 'CSFloat не вернул курсор — дальше листать нечем';
      break;
    }

    await sleep(opts.spacingMs);
  }

  if (!complete && pages >= opts.maxPages && !note) {
    note = `Остановился на ${opts.maxPages} страницах, чтобы не ловить 429`;
  }

  return { listings, pages, complete, note };
}
