# AdShield — Ad & Pop-up Blocker

> **Language:** English · [简体中文](README.md)
>
> The extension UI is localized: a Chinese browser shows Chinese, an English browser shows English (see “Languages” below).

A **Chrome Manifest V3** ad blocker: `declarativeNetRequest` blocks ad and tracking requests at the **network layer**, while a content script hides ad slots, interstitial ads and sponsored feed posts at the **page layer**. Includes a per-site whitelist, Adblock-style custom rules and blocking stats.

> Runs entirely on your machine — no data collection, no external servers, no third-party libraries.
>
> Current version: **1.3.0** · 396 built-in blocking rules · requires Chrome 111+

---

## 1. Install (developer mode)

1. Open `chrome://extensions/`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and select this folder
4. The AdShield icon appears in the toolbar; the settings page opens on first install

> Edge and other Chromium browsers work the same way (`edge://extensions/`).

To check element hiding right away, open `tools/test/cosmetic-test.html` in a browser — it runs 25 built-in assertions.

---

## 2. Features

### 1. Request blocking (396 built-in declarative rules)

| Rule set | Count | Default | What it covers |
| --- | --- | --- | --- |
| `ads` ad networks | 199 | ✅ on | Google/DFP, ad exchanges, native ads, ad networks |
| `trackers` tracking & analytics | 124 | ✅ on | Analytics, pixels, ad verification, DMPs, social pixels, attribution SDKs, Google Ads conversion tags |
| `annoyances` pop-ups & consent | 57 | ⬜ off | Web push prompts, OneTrust/Cookiebot/Didomi and similar CMPs |
| `video` video site ads | 16 | ⬜ off | Youku / iQIYI / Bilibili ad endpoints (**may break playback**) |

Google-served ads get extra path-level rules (`/pagead/interstitial`, `/pagead/html/`, `/adsbygoogle.js`, `/gampad/ads`, `/pubads_impl`, …), so they are still blocked when a site proxies Google requests through its own domain.

Ad-platform back-office domains (`ads.google.com`, `business.facebook.com`, `ads.linkedin.com`, `ads.tiktok.com`, …) are **deliberately not blocked**, so ad operations keep working.

### 2. Page-level hiding (content script)

- **Hide page ad slots**: AdSense, GPT/DFP, common `.ad-*` containers, `[data-ad-slot]` and empty placeholders
- **Interstitial / floating / pop-up ad killer (on by default)**: handles “a full-screen ad suddenly appears while browsing” — Google AdSense interstitials, Ad Manager vignettes, popunders and click-triggered side drawers. It starts from Google ad markers (`data-google-av-*`, `ins.adsbygoogle`, `google_ads_iframe`, `aswift_*`) or ad-related class names, walks up to the overlay container and hides it, and also:
  - hides the dim/blur backdrop behind it
  - clears the page-wide `filter: blur()` that sites add to spotlight the ad
  - releases `overflow: hidden` scroll locks and `pointer-events: none`
  - safety rails: login dialogs (forms/password fields), page-level content containers and layouts containing `article/main/nav` are **never** hidden
- **Block ad click-throughs**: clicks landing on ad elements or ad slot wrappers (`ad_*`, `ads-*`, `adv*`, `advertisement*`, …) are cancelled in the capture phase, so “click the ad → a side drawer slides in” cannot happen; clicks on regular content are untouched
- **Hide the ad slot wrapper too**: after hiding the ad itself, Up to 3 ancestor levels that look like a reserved, fixed-height ad box are hidden as well (otherwise a large blank gap remains). The walk stops immediately at any container holding `form` / `article` / `main` / `nav`
- **Google’s own annotation ads**: the “Explore …” chip row at the top of a page, the bottom-right floating annotation card (`#google-anno-sa`, injected directly under `<html>`) and AI-tool ad units (`google-aiuf`, `goog-rentry`) are all hidden
- **Block ad pop-up windows (on by default)**: wraps `window.open` and `<a>.click()` in the MAIN world and blocks script-opened ad windows — targets on known ad/pop-up network domains or `ad.*`, `click.*`, `pop.*`, `track.*` style subdomains. Windows without a URL (`about:blank`) are only blocked when they are **not** user-initiated, so pop-ups from your own clicks (login, payment, sharing) always go through (requires Chrome 111+)
- **Hide sponsored feed posts**: “sponsored / promoted” items on Weibo, Zhihu, Douyin, Facebook, Instagram, X, Reddit, LinkedIn and more (detected by label text)
- **Remove cookie / overlay dialogs**: hides consent dialogs and releases scroll locks (off by default)
- **Aggressive mode**: broader selectors plus floating-ad heuristics (off by default, may over-hide)
- Handles SPA route changes and dynamically loaded content (`MutationObserver` + periodic rescans)

### 3. Whitelist and custom rules

- Click the toolbar icon to **pause the current site** (session `allowAllRequests` rule + element hiding stops)
- Adblock-style custom rules (syntax below)
- Settings export / import as JSON

### 4. Stats

- Toolbar badge shows how many items were handled on the current tab (capped at `999+`)
- Pop-up shows: blocked requests / hidden ad slots / blocked today
- Note: **network request counting** relies on the `declarativeNetRequestFeedback` permission, which only works for unpacked (developer mode) extensions. Element-hiding counts always work.

### 5. Languages (Chinese / English)

- UI strings live in `_locales/zh_CN/` and `_locales/en/` and are picked by Chrome based on your **browser UI language** — no manual switch
- The extension name and description are localized too (`__MSG_ext_name__` / `__MSG_ext_desc__` in `manifest.json`): “净屏 · 广告拦截 (AdShield)” in Chinese, “AdShield — Ad & Pop-up Blocker” in English
- Lookup and DOM substitution live in `src/shared/i18n.js`: it uses `chrome.i18n` inside the extension and falls back to the built-in Chinese strings when the pages are opened directly in a browser
- The self-test verifies that both locales have the **same keys and placeholders** and that the name/description length limits are respected

