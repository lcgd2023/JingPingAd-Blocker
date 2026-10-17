/*! 净屏 · 广告拦截 (AdShield) — 后台 Service Worker
 *  职责：同步静态/动态/会话规则、维护拦截统计、刷新角标、响应弹窗与内容脚本的消息。
 */
'use strict';

importScripts('shared/config.js', 'shared/i18n.js');

const ADB = self.ADB;
const I18N = self.AdShieldI18n;
const DNR = chrome.declarativeNetRequest;

const DYNAMIC_BASE = 10000;      // 用户自定义网络规则 ID 起始值
const SESSION_BASE = 800000;     // 网站白名单（会话规则）ID 起始值
const MAX_USER_RULES = 800;
const MAX_ALLOWLIST_RULES = 500;
const BADGE_COLOR = '#4f46e5';
const BADGE_OFF_COLOR = '#9aa0a6';
const MAX_BADGE_TEXT = '999+';

/** 运行时状态（Service Worker 可能被随时回收，靠 ensure() 重新水合） */
let settings = ADB.mergeSettings(null);
let hydrated = false;
let stats = Object.create(null);            // tabId -> { net, cos }
let daily = { date: ADB.today(), count: 0 }; // 今日累计（内存缓存 + 防抖落盘）
let allowRuleIds = { _session: new Set(), _dynamic: new Set() };
let dirtyTabs = new Set();
let persistTimer = null;
let dailyTimer = null;

/* ------------------------------------------------------------------ *
 *  状态水合
 * ------------------------------------------------------------------ */
async function ensure() {
  if (hydrated) return;
  let local = {};
  let session = {};
  try { local = await chrome.storage.local.get(['settings', 'daily']); } catch (e) { /* ignore */ }
  try { session = await chrome.storage.session.get('tabStats'); } catch (e) { /* ignore */ }
  settings = ADB.mergeSettings(local && local.settings);
  let stored = session && session.tabStats;
  if (typeof stored === 'string') {
    try { stored = JSON.parse(stored); } catch (e) { stored = null; }
  }
  stats = (stored && typeof stored === 'object') ? stored : Object.create(null);
  const today = ADB.today();
  daily = (local && local.daily && local.daily.date === today && Number.isFinite(local.daily.count))
    ? { date: today, count: local.daily.count }
    : { date: today, count: 0 };
  hydrated = true;
}

async function saveSettings(next) {
  settings = ADB.mergeSettings(next);
  await chrome.storage.local.set({ settings });
  return settings;
}

/** 修改部分设置项 */
async function patchSettings(patch) {
  await ensure();
  return saveSettings(ADB.patchSettings(settings, patch));
}

/* ------------------------------------------------------------------ *
 *  规则同步
 * ------------------------------------------------------------------ */
async function applyRulesets() {
  const want = new Set();
  if (settings.enabled) {
    for (const [rulesetId, key] of Object.entries(ADB.RULESET_SETTING)) {
      if (settings[key]) want.add(rulesetId);
    }
  }
  let current;
  try {
    current = new Set(await DNR.getEnabledRulesets());
  } catch (e) {
    return;
  }
  const enableRulesetIds = [...want].filter(id => !current.has(id));
  const disableRulesetIds = [...current].filter(id => !want.has(id));
  if (!enableRulesetIds.length && !disableRulesetIds.length) return;
  try {
    await DNR.updateEnabledRulesets({ enableRulesetIds, disableRulesetIds });
  } catch (e) {
    console.warn('[AdShield] 更新静态规则集失败：', e);
  }
}

