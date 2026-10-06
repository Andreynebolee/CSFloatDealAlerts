// Настройки самого приложения — отдельно от настроек поиска,
// чтобы движок не знал про окна, трей и уведомления.

import { existsSync, readFileSync } from 'fs';
import { backupCorrupt, writeFileAtomic } from '../engine/atomic';

export interface AppPrefs {
  /** Запускать вместе с Windows. */
  autoStart: boolean;
  /** Крестик сворачивает в трей, а не закрывает. */
  minimizeToTray: boolean;
  /** Системное уведомление на каждую сделку. */
  notifications: boolean;
  /** Звук при сделке. */
  sound: boolean;
  /** Открывать лот во встроенном окне, а не во внешнем браузере. */
  openInApp: boolean;
  window: { width: number; height: number };
}

export const DEFAULT_PREFS: AppPrefs = {
  autoStart: false,
  minimizeToTray: true,
  notifications: true,
  sound: true,
  openInApp: true,
  window: { width: 1180, height: 820 }
};

export function loadPrefs(path: string): AppPrefs {
  if (!existsSync(path)) return { ...DEFAULT_PREFS };
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(readFileSync(path, 'utf8')) };
  } catch {
    backupCorrupt(path);
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(path: string, prefs: AppPrefs): void {
  writeFileAtomic(path, JSON.stringify(prefs, null, 2));
}
