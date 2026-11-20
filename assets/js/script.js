/* ============================================================
 * 一字千年 V2.0 · 交互主控
 * ============================================================ */

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const URLP = new URLSearchParams(location.search);

/* ---------------- Toast ---------------- */
let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
}

/* ---------------- 状态 ---------------- */
const state = {
  char: "日",
  era: "oracle",
  labChar: "鹿",
  labEra: "oracle",
  labStyle: "oracle",
  code: "0000",
  recResult: null,
  sourceCanvas: null,
  stopArt: null,
  cfg: AIBridge.load()
};

const G = c => GLYPH_LIB[c];
const svg = (c, era, size = 100, color = "currentColor") =>
  glyphSVG(G(c), era, { size, color });

/* ============================================================
 * 一、汉字探索
 * ============================================================ */
function renderCharList() {
  const list = $("#charList");
  list.innerHTML = "";
  CHAR_ORDER.forEach(c => {
    const b = document.createElement("button");
    b.className = "char-item" + (c === state.char ? " active" : "");
    b.innerHTML =
      `<span class="ci-glyph">${svg(c, "oracle", 30)}</span>` +
      `<b class="ci-modern">${c}</b>` +
      `<span>${G(c).pinyin}</span>`;
    b.onclick = () => selectChar(c);
    list.appendChild(b);
  });
}

function selectChar(c) {
  state.char = c;
  const e = G(c);
  $("#charCategory").textContent = e.category;
  $("#charIndex").textContent =
    `${String(CHAR_ORDER.indexOf(c) + 1).padStart(2, "0")} / ${String(CHAR_ORDER.length).padStart(2, "0")}`;
  $("#stageGlyph").innerHTML = svg(c, "oracle", 100);
  $("#sideBronze").innerHTML = svg(c, "bronze", 56) + `<small>金文</small>`;
  $("#sideSeal").innerHTML = svg(c, "seal", 56) + `<small>小篆</small>`;
  $("#sideModern").innerHTML = svg(c, "regular", 56) + `<small>楷书</small>`;
  $("#charPinyin").textContent = e.pinyin;
  $("#charGloss").textContent = e.gloss;
  $("#charPoem").textContent = e.poem || "";
  $("#charOrigin").textContent = e.origin;
  $("#charMeaning").textContent = e.ai;
  $("#charTags").innerHTML = e.tags.map(t => `<span class="tag">${t}</span>`).join("");
  $("#heroGlyph").innerHTML = svg(c, "oracle", 130);
  renderCharList();
  renderTimeline();
}

/* ============================================================
 * 二、演化时间轴
 * ============================================================ */
function renderTimeline() {
  const wrap = $("#timeline");
  wrap.innerHTML = "";
  ERAS.forEach((era, i) => {
    const d = document.createElement("div");
    d.className = "timeline-item" + (i === 0 ? " active" : "");
    d.innerHTML =
      `<div class="era">${era.period}</div>` +
      `<div class="glyph">${svg(state.char, era.key, 72)}</div>` +
      `<h4>${era.name}</h4><p>${era.year}</p>`;
    d.onclick = () => {
      $$(".timeline-item").forEach(x => x.classList.remove("active"));
      d.classList.add("active");
      showEra(era);
    };
    wrap.appendChild(d);
  });
  showEra(ERAS[0]);
}

function showEra(era) {
  $("#timelineGlyph").innerHTML = svg(state.char, era.key, 130);
  $("#timelineTitle").textContent = era.name;
  $("#timelineYear").textContent = era.year + " · " + era.period;
  $("#timelineDesc").textContent = era.desc;
  $("#timelineTech").textContent = era.tech;
}

/* 「查看演化轨迹」：滚到时间轴并自动播放五体演化 */
let evolveTimer = null;
/* 「AI 重写」：调用云端大模型重写该字的展签文案（未配置则提示） */
$("#aiRewriteBtn").onclick = async () => {
  const btn = $("#aiRewriteBtn");
  const era = (ERAS.find(x => x.key === state.era) || ERAS[0]).name;
  const backup = $("#charMeaning").textContent;
  if (!AIBridge.isReady(state.cfg)) {
    toast("未启用云端模型 · 右上角「AI 设置」填入 Key 后可用");
    return;
  }
  btn.disabled = true; btn.textContent = "✦ 生成中";
  $("#charMeaning").textContent = "AI 正在重写这段展签…";
  try {
    const txt = await AIBridge.cloudInterpret(state.cfg, state.char, era);
    if (!txt) throw new Error("模型未返回内容");
    $("#charMeaning").textContent = txt;
    toast("已用云端模型重写");
  } catch (e) {
    $("#charMeaning").textContent = backup;
    toast("重写失败：" + e.message);
  }
  btn.disabled = false; btn.textContent = "✦ AI 重写";
};

$("#evolveBtn").onclick = () => {
  $("#evolution").scrollIntoView({ behavior: "smooth" });
  clearInterval(evolveTimer);
  const items = $$(".timeline-item");
  let i = 0;
  evolveTimer = setInterval(() => {
    if (i < items.length) {
      items.forEach(x => x.classList.remove("active"));
      items[i].classList.add("active");
      showEra(ERAS[i]);
      i++;
    } else clearInterval(evolveTimer);
  }, 620);
};

/* ============================================================
 * 三、AI 甲骨文识别馆
 * ============================================================ */

