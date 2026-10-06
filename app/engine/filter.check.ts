// Runnable check: node -r ts-node/register app/engine/filter.check.ts
// Ловит поломки в логике отбора — она вся здесь и вся чистая.

import { strict as assert } from 'assert';
import { appraise, getItemType, stickerPremium } from './appraisal';
import { evaluate } from './filter';
import { DEFAULT_SETTINGS, Settings, validateSettings } from './settings';
import { CsfloatListing } from './types';

const NOW = Date.parse('2026-09-01T12:00:00.000Z');

function listing(patch: any = {}): CsfloatListing {
  return {
    id: 'abc123',
    type: 'buy_now',
    state: 'listed',
    price: 900, // $9.00
    created_at: new Date(NOW - 20_000).toISOString(), // 20 секунд назад
    seller: { username: 'seller', statistics: { total_trades: 42 } },
    item: { market_hash_name: 'AK-47 | Redline', float_value: 0.22, ...(patch.item || {}) },
    reference: { base_price: 1000, predicted_price: 1000, float_factor: 0, quantity: 30, ...(patch.reference || {}) },
    ...Object.fromEntries(Object.entries(patch).filter(([k]) => k !== 'item' && k !== 'reference'))
  } as CsfloatListing;
}

function settings(patch: Partial<Settings> = {}): Settings {
  return JSON.parse(JSON.stringify({ ...DEFAULT_SETTINGS, ...patch }));
}

// --- appraisal: приоритет источников ---
assert.equal(appraise(listing())!.source, 'csfloat_predicted');
assert.equal(appraise(listing({ reference: { predicted_price: 0, base_price: 500 } }))!.source, 'csfloat_base');
assert.equal(
  appraise(listing({ reference: { predicted_price: 0, base_price: 0 }, item: { scm: { price: 700 } } }))!.source,
  'steam_scm'
);
assert.equal(appraise(listing({ reference: { predicted_price: 0, base_price: 0 } })), undefined);

// float_factor приоритетнее разности (predicted - base)
const a = appraise(listing({ reference: { base_price: 1000, predicted_price: 1200, float_factor: 50 } }))!;
assert.equal(a.factorUsd, 0.5, 'float_factor должен побеждать (predicted - base)');
assert.equal(a.finalUsd, 12);

// --- классификация типов ---
assert.equal(getItemType('AK-47 | Redline'), 'rifles');
assert.equal(getItemType('★ Karambit | Doppler'), 'knives');
assert.equal(getItemType('Sticker | Titan (Holo) | Katowice 2014'), 'stickers');
assert.equal(getItemType('Music Kit | Darude'), 'music');
assert.equal(getItemType('Sport Gloves | Pandora'), 'gloves');
assert.equal(getItemType(''), 'other');

// Настоящие имена из Steam: у перчаток и ножей есть ★, у оружия — StatTrak™/Souvenir.
assert.equal(getItemType('★ Sport Gloves | Vice (Field-Tested)'), 'gloves', 'перчатки с ★ — не ножи');
assert.equal(getItemType('★ Hand Wraps | Slaughter (Minimal Wear)'), 'gloves');
assert.equal(getItemType('★ Karambit | Doppler (Factory New)'), 'knives');
assert.equal(getItemType('★ StatTrak™ Karambit | Doppler (Factory New)'), 'knives');
assert.equal(getItemType('StatTrak™ AK-47 | Redline (Field-Tested)'), 'rifles', 'StatTrak™ не должен уходить в «другое»');
assert.equal(getItemType('StatTrak™ USP-S | Kill Confirmed (Minimal Wear)'), 'pistols');
assert.equal(getItemType('Souvenir AWP | Dragon Lore (Factory New)'), 'rifles');
assert.equal(getItemType('StatTrak™ Music Kit | Skog, III-Arena'), 'music');
assert.equal(getItemType('XM1014 | Tranquility (Factory New)'), 'shotguns');
assert.equal(getItemType('Zeus x27 | Olympus (Factory New)'), 'other');

// --- наклейки ---
const withStickers = listing({
  price: 1100,
  reference: { base_price: 1000, predicted_price: 1000, float_factor: 0 },
  item: { market_hash_name: 'AK-47 | Redline', stickers: [{ reference: { price: 400 } }] }
});
const sp = stickerPremium(withStickers)!;
assert.equal(sp.stickerSumUsd, 4);
assert.equal(sp.fairPremiumUsd, 0.6, 'наклейка $4 → capRate 0.15 → справедливо $0.60');
assert.equal(sp.actualPaidUsd, 1, 'доплата = $11.00 − $10.00');
assert.equal(sp.overpayRatio, 1 / 0.6);

// Премия больше стоимости наклеек — это недооценка базы, а не переплата за стикеры.
const fadeLike = listing({
  price: 5000,
  reference: { base_price: 1000, predicted_price: 1000, float_factor: 0 },
  item: { market_hash_name: 'AK-47 | Redline', stickers: [{ reference: { price: 100 } }] }
});
assert.equal(stickerPremium(fadeLike)!.overpayRatio, null, 'не вешаем недооценку базы на стикеры');

