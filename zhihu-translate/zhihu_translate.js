(() => {
  const DEFAULT_TARGET_LANGUAGE = "en";
  const SEPARATOR = "\n|||\n";
  const CHUNK_CHAR_LIMIT = 1600;
  const REQUEST_TIMEOUT = 6;
  const MAX_CONCURRENT = 2;
  // 读取模块参数：翻译目标语言|调试通知
  const args = typeof $argument === "string" ? $argument.split("|") : [];

  const targetLanguage = (args[0] || "").trim();
  const TARGET_LANGUAGE =
    /^[a-zA-Z0-9-]+$/.test(targetLanguage)
      ? targetLanguage
      : DEFAULT_TARGET_LANGUAGE;

  const debugArg = (args[1] || "").trim().toLowerCase();
  const DEBUG = debugArg === "开" || debugArg === "on";

  const LANGUAGE_FLAGS = {
    "en": "🇺🇸",
    "en-US": "🇺🇸",
    "en-GB": "🇬🇧",
    "en-AU": "🇦🇺",
    "en-CA": "🇨🇦",
    "zh-CN": "🇨🇳",
    "zh-TW": "🇹🇼",
    "zh-HK": "🇭🇰",
    "ja": "🇯🇵",
    "ko": "🇰🇷",
    "fr": "🇫🇷",
    "de": "🇩🇪",
    "es": "🇪🇸",
    "pt": "🇧🇷",
    "ru": "🇷🇺",
    "it": "🇮🇹",
    "th": "🇹🇭",
    "vi": "🇻🇳",
    "id": "🇮🇩",
    "ar": "🇸🇦"
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

  // 含至少 2 个汉字就翻译（知乎大量中英混排段落）
  const isChinese = (s) =>
    typeof s === "string" &&
    s.trim().length > 1 &&
    ((s.match(/[一-龥]/g) || []).length >= 2);

  // 收集翻译目标：正文段落节点（{text, marks, pid}）与问题标题
  const paragraphNodes = [];
  const titleNodes = [];

  const walk = (obj) => {
    if (!obj || typeof obj !== "object") {
      return;
    }

    if (Array.isArray(obj)) {
      obj.forEach(walk);
      return;
    }

    for (const key of Object.keys(obj)) {
      const value = obj[key];

      if (
        (key === "structured_content" ||
          key === "structured_content_vip") &&
        value &&
        typeof value === "object"
      ) {
        collectSegments(value);
      } else if (key === "question" && value && typeof value === "object") {
        if (isChinese(value.title)) {
          titleNodes.push(value);
        }
        // 问题补充说明是 HTML，暂不处理
      } else {
        walk(value);
      }
    }
  };

  const collectSegments = (structured) => {
    const segments = structured && structured.segments;

    if (!Array.isArray(segments)) {
      return;
    }

    for (const segment of segments) {
      const paragraph = segment && segment.paragraph;

      if (
        paragraph &&
        typeof paragraph === "object" &&
        Array.isArray(paragraph.marks) &&
        isChinese(paragraph.text)
      ) {
        paragraphNodes.push(paragraph);
      }
    }
  };

  walk(data);

  // 标题在前（带旗帜），段落在后
  const targets = titleNodes.concat(paragraphNodes);

  if (targets.length === 0) {
    return $done({});
  }

  // 标题节点文本在 .title，正文段落节点文本在 .text
  const getText = (node) =>
    node.text !== undefined ? node.text : node.title;

  const setText = (node, value) => {
    if (node.text !== undefined) {
      node.text = value;
    } else {
      node.title = value;
    }
  };

  // 按段落边界分块，控制每次翻译请求的长度
  const chunks = [];
  let currentChunk = [];
  let currentLength = 0;

  for (const node of targets) {
    const text = getText(node);

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
  const failReasons = [];

  // Google 翻译有多个等价入口，被风控(302/sorry)时自动换下一个
  const TRANSLATE_HOSTS = [
    "translate.google.com",
    "clients5.google.com",
    "translate.googleapis.com"
  ];

  const notify = (translatedCount) => {
    if (
      typeof $notification === "undefined" ||
      !$notification.post
    ) {
      return;
    }

    const failedChunks = results.filter((r) => !r).length;
    const totalFail = translatedCount === 0;

    if (!DEBUG && !totalFail) {
      return;
    }

    const reason =
      failReasons.length > 0
        ? failReasons.slice(0, 2).join("；")
        : "翻译响应结构异常";

    $notification.post(
      totalFail ? "知乎 翻译失败" : "知乎 翻译调试",
      `已译 ${translatedCount}/${targets.length} 段，失败分块 ${failedChunks}/${chunks.length}`,
      reason
    );
  };

  const finish = () => {
    try {
      let translatedCount = 0;

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
          failReasons.push(
            `块${chunkIndex + 1}: 段落数不匹配`
          );
          return;
        }

        chunk.forEach((node, nodeIndex) => {
          const translatedText =
            (translatedParts[nodeIndex] || "").trim();

          if (
            !translatedText ||
            translatedText === getText(node).trim()
          ) {
            return;
          }

          // 标题译文带旗帜，正文段落只追加译文
          const prefix =
            titleNodes.indexOf(node) !== -1
              ? `${TRANSLATE_FLAG} `
              : "";

          setText(node, `${getText(node)}\n${prefix}${translatedText}`);
          translatedCount += 1;
        });
      });

      notify(translatedCount);

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
      "?client=gtx&sl=zh-CN&tl=" +
      encodeURIComponent(TARGET_LANGUAGE) +
      "&dt=t&q=" +
      encodeURIComponent(
        chunk.map((node) => getText(node)).join(SEPARATOR)
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
          failReasons.push(
            `块${chunkIndex + 1}: ` +
              (error
                ? "网络错误/超时"
                : `HTTP ${response ? response.status : "?"}`)
          );
        }

        remaining -= 1;
        active -= 1;
        pump();

        if (remaining === 0) {
          finish();
        }
      }
    );
  };

  // 限制并发，避免突发请求触发 Google 风控
  let nextChunk = 0;
  let active = 0;

  const pump = () => {
    while (active < MAX_CONCURRENT && nextChunk < chunks.length) {
      active += 1;
      requestChunk(nextChunk, 0);
      nextChunk += 1;
    }
  };

  pump();
})();