---

## 3. Usage

| Action | Where |
| --- | --- |
| Master switch | Toolbar icon → top switch, or Settings → “Master switch” |
| Pause / resume this site | Toolbar icon → “This site” switch |
| Rescan the current page | Toolbar icon → “Rescan” |
| Manage whitelist / custom rules | Toolbar icon → “All settings” |
| Open settings directly | `chrome://extensions/` → Details → Extension options |

### Custom rule syntax

```
! comment line
||ads.example.com^                 block every request to this domain (including subdomains)
||ads.example.com^$script,image    block only script and image requests
@@||example.com/ads.js             exception (allow) rule — higher priority than blocking
/some/path/banner.js               match by path
##.ad-banner                       hide matching elements on every site
example.com##div[id^="promo-"]     hide elements only on example.com (and subdomains)
example.com#@#.ad-banner           undo a hide rule (exception)
```

- Resource types: `script` `image` `stylesheet`/`css` `xmlhttprequest`/`xhr` `sub_frame`/`frame` `main_frame`/`document` `media` `font` `object` `ping` `websocket` `other`
- Unsupported options (`$third-party`, `$removeparam`, `$csp`, `$domain=`, …) are ignored
- Internationalized domains are converted to punycode automatically

---

## 4. Project structure

```
manifest.json                 extension manifest (MV3, __MSG_ placeholders for name/description)
_locales/                     locale packs: zh_CN (default), en
src/
  background.js               service worker: rule sync, stats, badge, message routing
  shared/config.js            shared config, rule parsing, helpers (used in four contexts)
  shared/i18n.js              localization lookup + DOM text substitution
  content/cosmetic.js         element-hiding selector library
  content/content.js          content script: style injection, hiding scan, overlay cleanup, stats
  content/main-world.js       MAIN-world script: blocks window.open / fake-click ad windows
popup/                        toolbar pop-up (switches, stats, quick actions)
options/                      settings page (whitelist, custom rules, import/export)
rules/                        static rules (generated by tools/build-rules.mjs)
icons/                        16/32/48/128 icons + brand artwork jingping.png (by tools/make-icons.ps1)
tools/                        developer tools (never shipped; excluded when packing)
  sources/*.txt               rule sources (one filter per line)
  build-rules.mjs             generates rules/*.json
  make-icons.ps1              renders all icon sizes from icons/jingping.png (full / mark variants)
  make-icons.mjs              built-in icon drawing (fallback when the artwork is missing)
  selftest.mjs                self-test for shared modules, rule files and locales (49 checks)
  test/cosmetic-test.html     in-browser test page for element hiding (25 assertions)
  gen-css-preview.mjs         generates the hiding CSS for a domain (dry-run on live sites)
  preview-locale.mjs          locale preview server (inspect translations without switching languages)
  pack.ps1                    packs dist/adshield-<version>.zip
```

---

## 5. Development

```powershell
# Add ad domains: edit tools/sources/ads.txt, then regenerate the rules
node tools/build-rules.mjs

# Self-test (host parsing, rule syntax, rule files, locales)
node tools/selftest.mjs

# Regenerate the icons (default: full logo; -Variant mark keeps only the leaf)
powershell -File tools\make-icons.ps1

# Generate the hiding CSS for one site (paste it into the live page to dry-run)
node tools/gen-css-preview.mjs yysub.cc dist/preview-yysub.css

# Locale preview (spot missing translations without switching your browser language)
#   → http://localhost:5199/popup/popup.html?__locale=en
node tools/preview-locale.mjs

# Package for the Web Store
powershell -File tools\pack.ps1
```

After changing the code, click **Reload** on the extension card in `chrome://extensions/` (content scripts need a page refresh).

### Publishing notes

1. Remove `declarativeNetRequestFeedback` from `permissions` in `manifest.json` before submitting (it only works for unpacked extensions); the badge will then count hidden elements only.
2. The `tools/` folder can be deleted (`tools/pack.ps1` already excludes it).
3. Store review usually asks why `host_permissions: <all_urls>` is needed — blocking requests requires all sites.
4. The listing language comes from `_locales`: `zh_CN` for the Chinese listing, `en` for the English one.

---

## 6. Known limitations

- **YouTube in-video ads**: newer players insert ads server-side (SSAI), which cannot be blocked by request blocking; only page ad slots and feed ads can be hidden.
- **Anti-adblock detection**: some video/news sites show a “please disable your ad blocker” wall. Turn off the matching rule set or whitelist the site.
- **Pop-up blocking is heuristic**: only windows whose target is clearly an ad/tracking subdomain or network are blocked. A pop-up that points to an advertiser’s regular domain cannot be told apart from a normal link by URL (and such pop-ups are usually user-initiated anyway).
- **The overlay cleaner needs recognizable ad markers**: if a site proxies the ad HTML through its own domain and strips every Google marker and ad class name, only aggressive mode can help.
- **Click guarding covers recognizable ads only**: clicks on elements with clear ad markers or ad-style names are cancelled; if an ad host removes all ad class names, the overlay cleaner (on by default) removes the layer once it appears.
- **Aggressive mode** may over-hide (for example ordinary components with `ad` in their class name) — try it on a few sites first.
- **Network counting** only works when the extension is loaded in developer mode (see above).
- **Element hiding has no effect on restricted pages** (`chrome://`, the Web Store, …), because Chrome does not inject content scripts there.
- **Languages**: Chinese and English UI. Text-based feed ad detection still matches the site’s original label wording (e.g. Chinese “赞助/推广” labels), independently of the interface language.
