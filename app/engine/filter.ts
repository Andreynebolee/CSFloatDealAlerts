// Сердце движка: одна чистая функция без сети, файлов и таймеров.
// Раньше это было размазано по runMonitoring / isItemSuitable /
// isItemSuitableWithSteam в monitor_bot.ts (3137 строк).

import { appraise, getItemType, liquidityOf, stickerPremium } from './appraisal';
import { Settings } from './settings';
import { CsfloatListing, Deal, FilterResult, ItemType, RejectCode } from './types';

const SITE_BASE = 'https://csfloat.com';

function typeAllowed(type: ItemType, s: Settings): boolean {
  switch (type) {
    case 'stickers': return s.types.stickers;
    case 'knives': return s.types.knives;
    case 'gloves': return s.types.gloves;
    case 'rifles': return s.types.rifles;
    case 'smgs': return s.types.smgs;
    case 'pistols': return s.types.pistols;
    case 'shotguns': return s.types.shotguns;
    case 'machineguns': return s.types.machineGuns;
    case 'music': return s.types.music;
    case 'other': return s.types.other;
  }
}

function reject(code: RejectCode, reason: string): FilterResult {
  return { ok: false, code, reason };
}

/**
 * Решает, сделка это или нет. Порядок проверок — от дешёвых к дорогим,
 * чтобы на горячем пути отсеивать как можно раньше.
 *
 * @param now время в мс — параметром, чтобы функция оставалась чистой и тестируемой.
 */
export function evaluate(listing: CsfloatListing, s: Settings, now: number = Date.now()): FilterResult {
  const name = listing?.item?.market_hash_name || '';
  if (!name) return reject('no_name', 'Нет market_hash_name');

  if (listing.type !== 'buy_now') return reject('not_buy_now', `Не buy_now (${listing.type})`);
  if (listing.state !== 'listed') return reject('not_listed', `Не listed (${listing.state})`);

  if (s.accentMarketHashName && name !== s.accentMarketHashName) {
    return reject('accent', `Не акцентный предмет: ${name}`);
  }

  const itemType = getItemType(name);
  if (!typeAllowed(itemType, s)) return reject('type', `Тип отключён в настройках: ${itemType}`);

  // Без цены сравнения ниже дают NaN и «проходят» (NaN < x — всегда false),
  // так что листинг без цены стал бы сделкой с ценой NaN.
  const priceUsd = listing.price / 100;
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return reject('bad_data', 'Нет цены листинга');
  if (priceUsd < s.price.minUsd || priceUsd > s.price.maxUsd) {
    return reject('price', `Цена вне диапазона: $${priceUsd.toFixed(2)}`);
  }

  const createdMs = Date.parse(listing.created_at);
  if (!Number.isFinite(createdMs)) return reject('bad_data', 'Не удалось разобрать created_at');
  const ageSeconds = (now - createdMs) / 1000;
  if (ageSeconds > s.listing.maxAgeMinutes * 60) {
    return reject('age', `Листинг старый: ${(ageSeconds / 60).toFixed(1)} мин > ${s.listing.maxAgeMinutes}`);
  }

  const trades = listing.seller?.statistics?.total_trades ?? 0;
  if (s.listing.minSellerTrades > 0 && trades < s.listing.minSellerTrades) {
    return reject('trades', `Мало трейдов у продавца: ${trades} < ${s.listing.minSellerTrades}`);
  }

  const liquidity = liquidityOf(listing);
  if (s.listing.minLiquidity > 0) {
    if (liquidity === null) return reject('liquidity', 'Нет данных о ликвидности');
    if (liquidity < s.listing.minLiquidity) {
      return reject('liquidity', `Низкая ликвидность: ${liquidity} < ${s.listing.minLiquidity}`);
    }
  }

  const appraisal = appraise(listing);
  if (!appraisal || !(appraisal.finalUsd > 0)) {
    return reject('no_reference', 'Нет референсной цены (CSFloat не вернул reference и scm)');
  }

  // Переплата за наклейки: на перепродаже за стикеры почти не доплачивают.
  const sp = stickerPremium(listing);
  if (s.premium.stickerStrictness > 0 && sp && sp.overpayRatio !== null) {
    if (sp.overpayRatio > s.premium.stickerStrictness) {
      return reject(
        'sticker_premium',
        `Переплата за наклейки $${(sp.actualPaidUsd ?? 0).toFixed(2)} > справедливой $${sp.fairPremiumUsd.toFixed(2)}`
      );
    }
  }

  // Переплата за красивый float — тоже риск: на перепродаже её не вернуть.
  let floatPremiumPercent: number | null = null;
  if (typeof appraisal.factorUsd === 'number' && appraisal.baseUsd > 0) {
    floatPremiumPercent = (appraisal.factorUsd / appraisal.baseUsd) * 100;
    if (s.premium.maxFloatPercent > 0 && floatPremiumPercent > s.premium.maxFloatPercent) {
      return reject('float_premium', `Float premium ${floatPremiumPercent.toFixed(1)}% > ${s.premium.maxFloatPercent}%`);
    }
  }

  const referenceUsd = appraisal.finalUsd;
  const discountPercent = ((referenceUsd - priceUsd) / referenceUsd) * 100;
  const profitUsd = referenceUsd - priceUsd;

  // Скидка больше 100% от цены невозможна — значит данные битые.
  if (discountPercent < -100) return reject('bad_data', `Битые данные оценки: ${discountPercent.toFixed(1)}%`);

  if (s.discount.minPercent > 0 && discountPercent < s.discount.minPercent) {
    return reject('discount', `Скидка ${discountPercent.toFixed(1)}% < ${s.discount.minPercent}%`);
  }
  if (s.discount.minProfitUsd > 0 && profitUsd < s.discount.minProfitUsd) {
    return reject('profit', `Выгода $${profitUsd.toFixed(2)} < $${s.discount.minProfitUsd.toFixed(2)}`);
  }

  const deal: Deal = {
    id: String(listing.id),
    foundAt: new Date(now).toISOString(),
    name,
    itemType,
    priceUsd,
    referenceUsd,
    referenceSource: appraisal.source,
    discountPercent,
    profitUsd,
    floatValue: typeof listing.item.float_value === 'number' ? listing.item.float_value : null,
    floatPremiumPercent,
    stickers: sp ? { totalUsd: sp.stickerSumUsd, paidUsd: sp.actualPaidUsd } : null,
    liquidity,
    seller: { name: listing.seller?.username || 'unknown', trades },
    ageSeconds,
    iconUrl: listing.item.icon_url || null,
    url: `${SITE_BASE}/item/${listing.id}`
  };

  return { ok: true, deal };
}
