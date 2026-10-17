# 净屏 · 广告拦截 (AdShield)

> **语言 / Language：** 简体中文 · [English](README.en.md)
>
> 扩展界面已做成多语言：中文浏览器显示中文，英文浏览器自动显示英文（见下文「多语言」）。

一个基于 **Chrome Manifest V3** 的广告拦截浏览器扩展：用 `declarativeNetRequest` 在**网络层**拦截广告与跟踪请求，用内容脚本在**页面层**隐藏广告位与信息流推广内容，并提供白名单、自定义规则与拦截统计。

> 纯本地运行，不收集任何数据；不依赖任何外部服务器或第三方库。

---

## 一、安装（开发者模式）

1. 打开 Chrome，地址栏输入 `chrome://extensions/`
2. 打开右上角的 **开发者模式**
3. 点击 **加载已解压的扩展程序**，选择本目录（`E:\GoogleADTool`）
4. 工具栏出现「净屏」图标即安装成功；首次安装会自动打开设置页

> Edge / 其它 Chromium 内核浏览器同理（`edge://extensions/`）。

安装后可以直接打开 `tools/test/cosmetic-test.html` 验证元素隐藏功能是否生效（页面里内置了 25 项自检）。

---

## 二、功能

### 1. 请求级拦截（声明式规则，共 396 条内置规则）

| 规则集 | 条数 | 默认 | 说明 |
| --- | --- | --- | --- |
| `ads` 广告网络 | 199 | ✅ 开 | Google/DFP、广告交易平台、原生广告、广告联盟、国内广告平台 |
| `trackers` 跟踪与统计 | 124 | ✅ 开 | 分析埋点、会话录制、广告验证、DMP、社交像素、归因 SDK、Google Ads 转化标记 |
| `annoyances` 弹窗与同意横幅 | 57 | ⬜ 关 | 网页推送订阅、OneTrust/Cookiebot/Didomi 等同意管理平台 |
| `video` 视频网站广告 | 16 | ⬜ 关 | 优酷/爱奇艺/B 站广告接口（**可能影响播放**） |

其中针对 **Google 投放的广告**额外叠加了路径级规则（`/pagead/interstitial`、`/pagead/html/`、`/adsbygoogle.js`、`/gampad/ads`、`/pubads_impl` 等），这样即使站点把 Google 广告请求反代到自家域名下也能拦掉。

刻意**没有**包含 `ads.google.com`、`business.facebook.com`、`ads.linkedin.com`、`ads.tiktok.com` 等**广告投放后台**域名，避免影响正常投放工作。

### 2. 页面级隐藏（内容脚本）

- **隐藏页面广告位**：AdSense、GPT/DFP、常见 `.ad-*` 容器、`[data-ad-slot]` 等
- **插屏 / 悬浮 / 弹窗广告清理（默认开启）**：专门处理「看着看着突然弹出一整屏广告」——Google AdSense 插屏、Ad Manager vignette/interstitial、popunder 等。做法是以 Google 广告标记（`data-google-av-*`、`ins.adsbygoogle`、`google_ads_iframe`、`aswift_*` 等）、广告类名为起点，向上找到固定定位的覆盖层容器并隐藏，同时：
  - 隐藏背后的半透明遮罩层（dim / blur 背景）
  - 清除站点为突出插屏而加的整页 `filter: blur()`
  - 解除 `overflow: hidden` 滚动锁定与 `pointer-events: none`
  - 安全护栏：登录弹窗（含表单/密码框）、整页正文容器、含 `article/main/nav` 的布局层**永不隐藏**
