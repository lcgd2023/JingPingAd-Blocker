#!/usr/bin/env node
/**
 * 净屏 · 广告拦截 — 多语言界面预览服务器
 *
 * 用途：不切换浏览器语言，也能检查各语言下弹窗页 / 设置页的文案。
 *   node tools/preview-locale.mjs [端口]        # 默认 5199
 *
 * 然后打开：
 *   http://localhost:5199/popup/popup.html?__locale=en
 *   http://localhost:5199/popup/popup.html?__locale=zh_CN
 *   http://localhost:5199/options/options.html?__locale=en
 *
 * 做法：返回 HTML 时，在 <head> 里注入一个「假的 chrome.i18n」，
 *      它按 __locale 从 _locales/<locale>/messages.json 取词。
 *      这样页面走的仍是真实的 i18n 代码路径（AdShieldI18n），
 *      只是语言由 URL 参数决定，便于核对漏翻与占位符替换。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = Number(process.argv[2] || 5199);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8'
};

function resolveFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const target = path.join(ROOT, decoded.replace(/^\/+/, ''));
  const resolved = path.resolve(target);
  if (!resolved.startsWith(ROOT)) return '';
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    return path.join(resolved, 'index.html');
  }
  return resolved;
}

function loadMessages(locale) {
  const file = path.join(ROOT, '_locales', locale, 'messages.json');
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

function shimScript(locale, messages) {
  const uiLang = locale.replace('_', '-');
  return `<script>/* 预览用：假的 chrome.i18n（语言：${locale}） */
(function () {
  var MESSAGES = ${JSON.stringify(messages)};
  function sub(text, subs) {
    if (!subs || !subs.length) return text;
    for (var i = 0; i < subs.length; i += 1) {
      text = text.split('$' + (i + 1)).join(subs[i] == null ? '' : String(subs[i]));
    }
    return text;
  }
  window.chrome = window.chrome || {};
  window.chrome.i18n = {
    getUILanguage: function () { return ${JSON.stringify(uiLang)}; },
    getMessage: function (key, subs) {
      var def = MESSAGES[key];
      if (!def || typeof def.message !== 'string') return '';
      var text = def.message;
      var ph = def.placeholders || {};
      Object.keys(ph).forEach(function (name) {
        var idx = parseInt(String(ph[name].content).replace('$', ''), 10);
        var value = (subs && subs[idx - 1] != null) ? String(subs[idx - 1]) : '';
        text = text.split('$' + name + '$').join(value);
      });
      return sub(text, subs);
    }
  };
})();</script>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const file = resolveFile(url.pathname);
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 ' + url.pathname);
    return;
  }

  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  res.setHeader('cache-control', 'no-store');

  if (ext === '.html' && url.searchParams.has('__locale')) {
    const locale = url.searchParams.get('__locale');
    const messages = loadMessages(locale);
    let html = fs.readFileSync(file, 'utf8');
    if (messages) {
      const shim = shimScript(locale, messages);
      // 注意：必须用函数形式替换，否则 shim 里的 $' / $& 会被当成替换模式
      html = html.includes('<head>') ? html.replace('<head>', () => '<head>\n' + shim) : shim + html;
    }
    res.writeHead(200, { 'content-type': type });
    res.end(html);
    return;
  }

  res.writeHead(200, { 'content-type': type });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => {
  console.log(`多语言预览服务器: http://localhost:${PORT}  根目录=${ROOT}`);
  console.log(`  http://localhost:${PORT}/popup/popup.html?__locale=en`);
  console.log(`  http://localhost:${PORT}/options/options.html?__locale=en`);
  console.log(`  http://localhost:${PORT}/popup/popup.html?__locale=zh_CN`);
});
