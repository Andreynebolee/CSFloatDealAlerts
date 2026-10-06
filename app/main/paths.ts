// Все файлы приложения живут в папке пользователя, а не рядом с exe:
// на Windows это %APPDATA%\csfloat-deal-alerts. Так они переживают обновление.

import { app } from 'electron';
import { join } from 'path';

// Собранный main лежит в dist/main, ресурсы — в app/. Два уровня вверх дают
// корень и в дев-режиме, и внутри asar после сборки.
const appRoot = join(__dirname, '..', '..');

export const userDataDir = (): string => app.getPath('userData');
export const settingsPath = (): string => join(userDataDir(), 'settings.json');
export const prefsPath = (): string => join(userDataDir(), 'prefs.json');
export const secretsPath = (): string => join(userDataDir(), 'secrets.bin');
export const dealsPath = (): string => join(userDataDir(), 'deals.jsonl');
export const presetsPath = (): string => join(userDataDir(), 'presets.json');
export const journalPath = (): string => join(userDataDir(), 'journal.json');
export const autobuyPath = (): string => join(userDataDir(), 'autobuy.json');

export const rendererFile = (name: string): string => join(appRoot, 'app', 'renderer', name);
export const assetFile = (name: string): string => join(appRoot, 'app', 'assets', name);
