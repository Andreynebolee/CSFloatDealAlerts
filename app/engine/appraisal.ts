// Оценка предмета. Всё считается из данных, которые CSFloat отдаёт вместе
// с листингом — ни одного дополнительного запроса, ни одного платного источника.
// Перенесено из monitor_bot.ts (getAppraisedUsd / evaluateStickerPremium /
// stickerCapRate / getItemType) без изменения формул.

import { CsfloatListing, ItemType } from './types';

function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? parseFloat(v) : (typeof v === 'number' ? v : NaN);
  return Number.isFinite(n) ? n : undefined;
}

export interface Appraisal {
  baseUsd: number;
  /** Надбавка/скидка за float в долларах. */
  factorUsd?: number;
  finalUsd: number;
  source: 'csfloat_predicted' | 'csfloat_base' | 'steam_scm';
}

/**
 * Референсная цена предмета.
 * reference.predicted_price учитывает float — это лучший источник.
 * Дальше по убыванию: base_price, затем цена Steam из item.scm.
 */
export function appraise(listing: CsfloatListing): Appraisal | undefined {
  const base = num(listing?.reference?.base_price);
  const predicted = num(listing?.reference?.predicted_price);
  const floatFactor = num(listing?.reference?.float_factor);

  if (predicted !== undefined && predicted > 0) {
    const finalUsd = predicted / 100;
    const baseUsd = base !== undefined && base > 0 ? base / 100 : finalUsd;
    // float_factor приоритетнее (predicted - base): у застикеренных предметов
    // разность включает ещё и стикерную премию.
    const factorUsd =
      floatFactor !== undefined
        ? floatFactor / 100
        : base !== undefined && base > 0
          ? (predicted - base) / 100
          : undefined;
    return { baseUsd, factorUsd, finalUsd, source: 'csfloat_predicted' };
  }

  if (base !== undefined && base > 0) {
    return { baseUsd: base / 100, finalUsd: base / 100, source: 'csfloat_base' };
  }

  const scm = num(listing?.item?.scm?.price);
  if (scm !== undefined && scm > 0) {
    return { baseUsd: scm / 100, finalUsd: scm / 100, source: 'steam_scm' };
  }

  return undefined;
}

/** Справедливая доля стоимости наклейки, которую нормально доплатить. */
export function stickerCapRate(priceUsd: number): number {
  if (priceUsd <= 10) return 0.15;   // paper/glitter
  if (priceUsd <= 50) return 0.25;   // holo/foil
  if (priceUsd <= 500) return 0.40;  // редкие holo/gold
  if (priceUsd <= 5000) return 0.70; // Katowice/DreamHack
  return 1.0;                        // историческое/мэтч
}

export interface StickerPremium {
  stickerSumUsd: number;
  fairPremiumUsd: number;
  /** Сколько реально доплачено сверх (base + float). null = посчитать нельзя. */
  actualPaidUsd: number | null;
  overpayRatio: number | null;
}

/**
 * fairPremium  = Σ(цена наклейки × capRate)
 * actualPaid   = listing − (base + float)
 * overpayRatio = actualPaid / fairPremium — больше строгости ⇒ переплата.
 */
