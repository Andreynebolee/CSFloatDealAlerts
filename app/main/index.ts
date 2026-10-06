// Точка входа приложения: окно, трей, IPC. Вся логика поиска — в app/engine.

import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, shell, Tray, nativeImage } from 'electron';
import { join } from 'path';
import { writeFileSync } from 'fs';
import { EngineHost } from './engine-host';
import { AppPrefs, DEFAULT_PREFS, loadPrefs, savePrefs } from './prefs';
import { assetFile, autobuyPath, dealsPath, journalPath, prefsPath, presetsPath, rendererFile, secretsPath, settingsPath } from './paths';
import { canPlace, loadState, recordPlaced, saveState } from './autobuy';
import { buyListingNow, createBuyOrder, deleteBuyOrder, listBuyOrders } from '../engine/orders';
import { computeStats, JournalEntry, loadJournal, newId, saveJournal, toCsv } from './journal';
import { isEncryptionAvailable, maskApiKey, readApiKey, writeApiKey } from './secrets';
import { Settings, validateSettings } from '../engine/settings';
import { fetchHistory } from '../engine/history';
import { analyze } from '../engine/dryrun';
import { BUILTIN_PRESETS, loadCustomPresets, pickFilters, Preset, saveCustomPresets } from '../engine/presets';
import { Deal } from '../engine/types';
import { isSafeHttpsUrl, SUPPORT_URL } from './links';
import { sendTelegramMessage, TelegramNotifier } from './telegram';

let win: BrowserWindow | null = null;
let itemWin: BrowserWindow | null = null;
let tray: Tray | null = null;
let host: EngineHost;
let telegram: TelegramNotifier;
let prefs: AppPrefs = { ...DEFAULT_PREFS };
let quitting = false;
let dryRunBusy = false;

// Потолки прогона по истории: 20 страниц по 50 — до 1000 листингов,
// с паузой между страницами, чтобы не словить 429 на домашнем ключе.
const DRY_RUN_MAX_PAGES = 20;
const DRY_RUN_SPACING_MS = 1200;


