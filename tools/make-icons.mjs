#!/usr/bin/env node
/**
 * 净屏 · 广告拦截 — 图标生成脚本（零依赖，直接输出 PNG）
 * 用法： node tools/make-icons.mjs
 * 产物： icons/icon16.png icon32.png icon48.png icon128.png
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(path.resolve(HERE, '..'), 'icons');

/* 如果存在品牌原图 icons/jingping.png，说明图标是从原图生成的，
   此时不要用本脚本的内置画法覆盖它（改用 tools/make-icons.ps1）。 */
if (fs.existsSync(path.join(OUT_DIR, 'jingping.png'))) {
  console.log('检测到品牌原图 icons/jingping.png，图标请用下面这条命令从原图重新生成：');
  console.log('  powershell -File tools\\make-icons.ps1            # 完整标志');
  console.log('  powershell -File tools\\make-icons.ps1 -Variant mark   # 只要叶子');
  process.exit(0);
}

/* --------------------------------- PNG 编码 -------------------------------- */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------------------------------- 几何 ---------------------------------- */
function quad(p0, p1, p2, steps) {
  const out = [];
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const mt = 1 - t;
    out.push([
      mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0],
      mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1]
    ]);
  }
  return out;
}

/** 盾牌轮廓（归一化坐标） */
function shieldPolygon() {
  const top = [0.50, 0.145];
  const rightTop = [0.825, 0.305];
  const rightBottom = [0.825, 0.545];
  const bottom = [0.50, 0.885];
  const leftBottom = [0.175, 0.545];
  const leftTop = [0.175, 0.305];

  const points = [top];
  points.push(...quad(top, [0.715, 0.140], rightTop, 24));
  points.push(...quad(rightTop, [0.825, 0.400], rightBottom, 16));
  points.push(...quad(rightBottom, [0.812, 0.760], bottom, 32));
  points.push(...quad(bottom, [0.188, 0.760], leftBottom, 32));
  points.push(...quad(leftBottom, [0.175, 0.400], leftTop, 16));
  points.push(...quad(leftTop, [0.285, 0.140], top, 24));
  return points;
}

function inPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy || 1e-9;
  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function inRoundedRect(x, y, radius) {
  const dx = Math.max(radius - x, x - (1 - radius), 0);
  const dy = Math.max(radius - y, y - (1 - radius), 0);
  return Math.hypot(dx, dy) <= radius;
}

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/* ---------------------------------- 绘制 ---------------------------------- */
const BG_FROM = [79, 70, 229];   // indigo-600
const BG_TO = [124, 58, 237];    // violet-600
const SHIELD = [255, 255, 255];
const SLASH = [239, 68, 68];     // red-500

function render(size) {
  const poly = shieldPolygon();
  const SS = 4; // 超采样
  const rgba = Buffer.alloc(size * size * 4);

  const slashA = [0.315, 0.735];
  const slashB = [0.685, 0.255];
  const slashHalf = 0.055;
  const ringHalf = 0.075;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let pr = 0, pg = 0, pb = 0, pa = 0; // 预乘累加
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;

          let cr = 0, cg = 0, cb = 0, ca = 0;
          if (inRoundedRect(x, y, 0.22)) {
            const bg = mix(BG_FROM, BG_TO, Math.min(1, Math.max(0, x * 0.55 + y * 0.85)));
            cr = bg[0]; cg = bg[1]; cb = bg[2]; ca = 1;
          }
          if (inPolygon(x, y, poly)) {
            const dist = distToSegment(x, y, slashA[0], slashA[1], slashB[0], slashB[1]);
            if (dist <= slashHalf) {
              cr = SLASH[0]; cg = SLASH[1]; cb = SLASH[2];
            } else if (dist <= ringHalf) {
              const t = Math.min(1, ((dist - slashHalf) / Math.max(1e-6, ringHalf - slashHalf)) * 1.6);
              const ring = mix(SLASH, SHIELD, t);
              cr = ring[0]; cg = ring[1]; cb = ring[2];
            } else {
              cr = SHIELD[0]; cg = SHIELD[1]; cb = SHIELD[2];
            }
            ca = 1;
          }
          pr += cr * ca; pg += cg * ca; pb += cb * ca; pa += ca;
        }
      }
      const offset = (py * size + px) * 4;
      if (pa > 0) {
        rgba[offset] = Math.round(Math.min(255, pr / pa));
        rgba[offset + 1] = Math.round(Math.min(255, pg / pa));
        rgba[offset + 2] = Math.round(Math.min(255, pb / pa));
        rgba[offset + 3] = Math.round((pa / (SS * SS)) * 255);
      }
    }
  }
  return rgba;
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const png = encodePng(size, size, render(size));
  fs.writeFileSync(path.join(OUT_DIR, `icon${size}.png`), png);
  console.log(`✔ icons/icon${size}.png  ${png.length} 字节`);
}
