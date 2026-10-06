// Журнал покупок и P&L. Раньше это была таблица bought_items в SQLite
// (legacy/database.ts), теперь обычный JSON — одному пользователю СУБД не нужна.
//
// Без Electron внутри: только fs, чтобы логику можно было прогнать проверкой.

import { existsSync, readFileSync } from 'fs';
import { backupCorrupt, writeFileAtomic } from '../engine/atomic';

export interface JournalEntry {
  id: string;
  name: string;
  boughtAt: string;
  buyPriceUsd: number;
  /** Оценка на момент покупки — чтобы потом видеть, оправдался ли расчёт. */
  referenceAtBuyUsd: number | null;
  floatValue: number | null;
  itemUrl: string | null;
  source: 'alert' | 'manual';
  soldAt: string | null;
  /** Сколько реально пришло на руки после комиссии площадки. */
  sellPriceUsd: number | null;
  note: string;
}

export interface JournalStats {
  count: number;
  openCount: number;
  soldCount: number;
  /** Всего потрачено за всё время. */
  investedUsd: number;
  /** Себестоимость того, что ещё не продано. */
  holdingUsd: number;
  /** Выручка от проданного. */
  revenueUsd: number;
  /** Себестоимость именно проданного. */
  costOfSoldUsd: number;
  /**
   * Реализованная прибыль = выручка − себестоимость ПРОДАННОГО.
   * Считать её как «выручка − все покупки» нельзя: пока лежит непроданный
   * товар, такая формула показывает убыток на ровном месте.
   */
  realizedUsd: number;
  realizedPercent: number;
}

export function loadJournal(path: string): JournalEntry[] {
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(raw)) return [];
    return raw.filter((e): e is JournalEntry => !!e && typeof e.id === 'string');
  } catch (e) {
    console.error(`Не удалось прочитать ${path}:`, e);
    // Иначе следующее сохранение перезапишет повреждённый файл пустым журналом.
    backupCorrupt(path);
    return [];
  }
}

export function saveJournal(path: string, entries: JournalEntry[]): void {
  writeFileAtomic(path, JSON.stringify(entries, null, 2));
}

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function computeStats(entries: JournalEntry[]): JournalStats {
  let investedUsd = 0;
  let holdingUsd = 0;
  let revenueUsd = 0;
  let costOfSoldUsd = 0;
  let soldCount = 0;

  for (const e of entries) {
    const buy = Number(e.buyPriceUsd) || 0;
    investedUsd += buy;
    if (e.sellPriceUsd === null || e.sellPriceUsd === undefined) {
      holdingUsd += buy;
    } else {
      soldCount++;
      revenueUsd += Number(e.sellPriceUsd) || 0;
      costOfSoldUsd += buy;
    }
  }

  const realizedUsd = revenueUsd - costOfSoldUsd;

  return {
    count: entries.length,
    openCount: entries.length - soldCount,
    soldCount,
    investedUsd,
    holdingUsd,
    revenueUsd,
    costOfSoldUsd,
    realizedUsd,
    realizedPercent: costOfSoldUsd > 0 ? (realizedUsd / costOfSoldUsd) * 100 : 0
  };
}

/** Прибыль по одной позиции; null, пока не продана. */
export function entryProfit(e: JournalEntry): number | null {
  if (e.sellPriceUsd === null || e.sellPriceUsd === undefined) return null;
  return e.sellPriceUsd - e.buyPriceUsd;
}

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Экспорт для Excel: трейдер посчитает свой винрейт сам. */
export function toCsv(entries: JournalEntry[]): string {
  const header = [
    'Предмет', 'Куплен', 'Цена покупки', 'Оценка при покупке',
    'Float', 'Продан', 'Цена продажи', 'Прибыль', 'Прибыль %', 'Ссылка', 'Заметка'
  ];

  const rows = entries.map((e) => {
    const profit = entryProfit(e);
    const percent = profit !== null && e.buyPriceUsd > 0 ? (profit / e.buyPriceUsd) * 100 : null;
    return [
      e.name,
      e.boughtAt,
      e.buyPriceUsd.toFixed(2),
      e.referenceAtBuyUsd !== null ? e.referenceAtBuyUsd.toFixed(2) : '',
      e.floatValue !== null ? e.floatValue.toFixed(6) : '',
      e.soldAt ?? '',
      e.sellPriceUsd !== null && e.sellPriceUsd !== undefined ? e.sellPriceUsd.toFixed(2) : '',
      profit !== null ? profit.toFixed(2) : '',
      percent !== null ? percent.toFixed(1) : '',
      e.itemUrl ?? '',
      e.note
    ].map(csvCell).join(';');
  });

  // BOM — иначе Excel открывает кириллицу кракозябрами.
  return '﻿' + [header.map(csvCell).join(';'), ...rows].join('\r\n');
}
