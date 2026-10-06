// API-ключ CSFloat. Шифруется средствами ОС (на Windows — DPAPI через
// safeStorage), поэтому файл нельзя просто скопировать на другую машину.
// Если шифрование недоступно — честно говорим об этом наверх, а не молча
// пишем ключ открытым текстом.

import { safeStorage } from 'electron';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import { writeFileAtomic } from '../engine/atomic';

const PLAIN_PREFIX = 'plain:';

export function isEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

export function readApiKey(path: string): string {
  if (!existsSync(path)) return '';
  try {
    const raw = readFileSync(path);
    const asText = raw.toString('utf8');
    if (asText.startsWith(PLAIN_PREFIX)) return asText.slice(PLAIN_PREFIX.length);
    if (!isEncryptionAvailable()) return '';
    return safeStorage.decryptString(raw);
  } catch (e) {
    console.error('Не удалось прочитать ключ:', e);
    return '';
  }
}

export function writeApiKey(path: string, key: string): void {
  const trimmed = key.trim();
  if (!trimmed) {
    if (existsSync(path)) unlinkSync(path);
    return;
  }
  if (isEncryptionAvailable()) {
    writeFileAtomic(path, safeStorage.encryptString(trimmed));
  } else {
    // Без keychain шифровать нечем. Пишем открыто, но UI показывает
    // предупреждение — молчаливая «псевдобезопасность» хуже честного текста.
    writeFileAtomic(path, PLAIN_PREFIX + trimmed);
  }
}

/** Для UI: ключ никогда не отдаём целиком, только хвост. */
export function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '•'.repeat(key.length);
  return '•'.repeat(key.length - 4) + key.slice(-4);
}