/* --- 取样 chips --- */
function renderSampleChips() {
  const wrap = $("#sampleChips");
  wrap.innerHTML = "";
  CHAR_ORDER.forEach(c => {
    const b = document.createElement("button");
    b.title = `${c}（${G(c).pinyin}）甲骨文取样`;
    b.innerHTML = svg(c, "oracle", 26);
    b.onclick = () => loadSample(c);
    wrap.appendChild(b);
  });
}

/** 从字形库取样：渲染一张带噪声的“拓片”作为输入 */
function loadSample(char) {
  const c = document.createElement("canvas");
  c.width = 420; c.height = 420;
  const ctx = c.getContext("2d");
  // 做旧底
  const g = ctx.createLinearGradient(0, 0, 420, 420);
  g.addColorStop(0, "#d8c8a4"); g.addColorStop(1, "#bda887");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 420, 420);
  for (let i = 0; i < 1500; i++) {
    ctx.fillStyle = `rgba(90,70,45,${Math.random() * .10})`;
    ctx.fillRect(Math.random() * 420, Math.random() * 420, Math.random() * 3, Math.random() * 3);
  }
  // 墨拓（透明底，避免白色方块干扰 Otsu 分割）
  // 示例图按"清晰的甲骨拓片"来生成：轻微歪斜即可，过度做旧会让演示结果失真
  ctx.save();
  ctx.translate(210, 210);
  ctx.rotate((Math.random() - .5) * .05);
  ctx.translate(-150, -150);
  Vision.drawGlyphOn(ctx, G(char), "oracle", 300, "#3a2415", { transparent: true });
  ctx.restore();
  // 磨损
  // 强度是按"清晰可辨的拓片"定的：女、弓这类细笔画字墨量本来就低（约 3.5%），
  // 磨损再重就会把笔画打断、空腔泄开，识别直接崩（实测 150/4/0.38 时女只 1/3 命中）。
  for (let i = 0; i < 70; i++) {
    ctx.fillStyle = `rgba(216,200,164,${Math.random() * .25})`;
    ctx.beginPath(); ctx.arc(Math.random() * 420, Math.random() * 420, Math.random() * 3, 0, 7); ctx.fill();
  }
  setSource(c, "sample", char);
}

/* --- 文件输入 --- */
const dz = $("#dropzone"), fileInput = $("#fileInput");
dz.onclick = () => fileInput.click();
dz.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } };
dz.ondragover = e => { e.preventDefault(); dz.classList.add("over"); };
dz.ondragleave = () => dz.classList.remove("over");
dz.ondrop = e => {
  e.preventDefault(); dz.classList.remove("over");
  if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]);
};
fileInput.onchange = e => { if (e.target.files[0]) readFile(e.target.files[0]); };
addEventListener("paste", e => {
  const it = Array.from(e.clipboardData?.items || []).find(i => i.type.startsWith("image/"));
  if (it) readFile(it.getAsFile());
});

