// Runnable check: ts-node app/engine/presets.check.ts
// Пресет не должен хранить и менять ничего, кроме фильтров поиска: иначе токен
// Telegram оседает в presets.json, а применение чужого пресета включает автопокупку.

import { strict as assert } from 'assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DEFAULT_SETTINGS, Settings } from './settings';
import { FILTER_KEYS, loadCustomPresets, pickFilters, Preset, saveCustomPresets } from './presets';

const settings: Settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
settings.autoBuy.enabled = true;
settings.telegram = { enabled: true, botToken: 'SECRET-TOKEN', chatId: '42' };
settings.accentMarketHashName = 'AK-47 | Redline (Field-Tested)';

// --- из настроек берутся только фильтры ---
const picked: any = pickFilters(settings);
assert.deepEqual(Object.keys(picked).sort(), [...FILTER_KEYS].sort());
assert.equal(picked.autoBuy, undefined, 'автопокупка не должна попадать в пресет');
assert.equal(picked.telegram, undefined, 'токен Telegram не должен попадать в пресет');
assert.equal(picked.poll, undefined, 'частота опроса не относится к фильтрам');
assert.equal(picked.accentMarketHashName, 'AK-47 | Redline (Field-Tested)');

// Копия, а не ссылка: правка настроек потом не должна менять сохранённый пресет.
settings.price.maxUsd = 999;
assert.notEqual(picked.price.maxUsd, 999);

// --- пресет старой версии (настройки целиком) очищается при загрузке ---
const dir = mkdtempSync(join(tmpdir(), 'presets-check-'));
try {
  const file = join(dir, 'presets.json');
  const legacy: Preset = {
    id: 'user-old',
    name: 'Старый',
    hint: 'Ваш пресет',
    builtin: false,
    patch: JSON.parse(JSON.stringify(settings))
  };
  writeFileSync(file, JSON.stringify([legacy]), 'utf8');
  assert.ok(readFileSync(file, 'utf8').includes('SECRET-TOKEN'));

  const loaded = loadCustomPresets(file);
  assert.equal(loaded.length, 1);
  const patch: any = loaded[0].patch;
  assert.equal(patch.autoBuy, undefined);
  assert.equal(patch.telegram, undefined);
  assert.equal(patch.price.maxUsd, 999, 'фильтры сохраняются как были');

  assert.ok(!readFileSync(file, 'utf8').includes('SECRET-TOKEN'), 'токен должен исчезнуть с диска');

  // Повторная загрузка ничего не ломает, чистый пресет остаётся как есть.
  saveCustomPresets(file, loaded);
  assert.deepEqual(loadCustomPresets(file), loaded);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('OK: engine/presets.check.ts — все проверки прошли');
