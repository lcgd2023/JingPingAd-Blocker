#!/usr/bin/env node
/**
 * 净屏 · 广告拦截 — 自检脚本
 * 在不启动浏览器的情况下校验共享模块的解析逻辑与规则文件格式。
 *   node tools/selftest.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

let passed = 0;
let failed = 0;

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
    console.log('  ✔ ' + name);
  } else {
    failed += 1;
    console.error(`  ✘ ${name}\n      期望 ${e}\n      实际 ${a}`);
  }
}

function ok(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log('  ✔ ' + name);
  } else {
    failed += 1;
    console.error(`  ✘ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

/* ---------------------------- 载入共享模块 ---------------------------- */
const sandbox = { console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/shared/config.js'), 'utf8'), sandbox, { filename: 'config.js' });
const ADB = sandbox.ADB;

console.log('\n【域名规范化】');
check('去掉协议与路径', ADB.normalizeHost('HTTPS://WWW.Example.com:8443/a/b?c=1#d'), 'www.example.com');
check('去掉 *. 前缀', ADB.normalizeHost('*.cdn.example.com'), 'cdn.example.com');
check('拒绝空格', ADB.normalizeHost('exam ple.com'), '');
check('中文域名保留', ADB.normalizeHost('中文.example.com'), '中文.example.com');

console.log('\n【域名匹配 / 白名单】');
ok('子域名命中', ADB.hostMatches('a.b.example.com', 'example.com') === true);
ok('非子域名不命中', ADB.hostMatches('notexample.com', 'example.com') === false);
ok('结尾相似域名不命中', ADB.hostMatches('example.com.evil.net', 'example.com') === false);
ok('白名单匹配', ADB.hostInList('news.sina.com.cn', ['sina.com.cn', 'foo.com']) === true);
ok('白名单未匹配', ADB.hostInList('weibo.com', ['sina.com.cn']) === false);

console.log('\n【设置合并】');
const merged = ADB.mergeSettings({ enabled: false, allowlist: ['Example.com', 'example.com', ' BAD '], userRules: ['  ||a.com^  ', '||a.com^'], unknownKey: 1 });
check('布尔值覆盖', merged.enabled, false);
check('白名单去重规范化', merged.allowlist, ['example.com']);
check('规则去重', merged.userRules, ['||a.com^']);
ok('未知键被忽略', merged.unknownKey === undefined);
check('默认值补齐', ADB.mergeSettings(null).blockTrackers, true);

console.log('\n【网络规则解析】');
const net = ADB.parseUserRules([
  '! 注释行',
  '||ads.example.com^',
  '||ads.example.com^$script,image',
  '@@||example.com/ok.js',
  '||x.com^$script,third-party',
  '/banner/*',
  '||bad host.com^'
]).network;
check('规则条数（跳过注释与非法项）', net.length, 4);
check('普通域名规则', net[0], { urlFilter: '||ads.example.com^', resourceTypes: ADB.ALL_RESOURCE_TYPES, exception: false });
check('限定资源类型', net[1].resourceTypes, ['script', 'image']);
check('例外规则', net[2].exception, true);
check('路径规则', net[3].urlFilter, '/banner/*');
ok('不支持的选项被丢弃', !net.some(r => /x\.com/.test(r.urlFilter)));
ok('含空白的过滤器被丢弃', !net.some(r => /\s/.test(r.urlFilter)));

console.log('\n【元素规则解析】');
const cos = ADB.parseUserRules([
  '##.ad-banner',
  'example.com##div[id^="promo-"]',
  'example.com,foo.com#@#.ad-banner'
]).cosmetic;
check('规则条数', cos.length, 3);
check('通用规则', cos[0], { domains: [], selector: '.ad-banner', exception: false });
check('分站规则', cos[1], { domains: ['example.com'], selector: 'div[id^="promo-"]', exception: false });
check('例外规则', cos[2], { domains: ['example.com', 'foo.com'], selector: '.ad-banner', exception: true });

console.log('\n【其它工具】');
check('CSS 生成', ADB.buildCss(['.a', '.b']), '.a { display: none !important; }\n.b { display: none !important; }');
check('数字格式化', [ADB.formatNumber(5), ADB.formatNumber(1234), ADB.formatNumber(28000)], ['5', '1,234', '28k']);
ok('补丁只接受已知键', ADB.patchSettings(ADB.mergeSettings(null), { enabled: false, hack: true }).hack === undefined);

/* ---------------------------- 规则文件校验 ---------------------------- */
console.log('\n【静态规则文件】');
const RULESETS = ['ads', 'trackers', 'annoyances', 'video'];
const ALLOWED_TYPES = new Set(ADB.ALL_RESOURCE_TYPES);
for (const name of RULESETS) {
  const file = path.join(ROOT, 'rules', name + '.json');
  let rules;
  try {
    rules = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    ok(`${name}.json 可解析`, false, e.message);
    continue;
  }
  ok(`${name}.json 是数组且非空`, Array.isArray(rules) && rules.length > 0, 'count=' + (rules && rules.length));
  const ids = new Set();
  let bad = null;
  for (const rule of rules) {
    if (!Number.isInteger(rule.id) || rule.id <= 0) bad = 'id 非法';
    else if (ids.has(rule.id)) bad = 'id 重复 ' + rule.id;
    else if (!rule.condition || typeof rule.condition.urlFilter !== 'string' || !rule.condition.urlFilter) bad = '缺少 urlFilter';
    else if (/[^\x21-\x7E]/.test(rule.condition.urlFilter)) bad = 'urlFilter 含非 ASCII';
    else if (!Array.isArray(rule.condition.resourceTypes) || !rule.condition.resourceTypes.every(t => ALLOWED_TYPES.has(t))) bad = 'resourceTypes 非法';
    else if (!rule.action || !['block', 'allow', 'allowAllRequests'].includes(rule.action.type)) bad = 'action 非法';
    else if (typeof rule.priority !== 'number' || rule.priority < 1) bad = 'priority 非法';
    if (bad) {
      ok(`${name}.json 规则 #${rule.id} 合法`, false, bad);
      break;
    }
    ids.add(rule.id);
  }
  if (!bad) ok(`${name}.json 全部 ${rules.length} 条规则合法`, true);
}

/* ---------------------------- 多语言校验 ---------------------------- */
console.log('\n【多语言 _locales】');
const LOCALES = ['zh_CN', 'en'];
const messages = {};
for (const loc of LOCALES) {
  const file = path.join(ROOT, '_locales', loc, 'messages.json');
  try {
    messages[loc] = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    ok(`_locales/${loc}/messages.json 可解析`, false, e.message);
    messages[loc] = {};
  }
}
const baseLocale = messages[LOCALES[0]];
const baseKeys = Object.keys(baseLocale).sort();
ok('中文语言包非空', baseKeys.length > 0, 'count=' + baseKeys.length);
check('两种语言键集合一致', Object.keys(messages.en).sort(), baseKeys);

const placeholderNames = def => Object.keys(def.placeholders || {}).sort().join(',');
const localeIssues = [];
for (const [key, def] of Object.entries(baseLocale)) {
  const en = messages.en[key];
  if (typeof def.message !== 'string' || !def.message.trim()) localeIssues.push(key + ': 中文文案为空');
  if (!en) { localeIssues.push(key + ': 英文缺失'); continue; }
  if (typeof en.message !== 'string' || !en.message.trim()) localeIssues.push(key + ': 英文文案为空');
  if (placeholderNames(def) !== placeholderNames(en)) localeIssues.push(key + ': 占位符不一致');
  for (const name of Object.keys(def.placeholders || {})) {
    if (!def.message.includes('$' + name + '$')) localeIssues.push(key + ': 中文缺少 $' + name + '$');
    if (!en.message.includes('$' + name + '$')) localeIssues.push(key + ': 英文缺少 $' + name + '$');
  }
}
ok('语言包内容校验（非空 / 占位符一致）', localeIssues.length === 0, localeIssues.slice(0, 4).join(' | '));

const nameLens = LOCALES.map(loc => (messages[loc].ext_name || {}).message || '');
const descLens = LOCALES.map(loc => (messages[loc].ext_desc || {}).message || '');
ok('扩展名称 ≤ 45 字符', nameLens.every(v => v.length > 0 && v.length <= 45), nameLens.map(v => v.length).join('/'));
ok('扩展描述 ≤ 132 字符', descLens.every(v => v.length > 0 && v.length <= 132), descLens.map(v => v.length).join('/'));

/* manifest 的多语言占位符 */
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
check('配置里的版本号与 manifest 一致', ADB.VERSION, manifest.version);
check('manifest 名称占位符', manifest.name, '__MSG_ext_name__');
check('manifest 描述占位符', manifest.description, '__MSG_ext_desc__');
check('manifest 图标提示占位符', manifest.action && manifest.action.default_title, '__MSG_ext_name__');
ok('default_locale 与语言包一致', LOCALES.includes(manifest.default_locale), String(manifest.default_locale));

/* HTML / JS 里引用的文案键必须都存在 */
const used = new Set();
for (const file of ['popup/popup.html', 'options/options.html']) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  for (const m of text.matchAll(/data-i18n(?:-title|-placeholder)?="([^"]+)"/g)) used.add(m[1]);
}
for (const file of ['popup/popup.js', 'options/options.js', 'src/background.js']) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  for (const m of text.matchAll(/I18N\.t\(\s*'([^']+)'/g)) used.add(m[1]);
}
const missingKeys = [...used].filter(k => !(k in baseLocale));
ok(`页面引用的 ${used.size} 个文案键都已定义`, missingKeys.length === 0, missingKeys.join(', '));

/* i18n.js 里的中文兜底文案也应当有对应的语言包条目 */
const i18nSrc = fs.readFileSync(path.join(ROOT, 'src/shared/i18n.js'), 'utf8');
const fallbackBlock = i18nSrc.slice(i18nSrc.indexOf('const FALLBACK = {'), i18nSrc.indexOf('};', i18nSrc.indexOf('const FALLBACK = {')));
const fallbackKeys = [...fallbackBlock.matchAll(/^\s{4}([a-z0-9_]+):/gm)].map(m => m[1]);
ok('i18n 兜底文案非空', fallbackKeys.length > 0, 'count=' + fallbackKeys.length);
const orphanFallback = fallbackKeys.filter(k => !(k in baseLocale));
ok('i18n 兜底文案都有语言包条目', orphanFallback.length === 0, orphanFallback.join(', '));

console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
if (failed) process.exitCode = 1;
