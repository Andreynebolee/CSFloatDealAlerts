// Ограничители автопокупки. Это единственное место в приложении, которое
// тратит реальные деньги, поэтому здесь всё сделано «запрещено, пока не
// разрешено явно»: выключено по умолчанию, потолок на ордер, лимит на сутки,
// защита от повторов по одному предмету.
//
// Без Electron внутри — чтобы арифметику лимитов можно было прогнать проверкой.

import { existsSync, readFileSync } from 'fs';
import { backupCorrupt, writeFileAtomic } from '../engine/atomic';

export interface PlacedOrder {
  orderId: string;
  name: string;
  priceUsd: number;
  placedAt: string;
}

export interface AutoBuyState {
  /** Сутки, за которые накоплен spentUsd (локальная дата YYYY-MM-DD). */
  day: string;
  spentUsd: number;
  placed: PlacedOrder[];
}

export interface AutoBuyLimits {
  enabled: boolean;
  maxOrderUsd: number;
  dailyLimitUsd: number;
}

export type GuardResult = { ok: true } | { ok: false; reason: string };

/** Сколько не ставим повторный ордер по тому же предмету. */
export const REPEAT_COOLDOWN_MS = 30 * 60_000;

/** Сколько записей о поставленных ордерах храним. */
const KEEP_PLACED = 200;

export function dayKey(now: number): string {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function emptyState(now: number): AutoBuyState {
  return { day: dayKey(now), spentUsd: 0, placed: [] };
}

export function loadState(path: string, now: number): AutoBuyState {
  if (!existsSync(path)) return emptyState(now);
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const state: AutoBuyState = {
      day: typeof raw?.day === 'string' ? raw.day : dayKey(now),
      spentUsd: Number(raw?.spentUsd) || 0,
      placed: Array.isArray(raw?.placed) ? raw.placed : []
    };
    return rollover(state, now);
  } catch (e) {
    console.error(`Не удалось прочитать ${path}:`, e);
    backupCorrupt(path);
    return emptyState(now);
  }
}

export function saveState(path: string, state: AutoBuyState): void {
  writeFileAtomic(path, JSON.stringify(state, null, 2));
}

/** Наступили новые сутки — дневной счётчик обнуляется, история остаётся. */
export function rollover(state: AutoBuyState, now: number): AutoBuyState {
  const today = dayKey(now);
  if (state.day === today) return state;
  return { day: today, spentUsd: 0, placed: state.placed };
}

/**
 * Можно ли ставить ордер. Проверки идут от самых грубых к точным, чтобы
 * причина отказа была максимально конкретной — её видит пользователь.
 */
export function canPlace(
  deal: { name: string; priceUsd: number },
  limits: AutoBuyLimits,
  state: AutoBuyState,
  now: number
): GuardResult {
  if (!limits.enabled) return { ok: false, reason: 'автопокупка выключена' };

  if (!(deal.priceUsd > 0)) return { ok: false, reason: 'некорректная цена лота' };

  if (deal.priceUsd > limits.maxOrderUsd) {
    return {
      ok: false,
      reason: `$${deal.priceUsd.toFixed(2)} превышает потолок на ордер $${limits.maxOrderUsd.toFixed(2)}`
    };
  }

  const fresh = rollover(state, now);
  const after = fresh.spentUsd + deal.priceUsd;
  if (after > limits.dailyLimitUsd) {
    return {
      ok: false,
      reason: `дневной лимит $${limits.dailyLimitUsd.toFixed(2)} исчерпан ` +
        `(потрачено $${fresh.spentUsd.toFixed(2)}, нужно ещё $${deal.priceUsd.toFixed(2)})`
    };
  }

  const recent = fresh.placed.find(
    (p) => p.name === deal.name && now - Date.parse(p.placedAt) < REPEAT_COOLDOWN_MS
  );
  if (recent) {
    const minutes = Math.ceil((REPEAT_COOLDOWN_MS - (now - Date.parse(recent.placedAt))) / 60_000);
    return { ok: false, reason: `ордер на «${deal.name}» уже стоит, повтор через ${minutes} мин` };
  }

  return { ok: true };
}

/** Записать факт постановки ордера: сдвигает дневной счётчик. */
export function recordPlaced(
  state: AutoBuyState,
  order: PlacedOrder,
  now: number
): AutoBuyState {
  const fresh = rollover(state, now);
  const placed = [order, ...fresh.placed].slice(0, KEEP_PLACED);
  return { day: fresh.day, spentUsd: fresh.spentUsd + order.priceUsd, placed };
}