// --- фильтр: счастливый путь ---
const ok = evaluate(listing({ price: 900 }), settings(), NOW);
assert.equal(ok.ok, true);
if (ok.ok) {
  assert.equal(ok.deal.priceUsd, 9);
  assert.equal(ok.deal.referenceUsd, 10);
  assert.equal(ok.deal.discountPercent, 10);
  assert.equal(ok.deal.profitUsd, 1);
  assert.equal(ok.deal.referenceSource, 'csfloat_predicted');
  assert.equal(ok.deal.url, 'https://csfloat.com/item/abc123');
  assert.ok(ok.deal.ageSeconds > 19 && ok.deal.ageSeconds < 21);
}

// --- фильтр: отказы ---
const rejects: Array<[string, ReturnType<typeof evaluate>]> = [
  ['аукцион', evaluate(listing({ type: 'auction' }), settings(), NOW)],
  ['не listed', evaluate(listing({ state: 'sold' }), settings(), NOW)],
  ['старый листинг', evaluate(listing({ created_at: new Date(NOW - 5 * 60_000).toISOString() }), settings(), NOW)],
  ['мало скидки', evaluate(listing({ price: 980 }), settings(), NOW)],
  ['цена выше диапазона', evaluate(listing({ price: 900 }), settings({ price: { minUsd: 20, maxUsd: 50 } }), NOW)],
  ['тип отключён', evaluate(listing(), settings({ types: { ...DEFAULT_SETTINGS.types, rifles: false } }), NOW)],
  ['нет референса', evaluate(listing({ reference: { base_price: 0, predicted_price: 0 } }), settings(), NOW)],
  ['мало трейдов', evaluate(
    listing({ seller: { username: 's', statistics: { total_trades: 1 } } }),
    settings({ listing: { ...DEFAULT_SETTINGS.listing, minSellerTrades: 10 } }), NOW)],
  ['низкая ликвидность', evaluate(
    listing({ reference: { base_price: 1000, predicted_price: 1000, quantity: 2 } }),
    settings({ listing: { ...DEFAULT_SETTINGS.listing, minLiquidity: 20 } }), NOW)]
];
for (const [label, r] of rejects) {
  assert.equal(r.ok, false, `должно отклоняться: ${label}`);
}

// float premium: 15% при пороге 10%
const fatFloat = evaluate(
  listing({ price: 900, reference: { base_price: 1000, predicted_price: 1150, float_factor: 150 } }),
  settings(), NOW
);
assert.equal(fatFloat.ok, false, 'float premium 15% должен отсекаться порогом 10%');

// тот же лот при выключенном фильтре премии — проходит
const fatFloatOff = evaluate(
  listing({ price: 900, reference: { base_price: 1000, predicted_price: 1150, float_factor: 150 } }),
  settings({ premium: { maxFloatPercent: 0, stickerStrictness: 0 } }), NOW
);
assert.equal(fatFloatOff.ok, true, 'при выключенном фильтре премии лот должен проходить');

// минимальная абсолютная выгода
const smallProfit = evaluate(
  listing({ price: 900 }),
  settings({ discount: { minPercent: 0, minProfitUsd: 5 } }), NOW
);
assert.equal(smallProfit.ok, false, 'выгода $1 не должна проходить порог $5');

// акцент: следим за одним предметом
const accentMiss = evaluate(listing(), settings({ accentMarketHashName: 'AWP | Asiimov' }), NOW);
assert.equal(accentMiss.ok, false, 'акцент должен отсекать чужие предметы');

// листинг без цены не должен превращаться в «сделку» с ценой NaN
const noPrice = evaluate(listing({ price: undefined }), settings(), NOW);
assert.equal(noPrice.ok, false, 'листинг без цены должен отклоняться');
if (!noPrice.ok) assert.equal(noPrice.code, 'bad_data');

// StatTrak-оружие проходит под переключателем своей категории
const stRedline = evaluate(listing({ item: { market_hash_name: 'StatTrak™ AK-47 | Redline (Field-Tested)' } }), settings(), NOW);
assert.equal(stRedline.ok, true, 'StatTrak™ AK-47 должен проходить при включённых винтовках');
const glovesOff = evaluate(
  listing({ item: { market_hash_name: '★ Sport Gloves | Vice (Field-Tested)' } }),
  settings({ types: { ...DEFAULT_SETTINGS.types, knives: true, gloves: false } }), NOW
);
assert.equal(glovesOff.ok, false, 'перчатки подчиняются своему переключателю, а не ножам');

// --- валидация настроек ---
assert.deepEqual(validateSettings(DEFAULT_SETTINGS), []);
assert.ok(validateSettings(settings({ poll: { intervalMs: 500, limit: 50 } })).length > 0, 'слишком частый опрос');
assert.ok(validateSettings(settings({ price: { minUsd: 100, maxUsd: 10 } })).length > 0, 'перевёрнутый диапазон');

console.log('OK: engine/filter.check.ts — все проверки прошли');
