# sr-modules

个人 Shadowrocket 模块合集。每个模块一个目录，包含模块配置（`.conf`）与所需脚本。

## 模块列表

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
└── wsj-translate/
    ├── WSJ.conf          # 模块配置
    └── wsj_translate.js  # 翻译脚本
```

新增模块时：新建 `<模块名>/` 目录，放入 `.conf` 与脚本，脚本地址引用本仓库 raw 链接，并更新本 README。
