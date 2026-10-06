'use strict';
// Генератор иконок: рисуем PNG пикселями, чтобы не тащить в репозиторий бинарники
// и не заводить зависимость ради одной картинки. node scripts/make-icons.cjs

const { deflateSync } = require('zlib');
const { writeFileSync, mkdirSync } = require('fs');
const { join } = require('path');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y, size);
      raw[o++] = r; raw[o++] = g; raw[o++] = b; raw[o++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// Скруглённый квадрат цвета акцента + белая стрелка вверх (выгодная сделка).
const ACCENT = [34, 197, 94];

function inRoundedSquare(x, y, size) {
  const r = size * 0.22, pad = size * 0.06;
  const lo = pad, hi = size - pad;
  if (x < lo || x > hi || y < lo || y > hi) return false;
  const cx = Math.min(Math.max(x, lo + r), hi - r);
  const cy = Math.min(Math.max(y, lo + r), hi - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r || (x >= lo + r && x <= hi - r) || (y >= lo + r && y <= hi - r);
}

function inArrow(x, y, size) {
  const nx = x / size, ny = y / size;
  if (ny < 0.28 || ny > 0.74) return false;
  // Треугольник вершиной вверх.
  if (ny <= 0.52) {
    const half = (ny - 0.28) * 1.25;
    return Math.abs(nx - 0.5) <= half;
  }
  return Math.abs(nx - 0.5) <= 0.11; // ножка
}

function pixel(x, y, size) {
  if (!inRoundedSquare(x, y, size)) return [0, 0, 0, 0];
  if (inArrow(x, y, size)) return [255, 255, 255, 255];
  return [...ACCENT, 255];
}

const dir = join(__dirname, '..', 'app', 'assets');
mkdirSync(dir, { recursive: true });
for (const size of [32, 256]) {
  const name = size === 32 ? 'tray.png' : 'icon.png';
  writeFileSync(join(dir, name), png(size, pixel));
  console.log(`written: app/assets/${name} (${size}x${size})`);
}
