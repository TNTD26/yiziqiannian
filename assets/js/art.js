/* ============================================================
 * 一字千年 · 数字艺术生成引擎  ART ENGINE
 * ------------------------------------------------------------
 * 四种视觉语言，全部由 Canvas 实时绘制，非 CSS 滤镜：
 *   oracle   龟骨卜辞 —— 兽骨质地、刀刻双线、灼卜焦斑、朱砂
 *   bronze   青铜铭文 —— 范铸浮雕、云雷纹边框、锈色斑驳
 *   ink      水墨流体 —— 宣纸洇墨、飞白、溅点、留白
 *   particle 数字粒子 —— 点云汇聚、发光轨迹、数据流
 * 生成后统一加盖朱印、落款与作品编号，可导出 PNG 海报。
 * ============================================================ */

const Art = (() => {

  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[(Math.random() * arr.length) | 0];

  /* ---------- 通用：把字形画到 ctx（透明底） ---------- */
  function drawGlyph(ctx, entry, eraKey, size, color, opts = {}) {
    const def0 = entry[eraKey];
    const vb = (def0 && def0[0] && def0[0].vb) || 100;
    const s = size / vb;
    ctx.save();
    ctx.scale(s, s);
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    const def = entry[eraKey];
    if (def && def.char) {
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
      if (st.m === "solid") { ctx.fill(p); }              // 真实字形：纯填充
      else if (st.m === "fill") { ctx.lineWidth = w * .6; ctx.fill(p); ctx.stroke(p); }
      else { ctx.lineWidth = w; ctx.stroke(p); }
    });
    ctx.restore();
  }

  /* ---------- 噪点 / 颗粒 ---------- */
  function grain(ctx, W, H, amount, alpha) {
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.random() > amount) continue;
      const n = (Math.random() - .5) * 255 * alpha;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
  }

  /* ---------- 纸 / 骨 / 铜 底纹 ---------- */
  function baseOracle(ctx, W, H) {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#e3d4b3"); g.addColorStop(.5, "#d3c19b"); g.addColorStop(1, "#c4ad82");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // 骨料纤维
    for (let i = 0; i < 160; i++) {
      ctx.strokeStyle = `rgba(120,95,60,${rnd(.03, .1)})`;
      ctx.lineWidth = rnd(.6, 2.2);
      ctx.beginPath();
      const y = rnd(0, H);
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(W * .3, y + rnd(-30, 30), W * .7, y + rnd(-30, 30), W, y + rnd(-25, 25));
      ctx.stroke();
    }
    // 沁色
    for (let i = 0; i < 14; i++) {
      const r = rnd(60, 220);
      const rg = ctx.createRadialGradient(rnd(0, W), rnd(0, H), 0, rnd(0, W), rnd(0, H), r);
      rg.addColorStop(0, "rgba(150,110,60,.14)"); rg.addColorStop(1, "transparent");
      ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
    }
    grain(ctx, W, H, .5, .12);
  }

  function baseBronze(ctx, W, H) {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#3c4a3e"); g.addColorStop(.45, "#55644f"); g.addColorStop(1, "#2f3a34");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // 铜锈
    const rusts = ["rgba(122,168,140,.30)", "rgba(150,120,60,.26)", "rgba(70,110,95,.28)", "rgba(176,140,80,.18)"];
    for (let i = 0; i < 40; i++) {
      const x = rnd(0, W), y = rnd(0, H), r = rnd(30, 190);
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, pick(rusts)); rg.addColorStop(1, "transparent");
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    }
    grain(ctx, W, H, .55, .18);
  }

  function baseInk(ctx, W, H) {
    ctx.fillStyle = "#f2ecdd"; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 90; i++) {
      ctx.strokeStyle = `rgba(190,180,160,${rnd(.05, .16)})`;
      ctx.lineWidth = rnd(.4, 1.1);
      ctx.beginPath();
      const x = rnd(0, W); ctx.moveTo(x, 0); ctx.lineTo(x + rnd(-8, 8), H); ctx.stroke();
    }
    for (let i = 0; i < 8; i++) {
      const r = rnd(80, 260);
      const rg = ctx.createRadialGradient(rnd(0, W), rnd(0, H), 0, rnd(0, W), rnd(0, H), r);
      rg.addColorStop(0, "rgba(214,202,178,.5)"); rg.addColorStop(1, "transparent");
      ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
    }
    grain(ctx, W, H, .35, .08);
  }

  function baseDigital(ctx, W, H) {
    ctx.fillStyle = "#07080a"; ctx.fillRect(0, 0, W, H);
    const rg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * .7);
    rg.addColorStop(0, "rgba(40,52,70,.55)"); rg.addColorStop(1, "transparent");
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
    // 网格
    ctx.strokeStyle = "rgba(120,160,200,.05)"; ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 28) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += 28) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  }

  /* ---------- 龟甲裂纹 ---------- */
  function cracks(ctx, W, H) {
    ctx.save();
    ctx.lineCap = "round";
    for (let i = 0; i < 9; i++) {
      let x = rnd(0, W), y = rnd(0, H);
      let a = rnd(0, Math.PI * 2);
      ctx.strokeStyle = `rgba(90,65,40,${rnd(.18, .38)})`;
      ctx.lineWidth = rnd(.8, 2);
      ctx.beginPath(); ctx.moveTo(x, y);
      const seg = 8 + (Math.random() * 10 | 0);
      for (let j = 0; j < seg; j++) {
        a += rnd(-.5, .5);
        x += Math.cos(a) * rnd(14, 46); y += Math.sin(a) * rnd(14, 46);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // 灼卜焦斑
    for (let i = 0; i < 5; i++) {
      const x = rnd(W * .1, W * .9), y = rnd(H * .1, H * .9), r = rnd(14, 44);
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, "rgba(48,32,18,.55)"); rg.addColorStop(.6, "rgba(70,48,26,.2)"); rg.addColorStop(1, "transparent");
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    }
    ctx.restore();
  }

  /* ---------- 云雷纹边框 ---------- */
  function leiwenBorder(ctx, W, H, color) {
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = 2.2; ctx.lineJoin = "miter";
    const unit = 46, pad = 26;
    const drawUnit = (x, y, rot) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(0, -unit * .62); ctx.lineTo(unit * .62, -unit * .62);
      ctx.lineTo(unit * .62, -unit * .22); ctx.lineTo(unit * .3, -unit * .22);
      ctx.lineTo(unit * .3, -unit * .42);
      ctx.stroke(); ctx.restore();
    };
    const cols = Math.floor((W - pad * 2) / unit), rows = Math.floor((H - pad * 2) / unit);
    for (let i = 0; i < cols; i++) {
      drawUnit(pad + i * unit, pad + 4, 0);
      drawUnit(pad + i * unit, H - pad - 4, Math.PI);
    }
    for (let j = 0; j < rows; j++) {
      drawUnit(pad + 4, pad + j * unit, -Math.PI / 2 + Math.PI);
      drawUnit(W - pad - 4, pad + j * unit, Math.PI / 2 + Math.PI);
    }
    ctx.restore();
  }

  /* ---------- 朱印 ---------- */
  function seal(ctx, x, y, size, text) {
    ctx.save();
    ctx.translate(x, y);
    // 印面
    ctx.fillStyle = "rgba(159,63,53,.9)";
    ctx.beginPath();
    const r = 6;
    ctx.moveTo(r, 0); ctx.lineTo(size - r, 0); ctx.quadraticCurveTo(size, 0, size, r);
    ctx.lineTo(size, size - r); ctx.quadraticCurveTo(size, size, size - r, size);
    ctx.lineTo(r, size); ctx.quadraticCurveTo(0, size, 0, size - r);
    ctx.lineTo(0, r); ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.fill();
    // 做旧
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = `rgba(242,236,221,${rnd(.05, .3)})`;
      ctx.beginPath(); ctx.arc(rnd(0, size), rnd(0, size), rnd(.6, 2.6), 0, 7); ctx.fill();
    }
    // 印文（2×2）
    const chars = (text || "一字千年").slice(0, 4).split("");
    ctx.fillStyle = "#f4efe1";
    const fs = size * .38;
    ctx.font = `600 ${fs}px "KaiTi","STKaiti","楷体",serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const pos = [[.29, .30], [.71, .30], [.29, .73], [.71, .73]];
    chars.forEach((c, i) => { if (pos[i]) ctx.fillText(c, size * pos[i][0], size * pos[i][1]); });
    ctx.restore();
  }

  /* ---------- 落款 ---------- */
  function colophon(ctx, W, H, lines, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.font = `300 ${W * .017}px "Outfit","Noto Sans SC",sans-serif`;
    lines.forEach((l, i) => ctx.fillText(l, W * .075, H - W * .085 + i * W * .028));
    ctx.restore();
  }

  /* ---------- 主绘制 ---------- */
  const STYLE_META = {
    oracle: { label: "龟骨卜辞", en: "ORACLE BONE", ink: "#5a2f18", accent: "#9f3f35" },
    bronze: { label: "青铜铭文", en: "BRONZE CAST", ink: "#e8cf94", accent: "#c9a227" },
    ink: { label: "水墨流体", en: "INK FLOW", ink: "#17181a", accent: "#39424a" },
    particle: { label: "数字粒子", en: "DIGITAL PARTICLE", ink: "#9fd8ff", accent: "#c9a96a" }
  };

  /**
   * 生成一幅作品
   * @returns {Function} stop —— 用于停止持续动画（静态风格为空函数）
   */
  function generate(canvas, opts, onDone) {
    const { char, era, style } = opts;
    const entry = GLYPH_LIB[char] || GLYPH_LIB["日"];
    const W = canvas.width, H = canvas.height;
    const ctx = canvas.getContext("2d");
    const meta = STYLE_META[style] || STYLE_META.oracle;

    ctx.clearRect(0, 0, W, H);

    // 背景
    if (style === "oracle") { baseOracle(ctx, W, H); cracks(ctx, W, H); }
    else if (style === "bronze") { baseBronze(ctx, W, H); }
    else if (style === "ink") { baseInk(ctx, W, H); }
    else { baseDigital(ctx, W, H); }

    if (style === "bronze") {
      leiwenBorder(ctx, W, H, "rgba(214,192,140,.20)");
      ctx.strokeStyle = "rgba(214,192,140,.35)"; ctx.lineWidth = 3;
      ctx.strokeRect(W * .055, H * .055, W * .89, H * .89);
    } else if (style === "oracle" || style === "ink") {
      ctx.strokeStyle = style === "oracle" ? "rgba(90,65,40,.35)" : "rgba(60,60,60,.18)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(W * .06, H * .06, W * .88, H * .88);
    } else {
      ctx.strokeStyle = "rgba(150,200,255,.18)"; ctx.lineWidth = 1;
      ctx.strokeRect(W * .06, H * .06, W * .88, H * .88);
      // 角标
      ctx.fillStyle = "rgba(150,200,255,.35)";
      [[W * .06, H * .06], [W * .94, H * .06], [W * .06, H * .94], [W * .94, H * .94]].forEach(([x, y]) => {
        ctx.fillRect(x - 9, y - 1.5, 18, 3); ctx.fillRect(x - 1.5, y - 9, 3, 18);
      });
    }

    const gsize = W * .62;
    const gx = (W - gsize) / 2, gy = (H - gsize) / 2 - W * .02;

    /* ===== 数字粒子：持续动画 ===== */
    if (style === "particle") {
      const pts = Vision.samplePoints(entry, era, 1500, 400).map(([x, y]) => ({
        tx: gx + x / 400 * gsize, ty: gy + y / 400 * gsize,
        x: rnd(0, W), y: rnd(0, H),
        vx: 0, vy: 0, r: rnd(.7, 2.1), p: rnd(0, 6.28)
      }));
      let t = 0, raf = 0;
      const loop = () => {
        t += 1;
        ctx.save();
        ctx.fillStyle = "rgba(7,8,10,.22)"; ctx.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = "lighter";
        pts.forEach(pt => {
          const dx = pt.tx - pt.x, dy = pt.ty - pt.y;
          const force = t < 90 ? .06 : .012;
          pt.vx += dx * force * .35; pt.vy += dy * force * .35;
          pt.vx *= .90; pt.vy *= .90;
          pt.x += pt.vx; pt.y += pt.vy;
          const wob = Math.sin(t * .04 + pt.p) * .6;
          const c = `rgba(${140 + Math.sin(pt.p) * 40 | 0},${200 + Math.cos(pt.p) * 30 | 0},255,.75)`;
          ctx.fillStyle = c;
          ctx.beginPath(); ctx.arc(pt.x + wob, pt.y + wob, pt.r, 0, 7); ctx.fill();
        });
        ctx.globalCompositeOperation = "source-over";
        ctx.restore();
        // 扫描线
        const sy = (t * 4) % H;
        const lg = ctx.createLinearGradient(0, sy - 40, 0, sy + 40);
        lg.addColorStop(0, "transparent"); lg.addColorStop(.5, "rgba(160,215,255,.10)"); lg.addColorStop(1, "transparent");
        ctx.fillStyle = lg; ctx.fillRect(0, sy - 40, W, 80);

        // 每帧重绘：外框 / 印章 / 落款（避免被粒子覆盖层吃掉）
        ctx.strokeStyle = "rgba(150,200,255,.18)"; ctx.lineWidth = 1;
        ctx.strokeRect(W * .06, H * .06, W * .88, H * .88);
        ctx.fillStyle = "rgba(150,200,255,.35)";
        [[W * .06, H * .06], [W * .94, H * .06], [W * .06, H * .94], [W * .94, H * .94]].forEach(([x, y]) => {
          ctx.fillRect(x - 9, y - 1.5, 18, 3); ctx.fillRect(x - 1.5, y - 9, 3, 18);
        });
        seal(ctx, W * .78, H * .80, W * .11, char + "千年");
        colophon(ctx, W, H, [
          "YIZIQIAN NIAN · AI ORACLE BONE LAB",
          `${entry.modern} · ${entry.pinyin} · ${(ERAS.find(e => e.key === era) || ERAS[0]).name}`,
          "PARTICLE FIELD / " + (opts.code || "0000")
        ], "rgba(180,215,255,.55)");

        raf = requestAnimationFrame(loop);
      };
      loop();
      onDone && onDone();
      return () => cancelAnimationFrame(raf);
    }

    /* ===== 静态三体：逐笔生成动画 ===== */
    const off = document.createElement("canvas");
    off.width = gsize; off.height = gsize;
    const octx = off.getContext("2d");
    drawGlyph(octx, entry, era, gsize, "#000");

    // 字形区背景预渲染一次（纹理生成开销较大）
    const bc = document.createElement("canvas");
    bc.width = gsize; bc.height = gsize;
    const bctx = bc.getContext("2d");
    if (style === "oracle") { baseOracle(bctx, gsize, gsize); }
    else if (style === "bronze") { baseBronze(bctx, gsize, gsize); }
    else { baseInk(bctx, gsize, gsize); }

    let prog = 0;
    const total = 26;
    const step = () => {
      prog++;
      ctx.drawImage(bc, gx, gy);

      // 逐步揭示字形
      ctx.save();
      ctx.beginPath();
      ctx.rect(gx, gy, gsize, gsize * (prog / total));
      ctx.clip();

      if (style === "oracle") {
        // 刀刻：暗影 + 高光错位，模拟凹槽
        ctx.globalAlpha = .55;
        drawGlyphAt(ctx, entry, era, gx + 2.5, gy + 3, gsize, "rgba(255,244,214,.85)", 1.06);
        ctx.globalAlpha = 1;
        drawGlyphAt(ctx, entry, era, gx, gy, gsize, meta.ink, 1);
        // 朱砂点缀
        ctx.globalAlpha = .5;
        drawGlyphAt(ctx, entry, era, gx - 1, gy - 1, gsize, "rgba(159,63,53,.55)", .6);
        ctx.globalAlpha = 1;
      } else if (style === "bronze") {
        // 范铸：深色凹陷 + 铜色高光
        drawGlyphAt(ctx, entry, era, gx + 3, gy + 4, gsize, "rgba(20,26,20,.75)", 1.08);
        const lg = ctx.createLinearGradient(gx, gy, gx + gsize, gy + gsize);
        lg.addColorStop(0, "#f0dca6"); lg.addColorStop(.5, "#c9a96a"); lg.addColorStop(1, "#8a6f3a");
        drawGlyphAt(ctx, entry, era, gx, gy, gsize, lg, 1);
      } else {
        // 水墨：多层洇染
        for (let k = 0; k < 3; k++) {
          ctx.globalAlpha = .22 - k * .05;
          drawGlyphAt(ctx, entry, era, gx + rnd(-2, 2), gy + rnd(-2, 2), gsize, "#22241f", 1 + k * .28);
        }
        ctx.globalAlpha = 1;
        drawGlyphAt(ctx, entry, era, gx, gy, gsize, meta.ink, 1);
      }
      ctx.restore();

      if (prog < total) { requestAnimationFrame(step); return; }
      finish();
    };

    function drawGlyphAt(c, e, eraKey, x, y, size, color, weight) {
      c.save(); c.translate(x, y);
      drawGlyph(c, e, eraKey, size, color, { weight });
      c.restore();
    }

    function finish() {
      if (style === "ink") {
        // 飞白 + 溅点
        ctx.save();
        ctx.globalCompositeOperation = "destination-out";
        for (let i = 0; i < 130; i++) {
          ctx.fillStyle = `rgba(0,0,0,${rnd(.05, .35)})`;
          const x = gx + rnd(0, gsize), y = gy + rnd(0, gsize);
          ctx.beginPath(); ctx.ellipse(x, y, rnd(1, 7), rnd(.6, 2.4), rnd(0, 3), 0, 7); ctx.fill();
        }
        ctx.restore();
        ctx.save();
        for (let i = 0; i < 26; i++) {
          const r = rnd(.8, 5);
          ctx.fillStyle = `rgba(23,24,26,${rnd(.08, .4)})`;
          ctx.beginPath(); ctx.arc(gx + rnd(-40, gsize + 40), gy + rnd(-40, gsize + 40), r, 0, 7); ctx.fill();
        }
        ctx.restore();
      }
      if (style === "oracle") { grain(ctx, W, H, .3, .1); }
      if (style === "bronze") { grain(ctx, W, H, .35, .14); }

      // 印章 + 落款
      seal(ctx, W * .78, H * .795, W * .115, char + "千年");
      const c1 = style === "ink" ? "rgba(40,42,45,.65)" :
        style === "bronze" ? "rgba(232,214,170,.65)" :
          style === "oracle" ? "rgba(88,58,30,.7)" : "rgba(180,215,255,.6)";
      colophon(ctx, W, H, [
        "YIZIQIAN NIAN · AI ORACLE BONE LAB",
        `${entry.modern} · ${entry.pinyin} · ${(ERAS.find(e => e.key === era) || ERAS[0]).name}`,
        `${meta.en} / ${opts.code || "0000"}`
      ], c1);
      onDone && onDone();
    }

    requestAnimationFrame(step);
    return () => { };
  }

  return { generate, drawGlyph, seal, STYLE_META };
})();
