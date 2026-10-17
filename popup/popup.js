/*! 净屏 · 广告拦截 — 弹窗逻辑 */
(function () {
  'use strict';

  const ADB = window.ADB;
  const I18N = window.AdShieldI18n;
  const hasExtension = typeof chrome !== 'undefined' &&
    !!(chrome.runtime && chrome.runtime.id && chrome.storage && chrome.storage.local);

  const $ = id => document.getElementById(id);
  const nodes = {
    globalToggle: $('global-toggle'),
    siteCard: $('site-card'),
    siteHost: $('site-host'),
    siteToggle: $('site-toggle'),
    siteHint: $('site-hint'),
    summary: $('summary'),
    statNet: $('stat-net'),
    statCos: $('stat-cos'),
    statToday: $('stat-today'),
    optAds: $('opt-ads'),
    optTrackers: $('opt-trackers'),
    optHide: $('opt-hide'),
    optOverlay: $('opt-overlay'),
    optSponsored: $('opt-sponsored'),
    optPopup: $('opt-popup'),
    btnRescan: $('btn-rescan'),
    btnReset: $('btn-reset'),
    btnOptions: $('btn-options'),
    footnote: $('footnote')
  };

  let tabId = -1;
  let state = null;
  let busy = false;

  function send(message) {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage(message, response => {
          void chrome.runtime.lastError;
          resolve(response || null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  async function refresh() {
    if (!hasExtension) return;
    const response = await send({ type: 'get-state', tabId });
    if (response && !response.error) state = response;
    render();
  }

  async function act(message) {
    if (!hasExtension || busy) return;
    busy = true;
    setButtonsEnabled(false);
    const response = await send(Object.assign({ tabId }, message));
    busy = false;
    setButtonsEnabled(true);
    if (response && !response.error) state = response;
    else if (response && response.error) flash(response.error);
    render();
  }

  function setButtonsEnabled(value) {
    nodes.btnRescan.disabled = !value;
    nodes.btnReset.disabled = !value;
  }

  let flashTimer = null;
  function flash(text) {
    nodes.footnote.textContent = text;
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      flashTimer = null;
      renderFootnote();
    }, 2600);
  }

  function renderFootnote() {
    if (!state) return;
    if (!state.canCountNetwork) {
      nodes.footnote.textContent = I18N.t('popup_foot_net_limited');
    } else {
      nodes.footnote.textContent = I18N.t('popup_foot_applied');
    }
  }

  function render() {
    if (!state) return;
    const s = state.settings;
    const on = s.enabled;

    nodes.globalToggle.checked = on;
    document.body.classList.toggle('is-off', !on);

    nodes.siteHost.textContent = state.host || I18N.t('popup_page_unsupported');
    nodes.siteHost.classList.toggle('badge-paused', !!state.allowed);

    const siteSwitchable = on && state.supported;
    nodes.siteToggle.disabled = !siteSwitchable;
    nodes.siteToggle.checked = !!state.allowed;

    if (!state.supported) {
      nodes.siteHint.textContent = I18N.t('popup_hint_builtin');
      nodes.siteHint.classList.remove('is-paused');
    } else if (state.allowed) {
      nodes.siteHint.textContent = I18N.t('popup_hint_paused');
      nodes.siteHint.classList.add('is-paused');
    } else if (!on) {
      nodes.siteHint.textContent = I18N.t('popup_hint_off');
      nodes.siteHint.classList.add('is-paused');
    } else {
      nodes.siteHint.textContent = I18N.t('popup_hint_active');
      nodes.siteHint.classList.remove('is-paused');
    }

    nodes.statNet.textContent = ADB.formatNumber(state.tabStats.net);
    nodes.statCos.textContent = ADB.formatNumber(state.tabStats.cos);
    nodes.statToday.textContent = ADB.formatNumber(state.todayCount);

    const kb = s;
    nodes.optAds.checked = kb.blockAds;
    nodes.optTrackers.checked = kb.blockTrackers;
    nodes.optHide.checked = kb.hideAds;
    nodes.optOverlay.checked = kb.killOverlayAds;
    nodes.optSponsored.checked = kb.hideSponsored;
    nodes.optPopup.checked = kb.blockPopupWindows;
    for (const input of [nodes.optAds, nodes.optTrackers, nodes.optHide,
      nodes.optOverlay, nodes.optSponsored, nodes.optPopup]) {
      input.disabled = !on;
    }

    const total = state.tabStats.net + state.tabStats.cos;
    nodes.summary.textContent = !on
      ? I18N.t('popup_state_paused')
      : (total > 0 ? I18N.t('popup_state_done', [ADB.formatNumber(total)]) : I18N.t('popup_state_none'));

    renderFootnote();
  }

  function bind() {
    nodes.globalToggle.addEventListener('change', () => {
      act({ type: 'toggle-global', enabled: nodes.globalToggle.checked });
    });

    nodes.siteToggle.addEventListener('change', () => {
      act({ type: 'toggle-site', host: state ? state.host : '', paused: nodes.siteToggle.checked });
    });

    const map = [
      [nodes.optAds, 'blockAds'],
      [nodes.optTrackers, 'blockTrackers'],
      [nodes.optHide, 'hideAds'],
      [nodes.optOverlay, 'killOverlayAds'],
      [nodes.optSponsored, 'hideSponsored'],
      [nodes.optPopup, 'blockPopupWindows']
    ];
    for (const [input, key] of map) {
      input.addEventListener('change', () => {
        const patch = {};
        patch[key] = input.checked;
        act({ type: 'update-settings', patch });
      });
    }

    nodes.btnRescan.addEventListener('click', async () => {
      if (!hasExtension || busy) return;
      busy = true;
      setButtonsEnabled(false);
      const result = await send({ type: 'rescan', tabId });
      busy = false;
      setButtonsEnabled(true);
      if (result && result.error) flash(result.error);
      await refresh();
    });

    nodes.btnReset.addEventListener('click', () => act({ type: 'reset-stats' }));

    nodes.btnOptions.addEventListener('click', () => {
      if (hasExtension) chrome.runtime.openOptionsPage();
    });
  }

  /** 直接打开 popup.html 预览时使用的演示数据 */
  function renderDemo() {
    state = {
      settings: Object.assign({}, ADB.DEFAULTS),
      host: 'news.example.com',
      supported: true,
      allowed: false,
      tabStats: { net: 27, cos: 143 },
      todayCount: 2861,
      canCountNetwork: true
    };
    bind();
    render();
    nodes.globalToggle.disabled = false;
    nodes.footnote.textContent = I18N.t('popup_demo');
  }

  async function init() {
    if (!hasExtension) {
      renderDemo();
      return;
    }
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = Array.isArray(tabs) ? tabs[0] : null;
      if (tab && typeof tab.id === 'number') tabId = tab.id;
    } catch (e) { /* ignore */ }
    bind();
    await refresh();
  }

  document.addEventListener('DOMContentLoaded', init);
  if (document.readyState !== 'loading') init();
})();
