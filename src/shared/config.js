/*! 净屏 · 广告拦截 (AdShield) — 共享配置与工具函数
 *  本文件会被以下三种上下文同时加载，因此必须保持「普通脚本」（不能使用 ES Module 语法）：
 *    1. Service Worker  —— importScripts('shared/config.js')
 *    2. 内容脚本         —— manifest.content_scripts
 *    3. 弹窗 / 设置页     —— <script src="../src/shared/config.js">
 */
(function () {
  'use strict';

  const root = (typeof globalThis !== 'undefined') ? globalThis
    : (typeof self !== 'undefined') ? self : this;

  const ADB = (root.ADB = root.ADB || {});

  /* 优先取扩展清单里的真实版本号；在扩展环境之外（直接预览页面）退回下面的常量 */
  ADB.VERSION = (function () {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
        return chrome.runtime.getManifest().version;
      }
    } catch (e) { /* ignore */ }
    return '1.3.0';
  })();

  /* ------------------------------------------------------------------ *
   *  默认设置
   * ------------------------------------------------------------------ */
  ADB.DEFAULTS = {
    enabled: true,          // 总开关
    blockAds: true,         // 广告网络（静态规则集 ads）
    blockTrackers: true,    // 跟踪 / 统计（静态规则集 trackers）
    blockAnnoyances: false, // 弹窗推送 / 同意横幅（静态规则集 annoyances）
    blockVideoAds: false,   // 视频网站广告（静态规则集 video）

    hideAds: true,          // 元素隐藏（页面内广告位）
    hideAggressive: false,  // 强力模式：更激进的元素隐藏 + 悬浮广告清理
    hideSponsored: true,    // 隐藏信息流“赞助 / 推广”内容（社交站点）
    hideOverlays: false,    // 移除 Cookie 同意弹窗 / 遮罩层
    killOverlayAds: true,   // 拦截插屏 / 悬浮 / 弹窗式广告（Google 插屏、vignette 等）
    blockPopupWindows: true,// 拦截脚本弹出的广告窗口（window.open）

    showBadge: true,        // 在图标上显示拦截数字
    allowlist: [],          // 网站白名单（域名）
    userRules: []           // 用户自定义规则
  };

  /** 静态规则集 ID -> 对应设置项 */
  ADB.RULESET_SETTING = {
    ads: 'blockAds',
    trackers: 'blockTrackers',
    annoyances: 'blockAnnoyances',
    video: 'blockVideoAds'
  };

  /* ------------------------------------------------------------------ *
   *  网络过滤：资源类型映射
   * ------------------------------------------------------------------ */
  ADB.ALL_RESOURCE_TYPES = [
    'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font',
    'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'other'
  ];

  ADB.RESOURCE_TYPE_ALIASES = {
    all: null, '*': null,
    document: 'main_frame', 'main-frame': 'main_frame', mainframe: 'main_frame',
    subdocument: 'sub_frame', 'sub-frame': 'sub_frame', frame: 'sub_frame',
    script: 'script', image: 'image', stylesheet: 'stylesheet', css: 'stylesheet',
    font: 'font', media: 'media', object: 'object',
    xmlhttprequest: 'xmlhttprequest', xhr: 'xmlhttprequest',
    ping: 'ping', beacon: 'ping', websocket: 'websocket', other: 'other'
  };

  /* ------------------------------------------------------------------ *
   *  设置合并 / 校验
   * ------------------------------------------------------------------ */
  function uniq(list) {
    const seen = new Set();
    const out = [];
    for (const item of list) {
      if (seen.has(item)) continue;
      seen.add(item);
      out.push(item);
    }
    return out;
  }

  /** 把域名/网址规范化为纯主机名（小写、无端口、无路径、去掉 *. 前缀） */
  ADB.normalizeHost = function (value) {
    if (typeof value !== 'string') return '';
    let host = value.trim().toLowerCase();
    if (!host) return '';
    host = host.replace(/^(?:[a-z][a-z0-9+.-]*:)?\/\//i, ''); // scheme://
    host = host.split('|')[0];
    host = host.split('/')[0].split('?')[0].split('#')[0];
    if (host.includes('@')) host = host.split('@').pop();
    host = host.replace(/:\d+$/, '');
    while (host.startsWith('*.')) host = host.slice(2);
    if (host.startsWith('.')) host = host.slice(1);
    host = host.replace(/\.$/, '');
    if (!host || /\s/.test(host)) return '';
    if (host === 'localhost' || host === '127.0.0.1') return host;
    if (!host.includes('.')) return ''; // 拒绝 "bad" 这类没有点号的无效域名
    return host;
  };

  /** host 是否命中 pattern（含子域名） */
  ADB.hostMatches = function (host, pattern) {
    if (!host || !pattern) return false;
    const h = ADB.normalizeHost(host);
    const p = ADB.normalizeHost(pattern);
    if (!h || !p) return false;
    return h === p || h.endsWith('.' + p);
  };

  /** host 是否位于白名单中 */
  ADB.hostInList = function (host, list) {
    if (!host || !Array.isArray(list)) return false;
    for (const item of list) {
      if (ADB.hostMatches(host, item)) return true;
    }
    return false;
  };

  /** 把设置对象与默认值合并，并做类型清洗 */
  ADB.mergeSettings = function (stored) {
    const out = Object.assign({}, ADB.DEFAULTS);
    if (stored && typeof stored === 'object') {
      for (const key of Object.keys(ADB.DEFAULTS)) {
        if (!(key in stored)) continue;
        const def = ADB.DEFAULTS[key];
        const val = stored[key];
        if (Array.isArray(def)) {
          if (Array.isArray(val)) {
            out[key] = uniq(val.map(v => String(v).trim()).filter(Boolean));
          }
        } else if (typeof def === 'boolean') {
          out[key] = !!val;
        } else {
          out[key] = val;
        }
      }
    }
    out.allowlist = uniq(out.allowlist.map(ADB.normalizeHost).filter(Boolean));
    out.userRules = uniq(out.userRules);
    return out;
  };

  /** 合并一个「部分设置」补丁 */
  ADB.patchSettings = function (settings, patch) {
    const next = Object.assign({}, settings);
    if (patch && typeof patch === 'object') {
      for (const key of Object.keys(patch)) {
        if (key in ADB.DEFAULTS) next[key] = patch[key];
      }
    }
    return ADB.mergeSettings(next);
  };

  /* ------------------------------------------------------------------ *
   *  自定义规则解析
   *   网络规则： ||example.com^          /ads/*        ||x.com^$script,image
   *            @@||example.com^                         例外（放行）
   *   元素规则： ##.selector             example.com##.selector
   *            example.com#@#.selector                例外（不隐藏）
   * ------------------------------------------------------------------ */
  function toAscii(text) {
    if (!text || /^[\x00-\x7F]*$/.test(text)) return text;
    try {
      const url = new URL('http://' + text.replace(/^\|\|?/, '').replace(/[\^|]+$/, ''));
      if (url.hostname) return url.hostname;
    } catch (e) { /* ignore */ }
    return '';
  }

  function normalizeUrlFilter(filter) {
    let text = String(filter || '').trim();
    if (!text) return '';
    if (/\s/.test(text)) return ''; // 过滤器不能包含空白字符
    if (!/^[\x00-\x7F]*$/.test(text)) {
      const ascii = toAscii(text);
      if (!ascii) return '';
      text = text.replace(/[^\x00-\x7F]+/, ascii);
    }
    return text;
  }

  function parseTypes(tail) {
    const types = [];
    for (const raw of String(tail).split(',')) {
      const token = raw.replace(/^~/, '').trim().toLowerCase();
      if (!token) continue;
      if (!(token in ADB.RESOURCE_TYPE_ALIASES)) return null; // 不支持的选项
      const mapped = ADB.RESOURCE_TYPE_ALIASES[token];
      if (mapped === null) return null; // $all -> 就用默认类型
      types.push(mapped);
    }
    return uniq(types);
  }

  function parseNetworkRule(line) {
    let text = line;
    let exception = false;
    if (text.startsWith('@@')) {
      exception = true;
      text = text.slice(2);
    }
    let resourceTypes = ADB.ALL_RESOURCE_TYPES.slice();
    const dollar = text.lastIndexOf('$');
    if (dollar > 0 && dollar < text.length - 1) {
      const tail = text.slice(dollar + 1).trim();
      if (/^[A-Za-z0-9_,~*-]+$/.test(tail)) {
        const parsed = parseTypes(tail);
        if (!parsed) return null;
        resourceTypes = parsed.length ? parsed.slice() : resourceTypes;
        text = text.slice(0, dollar);
      }
    }
    const urlFilter = normalizeUrlFilter(text);
    if (!urlFilter) return null;
    if (urlFilter.length > 2000) return null;
    return { urlFilter, resourceTypes, exception };
  }

  function parseCosmeticRule(line) {
    const marker = line.includes('#@#') ? '#@#' : '##';
    const index = line.indexOf(marker);
    if (index < 0) return null;
    const domains = line.slice(0, index)
      .split(',')
      .map(d => ADB.normalizeHost(d.replace(/^~/, '')))
      .filter(Boolean);
    const selector = line.slice(index + marker.length).trim();
    if (!selector) return null;
    if (selector.length > 1000) return null;
    return { domains, selector, exception: marker === '#@#' };
  }

  /** 返回 { network: [...], cosmetic: [...] } */
  ADB.parseUserRules = function (lines) {
    const network = [];
    const cosmetic = [];
    if (!Array.isArray(lines)) return { network, cosmetic };
    for (const rawLine of lines) {
      const line = String(rawLine || '').trim();
      if (!line) continue;
      if (line.startsWith('!')) continue;          // 注释
      if (line.startsWith('[')) continue;          // 兼容 Adblock 头部
      if (line.includes('##') || line.includes('#@#')) {
        const rule = parseCosmeticRule(line);
        if (rule) cosmetic.push(rule);
        continue;
      }
      const rule = parseNetworkRule(line);
      if (rule) network.push(rule);
    }
    return { network, cosmetic };
  };

  /* ------------------------------------------------------------------ *
   *  其它小工具
   * ------------------------------------------------------------------ */
  ADB.formatNumber = function (n) {
    const num = Number(n) || 0;
    if (num >= 1000000) return (num / 1000000).toFixed(num % 1000000 === 0 ? 0 : 1) + 'M';
    if (num >= 10000) return (num / 1000).toFixed(num % 1000 === 0 ? 0 : 1) + 'k';
    return String(num).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };

  ADB.today = function (date) {
    const d = date ? new Date(date) : new Date();
    const pad = v => String(v).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  };

  /** 把一组选择器拼成逐条独立的 CSS（单条选择器非法时不会拖垮全部） */
  ADB.buildCss = function (selectors) {
    const out = [];
    for (const selector of selectors) {
      out.push(selector + ' { display: none !important; }');
    }
    return out.join('\n');
  };
})();
