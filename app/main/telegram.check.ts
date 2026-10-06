// Runnable check: ts-node app/main/telegram.check.ts
// Настоящий Telegram не нужен: поднимаем свой маленький сервер и смотрим,
// что именно уходит на него и как приложение реагирует на ответы.

import { strict as assert } from 'assert';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { formatDealMessage, sendTelegramMessage, TelegramConfig, TelegramNotifier } from './telegram';
import { Deal } from '../engine/types';

const TOKEN = '123456:SECRET-bot-token';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const deal = (name: string, extra: Partial<Deal> = {}): Deal => ({
  id: 'id-' + name,
  foundAt: '2026-09-01T12:00:00.000Z',
  name,
  itemType: 'rifles',
  priceUsd: 18.4,
  referenceUsd: 21.7,
  referenceSource: 'csfloat_predicted',
  discountPercent: 15.2,
  profitUsd: 3.3,
  floatValue: 0.2384,
  floatPremiumPercent: 2.1,
  stickers: null,
  liquidity: 142,
  seller: { name: 'trader_77', trades: 318 },
  ageSeconds: 24,
  iconUrl: null,
  url: 'https://csfloat.com/item/abc',
  ...extra
});

interface Hit { url: string; body: any }

async function main(): Promise<void> {
  // --- сервер-заглушка: ответы берём из очереди сценария ---
  const hits: Hit[] = [];
  let script: Array<{ status: number; body: unknown; delayMs?: number }> = [];

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      hits.push({ url: req.url || '', body: JSON.parse(raw || '{}') });
      const step = script.shift() ?? { status: 200, body: { ok: true } };
      if (step.delayMs) await sleep(step.delayMs);
      res.writeHead(step.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(step.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const reset = (steps: typeof script = []) => { hits.length = 0; script = steps; };

  // --- формат: чужой текст не ломает разметку ---
  const msg = formatDealMessage(deal('AK-47 | <b>Hack</b> & Co', { seller: { name: 'a<b>&"x', trades: 5 } }));
  assert.ok(msg.includes('AK-47 | &lt;b&gt;Hack&lt;/b&gt; &amp; Co'), 'угловые скобки и & в названии экранируются');
  assert.ok(msg.includes('a&lt;b&gt;&amp;"x (5)'), 'ник продавца тоже экранируется');
  assert.ok(msg.includes('<b>−15.2%</b> · $18.40'), 'скидка и цена на месте');
  assert.ok(msg.includes('<a href="https://csfloat.com/item/abc">Открыть лот</a>'));
  const quote = formatDealMessage(deal('x', { url: 'https://csfloat.com/item/a"onclick="x' }));
  assert.ok(!quote.includes('"onclick'), 'кавычка в адресе не должна выходить из атрибута');

  // --- отправка: куда и что уходит ---
  reset();
  const ok = await sendTelegramMessage(TOKEN, '42', 'hello', { baseUrl });
  assert.equal(ok.ok, true);
  assert.equal(hits[0].url, `/bot${TOKEN}/sendMessage`);
  assert.equal(hits[0].body.chat_id, '42');
  assert.equal(hits[0].body.text, 'hello');
  assert.equal(hits[0].body.parse_mode, 'HTML');

  // --- понятные ошибки, и токена в них нет ---
  reset([{ status: 401, body: { ok: false, description: 'Unauthorized' } }]);
  const bad = await sendTelegramMessage(TOKEN, '42', 'x', { baseUrl });
  assert.equal(bad.ok, false);
  assert.match(bad.error!, /токен/);
  assert.ok(!bad.error!.includes('SECRET'), 'токен не должен попадать в текст ошибки');

  reset([{ status: 400, body: { ok: false, description: 'Bad Request: chat not found' } }]);
  assert.match((await sendTelegramMessage(TOKEN, '42', 'x', { baseUrl })).error!, /чат не найден/);

  // Недоступный адрес: ошибка сети тоже без токена.
  const net = await sendTelegramMessage(TOKEN, '42', 'x', { baseUrl: 'http://127.0.0.1:1' });
  assert.equal(net.ok, false);
  assert.ok(!net.error!.includes('SECRET'));

  // --- 429: ждём retry_after и пробуем ещё раз ---
  reset([
    { status: 429, body: { ok: false, description: 'Too Many Requests', parameters: { retry_after: 1 } } },
    { status: 200, body: { ok: true } }
  ]);
  const t0 = Date.now();
  const retried = await sendTelegramMessage(TOKEN, '42', 'x', { baseUrl });
  assert.equal(retried.ok, true, 'после паузы повтор проходит');
  assert.equal(hits.length, 2);
  assert.ok(Date.now() - t0 >= 900, 'пауза retry_after соблюдается');

  // --- очередь: выключено — молчим ---
  const cfg: TelegramConfig = { enabled: false, botToken: TOKEN, chatId: '42' };
  const errors: string[] = [];
  const notifier = new TelegramNotifier(() => cfg, (m) => errors.push(m), { baseUrl, spacingMs: 1 });

  reset();
  notifier.notify(deal('off'));
  await sleep(50);
  assert.equal(hits.length, 0, 'выключенный Telegram ничего не отправляет');

  // --- очередь: по порядку, по одной ---
  cfg.enabled = true;
  notifier.notify(deal('first'));
  notifier.notify(deal('second'));
  notifier.notify(deal('third'));
  await sleep(300);
  const texts = hits.map((h) => h.body.text as string);
  assert.equal(texts.length, 3);
  assert.ok(texts[0].includes('first') && texts[1].includes('second') && texts[2].includes('third'), 'порядок сохраняется');

  // --- очередь: переполнение отбрасывает самые старые ---
  reset([{ status: 200, body: { ok: true }, delayMs: 150 }]);
  const small = new TelegramNotifier(() => cfg, (m) => errors.push(m), { baseUrl, spacingMs: 1, maxQueue: 2 });
  small.notify(deal('d1'));     // уходит сразу и висит на сервере
  await sleep(30);
  for (const n of ['d2', 'd3', 'd4', 'd5']) small.notify(deal(n));
  await sleep(700);
  const kept = hits.map((h) => h.body.text as string);
  assert.equal(kept.length, 3, 'первая + две самые свежие');
  assert.ok(kept[0].includes('d1') && kept[1].includes('d4') && kept[2].includes('d5'), `оставлены d1, d4, d5, а не ${kept.join('|')}`);

  // --- очередь: одна и та же ошибка сообщается один раз ---
  errors.length = 0;
  reset([
    { status: 401, body: { ok: false, description: 'Unauthorized' } },
    { status: 401, body: { ok: false, description: 'Unauthorized' } },
    { status: 401, body: { ok: false, description: 'Unauthorized' } }
  ]);
  const noisy = new TelegramNotifier(() => cfg, (m) => errors.push(m), { baseUrl, spacingMs: 1 });
  noisy.notify(deal('e1'));
  noisy.notify(deal('e2'));
  noisy.notify(deal('e3'));
  await sleep(300);
  assert.equal(errors.length, 1, 'три одинаковые ошибки подряд — одно сообщение в окно');

  // --- тумблер выключили, пока сделка ждала в очереди ---
  reset([{ status: 200, body: { ok: true }, delayMs: 100 }]);
  const late = new TelegramNotifier(() => cfg, () => undefined, { baseUrl, spacingMs: 1 });
  late.notify(deal('l1'));
  await sleep(20);
  late.notify(deal('l2'));
  cfg.enabled = false;
  await sleep(300);
  assert.equal(hits.length, 1, 'после выключения ожидающие сообщения не уходят');

  server.close();
  console.log('OK: main/telegram.check.ts — все проверки прошли');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
