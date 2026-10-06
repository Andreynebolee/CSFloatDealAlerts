// Runnable check: ts-node app/engine/feed.check.ts
// Сеть подменена: проверяем поведение поллера, а не CSFloat.

import { strict as assert } from 'assert';
import { ListingsFeed } from './feed';
import { CsfloatListing } from './types';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const realFetch = globalThis.fetch;

const listing = (id: string) => ({ id, type: 'buy_now', state: 'listed', price: 100 }) as unknown as CsfloatListing;
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

async function main(): Promise<void> {
  // --- «Стоп» во время запроса: пришедший позже ответ наверх не уходит ---
  {
    let release!: (r: Response) => void;
    globalThis.fetch = (() => new Promise<Response>((resolve) => { release = resolve; })) as typeof fetch;

    const got: CsfloatListing[][] = [];
    const feed = new ListingsFeed({ apiKey: 'k', intervalMs: 50, limit: 10 }, { onListings: (l) => got.push(l) });
    feed.start();
    await sleep(10);         // запрос ушёл и висит
    feed.stop();             // пользователь нажал «Стоп»
    release(json({ data: [listing('late-1')] }));
    await sleep(50);

    assert.equal(got.length, 0, 'после «Стоп» ответ запроса не должен превращаться в сделки (и автопокупку)');
  }

  // --- обычный путь: дедуп по id ---
  {
    const bodies = [[listing('a'), listing('b')], [listing('b'), listing('c')]];
    let n = 0;
    globalThis.fetch = (async () => json({ data: bodies[Math.min(n++, bodies.length - 1)] })) as typeof fetch;

    const got: string[] = [];
    const feed = new ListingsFeed({ apiKey: 'k', intervalMs: 20, limit: 10 }, { onListings: (l) => got.push(...l.map((x) => x.id)) });
    feed.start();
    await sleep(900);         // два тика с учётом джиттера до 500 мс
    feed.stop();

    assert.deepEqual(got.slice(0, 3), ['a', 'b', 'c'], 'повторный лот b не должен отдаваться дважды');
  }

  // --- настройки на лету доходят до следующего запроса ---
  {
    const urls: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => { urls.push(String(url)); return json({ data: [] }); }) as typeof fetch;

    const feed = new ListingsFeed(
      { apiKey: 'k', intervalMs: 20, limit: 10, minPriceUsd: 1, maxPriceUsd: 200 },
      { onListings: () => undefined }
    );
    feed.start();
    await sleep(60);
    assert.ok(urls[0].includes('max_price=20000'), 'старт с диапазоном до $200');

    feed.updateOptions({ maxPriceUsd: 500, marketHashName: 'AWP | Asiimov (Field-Tested)', limit: 25 });
    const before = urls.length;
    await sleep(900);
    feed.stop();

    const last = urls[urls.length - 1];
    assert.ok(urls.length > before, 'поллер продолжил работу');
    assert.ok(last.includes('max_price=50000'), 'новый потолок цены должен попасть в запрос без перезапуска');
    assert.ok(last.includes('market_hash_name=AWP'), 'акцентный предмет должен попасть в запрос без перезапуска');
    assert.ok(last.includes('limit=25'), 'размер страницы тоже');
  }

  globalThis.fetch = realFetch;
  console.log('OK: engine/feed.check.ts — все проверки прошли');
}

main().catch((e) => {
  globalThis.fetch = realFetch;
  console.error(e);
  process.exit(1);
});
