/*! 净屏 · 广告拦截 (AdShield) — 元素隐藏规则库
 *  加载顺序：config.js -> cosmetic.js -> content.js
 *
 *  两条原则：
 *   1) 命中率优先、误伤最少：只用有把握的选择器；风险高的放进 aggressive（强力模式）。
 *   2) 词根匹配必须带边界：`[class*="ad-slot"]` 会命中 "head-slot"/"loads-slot" 之类的
 *      无关类名，所以统一用 classToken()/idToken() 展开成「开头 / 空格 / 连字符 / 下划线 /
 *      结尾」五种安全形式。
 */
(function () {
  'use strict';

  const root = (typeof globalThis !== 'undefined') ? globalThis : self;
  const ADB = (root.ADB = root.ADB || {});

  /** 把 "ad-slot" 展开为安全的 class 匹配（避免命中 head-slot / thread-slot 等） */
  function classToken(token) {
    return [
      `[class^="${token}"]`,
      `[class*=" ${token}"]`,
      `[class$="${token}"]`,
      `[class*="-${token}"]`,
      `[class*="_${token}"]`
    ];
  }

  /** 把 "ad-banner" 展开为安全的 id 匹配 */
  function idToken(token) {
    return [
      `[id^="${token}"]`,
      `[id$="${token}"]`,
      `[id*="-${token}"]`,
      `[id*="_${token}"]`
    ];
  }

  /** 同时匹配 class 与 id */
  function tokens(token) {
    return [...classToken(token), ...idToken(token)];
  }

  const COSMETIC = {};

  /* ---------------------------- 通用广告位（安全） --------------------------- */
  COSMETIC.generic = [
    // Google / 广告联盟（细节见 googleAds）
    'ins.adsbygoogle',
    'iframe[src*="doubleclick.net"]',
    'iframe[src*="googlesyndication.com"]',
    'iframe[src*="googleadservices.com"]',
    'iframe[src*="adservice.google"]',
    'iframe[id^="google_ads_iframe"]',
    'iframe[name^="google_ads_iframe"]',
    'iframe[id^="aswift_"]',
    'div[id^="google_ads_"]',
    'div[id^="div-gpt-ad"]',
    'div[id^="gpt-passback"]',
    'div[data-google-query-id]',
    'ins[data-ad-client]',
    'ins[data-ad-slot]',
    'img[src*="/pagead/"]',
    'img[src*="doubleclick.net"]',
    'img[src*="adservice.google.com"]',
    'link[href*="pagead2.googlesyndication.com"]',

    // 常见广告容器命名（带边界的安全匹配）
    '[class*="advertisement"]',
    '[id*="advertisement"]',
    ...tokens('ad-slot'),
    ...tokens('ad-unit'),
    ...tokens('ad-banner'),
    ...tokens('ad-container'),
    ...tokens('ad-placeholder'),
    ...tokens('ad-billboard'),
    ...tokens('ads-container'),
    ...tokens('ads-wrapper'),
    ...tokens('ads-box'),
    ...tokens('banner-ad'),
    ...tokens('leaderboard-ad'),
    ...tokens('rect-ad'),
    ...[
      '[data-testid*="ad-slot"]',
      '[data-testid*="advertisement"]',
      '[data-ad-slot]',
      '[data-ad-unit]',
      '[data-ad-client]',
      '[data-ad-position]',
      '[aria-label="Advertisement"]',
      '[aria-label="advertisement"]'
    ],

    // 典型中文站点广告位
    '#ad_top',
    '.adTop',
    '.ad_top',
    '.top-ad',
    '.banner-ad',
    '.pop-ad',
    '.popup-ad',
    '.float-ad',
    '.ad-float',
    '.floatAd',
    ...tokens('float-ad'),
    '[id^="ad_"]',
    '[id^="ads_"]',
    // 下划线命名的广告位盒子（ad_global / ad_box / ads_wrap 等）
    '[class^="ad_"]',
    '[class*=" ad_"]',
    '[class^="ads_"]',
    '[class*=" ads_"]'
  ];

  /* ------------------------- Google 广告专用标记（零误伤） -------------------------
   *  AdSense / Ad Manager (GPT) 注入的元素都带这些属性，是最可靠的识别依据。
   *  截图里那种由 Google 投放的插屏 / vignette 广告同样命中。
   */
  COSMETIC.googleAds = [
    '[data-google-av-adk]',
    '[data-google-av-cxn]',
    '[data-google-av-metadata]',
    '[data-google-container-id]',
    '[data-google-query-id]',
    '.GoogleActiveViewElement',
    '.GoogleActiveViewClass',
    '.google-auto-placed',
    'ins.adsbygoogle',
    'ins[data-ad-client]',
    'ins[data-ad-slot]',
    'ins[data-ad-format]',
    'iframe[id^="google_ads_iframe"]',
    'iframe[name^="google_ads_iframe"]',
    'iframe[src*="doubleclick.net"]',
    'iframe[src*="googlesyndication.com"]',
    'iframe[src*="googleadservices.com"]',
    'iframe[src*="adservice.google"]',
    'iframe[src*="imasdk.googleapis.com"]',
    'iframe[src*="adtrafficquality.google"]',
    'div[id^="google_ads_iframe"]',
    'div[id^="aswift_"]',
    'div[id^="google_ads_"]',
    'div[id^="div-gpt-ad"]',
    'div[id^="gpt-passback"]',
    'img[src*="googlesyndication.com"]',
    'img[src*="/pagead/"]',
    'img[src*="doubleclick.net"]',
    'a[href^="https://googleads.g.doubleclick.net"]',
    '[data-ad-format="interstitial"]',
    '[data-ad-format="vignette"]',
    '#google_ads_interstitial',
    ...idToken('google_ads_interstitial'),
    ...tokens('google-vignette'),
    // AdSense 广告内的 Google 自有 UI（实测于 yysub.cc：AI 工具类广告单元）
    '.google-aiuf',
    '.goog-rentries',
    '.goog-rentry',
    '.google-anno-skip',
    // AdSense 浮动“标注 / 锚定”广告（实测于 yysub.cc：直接挂在 <html> 下，右下角悬浮卡）
    '#google-anno-sa',
    '[id^="google-anno"]',
    '[class*="google-anno"]',
    '[id*="google-anno-"]',
    '[data-anchor-status]',
    ...tokens('google-ad'),
    ...tokens('google-ads')
  ];

  /* ------------------- 插屏 / 悬浮 / 弹窗式广告容器（配合 DOM 清理器） ------------------ */
  COSMETIC.interstitials = [
    ...tokens('interstitial-ad'),
    ...tokens('interstitialAd'),
    ...tokens('ad-interstitial'),
    ...tokens('adInterstitial'),
    ...tokens('popup-ad'),
    ...tokens('popupAd'),
    ...tokens('popup_ad'),
    ...tokens('popunder'),
    ...tokens('overlay-ad'),
    ...tokens('ad-overlay'),
    ...tokens('adOverlay'),
    ...tokens('vignette'),
    ...tokens('modal-ad'),
    ...tokens('modalAd'),
    ...tokens('fullscreen-ad'),
    ...tokens('fullscreenAd'),
    ...tokens('float-banner'),
    ...tokens('floating-ad'),
    ...tokens('floatAd'),
    ...tokens('banner-popup'),
    '[aria-label="Advertisement"][role="dialog"]',
    '[data-ad-modal]',
    '[data-admode="interstitial"]',
    '[data-ads-modal]'
  ];

  /* --------------------- 插屏广告清理器（DOM 启发式）配置 --------------------- */
  COSMETIC.overlayAd = {
    /** 判定为“广告覆盖层”的 class/id/aria-label 关键字（必须带词边界，避免 head- 与 loads- 之类误伤） */
    keywords: /(^|[-_\s])(ad|ads|adv|advert|advertisement|advertorial|sponsor|sponsored|promo|pop[-_]?under|popup[-_]?ad|ad[-_]?popup|interstitial|vignette|adbox|adunit|adslot|adframe)([-_\s]|$)/i,
    /** 广告标记元素（向上寻找覆盖层时使用） */
    markers: [
      '[data-google-av-adk]',
      '[data-google-av-cxn]',
      '[data-google-container-id]',
      '[data-google-query-id]',
      'ins.adsbygoogle',
      'iframe[id^="google_ads_iframe"]',
      'iframe[name^="google_ads_iframe"]',
      'iframe[src*="doubleclick.net"]',
      'iframe[src*="googlesyndication.com"]',
      'iframe[src*="adservice.google"]',
      'div[id^="aswift_"]',
      '.GoogleActiveViewElement',
      '.google-aiuf',
      '.goog-rentries',
      '[id^="google-anno"]',
      '[class*="google-anno"]',
      '[data-anchor-status]',
      '[data-ad-modal]',
      '[data-admode="interstitial"]'
    ].join(','),
    /** 覆盖层面积占视口的比例区间 */
    minAreaRatio: 0.03,
    maxAreaRatio: 1,
    /** z-index 下限 */
    minZIndex: 50,
    /** 从广告标记向上查找覆盖层的最大层数 */
    maxDepth: 10,
    /** 单次清理的覆盖层数量上限 */
    maxKills: 30,
    /** 判定“整页内容块”的阈值：超过该比例且包含正文/导航等元素时不动它 */
    pageLikeRatio: 0.85,
    pageLikeSelectors: 'article, main, [role="main"], nav, header, footer, [contenteditable="true"], form'
  };

  /* --------------------------- Cookie / 弹窗遮罩（可选） -------------------------- */
  COSMETIC.overlays = [
    '#onetrust-consent-sdk',
    '#onetrust-banner-sdk',
    '.onetrust-pc-dark-filter',
    '#cookie-banner',
    '#cookieBanner',
    '#cookie-law-info-bar',
    '#cookie-consent',
    '.cookie-consent',
    '.cookie-banner',
    '.cookie-notice',
    '.cookie-policy',
    '.cookies-overlay',
    '#CybotCookiebotDialog',
    '#CybotCookiebotDialogBodyUnderlay',
    '#didomi-host',
    '#didomi-notice',
    '#usercentrics-root',
    '#iubenda-cs-banner',
    '#qc-cmp2-container',
    '.qc-cmp2-container',
    '#cmp-container',
    '#cmpbox',
    '#cmpbox2',
    '[id^="sp_message_container"]',
    '#truste-consent-track',
    '#gdpr-banner',
    '#gdpr-consent',
    '.gdpr-modal',
    '.cc-window',
    '.cc-banner',
    '#consent-banner',
    '#cookieConsent',
    '#js-cookie-consent',
    '.js-cookie-consent',
    '#privacypolicy-banner',
    '#axeptio_overlay',
    '.osano-cm-window',
    '#termsfeed-com---nb',
    '.termly-styles-root',
    '#pandectes-banner',
    '#shopify-pc__banner',
    '#transcend-consent-manager',
    '.cli-modal-backdrop',
    '#moove_gdpr_cookie_modal',
    // 弹窗式推送 / 订阅提示
    ...tokens('push-notification-prompt'),
    ...idToken('pushprompt'),
    ...tokens('webpush-prompt'),
    ...tokens('onesignal-slidedown'),
    '#onesignal-slidedown-container',
    ...tokens('subscribe-popup')
  ];

  /* ------------------------- 强力模式（可能误伤，默认关闭） ------------------------ */
  COSMETIC.aggressive = [
    ...tokens('sponsored'),
    ...tokens('promoted'),
    ...tokens('promo-box'),
    ...tokens('native-ad'),
    ...tokens('advert'),
    ...tokens('adbox'),
    ...tokens('adsbox'),
    ...classToken('ads'),
    ...tokens('sponsor'),
    // 视频播放器内的广告层
    '.ytp-ad-overlay-container',
    '.ytp-ad-progress-list',
    '.ytp-ad-image-overlay',
    '#player-ads',
    // 站内常见“广告位招租”区块
    '#ads',
    '.ads'
  ];

  /* -------------------- 「广告位盒子」识别（包裹广告本体的外层容器） --------------------
   *  很多站点把 AdSense/GPT 广告塞进固定高度的盒子里（如 .ad_global / .ad-box）。
   *  只隐藏广告本体，盒子的高度会留下一大片空白，所以由内容脚本把外层盒子一并隐藏。
   *  关键字必须带词边界，避免命中 head_ / load_ 之类的无关类名。
   */
  COSMETIC.adWrapper = {
    keywords: /(^|[-_\s])(ad|ads|adv|advert|advertisement|advertorial|adsbygoogle|google[-_]?auto[-_]?placed|sponsor|sponsored|promo|promotion|banner[-_]?ad|ad[-_]?banner|ad[-_]?box|adbox|ad[-_]?wrap|ad[-_]?slot|adslot|ad[-_]?unit|ad[-_]?global|ad[-_]?container|ad[-_]?placeholder|pop[-_]?under|popup[-_]?ad|ad[-_]?popup)([-_\s]|$)/i,
    /** 向上查找的最大层数 */
    maxDepth: 3,
    /** 盒子面积占视口比例上限（超过说明是内容容器，不动） */
    maxAreaRatio: 0.6,
    /** 盒子内元素数量上限 */
    maxChildren: 80
  };

  /* ------------------------------- 分站点隐藏规则 ------------------------------ */
  COSMETIC.specific = {
    'youtube.com': [
      'ytd-promoted-sparkles-web-renderer',
      'ytd-promoted-video-renderer',
      'ytd-display-ad-renderer',
      'ytd-ad-slot-renderer',
      'ytd-in-feed-ad-layout-renderer',
      'ytd-banner-promo-renderer',
      'ytd-statement-banner-renderer',
      'ytd-mealbar-promo-renderer',
      'ytd-compact-promoted-video-renderer',
      'ytd-player-legacy-desktop-watch-ads-renderer',
      '#masthead-ad',
      '#panels-full-bleed-container ytd-ad-slot-renderer',
      'ytm-promoted-sparkles-web-renderer',
      'ytm-companion-slot'
    ],
    'youtube-nocookie.com': [
      '.ytp-ad-overlay-container',
      '.ytp-ad-progress-list'
    ],
    'youtubekids.com': [
      'ytk-compact-promoted-video-renderer'
    ],
    'bilibili.com': [
      '.bili-video-card:has(.bili-video-card__info--ad)',
      '.bili-video-card:has(.bili-video-card__info--creative-ad)',
      '.floor-single-card',
      '.ad-report',
      '.video-card-ad-small',
      '.banner-card',
      '.ad-floor-exp',
      '[class*="slide-ad"]',
      '.bili-header__banner .bili-header__banner-ad',
      '.video-page-special-card-small'
    ],
    'reddit.com': [
      'shreddit-ad-post',
      'shreddit-comments-page-ad',
      'faceplate-tracker[noun="ad"]',
      'div[data-testid="post-container"]:has([data-testid="ad-badge"])',
      '.promotedlink',
      '[data-testid="promotedPost"]'
    ],
    'twitter.com': [
      'div[data-testid="cellInnerDiv"]:has([data-testid="placementTracking"])',
      'article:has([data-testid="placementTracking"])'
    ],
    'x.com': [
      'div[data-testid="cellInnerDiv"]:has([data-testid="placementTracking"])',
      'article:has([data-testid="placementTracking"])'
    ],
    'facebook.com': [
      'div[role="article"]:has(a[href*="/ads/about"])',
      '[data-pagelet="RightRail"] [aria-label="广告"]',
      'div[data-pagelet^="FeedUnit"]:has([data-ad-rendering-role="profile_name"])'
    ],
    'instagram.com': [
      'article:has(a[href*="/ads/about"])',
      'div[role="dialog"] article:has(a[href*="/ads/about"])'
    ],
    'linkedin.com': [
      '.ad-banner-container',
      '[data-ad-banner]',
      '.feed-shared-update-v2--sponsored',
      'iframe[src*="linkedin.com/tscp"]'
    ],
    'weibo.com': [
      'article.WB_feed:has(.woo-box-item-inlineBlock)',
      '[feedtype="ad"]',
      '.WB_feed_ad',
      '#v6_pl_rightmod_adsbox'
    ],
    'zhihu.com': [
      '.Advert',
      '.Pc-word',
      'div[data-za-detail-view-path-module="Advert"]',
      '.TopstoryItem--advertCard'
    ],
    'douban.com': [
      '.ad-douban',
      '#dale_douban_ad_middle'
    ],
    'pinterest.com': [
      '[data-test-id="story-pin"]:has([data-test-id="pin-ads-label"])',
      'div[data-test-id="ad-badge"]'
    ],
    'twitch.tv': [
      '.video-ad-countdown',
      '.stream-display-ad__container'
    ],
    'spotify.com': [
      '[data-testid="ad-slot-container"]',
      '.advertiser-container'
    ],
    'tieba.baidu.com': [
      '.j_ad',
      '.thread-ad',
      '.ad-thread',
      '#lake-ad',
      '.fengchao-wrap-feed'
    ],
    'baidu.com': [
      '#content_left .ec-tuiguang',
      '[data-tuiguang]',
      '.c-img-ads',
      '[class*="ec_wise_ad"]',
      '#content_right [class^="ad-"]',
      '#content_right [id^="ad-"]'
    ],
    'sogou.com': [
      '[class*="ad-"][class*="result"]',
      '.advertise'
    ],
    'taobao.com': [
      '.tb-recommend-ad',
      ...classToken('ad-banner')
    ],
    'jd.com': [
      '.ad-banner',
      '[class*="J_promotion"]'
    ],
    'eastmoney.com': [
      '[class^="ad-"]',
      '.gg_con'
    ],
    'csdn.net': [
      '.recommend-item-box:has(.is-ad)',
      '.blog-hot-article-ad'
    ],
    // 人人影视（YYeTs）系站点：AdSense 塞在固定高度的 .ad_global 盒子里
    'yysub.cc': [
      '.ad_global',
      'ins.adsbygoogle',
      '.adsbygoogle-noablate',
      '.google-auto-placed'
    ]
  };

  /* ------------------------- 信息流“赞助 / 推广”文本识别 -------------------------
   *  在容器内查找一个“纯标签”节点，文本命中后隐藏整个容器。
   *  只在下列站点生效，避免误伤普通页面。
   */
  COSMETIC.sponsoredSites = [
    {
      host: 'facebook.com',
      container: 'div[role="article"]',
      labels: 'span, a, div[role="link"], [aria-label]',
      text: /^(sponsored|sponsored post|paid partnership|贊助|赞助内容|赞助|推广|推廣|付费合作|付費合作|廣告|廣告內容)$/i
    },
    {
      host: 'instagram.com',
      container: 'article',
      labels: 'span, a, time, [aria-label]',
      text: /^(sponsored|paid partnership|贊助|赞助|推广|付费合作)$/i
    },
    {
      host: 'threads.net',
      container: 'article',
      labels: 'span, a, time',
      text: /^(sponsored|贊助|赞助|推广)$/i
    },
    {
      host: 'linkedin.com',
      container: 'div.feed-shared-update-v2',
      labels: '.update-components-actor__description, span, a',
      text: /^(promoted|赞助|推廣|推广的内容|suggested)$/i
    },
    {
      host: 'reddit.com',
      container: 'shreddit-post, div[data-testid="post-container"]',
      labels: 'span, a, faceplate-tracker',
      text: /^(promoted|sponsored|推广|赞助|广告)$/i
    },
    {
      host: 'weibo.com',
      container: 'article, div[action-type="feed_list_item"]',
      labels: 'a, span, .woo-box-item-inlineBlock',
      text: /^(推广|廣告|广告|微博广告)$/i
    },
    {
      host: 'zhihu.com',
      container: '.TopstoryItem, .Card, .SearchResult-Card',
      labels: 'a, span, div',
      text: /^(广告|推广|广告位|品牌提问)$/i
    },
    {
      host: 'xiaohongshu.com',
      container: 'section.note-item, div.note-item',
      labels: 'span, a',
      text: /^(赞助|广告|推广|合作笔记)$/i
    },
    {
      host: 'douyin.com',
      container: '[data-e2e="feed-item"], li[data-e2e="scroll-list-item"]',
      labels: 'span, div',
      text: /^(广告|赞助|推广)$/i
    }
  ];

  /* --------------------------- 悬浮广告启发式清理参数（强力模式） --------------------------- */
  COSMETIC.floatingAd = {
    keywords: /(\bad[s_-]?\b|advert|banner|sponsor|popup|pop-up|float|promo)/i,
    minZIndex: 1000,
    maxAreaRatio: 0.55,
    maxHeightRatio: 0.9
  };

  ADB.COSMETIC = COSMETIC;
})();