function send(channel: string, ...args: unknown[]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

function notifyDeal(deal: Deal): void {
  if (!prefs.notifications || !Notification.isSupported()) return;
  const n = new Notification({
    title: `−${deal.discountPercent.toFixed(0)}% · $${deal.priceUsd.toFixed(2)}`,
    body: `${deal.name}\nвыгода $${deal.profitUsd.toFixed(2)} от $${deal.referenceUsd.toFixed(2)}`,
    icon: assetFile('icon.png'),
    silent: !prefs.sound
  });
  // Клик по уведомлению открывает лот — ради этого всё и затевалось.
  n.on('click', () => openItem(deal.url));
  n.show();
}

function openItem(url: string): void {
  // Открываем только лоты CSFloat. Ссылка приходит из окна, а в журнале она
  // могла быть отредактирована руками в journal.json — отдавать что попало
  // в shell.openExternal нельзя, на Windows это запуск внешних программ.
  if (!/^https:\/\/csfloat\.com\//.test(url)) {
    console.warn('Отклонена ссылка не на CSFloat:', url);
    return;
  }
  if (!prefs.openInApp) {
    void shell.openExternal(url);
    return;
  }
  // Отдельное окно с общей сессией: логин на CSFloat сохраняется,
  // поэтому покупка — в один клик, не выходя из приложения.
  if (itemWin && !itemWin.isDestroyed()) {
    itemWin.loadURL(url);
    itemWin.focus();
    return;
  }
  itemWin = new BrowserWindow({
    width: 1100,
    height: 860,
    icon: assetFile('icon.png'),
    title: 'CSFloat',
    autoHideMenuBar: true,
    webPreferences: { partition: 'persist:csfloat', contextIsolation: true, nodeIntegration: false }
  });
  itemWin.on('closed', () => { itemWin = null; });
  void itemWin.loadURL(url);
}

function buildTrayMenu(): Menu {
  const running = host.isRunning();
  return Menu.buildFromTemplate([
    { label: running ? '● Мониторинг идёт' : '○ Остановлен', enabled: false },
    { type: 'separator' },
    {
      label: running ? 'Остановить' : 'Запустить',
      click: () => {
        if (running) {
          host.stop();
        } else {
          const problems = host.start();
          if (problems.length > 0) send('engine-error', problems.join('; '), false);
        }
        refreshTray();
        send('stats', host.getStats());
      }
    },
    { label: 'Открыть окно', click: () => showWindow() },
    { type: 'separator' },
    { label: 'Выход', click: () => { quitting = true; app.quit(); } }
  ]);
}

function refreshTray(): void {
  if (!tray) return;
  tray.setContextMenu(buildTrayMenu());
  tray.setToolTip(host.isRunning() ? 'CSFloat Deal Alerts — работает' : 'CSFloat Deal Alerts — остановлен');
}

function showWindow(): void {
  if (!win || win.isDestroyed()) {
    createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow(): void {
  win = new BrowserWindow({
    width: prefs.window.width,
    height: prefs.window.height,
    minWidth: 900,
    minHeight: 600,
    icon: assetFile('icon.png'),
    title: 'CSFloat Deal Alerts',
    backgroundColor: '#0a0712',
    autoHideMenuBar: true,
    // Своя тёмная шапка: системная белая полоса выбивалась из интерфейса.
    // Кнопки окна Windows остаются нативными и рисуются поверх (titleBarOverlay).
    ...(process.platform === 'win32'
      ? {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: { color: '#110b1f', symbolColor: '#bbb2da', height: 40 }
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.on('close', (e) => {
    if (!quitting && prefs.minimizeToTray) {
      e.preventDefault();
      win?.hide();
      return;
    }
    if (win && !win.isDestroyed()) {
      const [width, height] = win.getSize();
      prefs.window = { width, height };
      savePrefs(prefsPath(), prefs);
    }
  });

  // Внешние ссылки — всегда наружу, окно приложения не уводим.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  void win.loadFile(rendererFile('index.html'));
}

/**
 * Очередь автопокупок: строго по одной за раз.
 *
 * Движок отдаёт сделки пачкой, а maybeAutoBuy читает состояние лимитов из
 * файла, потом ждёт подтверждения и сеть, и только потом пишет обратно.
 * Без очереди две параллельные покупки прочитали бы один и тот же spentUsd,
 * обе прошли бы проверку дневного лимита и обе записали бы результат поверх
 * друг друга — лимит превышен, а одна из трат потеряна.
 */
let autoBuyQueue: Promise<void> = Promise.resolve();

function enqueueAutoBuy(deal: Deal): void {
  autoBuyQueue = autoBuyQueue
    .then(() => maybeAutoBuy(deal))
    .catch((e) => {
      console.error('Автопокупка сорвалась:', e);
      send('autobuy', { kind: 'failed', name: deal.name, reason: String(e?.message || e) });
    });
}

/**
 * Автопокупка по найденной сделке. Порядок намеренно такой:
 * сначала ограничители (они дешёвые и не тратят денег), потом согласие
 * пользователя, и только в самом конце сетевой вызов, который спишет деньги.
 */
async function maybeAutoBuy(deal: Deal): Promise<void> {
  const settings = host.getSettings();
  if (!settings.autoBuy.enabled) return;
  // Очередь может хранить сделки, найденные до нажатия «Стоп». Остановленный
  // мониторинг не должен ничего покупать.
  if (!host.isRunning()) return;

  const apiKey = readApiKey(secretsPath());
  if (!apiKey) return;

  const now = Date.now();
  const state = loadState(autobuyPath(), now);
  const verdict = canPlace(deal, settings.autoBuy, state, now);

  if (!verdict.ok) {
    send('autobuy', { kind: 'skipped', name: deal.name, reason: verdict.reason });
    return;
  }

  const direct = settings.autoBuy.mode === 'direct';
  const priceCents = Math.round(deal.priceUsd * 100);

  if (settings.autoBuy.confirmEach) {
    const { response } = await dialog.showMessageBox({
      type: 'question',
      buttons: [direct ? 'Выкупить' : 'Поставить ордер', 'Пропустить'],
      defaultId: 1,
      cancelId: 1,
      title: 'Автопокупка',
      message: direct
        ? `Выкупить «${deal.name}» за $${deal.priceUsd.toFixed(2)}?`
        : `Поставить ордер на «${deal.name}»?`,
      detail:
        `Оценка: $${deal.referenceUsd.toFixed(2)} (−${deal.discountPercent.toFixed(1)}%)\n` +
        (direct
          ? 'Деньги спишутся с вашего баланса CSFloat сразу.\n' +
            'Пока вы читаете это окно, лот могут забрать.\n\n'
          : `Ордер сработает на следующем таком лоте по цене ≤ $${deal.priceUsd.toFixed(2)}.\n\n`) +
        `Потрачено за сутки: $${state.spentUsd.toFixed(2)} из $${settings.autoBuy.dailyLimitUsd.toFixed(2)}.`
    });
    if (response !== 0) {
      send('autobuy', { kind: 'skipped', name: deal.name, reason: 'отменено вручную' });
      return;
    }
  }

  const res = direct
    ? await buyListingNow(apiKey, deal.id, priceCents)
    : await createBuyOrder(apiKey, deal.name, priceCents, 1);

  if (!res.ok) {
    send('autobuy', {
      kind: 'failed',
      name: deal.name,
      reason: res.error || `HTTP ${res.status}`,
      mode: settings.autoBuy.mode
    });
    return;
  }

  saveState(
    autobuyPath(),
    recordPlaced(
      state,
      {
        orderId: String((res.data as any)?.id ?? deal.id),
        name: deal.name,
        priceUsd: deal.priceUsd,
        placedAt: new Date(now).toISOString()
      },
      now
    )
  );

  // Прямой выкуп — это состоявшаяся покупка, ей место в журнале сразу.
  // Ордер туда не пишем: неизвестно, исполнится он вообще или нет.
  if (direct) {
    const entries = loadJournal(journalPath());
    entries.unshift({
      id: newId(),
      name: deal.name,
      boughtAt: new Date(now).toISOString(),
      buyPriceUsd: deal.priceUsd,
      referenceAtBuyUsd: deal.referenceUsd,
      floatValue: deal.floatValue,
      itemUrl: deal.url,
      source: 'alert',
      soldAt: null,
      sellPriceUsd: null,
      note: 'автопокупка'
    });
    saveJournal(journalPath(), entries);
    send('journal-changed', journalPayload());
  }

  send('autobuy', {
    kind: direct ? 'bought' : 'placed',
    name: deal.name,
    priceUsd: deal.priceUsd,
    mode: settings.autoBuy.mode
  });

  if (prefs.notifications && Notification.isSupported()) {
    new Notification({
      title: direct ? 'Куплено' : 'Ордер поставлен',
      body: `${deal.name} — $${deal.priceUsd.toFixed(2)}`,
      icon: assetFile('icon.png'),
      silent: !prefs.sound
    }).show();
  }
}

function journalPayload() {
  const entries = loadJournal(journalPath());
  return { journal: entries, journalStats: computeStats(entries) };
}

function allPresets(): Preset[] {
  return [...BUILTIN_PRESETS, ...loadCustomPresets(presetsPath())];
}

function currentState() {
  return {
    settings: host.getSettings(),
    prefs,
    presets: allPresets(),
    running: host.isRunning(),
    stats: host.getStats(),
    deals: host.getRecentDeals(),
    ...journalPayload(),
    apiKeyMask: maskApiKey(readApiKey(secretsPath())),
    encryptionAvailable: isEncryptionAvailable(),
    version: app.getVersion(),
    supportUrl: isSafeHttpsUrl(SUPPORT_URL) ? SUPPORT_URL : ''
  };
}

function registerIpc(): void {
  ipcMain.handle('state:get', () => currentState());

  ipcMain.handle('settings:save', (_e, settings: Settings) => {
    const problems = host.updateSettings(settings);
    return { ok: problems.length === 0, problems };
  });

  ipcMain.handle('prefs:save', (_e, patch: Partial<AppPrefs>) => {
    prefs = { ...prefs, ...patch };
    savePrefs(prefsPath(), prefs);
    app.setLoginItemSettings({ openAtLogin: prefs.autoStart });
    refreshTray();
    return { ok: true, prefs };
  });

  ipcMain.handle('key:set', (_e, key: string) => {
    writeApiKey(secretsPath(), key);
    const saved = readApiKey(secretsPath());
    const wasRunning = host.setApiKey(saved);
    // Мониторинг шёл — поднимаем его заново уже с новым ключом.
    if (wasRunning && saved) host.start();
    refreshTray();
    return { ok: true, apiKeyMask: maskApiKey(saved), running: host.isRunning() };
  });

  ipcMain.handle('engine:start', () => {
    const problems = host.start();
    refreshTray();
    return { ok: problems.length === 0, problems, running: host.isRunning() };
  });

  ipcMain.handle('engine:stop', () => {
    host.stop();
    refreshTray();
    return { ok: true, running: false };
  });

  ipcMain.handle('item:open', (_e, url: string) => {
    openItem(url);
    return { ok: true };
  });

  // Проверка связи: токен и chat id приходят прямо из формы, ещё не сохранённые.
  ipcMain.handle('telegram:test', async (_e, token: string, chatId: string) => {
    const t = String(token || '').trim();
    const c = String(chatId || '').trim();
    if (!t || !c) return { ok: false, problems: ['Укажите токен бота и chat id'] };
    const res = await sendTelegramMessage(t, c, '✅ CSFloat Deal Alerts: связь с Telegram работает.');
    return res.ok ? { ok: true, problems: [] } : { ok: false, problems: [res.error || 'Не удалось отправить'] };
  });

  // Адрес берётся из links.ts, а не из окна: рендерер не выбирает, что открывать.
  ipcMain.handle('support:open', () => {
    if (!isSafeHttpsUrl(SUPPORT_URL)) return { ok: false };
    void shell.openExternal(SUPPORT_URL);
    return { ok: true };
  });

  // Сохраняем текущие настройки как пользовательский пресет.
  ipcMain.handle('presets:save', (_e, name: string) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return { ok: false, problems: ['Пустое имя пресета'], presets: allPresets() };

    const custom = loadCustomPresets(presetsPath());
    const id = 'user-' + trimmed.toLowerCase().replace(/\s+/g, '-').slice(0, 40);
    const preset: Preset = {
      id,
      name: trimmed,
      hint: 'Ваш пресет',
      builtin: false,
      patch: pickFilters(host.getSettings())
    };

    const next = custom.filter((p) => p.id !== id).concat(preset);
    saveCustomPresets(presetsPath(), next);
    return { ok: true, problems: [], presets: allPresets() };
  });

  // Dry-run: выгружаем историю и судим её теми же настройками, что в форме.
  // Настройки приходят из окна несохранёнными — иначе нельзя проверить правку
  // до её применения, а в этом весь смысл.
  ipcMain.handle('dryrun:run', async (_e, settings: Settings, windowMinutes: number) => {
    if (dryRunBusy) return { ok: false, problems: ['Прогон уже идёт'] };

    const apiKey = readApiKey(secretsPath());
    if (!apiKey) return { ok: false, problems: ['Не задан API-ключ CSFloat'] };

    const problems = validateSettings(settings);
    if (problems.length > 0) return { ok: false, problems };

    dryRunBusy = true;
    try {
      const history = await fetchHistory(
        {
          apiKey,
          windowMinutes,
          limit: settings.poll.limit,
          maxPages: DRY_RUN_MAX_PAGES,
          spacingMs: DRY_RUN_SPACING_MS,
          minPriceUsd: settings.price.minUsd,
          maxPriceUsd: settings.price.maxUsd,
          marketHashName: settings.accentMarketHashName || undefined
        },
        (p) => send('dryrun-progress', p)
      );

      const result = analyze(history.listings, settings, windowMinutes, history.pages, history.note);
      return { ok: true, problems: [], result };
    } catch (e: any) {
      return { ok: false, problems: [e?.message || String(e)] };
    } finally {
      dryRunBusy = false;
    }
  });

  ipcMain.handle('presets:delete', (_e, id: string) => {
    const custom = loadCustomPresets(presetsPath()).filter((p) => p.id !== id);
    saveCustomPresets(presetsPath(), custom);
    return { ok: true, presets: allPresets() };
  });

  // Живые ордера тянем прямо с CSFloat: локальный журнал не знает,
  // какие из них уже исполнились или были сняты с сайта.
  ipcMain.handle('orders:list', async () => {
    const apiKey = readApiKey(secretsPath());
    if (!apiKey) return { ok: false, problems: ['Не задан API-ключ CSFloat'], orders: [] };

    const res = await listBuyOrders(apiKey, 50);
    if (!res.ok) return { ok: false, problems: [res.error || `HTTP ${res.status}`], orders: [] };

    const state = loadState(autobuyPath(), Date.now());
    return {
      ok: true,
      problems: [],
      orders: res.data ?? [],
      spentTodayUsd: state.spentUsd,
      dailyLimitUsd: host.getSettings().autoBuy.dailyLimitUsd
    };
  });

  ipcMain.handle('orders:delete', async (_e, orderId: string) => {
    const apiKey = readApiKey(secretsPath());
    if (!apiKey) return { ok: false, problems: ['Не задан API-ключ CSFloat'] };

    const res = await deleteBuyOrder(apiKey, orderId);
    if (!res.ok) return { ok: false, problems: [res.error || `HTTP ${res.status}`] };
    return { ok: true, problems: [] };
  });

  ipcMain.handle('journal:list', () => journalPayload());

  ipcMain.handle('journal:add', (_e, entry: Partial<JournalEntry>) => {
    const name = (entry.name || '').trim();
    const buyPriceUsd = Number(entry.buyPriceUsd);
    if (!name) return { ok: false, problems: ['Не задано название предмета'], ...journalPayload() };
    if (!Number.isFinite(buyPriceUsd) || buyPriceUsd < 0) {
      return { ok: false, problems: ['Цена покупки задана неверно'], ...journalPayload() };
    }

    const entries = loadJournal(journalPath());
    entries.unshift({
      id: newId(),
      name,
      boughtAt: entry.boughtAt || new Date().toISOString(),
      buyPriceUsd,
      referenceAtBuyUsd: Number.isFinite(Number(entry.referenceAtBuyUsd))
        ? Number(entry.referenceAtBuyUsd)
        : null,
      floatValue: Number.isFinite(Number(entry.floatValue)) ? Number(entry.floatValue) : null,
      itemUrl: entry.itemUrl || null,
      source: entry.source === 'manual' ? 'manual' : 'alert',
      soldAt: null,
      sellPriceUsd: null,
      note: entry.note || ''
    });
    saveJournal(journalPath(), entries);
    return { ok: true, problems: [], ...journalPayload() };
  });

  // Отметить проданным. null в цене возвращает позицию обратно в портфель.
  ipcMain.handle('journal:sell', (_e, id: string, sellPriceUsd: number | null) => {
    const entries = loadJournal(journalPath());
    const found = entries.find((e) => e.id === id);
    if (!found) return { ok: false, problems: ['Позиция не найдена'], ...journalPayload() };

    if (sellPriceUsd === null) {
      found.sellPriceUsd = null;
      found.soldAt = null;
    } else {
      const price = Number(sellPriceUsd);
      if (!Number.isFinite(price) || price < 0) {
        return { ok: false, problems: ['Цена продажи задана неверно'], ...journalPayload() };
      }
      found.sellPriceUsd = price;
      found.soldAt = new Date().toISOString();
    }

    saveJournal(journalPath(), entries);
    return { ok: true, problems: [], ...journalPayload() };
  });

  ipcMain.handle('journal:delete', (_e, id: string) => {
    saveJournal(journalPath(), loadJournal(journalPath()).filter((e) => e.id !== id));
    return { ok: true, problems: [], ...journalPayload() };
  });

  ipcMain.handle('journal:export', async () => {
    const entries = loadJournal(journalPath());
    if (entries.length === 0) return { ok: false, problems: ['Журнал пуст'] };

    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Экспорт журнала',
      defaultPath: `csfloat-journal-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    });
    if (canceled || !filePath) return { ok: false, problems: [] };

    writeFileSync(filePath, toCsv(entries), 'utf8');
    return { ok: true, problems: [], path: filePath };
  });
}

// Второй запуск не поднимает второй экземпляр — иначе два поллера на один ключ.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(() => {
    prefs = loadPrefs(prefsPath());

    host = new EngineHost(settingsPath(), dealsPath(), {
      onDeal: (deal) => {
        send('deal', deal);
        notifyDeal(deal);
        telegram.notify(deal);
        enqueueAutoBuy(deal);
      },
      onStats: (stats) => send('stats', stats),
      onError: (message, fatal) => {
        send('engine-error', message, fatal);
        if (fatal) refreshTray();
      }
    });
    host.setApiKey(readApiKey(secretsPath()));

    // Настройки Telegram читаются на каждой отправке — правка в окне действует сразу.
    telegram = new TelegramNotifier(
      () => host.getSettings().telegram,
      (message) => send('engine-error', message, false)
    );

    registerIpc();

    tray = new Tray(nativeImage.createFromPath(assetFile('tray.png')));
    refreshTray();
    tray.on('double-click', () => showWindow());

    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('before-quit', () => {
    quitting = true;
    host?.stop();
  });

  // Окно закрыли, но мы живём в трее — выходим только по явной команде.
  app.on('window-all-closed', () => {
    if (!prefs.minimizeToTray) app.quit();
  });
}
