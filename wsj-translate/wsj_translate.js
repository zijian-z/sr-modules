(() => {
  const DEFAULT_TARGET_LANGUAGE = "zh-CN";
  const SEPARATOR = "\n|||\n";
  const CHUNK_CHAR_LIMIT = 1100;
  const REQUEST_TIMEOUT = 10;

  // 读取模块参数：翻译目标语言
  const args = typeof $argument === "string" ? $argument.split("|") : [];

  const targetLanguage = (args[0] || "").trim();
  const TARGET_LANGUAGE =
    /^[a-zA-Z0-9-]+$/.test(targetLanguage)
      ? targetLanguage
      : DEFAULT_TARGET_LANGUAGE;

  // 根据目标语言显示对应的地区旗帜
  const LANGUAGE_FLAGS = {
    "zh-CN": "🇨🇳",
    "zh-SG": "🇸🇬",
    "zh-TW": "🇹🇼",
    "zh-HK": "🇭🇰",
    "en": "🇺🇸",
    "en-US": "🇺🇸",
    "en-GB": "🇬🇧",
    "en-AU": "🇦🇺",
    "en-CA": "🇨🇦",
    "ja": "🇯🇵",
    "ko": "🇰🇷",
    "fr": "🇫🇷",
    "fr-CA": "🇨🇦",
    "de": "🇩🇪",
    "es": "🇪🇸",
    "es-MX": "🇲🇽",
    "pt": "🇧🇷",
    "pt-BR": "🇧🇷",
    "pt-PT": "🇵🇹",
    "ru": "🇷🇺",
    "it": "🇮🇹",
    "nl": "🇳🇱",
    "pl": "🇵🇱",
    "tr": "🇹🇷",
    "th": "🇹🇭",
    "vi": "🇻🇳",
    "id": "🇮🇩",
    "ms": "🇲🇾",
    "ar": "🇸🇦",
    "hi": "🇮🇳",
    "uk": "🇺🇦",
    "sv": "🇸🇪",
    "da": "🇩🇰",
    "no": "🇳🇴",
    "fi": "🇫🇮",
    "cs": "🇨🇿",
    "el": "🇬🇷",
    "he": "🇮🇱",
    "ro": "🇷🇴",
    "hu": "🇭🇺"
  };

  const TRANSLATE_FLAG = LANGUAGE_FLAGS[TARGET_LANGUAGE] || "🌐";

  const body = $response.body;

  if (!body) {
    return $done({});
  }

  let data;

  try {
    data = JSON.parse(body);
  } catch (err) {
    return $done({});
  }

  const article =
    data && data.data && data.data.articleContent;

  if (!article || !Array.isArray(article.articleBody)) {
    return $done({});
  }

  const zhRatio = (s) =>
    ((s || "").match(/[一-龥]/g) || []).length /
    Math.max(s.length, 1);

  // 收集正文里所有带纯文本的块（段落/小标题/引述等）
  const targets = [];

  const collect = (obj) => {
    if (!obj || typeof obj !== "object") {
      return;
    }

    const flat =
      obj.textAndDecorations &&
      obj.textAndDecorations.flattened;

    if (flat && typeof flat.text === "string") {
      const text = flat.text;

      if (text.trim().length > 1 && zhRatio(text) < 0.4) {
        targets.push(flat);
      }
    }

    for (const key of Object.keys(obj)) {
      // 不动 decorations，里面是股票行情、链接等元数据
      if (key === "decorations" || key === "textAndDecorations") {
        continue;
      }

      collect(obj[key]);
    }
  };

  collect(article.articleBody);

  // 副标题是独立字段，紧跟标题之后
  const standFirstFlat =
    article.standFirst &&
    article.standFirst.textAndDecorations &&
    article.standFirst.textAndDecorations.flattened;

  if (
    standFirstFlat &&
    typeof standFirstFlat.text === "string" &&
    standFirstFlat.text.trim().length > 1 &&
    zhRatio(standFirstFlat.text) < 0.4
  ) {
    targets.unshift(standFirstFlat);
  }

  // 标题放在最前面，译文带旗帜
  const headline =
    article.articleHeadline && article.articleHeadline.flattened;

  if (
    headline &&
    typeof headline.text === "string" &&
    headline.text.trim().length > 1 &&
    zhRatio(headline.text) < 0.4
  ) {
    targets.unshift(headline);
  }

  if (targets.length === 0) {
    return $done({});
  }

  // 按段落边界分块，控制每次翻译请求的长度
  const chunks = [];
  let currentChunk = [];
  let currentLength = 0;

  for (const node of targets) {
    const text = node.text;

    if (
      currentLength + text.length > CHUNK_CHAR_LIMIT &&
      currentChunk.length > 0
    ) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentLength = 0;
    }

    currentChunk.push(node);
    currentLength += text.length + SEPARATOR.length;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  const results = new Array(chunks.length).fill(null);
  let remaining = chunks.length;

  // Google 翻译有多个等价入口，被风控(302/sorry)时自动换下一个
  const TRANSLATE_HOSTS = [
    "translate.google.com",
    "clients5.google.com",
    "translate.googleapis.com"
  ];

  const finish = () => {
    try {
      chunks.forEach((chunk, chunkIndex) => {
        const raw = results[chunkIndex];

        if (!raw) {
          return;
        }

        const res = JSON.parse(raw);

        const translatedCombined = (res[0] || [])
          .map((item) => (item && item[0] ? item[0] : ""))
          .join("");

        const translatedParts = translatedCombined.split(
          /\n\s*\|\|\|\s*\n/
        );

        // 分隔后的段落数量对不上就放弃这一块，避免错位
        if (translatedParts.length !== chunk.length) {
          return;
        }

        chunk.forEach((node, nodeIndex) => {
          const translatedText =
            (translatedParts[nodeIndex] || "").trim();

          if (
            !translatedText ||
            translatedText === node.text.trim()
          ) {
            return;
          }

          // 标题译文带旗帜，其余段落只追加译文
          const prefix =
            node === headline ? `${TRANSLATE_FLAG} ` : "";

          node.text = `${node.text}\n${prefix}${translatedText}`;
        });
      });

      return $done({
        body: JSON.stringify(data)
      });
    } catch (err) {
      return $done({});
    }
  };

  const requestChunk = (chunkIndex, hostIndex) => {
    const chunk = chunks[chunkIndex];
    const url =
      "https://" +
      TRANSLATE_HOSTS[hostIndex] +
      "/translate_a/single" +
      "?client=gtx&sl=auto&tl=" +
      encodeURIComponent(TARGET_LANGUAGE) +
      "&dt=t&q=" +
      encodeURIComponent(
        chunk.map((node) => node.text).join(SEPARATOR)
      );

    $httpClient.get(
      {
        url,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
            "AppleWebKit/605.1.15 (KHTML, like Gecko) " +
            "Version/17.0 Mobile/15E148 Safari/604.1"
        },
        timeout: REQUEST_TIMEOUT * 1000
      },
      function (error, response, responseData) {
        if (
          !error &&
          response &&
          response.status === 200 &&
          responseData
        ) {
          results[chunkIndex] = responseData;
        } else if (hostIndex + 1 < TRANSLATE_HOSTS.length) {
          // 当前主机失败（被风控返回 302 等），换下一个入口重试
          return requestChunk(chunkIndex, hostIndex + 1);
        } else {
          results[chunkIndex] = null;
        }

        remaining -= 1;

        if (remaining === 0) {
          finish();
        }
      }
    );
  };

  chunks.forEach((_, chunkIndex) => {
    requestChunk(chunkIndex, 0);
  });
})();
