// Generates the PWA icons (wallet + check mark) as PNGs with no dependencies.
// Runs automatically before `next build` (npm "prebuild").
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BRAND = [11, 132, 100];
const PAPER = [246, 244, 239];
const MINT = [209, 250, 236];
const GOLD = [192, 136, 43];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const distToSeg = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

// Colour of a point in unit space (0..1); pad shrinks the artwork for maskable icons.
function sample(u, v, pad, rounded, opaque) {
  let col = null;
  if (opaque || !rounded || inRoundRect(u, v, 0, 0, 1, 1, 0.22)) col = BRAND;
  const s = 1 - 2 * pad;
  const x = (u - pad) / s, y = (v - pad) / s;
  if (inRoundRect(x, y, 0.12, 0.28, 0.88, 0.8, 0.09)) col = PAPER;
  if (inRoundRect(x, y, 0.12, 0.2, 0.72, 0.36, 0.06)) col = MINT;
  if (inRoundRect(x, y, 0.6, 0.46, 0.92, 0.62, 0.06)) col = GOLD;
  if (Math.hypot(x - 0.7, y - 0.54) <= 0.035) col = PAPER;
  const w = 0.0275;
  if (distToSeg(x, y, 0.24, 0.56, 0.33, 0.66) <= w || distToSeg(x, y, 0.33, 0.66, 0.5, 0.45) <= w) col = BRAND;
  return col;
}

function render(size, { pad = 0.12, rounded = true, opaque = false } = {}) {
  const ss = 4; // supersampling for smooth edges
  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = sample((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size, pad, rounded, opaque);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 1; }
        }
      }
      const i = (py * size + px) * 4;
      out[i] = a ? Math.round(r / a) : 0;
      out[i + 1] = a ? Math.round(g / a) : 0;
      out[i + 2] = a ? Math.round(b / a) : 0;
      out[i + 3] = Math.round((a / (ss * ss)) * 255);
    }
  }
  return png(size, out);
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', render(192));
writeFileSync('public/icons/icon-512.png', render(512));
writeFileSync('public/icons/maskable-512.png', render(512, { pad: 0.22, rounded: false }));
writeFileSync('public/icons/apple-touch-icon.png', render(180, { pad: 0.22, rounded: false, opaque: true }));
console.log('PWA icons generated');
