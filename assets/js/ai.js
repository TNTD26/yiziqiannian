/* ============================================================
 * 一字千年 · AI 桥接层  AI BRIDGE
 * ------------------------------------------------------------
 * 双通道设计：
 *   A. 云端通道 —— 接入任意 OpenAI 兼容的多模态视觉大模型
 *      （GPT-4o / 通义千问 Qwen-VL / 智谱 GLM-4V / 硅基流动 / 本地 Ollama …）
 *      在页面「AI 设置」中填入 BaseURL、模型名与 Key 即可生效。
 *   B. 本地通道 —— 内置视觉特征引擎（vision.js），完全离线可运行，
 *      比赛现场无网络也能完整演示识别闭环。
 *
 * 云端失败时自动回落本地通道，保证体验不中断。
 * ============================================================ */

const AIBridge = (() => {

  const LS_KEY = "yiziqian_ai_config";

  const PRESETS = {
    deepseek: {
      name: "DeepSeek", base: "https://api.deepseek.com/v1", model: "deepseek-v4-flash-vision-exp",
      note: "⚠️ DeepSeek 只有这一个模型支持图片输入，填其他模型名会报错" +
            "（如 deepseek-chat / deepseek-v4-pro 均为纯文本）。图片按 384 token 计费。"
    },
    qwen: {
      name: "通义千问", base: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-vl-plus",
      note: "千问视觉模型可选 qwen-vl-plus / qwen-vl-max / qwen2.5-vl-72b-instruct。"
    },
    glm: {
      name: "智谱 GLM", base: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4v-flash",
      note: "glm-4v-flash 为免费视觉模型，适合演示。"
    },
    silicon: {
      name: "硅基流动", base: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen2.5-VL-72B-Instruct",
      note: "硅基流动多款 VL 模型有免费额度。"
    },
    openai: {
      name: "OpenAI", base: "https://api.openai.com/v1", model: "gpt-4o-mini",
      note: "需确认账户可访问该模型，国内网络通常需代理。"
    },
    ollama: {
      name: "本地 Ollama", base: "http://localhost:11434/v1", model: "llava",
      note: "需先执行 ollama pull llava；本地 Key 可任意填写。"
    }
  };

  /** 已知"填了也看不到图片"的常见坑：服务商 → { 正确视觉模型, 识别正则 } */
  const VISION_ONLY_HINT = [
    {
      host: "api.deepseek.com",
      test: m => m === "deepseek-v4-flash-vision-exp",
      msg: "DeepSeek 只有 deepseek-v4-flash-vision-exp 一个模型支持图片输入，" +
           "填 deepseek-chat / deepseek-v4-pro 等纯文本模型必定失败。请改用它。"
    },
    {
      host: "open.bigmodel.cn",
      test: m => /glm-4v|glm-4\.1v|vision/i.test(m),
      msg: "智谱需使用 glm-4v-flash / glm-4v-plus 等 4v 系列视觉模型，" +
           "glm-4-plus 等纯文本模型看不到图片。"
    },
    {
      host: "dashscope.aliyuncs.com",
      test: m => /vl|vision|omn?i/i.test(m),
      msg: "通义千问需使用 qwen-vl-plus / qwen-vl-max / qwen2.5-vl-* 等 VL 系列视觉模型。"
    },
    {
      host: "localhost",
      test: m => /llava|vision|vl|minicpm|qwen/i.test(m),
      msg: "本地模型需本身是多模态的（llava / minicpm-v / qwen2.5vl 等），" +
           "纯文本模型如 llama / qwen2.5 看不到图片。"
    }
  ];

  /** 按 BaseURL + 模型名给出针对性排错提示；配置正确时返回空串 */
  function providerHint(base, model) {
    let host = "";
    try { host = new URL(base).host; } catch (e) { return ""; }
    const hit = VISION_ONLY_HINT.find(p => host === p.host || host.indexOf(p.host) >= 0);
    if (!hit) return "";
    return hit.test((model || "").trim()) ? "" : hit.msg;
  }

  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { }
    return { enabled: false, base: PRESETS.qwen.base, model: PRESETS.qwen.model, key: "" };
  }
  function save(cfg) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch (e) { }
  }
  function isReady(cfg) { return !!(cfg && cfg.enabled && cfg.key && cfg.base && cfg.model); }

  /* ---------- 视觉识别提示词 ---------- */
  // 候选表直接从字库动态生成（119 字），避免硬编码清单与字库脱节——
  // 曾发生过候选表停在 24 字、云端想选「耳」都没资格的坑
  const CANDIDATES = (typeof GLYPH_LIB !== "undefined")
    ? Object.keys(GLYPH_LIB).join(" ")
    : "日 月 山 水 火 人 木 田 鱼 鸟 鹿 马 牛 羊 犬 目 女 子 门 雨 云 弓 鼎 心";

  const RECOG_PROMPT = `你是一位甲骨文学者。请观察图片中的古文字字形（可能是甲骨文、金文或小篆的拓片、照片或手绘）。

本演示字库共有以下 ${CANDIDATES.split(/\s+/).length} 个候选字：
${CANDIDATES}

请按以下步骤推理（过程不必输出）：
a. 先数图中笔画的走向、交叉点数量与封闭空腔（洞）的数量；
b. 再与候选字逐一对照结构，排除明显不符的；
c. 从剩余候选中选出最匹配的一个。注意区分形近字：日（中一横，1 个封闭空腔）、目（中两横，2 个空腔）、田（中十字，4 个空腔）、曰/白不会出现；月有弧形缺角；口为素环无内笔；水是多条分散短笔画、无封闭空腔。
2. 只有当你非常确信图中字形不属于任何候选字时，才允许给出候选之外的字。
3. 给出判断依据（不超过 50 字，点出关键笔画或结构特征）。
4. 给出 0—100 的置信度。

只输出如下 JSON，不要任何多余文字：
{"char":"一个简体汉字","reason":"判断依据","conf":87}`;

  /* ---------- 文化解读提示词 ---------- */
  function interpretPrompt(char, era) {
    return `你是甲骨文与汉字文化研究者。请用不超过 90 字，写一段关于汉字「${char}」在${era}阶段的诗性文化解读。
要求：有画面感、有现代视角、避免学术腔，适合展览展签文案。直接输出文字，不要标题和引号。`;
  }

  /**
   * 把 HTTP 错误翻译成人话。返回 { msg, hint }
   * —— 之前只显示"连接失败"，完全查不出是 Key 错、模型名错还是模型不支持图片。
   */
  function explainHttp(status, bodyText, base, model) {
    const b = (bodyText || "").slice(0, 300);
    // 只有当错误与"模型/图片"相关时才附上模型选型的线索，避免 Key 错时给错方向
    const modelRelated = /image|vision|multimodal|model|图片|视觉|模型/i.test(b);
    const hint = modelRelated ? providerHint(base, model) : "";
    let msg;
    if (status === 401 || status === 403) {
      msg = `鉴权失败（HTTP ${status}）：API Key 无效、已过期，或该 Key 无此模型权限。`;
    } else if (status === 404) {
      // chat() 已自动试过带 /v1 和不带 /v1 两种写法，这里说明两种都失败了
      msg = `接口不存在（HTTP 404）：已尝试 ${base.replace(/\/+$/, "")}/chat/completions 与去 /v1 写法均失败，` +
            `请核对域名是否正确（例如通义千问的国内地址是 /compatible-mode/v1）。`;
    } else if (status === 429) {
      msg = `请求被限流（HTTP 429）：账户额度不足或超出速率限制。`;
    } else if (status === 400) {
      if (/does not support image|image|vision|multimodal|图片|视觉/i.test(b)) {
        msg = `模型不支持图片输入：${b.slice(0, 120)}`;
        if (!hint) hint = "请换成该服务商带 VL / Vision / 4v 后缀的视觉模型。";
      } else if (/model|模型/i.test(b)) {
        msg = `模型名不存在或无权限：${b.slice(0, 120)}`;
      } else {
        msg = `请求被拒绝（HTTP 400）：${b.slice(0, 120)}`;
      }
    } else if (status >= 500) {
      msg = `服务端错误（HTTP ${status}）：服务商临时故障，可稍后重试。`;
    } else {
      msg = `HTTP ${status}：${b.slice(0, 120)}`;
    }
    return { msg, hint };
  }

  /** 模型回了话但不是 JSON —— 多半是它压根没看到图 */
  function explainNoJson(text, base, model) {
    const t = (text || "").trim().slice(0, 120);
    const blind = /无法|看不|没有.*图|不能.*图|看不见|no image|cannot see|unable to (see|view)|don't see|文本模型|pure.?text/i.test(t);
    let msg = blind
      ? `模型看不到这张图，回复：「${t}」`
      : `模型未按格式返回 JSON，实际回复：「${t}」`;
    return { msg, hint: providerHint(base, model) || "该模型可能不是视觉多模态模型，或提示词遵循能力较弱（可换用更大模型）。" };
  }

  /**
   * 统一发送 chat/completions。
   * 自动处理 BaseURL 带不带 /v1 的差异：主地址 404 时试另一个写法。
   */
  async function chat(cfg, body) {
    const b0 = cfg.base.replace(/\/+$/, "");
    const candidates = b0.endsWith("/v1") ? [b0, b0.slice(0, -3)] : [b0, b0 + "/v1"];
    let lastErr = null;
    for (const b of candidates) {
      let res;
      try {
        res = await fetch(b + "/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + cfg.key
          },
          body: JSON.stringify(body)
        });
      } catch (e) {
        // fetch 直接抛错 = 网络层问题：跨域被拒 / DNS / 服务未启动
        lastErr = {
          msg: `网络请求失败：${e.message}`,
          hint: b.startsWith("http://localhost")
            ? "本地 Ollama 需先启动服务（ollama serve），且页面需用 http:// 打开而非 file://。"
            : "可能是跨域（CORS）被拒绝、地址写错或网络不通。浏览器直连大模型 API 需要对方允许跨域。"
        };
        continue;
      }
      const text = await res.text();
      if (!res.ok) {
        const info = explainHttp(res.status, text, b, cfg.model);
        lastErr = res.status === 404 && b !== candidates[candidates.length - 1] ? lastErr : info;
        if (res.status === 404) continue;   // 换另一个 /v1 写法再试
        throw Object.assign(new Error(info.msg), { hint: info.hint });
      }
      let json;
      try { json = JSON.parse(text); }
      catch (e) { throw Object.assign(new Error("响应不是合法 JSON：" + text.slice(0, 120)), { hint: providerHint(b, cfg.model) }); }
      return { json, usedBase: b };
    }
    throw Object.assign(new Error(lastErr ? lastErr.msg : "请求失败"), { hint: lastErr ? lastErr.hint : "" });
  }

  /* ---------- 调用多模态大模型 ---------- */
  async function visionRecognize(cfg, dataUrl) {
    // DeepSeek 等对 max_tokens 敏感，统一放宽
    const { json } = await chat(cfg, {
      model: cfg.model,
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: dataUrl } },
          { type: "text", text: RECOG_PROMPT }
        ]
      }],
      temperature: 0.2,
      max_tokens: 300
    });
    if (json.error && json.error.message) {
      throw Object.assign(new Error("接口返回错误：" + json.error.message.slice(0, 120)),
        { hint: providerHint(cfg.base, cfg.model) });
    }
    const content = json.choices?.[0]?.message?.content || "";

    // 部分模型返回的是 content 数组（如 GLM-4v / Claude 兼容层）
    const rawText = Array.isArray(content)
      ? content.map(x => x.text || "").join("")
      : String(content);

    const m = rawText.match(/\{[\s\S]*\}/);
    if (!m) {
      const info = explainNoJson(rawText, cfg.base, cfg.model);
      throw Object.assign(new Error(info.msg), { hint: info.hint });
    }
    let o;
    try { o = JSON.parse(m[0]); }
    catch (e) {
      const info = explainNoJson(rawText, cfg.base, cfg.model);
      throw Object.assign(new Error("模型返回的 JSON 无法解析：" + info.msg), { hint: info.hint });
    }
    return {
      char: (o.char || "").trim().slice(0, 1),
      reason: o.reason || "",
      conf: Math.min(1, Math.max(0, (Number(o.conf) || 60) / 100)),
      source: "cloud"
    };
  }

  async function cloudInterpret(cfg, char, era) {
    const { json } = await chat(cfg, {
      model: cfg.model,
      messages: [{ role: "user", content: interpretPrompt(char, era) }],
      temperature: 0.85,
      max_tokens: 260
    });
    const c = json.choices?.[0]?.message?.content || "";
    return (Array.isArray(c) ? c.map(x => x.text || "").join("") : String(c)).trim();
  }

  /* ---------- 统一入口 ---------- */
  return {
    PRESETS, load, save, isReady, providerHint,
    visionRecognize, cloudInterpret,
    /**
     * 识别一张图。localFeat 为本地引擎已算出的特征（可为 null）
     * 返回 { char, conf, reason, source, candidates[] }
     */
    async recognize(cfg, dataUrl, queryFeat, presetList) {
      // 本地候选先算出来，作为兜底与融合依据
      // presetList：调用方已做过多角度稳健识别时直接沿用，避免重复计算
      let localList = presetList || [];
      if (!localList.length && queryFeat) localList = Vision.recognizeAll(queryFeat);

      if (isReady(cfg)) {
        try {
          const r = await visionRecognize(cfg, dataUrl);
          if (r.char && GLYPH_LIB[r.char]) {
            // 云端答案在库内 → 与本地结果融合。
            // 融合原则（实测教训）：通用视觉大模型对古文字拓片的猜测并不可靠
            // （曾把一张标准甲骨文「日」拓片说成「水」80%），因此云端只能在
            // 本地候选里"有证据地改判"，绝不能把本地 Top5 之外的字无中生有地
            // 顶到第一——本地引擎就是为这个 119 字库专门设计的，证据链更硬。
            const li = localList.findIndex(x => x.char === r.char);
            const localTop = localList[0];
            if (li > 0 && li <= 2 && localTop && localTop.conf < .45 && r.conf >= .6) {
              // 本地明显不自信、云端较自信，且云端答案位列本地前三（有真实证据）
              // → 采信云端，但置信度取两通道的保守合成（几何均值型），不虚高
              const flipped = localList.map(x => ({ ...x }));
              const localConf = flipped[li].conf;
              flipped[li].conf = Math.min(.92, Math.sqrt(r.conf * Math.max(localConf, r.conf * .5)));
              flipped.sort((a, b) => b.conf - a.conf);
              return {
                char: flipped[0].char,
                conf: flipped[0].conf,
                reason: "本地特征引擎把握不足（首选仅 " + (localTop.conf * 100).toFixed(0) +
                  "%），云端视觉模型判定「" + r.char + "」且该字在本地候选中亦有支持，采信云端：" + r.reason,
                source: "cloud",
                candidates: flipped
              };
            }
            if (li > 0) {
              // 云端与本地 top1 有分歧：温和并票，但云端票不足以直接翻盘，
              // 只能拉近差距——最终排序仍以本地证据为主
              const merged = localList.map(x => ({ ...x }));
              merged[li].conf = Math.min(localTop.conf * 0.96, merged[li].conf + r.conf * 0.18);
              merged.sort((a, b) => b.conf - a.conf);
              return {
                char: merged[0].char,
                conf: merged[0].conf,
                reason: "本地特征引擎以 " + (merged[0].conf * 100).toFixed(0) + "% 领先，保留「" + merged[0].char +
                    "」；云端模型给出的是「" + r.char + "」（" + (r.conf * 100).toFixed(0) + "%），已作为参考并入候选：" + r.reason,
                source: "hybrid",
                candidates: merged
              };
            }
            if (li === -1 && localList.length) {
              // 云端答案在本地候选中毫无证据（连 Top5 都不是）→ 不采信，
              // 保留本地判定，如实说明分歧
              return {
                char: localList[0].char,
                conf: localList[0].conf,
                reason: "本地特征引擎判定「" + localList[0].char + "」（拓扑与笔画分布均有支持）；云端模型猜测「" +
                  r.char + "」，但该字在本地候选中没有任何证据支持，未采信：" + r.reason,
                source: "hybrid",
                candidates: localList
              };
            }
            const agreeNote = li === 0 ? "，与本地特征引擎结论一致" : "";
            const conf = li === 0
              ? Math.min(.97, 1 - (1 - r.conf) * (1 - localList[0].conf))   // 双通道一致 → 置信增强
              : r.conf;
            return {
              char: r.char,
              conf,
              reason: r.reason + agreeNote,
              source: li === 0 ? "hybrid" : "cloud",
              candidates: localList
            };
          }
          // 模型给出的字不在库中（如用户画的是库外字）→ 如实回落本地
          if (localList.length) {
            return {
              char: localList[0].char,
              conf: localList[0].conf,
              reason: "云端模型猜测「" + r.char + "」，但该字不在本演示的 119 字字库内（您写的可能是库外字）；已按本地特征引擎给出库内最接近的候选。",
              source: "local",
              candidates: localList
            };
          }
        } catch (e) {
          console.warn("[AI] 云端识别失败，回落本地引擎：", e.message);
        }
      }
      if (!localList.length) throw new Error("未能从图像中提取到有效笔画");
      return {
        char: localList[0].char,
        conf: localList[0].conf,
        reason: "基于笔画密度投影、骨架拓扑（端点/交叉点）、空腔数与对称性的向量比对结果。",
        source: "local",
        candidates: localList
      };
    }
  };
})();
