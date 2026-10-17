/*! 净屏 · 广告拦截 — 设置页逻辑 */
(function () {
  'use strict';

  const ADB = window.ADB;
  const I18N = window.AdShieldI18n;
  const hasExtension = typeof chrome !== 'undefined' &&
    !!(chrome.runtime && chrome.runtime.id && chrome.storage && chrome.storage.local);

  const $ = id => document.getElementById(id);
  const TOGGLE_IDS = ['enabled', 'blockAds', 'blockTrackers', 'blockAnnoyances', 'blockVideoAds',
    'killOverlayAds', 'blockPopupWindows',
    'hideAds', 'hideSponsored', 'hideOverlays', 'hideAggressive', 'showBadge'];

  let settings = ADB.mergeSettings(null);
  let saveTimer = null;
  let toastTimer = null;
  let statsCache = { today: 0, date: ADB.today(), canCount: true };

  /* ------------------------------ 工具 ------------------------------ */
  function send(message) {
    return new Promise(resolve => {
      if (!hasExtension) return resolve(null);
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

  function toast(text, ms) {
    const el = $('toast');
    el.textContent = text;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('show'));
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastTimer = null;
      el.classList.remove('show');
      setTimeout(() => { el.hidden = true; }, 220);
    }, ms || 2000);
  }

  function showSaved() {
    const flag = $('save-flag');
    flag.classList.add('show');
    setTimeout(() => flag.classList.remove('show'), 1400);
  }

  /* ------------------------------ 渲染 ------------------------------ */
  function renderToggles() {
    for (const id of TOGGLE_IDS) {
      const input = $(id);
      if (input) input.checked = !!settings[id];
    }
    const off = !settings.enabled;
    for (const id of TOGGLE_IDS) {
      if (id === 'enabled') continue;
      const input = $(id);
      if (input) input.disabled = off;
    }
  }

  function renderAllowlist() {
    $('allowlist').value = settings.allowlist.join('\n');
    updateAllowlistCount();
  }

  function updateAllowlistCount() {
    $('allowlist-count').textContent = I18N.t('allowlist_count', [settings.allowlist.length]);
  }

  function renderUserRules() {
    $('userRules').value = settings.userRules.join('\n');
    updateRulesSummary();
  }

  function updateRulesSummary() {
    const parsed = ADB.parseUserRules(settings.userRules);
    $('rules-count').textContent = I18N.t('rules_count', [parsed.network.length, parsed.cosmetic.length]);
    const blocked = parsed.cosmetic.filter(r => !r.exception).length;
    $('rules-error').textContent = (parsed.network.length + blocked === 0 && settings.userRules.length)
      ? I18N.t('rules_warn')
      : '';
  }

  function renderStats() {
    $('stat-today').textContent = ADB.formatNumber(statsCache.today);
    $('stat-daily-date').textContent = statsCache.date;
    $('stat-network-support').textContent = I18N.t(statsCache.canCount ? 'stat_available' : 'stat_limited');
    $('footer-note').textContent = I18N.t(
      statsCache.canCount ? 'footer_enabled' : 'footer_limited',
      [ADB.VERSION]
    );
  }

  /* ------------------------------ 保存 ------------------------------ */
  function collect() {
    const next = Object.assign({}, settings);
    for (const id of TOGGLE_IDS) {
      const input = $(id);
      if (input) next[id] = input.checked;
    }
    next.allowlist = $('allowlist').value.split(/[\n,;]+/).map(v => v.trim()).filter(Boolean);
    next.userRules = $('userRules').value.split('\n').map(v => v.replace(/\s+$/, '')).filter(Boolean);
    return ADB.mergeSettings(next);
  }

  /** 保存：只读取控件内容，不回写控件（避免输入时光标跳动） */
  async function save(showToast) {
    settings = collect();
    updateRulesSummary();
    updateAllowlistCount();
    if (!hasExtension) {
      showSaved();
      return;
    }
    try {
      await chrome.storage.local.set({ settings });
    } catch (e) { /* ignore */ }
    showSaved();
    if (showToast) toast(I18N.t('toast_saved'));
  }

  /** 保存并把设置回写到所有控件（导入 / 恢复默认时使用） */
  async function saveAndRender() {
    await save(false);
    renderToggles();
    renderAllowlist();
    renderUserRules();
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      save(false);
    }, 450);
  }

  /* ------------------------------ 规则条数 ------------------------------ */
  async function loadRuleCounts() {
    const map = { ads: 'ads', trackers: 'trackers', annoyances: 'annoyances', video: 'video' };
    const entries = Object.entries(map);
    await Promise.all(entries.map(async ([rulesetId, file]) => {
      const node = document.querySelector(`.count[data-count="${rulesetId}"]`);
      if (!node) return;
      try {
        const base = hasExtension ? chrome.runtime.getURL('rules/' + file + '.json') : '../rules/' + file + '.json';
        const response = await fetch(base);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const rules = await response.json();
        node.textContent = Array.isArray(rules) ? I18N.t('count_rules', [rules.length]) : '';
      } catch (e) {
        node.textContent = '';
      }
    }));
  }

  /* ------------------------------ 统计 ------------------------------ */
  async function loadStats() {
    if (!hasExtension) {
      statsCache = { today: 2861, date: ADB.today(), canCount: true };
      renderStats();
      return;
    }
    const [daily, state] = await Promise.all([
      chrome.storage.local.get('daily').catch(() => ({})),
      send({ type: 'get-state', tabId: -1 })
    ]);
    const today = ADB.today();
    statsCache = {
      today: (daily && daily.daily && daily.daily.date === today) ? daily.daily.count : 0,
      date: (daily && daily.daily && daily.daily.date) || today,
      canCount: !state || state.canCountNetwork !== false
    };
    renderStats();
  }

  /* ------------------------------ 事件 ------------------------------ */
  function bind() {
    for (const id of TOGGLE_IDS) {
      const input = $(id);
      if (input) input.addEventListener('change', scheduleSave);
    }

    $('allowlist').addEventListener('input', scheduleSave);
    $('userRules').addEventListener('input', scheduleSave);

    $('btn-reset-stats').addEventListener('click', async () => {
      if (!hasExtension) return toast(I18N.t('toast_demo'));
      await send({ type: 'reset-stats', tabId: -1 });
      statsCache.today = 0;
      renderStats();
      toast(I18N.t('toast_stats_reset'));
    });

    $('btn-export').addEventListener('click', async () => {
      settings = collect();
      const payload = {
        app: 'AdShield',
        version: ADB.VERSION,
        exportedAt: new Date().toISOString(),
        settings
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'adshield-settings.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast(I18N.t('toast_exported'));
    });

    $('btn-import').addEventListener('click', () => $('import-file').click());

    $('import-file').addEventListener('change', async event => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const incoming = data && data.settings ? data.settings : data;
        settings = ADB.mergeSettings(incoming);
        await saveAndRender();
        toast(I18N.t('toast_imported'));
      } catch (e) {
        toast(I18N.t('toast_import_failed'), 2800);
      } finally {
        event.target.value = '';
      }
    });

    $('btn-reset-all').addEventListener('click', async () => {
      if (!confirm(I18N.t('confirm_reset'))) return;
      settings = ADB.mergeSettings(null);
      await saveAndRender();
      toast(I18N.t('toast_reset_done'));
    });

    window.addEventListener('beforeunload', () => {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
        save(false);
      }
    });
  }

  /* ------------------------------ 启动 ------------------------------ */
  async function init() {
    if (new URLSearchParams(location.search).has('welcome')) {
      $('welcome').hidden = false;
    }
    bind();

    if (hasExtension) {
      try {
        const data = await chrome.storage.local.get('settings');
        settings = ADB.mergeSettings(data && data.settings);
      } catch (e) { /* ignore */ }
    }

    renderToggles();
    renderAllowlist();
    renderUserRules();
    loadRuleCounts();
    loadStats();

    $('version-line').textContent = hasExtension
      ? I18N.t('version_line', [ADB.VERSION])
      : I18N.t('version_demo');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