- **拦截广告弹窗窗口（默认开启）**：在主世界包装 `window.open` 与 `<a>.click()`，拦掉脚本自动弹出的广告窗口——目标为已知广告/弹窗联盟域名，或 `ad.*`、`click.*`、`pop.*`、`track.*` 之类子域；无地址（`about:blank`）的弹窗仅在**非用户触发**时拦截，所以登录、支付、分享等**你主动点击产生的弹窗一律放行**
- **拦截「点击广告 → 侧滑抽屉 / 二次弹层」**：在捕获阶段拦掉落在广告元素（`ins.adsbygoogle`、`aswift_*`、`google_ads_iframe`、`data-google-av-*` 等）与广告位盒子（`ad_*`、`ads-*`、`adv*`、`advertisement*` 等命名）上的点击，避免点到广告后从侧面滑出抽屉广告或弹出新层；普通内容的点击不受影响
- **广告位盒子连带隐藏**：广告本体被隐藏后，向上最多 3 层寻找「固定高度、给广告预留空位」的外层盒子一起隐藏（否则页面会留一大片空白）；遇到包含 `form` / `article` / `main` / `nav` 的容器立即停手，保证不误伤正文
- **Google 自有标注广告**：AdSense 的「探索 xxx」标注条（页面顶部那排小药丸）、右下角悬浮标注卡（`#google-anno-sa`，直接挂在 `<html>` 下）、AI 工具广告单元（`google-aiuf`、`goog-rentry`）等一并隐藏
- **隐藏信息流推广**：微博、知乎、抖音、小红书、Facebook、Instagram、X、Reddit、LinkedIn 等平台的「赞助/推广」条目（按标签文本识别）
- **移除 Cookie / 遮罩弹窗**：隐藏同意弹窗并解除 `overflow: hidden` 滚动锁定（默认关闭）
- **强力模式**：更激进的选择器 + 悬浮广告启发式清理（默认关闭，可能误伤）
- 支持 SPA 路由切换、动态加载内容（`MutationObserver` + 定时复扫）

### 3. 白名单与自定义规则

- 点击工具栏图标即可**一键暂停当前网站**（会话级 `allowAllRequests` 规则 + 停止元素隐藏）
- 支持 Adblock 风格自定义规则（见下文语法）
- 设置可导出 / 导入 JSON

### 4. 统计

- 图标角标显示当前标签页已处理数量（`999+` 封顶）
- 弹窗显示：当前页拦截请求 / 隐藏广告位 / 今日累计
- 说明：**网络请求计数**依赖 `declarativeNetRequestFeedback` 权限，该权限只在「未打包 / 开发者模式」的扩展中生效；元素隐藏计数始终可用

### 5. 多语言（中文 / English）

- 界面文案放在 `_locales/zh_CN/` 与 `_locales/en/`，由 Chrome 按**浏览器界面语言**自动选择，无需用户手动切换
- 扩展名称与简介也走多语言（`manifest.json` 里的 `__MSG_ext_name__` / `__MSG_ext_desc__`）：
  中文「净屏 · 广告拦截 (AdShield)」／英文「AdShield — Ad & Pop-up Blocker」
- 取词与替换逻辑在 `src/shared/i18n.js`：扩展环境用 `chrome.i18n`，直接用浏览器打开页面预览时退回内置中文文案
- 自检会校验两种语言的**键集合、占位符、名称/简介长度**是否一致，避免漏翻

---

## 三、使用方法

| 操作 | 位置 |
| --- | --- |
| 全局开关 | 点击图标 → 顶部开关；或设置页「总开关」 |
| 本站暂停/恢复 | 点击图标 → 「当前网站」开关 |
| 临时重新扫描 | 点击图标 → 「重新扫描」 |
| 批量管理白名单 / 自定义规则 | 点击图标 → 「全部设置」 |
| 键盘直达设置 | `chrome://extensions/` → 详情 → 扩展程序选项 |

### 自定义规则语法

```
! 注释行
||ads.example.com^                 拦截该域名（含子域）的所有请求
||ads.example.com^$script,image    只拦截脚本与图片类型
@@||example.com/ads.js             例外：放行该地址（优先级高于拦截）
/some/path/banner.js               按路径匹配
##.ad-banner                       所有网站隐藏匹配该选择器的元素
example.com##div[id^="promo-"]     只在 example.com（含子域）隐藏
example.com#@#.ad-banner           取消隐藏（例外）
```

- 类型关键字：`script` `image` `stylesheet`/`css` `xmlhttprequest`/`xhr` `sub_frame`/`frame` `main_frame`/`document` `media` `font` `object` `ping` `websocket` `other`
- 不支持的选项（如 `$third-party`、`$removeparam`、`$csp`、`$domain=`）会被自动忽略
- 中文域名会自动转成 punycode

---

## 四、目录结构

