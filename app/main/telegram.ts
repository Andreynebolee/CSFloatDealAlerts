// Дубль алертов в Telegram через Bot API. Без Electron внутри, чтобы формат
// и отправку можно было прогнать проверкой на подменённом сервере.
//
// Токен бота — секрет: он входит в адрес запроса, поэтому его нельзя пускать
// ни в тексты ошибок, ни в логи.

import { Deal } from '../engine/types';

const API = 'https://api.telegram.org';
const TIMEOUT_MS = 15_000;
const MAX_RETRY_WAIT_MS = 30_000;

/** Telegram просит не чаще примерно одного сообщения в секунду в один чат. */
const DEFAULT_SPACING_MS = 1100;
/** Накопилось больше — самые старые выкидываем: лот двухминутной давности уже не сделка. */
const DEFAULT_MAX_QUEUE = 20;

export interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  chatId: string;
}

export interface SendResult {
  ok: boolean;
  error?: string;
}

export interface SendOptions {
  baseUrl?: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string) => escapeHtml(s).replace(/"/g, '&quot;');

export function formatDealMessage(deal: Deal): string {
  const meta: string[] = [];
  if (deal.floatValue !== null) meta.push(`float ${deal.floatValue.toFixed(4)}`);
  if (deal.liquidity !== null) meta.push(`ликв. ${deal.liquidity}`);
  meta.push(`${escapeHtml(deal.seller.name)} (${deal.seller.trades})`);

  return [
    `<b>−${deal.discountPercent.toFixed(1)}%</b> · $${deal.priceUsd.toFixed(2)} (выгода $${deal.profitUsd.toFixed(2)})`,
    escapeHtml(deal.name),
    `оценка $${deal.referenceUsd.toFixed(2)}`,
    meta.join(' · '),
    `<a href="${escapeAttr(deal.url)}">Открыть лот</a>`
  ].join('\n');
}

/** Понятное объяснение вместо сырого ответа API. */
function explain(status: number, description: unknown): string {
  const text = typeof description === 'string' ? description : '';
  if (status === 401) return 'Telegram: неверный токен бота';
  if (status === 403) return 'Telegram: бот заблокирован или не добавлен в чат';
  if (status === 400 && /chat not found/i.test(text)) {
    return 'Telegram: чат не найден — напишите боту /start или проверьте chat id';
  }
  return `Telegram: ${text || 'HTTP ' + status}`;
}

export async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
  opts: SendOptions = {}
): Promise<SendResult> {
  const base = opts.baseUrl ?? API;
  // Что бы ни случилось, токена в тексте ошибки быть не должно.
  const scrub = (s: string) => (token ? s.split(token).join('***') : s);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetch(`${base}/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true }
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });

      let body: any = null;
      try {
        body = await resp.json();
      } catch {
        // тело не JSON — судим по статусу
      }

      if (resp.ok && body?.ok !== false) return { ok: true };

      if (resp.status === 429 && attempt === 0) {
        const wait = Math.min((Number(body?.parameters?.retry_after) || 2) * 1000, MAX_RETRY_WAIT_MS);
        await sleep(wait);
        continue;
      }
      return { ok: false, error: scrub(explain(resp.status, body?.description)) };
    } catch (e: any) {
      return { ok: false, error: scrub(`Telegram: сеть — ${e?.message || e}`) };
    }
  }
  return { ok: false, error: 'Telegram: слишком частые запросы' };
}

export interface NotifierOptions {
  spacingMs?: number;
  maxQueue?: number;
  baseUrl?: string;
}

/**
 * Очередь отправки. Сделки приходят пачкой, а Telegram режет частоту, поэтому
 * шлём по одной с паузой. Сбой одной отправки не должен ронять остальные, а
 * одна и та же ошибка — заваливать окно уведомлениями на каждую сделку.
 */
export class TelegramNotifier {
  private queue: Deal[] = [];
  private busy = false;
  private lastError = '';

  constructor(
    private getConfig: () => TelegramConfig,
    private onError: (message: string) => void,
    private opts: NotifierOptions = {}
  ) {}

  notify(deal: Deal): void {
    const cfg = this.getConfig();
    if (!cfg.enabled || !cfg.botToken || !cfg.chatId) return;

    this.queue.push(deal);
    const max = this.opts.maxQueue ?? DEFAULT_MAX_QUEUE;
    while (this.queue.length > max) this.queue.shift();
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length > 0) {
        const deal = this.queue.shift()!;
        // Настройки читаем заново на каждой отправке: тумблер могли выключить, пока сделка ждала.
        const cfg = this.getConfig();
        if (!cfg.enabled || !cfg.botToken || !cfg.chatId) continue;

        const res = await sendTelegramMessage(cfg.botToken, cfg.chatId, formatDealMessage(deal), {
          baseUrl: this.opts.baseUrl
        });
        if (res.ok) {
          this.lastError = '';
        } else if (res.error && res.error !== this.lastError) {
          this.lastError = res.error;
          this.onError(res.error);
        }
        await sleep(this.opts.spacingMs ?? DEFAULT_SPACING_MS);
      }
    } finally {
      this.busy = false;
    }
  }
}