function readFile(file) {
  if (!file || !file.type.startsWith("image/")) { toast("请选择图片文件"); return; }
  const img = new Image();
  const reader = new FileReader();
  reader.onload = () => {
    img.onload = () => {
      const c = document.createElement("canvas");
      const s = Math.min(560, Math.max(320, Math.max(img.width, img.height)));
      c.width = s; c.height = s;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, s, s);
      const k = Math.min(s / img.width, s / img.height) * .92;
      ctx.drawImage(img, (s - img.width * k) / 2, (s - img.height * k) / 2, img.width * k, img.height * k);
      setSource(c, "upload", null);
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function setSource(canvas, kind, sampleChar) {
  state.sourceCanvas = canvas;
  state.sourceKind = kind;
  state.sourceChar = sampleChar;
  $("#dzPreviewWrap").classList.add("has-img");
  $("#dzPreviewWrap").innerHTML = "";
  const img = document.createElement("img");
  img.src = canvas.toDataURL("image/png");
  $("#dzPreviewWrap").appendChild(img);
  $("#dzInner").querySelector("b").textContent =
    kind === "sample" ? `已取样：${sampleChar}` : "已上传图片";
  $("#dzInner").querySelector("small").textContent = "点击可更换，或开始 AI 分析";
  $("#analyzeBtn").disabled = false;
  resetProcess();
}

$("#clearBtn").onclick = () => {
  state.sourceCanvas = null;
  $("#dzPreviewWrap").classList.remove("has-img");
  $("#dzPreviewWrap").innerHTML = "";
  $("#dzInner").querySelector("b").textContent = "拖入图片 / 点击上传";
  $("#dzInner").querySelector("small").textContent = "支持甲骨拓片、字形照片或手绘；也可点击下方取样";
  $("#analyzeBtn").disabled = true;
  resetProcess();
  $("#resultHero").innerHTML = `<div class="rh-empty">尚未识别</div>`;
  $("#candList").innerHTML = "";
  $("#reasonBox").textContent = "";
  $("#toLabBtn").disabled = true;
  $("#rcItems").innerHTML = "";
  $("#rcSub").textContent = "识别完成后展示该字从甲骨文到楷书的完整还原链";
};

function resetProcess() {
  ["cvBinary", "cvGrid"].forEach(id => {
    const c = $("#" + id), x = c.getContext("2d");
    x.clearRect(0, 0, c.width, c.height);
  });
  ["topoEnd", "topoJun", "topoDen", "topoSym"].forEach(id => $("#" + id).textContent = "—");
  $("#procLog").innerHTML =
    `<p class="log-idle">图像已就绪。点击「开始 AI 分析」以执行特征提取与字形比对。</p>`;
  $("#procState").textContent = "就绪";
  $("#procState").classList.remove("run");
}

/* --- 日志 --- */
function log(html) {
  const box = $("#procLog");
  if (box.querySelector(".log-idle")) box.innerHTML = "";
  const p = document.createElement("p");
  p.className = "log-line";
  p.innerHTML = html;
  box.appendChild(p);
  box.scrollTop = box.scrollHeight;
}
const wait = ms => new Promise(r => setTimeout(r, ms));

/* --- 核心：识别流程 --- */
$("#analyzeBtn").onclick = async () => {
  if (!state.sourceCanvas) return;
  const btn = $("#analyzeBtn");
  btn.disabled = true;
  $("#procState").textContent = "分析中";
  $("#procState").classList.add("run");
  $("#procLog").innerHTML = "";
  $("#resultHero").innerHTML = `<div class="rh-empty">分析中…</div>`;
  $("#candList").innerHTML = "";
  $("#reasonBox").textContent = "";
  $("#toLabBtn").disabled = true;

  try {
    /* 1. 预处理 */
    log(`› 灰度化 + Otsu 自适应阈值…`);
    await wait(260);
    const feat = Vision.extract(state.sourceCanvas, state.sourceCanvas.width, state.sourceCanvas.height);
    if (!feat) throw new Error("图像中未检测到笔画 —— 试试更清晰、背景更干净的字形图");
    log(`› 包围盒裁剪 → 归一化 <em>${Vision.NORM}×${Vision.NORM}</em>`);
    await wait(180);

    /* 2. 二值图 */
    drawBinary(feat.norm);
    log(`› 二值化完成 · 阈值自适应`);
    await wait(180);

    /* 3. 网格投影 */
    drawGrid(feat.grid);
    const ink = Math.round(feat.topo.density * 100);
    log(`› ${Vision.GRID}×${Vision.GRID} 网格密度投影 → <b>${Vision.GRID * Vision.GRID} 维特征向量</b>`);
    await wait(200);

    /* 4. 拓扑 */
    $("#topoEnd").textContent = feat.topo.endpoints;
    $("#topoJun").textContent = feat.topo.junctions;
    $("#topoDen").textContent = ink + "%";
    $("#topoSym").textContent = Math.round(Math.max(feat.geo.symH, feat.geo.symV) * 100) + "%";
    log(`› 骨架拓扑：端点 <em>${feat.topo.endpoints}</em> · 交叉 <em>${feat.topo.junctions}</em> · 墨量 <em>${ink}%</em>`);
    await wait(220);

    /* 5. 比对 */
    const useCloud = AIBridge.isReady(state.cfg);
    log(`› 字形库向量比对（${CHAR_ORDER.length} 条目 × 5 书体）…`);
    if (useCloud) log(`› 并行调用云端视觉模型 <em>${state.cfg.model}</em> …`);
    await wait(240);

    const dataUrl = state.sourceCanvas.toDataURL("image/jpeg", .82);
    // 多角度搜索（拍照/临摹常有倾斜），本地候选先算好再交给融合层
    const localList = Vision.recognizeRobust(
      state.sourceCanvas, state.sourceCanvas.width, state.sourceCanvas.height);
    let res = null;

    /* 卷积字形分类器：直接吃未经骨架化的 normRaw，softmax 已做温度校准，
       输出的就是可解释的后验概率，不再靠分段线性函数硬凑置信度。
       权重未加载或推理异常时，静默回退到原来的本地/云端融合通道。 */
    if (typeof OBICNN !== "undefined" && feat.normRaw) {
      try {
        const pr = OBICNN.predict(feat.normRaw, 5);
        if (pr && pr.ok && pr.top && pr.top.length) {
          const t = pr.top[0], m = OBICNN.meta, second = pr.top[1];
          res = {
            char: t.char,
            conf: t.conf,
            candidates: pr.top.map(x => ({ char: x.char, conf: x.conf })),
            source: "cnn",
            reason: `卷积字形分类器在 ${m.ncls} 类上输出后验概率（温度 T=${m.T} 校准，` +
                    `非人工拟合系数）。首选 <b>${t.char}</b> 为 ${(t.conf * 100).toFixed(1)}%，` +
                    (second ? `次选 ${second.char} 为 ${(second.conf * 100).toFixed(1)}%。` : ``) +
                    `输入为 96×96 二值字形池化后的 48×48 张量，经 3 层卷积与全连接层推理。` +
                    `训练集由项目字库 119 字 × 5 书体、程序化形变样本与 HUST-OBC 真实拓片混合构成；` +
                    `独立测试集 top-1 ${(m.top1 * 100).toFixed(1)}% · top-3 ${(m.top3 * 100).toFixed(1)}%，` +
                    `期望校准误差 ECE ${(m.ece * 100).toFixed(2)}%。`
          };
          log(`› <em>CNN 分类器</em> 推理完成 · 输出可校准的后验概率`);
        }
      } catch (e) { /* 回退 */ }
    }
    if (!res) res = await AIBridge.recognize(state.cfg, dataUrl, feat, localList);

    log(`› 匹配完成 · 最优候选 <em>${res.char}</em> · 置信度 <b>${(res.conf * 100).toFixed(1)}%</b>`);
    log(`› 通道：<em>${res.source === "cloud" ? "云端视觉模型" : res.source === "hybrid" ? "云+本地融合" : res.source === "cnn" ? "卷积字形分类器" : "本地特征引擎"}</em>`);

    showResult(res, feat);
    $("#procState").textContent = "完成";
    $("#procState").classList.remove("run");
    if (URLP.get("auto")) document.title = `REC:${res.char}:${(res.conf * 100).toFixed(1)}:${res.candidates.slice(0, 3).map(c => c.char + (c.conf * 100).toFixed(0)).join(",")}`;
  } catch (err) {
    log(`<span style="color:#c9614f">✕ ${err.message}</span>`);
    $("#procState").textContent = "失败";
    $("#procState").classList.remove("run");
    $("#resultHero").innerHTML = `<div class="rh-empty">识别失败</div>`;
    if (URLP.get("auto")) document.title = "REC-ERR:" + err.message.slice(0, 60);
    toast(err.message);
  }
  btn.disabled = false;
};

function drawBinary(norm) {
  const c = $("#cvBinary"), ctx = c.getContext("2d");
  const n = Vision.NORM, s = c.width / n;
  ctx.fillStyle = "#f0eadc"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#1a1a18";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (norm[y * n + x]) ctx.fillRect(x * s, y * s, s + .5, s + .5);
  }
}

function drawGrid(grid) {
  const c = $("#cvGrid"), ctx = c.getContext("2d");
  const cell = c.width / Vision.GRID;
  ctx.fillStyle = "#0d0f11"; ctx.fillRect(0, 0, c.width, c.height);
  for (let y = 0; y < Vision.GRID; y++) for (let x = 0; x < Vision.GRID; x++) {
    const v = grid[y * Vision.GRID + x];
    const a = Math.min(1, v * 1.5);
    ctx.fillStyle = `rgba(201,169,106,${a})`;
    ctx.fillRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2);
    ctx.strokeStyle = "rgba(255,255,255,.05)";
    ctx.strokeRect(x * cell, y * cell, cell, cell);
  }
}

