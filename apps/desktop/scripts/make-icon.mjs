// Draws the provisional app icon (amber neuron on graphite) to build/icon.png, with no dependencies:
// shapes are distance fields sampled 3x3 per pixel and the PNG is written by hand.
// The final icon replaces build/icon.png later; electron-builder derives .ico/.icns from it.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SIZE = 1024;
const GRAPHITE = [0x2b, 0x2d, 0x31];
const AMBER = [0xe9, 0xa1, 0x5c];

const soma = { x: 512, y: 520, r: 140 };
const tips = [
  { x: 240, y: 270, r: 52 },
  { x: 790, y: 250, r: 52 },
  { x: 220, y: 700, r: 52 },
  { x: 800, y: 760, r: 52 },
  { x: 512, y: 880, r: 44 },
];
const THICKNESS = 26;

const distToSegment = (px, py, a, b) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
};

const insideBackground = (x, y) => {
  const radius = 230;
  const half = SIZE / 2;
  const qx = Math.abs(x - half) - (half - radius);
  const qy = Math.abs(y - half) - (half - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) <= radius;
};

const insideNeuron = (x, y) => {
  if (Math.hypot(x - soma.x, y - soma.y) <= soma.r) return true;
  return tips.some(
    (tip) =>
      Math.hypot(x - tip.x, y - tip.y) <= tip.r || distToSegment(x, y, soma, tip) <= THICKNESS / 2,
  );
};

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
const SAMPLES = 3;
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  for (let x = 0; x < SIZE; x++) {
    let coverage = 0;
    let amber = 0;
    for (let sy = 0; sy < SAMPLES; sy++) {
      for (let sx = 0; sx < SAMPLES; sx++) {
        const px = x + (sx + 0.5) / SAMPLES;
        const py = y + (sy + 0.5) / SAMPLES;
        if (!insideBackground(px, py)) continue;
        coverage++;
        if (insideNeuron(px, py)) amber++;
      }
    }
    const total = SAMPLES * SAMPLES;
    const offset = y * (SIZE * 4 + 1) + 1 + x * 4;
    const mix = coverage === 0 ? 0 : amber / coverage;
    for (let channel = 0; channel < 3; channel++) {
      raw[offset + channel] = Math.round(GRAPHITE[channel] * (1 - mix) + AMBER[channel] * mix);
    }
    raw[offset + 3] = Math.round((coverage / total) * 255);
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};
const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 8; // bit depth
header[9] = 6; // RGBA

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", header),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
const target = path.resolve(fileURLToPath(new URL("../build/icon.png", import.meta.url)));
mkdirSync(path.dirname(target), { recursive: true });
writeFileSync(target, png);
console.log(`Ícone gravado em ${target} (${png.length} bytes)`);