async function applyDynamicRules() {
  const existing = await DNR.getDynamicRules();
  const removeRuleIds = existing.map(r => r.id);
  const addRules = [];
  const blockIds = new Set();
  const allowIds = new Set();

  if (settings.enabled) {
    const { network } = ADB.parseUserRules(settings.userRules);
    let id = DYNAMIC_BASE;
    for (const rule of network) {
      if (addRules.length >= MAX_USER_RULES) break;
      const resourceTypes = rule.resourceTypes && rule.resourceTypes.length
        ? rule.resourceTypes
        : ADB.ALL_RESOURCE_TYPES;
      const condition = { urlFilter: rule.urlFilter, resourceTypes };
      const rid = id++;
      addRules.push({
        id: rid,
        priority: rule.exception ? 3 : 2,
        action: rule.exception ? { type: 'allow' } : { type: 'block' },
        condition
      });
      if (rule.exception) allowIds.add(rid);
      else blockIds.add(rid);
    }
  }

  allowRuleIds._dynamic = allowIds;
  await updateRulesSafely(DNR.updateDynamicRules.bind(DNR), removeRuleIds, addRules, '自定义规则');
}

/** 先整体替换，若某条规则非法则逐条降级处理，避免一条错误导致全部失效 */
async function updateRulesSafely(updater, removeRuleIds, addRules, label) {
  try {
    await updater({ removeRuleIds, addRules });
    return addRules;
  } catch (e) {
    console.warn(`[AdShield] ${label}整体更新失败，改为逐条写入：`, e);
  }
  try {
    await updater({ removeRuleIds, addRules: [] });
  } catch (e) {
    console.warn(`[AdShield] 清理${label}失败：`, e);
  }
  const accepted = [];
  for (const rule of addRules) {
    try {
      await updater({ removeRuleIds: [], addRules: [rule] });
      accepted.push(rule);
    } catch (e) {
      console.warn(`[AdShield] 跳过非法${label}：`, rule, e);
    }
  }
  return accepted;
}

async function applySessionRules() {
  const existing = await DNR.getSessionRules();
  const removeRuleIds = existing.map(r => r.id);
  const addRules = [];
  const allowIds = new Set();

  if (settings.enabled) {
    let id = SESSION_BASE;
    for (const host of settings.allowlist.slice(0, MAX_ALLOWLIST_RULES)) {
      const rid = id++;
      allowIds.add(rid);
      addRules.push({
        id: rid,
        priority: 10,
        action: { type: 'allowAllRequests' },
        condition: {
          urlFilter: `||${host}^`,
          resourceTypes: ['main_frame', 'sub_frame']
        }
      });
    }
  }

  allowRuleIds._session = allowIds;
  await updateRulesSafely(DNR.updateSessionRules.bind(DNR), removeRuleIds, addRules, '白名单规则');
}

async function applyAll() {
  await ensure();
  await applyRulesets();
  await applyDynamicRules();
  await applySessionRules();
  refreshVisibleBadges();
}

/* ------------------------------------------------------------------ *
 *  统计与角标
 * ------------------------------------------------------------------ */
function tabEntry(tabId) {
  let entry = stats[tabId];
  if (!entry) {
    entry = { net: 0, cos: 0 };
    stats[tabId] = entry;
  }
  return entry;
}

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(async () => {
    persistTimer = null;
    try {
      await chrome.storage.session.set({ tabStats: stats });
    } catch (e) { /* ignore */ }
  }, 600);
}

async function bumpDaily(n) {
  if (!n) return;
  const today = ADB.today();
  if (daily.date !== today) daily = { date: today, count: 0 };
  daily.count += n;
  if (dailyTimer) return;
  dailyTimer = setTimeout(() => {
    dailyTimer = null;
    chrome.storage.local.set({ daily }).catch(() => {});
  }, 1200);
}

function addCount(kind, tabId, n) {
  if (!n) return;
  if (typeof tabId === 'number' && tabId >= 0) {
    const entry = tabEntry(tabId);
    if (kind === 'net') entry.net += n;
    else entry.cos += n;
    dirtyTabs.add(tabId);
    scheduleBadge();
    schedulePersist();
  }
  bumpDaily(n);
}

