// Runnable check: ts-node app/engine/atomic.check.ts
// Журнал сделок — единственная невосстановимая вещь в приложении: цены покупок
// нигде больше не хранятся. Обрубок файла не должен стирать его молча.

import { strict as assert } from 'assert';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFileAtomic } from './atomic';
import { JournalEntry, loadJournal, saveJournal } from '../main/journal';

const dir = mkdtempSync(join(tmpdir(), 'atomic-check-'));
try {
  // --- запись подменяет файл целиком и не оставляет временного ---
  const file = join(dir, 'data.json');
  writeFileAtomic(file, '{"v":1}');
  writeFileAtomic(file, '{"v":2}');
  assert.equal(readFileSync(file, 'utf8'), '{"v":2}');
  assert.ok(!existsSync(file + '.tmp'), 'временный файл не должен оставаться');

  // Бинарные данные (зашифрованный ключ) проходят без перекодирования.
  const bin = Buffer.from([0, 255, 128, 7, 200]);
  writeFileAtomic(join(dir, 'secret.bin'), bin);
  assert.ok(readFileSync(join(dir, 'secret.bin')).equals(bin));

  // --- повреждённый журнал: копия остаётся, пустой список не затирает её ---
  const journal = join(dir, 'journal.json');
  const entry = (name: string): JournalEntry => ({
    id: name, name, boughtAt: '2026-09-01T10:00:00.000Z', buyPriceUsd: 10, referenceAtBuyUsd: 12,
    floatValue: 0.2, itemUrl: null, source: 'manual', soldAt: null, sellPriceUsd: null, note: ''
  });
  saveJournal(journal, [entry('AK-47 | Redline'), entry('AWP | Asiimov')]);
  const good = readFileSync(journal, 'utf8');

  // Обрубок, как после сбоя посреди записи.
  writeFileSync(journal, good.slice(0, Math.floor(good.length / 2)), 'utf8');
  const truncated = readFileSync(journal, 'utf8');

  // Приложение пишет причину в консоль — в проверке этот шум не нужен.
  const realError = console.error;
  console.error = () => undefined;
  try {
    assert.deepEqual(loadJournal(journal), [], 'повреждённый файл читается как пустой журнал');
    loadJournal(journal);
    loadJournal(journal);
  } finally {
    console.error = realError;
  }

  const backups = readdirSync(dir).filter((f) => f.startsWith('journal.json.corrupt-'));
  assert.equal(backups.length, 1, 'копия делается один раз, а не на каждую загрузку');
  assert.equal(readFileSync(join(dir, backups[0]), 'utf8'), truncated, 'в копии — исходное содержимое');

  // Новое сохранение перезаписывает рабочий файл, но копия остаётся нетронутой.
  saveJournal(journal, [entry('M4A4 | Howl')]);
  assert.equal(loadJournal(journal).length, 1);
  assert.equal(readFileSync(join(dir, backups[0]), 'utf8'), truncated);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('OK: engine/atomic.check.ts — все проверки прошли');
