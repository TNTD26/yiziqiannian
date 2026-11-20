/* ============================================================
 * 一字千年 · 视觉识别引擎  VISION ENGINE
 * ------------------------------------------------------------
 * 本地推理管线（无需联网即可完整运行）：
 *   图像输入 → 灰度化 → Otsu 自适应二值化 → 包围盒裁剪
 *            → 归一化 96×96 → 8×8 网格密度投影（64 维）
 *            → 骨架拓扑统计（端点 / 交叉点 / 连通域）
 *            → 几何统计（重心 / 对称性 / 占空比）
 *            → 与字形库逐字比对（加权余弦 + 拓扑距离）
 *            → Top-N 候选 + 置信度
 *
 * 若配置了视觉大模型 API，则优先调用远端模型，
 * 本地引擎作为兜底与离线演示通道。
 * ============================================================ */

const GRID = 16;         // 16×16 = 256 维密度特征（12×12 时鼎/鱼/龙/鸟/心/目 这类
                         // 多笔画字彼此区分不开，实测明显丢分，故提高分辨率）
const NORM = 96;         // 归一化分辨率

const Vision = (() => {

  /* ---------- 1. 灰度 + Otsu 二值化 ---------- */
  function toGray(data, w, h) {
    const g = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      g[p] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
    }
    return g;
  }

  function otsuHist(hist) {
    const total = hist.reduce((s, v) => s + v, 0);
    let sum = 0;
    for (let t = 0; t < 256; t++) sum += t * hist[t];
    let sumB = 0, wB = 0, max = -1, thr = 127;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const       between = wB * wF * (mB - mF) * (mB - mF);
      if (between > max) { max = between; thr = t; }
    }
    // 退化保护：纯二值图时类间方差在一段平台内恒定，阈值会落在最小灰度上，
    // 使 g < thr 恒为 false（笔画全丢）。抬一格即可，对正常抗锯齿图无影响。
    let minGray = 0;
    while (minGray < 256 && !hist[minGray]) minGray++;
    if (thr <= minGray) thr = Math.min(255, minGray + 1);
    return thr;
  }

  function otsu(g) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < g.length; i++) hist[g[i]]++;
    return otsuHist(hist);
  }

  /** 生成二值位图（1 = 笔画） */
  function binarize(ctx, w, h, invert) {
    const img = ctx.getImageData(0, 0, w, h);
    const g = toGray(img.data, w, h);
    const thr = otsu(g);
    const raw = new Uint8Array(w * h);
    for (let i = 0; i < g.length; i++) {
      const dark = g[i] < thr;
      raw[i] = (invert ? !dark : dark) ? 1 : 0;
    }
    // 填补磨损小洞：拓片/照片的斑驳会在笔画内部打出零散小孔。
    // 只填"面积很小"的背景孔，字固有的空腔（日、目、田）不受影响。
    return { bin: fillSmallHoles(raw, w, h), w, h, thr };
  }

  /** 填充小面积背景孔洞（保留字固有的空腔，只补磨损打出的碎洞）
   *  注：试过闭运算（膨胀→腐蚀）与自适应阈值，前者会把鼎、龙这类密集
   *  笔画之间的缝隙糊死，后者对深浅不匀的底过于敏感，都会让识别变差。 */
  function fillSmallHoles(bin, w, h) {
    const out = Uint8Array.from(bin);
    const seen = new Uint8Array(w * h);
    const maxHole = Math.max(24, Math.round(w * h * 0.0035));
    const stack = [];
    // 先从边界泛洪外部背景 —— 没被泛洪到的空腔才是"孔"
    for (let i = 0; i < w; i++) stack.push(i, (h - 1) * w + i, i * w, i * w + w - 1);
    while (stack.length) {
      const p = stack.pop();
      if (p < 0 || p >= w * h || seen[p] || bin[p]) continue;
      seen[p] = 1;
      const x = p % w;
      if (x > 0) stack.push(p - 1);
      if (x < w - 1) stack.push(p + 1);
      if (p - w >= 0) stack.push(p - w);
      if (p + w < w * h) stack.push(p + w);
    }
    for (let p = 0; p < w * h; p++) {
      if (bin[p] || seen[p]) continue;
      const comp = [];
      let cnt = 0;
      stack.push(p); seen[p] = 1;
      while (stack.length) {
        const q = stack.pop(); comp.push(q); cnt++;
        if (cnt > maxHole) break;
        const x = q % w;
        const nb = [];
        if (x > 0) nb.push(q - 1);
        if (x < w - 1) nb.push(q + 1);
        if (q - w >= 0) nb.push(q - w);
        if (q + w < w * h) nb.push(q + w);
        for (const r of nb) if (!bin[r] && !seen[r]) { seen[r] = 1; stack.push(r); }
      }
      if (cnt <= maxHole) for (const q of comp) out[q] = 1;
    }
    return out;
  }

  /* ---------- 2. 包围盒 + 裁剪 ---------- */
  function boundingBox(bin, w, h) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (bin[y * w + x]) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return null;
    return { x0, y0, x1, y1, bw: x1 - x0 + 1, bh: y1 - y0 + 1 };
  }

  /** 裁剪并归一化到 NORM×NORM（保持长宽比，居中；缩小方向用最大池化防细笔画断裂） */
  function normalize(bin, w, h, box) {
    const scale = Math.min(NORM / box.bw, NORM / box.bh) * 0.86;
    const dw = Math.max(1, Math.round(box.bw * scale));
    const dh = Math.max(1, Math.round(box.bh * scale));
    const ox = Math.floor((NORM - dw) / 2), oy = Math.floor((NORM - dh) / 2);
    const out = new Uint8Array(NORM * NORM);
    for (let y = 0; y < dh; y++) {
      const sy0 = box.y0 + Math.floor(y * box.bh / dh);
      const sy1 = box.y0 + Math.ceil((y + 1) * box.bh / dh);
      for (let x = 0; x < dw; x++) {
        const sx0 = box.x0 + Math.floor(x * box.bw / dw);
        const sx1 = box.x0 + Math.ceil((x + 1) * box.bw / dw);
        let hit = 0;
        for (let sy = sy0; sy < sy1 && !hit; sy++)
          for (let sx = sx0; sx < sx1 && !hit; sx++)
            if (bin[sy * w + sx]) hit = 1;
        if (hit) out[(y + oy) * NORM + (x + ox)] = 1;
      }
    }
    return out;
  }

  /* ---------- 3. 特征提取 ---------- */
  function gridDensity(norm) {
    const cell = NORM / GRID;
    const feat = new Float64Array(GRID * GRID);
    for (let y = 0; y < NORM; y++) {
      const gy = Math.min(GRID - 1, (y / cell) | 0);
      for (let x = 0; x < NORM; x++) {
        if (norm[y * NORM + x]) {
          const gx = Math.min(GRID - 1, (x / cell) | 0);
          feat[gy * GRID + gx]++;
        }
      }
    }
    const max = Math.max(...feat) || 1;
    for (let i = 0; i < feat.length; i++) feat[i] = Math.min(1, feat[i] / (cell * cell) * 2.4);
    return feat;
  }

  /** 一次 3×3 腐蚀：把池化变粗的笔画收细，让骨架拓扑检测有效 */
  function erode1(norm) {
    const out = new Uint8Array(NORM * NORM);
    for (let y = 1; y < NORM - 1; y++) {
      for (let x = 1; x < NORM - 1; x++) {
        const i = y * NORM + x;
        if (norm[i] && norm[i - 1] && norm[i + 1] &&
            norm[i - NORM] && norm[i + NORM]) out[i] = 1;
      }
    }
    return out;
  }

  /** 空腔数（背景孔洞）：日=1 田=4 目=2，是区分「口框类」形近字的最强特征 */
  function holeCount(norm) {
    const seen = new Uint8Array(NORM * NORM);
    const stack = [];
    for (let i = 0; i < NORM; i++) {
      stack.push(i, (NORM - 1) * NORM + i, i * NORM, i * NORM + NORM - 1);
    }
    while (stack.length) {
      const p = stack.pop();
      if (p < 0 || p >= NORM * NORM || seen[p] || norm[p]) continue;
      seen[p] = 1;
      const x = p % NORM;
      if (x > 0) stack.push(p - 1);
      if (x < NORM - 1) stack.push(p + 1);
      if (p - NORM >= 0) stack.push(p - NORM);
      if (p + NORM < NORM * NORM) stack.push(p + NORM);
    }
    // 剩余未访问的背景连通块数 = 空腔数
    let holes = 0;
    for (let p = 0; p < NORM * NORM; p++) {
      if (norm[p] || seen[p]) continue;
      holes++;
      stack.push(p);
      seen[p] = 1;
      while (stack.length) {
        const q = stack.pop(), x = q % NORM;
        if (x > 0 && !seen[q - 1] && !norm[q - 1]) { seen[q - 1] = 1; stack.push(q - 1); }
        if (x < NORM - 1 && !seen[q + 1] && !norm[q + 1]) { seen[q + 1] = 1; stack.push(q + 1); }
        if (q - NORM >= 0 && !seen[q - NORM] && !norm[q - NORM]) { seen[q - NORM] = 1; stack.push(q - NORM); }
        if (q + NORM < NORM * NORM && !seen[q + NORM] && !norm[q + NORM]) { seen[q + NORM] = 1; stack.push(q + NORM); }
      }
    }
    return holes;
  }

  /* ---------------- 二值图降噪 ----------------
   * 拓片、照片、做旧底纹都会带来椒盐噪点与孤立碎斑，
   * 不清理会直接进入密度投影，把识别带偏（实测鼎→首、鹿掉到 58%）。
   */
  function medianFilter(bin, w, h) {
    const out = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += bin[(y + dy) * w + x + dx];
        out[y * w + x] = s >= 5 ? 1 : 0;
      }
    }
    return out;
  }

  /** 丢掉面积过小的连通块（碎斑），保留真正的笔画 */
  function dropSpeckles(bin, w, h) {
    const seen = new Uint8Array(w * h);
    const out = Uint8Array.from(bin);
    const min = Math.max(6, Math.round(w * h * 0.0006));
    const stack = [];
    for (let p = 0; p < w * h; p++) {
      if (!bin[p] || seen[p]) continue;
      const comp = [];
      let cnt = 0;
      stack.push(p); seen[p] = 1;
      while (stack.length) {
        const q = stack.pop(); comp.push(q); cnt++;
        const x = q % w;
        const nb = [];
        if (x > 0) nb.push(q - 1);
        if (x < w - 1) nb.push(q + 1);
        if (q - w >= 0) nb.push(q - w);
        if (q + w < w * h) nb.push(q + w);
        for (const r of nb) if (bin[r] && !seen[r]) { seen[r] = 1; stack.push(r); }
      }
      if (cnt < min) for (const q of comp) out[q] = 0;
    }
    return out;
  }

  /** 剔除"框状"杂墨：与图像边界相连、且横纵都跨全图 85% 以上的连通域
   *  （照片里的深色边框、截图带进来的 App 背景、相框）。
   *  这类杂墨会把包围盒撑成整图、把拓扑变成闭合环——端点/交叉全部归 0，
   *  实测「人」被排到第 94 名。
   *  形状判据而非墨量判据：字形在整图里只占一小块时，原始墨量本来就少，
   *  按"剩余墨量占比"回退会误杀剔除（实测 341px 的字形被 442px 门槛否决）。
   *  双保险：只删同时满足"贴边 + 双向跨全图"的连通域，且剔除后仍需
   *  剩余墨量 ≥60px；整图就是字（全出血）时剔除后剩 0 → 自动回退。 */
  function stripBorderInk(bin, w, h) {
    const label = new Int32Array(w * h);
    const comps = [];               // { size, touches, px, x0,x1,y0,y1 }
    const stack = [];
    for (let p = 0; p < w * h; p++) {
      if (!bin[p] || label[p]) continue;
      const px = [];
      let touches = false, x0 = w, x1 = 0, y0 = h, y1 = 0;
      stack.push(p); label[p] = comps.length + 1;
      while (stack.length) {
        const q = stack.pop();
        px.push(q);
        const x = q % w, y = (q / w) | 0;
        // 贴边判定带 2px 容差：画布边缘抗锯齿常把最外圈像素吃掉，
        // 深色边框实际停在 x=1 上，严格判边界会漏删（实测环残留）
        if (x <= 2 || y <= 2 || x >= w - 3 || y >= h - 3) touches = true;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const r = ny * w + nx;
          if (bin[r] && !label[r]) { label[r] = comps.length + 1; stack.push(r); }
        }
      }
      comps.push({ size: px.length, touches, px, x0, x1, y0, y1 });
    }
    const totalInk = comps.reduce((s, c) => s + c.size, 0);
    if (!totalInk) return bin;
    let removed = 0, any = false;
    for (const c of comps) {
      c.frame = c.touches
        && (c.x1 - c.x0) >= w * 0.85 && (c.y1 - c.y0) >= h * 0.85;
      if (c.frame) { removed += c.size; any = true; }
    }
    if (!any || totalInk - removed < 60) return bin;
    const out = new Uint8Array(w * h);
    for (const c of comps) {
      if (c.frame) continue;
      for (const q of c.px) out[q] = 1;
    }
    return out;
  }

  /* ---------------- 骨架化与去斜 ----------------
   * 真实输入（临摹、拍照、拓片）与字库字形的笔画粗细、倾斜角度千差万别，
   * 直接比对密度投影几乎必错（实测手绘字形命中率仅 4%）。
   * 下面两步把"怎么写"归一化成"写了什么"：
   *   deskew —— 二阶矩估计主轴，校正 ±18° 内的倾斜
   *   thin   —— Zhang-Suen 细化，把所有笔画收敛为 1 像素骨架
   */

  /** 前景像素列表（只遍历墨点，避免全图扫描） */
  function inkList(norm) {
    const list = [];
    for (let p = 0; p < norm.length; p++) if (norm[p]) list.push(p);
    return list;
  }

  /** 以图像中心为原点旋转（最近邻，只映射墨点） */
  function rotateBin(norm, ang) {
    const n = NORM, out = new Uint8Array(n * n);
    const c = Math.cos(ang), s = Math.sin(ang), cx = n / 2, cy = n / 2;
    for (const p of inkList(norm)) {
      const x = p % n, y = (p / n) | 0;
      const dx = x - cx, dy = y - cy;
      const nx = Math.round(dx * c - dy * s + cx);
      const ny = Math.round(dx * s + dy * c + cy);
      if (nx >= 0 && nx < n && ny >= 0 && ny < n) out[ny * n + nx] = 1;
    }
    return out;
  }

  /** 主轴去斜：字的主干方向摆正（对随手拍照/临摹的歪斜尤其关键） */
  function deskew(norm) {
    const n = NORM, list = inkList(norm);
    if (list.length < 20) return norm;
    let sx = 0, sy = 0;
    for (const p of list) { sx += p % n; sy += (p / n) | 0; }
    const mx = sx / list.length, my = sy / list.length;
    let m11 = 0, m20 = 0, m02 = 0;
    for (const p of list) {
      const dx = (p % n) - mx, dy = ((p / n) | 0) - my;
      m11 += dx * dy; m20 += dx * dx; m02 += dy * dy;
    }
    let th = 0.5 * Math.atan2(2 * m11, m20 - m02);
    // 汉字主轴非横即竖，折叠到 ±45° 后再限制在 ±18°，避免整字被转歪
    if (th > Math.PI / 4) th -= Math.PI / 2;
    if (th < -Math.PI / 4) th += Math.PI / 2;
    if (Math.abs(th) < 0.025) return norm;
    th = Math.max(-0.32, Math.min(0.32, th));
    return rotateBin(norm, -th);
  }

  /**
   * 骨架剪枝：删掉短毛刺。
   * Zhang-Suen 在实心字形的边缘会留下大量 1–5 px 的碎刺，
   * 它们既污染端点/交叉点统计，也让密度投影抖得厉害（目/鼎/鱼 等字因此认不出）。
   * 只剪"从某端点出发、走到另一端点且总长短于 maxLen"的孤立分支。
   */
  function pruneSkeleton(sk, maxLen) {
    const w = NORM;
    const img = Uint8Array.from(sk);
    const nbs = p => {
      const x = p % w, y = (p / w) | 0, r = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < w && img[ny * w + nx]) r.push(ny * w + nx);
      }
      return r;
    };
    for (let pass = 0; pass < 4; pass++) {
      let changed = false;
      for (const e of inkList(img)) {
        const nb0 = nbs(e);
        if (nb0.length !== 1 || !img[e]) continue;      // 只看端点
        let prev = -1, cur = e;
        const chain = [cur];
        let reachedEnd = false, junction = false;
        for (let i = 0; i < maxLen; i++) {
          const nb = nbs(cur).filter(q => q !== prev);
          if (nb.length >= 2) { junction = true; break; }   // 走到分叉，属于主干
          if (!nb.length) { reachedEnd = true; break; }     // 走到另一头
          prev = cur; cur = nb[0]; chain.push(cur);
        }
        if (reachedEnd && !junction && chain.length <= maxLen) {
          for (const q of chain) img[q] = 0;
          changed = true;
        }
      }
      if (!changed) break;
    }
    return img;
  }

  /** 膨胀 n 格（给骨架回补宽度，让密度特征更稳定） */
  function dilateN(norm, n) {
    const w = NORM, cur = Uint8Array.from(norm);
    for (let k = 0; k < n; k++) {
      const out = new Uint8Array(w * w);
      for (const p of inkList(cur)) {
        const x = p % w, y = (p / w) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < w) out[ny * w + nx] = 1;
        }
      }
      cur.set(out);
    }
    return cur;
  }

  /** 腐蚀 n 格（与 dilateN 配合构成闭运算：修复磨损把笔画打断的断口） */
  function erodeN(norm, n) {
    const w = NORM, cur = Uint8Array.from(norm);
    for (let k = 0; k < n; k++) {
      const out = new Uint8Array(w * w);
      for (let p = 0; p < w * w; p++) {
        if (!cur[p]) continue;
        const x = p % w, y = (p / w) | 0;
        let full = true;
        for (let dy = -1; dy <= 1 && full; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= w || ny < 0 || ny >= w || !cur[ny * w + nx]) { full = false; break; }
          }
        }
        if (full) out[p] = 1;
      }
      cur.set(out);
    }
    return cur;
  }

  /** 闭运算：膨胀→腐蚀。用来接上被磨损打断的笔画，让空腔重新封闭。 */
  function closeN(norm, n) { return erodeN(dilateN(norm, n), n); }

  /** 按包围盒重新归一化（旋转/细化后收一下边，保证尺度一致） */
  function renorm(norm) {
    const box = boundingBox(norm, NORM, NORM);
    return box ? normalize(norm, NORM, NORM, box) : norm;
  }

  /** Zhang-Suen 细化：把任意粗细的笔画收敛为 1 像素骨架 */
  function thinSkeleton(norm) {
    const n = NORM;
    let img = Uint8Array.from(norm);
    const del = [];
    // 上限要给足：真实字形是实心填充（笔画可达 20–30 px 宽），
    // 12 次迭代只削掉表层，骨架仍是大块，与用户上传的细笔画完全对不上
    for (let iter = 0; iter < 40; iter++) {
      let changed = false;
      for (let step = 0; step < 2; step++) {
        del.length = 0;
        const list = inkList(img);
        for (const p of list) {
          const x = p % n, y = (p / n) | 0;
          if (x < 1 || y < 1 || x >= n - 1 || y >= n - 1) continue;
          const g = (dx, dy) => (img[(y + dy) * n + x + dx] ? 1 : 0);
          const p0 = g(0, -1), p1 = g(1, -1), p2 = g(1, 0), p3 = g(1, 1),
            p4 = g(0, 1), p5 = g(-1, 1), p6 = g(-1, 0), p7 = g(-1, -1);
          const nb = [p0, p1, p2, p3, p4, p5, p6, p7];
          const B = p0 + p1 + p2 + p3 + p4 + p5 + p6 + p7;
          if (B < 2 || B > 6) continue;
          let A = 0;
          for (let i = 0; i < 8; i++) if (nb[i] === 0 && nb[(i + 1) % 8] === 1) A++;
          if (A !== 1) continue;
          if (step === 0) {
            if (p0 * p2 * p4 !== 0) continue;
            if (p2 * p4 * p6 !== 0) continue;
          } else {
            if (p0 * p2 * p6 !== 0) continue;
            if (p0 * p4 * p6 !== 0) continue;
          }
          del.push(p);
        }
        if (del.length) { for (const q of del) img[q] = 0; changed = true; }
      }
      if (!changed) break;
    }
    return img;
  }

  /** 骨架拓扑：端点 / 交叉点（在 1px 骨架上统计）
   *  holes 由调用方在骨架化之前统计（细化会侵蚀边界，空腔数会失真）。
   *  关键修正：必须先 Zhang-Suen 细化！此前用 4 邻域腐蚀收细笔画，但
   *  4 邻域腐蚀会把斜线整条杀掉（斜线像素的上下左右都不是墨），腐蚀不足
   *  12% 时回退到 3px 粗带上统计——在粗带上端点/交叉判据全部失效，
   *  实测粗笔画「人」端点=0 交叉=0（Y 形分叉一个都数不出来），被「雪/弓」反超。 */
  function topology(normRaw, holes) {
    const norm = thinSkeleton(normRaw);
    let endpoints = 0, junctions = 0, ink = 0;
    for (let y = 1; y < NORM - 1; y++) {
      for (let x = 1; x < NORM - 1; x++) {
        if (!norm[y * NORM + x]) continue;
        ink++;
        const n = [
          norm[(y - 1) * NORM + x], norm[(y - 1) * NORM + x + 1],
          norm[y * NORM + x + 1], norm[(y + 1) * NORM + x + 1],
          norm[(y + 1) * NORM + x], norm[(y + 1) * NORM + x - 1],
          norm[y * NORM + x - 1], norm[(y - 1) * NORM + x - 1]
        ];
        let cross = 0;
        for (let k = 0; k < 8; k++) {
          const a = n[k], b = n[(k + 1) % 8];
          if (!a && b) cross++;
        }
        const deg = n.reduce((s, v) => s + v, 0);
        if (deg === 1 || (cross === 1 && deg <= 2)) endpoints++;
        else if (cross >= 3) junctions++;
      }
    }
    return { endpoints, junctions, ink, density: ink / (NORM * NORM), holes: holes || 0 };
  }

  /** 几何统计：重心、水平/垂直对称度、占空比 */
  function geometry(norm) {
    let sx = 0, sy = 0, n = 0;
    for (let y = 0; y < NORM; y++) for (let x = 0; x < NORM; x++) {
      if (norm[y * NORM + x]) { sx += x; sy += y; n++; }
    }
    if (!n) return { cx: .5, cy: .5, symH: 0, symV: 0, fill: 0 };
    const cx = sx / n / NORM, cy = sy / n / NORM;
    let matchH = 0, matchV = 0;
    for (let y = 0; y < NORM; y++) for (let x = 0; x < NORM; x++) {
      const v = norm[y * NORM + x];
      if (v && norm[y * NORM + (NORM - 1 - x)]) matchH++;
      if (v && norm[(NORM - 1 - y) * NORM + x]) matchV++;
    }
    return {
      cx, cy,
      symH: matchH / n, symV: matchV / n,
      fill: n / (NORM * NORM)
    };
  }

  /**
   * 自动判断图像极性：少数派规则。
   * 墨在字形图里永远是少数派（通常占 2–20%）——暗像素过半即判定背景为暗。
   * 旧版采样四周边框亮度判定，会被照片四周的深色边带/截图带进来的深色背景
   * 骗成"拓片"反色，把整张白纸当成墨、字形反成洞（实测「人」因此排到 115 名）。
   * @returns true 表示背景暗、笔画亮
   */
  function detectInverted(g) {
    let dark = 0;
    for (let i = 0; i < g.length; i++) if (g[i] < 128) dark++;
    return dark > g.length / 2;
  }

  function extract(canvasOrCtx, w, h, invert) {
    const tmp = document.createElement("canvas");
    tmp.width = NORM * 2; tmp.height = NORM * 2;
    const tctx = tmp.getContext("2d", { willReadFrequently: true });
    tctx.fillStyle = "#fff"; tctx.fillRect(0, 0, tmp.width, tmp.height);
    tctx.drawImage(canvasOrCtx, 0, 0, tmp.width, tmp.height);
    // invert 未指定时自动判别（拓片多为黑底白字，字库渲染为白底黑字）
    const gAll = toGray(tctx.getImageData(0, 0, tmp.width, tmp.height).data, tmp.width, tmp.height);
    const inv = (invert === undefined || invert === null)
      ? detectInverted(gAll)
      : invert;
    const raw = binarize(tctx, tmp.width, tmp.height, inv);
    // 中值滤波去椒盐噪点 → 去孤立碎斑，再进入裁剪与归一化。
    // 这两步此前只在注释里承诺、实际没接上：噪声直接进入密度投影与骨架化，
    // 把「女」的端点(3→0)与空腔(2→0)整个抹平，实测掉到 10.7% 被「父」反超。
    const clean = stripBorderInk(dropSpeckles(medianFilter(raw.bin, raw.w, raw.h), raw.w, raw.h), raw.w, raw.h);
    const box = boundingBox(clean, raw.w, raw.h);
    if (!box) return null;
    const norm0 = normalize(clean, raw.w, raw.h, box);
    // 空腔数必须在骨架化之前统计（细化会侵蚀内边界，孔洞会被打开）。
    // 先做一次闭运算：磨损会把笔画打断，一旦断口连通到字外，真实空腔就"漏"出去
    // 不再封闭，holes 会直接掉成 0（实测「女」的 2 个空腔就是这么丢的）。
    const holes = holeCount(closeN(norm0, 1));
    // 去斜 → 骨架化 → 回补一格宽度 → 收边。
    // 纯 1px 骨架太稀疏：16×16 网格里每格只剩一两个像素，密度投影几乎全是噪声。
    // 膨胀一格后既保住了"笔画粗细归一"，密度又重新稳定。
    const skel = renorm(dilateN(pruneSkeleton(thinSkeleton(renorm(deskew(norm0))), 6), 1));
    return {
      grid: Vision.SOFTEN === false ? gridDensity(skel) : softenGrid(gridDensity(skel)),
      topo: topology(skel, holes),
      geo: geometry(skel),
      norm: skel,
      // 未经骨架化的原始二值图。CNN 分支使用它（骨架化会抹掉笔画粗细、
      // 断笔、磨损等真实拓片特征，对数据驱动的分类器反而有害）。
      // 与 Python 训练侧 prep() 严格对齐：Otsu→极性→填充小孔→裁剪→归一化。
      normRaw: norm0,
      aspect: box.bw / box.bh
    };
  }

  /** 网格软化：对 16×16 密度图做一次 3×3 衰减卷积。
   *  细笔画字形对 1 格平移零容忍——两个几乎相同的「人」主笔画错开 6px，
   *  IoU 交叉就从满分跌到 6%（实测）。软化后允许 ±1 格位置抖动，
   *  同时保留多笔画字形之间的区分度。字库与查询走同一管线，标准一致。 */
  function softenGrid(feat) {
    const G = GRID, out = new Float64Array(G * G);
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
      let acc = 0, wsum = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= G || ny < 0 || ny >= G) continue;
        const w = (dx === 0 && dy === 0) ? 1 : (dx === 0 || dy === 0) ? .5 : .25;
        acc += feat[ny * G + nx] * w; wsum += w;
      }
      out[y * G + x] = acc / wsum;
    }
    return out;
  }

  /* ---------- 4. 相似度 ---------- */
  /** 直方图交集：对密度特征区分度优于余弦 */
  function histSim(a, b) {
    let inter = 0, union = 0;
    for (let i = 0; i < a.length; i++) {
      inter += Math.min(a[i], b[i]);
      union += Math.max(a[i], b[i]);
    }
    return union ? inter / union : 0;
  }
  function closeness(a, b, tol) {
    return Math.max(0, 1 - Math.abs(a - b) / tol);
  }

  function score(query, target) {
    const gridSim = histSim(query.grid, target.grid);                   // 0–1
    const topoSim = (
      closeness(Math.log1p(query.topo.endpoints), Math.log1p(target.topo.endpoints), 1.6) * .4 +
      closeness(Math.log1p(query.topo.junctions), Math.log1p(target.topo.junctions), 1.6) * .35 +
      closeness(query.topo.density, target.topo.density, .10) * .25
    );
    // 空腔数：口框类形近字（日/田/目/门）的判别性特征。
    // 阶梯式宽容量：手绘/磨损会把交叉处的空腔磨开（实测样张「女」2 洞磨成 0，
    // 被无洞的「千/玉」反超），线性 closeness 对差 1-2 洞惩罚过狠。
    const hd = Math.abs(query.topo.holes - target.topo.holes);
    const holeSim = hd === 0 ? 1 : hd === 1 ? 0.75 : hd === 2 ? 0.55 : 0.1;
    const geoSym = (
      closeness(query.geo.symH, target.geo.symH, .45) * .3 +
      closeness(query.geo.symV, target.geo.symV, .45) * .3 +
      closeness(query.geo.cx, target.geo.cx, .3) * .2 +
      closeness(query.geo.cy, target.geo.cy, .3) * .2
    );
    return gridSim * .60 + topoSim * .18 + geoSym * .12 + holeSim * .10;
  }

  /* ---------- 5. 字形库特征索引（惰性构建 + 缓存） ---------- */
  const cache = {};
  function glyphFeature(char, eraKey) {
    const k = char + "|" + eraKey;
    if (cache[k]) return cache[k];
    const entry = GLYPH_LIB[char];
    if (!entry) return null;
    const c = document.createElement("canvas");
    c.width = 256; c.height = 256;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    drawGlyphOn(ctx, entry, eraKey, 256, "#000");
    const f = extract(c, 256, 256);   // 极性由 detectInverted 自动判别
    cache[k] = f;
    return f;
  }

  /** 把字形绘制到 canvas（供识别索引 / 粒子采样共用）
   *  opts.transparent = true 时不铺白底（用于合成拓片等已有底色的场景） */
  function drawGlyphOn(ctx, entry, eraKey, size, color, opts = {}) {
    const def0 = entry[eraKey];
    const vb = (def0 && def0[0] && def0[0].vb) || 100;
    const s = size / vb;
    ctx.save();
    if (!opts.transparent) {
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, size, size);
    }
    ctx.scale(s, s);
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.lineCap = "round"; ctx.lineJoin = "round";

    const def = entry[eraKey];
    if (def && def.char) {
      ctx.fillStyle = color;
      ctx.font = `86px ${def.font}`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(def.char, 50, 54);
      ctx.restore();
      return;
    }
    const baseW = STROKE_W[eraKey] || 3.2;
    (def || []).forEach(st => {
      const p = new Path2D(st.d);
      const w = (st.w || baseW) * (opts.weight || 1);
      if (st.m === "solid") {
        ctx.fill(p);                                     // 真实字形：纯填充
      } else if (st.m === "fill") {
        ctx.lineWidth = w * .6; ctx.fill(p); ctx.stroke(p);
      } else {
        ctx.lineWidth = w; ctx.stroke(p);
      }
    });
    ctx.restore();
  }

  function buildIndex(eraKey) {
    return CHAR_ORDER.map(c => ({ char: c, feat: glyphFeature(c, eraKey) }))
      .filter(x => x.feat);
  }

  /* ---------- 6. 主入口：识别 ---------- */

  /**
   * 置信度校准：把「绝对匹配质量」与「领先亚军的程度」合成一个可解释的概率。
   *
   * 早期实现直接用 softmax 占比当置信度，字库从 24 扩到 119 后被严重摊薄
   *（明明 119/119 全对，显示却只有 42%），故改为双因子模型：
   *   quality —— 最佳匹配本身的相似度有多高（输入干净、笔画完整 → 高）
   *   dom     —— 比亚军领先多少（形近字难分时自动压低）
   */
  function confidence(s1, margin) {
    const quality = Math.min(1, Math.max(0, (s1 - 0.55) / 0.40));
    const dom = Math.min(1, Math.max(0, (margin - 0.02) / 0.28));
    return Math.min(0.97, Math.max(0.12, 0.28 + 0.68 * (0.35 * quality + 0.65 * dom)));
  }

  /** 把查询特征横向重采样到目标宽高比（以中心为轴）。
   *  手绘的分支张角、照片透视都会改变宽窄，而归一化保留长宽比——
   *  同一个「人」画得开阔些（0.35）和字库瘦长形（0.17）比对时主笔画
   *  会错开 1–2 格，网格几乎不相交。只在拓扑/几何沿用原值、
   *  网格密度按新比例重算。 */
  function restretch(feat, targetAspect) {
    if (!feat.norm || !feat.aspect) return feat;
    const n = NORM, out = new Uint8Array(n * n);
    const cx = n / 2, sx = targetAspect / feat.aspect;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (!feat.norm[y * n + x]) continue;
      const nx = Math.round(cx + (x - cx) * sx);
      if (nx >= 0 && nx < n) out[y * n + nx] = 1;
    }
    return {
      grid: softenGrid(gridDensity(out)),
      topo: feat.topo,
      geo: feat.geo,
      norm: out,
      aspect: targetAspect
    };
  }

  function recognize(queryFeat, eraKey = "oracle", topN = 5) {
    const index = buildIndex(eraKey);
    const raw = index.map(t => {
      let s = score(queryFeat, t.feat);
      // 宽窄容错：宽高比差得较多时，双向各重采样一次再比，取较优者（轻微折扣）。
      // 压缩/拉伸倍率必须封顶在 [0.45, 2.2]：把扁宽的图横向压到极窄（sx≈0.2）
      // 会把全部墨量挤进三四列，与任何细长字形假性高重合——实测一张扁宽的
      // 「日」（1.37）被压到弓的 0.27 后，弓/月/刀/千全部从 0.43 虚高到 0.6+ 反超。
      if (Vision.RESTRETCH !== false && t.feat && Math.abs(t.feat.aspect - queryFeat.aspect) > 0.12) {
        const sx = t.feat.aspect / queryFeat.aspect;          // 查询 → 目标
        if (sx >= 0.45 && sx <= 2.2) {
          const s2 = score(restretch(queryFeat, t.feat.aspect), t.feat);
          if (s2 > s) s = s2 * 0.97;
        }
        const sxr = queryFeat.aspect / t.feat.aspect;         // 目标 → 查询
        if (sxr >= 0.45 && sxr <= 2.2) {
          const s3 = score(queryFeat, restretch(t.feat, queryFeat.aspect));
          if (s3 > s) s = s3 * 0.97;
        }
      }
      return { char: t.char, s };
    });
    raw.sort((a, b) => b.s - a.s);
    const s1 = raw[0].s, margin = s1 - (raw[1] ? raw[1].s : 0);
    return raw.slice(0, topN).map(r => ({
      char: r.char,
      raw: r.s,
      conf: confidence(s1, margin) * (r.s / (s1 || 1)) ** 2
    }));
  }

  /** 跨书体综合识别（甲骨文书体判定为主，其余书体投票为调节项） */
  function recognizeAll(queryFeat) {
    // 手绘/拓片绝大多数是甲骨风格，主书体权重最大，避免被后世俗体喧宾夺主
    const weights = { oracle: 1.0, bronze: 0.40, seal: 0.28, clerical: 0.18, regular: 0.12 };
    const oracleRes = recognize(queryFeat, "oracle", 10);

    const acc = {};
    const eraBest = {};   // 每个字在"最认可它的那个书体"里拿到多少置信度
    let total = 0;
    for (const k in weights) {
      // 用各书体内部已归一化的 conf 投票（不同书体的原始分数量纲不一致，
      // 直接加 raw 会让规整的楷书/隶书喧宾夺主）。取前 10 名参与，
      // 使某字在个别书体跌出前十时仍有话语权。
      for (const r of (k === "oracle" ? oracleRes : recognize(queryFeat, k, 10))) {
        // conf² 锐化：只有真正"赢下"某书体的字才有票，防止噪声书体用
        // 一堆第 2~5 名票把甲骨时代的微弱胜者翻掉（实测「女」被「光」掀翻）
        acc[r.char] = (acc[r.char] || 0) + r.conf * r.conf * weights[k];
        if (r.conf > (eraBest[r.char] || 0)) eraBest[r.char] = r.conf;
      }
      total += weights[k];
    }
    const list = Object.keys(acc).map(c => ({ char: c, raw: acc[c] / total }));
    list.sort((a, b) => b.raw - a.raw);

    /* 置信度 = 甲骨文书体自身的判定置信度（其余书体只在"推翻主判定"时下调）。
     *
     * 走过一段弯路：曾用加权均值 / softmax 占比当置信度，字库扩到 119 字后被
     * 严重摊薄——实测 119/119 全对却只显示 42%。而跨书体"一致性"也不能直接用：
     * 拿甲骨文去问小篆和楷书，本来就不该一致。所以最终口径是主书体说了算。 */
    const topChar = list[0].char;
    const oracleTop = oracleRes.find(r => r.char === topChar);
    // 输入可能是甲骨文、金文甚至小篆，取"最认可它的书体"给出的置信度为基准
    // （只看甲骨文书体会让金文输入明明认对了却显示 17%）
    let c1 = eraBest[topChar] || 0;
    if (oracleTop && topChar !== oracleRes[0].char) c1 *= 0.85;  // 主书体另有主张
    if (!oracleTop) c1 *= 0.75;                                  // 主书体前十无此字
    c1 = Math.min(0.97, Math.max(0.12, c1));

    return list.slice(0, 5).map((x, i) => ({
      char: x.char,
      conf: i === 0 ? c1 : c1 * (x.raw / (list[0].raw || 1)) ** 3
    }));
  }

  /* ---------- 6b. 稳健识别：多角度搜索 ----------
   * 用户上传多半是随手拍或临摹，字经常是歪的。二阶矩去斜对部分字会估错主轴，
   * 于是干脆把原图转几个角度各认一遍再投票——查询侧只多几次骨架化，代价可接受。
   */
  const SEARCH_ANGLES = [0, -5, 5, -10, 10, -16, 16];

  function rotateSource(source, w, h, ang) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(ang * Math.PI / 180);
    ctx.translate(-w / 2, -h / 2);
    ctx.drawImage(source, 0, 0, w, h);
    ctx.restore();
    return c;
  }

  /**
   * 多角度识别：正视角说了算，斜视角只有明显更好时才改判。
   *
   * 试过"多角度投票"——反而把原样和干净输入的正确结果挤掉了（100%→93%），
   * 因为歪着的字形偶尔会撞上某个形近字拿高分。改成带阈值的挑战制后两者兼得。
   */
  function recognizeRobust(source, w, h) {
    const f0 = extract(source, w, h);
    if (!f0) return [];
    let best = recognizeAll(f0);
    if (!best.length) return best;
    let bestScore = best[0].conf;

    for (const ang of SEARCH_ANGLES) {
      if (ang === 0) continue;
      const f = extract(rotateSource(source, w, h, ang), w, h);
      if (!f) continue;
      const r = recognizeAll(f);
      if (!r.length) continue;
      if (r[0].char === best[0].char) {
        // 同一答案：采纳置信度更高的那视角
        if (r[0].conf > best[0].conf) { best = r; bestScore = r[0].conf; }
      } else if (r[0].conf > bestScore + 0.12) {
        // 明显更好才改判，避免歪打正着
        best = r; bestScore = r[0].conf;
      }
    }
    return best;
  }

  /* ---------- 7. 采样点（供粒子艺术引擎） ---------- */
  function samplePoints(entry, eraKey, count, size = 512) {
    const c = document.createElement("canvas");
    c.width = size; c.height = size;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    drawGlyphOn(ctx, entry, eraKey, size, "#000");
    const data = ctx.getImageData(0, 0, size, size).data;
    const hits = [];
    const step = 2;
    for (let y = 0; y < size; y += step) {
      for (let x = 0; x < size; x += step) {
        const i = (y * size + x) * 4;
        if (data[i] < 128) hits.push([x, y]);
      }
    }
    if (!hits.length) return [];
    const out = [];
    for (let i = 0; i < count; i++) {
      out.push(hits[(Math.random() * hits.length) | 0]);
    }
    return out;
  }

  return {
    extract, recognize, recognizeAll, recognizeRobust, buildIndex, score, restretch,
    glyphFeature, drawGlyphOn, samplePoints,
    binarize, boundingBox, NORM, GRID
  };
})();