function scheduleBadge() {
  if (badgeTimer) return;
  badgeTimer = setTimeout(() => {
    badgeTimer = null;
    const tabs = [...dirtyTabs];
    dirtyTabs.clear();
    for (const tabId of tabs) updateBadge(tabId);
  }, 200);
}

async function hostAllowedForTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || !tab.url) return false;
    const url = new URL(tab.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return true;
    return ADB.hostInList(url.hostname, settings.allowlist);
  } catch (e) {
    return false;
  }
}

async function updateBadge(tabId) {
  if (tabId == null || tabId < 0) return;
  let text = '';
  let color = BADGE_COLOR;
  try {
    if (!settings.showBadge) {
      await chrome.action.setBadgeText({ tabId, text: '' });
      return;
    }
    if (!settings.enabled) {
      text = 'OFF';
      color = BADGE_OFF_COLOR;
    } else if (await hostAllowedForTab(tabId)) {
      text = 'OFF';
      color = BADGE_OFF_COLOR;
    } else {
      const entry = stats[tabId];
      const total = (entry ? entry.net + entry.cos : 0);
      text = total > 999 ? MAX_BADGE_TEXT : (total ? String(total) : '');
    }
  } catch (e) {
    return;
  }
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color });
    await chrome.action.setBadgeText({ tabId, text });
  } catch (e) { /* 标签页可能已被关闭 */ }
}

function refreshVisibleBadges() {
  chrome.tabs.query({}, tabs => {
    void chrome.runtime.lastError;
    if (!Array.isArray(tabs)) return;
    for (const tab of tabs) {
      if (tab && typeof tab.id === 'number') updateBadge(tab.id);
    }
  });
}

function resetTabStats(tabId) {
  if (tabId == null || tabId < 0) return;
  stats[tabId] = { net: 0, cos: 0 };
  schedulePersist();
  updateBadge(tabId);
}

/* ------------------------------------------------------------------ *
 *  拦截计数（仅开发/未打包扩展可用，缺少权限时降级为仅统计元素隐藏）
 * ------------------------------------------------------------------ */
if (DNR && DNR.onRuleMatchedDebug) {
  DNR.onRuleMatchedDebug.addListener(info => {
    if (!info || !info.request || !info.rule) return;
    const { rulesetId, ruleId } = info.rule;
    const allowSet = allowRuleIds[rulesetId];
    if (allowSet && allowSet.has(ruleId)) return; // 放行规则不计入
    addCount('net', info.request.tabId, 1);
  });
} else {
  console.info('[AdShield] 未获得 declarativeNetRequestFeedback 权限，网络拦截计数不可用。');
}

/* ------------------------------------------------------------------ *
 *  生命周期
 * ------------------------------------------------------------------ */
chrome.runtime.onInstalled.addListener(async details => {
  await ensure();
  await saveSettings(settings);
  await applyAll();
  if (details && details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html?welcome=1') });
  }
});

chrome.runtime.onStartup.addListener(() => {
  hydrated = false;
  applyAll();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' || typeof changeInfo.url === 'string') {
    resetTabStats(tabId);
  }
});

chrome.tabs.onRemoved.addListener(tabId => {
  if (stats[tabId]) {
    delete stats[tabId];
    schedulePersist();
  }
});

chrome.tabs.onActivated.addListener(info => {
  if (info && typeof info.tabId === 'number') updateBadge(info.tabId);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  settings = ADB.mergeSettings(changes.settings.newValue);
  hydrated = true;
  applyAll();
});

/* ------------------------------------------------------------------ *
 *  消息处理
 * ------------------------------------------------------------------ */