function showResult(res, feat) {
  state.recResult = res;
  const e = G(res.char);

  $("#srcBadge").textContent =
    res.source === "cloud" ? "CLOUD VISION" : res.source === "hybrid" ? "HYBRID"
      : res.source === "cnn" ? "CNN CLASSIFIER" : "LOCAL ENGINE";

  $("#resultHero").innerHTML =
    `<div class="rh-result">
      <div class="rh-glyph">${svg(res.char, "oracle", 96)}</div>
      <div>
        <div class="rh-modern">${res.char}</div>
        <div class="rh-meta">${e.pinyin} · ${e.category} · ${e.gloss}</div>
        <div class="rh-conf">置信度 ${(res.conf * 100).toFixed(1)}%</div>
      </div>
    </div>`;

  const maxConf = Math.max(...res.candidates.map(c => c.conf));
  $("#candList").innerHTML = res.candidates.map((c, i) => {
    const pct = Math.round(c.conf / maxConf * 100);
    return `<button class="cand ${i === 0 ? "top" : ""}" data-char="${c.char}">
      <span class="cand-g">${svg(c.char, "oracle", 30)}</span>
      <span>
        <span class="cand-name"><b>${c.char}</b><span>${G(c.char).pinyin}</span></span>
        <span class="cand-bar"><i style="width:0"></i></span>
      </span>
      <span class="cand-val" data-pct="${pct}">${(c.conf * 100).toFixed(0)}%</span>
    </button>`;
  }).join("");
  requestAnimationFrame(() => {
    $$(".cand").forEach(b => {
      const pct = b.querySelector(".cand-val").dataset.pct;
      b.querySelector(".cand-bar i").style.width = pct + "%";
    });
  });
  $$(".cand").forEach(b => b.onclick = () => {
    const c = b.dataset.char;
    const r = { ...res, char: c, conf: res.candidates.find(x => x.char === c).conf };
    showResult(r, feat);
  });

  $("#reasonBox").innerHTML =
    `<b style="color:var(--gold2)">判断依据 · </b>${res.reason}` +
    `<br><span style="color:#6f6b63">字源：${e.origin}</span>`;

  $("#toLabBtn").disabled = false;
  $("#toLifeBtn").disabled = false;
  renderRestoreChain(res.char);
}

function renderRestoreChain(char) {
  const e = G(char);
  $("#rcSub").textContent = `「${char}」· ${e.pinyin} · ${e.gloss}`;
  $("#rcItems").innerHTML = ERAS.map(era =>
    `<div class="rc-item">
      ${svg(char, era.key, 74)}
      <b>${era.name}</b>
      <small>${era.period}</small>
    </div>`).join("");
}

$("#toLabBtn").onclick = () => {
  if (!state.recResult) return;
  state.labChar = state.recResult.char;
  $("#wordInput").value = state.labChar;
  renderQuickChars();
  renderEraPicker();
  generateArt();
  $("#ai-lab").scrollIntoView({ behavior: "smooth" });
};

/* ============================================================
 * 四、AI 造字实验室
 * ============================================================ */
function renderEraPicker() {
  const wrap = $("#eraPicker");
  wrap.innerHTML = ERAS.map(era =>
    `<button class="style-chip ${era.key === state.labEra ? "active" : ""}" data-era="${era.key}">
      ${era.name}
    </button>`).join("");
  wrap.querySelectorAll(".style-chip").forEach(b => {
    b.onclick = () => {
      state.labEra = b.dataset.era;
      renderEraPicker();
      generateArt();          // 选完书体即时重绘，不必再点「生成」
    };
  });
}

