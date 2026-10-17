#!/usr/bin/env node
/**
 * 净屏 · 广告拦截 — 规则构建脚本
 *
 *   输入：tools/sources/*.txt        （每行一条 Adblock 风格过滤器）
 *   输出：rules/*.json               （declarativeNetRequest 静态规则）
 *
 *   用法： node tools/build-rules.mjs [--strict]
 *
 *   支持的过滤器语法：
 *     ||example.com^                域名及其子域
 *     ||example.com^$script,image   限定资源类型
 *     /path/to/ad.js                路径匹配
 *     @@||example.com^              例外（放行）规则
 *     ! 开头                        注释
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC_DIR = path.join(HERE, 'sources');
const OUT_DIR = path.join(ROOT, 'rules');
const STRICT = process.argv.includes('--strict');

const MAP = [
  { file: 'ads.txt', out: 'ads.json', priority: 1 },
  { file: 'trackers.txt', out: 'trackers.json', priority: 1 },
  { file: 'annoyances.txt', out: 'annoyances.json', priority: 1 },
  { file: 'video.txt', out: 'video.json', priority: 1 }
];

const ALL_RESOURCE_TYPES = [
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font',
  'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'other'
];

const RESOURCE_TYPE_ALIASES = {
  document: 'main_frame', 'main-frame': 'main_frame', mainframe: 'main_frame',
  subdocument: 'sub_frame', 'sub-frame': 'sub_frame', frame: 'sub_frame',
  script: 'script', image: 'image', stylesheet: 'stylesheet', css: 'stylesheet',
  font: 'font', media: 'media', object: 'object',
  xmlhttprequest: 'xmlhttprequest', xhr: 'xmlhttprequest',
  ping: 'ping', beacon: 'ping', websocket: 'websocket', other: 'other'
};

const HOST_RE = /^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?\.?$/;

function parseLine(rawLine) {
  const line = rawLine.trim();
  if (!line || line.startsWith('!') || line.startsWith('[')) return { skip: true };

  let text = line;
  let exception = false;
  if (text.startsWith('@@')) {
    exception = true;
    text = text.slice(2);
  }

  let resourceTypes = ALL_RESOURCE_TYPES.slice();
  const dollar = text.lastIndexOf('$');
  if (dollar > 0 && dollar < text.length - 1) {
    const tail = text.slice(dollar + 1).trim();
    if (/^[A-Za-z0-9_,~*-]+$/.test(tail)) {
      const types = [];
      for (const token of tail.split(',')) {
        const key = token.replace(/^~/, '').toLowerCase();
        if (!(key in RESOURCE_TYPE_ALIASES)) return { error: '不支持的资源类型 $' + tail };
        types.push(RESOURCE_TYPE_ALIASES[key]);
      }
      resourceTypes = [...new Set(types.length ? types : ALL_RESOURCE_TYPES)];
      text = text.slice(0, dollar);
    }
  }

  // 校验
  if (!text) return { error: '空过滤器' };
  if (/\s/.test(text)) return { error: '包含空白字符' };
  if (/[^\x21-\x7E]/.test(text)) return { error: '包含非 ASCII 字符（请改用 punycode）' };
  if (text.includes('?')) return { error: '不支持 ? 通配符' };
  if (/^[|&]/.test(text) === false && !text.includes('/') && !/^[A-Za-z0-9]/.test(text)) {
    return { error: '无法识别的过滤器' };
  }
  if (text.includes('||')) {
    const match = text.match(/^\|\|([^/^$]+)/);
    if (!match) return { error: '|| 后缺少域名' };
    const host = match[1].replace(/^\*\./, '');
    if (host && !HOST_RE.test(host)) return { error: '域名不合法：' + host };
  }
  if (text.startsWith('|') && !text.startsWith('||') && text.length < 3) {
    return { error: '过滤过短' };
  }

  return { urlFilter: text, resourceTypes, exception };
}

function buildOne(source) {
  const inputPath = path.join(SRC_DIR, source.file);
  const text = fs.readFileSync(inputPath, 'utf8');
  const rules = [];
  const problems = [];
  let id = 0;

  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const parsed = parseLine(lines[index]);
    if (parsed.skip) continue;
    if (parsed.error) {
      problems.push(`${source.file}:${index + 1} → ${parsed.error}  («${lines[index].trim()}»)`);
      continue;
    }
    id += 1;
    const rule = {
      id,
      priority: source.priority,
      action: { type: parsed.exception ? 'allow' : 'block' },
      condition: { urlFilter: parsed.urlFilter, resourceTypes: parsed.resourceTypes }
    };
    if (parsed.exception) rule.priority = source.priority + 10;
    rules.push(rule);
  }

  const body = rules.map(rule => JSON.stringify(rule)).join(',\n');
  const json = '[\n' + body + '\n]\n';
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, source.out), json, 'utf8');
  return { out: source.out, count: rules.length, problems };
}

let total = 0;
let failed = false;
for (const source of MAP) {
  const result = buildOne(source);
  total += result.count;
  console.log(`✔ rules/${result.out}  ${result.count} 条规则`);
  if (result.problems.length) {
    failed = true;
    console.warn(`  ⚠ ${result.problems.length} 行被忽略：`);
    for (const problem of result.problems) console.warn('    - ' + problem);
  }
}
console.log(`\n合计 ${total} 条静态规则（Chrome 保证至少 30000 条额度）`);
if (failed && STRICT) process.exitCode = 1;