export function stickerPremium(listing: CsfloatListing): StickerPremium | undefined {
  const stickers = listing?.item?.stickers;
  if (!Array.isArray(stickers) || stickers.length === 0) return undefined;

  let stickerSumUsd = 0;
  let fairPremiumUsd = 0;
  for (const s of stickers) {
    const cents = num(s?.reference?.price);
    const priceUsd = cents !== undefined ? cents / 100 : 0;
    if (priceUsd <= 0) continue;
    stickerSumUsd += priceUsd;
    fairPremiumUsd += priceUsd * stickerCapRate(priceUsd);
  }

  // Наклейки есть, но цен нет — оценить нельзя, не блокируем.
  if (stickerSumUsd <= 0) {
    return { stickerSumUsd: 0, fairPremiumUsd: 0, actualPaidUsd: null, overpayRatio: null };
  }

  const baseCents = num(listing?.reference?.base_price);
  const floatCents = num(listing?.reference?.float_factor) ?? 0;
  const listingCents = num(listing?.price);
  if (baseCents === undefined || baseCents <= 0 || listingCents === undefined) {
    return { stickerSumUsd, fairPremiumUsd, actualPaidUsd: null, overpayRatio: null };
  }

  const skinlessUsd = (baseCents + floatCents) / 100;
  const actualPaidUsd = listingCents / 100 - skinlessUsd;

  // Премия больше стоимости самих наклеек — это не переплата за стикеры,
  // а недооценка базы (Fade, Doppler, Case Hardened). Не блокируем.
  if (actualPaidUsd > stickerSumUsd) {
    return { stickerSumUsd, fairPremiumUsd, actualPaidUsd, overpayRatio: null };
  }

  return {
    stickerSumUsd,
    fairPremiumUsd,
    actualPaidUsd,
    overpayRatio: fairPremiumUsd > 0 ? actualPaidUsd / fairPremiumUsd : null
  };
}

export function getItemType(name: string): ItemType {
  if (!name) return 'other';

  // Знак ★ и префиксы качества категорию не меняют: «StatTrak™ AK-47 | Redline»
  // — всё та же винтовка. Без этого весь StatTrak и Souvenir уходил в «другое»
  // и по умолчанию молча отсеивался.
  const star = name.startsWith('★');
  const base = name.replace(/^★\s*/, '').replace(/^(?:StatTrak™|Souvenir)\s+/, '');

  if (base.startsWith('Sticker |')) return 'stickers';
  if (base.startsWith('Music Kit |')) return 'music';

  // Перчатки в Steam тоже помечены ★, поэтому проверяем их раньше ножей —
  // иначе они считались ножами и подчинялись не тому переключателю.
  const itemPart = base.split(' | ')[0];
  if (itemPart.includes('Gloves') || itemPart.includes('Hand Wraps')) return 'gloves';
  if (star || base.includes('Knife') || base.includes('Bayonet')) return 'knives';

  if (base.startsWith('AK-47 |') || base.startsWith('M4A4 |') || base.startsWith('M4A1-S |') ||
      base.startsWith('AWP |') || base.startsWith('FAMAS |') || base.startsWith('Galil AR |') ||
      base.startsWith('SG 553 |') || base.startsWith('AUG |') || base.startsWith('SSG 08 |') ||
      base.startsWith('SCAR-20 |') || base.startsWith('G3SG1 |')) return 'rifles';

  if (base.startsWith('MP9 |') || base.startsWith('MAC-10 |') || base.startsWith('MP7 |') ||
      base.startsWith('MP5-SD |') || base.startsWith('UMP-45 |') || base.startsWith('P90 |') ||
      base.startsWith('PP-Bizon |')) return 'smgs';

  if (base.startsWith('Desert Eagle |') || base.startsWith('USP-S |') || base.startsWith('Glock-18 |') ||
      base.startsWith('P250 |') || base.startsWith('Five-SeveN |') || base.startsWith('Tec-9 |') ||
      base.startsWith('CZ75-Auto |') || base.startsWith('Dual Berettas |') || base.startsWith('R8 Revolver |') ||
      base.startsWith('P2000 |')) return 'pistols';

  if (base.startsWith('Nova |') || base.startsWith('Sawed-Off |') || base.startsWith('MAG-7 |') ||
      base.startsWith('XM1014 |')) return 'shotguns';
  if (base.startsWith('Negev |') || base.startsWith('M249 |')) return 'machineguns';

  return 'other';
}

/** Ликвидность: reference.quantity, иначе объём продаж на Steam. */
export function liquidityOf(listing: CsfloatListing): number | null {
  return num(listing?.reference?.quantity) ?? num(listing?.item?.scm?.volume) ?? null;
}
