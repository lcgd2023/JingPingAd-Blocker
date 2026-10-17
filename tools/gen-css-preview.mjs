#!/usr/bin/env node
/*! 生成「元素隐藏 CSS 预览」
 *
 *  把 src/shared/config.js + src/content/cosmetic.js 在 Node 里跑一遍，
 *  按内容脚本的同样逻辑算出选择器并生成 CSS，用于：
 *    · 排查「某站点为什么没被隐藏 / 为什么误伤」——把 CSS 注入页面即可看到结果
 *    · 维护规则库时快速预览选择器全集
 *
 *  用法：
 *    node tools/gen-css-preview.mjs [域名] [输出文件]
 *  示例：
 *    node tools/gen-css-preview.mjs yysub.cc dist/preview-yysub.css
 *    node tools/gen-css-preview.mjs                # 不带域名，只输出通用规则
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hostname = (process.argv[2] || '').trim();
const outFile = (process.argv[3] || '').trim();

const sandbox = { console, setTimeout, clearTimeout, URL };
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);

for (const file of ['src/shared/config.js', 'src/content/cosmetic.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
}

const ADB = sandbox.ADB;
const C = ADB.COSMETIC;
const settings = ADB.DEFAULTS;

const selectors = [];
if (settings.enabled && settings.hideAds) {
  for (const sel of C.generic) selectors.push(sel);
  for (const sel of C.googleAds) selectors.push(sel);
  if (settings.hideAggressive) for (const sel of C.aggressive) selectors.push(sel);
  for (const [domain, list] of Object.entries(C.specific)) {
    if (!list || !list.length) continue;
    if (!hostname || ADB.hostMatches(hostname, domain)) {
      for (const sel of list) selectors.push(sel);
    }
  }
}
if (settings.enabled && settings.killOverlayAds) {
  for (const sel of C.interstitials) selectors.push(sel);
}
if (settings.enabled && settings.hideOverlays) {
  for (const sel of C.overlays) selectors.push(sel);
}

const unique = [...new Set(selectors)];
const css = ADB.buildCss(unique);

const header = [
  '/* 净屏 · 广告拦截 — 元素隐藏 CSS 预览（自动生成，请勿手工修改）',
  ` * 域名：${hostname || '(通用规则)'}`,
  ` * 选择器：${unique.length} 条   生成命令：node tools/gen-css-preview.mjs ${hostname} ${outFile}`.trim(),
  ' */',
  ''
].join('\n');

if (outFile) {
  const target = path.resolve(root, outFile);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, header + css, 'utf8');
  console.log(`✔ 已写入 ${path.relative(root, target)}（${unique.length} 个选择器，${css.length} 字节）`);
} else {
  console.log(header + css);
  console.error(`\n选择器 ${unique.length} 条`);
}