function renderQuickChars() {
  const wrap = $("#quickChars");
  wrap.innerHTML = CHAR_ORDER.map(c =>
    `<button data-c="${c}" title="${c}">${c}</button>`).join("");
  wrap.querySelectorAll("button").forEach(b => {
    b.onclick = () => { $("#wordInput").value = b.dataset.c; state.labChar = b.dataset.c; };
  });
}

$$("#styleGrid .style-chip").forEach(b => {
  b.onclick = () => {
    $$("#styleGrid .style-chip").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    state.labStyle = b.dataset.style;
    generateArt();            // 切换视觉语言即时重绘
  };
});

$("#generateBtn").onclick = () => {
  const v = $("#wordInput").value.trim();
  if (!v) { toast("请输入一个汉字"); return; }
  if (!G(v)) {
    toast(`字形库暂未收录「${v}」，已使用「鹿」代替`);
    $("#wordInput").value = "鹿";
    state.labChar = "鹿";
  } else state.labChar = v;
  generateArt();
};

function newCode() {
  return String(Math.floor(Math.random() * 9000) + 1000);
}

function generateArt() {
  const canvas = $("#artCanvas");
  if (state.stopArt) { state.stopArt(); state.stopArt = null; }
  state.code = newCode();
  const char = state.labChar, era = state.labEra, style = state.labStyle;
  const e = G(char) || G("鹿");

  $("#generationStyle").textContent = Art.STYLE_META[style].en;
  $("#generatedTitle").textContent = `${char} · ${Art.STYLE_META[style].label}`;
  $("#generatedCaption").textContent = e.ai;
  $("#genCode").textContent = "#" + state.code;

  state.stopArt = Art.generate(canvas, { char, era, style, code: state.code }, () => {
    toast("作品生成完成");
  });
}

$("#exportBtn").onclick = () => {
  const c = $("#artCanvas");
  const a = document.createElement("a");
  a.download = `一字千年_${state.labChar}_${Art.STYLE_META[state.labStyle].en}_${state.code}.png`;
  a.href = c.toDataURL("image/png");
  a.click();
  toast("已导出 PNG");
};

/* ---------- 高清导出：离屏重绘 2400×2400 ---------- */
async function renderHighRes(size) {
  const off = document.createElement("canvas");
  off.width = size; off.height = size;
  const stop = Art.generate(off, {
    char: state.labChar, era: state.labEra, style: state.labStyle, code: state.code
  });
  // 静态风格需等 26 帧逐笔动画播完；粒子风格首帧即完整
  await wait(stylePaintMs());
  stop && stop();
  return off;
}
function stylePaintMs() {
  return state.labStyle === "particle" ? 120 : 900;
}

$("#exportHdBtn").onclick = async () => {
  const btn = $("#exportHdBtn");
  btn.disabled = true;
  toast("正在渲染 2400px 高清版…");
  try {
    const off = await renderHighRes(2400);
    const a = document.createElement("a");
    a.download = `一字千年_${state.labChar}_${Art.STYLE_META[state.labStyle].en}_${state.code}_HD.png`;
    a.href = off.toDataURL("image/png");
    a.click();
    toast("已导出高清 PNG");
  } catch (e) {
    toast("导出失败：" + e.message);
  }
  btn.disabled = false;
};

/* ---------- 展览海报：竖版 1200×1700，含标题、字源与编号 ---------- */
function wrapCn(ctx, text, x, y, maxW, lineH, maxLines) {
  const chars = Array.from(text);
  let line = "", lines = [];
  for (const ch of chars) {
    if (ctx.measureText(line + ch).width > maxW && line) {
      lines.push(line); line = ch;
      if (lines.length >= maxLines) { lines[maxLines - 1] += "…"; return lines; }
    } else line += ch;
  }
  if (line) lines.push(line);
  return lines;
}

$("#exportPosterBtn").onclick = async () => {
  const btn = $("#exportPosterBtn");
  btn.disabled = true;
  toast("正在生成展览海报…");
  try {
    // 先离屏渲染 1200×1200 作品图
    const art = document.createElement("canvas");
    art.width = 1200; art.height = 1200;
    const stop = Art.generate(art, {
      char: state.labChar, era: state.labEra, style: state.labStyle, code: state.code
    });
    await wait(stylePaintMs());
    stop && stop();

    const W = 1200, H = 1700;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    const e = G(state.labChar) || G("鹿");
    const eraName = (ERAS.find(x => x.key === state.labEra) || ERAS[0]).name;
    const meta = Art.STYLE_META[state.labStyle];

    // 底
    ctx.fillStyle = "#0b0c0d"; ctx.fillRect(0, 0, W, H);
    // 顶部书法标题
    ctx.fillStyle = "#e2c88e";
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    ctx.font = '600 92px "Noto Serif SC","KaiTi",serif';
    ctx.fillText(`${state.labChar}`, W / 2, 128);
    ctx.font = '300 26px "Outfit","Noto Sans SC",sans-serif';
    ctx.fillStyle = "#9b978d";
    ctx.fillText(`${e.pinyin.toUpperCase()} · ${eraName} · ${meta.en}`, W / 2, 172);
    // 金线
    const lg = ctx.createLinearGradient(0, 0, W, 0);
    lg.addColorStop(0, "rgba(201,169,106,0)"); lg.addColorStop(.5, "rgba(201,169,106,.8)"); lg.addColorStop(1, "rgba(201,169,106,0)");
    ctx.fillStyle = lg; ctx.fillRect(W * .1, 206, W * .8, 2);

    // 作品图
    ctx.drawImage(art, 0, 250, 1200, 1200);

    // 解说
    ctx.textAlign = "left";
    ctx.font = '400 30px "Noto Serif SC","KaiTi",serif';
    ctx.fillStyle = "#e8e2d2";
    const lines = wrapCn(ctx, e.origin, 90, 1530, 1020, 44, 3);
    lines.forEach((l, i) => ctx.fillText(l, 90, 1530 + i * 44));
    ctx.font = '300 22px "Outfit","Noto Sans SC",sans-serif';
    ctx.fillStyle = "#6f6b63";
    ctx.fillText(`YIZIQIAN NIAN · AI ORACLE BONE LAB   /   ARTWORK #${state.code}   /   V2.0`, 90, 1660);

    const a = document.createElement("a");
    a.download = `一字千年_${state.labChar}_海报_${state.code}.png`;
    a.href = c.toDataURL("image/png");
    a.click();
    toast("已导出展览海报");
  } catch (e) {
    toast("导出失败：" + e.message);
  }
  btn.disabled = false;
};

