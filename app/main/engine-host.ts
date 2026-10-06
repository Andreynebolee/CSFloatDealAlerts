// Обёртка движка для приложения: хранит настройки и ключ, ведёт журнал сделок,
// транслирует события в окно. Сам движок про Electron по-прежнему не знает.

import { appendFileSync, existsSync, readFileSync } from 'fs';
import { writeFileAtomic } from '../engine/atomic';
import { DealEngine, EngineStats } from '../engine';
import { Deal } from '../engine/types';
import { loadSettings, saveSettings, Settings, validateSettings } from '../engine/settings';

/** Сколько последних сделок держим в памяти для мгновенной отрисовки окна. */
const RECENT_LIMIT = 200;

/** Файл сделок только растёт; когда строк становится в разы больше нужного, режем до последних. */
const COMPACT_AFTER_LINES = RECENT_LIMIT * 10;

export interface HostEvents {
  onDeal: (deal: Deal) => void;
  onStats: (stats: EngineStats) => void;
  onError: (message: string, fatal: boolean) => void;
}

export class EngineHost {
  private engine: DealEngine | null = null;
  private settings: Settings;
  private apiKey = '';
  private recent: Deal[] = [];

  constructor(
    private settingsFile: string,
    private dealsFile: string,
    private events: HostEvents
  ) {
    this.settings = loadSettings(settingsFile);
    this.recent = this.readRecentDeals();
  }

  getSettings(): Settings {
    return this.settings;
  }

  getRecentDeals(): Deal[] {
    return this.recent;
  }

  /**
   * Меняет ключ. Работающий мониторинг останавливаем: движок держит ключ в
   * конструкторе, а просто выбросить ссылку на него нельзя — поллер остался бы
   * жить без владельца, продолжал опрашивать со старым ключом, а следующий
   * «Запустить» поднял бы второй поток запросов на тот же ключ.
   * Возвращает true, если мониторинг шёл и его нужно перезапустить.
   */
  setApiKey(key: string): boolean {
    const wasRunning = this.isRunning();
    this.stop();
    this.apiKey = key;
    return wasRunning;
  }

  hasApiKey(): boolean {
    return this.apiKey.length > 0;
  }

  /**
   * Настройки применяются на лету, поэтому проверять их только при старте
   * мало: мониторинг может идти сутками, а правки прилетают в работающий
   * движок. Битые настройки не сохраняем и возвращаем причины в окно.
   */
  updateSettings(patch: Settings): string[] {
    const problems = validateSettings(patch);
    if (problems.length > 0) return problems;

    this.settings = patch;
    saveSettings(this.settingsFile, patch);
    this.engine?.updateSettings(patch);
    return [];
  }

  isRunning(): boolean {
    return this.engine?.isRunning ?? false;
  }

  getStats(): EngineStats | null {
    return this.engine?.getStats() ?? null;
  }

  start(): string[] {
    if (this.isRunning()) return [];
    if (!this.apiKey) return ['Не задан API-ключ CSFloat'];

    const engine = new DealEngine(this.apiKey, this.settings);
    engine.on('deal', (deal) => {
      this.remember(deal);
      this.events.onDeal(deal);
    });
    engine.on('stats', (stats) => this.events.onStats(stats));
    engine.on('error', (message, fatal) => this.events.onError(message, fatal));

    const problems = engine.start();
    if (problems.length > 0) return problems;

    this.engine = engine;
    return [];
  }

  stop(): void {
    this.engine?.stop();
    this.engine = null;
  }

  private remember(deal: Deal): void {
    this.recent.unshift(deal);
    if (this.recent.length > RECENT_LIMIT) this.recent.length = RECENT_LIMIT;
    try {
      appendFileSync(this.dealsFile, JSON.stringify(deal) + '\n', 'utf8');
    } catch (e) {
      console.error('Не удалось записать сделку в журнал:', e);
    }
  }

  /** Последние сделки из журнала — чтобы окно не открывалось пустым. */
  private readRecentDeals(): Deal[] {
    if (!existsSync(this.dealsFile)) return [];
    try {
      const lines = readFileSync(this.dealsFile, 'utf8').trim().split('\n');
      if (lines.length > COMPACT_AFTER_LINES) {
        // Раньше файл рос без предела и целиком читался при каждом запуске.
        writeFileAtomic(this.dealsFile, lines.slice(-RECENT_LIMIT).join('\n') + '\n');
      }
      return lines
        .slice(-RECENT_LIMIT)
        .map((line) => {
          try {
            return JSON.parse(line) as Deal;
          } catch {
            return null;
          }
        })
        .filter((d): d is Deal => d !== null)
        .reverse();
    } catch {
      return [];
    }
  }
}