```
manifest.json                 扩展清单（MV3，名称/简介用 __MSG_ 多语言占位符）
_locales/                     语言包：zh_CN（默认）、en
src/
  background.js               Service Worker：规则同步、统计、角标、消息路由
  shared/config.js            共享配置、规则解析、工具函数（四处复用）
  shared/i18n.js              多语言取词与 DOM 文案替换
  content/cosmetic.js         元素隐藏规则库（通用/Google 标记/插屏弹窗/遮罩/分站/信息流）
  content/content.js          内容脚本：注入样式、扫描隐藏、插屏弹窗清理、统计上报
  content/main-world.js       主世界脚本：拦截 window.open / 伪造点击弹出的广告窗口
popup/                        工具栏弹窗（开关、统计、快捷操作）
options/                      设置页（白名单、自定义规则、导入导出）
rules/                        静态规则（由 tools/build-rules.mjs 生成）
icons/                        16/32/48/128 图标 + 品牌原图 jingping.png（由 tools/make-icons.ps1 生成）
tools/                        开发工具（不参与运行，打包时排除）
  sources/*.txt               规则源（每行一个过滤器，便于维护）
  build-rules.mjs             生成 rules/*.json
  make-icons.ps1              从 icons/jingping.png 生成各尺寸图标（可切换 full / mark 变体）
  make-icons.mjs              内置图标画法（仅在缺少品牌原图时使用）
  selftest.mjs                共享模块 + 规则文件 + 多语言自检（49 项）
  test/cosmetic-test.html     元素隐藏功能的浏览器内测试页（25 项断言）
  gen-css-preview.mjs         按域名生成元素隐藏 CSS（用于在真实站点干跑验证）
  preview-locale.mjs          多语言界面预览服务器（不切浏览器语言即可查翻译）
  pack.ps1                    打包为 dist/adshield-<版本>.zip
```

---

## 五、开发与维护

```powershell
# 新增广告域名：编辑 tools/sources/ads.txt 后重新生成规则
node tools/build-rules.mjs

# 运行自检（域名解析、规则语法、规则文件合法性、多语言一致性）
node tools/selftest.mjs

# 重新生成图标（默认「完整标志」，加 -Variant mark 则只保留叶子）
powershell -File tools\make-icons.ps1

# 预览各尺寸在浅色 / 深色背景下的效果
#   → dist\icon-preview.png

# 生成某站点的隐藏 CSS（粘贴到真实页面里干跑验证）
node tools/gen-css-preview.mjs yysub.cc dist/preview-yysub.css

# 多语言界面预览（不切浏览器语言就能查漏翻，端口默认 5199）
#   → http://localhost:5199/popup/popup.html?__locale=en
#     http://localhost:5199/options/options.html?__locale=en
node tools/preview-locale.mjs

# 打包（上传应用商店用）
powershell -File tools\pack.ps1
```

修改代码后，在 `chrome://extensions/` 点击扩展卡片上的「刷新」按钮即可生效（内容脚本需要刷新页面）。

### 上架提示

准备提交 Chrome 应用商店时：

1. 从 `manifest.json` 的 `permissions` 中移除 `declarativeNetRequestFeedback`（该权限仅未打包扩展可用），角标将只统计元素隐藏数；
2. 可删除 `tools/` 目录（`tools/pack.ps1` 已自动排除）；
3. 商店审核通常要求说明 `host_permissions: <all_urls>` 的必要性（拦截请求需要覆盖所有站点）。

---

## 六、已知限制

- **YouTube 视频内广告**：新版已改为服务端插入（SSAI），客户端无法通过请求拦截完全屏蔽，仅能隐藏页面广告位与信息流广告。
- **反广告拦截检测**：部分视频站/新闻站检测到拦截后会提示「请关闭广告拦截」。可关闭对应规则集，或把该站加入白名单。
- **弹窗窗口拦截是启发式的**：只拦截目标地址明显是广告/追踪子域或联盟域名的情况。若广告弹窗指向广告主自己的正常域名（例如点击后打开品牌官网），从地址上无法与正常链接区分，不会被拦（且这类弹窗通常由你的点击触发）。
- **插屏清理需要能识别出广告特征**：如果某站点把广告 HTML 完全反代到自家域名、又去掉了所有 Google 标记与广告类名，则只能依赖强力模式。
- **点击拦截只覆盖「可识别的广告元素」**：广告特征明确的元素（Google 标记、广告位命名）上的点击会被拦掉；若广告宿主完全去掉了广告类名，则依赖插屏清理器（默认开启）在它出现后再隐藏。
- **强力模式**可能误伤正常元素（例如类名含 `ad` 的普通组件），建议先小范围试用。
- **网络计数**仅在开发者模式加载时可用（见上文说明）。
- **多语言**：中文、英文两套界面文案；默认语言为简体中文，未做多语言适配的 `tags` 文本（如信息流「赞助/推广」识别用的中文关键词）仍按站点原文匹配，与界面语言无关。
- 元素隐藏对 `chrome://`、扩展商店等**受限页面无效**（浏览器不允许内容脚本注入）。
- 弹窗窗口拦截使用 `world: "MAIN"` 内容脚本，需要 **Chrome 111+**（清单已声明 `minimum_chrome_version: 111`）。
