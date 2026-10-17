/*! 净屏 · 广告拦截 (AdShield) — 内容脚本（元素隐藏 + 统计）
 *  运行于所有页面与子框架，document_start 阶段注入样式以减少广告闪烁。
 */
(function () {
  'use strict';

  const root = (typeof globalThis !== 'undefined') ? globalThis : self;
  const ADB = root.ADB;
  if (!ADB || !ADB.COSMETIC) return;

  /* ---------------------------------------------------------------- *
   *  运行时状态
   * ---------------------------------------------------------------- */
  const canTalk = () => !!(chrome && chrome.runtime && chrome.runtime.id);

  let settings = ADB.mergeSettings(null);
  let ready = false;
  let siteAllowed = false;

  const hiddenNodes = new Set();
  let pendingReport = 0;
  let reportTimer = null;

  let styleEl = null;
  let currentSelectors = [];
  let currentCss = '';
  let observer = null;
  let scanTimer = null;
  let sponsoredTimer = null;
  let floatingTimer = null;
  let lastFloatingScan = 0;

  const COSMETIC = ADB.COSMETIC;
  const hostname = location.hostname || '';

  /* ---------------------------------------------------------------- *
   *  工具
   * ---------------------------------------------------------------- */
  function parentForStyle() {
    return document.head || document.documentElement || null;
  }

  function ensureStyleNode() {
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = '__adshield_cosmetic__';
      styleEl.setAttribute('type', 'text/css');
    }
    const parent = parentForStyle();
    if (!parent) return false;
    if (styleEl.parentNode !== parent) parent.appendChild(styleEl);
    return true;
  }

  function writeCss(css) {
    if (css === currentCss) return;
    currentCss = css;
    if (!ensureStyleNode()) {
      // document_start 阶段极少数页面还没有 documentElement，稍后重试
      setTimeout(() => { if (ensureStyleNode()) styleEl.textContent = css; }, 0);
      return;
    }
    styleEl.textContent = css;
  }

  function removeStyle() {
    if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
    currentCss = '';
  }

  /** 计算当前页面应该生效的选择器 */
  function computeSelectors() {
    const selectors = [];
    const exceptions = [];

    if (settings.enabled && !siteAllowed && settings.hideAds) {
      for (const sel of COSMETIC.generic) selectors.push(sel);
      for (const sel of COSMETIC.googleAds) selectors.push(sel);
      if (settings.hideAggressive) {
        for (const sel of COSMETIC.aggressive) selectors.push(sel);
      }
      for (const [domain, list] of Object.entries(COSMETIC.specific)) {
        if (!list || !list.length) continue;
        if (ADB.hostMatches(hostname, domain)) {
          for (const sel of list) selectors.push(sel);
        }
      }
    }

    // 插屏 / 悬浮 / 弹窗式广告容器（Google 插屏、vignette 等）
    if (settings.enabled && !siteAllowed && settings.killOverlayAds) {
      for (const sel of COSMETIC.interstitials) selectors.push(sel);
    }

    if (settings.enabled && !siteAllowed && settings.hideOverlays) {
      for (const sel of COSMETIC.overlays) selectors.push(sel);
    }

    // 用户自定义元素规则
    const parsed = ADB.parseUserRules(settings.userRules);
    if (settings.enabled && !siteAllowed) {
      for (const rule of parsed.cosmetic) {
        const match = !rule.domains.length || ADB.hostInList(hostname, rule.domains);
        if (!match) continue;
        if (rule.exception) exceptions.push(rule.selector);
        else selectors.push(rule.selector);
      }
    }

    const unique = dedupe(selectors);
    const exceptionSet = new Set(exceptions);
    const final = unique.filter(sel => !exceptionSet.has(sel));
    return { selectors: final, exceptions: exceptionSet };
  }

  function dedupe(list) {
    const seen = new Set();
    const out = [];
    for (const item of list) {
      if (seen.has(item)) continue;
      seen.add(item);
      out.push(item);
    }
    return out;
  }

  /* ---------------------------------------------------------------- *
   *  执行隐藏 + 计数
   * ---------------------------------------------------------------- */
  function applySelectors() {
    const { selectors } = computeSelectors();
    currentSelectors = selectors;

    if (!selectors.length) {
      removeStyle();
      return;
    }
    writeCss(ADB.buildCss(selectors));
    scan();
  }

  function hideNode(node) {
    if (hiddenNodes.has(node)) return;
    hiddenNodes.add(node);
    try {
      node.setAttribute('data-adshield', 'hidden');
      node.style.setProperty('display', 'none', 'important');
    } catch (e) { /* ignore */ }
    pendingReport += 1;
    scheduleReport();
    if (settings.hideAds) expandAdWrapper(node);
  }

  function scan() {
    if (!currentSelectors.length) return;
    const beforeSize = hiddenNodes.size;
    for (const selector of currentSelectors) {
      let nodes;
      try {
        nodes = document.querySelectorAll(selector);
      } catch (e) {
        continue; // 浏览器不支持的选择器（例如较老的 :has() 语法）
      }
      for (const node of nodes) hideNode(node);
    }
    if (settings.hideOverlays) unlockScroll();
    const killed = settings.killOverlayAds ? killOverlayAds() : 0;
    // 只要本轮动过广告元素，就顺手把站点留下的模糊 / 滚动锁定还原掉
    if (killed > 0 || hiddenNodes.size > beforeSize) restorePage();
    if (settings.hideAggressive) scheduleFloatingScan();
  }

  function scanSoon(delay) {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan();
      if (settings.hideSponsored) scheduleSponsoredScan(600);
    }, typeof delay === 'number' ? delay : 150);
  }

  /* ---------------------------------------------------------------- *
   *  阻止滚动锁定（配合 Cookie / 遮罩弹窗移除）
   * ---------------------------------------------------------------- */
  let scrollUnlocked = false;
  function unlockScroll() {
    if (scrollUnlocked) return;
    const mentions = ['#onetrust-consent-sdk', '#CybotCookiebotDialog', '#didomi-host',
      '[id^="sp_message_container"]', '.cc-window', '#usercentrics-root', '#cmpbox'];
    const present = mentions.some(sel => {
      try { return !!document.querySelector(sel); } catch (e) { return false; }
    });
    if (!present) return;
    scrollUnlocked = true;
    try {
      document.documentElement.style.setProperty('overflow', 'auto', 'important');
      if (document.body) {
        document.body.style.setProperty('overflow', 'auto', 'important');
        document.body.style.setProperty('position', 'static', 'important');
      }
    } catch (e) { /* ignore */ }
  }

  /* ---------------------------------------------------------------- *
   *  插屏 / 悬浮 / 弹窗广告清理（Google 插屏、vignette、popunder 等）
   *  思路：以 Google 广告标记（或广告类名）为起点，向上找到“覆盖层”容器
   *        → 隐藏覆盖层 → 隐藏同层的半透明遮罩 → 解除整页模糊与滚动锁定。
   *  安全性：覆盖层必须“固定/绝对定位 + 高层级 + 覆盖一定面积”，
   *          并且不能是整页正文容器或含表单（登录弹窗）的容器。
   * ---------------------------------------------------------------- */
  let overlayScanAt = 0;
  let overlayKilledTotal = 0;

  function viewportSize() {
    return {
      w: window.innerWidth || document.documentElement.clientWidth || 0,
      h: window.innerHeight || document.documentElement.clientHeight || 0
    };
  }

  function rectInfo(el) {
    let rect;
    try { rect = el.getBoundingClientRect(); } catch (e) { return null; }
    if (!rect) return null;
    const { w, h } = viewportSize();
    if (!w || !h) return null;
    return { rect, ratio: (rect.width * rect.height) / (w * h) };
  }

  /** 是否为“覆盖层”结构：固定/绝对定位 + 足够高的层级 + 覆盖一定面积 */
  function isOverlayLike(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    if (el.hasAttribute('data-adshield')) return false;
    const cfg = COSMETIC.overlayAd;
    let style;
    try { style = getComputedStyle(el); } catch (e) { return false; }
    if (style.position !== 'fixed' && style.position !== 'absolute') return false;
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const zIndex = parseInt(style.zIndex, 10);
    if (!Number.isFinite(zIndex) || zIndex < cfg.minZIndex) return false;
    const info = rectInfo(el);
    if (!info) return false;
    return info.ratio >= cfg.minAreaRatio && info.ratio <= cfg.maxAreaRatio;
  }

  /** 整页正文/登录框所在容器，绝不能隐藏 */
  function isPageLike(el) {
    const cfg = COSMETIC.overlayAd;
    try {
      if (el.querySelector('form, input[type="password"]')) return true;
      if (el.querySelector(cfg.pageLikeSelectors)) return true;
    } catch (e) { /* ignore */ }
    const info = rectInfo(el);
    if (!info || info.ratio < cfg.pageLikeRatio) return false;
    try { return el.querySelectorAll('*').length > 150; } catch (e) { return true; }
  }

  /** class / id / aria-label 是否像广告层（词边界匹配，不会命中 head-* / loads-*） */
  function looksLikeAdLayer(el) {
    const cfg = COSMETIC.overlayAd;
    let text = '';
    try {
      text = [
        el.id || '',
        typeof el.className === 'string' ? el.className : '',
        el.getAttribute('aria-label') || '',
        el.getAttribute('data-testid') || ''
      ].join(' ');
    } catch (e) { return false; }
    return cfg.keywords.test(text);
  }

  /** 从广告标记向上寻找应被隐藏的覆盖层（返回最外层符合条件者） */
  function findOverlayAncestor(node) {
    const cfg = COSMETIC.overlayAd;
    let current = node;
    let best = null;
    for (let depth = 0; depth < cfg.maxDepth && current; depth += 1) {
      const parent = current.parentElement;
      if (!parent) break;
      current = parent;
      if (current === document.body || current === document.documentElement) break;
      if (!isOverlayLike(current)) continue;
      if (isPageLike(current)) break;
      best = current;
    }
    return best;
  }

  /** 覆盖层旁边的半透明遮罩（dim / blur 背景）一并隐藏 */
  function isBackdropLike(el) {
    let style;
    try { style = getComputedStyle(el); } catch (e) { return false; }
    if (style.position !== 'fixed' && style.position !== 'absolute') return false;
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const info = rectInfo(el);
    if (!info || info.ratio < 0.5) return false;
    const backdrop = style.backdropFilter || style.webkitBackdropFilter || '';
    if (backdrop && backdrop !== 'none' && backdrop.indexOf('blur') >= 0) return true;
    const match = (style.backgroundColor || '').match(/rgba?\(([^)]+)\)/);
    if (!match) return false;
    const parts = match[1].split(',').map(v => parseFloat(v));
    if (parts.length >= 4 && parts[3] < 0.05) return false;
    return true;
  }

  function hideBackdropSiblings(overlay) {
    const parent = overlay.parentElement;
    if (!parent) return;
    let count = 0;
    for (const sibling of parent.children) {
      if (sibling === overlay || count >= 6) continue;
      if (hiddenNodes.has(sibling)) continue;
      if (!isBackdropLike(sibling)) continue;
      hideNode(sibling);
      count += 1;
    }
  }

  function killOverlayAds() {
    if (!settings.enabled || siteAllowed || !settings.killOverlayAds) return 0;
    if (window.top !== window.self) return 0; // 只在顶层文档处理，避免子框架重复
    const cfg = COSMETIC.overlayAd;
    let killed = 0;

    // ① 以 Google 广告标记（data-google-av-*、ins.adsbygoogle、广告 iframe 等）为起点
    //    注意：即使标记本身已被 CSS 隐藏，也要向上找覆盖层容器（容器可能还在，遮罩/模糊也还在）
    let markers = null;
    try { markers = document.querySelectorAll(cfg.markers); } catch (e) { markers = null; }
    if (markers) {
      const deadline = Date.now() + 40; // 单次清理的时间预算
      let seen = 0;
      for (const marker of markers) {
        if (killed >= cfg.maxKills || ++seen > 60 || Date.now() > deadline) break;
        // 只有当「父级容器」已被隐藏时才跳过；标记自身被隐藏时，外层抽屉/覆盖层可能还在
        const markerParent = marker.parentElement;
        if (markerParent && markerParent.closest('[data-adshield]')) continue;
        const overlay = findOverlayAncestor(marker);
        if (!overlay || hiddenNodes.has(overlay)) continue;
        hideNode(overlay);
        hideBackdropSiblings(overlay);
        killed += 1;
      }
    }

    // ② 独立启发式扫描（限频，避免每次 DOM 变动都全量遍历）
    const now = Date.now();
    if (!killed && now - overlayScanAt > 2000) {
      overlayScanAt = now;
      killed += heuristicOverlayScan();
    }

    if (killed) {
      overlayKilledTotal += killed;
      restorePage();
    }
    return killed;
  }

  function heuristicOverlayScan() {
    const cfg = COSMETIC.overlayAd;
    let candidates;
    try {
      candidates = document.querySelectorAll('div, aside, section, dialog');
    } catch (e) {
      return 0;
    }
    let killed = 0;
    let checked = 0;
    for (const el of candidates) {
      if (killed >= 5) break;
      if (++checked > 4000) break;
      if (hiddenNodes.has(el)) continue;
      if (!looksLikeAdLayer(el)) continue;
      let style;
      try { style = getComputedStyle(el); } catch (e) { continue; }
      if (style.position !== 'fixed' && style.position !== 'absolute') continue;
      const zIndex = parseInt(style.zIndex, 10);
      if (!Number.isFinite(zIndex) || zIndex < 200) continue;
      const info = rectInfo(el);
      if (!info || info.ratio < cfg.minAreaRatio || info.ratio > cfg.maxAreaRatio) continue;
      if (isPageLike(el)) continue;
      // 广告覆盖层通常包含图片 / iframe / 视频
      if (!el.querySelector('img, iframe, video, canvas, ins')) continue;
      hideNode(el);
      hideBackdropSiblings(el);
      killed += 1;
    }
    return killed;
  }

  /** 广告覆盖层是否给页面留下了副作用（内联模糊 / 滚动锁定 / pointer-events）——廉价检查 */
  function pageLooksBroken() {
    const html = document.documentElement;
    const body = document.body;
    for (const el of [html, body]) {
      if (!el) continue;
      const style = el.style;
      if (style.overflow === 'hidden' || style.position === 'fixed') return true;
      if (style.getPropertyValue('pointer-events') === 'none') return true;
    }
    try {
      if (document.querySelector('[style*="blur"]')) return true;
    } catch (e) { /* ignore */ }
    return false;
  }

  /** 清理广告覆盖层留下的副作用：整页模糊、滚动锁定、pointer-events 等 */
  let lastBlurSweepAt = 0;
  function restorePage() {
    try {
      const now = Date.now();
      const cheapBroken = pageLooksBroken();
      // 计算样式扫描较重，限频执行（内联副作用则随时处理）
      const canSweep = now - lastBlurSweepAt > 2500;
      if (!cheapBroken && !canSweep) return;
      lastBlurSweepAt = now;
      const html = document.documentElement;
      const body = document.body;
      for (const el of [html, body]) {
        if (!el) continue;
        const style = el.style;
        if (style.overflow === 'hidden') style.removeProperty('overflow');
        if (style.position === 'fixed') style.removeProperty('position');
        if (style.getPropertyValue('pointer-events') === 'none') style.removeProperty('pointer-events');
        if (style.getPropertyValue('filter').indexOf('blur') >= 0) style.removeProperty('filter');
      }
      // 站点常给整页内容加 blur 来突出插屏广告，这里清掉它
      // ① 内联样式里带 blur 的元素（Google vignette 常用这种写法）
      let cleared = 0;
      let inline;
      try { inline = document.querySelectorAll('[style*="blur"]'); } catch (e) { inline = []; }
      for (const el of inline) {
        if (cleared >= 20) break;
        const attr = el.getAttribute('style') || '';
        if (attr.indexOf('blur') < 0) continue;
        el.style.setProperty('filter', 'none', 'important');
        el.style.setProperty('-webkit-filter', 'none', 'important');
        cleared += 1;
      }
      // ② body 往下两层内的容器（类名实现 blur 的情况）
      const targets = [];
      if (body) {
        targets.push(body, ...body.children);
        for (const child of body.children) {
          if (targets.length >= 60) break;
          if (child && child.children && child.children.length) targets.push(...child.children);
        }
      }
      let checkedCount = 0;
      for (const el of targets) {
        if (cleared >= 30 || checkedCount >= 80) break;
        if (!el || hiddenNodes.has(el)) continue;
        checkedCount += 1;
        let computed;
        try { computed = getComputedStyle(el); } catch (e) { continue; }
        if (computed.filter && computed.filter.indexOf('blur(') >= 0) {
          el.style.setProperty('filter', 'none', 'important');
          el.style.setProperty('-webkit-filter', 'none', 'important');
          cleared += 1;
        }
      }
      unlockScroll();
    } catch (e) { /* ignore */ }
  }

  /* ---------------------------------------------------------------- *
   *  广告位盒子（外层容器）扩展隐藏
   *  很多站点把 AdSense / GPT 广告塞进固定高度的盒子里（如 .ad_global）。
   *  只隐藏广告本体，盒子的高度会留下一大片空白，所以把外层盒子一并隐藏。
   * ---------------------------------------------------------------- */
  let expandingWrapper = false;

  /** 元素是否是“广告本体”（Google 标记 / 广告域名 iframe / 广告类名等） */
  function isAdElement(el) {
    try {
      const keywords = COSMETIC.adWrapper.keywords;
      const tag = (el.tagName || '').toLowerCase();
      const cls = typeof el.className === 'string' ? el.className : '';
      if (tag === 'ins' && /(^|\s)adsbygoogle(\s|$)/.test(cls)) return true;
      if (el.hasAttribute('data-ad-client') || el.hasAttribute('data-ad-slot') ||
          el.hasAttribute('data-google-av-adk') || el.hasAttribute('data-google-container-id') ||
          el.hasAttribute('data-google-query-id')) {
        return true;
      }
      if (/^(aswift_|google_ads_|google_ads_iframe|div-gpt-ad|gpt-passback)/.test(el.id || '')) return true;
      if (keywords.test(el.id || '') || keywords.test(cls)) return true;
      const src = el.getAttribute('src') || '';
      if (src && /(doubleclick\.net|googlesyndication\.com|googleadservices\.com|adservice\.google\.)/.test(src)) {
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  /** 向上找“广告位盒子”并隐藏（最多 cfg.maxDepth 层，遇到正文/表单容器立即停手） */
  function expandAdWrapper(node) {
    if (expandingWrapper) return;
    if (!settings.enabled || siteAllowed) return;
    if (!isAdElement(node)) return;
    const cfg = COSMETIC.adWrapper;
    expandingWrapper = true;
    try {
      let current = node;
      for (let depth = 0; depth < cfg.maxDepth && current; depth += 1) {
        const parent = current.parentElement;
        if (!parent || parent === document.body || parent === document.documentElement) return;
        if (hiddenNodes.has(parent)) return;
        const pcls = typeof parent.className === 'string' ? parent.className : '';
        if (!cfg.keywords.test(parent.id || '') && !cfg.keywords.test(pcls)) {
          current = parent; // 这层不是广告盒子，继续向上看
          continue;
        }
        if (isPageLike(parent)) return; // 含正文 / 导航 / 表单的容器绝不能动
        const info = rectInfo(parent);
        if (!info || info.ratio > cfg.maxAreaRatio) return;
        let children = 0;
        try { children = parent.querySelectorAll('*').length; } catch (e) { children = 0; }
        if (children > cfg.maxChildren) return;
        hideNode(parent);
        return;
      }
    } finally {
      expandingWrapper = false;
    }
  }

  /* ---------------------------------------------------------------- *
   *  广告点击拦截
   *  很多站点/广告联盟用「点击广告 → 从侧面滑出抽屉广告 / 弹出新层」的方式变现，
   *  这里在捕获阶段拦掉落在广告元素内部的点击，避免触发这类二次弹窗
   *  （元素本身通常已被隐藏，此函数是兜底防线）。
   * ---------------------------------------------------------------- */
  const CLICK_GUARD_SELECTOR = [
    'ins.adsbygoogle',
    'ins[data-ad-client]',
    'ins[data-ad-slot]',
    '[data-google-av-adk]',
    '[data-google-container-id]',
    '[data-google-query-id]',
    'iframe[id^="google_ads_iframe"]',
    'iframe[src*="doubleclick.net"]',
    'iframe[src*="googlesyndication.com"]',
    'iframe[src*="googleadservices.com"]',
    'iframe[src*="adservice.google"]',
    'div[id^="aswift_"]',
    'div[id^="google_ads_"]',
    'div[id^="div-gpt-ad"]',
    'div[id^="gpt-passback"]',
    '.google-auto-placed',
    '.GoogleActiveViewElement',
    '.google-aiuf',
    '.goog-rentries',
    '[id^="google-anno"]',
    '[class*="google-anno"]',
    '[data-anchor-status]',
    '[data-ad-modal]',
    '[data-admode="interstitial"]',
    '[data-adshield]'
  ].join(',');

  /** 广告位盒子的命名特征（比 adWrapper.keywords 更严：不含 promo / sponsor，避免挡住正常推广链接） */
  const CLICK_GUARD_KEYWORDS = /(^|[-_\s])(ads?|adv|advert|advertisement|advertorial|adsbygoogle|ad[-_]?(box|wrap|wrapper|slot|unit|global|container|banner|layer|overlay|click|block|area|holder|frame))([-_\s]|$)/i;

  function onAdClick(event) {
    if (!settings.enabled || siteAllowed || !settings.killOverlayAds) return;
    try {
      const target = event.target;
      if (!target || target.nodeType !== 1) return;
      let node = target.closest(CLICK_GUARD_SELECTOR) || null;
      if (!node) {
        // 再向上看 3 层，兜住「广告位盒子」这类外层容器
        let current = target;
        for (let depth = 0; depth < 3 && current; depth += 1) {
          const cls = typeof current.className === 'string' ? current.className : '';
          if (CLICK_GUARD_KEYWORDS.test(current.id || '') || CLICK_GUARD_KEYWORDS.test(cls)) { node = current; break; }
          current = current.parentElement;
        }
      }
      if (!node) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    } catch (e) { /* ignore */ }
  }

  document.addEventListener('click', onAdClick, true);
  document.addEventListener('auxclick', onAdClick, true);

  /* ---------------------------------------------------------------- *
   *  信息流「赞助 / 推广」内容清理
   * ---------------------------------------------------------------- */
  function scheduleSponsoredScan(delay) {
    if (!settings.enabled || siteAllowed || !settings.hideSponsored) return;
    if (sponsoredTimer) return;
    sponsoredTimer = setTimeout(() => {
      sponsoredTimer = null;
      runSponsoredScan();
    }, typeof delay === 'number' ? delay : 800);
  }

  function runSponsoredScan() {
    const rules = COSMETIC.sponsoredSites || [];
    for (const rule of rules) {
      if (!ADB.hostMatches(hostname, rule.host)) continue;
      let containers;
      try {
        containers = document.querySelectorAll(rule.container);
      } catch (e) {
        continue;
      }
      for (const container of containers) {
        if (hiddenNodes.has(container)) continue;
        if (isSponsored(container, rule)) hideNode(container);
      }
    }
  }

  function isSponsored(container, rule) {
    // 容器太小时不处理，避免把整个页面/列表误判
    if (!container || container === document.body || container === document.documentElement) return false;
    const all = container.querySelectorAll ? container.querySelectorAll('*') : null;
    if (!all || all.length < 2 || all.length > 4000) return false;

    let labels;
    try {
      labels = container.querySelectorAll(rule.labels);
    } catch (e) {
      return false;
    }
    let checked = 0;
    for (const label of labels) {
      if (++checked > 60) break;
      let text = '';
      try { text = (label.textContent || '').trim(); } catch (e) { continue; }
      if (!text || text.length > 24) continue;
      if (label.childElementCount > 2) continue;
      if (rule.text.test(text)) {
        // 标签必须靠近容器顶部（信息流广告的标记位于头部）
        const rect = label.getBoundingClientRect ? label.getBoundingClientRect() : null;
        const box = container.getBoundingClientRect ? container.getBoundingClientRect() : null;
        if (rect && box && box.height > 60 && rect.top - box.top > box.height * 0.6) continue;
        return true;
      }
    }
    return false;
  }

  /* ---------------------------------------------------------------- *
   *  悬浮广告清理（强力模式）
   * ---------------------------------------------------------------- */
  function scheduleFloatingScan() {
    if (floatingTimer) return;
    const now = Date.now();
    if (now - lastFloatingScan < 1500) return;
    floatingTimer = setTimeout(() => {
      floatingTimer = null;
      lastFloatingScan = Date.now();
      runFloatingScan();
    }, 700);
  }

  function runFloatingScan() {
    if (window.top !== window.self) return; // 只在顶层文档执行
    const cfg = COSMETIC.floatingAd;
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;
    if (!vw || !vh) return;
    const viewportArea = vw * vh;

    let candidates;
    try {
      candidates = document.querySelectorAll('div, aside, section, ins, iframe');
    } catch (e) {
      return;
    }
    let checked = 0;
    for (const el of candidates) {
      if (++checked > 3000) break;
      if (hiddenNodes.has(el)) continue;
      const id = (el.id || '') + ' ' + (typeof el.className === 'string' ? el.className : '');
      if (!id.trim() || !cfg.keywords.test(id)) continue;

      let style;
      try { style = getComputedStyle(el); } catch (e) { continue; }
      if (style.position !== 'fixed' && style.position !== 'sticky') continue;
      const zIndex = parseInt(style.zIndex, 10);
      if (!Number.isFinite(zIndex) || zIndex < cfg.minZIndex) continue;
      if (style.display === 'none' || style.visibility === 'hidden') continue;

      const rect = el.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 20) continue;
      const area = rect.width * rect.height;
      if (area > viewportArea * cfg.maxAreaRatio) continue;
      if (rect.height > vh * cfg.maxHeightRatio) continue;

      hideNode(el);
    }
  }

  /* ---------------------------------------------------------------- *
   *  统计上报
   * ---------------------------------------------------------------- */
  function scheduleReport() {
    if (reportTimer) return;
    reportTimer = setTimeout(flushReport, 900);
  }

  function flushReport() {
    reportTimer = null;
    if (!pendingReport) return;
    if (!canTalk()) { pendingReport = 0; return; }
    const count = pendingReport;
    pendingReport = 0;
    try {
      chrome.runtime.sendMessage({ type: 'cosmetic-hidden', count }, () => {
        // 读取 lastError 以避免 "Unchecked runtime.lastError" 噪音
        void chrome.runtime.lastError;
      });
    } catch (e) {
      pendingReport = 0;
    }
  }

  /* ---------------------------------------------------------------- *
   *  设置加载 / 监听
   * ---------------------------------------------------------------- */
  function applySettings(next) {
    const wasAllowed = siteAllowed;
    settings = next;
    siteAllowed = ADB.hostInList(hostname, settings.allowlist);
    if (wasAllowed !== siteAllowed) hiddenNodes.clear();
    applySelectors();
    postSettingsToMainWorld();
    if (settings.hideSponsored) scheduleSponsoredScan(300);
  }

  /** 把开关状态同步给主世界脚本（用于 window.open 弹窗拦截） */
  function postSettingsToMainWorld() {
    try {
      window.postMessage({
        __adshield: 'settings',
        // settings 尚未从 storage 读出前不下发“启用”，避免全局关闭时短暂生效
        enabled: ready && settings.enabled && !siteAllowed,
        blockPopupWindows: settings.blockPopupWindows !== false
      }, '*');
    } catch (e) { /* ignore */ }
  }

  window.addEventListener('message', event => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__adshield !== 'ready') return;
    postSettingsToMainWorld();
  }, false);

  function loadSettings() {
    if (!canTalk() || !chrome.storage || !chrome.storage.local) {
      ready = true; // 无扩展环境（如本地测试页）：直接按当前设置生效
      applySettings(settings);
      return;
    }
    chrome.storage.local.get('settings', data => {
      void chrome.runtime.lastError;
      ready = true;
      applySettings(ADB.mergeSettings(data && data.settings));
    });
  }

  if (canTalk() && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.settings) return;
      applySettings(ADB.mergeSettings(changes.settings.newValue));
    });
  }

  /* ---------------------------------------------------------------- *
   *  消息接口
   * ---------------------------------------------------------------- */
  if (canTalk()) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || typeof msg !== 'object') return false;
      if (msg.type === 'rescan') {
        hiddenNodes.clear();
        currentCss = '';
        applySelectors();
        if (settings.hideSponsored) runSponsoredScan();
        killOverlayAds();
        sendResponse({ ok: true, hidden: hiddenNodes.size, overlays: overlayKilledTotal });
        return true;
      }
      if (msg.type === 'get-count') {
        sendResponse({
          hidden: hiddenNodes.size,
          overlays: overlayKilledTotal,
          host: hostname,
          allowed: siteAllowed
        });
        return true;
      }
      return false;
    });
  }

  /* ---------------------------------------------------------------- *
   *  启动
   * ---------------------------------------------------------------- */
  function startObserver() {
    if (observer || !document.documentElement) return;
    observer = new MutationObserver(mutations => {
      for (const m of mutations) {
        if (!m.addedNodes || !m.addedNodes.length) continue;
        scanSoon(120);
        if (settings.hideSponsored) scheduleSponsoredScan(900);
        break;
      }
    });
    try {
      observer.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) { /* ignore */ }
  }

  function boot() {
    applySettings(settings); // 先用默认设置注入一遍，减少闪烁
    startObserver();
    loadSettings();

    // 插屏广告常常在页面加载后几秒才弹出，额外做几次延迟清理
    for (const delay of [1200, 3500, 7000, 12000]) {
      setTimeout(() => {
        if (settings.killOverlayAds) killOverlayAds();
      }, delay);
    }

    document.addEventListener('DOMContentLoaded', () => {
      applySelectors();
      postSettingsToMainWorld();
      if (settings.hideSponsored) scheduleSponsoredScan(500);
      if (settings.killOverlayAds) killOverlayAds();
    }, { once: true });

    window.addEventListener('load', () => {
      scanSoon(400);
      if (settings.hideSponsored) scheduleSponsoredScan(1000);
      if (settings.hideAggressive) scheduleFloatingScan();
      if (settings.killOverlayAds) killOverlayAds();
    }, { once: true });

    // 单页应用（SPA）路由切换后再扫一遍
    let lastUrl = location.href;
    setInterval(() => {
      if (!ready && !canTalk()) return;
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        hiddenNodes.clear();
        currentCss = '';
        applySelectors();
        postSettingsToMainWorld();
        if (settings.hideSponsored) scheduleSponsoredScan(1200);
        if (settings.killOverlayAds) killOverlayAds();
      }
    }, 1500);
  }

  if (document.readyState === 'loading') {
    boot();
  } else {
    boot();
  }
})();
