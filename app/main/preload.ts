// Единственный мост между окном и движком. contextIsolation включён,
// нода в рендерер не пробрасывается — только вот эти функции.

import { contextBridge, ipcRenderer } from 'electron';

const api = {
  /** Нативные кнопки окна рисуются поверх страницы — интерфейсу нужно оставить для них место. */
  overlay: process.platform === 'win32',

  getState: () => ipcRenderer.invoke('state:get'),

  saveSettings: (settings: unknown) => ipcRenderer.invoke('settings:save', settings),
  savePrefs: (prefs: unknown) => ipcRenderer.invoke('prefs:save', prefs),

  setApiKey: (key: string) => ipcRenderer.invoke('key:set', key),

  start: () => ipcRenderer.invoke('engine:start'),
  stop: () => ipcRenderer.invoke('engine:stop'),

  openItem: (url: string) => ipcRenderer.invoke('item:open', url),
  openSupport: () => ipcRenderer.invoke('support:open'),
  telegramTest: (token: string, chatId: string) => ipcRenderer.invoke('telegram:test', token, chatId),

  savePreset: (name: string) => ipcRenderer.invoke('presets:save', name),
  deletePreset: (id: string) => ipcRenderer.invoke('presets:delete', id),

  ordersList: () => ipcRenderer.invoke('orders:list'),
  ordersDelete: (orderId: string) => ipcRenderer.invoke('orders:delete', orderId),
  onJournalChanged: (cb: (payload: unknown) => void) => {
    const handler = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on('journal-changed', handler);
    return () => ipcRenderer.off('journal-changed', handler);
  },
  onAutoBuy: (cb: (event: unknown) => void) => {
    const handler = (_e: unknown, event: unknown) => cb(event);
    ipcRenderer.on('autobuy', handler);
    return () => ipcRenderer.off('autobuy', handler);
  },

  journalList: () => ipcRenderer.invoke('journal:list'),
  journalAdd: (entry: unknown) => ipcRenderer.invoke('journal:add', entry),
  journalSell: (id: string, sellPriceUsd: number | null) =>
    ipcRenderer.invoke('journal:sell', id, sellPriceUsd),
  journalDelete: (id: string) => ipcRenderer.invoke('journal:delete', id),
  journalExport: () => ipcRenderer.invoke('journal:export'),

  dryRun: (settings: unknown, windowMinutes: number) =>
    ipcRenderer.invoke('dryrun:run', settings, windowMinutes),
  onDryRunProgress: (cb: (p: unknown) => void) => {
    const handler = (_e: unknown, p: unknown) => cb(p);
    ipcRenderer.on('dryrun-progress', handler);
    return () => ipcRenderer.off('dryrun-progress', handler);
  },

  onDeal: (cb: (deal: unknown) => void) => {
    const handler = (_e: unknown, deal: unknown) => cb(deal);
    ipcRenderer.on('deal', handler);
    return () => ipcRenderer.off('deal', handler);
  },
  onStats: (cb: (stats: unknown) => void) => {
    const handler = (_e: unknown, stats: unknown) => cb(stats);
    ipcRenderer.on('stats', handler);
    return () => ipcRenderer.off('stats', handler);
  },
  onError: (cb: (message: string, fatal: boolean) => void) => {
    const handler = (_e: unknown, message: string, fatal: boolean) => cb(message, fatal);
    ipcRenderer.on('engine-error', handler);
    return () => ipcRenderer.off('engine-error', handler);
  }
};

contextBridge.exposeInMainWorld('api', api);

export type RendererApi = typeof api;