/** 生成收藏用的缩略图（480×480 JPEG），避免 900×900 PNG 撑爆 localStorage 配额 */
function thumbDataURL(src) {
  const t = document.createElement("canvas");
  t.width = 480; t.height = 480;
  const tc = t.getContext("2d");
  tc.drawImage(src, 0, 0, 480, 480);
  return t.toDataURL("image/jpeg", .82);
}

$("#saveBtn").onclick = () => {
  const item = {
    id: Date.now(),
    char: state.labChar,
    era: state.labEra,
    style: state.labStyle,
    code: state.code,
    title: `${state.labChar} · ${Art.STYLE_META[state.labStyle].label}`,
    caption: (G(state.labChar) || G("鹿")).ai,
    data: thumbDataURL($("#artCanvas"))     // 缩略图，约 40–90KB / 张
  };
  const list = getGallery();
  list.unshift(item);
  // 逐条回退写入，保证至少能存下尽可能多的作品
  let saved = 0;
  for (let n = list.length; n > 0; n--) {
    try {
      localStorage.setItem("yiziqian_gallery", JSON.stringify(list.slice(0, n)));
      saved = n; break;
    } catch (e) { /* 配额不足，减少条数重试 */ }
  }
  if (!saved) { toast("本地存储空间不足，请先删除部分作品"); return; }
  if (saved < list.length) toast(`空间有限，已保留最近 ${saved} 幅作品`);
  renderGallery();
  toast("已收藏到数字展厅");
};

/* ============================================================
 * 五、数字展厅
 * ============================================================ */
function getGallery() {
  try { return JSON.parse(localStorage.getItem("yiziqian_gallery") || "[]"); }
  catch (e) { return []; }
}
function renderGallery() {
  const list = getGallery();
  const grid = $("#galleryGrid");
  if (!list.length) {
    grid.innerHTML = `<p class="gallery-empty">展厅还空着。去造字实验室生成并收藏一幅作品吧。</p>`;
    return;
  }
  grid.innerHTML = list.map(it =>
    `<div class="gal-item">
      <img src="${it.data}" alt="${it.title}">
      <div class="gal-meta">
        <b>${it.title}</b>
        <span>#${it.code}</span>
      </div>
      <div class="gal-meta">
        <span>${(ERAS.find(e => e.key === it.era) || ERAS[0]).name} · ${Art.STYLE_META[it.style].label}</span>
        <button class="gal-del" data-id="${it.id}" title="删除">×</button>
      </div>
    </div>`).join("");
  grid.querySelectorAll(".gal-del").forEach(b => {
    b.onclick = ev => {
      ev.stopPropagation();
      const rest = getGallery().filter(x => String(x.id) !== b.dataset.id);
      localStorage.setItem("yiziqian_gallery", JSON.stringify(rest));
      renderGallery();
      toast("已删除该作品");
    };
  });
  // 点击卡片看大图
  grid.querySelectorAll(".gal-item").forEach((card, i) => {
    card.style.cursor = "zoom-in";
    card.onclick = () => openLightbox(list[i]);
  });
}

/* --- 作品大图 --- */
function openLightbox(item) {
  if (!item) return;
  const era = (ERAS.find(e => e.key === item.era) || ERAS[0]).name;
  $("#lbImg").src = item.data;
  $("#lbTitle").textContent = item.title;
  $("#lbSub").textContent = `#${item.code} · ${era} · ${Art.STYLE_META[item.style].label}`;
  const a = $("#lbDownload");
  a.href = item.data;
  a.download = `一字千年_${item.char}_${Art.STYLE_META[item.style].en}_${item.code}.jpg`;
  $("#lbModal").classList.add("open");
}
$("#lbClose").onclick = () => $("#lbModal").classList.remove("open");
$("#lbModal").onclick = e => { if (e.target.id === "lbModal") $("#lbModal").classList.remove("open"); };
addEventListener("keydown", e => {
  if (e.key === "Escape") {
    $("#lbModal").classList.remove("open");
    $("#cfgModal").classList.remove("open");
  }
});

/* ============================================================
 * 六、AI 设置
 * ============================================================ */
