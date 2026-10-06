// Runnable check: ts-node app/main/autobuy.check.ts
// Здесь тратятся реальные деньги пользователя, поэтому каждый ограничитель
// проверяется отдельно: дыра в любом из них — это списание с чужого баланса.

import { strict as assert } from 'assert';
import {
  AutoBuyLimits,
  canPlace,
  dayKey,
  emptyState,
  recordPlaced,
  REPEAT_COOLDOWN_MS,
  rollover
} from './autobuy';

const NOW = Date.parse('2026-09-02T12:00:00.000Z');

const limits = (patch: Partial<AutoBuyLimits> = {}): AutoBuyLimits => ({
  enabled: true,
  maxOrderUsd: 20,
  dailyLimitUsd: 100,
  ...patch
});

const deal = (priceUsd: number, name = 'AK-47 | Redline') => ({ name, priceUsd });

// --- выключено по умолчанию: главный предохранитель ---
const off = canPlace(deal(5), limits({ enabled: false }), emptyState(NOW), NOW);
assert.equal(off.ok, false);
assert.match((off as any).reason, /выключена/);

// --- потолок на один ордер ---
assert.equal(canPlace(deal(19.99), limits(), emptyState(NOW), NOW).ok, true);
const tooBig = canPlace(deal(20.01), limits(), emptyState(NOW), NOW);
assert.equal(tooBig.ok, false);
assert.match((tooBig as any).reason, /превышает потолок/);

// --- дневной лимит: считается по сумме, а не по числу ордеров ---
let state = emptyState(NOW);
for (let i = 0; i < 5; i++) {
  const check = canPlace(deal(20, 'item' + i), limits(), state, NOW);
  assert.equal(check.ok, true, `ордер ${i + 1} должен проходить`);
  state = recordPlaced(state, {
    orderId: 'o' + i,
    name: 'item' + i,
    priceUsd: 20,
    placedAt: new Date(NOW).toISOString()
  }, NOW);
}
assert.equal(state.spentUsd, 100);

const overLimit = canPlace(deal(0.5, 'item9'), limits(), state, NOW);
assert.equal(overLimit.ok, false, 'после исчерпания лимита не проходит даже копеечный ордер');
assert.match((overLimit as any).reason, /дневной лимит/);

// --- ровно в лимит попасть можно, а на цент выше уже нет ---
const exact = emptyState(NOW);
exact.spentUsd = 90;
assert.equal(canPlace(deal(10, 'x'), limits(), exact, NOW).ok, true, '90 + 10 = ровно лимит');
assert.equal(canPlace(deal(10.01, 'x'), limits(), exact, NOW).ok, false);

// --- смена суток обнуляет счётчик ---
const tomorrow = NOW + 24 * 3600_000;
const rolled = rollover(state, tomorrow);
assert.equal(rolled.spentUsd, 0, 'новые сутки — новый лимит');
assert.equal(rolled.day, dayKey(tomorrow));
assert.equal(rolled.placed.length, 5, 'история постановок при этом не теряется');
assert.equal(canPlace(deal(20, 'item99'), limits(), state, tomorrow).ok, true);

// --- защита от повторов по одному предмету ---
const withOrder = recordPlaced(emptyState(NOW), {
  orderId: 'o1',
  name: 'AWP | Asiimov',
  priceUsd: 10,
  placedAt: new Date(NOW).toISOString()
}, NOW);

const repeat = canPlace(deal(10, 'AWP | Asiimov'), limits(), withOrder, NOW + 60_000);
assert.equal(repeat.ok, false);
assert.match((repeat as any).reason, /уже стоит/);

assert.equal(
  canPlace(deal(10, 'AWP | Asiimov'), limits(), withOrder, NOW + REPEAT_COOLDOWN_MS + 1000).ok,
  true,
  'после кулдауна повтор разрешён'
);
assert.equal(
  canPlace(deal(10, 'AK-47 | Redline'), limits(), withOrder, NOW + 60_000).ok,
  true,
  'кулдаун действует только на тот же предмет'
);

// --- битая цена не проходит ---
assert.equal(canPlace(deal(0), limits(), emptyState(NOW), NOW).ok, false);
assert.equal(canPlace(deal(-5), limits(), emptyState(NOW), NOW).ok, false);


// --- пачка сделок обрабатывается строго по одной ---
// Движок отдаёт находки пачкой. Пока покупки идут друг за другом (очередь
// autoBuyQueue в main/index.ts), суммарная трата упирается ровно в лимит.
// Параллельная обработка это ломала: все читали один и тот же spentUsd,
// проходили проверку и записывали результат поверх друг друга.
let batchState = emptyState(NOW);
let batchSpent = 0;
for (let i = 0; i < 10; i++) {
  const d = deal(20, `batch-${i}`);
  if (canPlace(d, limits(), batchState, NOW).ok) {
    batchState = recordPlaced(
      batchState,
      { orderId: `o${i}`, name: d.name, priceUsd: d.priceUsd, placedAt: new Date(NOW).toISOString() },
      NOW
    );
    batchSpent += d.priceUsd;
  }
}
assert.equal(batchSpent, 100, 'из десяти сделок по $20 при лимите $100 проходят ровно пять');
assert.equal(batchState.spentUsd, 100, 'счётчик трат не должен разъезжаться с фактом');
assert.equal(batchState.placed.length, 5);

console.log('OK: main/autobuy.check.ts — все проверки прошли');
