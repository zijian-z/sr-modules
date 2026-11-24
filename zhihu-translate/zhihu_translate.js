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

  const path =
    typeof $request !== "undefined" && typeof $request.url === "string"
      ? $request.url.replace(/^https?:\/\/[^/]+/, "").split("?")[0]
      : "";

  const report = (message, detail) => {
    const title = "知乎翻译 · " + message;
    const endpoint = path || "未知接口";
    console.log(title + " " + endpoint + " " + detail);

    if (typeof $notification !== "undefined" &&
        typeof $notification.post === "function") {
      $notification.post(title, endpoint, detail);
    }
  };

  const skip = (reason) => {
    if (DEBUG) {
      report("跳过", reason);
    }
    return $done({});
  };

  if (DEBUG) {
    report("脚本已触发", "正在检查响应正文");
  }

  const body = $response.body;

  if (!body) {
    return skip("Shadowrocket 没有传入响应正文");
  }

  let data;

  try {
    data = JSON.parse(body);
  } catch (err) {
    return skip("知乎响应正文无法解析为 JSON");
  }

  // 含至少 2 个汉字就翻译（知乎大量中英混排段落）
  const isChinese = (s) =>
    typeof s === "string" &&
    s.trim().length > 1 &&
    ((s.match(/[一-龥]/g) || []).length >= 2);

  // 收集翻译目标：正文段落节点（{text, marks, pid}）与问题标题
  const paragraphNodes = [];
  const titleNodes = new Set();
  const addTitle = (node) => {
    if (node && isChinese(node.title)) {
      titleNodes.add(node);
    }
  };

  if (/^\/(?:v\d+\/)?questions\/\d+\/?$/.test(path)) {
    addTitle(data);
    addTitle(data && data.data);
  }

  const walk = (obj) => {
    if (!obj || typeof obj !== "object") {
      return;
    }

    if (Array.isArray(obj)) {
      obj.forEach(walk);
      return;
    }

    if (obj.type === "question") {
      addTitle(obj);
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
        addTitle(value);
        walk(value);
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
        isChinese(paragraph.text)
      ) {
        paragraphNodes.push(paragraph);
      }
    }
  };

  walk(data);

  // 标题在前（带旗帜），段落在后
  const targets = [...titleNodes, ...paragraphNodes];

  if (targets.length === 0) {
    return skip("JSON 里未找到符合条件的问题标题或中文正文段落");
  }

  // 标题节点文本在 .title，正文段落节点文本在 .text
  const getText = (node) =>
    titleNodes.has(node) ? node.title : node.text;

  const setText = (node, value) => {
    if (titleNodes.has(node)) {
      node.title = value;
    } else {
      node.text = value;
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

  const splitTranslation = (body, expectedCount) => {
    let response;

    try {
      response = JSON.parse(body);
    } catch (err) {
      return null;
    }

    if (!Array.isArray(response) || !Array.isArray(response[0])) {
      return null;
    }

    const combined = response[0]
      .map((item) => (Array.isArray(item) && typeof item[0] === "string" ? item[0] : ""))
      .join("");

    const parts = combined.split(/\s*\|\|\|\s*/).map((part) => part.trim());
    return parts.length === expectedCount && parts.every(Boolean) ? parts : null;
  };

  const finish = () => {
    let translatedCount = 0;

    chunks.forEach((chunk, chunkIndex) => {
      const parts = results[chunkIndex];
      if (!parts) {
        return;
      }

      chunk.forEach((node, nodeIndex) => {
        const original = getText(node);
        const translated = parts[nodeIndex];
        if (translated === original.trim()) {
          return;
        }

        const prefix = titleNodes.has(node) ? TRANSLATE_FLAG + " " : "";
        setText(node, original + "\n" + prefix + translated);
        translatedCount += 1;
      });
    });

    if (DEBUG || translatedCount === 0) {
      const detail = ["已译 " + translatedCount + "/" + targets.length + " 段"];
      if (failReasons.length) {
        detail.push(...failReasons.slice(0, 2));
      } else if (translatedCount === 0) {
        detail.push("Google 返回的文本与原文相同");
      }
      report(translatedCount ? "翻译结束" : "翻译失败", detail.join("；"));
    }

    return $done(translatedCount ? { body: JSON.stringify(data) } : {});
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
        const status = response && (response.status || response.statusCode);
        const parts = !error && status === 200
          ? splitTranslation(responseData, chunk.length)
          : null;

        if (parts) {
          results[chunkIndex] = parts;
        } else if (hostIndex + 1 < TRANSLATE_HOSTS.length) {
          return requestChunk(chunkIndex, hostIndex + 1);
        } else {
          const reason = error
            ? "网络错误或超时"
            : status === 200
              ? "Google 响应格式或段落数不匹配"
              : "Google HTTP " + (status || "未知");
          failReasons.push("第 " + (chunkIndex + 1) + " 批：" + reason);
        }

        remaining -= 1;
        active -= 1;
        if (remaining === 0) {
          finish();
        } else {
          pump();
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
      const chunkIndex = nextChunk;
      nextChunk += 1;
      requestChunk(chunkIndex, 0);
    }
  };

  pump();
})();
