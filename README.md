# sr-modules

个人 Shadowrocket 模块合集。每个模块一个目录，包含模块配置（`.conf`）与所需脚本。

## 模块列表

### WSJ AI 英语精读

在 WSJ iOS App 的原生文章页阅读英文。GLM-5.3-Flash 只在少量有阅读难点的段落后加「英语笔记」，解释词组在文中的含义，必要时拆解长句。比如 `price in＝提前反映在价格里`。

- [安装 WSJ AI 英语精读](https://raw.githubusercontent.com/zijian-z/sr-modules/main/wsj-ai-reading/WSJ-AI-Reading.conf)
- 在 Shadowrocket 打开「配置 → 模块 → WSJ AI 英语精读 → 编辑参数」，填写 `ZAI_API_KEY`。
- 需开启 HTTPS 解密并信任根证书。与下方 Google 模块拦截同一文章接口，启用其中一个即可。已读文章可能命中 App 缓存，首次验证可打开一篇未读文章。
- 每篇文章发起一次 Z.AI 通用 API 请求，发送的内容仅包括标题、副标题和正文中的文本，长度有上限（约 16,000 个字符）。调用需要账户开通 `GLM-5.3-Flash` 通用 API 并有可用余额或资源包。[Coding Plan 额度仅适用于 Z.AI 官方支持的工具](https://docs.z.ai/legal-agreement/subscription-terms)，无法用于此模块。
- 缺少 Key、请求失败或超时时，WSJ 会照常显示英文原文。相同错误在 1 分钟内只提示一次。需要确认脚本是否触发时，可以把「调试通知」设为「开」。

### 🆆🆂🅹 WSJ 自动翻译

为 WSJ iOS App 的原生文章页生成中英双语对照：标题、副标题与正文逐段追加 Google 翻译译文。

- 安装地址：
  ```
  https://raw.githubusercontent.com/zijian-z/sr-modules/main/wsj-translate/WSJ.conf
  ```
- 依赖：需在 Shadowrocket 中开启 HTTPS 解密（MITM）并安装信任根证书
- 原理：拦截 `shared-data.dowjones.io` 的 GraphQL `ArticleContent` 响应，翻译后写回；同时拒绝该域名的 QUIC（UDP 443）以强制走可解密的 TCP
- 翻译接口：Google 翻译免费接口（`translate_a/single`），三个等价域名自动降级重试
- 已读文章可能命中 App 本地缓存，重新进入或下拉刷新可触发翻译
- 目标语言可在模块参数中修改（默认 `zh-CN`，支持 `zh-TW` / `zh-HK` / `ja` / `ko` 等）

## 目录结构

```
sr-modules/
├── README.md
├── wsj-ai-reading/
│   ├── WSJ-AI-Reading.conf
│   └── wsj_ai_reading.js
└── wsj-translate/
    ├── WSJ.conf
    └── wsj_translate.js
```

新增模块时：新建 `<模块名>/` 目录，放入 `.conf` 与脚本，脚本地址引用本仓库 raw 链接，并更新本 README。
