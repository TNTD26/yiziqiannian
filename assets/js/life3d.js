/* ============================================================
 * 一字千年 V3 · 3D 数字生命引擎
 * ------------------------------------------------------------
 * 把古文字形变成"活着"的 3D 粒子生命体：
 *   1. 从真实字形轮廓采样像素 → 距离场测厚 → 3D 浮雕点云
 *   2. 生命周期：混沌星尘 → 聚合生长 → 呼吸存活 → 演化 Morph
 *   3. 五体（甲骨→金文→小篆→隶书→楷书）粒子变形巡演
 *   4. 拖拽旋转 / 滚轮缩放 / 自动旋转 / 导出视图
 * 渲染：Three.js Points + 自定义 Shader（发光精灵、深度衰减）
 * ============================================================ */

const Life3D = (() => {

  /* ---------------- 采样：字形 → 3D 点云 ---------------- */

  /** 离屏渲染字形并返回二值像素（0/1），size×size */
  function rasterize(entry, eraKey, size) {
    const c = document.createElement("canvas");
    c.width = size; c.height = size;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, size, size);
    // 复用识别引擎的绘制（自动处理 solid/fill/stroke/字体 四种模式）
    Vision.drawGlyphOn(ctx, entry, eraKey, size, "#000");
    const img = ctx.getImageData(0, 0, size, size).data;
    const bin = new Uint8Array(size * size);
    for (let i = 0; i < size * size; i++) {
      if (img[i * 4] < 128) bin[i] = 1;
    }
    return bin;
  }

  /**
   * 距离场：对二值图逐轮腐蚀，每个像素记录"距边缘的轮数"
   * → 笔画中心厚、边缘薄，天然的 3D 浮雕深度
   */
  function depthField(bin, size) {
    const depth = new Int16Array(size * size);        // 0 = 背景
    let cur = Uint8Array.from(bin);
    let alive = cur.reduce((a, v) => a + v, 0);
    const total = alive;
    let d = 0;
    while (alive > total * 0.04 && d < 24) {          // 腐蚀到只剩 4% 墨量为止
      d++;
      const next = new Uint8Array(size * size);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const i = y * size + x;
          if (!cur[i]) continue;
          // 4 邻域都还在才保留（可调 8 邻域，更圆）
          if (cur[i - 1] && cur[i + 1] && cur[i - size] && cur[i + size]) next[i] = 1;
        }
      }
      for (let i = 0; i < size * size; i++) {
        if (next[i] && !depth[i]) depth[i] = d;
      }
      alive = next.reduce((a, v) => a + v, 0);
      cur = next;
    }
    return depth;
  }

  /**
   * 生成目标点云：从字形像素加权采样
   * 返回 Float32Array [x,y,z, x,y,z...]（字形空间 [-1,1]，z 为浮雕厚度）
   */
  function sampleCloud(entry, eraKey, count, res = 128) {
    const bin = rasterize(entry, eraKey, res);
    const depth = depthField(bin, res);
    // 收集墨水像素，按深度加权（中心厚的地方点更密）
    const pts = [];
    let wsum = 0;
    for (let i = 0; i < res * res; i++) {
      if (!bin[i]) continue;
      const w = 1 + depth[i] * 1.6;
      pts.push({ i, w });
      wsum += w;
    }
    if (!pts.length) return null;
    const maxD = Math.max(1, (() => { let m = 0; for (const v of depth) if (v > m) m = v; return m; })());
    const out = new Float32Array(count * 3);
    // 前缀和 + 二分取代线性扫描：O(ink + count·log ink)
    const cum = new Float64Array(pts.length);
    let acc = 0;
    for (let j = 0; j < pts.length; j++) { acc += pts[j].w; cum[j] = acc; }
    for (let k = 0; k < count; k++) {
      const r = Math.random() * acc;
      let lo = 0, hi = pts.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < r) lo = mid + 1; else hi = mid; }
      const pick = pts[lo];
      const px = pick.i % res, py = (pick.i / res) | 0;
      const x = (px / (res - 1)) * 2 - 1;
      const y = 1 - (py / (res - 1)) * 2;             // 屏幕坐标翻转
      // z：浮雕厚度（中心凸起），加微小抖动制造体积感
      const dv = depth[pick.i] / maxD;
      const z = (dv * .55 + Math.random() * .10) * (Math.random() < .5 ? 1 : -1) * .9;
      out[k * 3] = x; out[k * 3 + 1] = y; out[k * 3 + 2] = z;
    }
    return out;
  }

  /** 混沌星尘：球壳 + 内部弥散的随机点 */
  function chaosCloud(count, radius = 2.6) {
    const out = new Float32Array(count * 3);
    for (let k = 0; k < count; k++) {
      // 均匀球体内
      const u = Math.random(), v = Math.random();
      const th = u * Math.PI * 2, ph = Math.acos(2 * v - 1);
      const r = radius * (0.55 + 0.45 * Math.cbrt(Math.random()));
      out[k * 3] = r * Math.sin(ph) * Math.cos(th);
      out[k * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
      out[k * 3 + 2] = r * Math.cos(ph);
    }
    return out;
  }

  /* ---------------- 着色器 ---------------- */

  const VERT = `
    attribute vec3 aTarget;
    attribute vec3 aSeed;
    attribute float aDepth;
    uniform float uMorph;      // 0: 在 aSeed(混沌) 位置, 1: 到达 aTarget
    uniform float uTime;
    uniform float uSize;       // 世界单位下的粒子直径
    uniform float uPixScale;   // 绘制缓冲高度 / (2*tan(fov/2))，保证分辨率无关
    varying float vGlow;
    varying float vDepth;

    float ease(float t) { return 1.0 - pow(1.0 - t, 3.0); }

    void main() {
      // 聚合进度：每粒子错峰（seed 决定延迟），像生长一样逐个点亮
      float local = clamp((uMorph - aSeed.x * 0.35) / 0.65, 0.0, 1.0);
      float e = ease(local);
      // 聚合路径上加一点弧线摆动，避免直线飞行的机械感
      vec3 pos = mix(position, aTarget, e);
      float sway = (1.0 - e) * 0.6;
      pos += aSeed * sway;

      // 存活呼吸：整体缓慢起伏 + 深度方向微涨落
      float br = sin(uTime * 0.9 + aSeed.y * 6.28) * 0.012
               + sin(uTime * 2.1 + aSeed.z * 6.28) * 0.006;
      pos.xy += br * (0.5 + aDepth);
      pos.z  += br * 1.6 * (0.3 + aDepth);

      vec4 mv = modelViewMatrix * vec4(pos, 1.0);
      // 透视正确的点大小：世界尺寸 × 投影系数 / 视空间深度，并做钳位避免极端 overdraw
      float px = uSize * (0.55 + aDepth * 0.9) * (0.35 + 0.65 * e) * uPixScale / -mv.z;
      gl_PointSize = clamp(px, 1.0, 26.0);
      // 越深（笔画中心）越亮
      vGlow = 0.35 + aDepth * 0.65;
      vDepth = aDepth;
      gl_Position = projectionMatrix * mv;
    }
  `;

  const FRAG = `
    uniform vec3 uColorA;    // 边缘色
    uniform vec3 uColorB;    // 核心色
    uniform float uTime;
    varying float vGlow;
    varying float vDepth;

    void main() {
      vec2 uv = gl_PointCoord - 0.5;
      float r = length(uv);
      if (r > 0.5) discard;
      float core = smoothstep(0.5, 0.0, r);
      float star = pow(core, 3.0);
      vec3 col = mix(uColorA, uColorB, star * (0.45 + vDepth * 0.55));
      float tw = 0.85 + 0.15 * sin(uTime * 3.0 + vDepth * 40.0);
      gl_FragColor = vec4(col, core * vGlow * tw);
    }
  `;

  /* ---------------- 引擎主体 ---------------- */

  function create(container, opts = {}) {
    if (typeof THREE === "undefined") throw new Error("Three.js 未加载");

    const T = {
      container,
      char: opts.char || "日",
      eraIdx: 0,                       // ERAS 下标
      playing: true,
      autoRotate: true,
      phase: "chaos",                  // chaos → gather → alive → evolve
      phaseT: 0,
      morphT: 0,                       // 0..1 聚合进度
      speed: 1,
      disposed: false
    };
    const COUNT = opts.count || 12000;

    /* 场景 */
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x07090d, 0.075);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 0, 3.4);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    /* 字形粒子 */
    const geo = new THREE.BufferGeometry();
    const seedArr = new Float32Array(COUNT * 3);
    const depthArr = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      seedArr[i * 3] = Math.random(); seedArr[i * 3 + 1] = Math.random(); seedArr[i * 3 + 2] = Math.random();
      depthArr[i] = Math.random();
    }
    const chaos = chaosCloud(COUNT);
    geo.setAttribute("position", new THREE.BufferAttribute(chaos.slice(), 3));
    geo.setAttribute("aTarget", new THREE.BufferAttribute(chaos.slice(), 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seedArr, 3));
    geo.setAttribute("aDepth", new THREE.BufferAttribute(depthArr, 1));

    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uMorph: { value: 0 },
        uTime: { value: 0 },
        uSize: { value: opts.size || 0.016 },   // 世界单位
        uPixScale: { value: 700 },             // resize 时按真实视口重算
        uColorA: { value: new THREE.Color(0x8a5a2b) },   // 骨铜
        uColorB: { value: new THREE.Color(0xffd98a) }    // 金芯
      }
    });
    const points = new THREE.Points(geo, mat);
    scene.add(points);

    /* 背景星尘 */
    const starGeo = new THREE.BufferGeometry();
    const starN = 900;
    const sp = new Float32Array(starN * 3);
    for (let i = 0; i < starN; i++) {
      const r = 6 + Math.random() * 10;
      const u = Math.random() * Math.PI * 2, v = Math.acos(2 * Math.random() - 1);
      sp[i * 3] = r * Math.sin(v) * Math.cos(u);
      sp[i * 3 + 1] = r * Math.sin(v) * Math.sin(u);
      sp[i * 3 + 2] = r * Math.cos(v);
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0x5a6d84, size: 0.035, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    /* 交互：拖拽旋转 + 惯性 + 缩放 */
    const ctl = { rx: -0.08, ry: 0, vx: 0, vy: 0, dist: 3.4, dragging: false, lx: 0, ly: 0 };
    const el = renderer.domElement;
    el.style.touchAction = "none";
    const onDown = e => { ctl.dragging = true; ctl.lx = e.clientX; ctl.ly = e.clientY; el.setPointerCapture(e.pointerId); };
    const onMove = e => {
      if (!ctl.dragging) return;
      ctl.vy = (e.clientX - ctl.lx) * 0.005;
      ctl.vx = (e.clientY - ctl.ly) * 0.005;
      ctl.ry += ctl.vy; ctl.rx += ctl.vx;
      ctl.lx = e.clientX; ctl.ly = e.clientY;
    };
    const onUp = () => ctl.dragging = false;
    const onWheel = e => {
      e.preventDefault();
      ctl.dist = Math.min(7, Math.max(1.6, ctl.dist + e.deltaY * 0.0016));
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });

    /* 目标切换：position=旧目标（粒子当前位置）→ aTarget=新目标 */
    function applyTarget(entry, eraKey) {
      const cloud = sampleCloud(entry, eraKey, COUNT);
      const tgt = cloud || chaosCloud(COUNT, 1.4);
      const cur = geo.getAttribute("position");
      const old = geo.getAttribute("aTarget");
      cur.copyArray(old.array);                 // 从旧目标出发做 morph
      cur.needsUpdate = true;
      old.copyArray(tgt);
      old.needsUpdate = true;
    }

    /* 主循环 */
    const clock = new THREE.Clock();
    let raf = 0;
    const PHASE_DUR = { chaos: 1.2, gather: 2.2, alive: 4.5, evolve: 2.2 };

    function tick() {
      if (T.disposed) return;
      raf = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;
      mat.uniforms.uTime.value = t;

      /* 状态机 */
      if (T.playing) {
        T.phaseT += dt * T.speed;
        const dur = PHASE_DUR[T.phase] || 2;
        if (T.phase === "chaos") {
          mat.uniforms.uMorph.value = 0;
          if (T.phaseT > dur) setPhase("gather");
        } else if (T.phase === "gather") {
          mat.uniforms.uMorph.value = Math.min(1, T.phaseT / dur);
          if (T.phaseT > dur) setPhase("alive");
        } else if (T.phase === "alive") {
          mat.uniforms.uMorph.value = 1;
          if (T.phaseT > dur && opts.autoTour) evolve();
        } else if (T.phase === "evolve") {
          // evolve：先散开再聚合成下一个书体
          const p = T.phaseT / dur;
          mat.uniforms.uMorph.value = p < 0.5 ? 1 - p * 2 : (p - 0.5) * 2;
          if (T.phaseT > dur) setPhase("alive");
        }
      }

      /* 相机 */
      if (!ctl.dragging) {
        ctl.vy *= 0.94; ctl.vx *= 0.94;
        ctl.ry += ctl.vy; ctl.rx += ctl.vx;
        if (T.autoRotate && T.phase !== "chaos") ctl.ry += dt * 0.12;
      }
      ctl.rx = Math.max(-1.2, Math.min(1.2, ctl.rx));
      camera.position.set(
        Math.sin(ctl.ry) * Math.cos(ctl.rx) * ctl.dist,
        Math.sin(ctl.rx) * ctl.dist,
        Math.cos(ctl.ry) * Math.cos(ctl.rx) * ctl.dist
      );
      camera.lookAt(0, 0, 0);

      stars.rotation.y = t * 0.01;
      points.rotation.y = 0;                    // 旋转交给相机
      renderer.render(scene, camera);
    }

    function setPhase(p) {
      T.phase = p; T.phaseT = 0;
      opts.onPhase && opts.onPhase(p);
    }

    /* 演化到下一个书体 */
    function evolve() {
      const next = (T.eraIdx + 1) % 5;
      setEra(next, true);
      setPhase("evolve");
    }

    /* 设置字 / 书体（外部 API） */
    function setChar(ch) {
      T.char = ch;
      applyTarget(GLYPH_LIB[ch], ERAS[T.eraIdx].key);
      setPhase("gather");
    }
    function setEra(idx, keepPhase) {
      T.eraIdx = idx;
      applyTarget(GLYPH_LIB[T.char], ERAS[idx].key);
      if (!keepPhase) setPhase("gather");
    }

    /* 尺寸自适应 */
    function resize() {
      const w = container.clientWidth, h = container.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      // 让 gl_PointSize 与实际绘制缓冲一致（含 devicePixelRatio）
      const buf = renderer.getDrawingBufferSize(new THREE.Vector2());
      mat.uniforms.uPixScale.value = buf.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    }
    resize();
    new ResizeObserver(resize).observe(container);

    /* 初始化 */
    applyTarget(GLYPH_LIB[T.char], ERAS[0].key);
    setPhase("chaos");
    tick();

    /* 导出当前视图 */
    function snapshot() {
      renderer.render(scene, camera);          // 确保缓冲最新
      return renderer.domElement.toDataURL("image/png");
    }

    /* 销毁 */
    function dispose() {
      T.disposed = true;
      cancelAnimationFrame(raf);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("wheel", onWheel);
      geo.dispose(); mat.dispose(); starGeo.dispose(); starMat.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    }

    return {
      state: T, setChar, setEra, evolve, setPhase, snapshot, dispose,
      setSpeed: s => T.speed = s,
      setColor: (a, b) => { mat.uniforms.uColorA.value.set(a); mat.uniforms.uColorB.value.set(b); },
      get eraName() { return ERAS[T.eraIdx].name; }
    };
  }

  return { create, sampleCloud, depthField, rasterize };
})();

if (typeof module !== "undefined") module.exports = { Life3D };
