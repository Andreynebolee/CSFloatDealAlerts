// Dry-run: «что бы поймали ваши настройки за последний час».
//
// Ключевой момент — виртуальное время. Исторический листинг сейчас уже старый,
// и фильтр возраста отбросил бы вообще всё. Поэтому каждый листинг судим так,
// будто мы увидели его через секунду после появления — ровно как в бою.

import { evaluate } from './filter';
import { Settings } from './settings';
import { CsfloatListing, Deal, RejectCode } from './types';

/** Насколько «свежим» листинг выглядит для фильтра при прогоне по истории. */
const VIRTUAL_AGE_MS = 1000;

export const REJECT_LABELS: Record<RejectCode, string> = {
  no_name: 'без названия',
  not_buy_now: 'не мгновенная покупка',
  not_listed: 'не в продаже',
  accent: 'другой предмет (задан акцент)',
  type: 'тип предмета отключён',
  price: 'цена вне диапазона',
  age: 'листинг старше лимита',
  trades: 'мало трейдов у продавца',
  liquidity: 'низкая ликвидность',
  no_reference: 'нет референсной цены',
  sticker_premium: 'переплата за наклейки',
  float_premium: 'переплата за float',
  bad_data: 'битые данные',
  discount: 'скидка меньше порога',
  profit: 'выгода меньше порога'
};

export interface RejectBucket {
  code: RejectCode;
  label: string;
  count: number;
  /** Пример причины с числами — чтобы было видно, насколько не дотянуло. */
  sample: string;
}

export interface DryRunResult {
  scanned: number;
  matched: number;
  deals: Deal[];
  buckets: RejectBucket[];
  windowMinutes: number;
  /** Реально покрытое окно — лента могла закончиться раньше. */
  coveredMinutes: number;
  pages: number;
  note: string | null;
}

export function analyze(
  listings: CsfloatListing[],
  s: Settings,
  windowMinutes: number,
  pages: number,
  note: string | null
): DryRunResult {
  const deals: Deal[] = [];
  const counts = new Map<RejectCode, { count: number; sample: string }>();

  let oldestMs = Date.now();

  for (const listing of listings) {
    const createdMs = Date.parse(listing?.created_at ?? '');
    if (Number.isFinite(createdMs)) oldestMs = Math.min(oldestMs, createdMs);

    const virtualNow = Number.isFinite(createdMs) ? createdMs + VIRTUAL_AGE_MS : Date.now();
    const result = evaluate(listing, s, virtualNow);

    if (result.ok) {
      deals.push(result.deal);
      continue;
    }

    const bucket = counts.get(result.code);
    if (bucket) bucket.count++;
    else counts.set(result.code, { count: 1, sample: result.reason });
  }

  const buckets: RejectBucket[] = [...counts.entries()]
    .map(([code, v]) => ({ code, label: REJECT_LABELS[code], count: v.count, sample: v.sample }))
    .sort((a, b) => b.count - a.count);

  deals.sort((a, b) => b.discountPercent - a.discountPercent);

  return {
    scanned: listings.length,
    matched: deals.length,
    deals,
    buckets,
    windowMinutes,
    coveredMinutes: listings.length > 0 ? (Date.now() - oldestMs) / 60_000 : 0,
    pages,
    note
  };
}
