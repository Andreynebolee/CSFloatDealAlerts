// Безопасная запись файлов данных. writeFileSync пишет прямо поверх файла: если
// питание пропало или процесс убили посреди записи, остаётся обрубок, который
// не читается как JSON. Дальше загрузка возвращала пустой список, а следующее
// сохранение затирало обрубок — и вместе с ним всю историю сделок.

import { copyFileSync, existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { dirname } from 'path';

/** Пишем во временный файл рядом и подменяем целевой одним переименованием. */
export function writeFileAtomic(path: string, data: string | Buffer, encoding: BufferEncoding = 'utf8'): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  try {
    writeFileSync(tmp, data, typeof data === 'string' ? { encoding } : undefined);
    renameSync(tmp, path);
  } catch (e) {
    // Переименование поверх открытого файла (антивирус, индексатор) на Windows
    // иногда отказывает — тогда лучше обычная запись, чем потерянное сохранение.
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* уже нечего чистить */ }
    writeFileSync(path, data, typeof data === 'string' ? { encoding } : undefined);
  }
}

const backedUp = new Set<string>();

/**
 * Файл не разобрался — кладём его копию рядом, пока он не перезаписан.
 * Один раз на файл за запуск: загрузка идёт на каждый запрос окна, копий
 * иначе набралось бы по штуке на каждый клик.
 */
export function backupCorrupt(path: string): void {
  if (backedUp.has(path)) return;
  backedUp.add(path);
  try {
    copyFileSync(path, `${path}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  } catch (e) {
    console.error(`Не удалось сохранить копию повреждённого ${path}:`, e);
  }
}
