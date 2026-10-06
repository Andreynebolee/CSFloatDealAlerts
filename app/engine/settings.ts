// Настройки поиска. Раньше жили в SQLite (database.ts → InterestingSettings),
// теперь это обычный JSON-файл рядом с приложением.

import { existsSync, readFileSync } from 'fs';
import { backupCorrupt, writeFileAtomic } from './atomic';

export interface Settings {
  price: {
    minUsd: number;
    maxUsd: number;
  };
  discount: {
    /** Мин. скидка к оценке CSFloat, %. 0 = не фильтровать. */
    minPercent: number;
    /** Мин. абсолютная выгода, $. 0 = не фильтровать. */
    minProfitUsd: number;
  };
  listing: {
    /** Макс. возраст листинга в минутах. Раньше был захардкожен в 1. */
    maxAgeMinutes: number;
    /** Мин. число трейдов у продавца. 0 = не фильтровать. */
    minSellerTrades: number;
    /** Мин. ликвидность (продаж в день). 0 = не фильтровать. */
    minLiquidity: number;
  };
  types: {
    stickers: boolean;
    knives: boolean;
    gloves: boolean;
    rifles: boolean;
    smgs: boolean;
    pistols: boolean;
    shotguns: boolean;
    machineGuns: boolean;
    music: boolean;
    other: boolean;
  };
  premium: {
    /** Макс. переплата за float, % от базы. 0 = не фильтровать. */
    maxFloatPercent: number;
    /** Строгость по наклейкам: actualPaid / fairPremium. 0 = не фильтровать. */
    stickerStrictness: number;
  };
  /**
   * Автопокупка: по сделке ставится buy order на CSFloat ключом пользователя.
   * Тратит реальные деньги с его баланса, поэтому выключена по умолчанию
   * и обвешана лимитами — см. app/main/autobuy.ts.
   */
  autoBuy: {
    enabled: boolean;
    /**
     * 'direct' — выкупить именно тот лот из алерта (недокументированный
     * эндпоинт, может отвалиться); 'order' — поставить buy order, который
     * сработает на следующем таком лоте.
     */
    mode: 'direct' | 'order';
    /** Потолок на один ордер, $. */
    maxOrderUsd: number;
    /** Сколько максимум тратить за сутки, $. */
    dailyLimitUsd: number;
    /** Спрашивать подтверждение перед каждым ордером. */
    confirmEach: boolean;
  };
  poll: {
    /** Пауза между запросами к /listings, мс. Домашний IP — не жадничаем. */
    intervalMs: number;
    /** Сколько листингов за запрос. */
    limit: number;
  };
  /** Опционально: следить только за одним предметом. */
  accentMarketHashName: string;
  /** Дублировать алерты в Telegram (комп дома, ты — нет). */
  telegram: {
    enabled: boolean;
    botToken: string;
    chatId: string;
  };
}

/**
 * Дефолты повторяют поведение старого движка: возраст 1 мин, скидка 8%
 * (config.limits.csfloatDiscountPercent), float premium 10%, строгость
 * наклеек 1.0 — раньше это были константы в коде, теперь настраивается.
 * Интервал опроса поднят с серверного до безопасного для одного домашнего IP.
 */
export const DEFAULT_SETTINGS: Settings = {
  price: { minUsd: 1, maxUsd: 200 },
  discount: { minPercent: 8, minProfitUsd: 0 },
  listing: { maxAgeMinutes: 1, minSellerTrades: 0, minLiquidity: 0 },
  types: {
    stickers: false,
    knives: true,
    gloves: true,
    rifles: true,
    smgs: true,
    pistols: true,
    shotguns: true,
    machineGuns: true,
    music: false,
    other: false
  },
  premium: { maxFloatPercent: 10, stickerStrictness: 1.0 },
  autoBuy: { enabled: false, mode: 'direct', maxOrderUsd: 20, dailyLimitUsd: 100, confirmEach: true },
  poll: { intervalMs: 8000, limit: 50 },
  accentMarketHashName: '',
  telegram: { enabled: false, botToken: '', chatId: '' }
};

/** Мелкое слияние с дефолтами: файл может быть от старой версии. */
function mergeDefaults<T>(base: T, patch: any): T {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return base;
  const out: any = Array.isArray(base) ? base : { ...base };
  for (const key of Object.keys(patch)) {
    const b = (base as any)[key];
    if (b !== null && typeof b === 'object' && !Array.isArray(b)) {
      out[key] = mergeDefaults(b, patch[key]);
    } else if (patch[key] !== undefined) {
      out[key] = patch[key];
    }
  }
  return out;
}

export function loadSettings(path: string): Settings {
  if (!existsSync(path)) return { ...DEFAULT_SETTINGS };
  try {
    const merged: any = mergeDefaults(DEFAULT_SETTINGS, JSON.parse(readFileSync(path, 'utf8')));
    // Старые версии хранили здесь настройки Buff163 — раздел удалён.
    delete merged.buff;
    return merged as Settings;
  } catch (e) {
    console.error(`Не удалось прочитать ${path}, беру дефолты:`, e);
    backupCorrupt(path);
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(path: string, settings: Settings): void {
  writeFileAtomic(path, JSON.stringify(settings, null, 2));
}

/** Проверка настроек перед стартом. Возвращает список проблем (пустой = ок). */
export function validateSettings(s: Settings): string[] {
  const problems: string[] = [];
  if (s.price.minUsd < 0 || s.price.maxUsd <= 0) problems.push('Диапазон цены задан неверно');
  if (s.price.minUsd >= s.price.maxUsd) problems.push('Мин. цена должна быть меньше макс.');
  if (s.listing.maxAgeMinutes <= 0) problems.push('Возраст листинга должен быть больше 0');
  if (s.poll.intervalMs < 2000) problems.push('Интервал опроса < 2с — CSFloat вернёт 429 и заблокирует ключ');
  if (s.poll.limit < 1 || s.poll.limit > 50) problems.push('limit должен быть от 1 до 50');
  if (!Object.values(s.types).some(Boolean)) problems.push('Не выбран ни один тип предметов');
  if (s.autoBuy.enabled) {
    if (!(s.autoBuy.maxOrderUsd > 0)) problems.push('Автопокупка: потолок на ордер должен быть больше 0');
    if (!(s.autoBuy.dailyLimitUsd > 0)) problems.push('Автопокупка: дневной лимит должен быть больше 0');
    if (s.autoBuy.dailyLimitUsd < s.autoBuy.maxOrderUsd) {
      problems.push('Автопокупка: дневной лимит меньше потолка на один ордер');
    }
    if (s.autoBuy.maxOrderUsd > s.price.maxUsd) {
      problems.push('Автопокупка: потолок на ордер выше максимальной цены поиска — лишний риск');
    }
  }
  if (s.telegram.enabled && (!s.telegram.botToken || !s.telegram.chatId)) {
    problems.push('Telegram включён, но не задан токен или chat id');
  }
  return problems;
}
