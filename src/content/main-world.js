/*! 净屏 · 广告拦截 (AdShield) — 主世界（MAIN world）脚本
 *
 *  作用：拦截脚本自动弹出的广告窗口
 *    · 包装 window.open：目标域名是广告/弹窗联盟域名、或形如 ad.xxx / click.xxx
 *      的子域时直接拦掉；无地址（about:blank）的弹窗仅在「非用户触发」时拦截。
 *    · 包装 <a>.click()：脚本伪造点击、且目标为广告域名时拦掉（用户真实点击不受影响）。
 *
 *  说明：主世界无法访问 chrome.* API，设置由隔离世界脚本通过 postMessage 同步过来。
 *  策略偏保守：用户主动点击产生的正常弹窗（登录、支付、分享等）一律放行。
 */
(function () {
  'use strict';

  if (window.__adshieldMain) return;
  window.__adshieldMain = true;

  const state = { enabled: false, block: true };

  /* 明确的广告 / 弹窗联盟域名 */
  const BLOCK_HOSTS = [
    'doubleclick.net',
    'googleadservices.com',
    'googlesyndication.com',
    'adtrafficquality.google',
    'adsterra.com',
    'propellerads.com',
    'propellerpops.com',
    'popads.net',
    'popcash.net',
    'popmyads.com',
    'mypopads.com',
    'exoclick.com',
    'exosrv.com',
    'juicyads.com',
    'trafficjunky.net',
    'trafficholder.com',
    'hilltopads.net',
    'clickadu.com',
    'adcash.com',
    'onclickalgo.com',
    'galaksion.com',
    'evadav.com',
    'richads.com',
    'clickaine.com',
    'adprofex.com',
    'adspyglass.com',
    'admaven.com',
    'ad-maven.com',
    'monetizemore.com',
    'revenuehits.com',
    'adnium.com',
    'zeropark.com',
    'plugrush.com',
    'trafficshop.com',
    'adplugg.com'
  ];

  /* 形如 ad.example.com / click.example.com / pop.example.com / track.example.com */
  const AD_HOST_RE = /(^|\.)(ads?|adv|adservice|advert|advertising|pop|popup|popunder|promo|click|clicktrack|trk|track|tracking|traffic|syndication|banner)\d*\./i;

  /* ---------------------------- 设置同步 ---------------------------- */
  window.addEventListener('message', event => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__adshield !== 'settings') return;
    state.enabled = !!data.enabled;
    state.block = data.blockPopupWindows !== false;
  }, false);

  /* ---------------------------- 判断逻辑 ---------------------------- */
  function hasActivation() {
    const ua = navigator.userActivation;
    if (!ua) return true; // 无法判断时保守放行
    return !!ua.isActive;
  }

  function hostOf(url) {
    try {
      return new URL(url, location.href).hostname.toLowerCase();
    } catch (e) {
      return '';
    }
  }

  function isAdHost(host) {
    if (!host) return false;
    for (const blocked of BLOCK_HOSTS) {
      if (host === blocked || host.endsWith('.' + blocked)) return true;
    }
    return AD_HOST_RE.test(host + '.');
  }

  function shouldBlockUrl(rawUrl) {
    if (!state.enabled || !state.block) return false;
    const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
    if (!url || url === 'about:blank' || url.startsWith('javascript:')) {
      // 没有目标的弹窗：只有非用户触发时才拦截，避免影响正常功能
      return !hasActivation();
    }
    return isAdHost(hostOf(url));
  }

  /* ---------------------------- 拦截 window.open ---------------------------- */
  const nativeOpen = window.open;
  window.open = function (url, name, features) {
    try {
      if (shouldBlockUrl(url)) {
        console.info('[AdShield] 已拦截广告弹窗：', url);
        return null;
      }
    } catch (e) { /* 任何异常都不影响原行为 */ }
    return nativeOpen.apply(this, arguments);
  };
  try {
    window.open.toString = function () { return nativeOpen.toString(); };
  } catch (e) { /* ignore */ }

  /* ------------------- 拦截脚本伪造的 _blank 链接点击（popunder） ------------------- */
  const nativeClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    try {
      const target = this.getAttribute('target') || '';
      if (state.enabled && state.block && !hasActivation() && target === '_blank' && this.href && isAdHost(hostOf(this.href))) {
        console.info('[AdShield] 已拦截脚本触发的广告跳转：', this.href);
        return;
      }
    } catch (e) { /* ignore */ }
    return nativeClick.apply(this, arguments);
  };
  try {
    HTMLAnchorElement.prototype.click.toString = function () { return nativeClick.toString(); };
  } catch (e) { /* ignore */ }

  /* 告知隔离世界脚本：可以下发设置了 */
  try {
    window.postMessage({ __adshield: 'ready' }, '*');
  } catch (e) { /* ignore */ }
})();
