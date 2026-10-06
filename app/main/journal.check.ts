// Runnable check: ts-node app/main/journal.check.ts
// Главное здесь — арифметика P&L. Ошибка в ней тихо врёт трейдеру о прибыли.

import { strict as assert } from 'assert';
import { computeStats, entryProfit, JournalEntry, toCsv } from './journal';

function entry(patch: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: 'x' + Math.random().toString(36).slice(2),
    name: 'AK-47 | Redline',
    boughtAt: '2026-09-01T10:00:00.000Z',
    buyPriceUsd: 10,
    referenceAtBuyUsd: 12,
    floatValue: 0.22,
    itemUrl: 'https://csfloat.com/item/1',
    source: 'alert',
    soldAt: null,
    sellPriceUsd: null,
    note: '',
    ...patch
  };
}

// --- прибыль считается только по проданному ---
// Купили на $30, продали одну позицию за $14 при себестоимости $10.
const mixed = [
  entry({ buyPriceUsd: 10, sellPriceUsd: 14, soldAt: '2026-09-02T10:00:00.000Z' }),
  entry({ buyPriceUsd: 10 }),
  entry({ buyPriceUsd: 10 })
];
const s = computeStats(mixed);

assert.equal(s.count, 3);
assert.equal(s.soldCount, 1);
assert.equal(s.openCount, 2);
assert.equal(s.investedUsd, 30);
assert.equal(s.holdingUsd, 20, 'себестоимость непроданного');
assert.equal(s.revenueUsd, 14);
assert.equal(s.costOfSoldUsd, 10);
assert.equal(s.realizedUsd, 4, 'прибыль = 14 − 10, а не 14 − 30');
assert.equal(Math.round(s.realizedPercent), 40);

// --- убыточная продажа ---
const loss = computeStats([entry({ buyPriceUsd: 20, sellPriceUsd: 15, soldAt: 'x' })]);
assert.equal(loss.realizedUsd, -5);
assert.equal(loss.realizedPercent, -25);

// --- пока ничего не продано, процент не делится на ноль ---
const nothingSold = computeStats([entry(), entry()]);
assert.equal(nothingSold.realizedUsd, 0);
assert.equal(nothingSold.realizedPercent, 0);
assert.equal(nothingSold.holdingUsd, 20);

// --- пустой журнал ---
const empty = computeStats([]);
assert.equal(empty.count, 0);
assert.equal(empty.investedUsd, 0);
assert.equal(empty.realizedPercent, 0);

// --- продажа в ноль считается продажей, а не «ещё не продано» ---
const zero = computeStats([entry({ buyPriceUsd: 5, sellPriceUsd: 0, soldAt: 'x' })]);
assert.equal(zero.soldCount, 1, 'sellPriceUsd = 0 это проданная позиция');
assert.equal(zero.realizedUsd, -5);

// --- прибыль по позиции ---
assert.equal(entryProfit(entry()), null, 'непроданная позиция прибыли не имеет');
assert.equal(entryProfit(entry({ buyPriceUsd: 10, sellPriceUsd: 13 })), 3);

// --- CSV ---
const csv = toCsv([entry({ name: 'AWP | Asiimov; тест', buyPriceUsd: 10, sellPriceUsd: 13, soldAt: 'x' })]);
assert.ok(csv.startsWith('﻿'), 'BOM нужен, иначе Excel ломает кириллицу');
assert.ok(csv.includes('"AWP | Asiimov; тест"'), 'точка с запятой в названии должна быть экранирована');
const dataRow = csv.split('\r\n')[1].split(';');
assert.equal(dataRow[dataRow.length - 4], '3.00', 'прибыль в CSV');
assert.equal(dataRow[dataRow.length - 3], '30.0', 'процент в CSV');

console.log('OK: main/journal.check.ts — все проверки прошли');
