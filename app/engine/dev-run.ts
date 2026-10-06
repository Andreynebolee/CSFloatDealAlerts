// Живой прогон движка из консоли — до того, как появится окно приложения.
//   CSFLOAT_API_KEY=xxx npx ts-node app/engine/dev-run.ts
// Печатает найденные сделки и, раз в 30с, сводку сколько просканировано.

import { DealEngine } from './index';
import { loadSettings, saveSettings } from './settings';

const SETTINGS_PATH = 'data/settings.json';

const apiKey = (process.env.CSFLOAT_API_KEY || '').trim();
if (!apiKey) {
  console.error('Не задан CSFLOAT_API_KEY. Пример: CSFLOAT_API_KEY=xxx npx ts-node app/engine/dev-run.ts');
  process.exit(1);
}

const settings = loadSettings(SETTINGS_PATH);
saveSettings(SETTINGS_PATH, settings); // создаём файл, чтобы было что править руками

const engine = new DealEngine(apiKey, settings);
const verbose = process.argv.includes('--verbose');

engine.on('deal', (d) => {
  console.log(
    `\n💰 ${d.name}\n` +
    `   $${d.priceUsd.toFixed(2)} · −${d.discountPercent.toFixed(1)}% от $${d.referenceUsd.toFixed(2)} (${d.referenceSource}) · выгода $${d.profitUsd.toFixed(2)}\n` +
    `   float ${d.floatValue ?? 'n/a'}${d.floatPremiumPercent !== null ? ` (премия ${d.floatPremiumPercent.toFixed(1)}%)` : ''} · ликвидность ${d.liquidity ?? 'n/a'} · возраст ${d.ageSeconds.toFixed(0)}с\n` +
    `   ${d.url}`
  );
});

if (verbose) engine.on('rejected', (name, reason) => console.log(`   ⏭ ${name}: ${reason}`));
engine.on('error', (msg, fatal) => console.error(`${fatal ? '❌' : '⚠️'} ${msg}`));

const problems = engine.start();
if (problems.length > 0) {
  console.error('Настройки не прошли проверку:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`▶ Движок запущен. Настройки: ${SETTINGS_PATH}. Ctrl+C — стоп.`);

const summary = setInterval(() => {
  const s = engine.getStats();
  const quota = s.quota ? `, квота ${s.quota.remaining}/${s.quota.limit}` : '';
  console.log(`… просканировано ${s.scanned}, сделок ${s.matched}, пауза ${s.delayMs}мс${quota}`);
}, 30_000);

process.on('SIGINT', () => {
  clearInterval(summary);
  engine.stop();
  const s = engine.getStats();
  console.log(`\n⏹ Остановлено. Просканировано ${s.scanned}, найдено ${s.matched}.`);
  process.exit(0);
});
