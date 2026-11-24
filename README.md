# sr-modules

个人 Shadowrocket 模块合集。每个模块一个目录，包含模块配置（`.conf`）与所需脚本。

## 模块列表

### 🅉🅷🅸🅷🆄 知乎自动翻译（中文转外语）

为知乎 iOS App 生成中英（或其他语言）双语对照：问题标题与回答正文逐段追加 Google 翻译译文，默认中文转英文。

- 安装地址：
  ```
  https://raw.githubusercontent.com/zijian-z/sr-modules/main/zhihu-translate/ZHIHU.conf
  ```
- 覆盖接口：回答详情（`answers/v2`）、推荐流展开（`next-render`）、问题详情、回答列表（问题标题）
- 正文取自 `structured_content.segments[].paragraph.text`（只追加不改原文，marks 富文本标记不受影响）
- 含至少 2 个汉字的段落才翻译，中英混排也能覆盖
- 依赖：MITM 开启并信任根证书；拒掉 `api.zhihu.com` 的 QUIC 强制走 TCP
- 暂不支持：专栏文章（未抓包分析）、问题补充说明（HTML 格式）、回答列表里的内容摘要（excerpt）
- 翻译失败会弹系统通知（完全失败必弹；调试模式每次都弹），三域名自动降级

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
├── wsj-translate/
│   ├── WSJ.conf          # 模块配置
│   └── wsj_translate.js  # 翻译脚本
└── zhihu-translate/
    ├── ZHIHU.conf
    └── zhihu_translate.js
```

新增模块时：新建 `<模块名>/` 目录，放入 `.conf` 与脚本，脚本地址引用本仓库 raw 链接，并更新本 README。