function openCfg() {
  const c = state.cfg;
  $("#cfgBase").value = c.base || "";
  $("#cfgModel").value = c.model || "";
  $("#cfgKey").value = c.key || "";
  $("#cfgEnabled").checked = !!c.enabled;
  $("#cfgTip").textContent = "";
  $("#cfgModal").classList.add("open");
}
$("#cfgBtn").onclick = openCfg;
$("#cfgClose").onclick = () => $("#cfgModal").classList.remove("open");
$("#cfgModal").onclick = e => { if (e.target.id === "cfgModal") $("#cfgModal").classList.remove("open"); };

$("#presetRow").innerHTML = Object.keys(AIBridge.PRESETS).map(k =>
  `<button data-k="${k}">${AIBridge.PRESETS[k].name}</button>`).join("");
$("#presetRow").querySelectorAll("button").forEach(b => {
  b.onclick = () => {
    const p = AIBridge.PRESETS[b.dataset.k];
    $("#cfgBase").value = p.base;
    $("#cfgModel").value = p.model;
    showTip(`已填入 ${p.name} 的默认地址与模型，请补充 API Key。` + (p.note ? "\n" + p.note : ""), p.note ? "warn" : "");
  };
});

/** 显示配置提示；tip 为补充的根因线索 */
function showTip(msg, kind) {
  const box = $("#cfgTip");
  box.textContent = msg;
  box.className = "modal-tip" + (kind ? " " + kind : "");
}

function collectCfg() {
  return {
    enabled: $("#cfgEnabled").checked,
    base: $("#cfgBase").value.trim(),
    model: $("#cfgModel").value.trim(),
    key: $("#cfgKey").value.trim()
  };
}

$("#cfgSave").onclick = () => {
  state.cfg = collectCfg();
  AIBridge.save(state.cfg);
  updateEngineNote();
  $("#cfgModal").classList.remove("open");
  if (AIBridge.isReady(state.cfg)) {
    const warn = AIBridge.providerHint(state.cfg.base, state.cfg.model);
    toast("已保存：云端模型已启用");
    showTip("已保存：识别时将优先调用视觉大模型。" + (warn ? "\n注意：" + warn : ""), warn ? "warn" : "ok");
  } else {
    toast("已保存：使用本地引擎");
    showTip("已保存：当前使用内置本地视觉引擎（离线可用）。", "ok");
  }
};

$("#cfgTest").onclick = async () => {
  const c = collectCfg();
  if (!c.key) { showTip("请先填写 API Key 再测试。", "err"); return; }
  if (!c.base || !c.model) { showTip("请填写 Base URL 与模型名称。", "err"); return; }
  showTip("正在连接…", "");
  try {
    const r = await AIBridge.visionRecognize(c, sampleDataURL());
    showTip(`连接成功：模型返回「${r.char}」，置信度 ${(r.conf * 100).toFixed(0)}%。\n` +
      (r.reason ? "依据：" + r.reason : ""), "ok");
  } catch (e) {
    showTip("连接失败：" + e.message + (e.hint ? "\n线索：" + e.hint : ""), "err");
  }
};

function sampleDataURL() {
  const c = document.createElement("canvas");
  c.width = 300; c.height = 300;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#e0d0aa"; ctx.fillRect(0, 0, 300, 300);
  Vision.drawGlyphOn(ctx, G("日"), "oracle", 300, "#3a2415");
  return c.toDataURL("image/jpeg", .8);
}

/* ============================================================
 * 七、引擎状态提示
 * ============================================================ */
function updateEngineNote() {
  const ready = AIBridge.isReady(state.cfg);
  const isFile = location.protocol === "file:";
  $("#engineNote").innerHTML = ready
    ? `云端模型：<b style="color:var(--gold2)">${state.cfg.model}</b> 已启用。识别时以本地 CNN 为主通道，云端作为可选增强并行参与，失败自动回落。`
    : `当前使用<b style="color:var(--gold2)">离线卷积字形分类器</b>：灰度 → Otsu 二值化 → 归一化 96×96 → 三层 CNN → 温度校准后验概率；权重未加载时自动回落本地特征引擎。完全离线可运行。`;
  if (isFile && ready) {
    $("#engineNote").innerHTML +=
      `<br><span style="color:#c9614f">提示：当前以 file:// 打开，浏览器可能拦截跨域请求。建议用本地服务器打开（见 README）。</span>`;
  }
  $("#footerEngine").textContent = ready
    ? `Cloud Vision: ${state.cfg.model} / Local Fallback`
    : "Offline CNN Classifier / Local Fallback / Cloud Ready";
  $("#srcBadge").textContent = ready ? "CLOUD READY" : "LOCAL ENGINE";
}

/* ============================================================
 * 八、粒子背景
 * ============================================================ */
const pc = $("#particles"), pctx = pc.getContext("2d");
let dots = [];
function resize() {
  pc.width = innerWidth * devicePixelRatio;
  pc.height = innerHeight * devicePixelRatio;
  pc.style.width = innerWidth + "px"; pc.style.height = innerHeight + "px";
  pctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  dots = Array.from({ length: 70 }, () => ({
    x: Math.random() * innerWidth, y: Math.random() * innerHeight,
    r: Math.random() * 1.5 + .3, v: Math.random() * .25 + .05
  }));
}
function draw() {
  pctx.clearRect(0, 0, innerWidth, innerHeight);
  pctx.fillStyle = "rgba(201,169,106,.55)";
  dots.forEach(d => {
    d.y -= d.v; if (d.y < 0) d.y = innerHeight;
    pctx.globalAlpha = .2 + Math.random() * .35;
    pctx.beginPath(); pctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); pctx.fill();
  });
  requestAnimationFrame(draw);
}
addEventListener("resize", resize);
resize(); draw();

