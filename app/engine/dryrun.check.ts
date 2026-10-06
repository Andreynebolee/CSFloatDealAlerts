// Runnable check: node -r ts-node/register app/engine/dryrun.check.ts
// Главное, что здесь проверяется — виртуальное время. Без него dry-run по
// истории всегда возвращал бы ноль: любой вчерашний листинг «старше лимита».

import { strict as assert } from 'assert';
import { analyze, REJECT_LABELS } from './dryrun';
import { DEFAULT_SETTINGS, Settings } from './settings';
import { CsfloatListing } from './types';

function listing(patch: any = {}): CsfloatListing {
  const ageMinutes = patch.ageMinutes ?? 30;
  return {
    id: patch.id ?? 'id-' + Math.random().toString(36).slice(2),
    type: 'buy_now',
    state: 'listed',
    price: patch.price ?? 900,
    created_at: new Date(Date.now() - ageMinutes * 60_000).toISOString(),
    seller: { username: 'seller', statistics: { total_trades: patch.trades ?? 42 } },
    item: { market_hash_name: patch.name ?? 'AK-47 | Redline', float_value: 0.22 },
    reference: { base_price: 1000, predicted_price: 1000, float_factor: 0, quantity: 30 }
  } as CsfloatListing;
}

function settings(patch: any = {}): Settings {
  const s: Settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  return Object.assign(s, patch);
}

// --- виртуальное время: старый листинг судится как свежий ---
// Цена $9.00 против оценки $10.00 = скидка 10% > порога 8%.
const old = analyze([listing({ ageMinutes: 45 })], settings(), 60, 1, null);
assert.equal(old.matched, 1, 'листинг 45-минутной давности должен пройти: судим его по возрасту на момент появления');
assert.equal(old.scanned, 1);

// А в боевом режиме тот же листинг отсеялся бы по возрасту — проверяем,
// что фильтр возраста вообще жив и дело именно в виртуальном времени.
import { evaluate } from './filter';
const live = evaluate(listing({ ageMinutes: 45 }), settings());
assert.equal(live.ok, false);
assert.equal((live as any).code, 'age');

// --- гистограмма отказов ---
const mixed = analyze(
  [
    listing({ price: 900 }),                                    // проходит
    listing({ price: 999 }),                                    // скидка 0.1% → discount
    listing({ price: 995 }),                                    // скидка 0.5% → discount
    listing({ name: 'Music Kit | Darude' }),                    // тип отключён
    listing({ price: 50_000 })                                  // цена вне диапазона
  ],
  settings(),
  60,
  1,
  null
);

assert.equal(mixed.scanned, 5);
assert.equal(mixed.matched, 1);
assert.equal(mixed.buckets[0].code, 'discount', 'самый частый отказ должен быть первым');
assert.equal(mixed.buckets[0].count, 2);
assert.ok(mixed.buckets.some((b) => b.code === 'type'));
assert.ok(mixed.buckets.some((b) => b.code === 'price'));
assert.ok(mixed.buckets[0].sample.includes('%'), 'в примере причины должны быть числа');

// Сумма отказов и находок обязана сойтись со сканированным.
const rejected = mixed.buckets.reduce((sum, b) => sum + b.count, 0);
assert.equal(rejected + mixed.matched, mixed.scanned, 'ни один листинг не должен потеряться');

// --- сортировка находок по скидке ---
const sorted = analyze(
  [listing({ price: 900 }), listing({ price: 500 }), listing({ price: 800 })],
  settings(),
  60,
  1,
  null
);
assert.equal(sorted.matched, 3);
assert.deepEqual(
  sorted.deals.map((d) => d.priceUsd),
  [5, 8, 9],
  'находки идут от самой выгодной к наименее выгодной'
);

// --- пустой прогон не падает ---
const empty = analyze([], settings(), 60, 0, 'лента пуста');
assert.equal(empty.scanned, 0);
assert.equal(empty.matched, 0);
assert.equal(empty.coveredMinutes, 0);
assert.equal(empty.note, 'лента пуста');

// --- у каждого кода есть человекочитаемая подпись ---
for (const bucket of mixed.buckets) {
  assert.ok(REJECT_LABELS[bucket.code], `нет подписи для кода ${bucket.code}`);
  assert.equal(bucket.label, REJECT_LABELS[bucket.code]);
}

console.log('OK: engine/dryrun.check.ts — все проверки прошли');
