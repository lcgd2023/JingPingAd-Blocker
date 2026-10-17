/*! 净屏 · 广告拦截 (AdShield) — 多语言（简体中文 / English）
 *
 *  加载顺序：config.js -> i18n.js -> 页面脚本
 *  使用位置：弹窗页、设置页、后台 Service Worker
 *
 *  文案存放在 _locales/<语言>/messages.json，由 Chrome 按浏览器界面语言自动选择
 *  （中文界面显示中文、英文界面显示英文，无需用户手动切换）。
 *  直接用浏览器打开 popup.html / options.html 预览时没有 chrome.i18n，
 *  此时 DOM 里保留的中文原文不动，JS 动态字符串退回内置的中文兜底文案。
 */
(function (root) {
  'use strict';

  const HAS_I18N = typeof chrome !== 'undefined' && !!(chrome.i18n && chrome.i18n.getMessage);

  /** 扩展环境外的中文兜底文案（只包含 JS 动态生成的字符串，静态文案写在 HTML 里） */
  const FALLBACK = {
    popup_foot_net_limited: '以「加载已解压的扩展程序」方式运行时才统计网络拦截数',
    popup_foot_applied: '规则与元素隐藏即时生效，无需刷新页面',
    popup_page_unsupported: '不受支持的页面',
    popup_hint_builtin: '浏览器内置页面无法拦截（chrome://、扩展商店等）',
    popup_hint_paused: '本站已暂停拦截（可在「全部设置」中管理白名单）',
    popup_hint_off: '总开关已关闭，全部网站暂停拦截',
    popup_hint_active: '本站拦截中',
    popup_state_paused: '已暂停拦截',
    popup_state_done: '本次已处理 $1 项广告内容',
    popup_state_none: '暂无广告内容',
    popup_demo: '演示模式：当前不是扩展环境，操作不会生效',

    allowlist_count: '$1 个域名',
    rules_count: '网络规则 $1 条 · 元素规则 $2 条',
    rules_warn: '部分规则语法无法识别，已忽略',
    count_rules: '$1 条',
    stat_available: '可用',
    stat_limited: '受限',
    footer_enabled: '净屏 · AdShield v$1 — 网络计数已启用（需要扩展以开发模式加载）',
    footer_limited: '净屏 · AdShield v$1 — 网络计数不可用（缺少 declarativeNetRequestFeedback 权限）',
    version_line: '所有修改即时保存并生效（v$1）',
    version_demo: '演示模式：当前不是扩展环境，修改不会保存',
    toast_saved: '设置已保存',
    toast_demo: '演示模式：操作未生效',
    toast_stats_reset: '统计已清零',
    toast_exported: '已导出设置文件',
    toast_imported: '设置已导入',
    toast_import_failed: '导入失败：文件格式不正确',
    confirm_reset: '恢复默认设置？白名单与自定义规则会被清空。',
    toast_reset_done: '已恢复默认设置',

    err_invalid_host: '无效的域名',
    err_page_unavailable: '当前页面无法访问（受限页面或尚未加载完成）',
    err_unknown_command: '未知的指令：$1'
  };

  /** 取词：优先 chrome.i18n，其次内置兜底；都没有时返回 key 本身，便于发现漏翻 */
  function t(key, subs) {
    let text = '';
    if (HAS_I18N) {
      try {
        text = chrome.i18n.getMessage(key, subs) || '';
      } catch (e) {
        text = '';
      }
    }
    if (!text) text = FALLBACK[key] || key;
    if (subs && subs.length) {
      for (let i = 0; i < subs.length; i += 1) {
        text = text.split('$' + (i + 1)).join(String(subs[i] == null ? '' : subs[i]));
      }
    }
    return text;
  }

  function uiLanguage() {
    if (HAS_I18N && chrome.i18n.getUILanguage) {
      try { return chrome.i18n.getUILanguage() || ''; } catch (e) { /* ignore */ }
    }
    return '';
  }

  /**
   * 把 DOM 里的占位标记替换成当前语言文案：
   *   data-i18n              -> textContent
   *   data-i18n-title        -> title 属性
   *   data-i18n-placeholder  -> placeholder 属性
   * 找不到对应文案时保持 HTML 里的原文不动。
   */
  function localize(scope) {
    const rootEl = scope || (typeof document !== 'undefined' ? document : null);
    if (!rootEl || !rootEl.querySelectorAll) return;

    rootEl.querySelectorAll('[data-i18n]').forEach(el => {
      const text = t(el.getAttribute('data-i18n'));
      if (text && text !== el.getAttribute('data-i18n')) el.textContent = text;
    });
    rootEl.querySelectorAll('[data-i18n-title]').forEach(el => {
      const text = t(el.getAttribute('data-i18n-title'));
      if (text && text !== el.getAttribute('data-i18n-title')) el.title = text;
    });
    rootEl.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const text = t(el.getAttribute('data-i18n-placeholder'));
      if (text && text !== el.getAttribute('data-i18n-placeholder')) el.placeholder = text;
    });

    if (rootEl === document) {
      const lang = uiLanguage();
      if (lang) document.documentElement.lang = lang;
    }
  }

  root.AdShieldI18n = {
    t,
    localize,
    uiLanguage,
    isAvailable: () => HAS_I18N
  };

  /* 页面里（弹窗 / 设置页）脚本位于 body 末尾，DOM 已可用，直接本地化，避免中文一闪而过 */
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading' && !document.body) {
      document.addEventListener('DOMContentLoaded', () => localize(), { once: true });
    } else {
      localize();
    }
  }
})(typeof self !== 'undefined' ? self : window);
