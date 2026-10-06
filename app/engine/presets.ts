// Пресеты — замена семи захардкоженных стратегий из старого config.ts.
// Встроенные лежат в коде, пользовательские — в presets.json рядом с настройками.

import { existsSync, readFileSync } from 'fs';
import { backupCorrupt, writeFileAtomic } from './atomic';
import { Settings } from './settings';

export interface Preset {
  id: string;
  name: string;
  hint: string;
  builtin: boolean;
  /** Накладывается поверх текущих настроек, а не заменяет их целиком. */
  patch: DeepPartial<Settings>;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

const ALL_WEAPONS = {
  knives: false,
  gloves: false,
  rifles: true,
  smgs: true,
  pistols: true,
  shotguns: true,
  machineGuns: true,
  stickers: false,
  music: false,
  other: false
};

export const BUILTIN_PRESETS: Preset[] = [
  {
    id: 'cheap-flips',
    name: 'Дешёвые флипы',
    hint: 'До $20, скидка от 12%. Много сигналов, низкий риск на сделку.',
    builtin: true,
    patch: {
      price: { minUsd: 1, maxUsd: 20 },
      discount: { minPercent: 12, minProfitUsd: 0.5 },
      listing: { maxAgeMinutes: 2, minSellerTrades: 3, minLiquidity: 0 },
      types: { ...ALL_WEAPONS }
    }
  },
  {
    id: 'liquid',
    name: 'Только ликвидное',
    hint: 'Предметы, которые реально продаются: от 20 продаж в день.',
    builtin: true,
    patch: {
      price: { minUsd: 5, maxUsd: 150 },
      discount: { minPercent: 8, minProfitUsd: 1 },
      listing: { maxAgeMinutes: 2, minSellerTrades: 10, minLiquidity: 20 },
      types: { ...ALL_WEAPONS }
    }
  },
  {
    id: 'knives-gloves',
    name: 'Ножи и перчатки',
    hint: 'Дорогой сегмент. Сигналов мало, выгода на сделку большая.',
    builtin: true,
    patch: {
      price: { minUsd: 80, maxUsd: 3000 },
      discount: { minPercent: 10, minProfitUsd: 15 },
      listing: { maxAgeMinutes: 5, minSellerTrades: 20, minLiquidity: 0 },
      types: { ...ALL_WEAPONS, knives: true, gloves: true, rifles: false, smgs: false, pistols: false, shotguns: false, machineGuns: false }
    }
  },
  {
    id: 'stickers',
    name: 'Наклейки',
    hint: 'Чистые наклейки, без оружия.',
    builtin: true,
    patch: {
      price: { minUsd: 0.5, maxUsd: 100 },
      discount: { minPercent: 15, minProfitUsd: 0.5 },
      listing: { maxAgeMinutes: 5, minSellerTrades: 0, minLiquidity: 0 },
      types: { ...ALL_WEAPONS, rifles: false, smgs: false, pistols: false, shotguns: false, machineGuns: false, stickers: true }
    }
  },
  {
    id: 'wide',
    name: 'Широкий поиск',
    hint: 'Всё подряд со скидкой от 6%. Для первого знакомства и dry-run.',
    builtin: true,
    patch: {
      price: { minUsd: 1, maxUsd: 500 },
      discount: { minPercent: 6, minProfitUsd: 0 },
      listing: { maxAgeMinutes: 5, minSellerTrades: 0, minLiquidity: 0 },
      types: { ...ALL_WEAPONS, knives: true, gloves: true }
    }
  }
];

/**
 * Что вообще может лежать в пресете: только параметры поиска. Автопокупка,
 * токен Telegram и частота опроса — личные настройки пользователя, их пресет
 * не должен ни хранить (токен лёг бы в presets.json), ни менять при применении
 * (пресет не должен втихую включать трату денег).
 */
export const FILTER_KEYS = ['price', 'discount', 'listing', 'types', 'premium', 'accentMarketHashName'] as const;

function pickKeys(source: unknown): DeepPartial<Settings> {
  const out: any = {};
  if (source === null || typeof source !== 'object') return out;
  for (const key of FILTER_KEYS) {
    const value = (source as any)[key];
    if (value !== undefined) out[key] = JSON.parse(JSON.stringify(value));
  }
  return out;
}

/** Фильтры из текущих настроек — то, что сохраняется как свой пресет. */
export function pickFilters(settings: Settings): DeepPartial<Settings> {
  return pickKeys(settings);
}

export function loadCustomPresets(path: string): Preset[] {
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(raw)) return [];
    const valid = raw.filter((p): p is Preset => !!p && typeof p.id === 'string' && typeof p.name === 'string');

    // Пресеты старых версий хранили настройки целиком — вместе с токеном Telegram
    // и флагом автопокупки. Оставляем только фильтры и перезаписываем файл.
    let cleaned = false;
    const presets = valid.map((p) => {
      const patch = pickKeys(p.patch);
      if (JSON.stringify(patch) !== JSON.stringify(p.patch)) cleaned = true;
      return { ...p, patch };
    });
    if (cleaned) {
      try {
        saveCustomPresets(path, presets);
      } catch (e) {
        console.error(`Не удалось очистить ${path}:`, e);
      }
    }
    return presets;
  } catch (e) {
    console.error(`Не удалось прочитать ${path}:`, e);
    backupCorrupt(path);
    return [];
  }
}

export function saveCustomPresets(path: string, presets: Preset[]): void {
  writeFileAtomic(path, JSON.stringify(presets.filter((p) => !p.builtin), null, 2));
}

/** Наложение пресета: меняем только те поля, что он задаёт. */
export function applyPreset(settings: Settings, patch: DeepPartial<Settings>): Settings {
  const out: any = JSON.parse(JSON.stringify(settings));
  for (const [key, value] of Object.entries(patch)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = { ...out[key], ...value };
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out as Settings;
}