/* ============================================================
 * 九、导航高亮 + 启动
 * ============================================================ */
const navLinks = $$("#mainNav a");
addEventListener("scroll", () => {
  let cur = "";
  ["home", "explore", "evolution", "oracle-ai", "ai-lab", "gallery", "about"].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.getBoundingClientRect().top <= 140) cur = id;
  });
  navLinks.forEach(a => a.style.color = a.getAttribute("href") === "#" + cur ? "var(--gold2)" : "");
});

/* ================= 3D 数字生命 ================= */
let life = null;
const PHASE_CN = { chaos: "混沌星尘", gather: "聚合生长", alive: "呼吸存活", evolve: "演化变形" };

function initLife3D() {
  const stage = $("#lifeStage");
  if (!stage || typeof Life3D === "undefined") return;
  try {
    life = Life3D.create(stage, {
      char: state.char || "日",
      autoTour: true,
      onPhase: p => { $("#lifePhase").textContent = PHASE_CN[p] || p; }
    });
  } catch (err) {
    stage.innerHTML = `<p class="life-note" style="padding:40px">WebGL 初始化失败：${err.message}</p>`;
    return;
  }

  // 字选择
  const wrap = $("#lifeChars");
  wrap.innerHTML = CHAR_ORDER.map(c =>
    `<button class="style-chip ${c === life.state.char ? "active" : ""}" data-c="${c}">${c}</button>`).join("");
  wrap.querySelectorAll(".style-chip").forEach(b => {
    b.onclick = () => {
      wrap.querySelectorAll(".style-chip").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      life.setChar(b.dataset.c);
    };
  });

  // 书体信息（巡演时自动刷新）
  syncLifeEra();
  setInterval(() => { if (life) syncLifeEra(); }, 700);

  // 控制按钮
  $("#lifeTourBtn").onclick = () => {
    life.state.playing = !life.state.playing;
    $("#lifeTourBtn").textContent = life.state.playing ? "⏸ 暂停巡演" : "▶ 继续巡演";
  };
  $("#lifeEvolveBtn").onclick = () => life.evolve();
  $("#lifeShotBtn").onclick = () => {
    const a = document.createElement("a");
    a.download = `一字千年3D_${life.state.char}_${life.eraName}.png`;
    a.href = life.snapshot();
    a.click();
    toast("已导出 3D 视图");
  };
}

function syncLifeEra() {
  if (!life) return;
  const era = ERAS[life.state.eraIdx];
  $("#lifeEra").textContent = era.name;
  $("#lifeEraName").textContent = era.name;
  $("#lifeEraYear").textContent = era.year + " · " + era.period;
  $("#lifeEraDesc").textContent = era.desc;
}

// 识别结果 → 孕育 3D 生命（闭环终点）
$("#toLifeBtn").onclick = () => {
  if (!state.recResult || !life) return;
  const c = state.recResult.char;
  life.setChar(c);
  const wrap = $("#lifeChars");
  wrap.querySelectorAll(".style-chip").forEach(x => x.classList.toggle("active", x.dataset.c === c));
  document.getElementById("life-3d").scrollIntoView({ behavior: "smooth" });
  toast(`「${c}」正在孕育 3D 数字生命`);
};

function boot() {
  $("#brandGlyph").innerHTML = svg("鹿", "oracle", 22);
  $("#factChars").textContent = CHAR_ORDER.length;
  $("#factGlyphs").textContent = CHAR_ORDER.length * ERAS.length;
  $("#aboutNorm").textContent = `${Vision.NORM}×${Vision.NORM}`;
  $("#aboutGrid").textContent = `${Vision.GRID}×${Vision.GRID}`;
  renderCharList();
  renderSampleChips();
  renderEraPicker();
  renderQuickChars();
  renderGallery();
  updateEngineNote();
  const c0 = URLP.get("c");
  selectChar(c0 && GLYPH_LIB[c0] ? c0 : "日");
  generateArt();
  initLife3D();

  // 支持 ?s=oracle-ai 直达展区（便于演示与分享）；?focus=1 额外进入专注模式（隐藏其前区块）
  const jump = URLP.get("s");
  if (jump && document.getElementById(jump)) {
    const target = document.getElementById(jump);
    document.documentElement.style.scrollBehavior = "auto";
    target.scrollIntoView({ behavior: "instant", block: "start" });
    if (URLP.get("focus")) {
      let el = target.previousElementSibling;
      while (el) {
        if (el.tagName === "SECTION" || el.tagName === "HEADER") el.style.display = "none";
        el = el.previousElementSibling;
      }
      target.style.paddingTop = "110px";
      scrollTo(0, 0);
    }
  }

  // ?auto=1（或指定字，如 ?auto=马）自动演示：取样 → AI 分析
  const autoP = URLP.get("auto");
  if (autoP) {
    const c = GLYPH_LIB[autoP] ? autoP : "鹿";
    setTimeout(() => {
      loadSample(c);
      setTimeout(() => $("#analyzeBtn").click(), 700);
    }, 400);
  }
}
boot();
