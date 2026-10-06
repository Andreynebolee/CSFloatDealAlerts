// Buy orders CSFloat — единственный способ реально забрать лот.
//
// Важно понимать, что это НЕ покупка того листинга, который пришёл в алерте.
// Это постоянный ордер на стороне CSFloat: «купи такую вещь за ≤ max_price».
// CSFloat исполняет его сам, мгновенно, когда появится подходящий листинг.
// Поэтому ордер выигрывает гонку, которую человек с мышкой проигрывает всегда:
// пока пришло уведомление и пока он кликнул, лот уже забрали.
//
// Ордер ставится ключом самого пользователя и списывает деньги с ЕГО баланса
// CSFloat. Прямой выкуп (POST /listings/buy) сюда намеренно не перенесён:
// эндпоинт недокументированный и может отвалиться без предупреждения.

const BASE = 'https://csfloat.com/api/v1';
const TIMEOUT_MS = 15_000;

export interface BuyOrder {
  id: string;
  market_hash_name?: string;
  /** Цена в центах. */
  price: number;
  qty: number;
  created_at?: string;
}

export interface OrdersResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

async function request<T>(
  apiKey: string,
  method: string,
  path: string,
  body?: unknown
): Promise<OrdersResult<T>> {
  try {
    const resp = await fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });

    const text = await resp.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      // тело может быть пустым — это нормально для DELETE
    }

    if (!resp.ok) {
      const msg = json?.message || json?.error || `HTTP ${resp.status}`;
      return { ok: false, status: resp.status, error: String(msg) };
    }
    return { ok: true, status: resp.status, data: json as T };
  } catch (e: any) {
    const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    return { ok: false, status: 0, error: timedOut ? 'таймаут запроса' : String(e?.message || e) };
  }
}

/** Поставить ордер: купить qty шт. предмета по цене ≤ maxPriceCents. */
export function createBuyOrder(
  apiKey: string,
  marketHashName: string,
  maxPriceCents: number,
  qty = 1
): Promise<OrdersResult<BuyOrder>> {
  return request<BuyOrder>(apiKey, 'POST', '/buy-orders', {
    market_hash_name: marketHashName,
    max_price: Math.max(1, Math.round(maxPriceCents)),
    quantity: Math.max(1, Math.floor(qty))
  });
}

/** Активные ордера пользователя. */
export async function listBuyOrders(apiKey: string, limit = 50): Promise<OrdersResult<BuyOrder[]>> {
  const r = await request<{ orders: BuyOrder[] }>(
    apiKey,
    'GET',
    `/me/buy-orders?page=0&limit=${Math.max(1, Math.min(100, limit))}`
  );
  if (!r.ok) return { ok: false, status: r.status, error: r.error };
  return { ok: true, status: r.status, data: Array.isArray(r.data?.orders) ? r.data!.orders : [] };
}

/** Снять ордер. */
export function deleteBuyOrder(apiKey: string, orderId: string): Promise<OrdersResult<unknown>> {
  return request(apiKey, 'DELETE', `/buy-orders/${encodeURIComponent(orderId)}`);
}

/**
 * Прямой выкуп ИМЕННО того лота, который пришёл в алерте.
 * Либо покупает немедленно, либо падает, если лот уже ушёл или подорожал.
 *
 * ВНИМАНИЕ: эндпоинт недокументированный. CSFloat может изменить или закрыть
 * его без предупреждения — тогда режим перестанет работать, а приложение
 * покажет ошибку. Документированной альтернативы для «купи вот этот лот» нет.
 *
 * totalPriceCents обязан точно совпадать с суммой цен выкупаемых лотов —
 * это защита сервера от рассинхрона: переплатить он не даст.
 */
export function buyListingNow(
  apiKey: string,
  listingId: string,
  totalPriceCents: number
): Promise<OrdersResult<{ id?: string }>> {
  const id = String(listingId || '').trim();
  if (!id) return Promise.resolve({ ok: false, status: 0, error: 'пустой id лота' });

  return request<{ id?: string }>(apiKey, 'POST', '/listings/buy', {
    total_price: Math.max(1, Math.round(totalPriceCents)),
    contract_ids: [id]
  });
}