async function buildState(tabId) {
  await ensure();
  let tab = null;
  let host = '';
  let supported = false;
  let allowed = false;
  if (typeof tabId === 'number' && tabId >= 0) {
    try { tab = await chrome.tabs.get(tabId); } catch (e) { tab = null; }
  }
  if (tab && tab.url) {
    try {
      const url = new URL(tab.url);
      host = url.hostname;
      supported = url.protocol === 'http:' || url.protocol === 'https:';
      allowed = ADB.hostInList(host, settings.allowlist);
    } catch (e) { /* ignore */ }
  }
  const today = ADB.today();
  const entry = typeof tabId === 'number' ? stats[tabId] : null;
  return {
    settings,
    host,
    supported,
    allowed,
    tabId: typeof tabId === 'number' ? tabId : -1,
    todayCount: daily.date === today ? daily.count : 0,
    tabStats: entry ? { net: entry.net, cos: entry.cos } : { net: 0, cos: 0 },
    canCountNetwork: !!(DNR && DNR.onRuleMatchedDebug),
    version: ADB.VERSION
  };
}

async function handleMessage(msg, sender) {
  const type = msg && msg.type;
  const senderTabId = sender && sender.tab ? sender.tab.id : -1;

  switch (type) {
    case 'get-state':
      return buildState(typeof msg.tabId === 'number' ? msg.tabId : senderTabId);

    case 'update-settings':
      await patchSettings(msg.patch || {});
      await applyAll();
      return buildState(typeof msg.tabId === 'number' ? msg.tabId : senderTabId);

    case 'toggle-global': {
      const enabled = msg.enabled !== undefined ? !!msg.enabled : !settings.enabled;
      await patchSettings({ enabled });
      await applyAll();
      return buildState(msg.tabId);
    }

    case 'toggle-site': {
      await ensure();
      const host = ADB.normalizeHost(msg.host || '');
      if (!host) return { error: I18N.t('err_invalid_host') };
      const allow = new Set(settings.allowlist);
      const paused = msg.paused !== undefined ? !!msg.paused : !allow.has(host);
      if (paused) allow.add(host); else allow.delete(host);
      await saveSettings(Object.assign({}, settings, { allowlist: [...allow] }));
      await applyAll();
      const tabId = typeof msg.tabId === 'number' ? msg.tabId : senderTabId;
      resetTabStats(tabId);
      let notified = false;
      if (tabId >= 0) {
        try {
          await chrome.tabs.sendMessage(tabId, { type: 'rescan' });
          notified = true;
        } catch (e) { notified = false; }
      }
      return Object.assign(await buildState(tabId), { notified });
    }

    case 'cosmetic-hidden':
      addCount('cos', senderTabId, Math.max(0, Math.min(5000, Number(msg.count) || 0)));
      return { ok: true };

    case 'rescan': {
      const tabId = typeof msg.tabId === 'number' ? msg.tabId : senderTabId;
      if (tabId < 0) return { ok: false };
      resetTabStats(tabId);
      try {
        const res = await chrome.tabs.sendMessage(tabId, { type: 'rescan' });
        return { ok: true, hidden: res && res.hidden };
      } catch (e) {
        return { ok: false, error: I18N.t('err_page_unavailable') };
      }
    }

    case 'reset-stats': {
      await ensure();
      if (typeof msg.tabId === 'number' && msg.tabId >= 0) {
        // 只清当前标签页（弹窗里的「清零统计」）
        resetTabStats(msg.tabId);
      } else {
        // 清空全部标签页 + 今日累计（设置页里的「清零统计」）
        for (const key of Object.keys(stats)) stats[key] = { net: 0, cos: 0 };
        schedulePersist();
        refreshVisibleBadges();
        daily = { date: ADB.today(), count: 0 };
        chrome.storage.local.set({ daily }).catch(() => {});
      }
      return buildState(msg.tabId);
    }

    case 'open-options':
      chrome.runtime.openOptionsPage();
      return { ok: true };

    default:
      return { error: I18N.t('err_unknown_command', [String(type)]) };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender)
    .then(result => sendResponse(result))
    .catch(err => {
      console.warn('[AdShield] 消息处理失败：', err);
      sendResponse({ error: String((err && err.message) || err) });
    });
  return true; // 异步响应
});

/* 启动时同步一次规则 */
applyAll();
