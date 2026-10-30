var NexusNetwork = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // ../network/nexusNetwork.ts
  var nexusNetwork_exports = {};
  __export(nexusNetwork_exports, {
    createNetworkField: () => createNetworkField
  });
  var DEPTH = 0.04;
  var LIFT = 14;
  var NODE_LEVELS = 12;
  var LINK_LEVELS = 8;
  var WAVE_SPEED = 360;
  var WAVE_BAND = 115;
  var WAVE_DURATION = 2.6;
  var MAX_WAVES = 3;
  var HOVER_RADIUS = 110;
  var HOVER_STRENGTH = 0.35;
  function wave(x, y, t) {
    return 0.6 * Math.sin(x * 45e-4 + t * 0.32) * Math.cos(y * 55e-4 - t * 0.21) + 0.4 * Math.sin((x - y) * 32e-4 + t * 0.17);
  }
  function readRgb(element, name, fallback) {
    const value = getComputedStyle(element).getPropertyValue(name).trim();
    return value === "" ? fallback : value;
  }
  function finitePoint(point) {
    return point && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : void 0;
  }
  function createNetworkField(canvas, options = {}) {
    const context = canvas.getContext("2d");
    if (!context) {
      return { destroy() {
      }, setPaused() {
      }, isPaused() {
        return false;
      }, isRunning() {
        return false;
      }, waveCount() {
        return 0;
      } };
    }
    const ctx = context;
    const lowPower = options.lowPower ?? false;
    const reducedMotion = options.reducedMotion ?? false;
    const still = options.still ?? false;
    // Home fork (DD-212): canWave(event) decides whether a press may raise a wave (background only); a touch wave is raised on release, after a short
    // press with little travel, so a scroll start never raises one; setPaused(true) stops the loop (open dialogs, hidden tab) and false resumes it.
    const canWave = options.canWave ?? (() => true);
    const tapSlop = options.tapSlop ?? 10;
    const tapMs = options.tapMs ?? 500;
    let paused = false;
    let tapStart = null;
    const spacing = (options.spacing ?? 46) * (lowPower ? 1.4 : 1);
    const nodeRgb = options.nodeRgb ?? readRgb(canvas, "--nexus-network-node", "190 220 255");
    const linkRgb = options.linkRgb ?? readRgb(canvas, "--nexus-network-link", "127 233 255");
    const minFrameMs = lowPower ? 1e3 / 24 : 0;
    const maxWaves = lowPower ? 1 : MAX_WAVES;
    const initialPointer = finitePoint(options.initialPointer);
    const initialWave = finitePoint(options.initialWave);
    let width = 0;
    let height = 0;
    let dpr = 1;
    let cols = 0;
    let rows = 0;
    let baseX = new Float32Array(0);
    let baseY = new Float32Array(0);
    let screenX = new Float32Array(0);
    let screenY = new Float32Array(0);
    let height3d = new Float32Array(0);
    let crests = new Float32Array(0);
    let inBand = new Uint8Array(0);
    let radii = new Float32Array(0);
    const nodeBuckets = Array.from({ length: NODE_LEVELS }, () => []);
    const linkBuckets = Array.from({ length: LINK_LEVELS }, () => []);
    const waves = [];
    const ringX = new Float64Array(MAX_WAVES);
    const ringY = new Float64Array(MAX_WAVES);
    const ringR = new Float64Array(MAX_WAVES);
    const ringFade = new Float64Array(MAX_WAVES);
    const ringMinSq = new Float64Array(MAX_WAVES);
    const ringMaxSq = new Float64Array(MAX_WAVES);
    const bandMinSq = new Float64Array(MAX_WAVES);
    const bandMaxSq = new Float64Array(MAX_WAVES);
    let ringCount = 0;
    let pointerX = 0;
    let pointerY = 0;
    let targetX = 0;
    let targetY = 0;
    let pointerActive = false;
    let pointerMoved = false;
    let presence = 0;
    if (initialPointer && !reducedMotion) {
      pointerActive = true;
      presence = 1;
    }
    const hoverSq = HOVER_RADIUS * HOVER_RADIUS;
    const hoverBandSq = (HOVER_RADIUS + spacing) * (HOVER_RADIUS + spacing);
    const startTime = options.startTime ?? 0;
    let elapsed = 0;
    let lastDraw = 0;
    let nextDue = 0;
    let frameId = 0;
    function now() {
      return startTime + elapsed;
    }
    function targetDpr() {
      return lowPower ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);
    }
    function rebuild() {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      dpr = targetDpr();
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const rowStep = spacing * Math.sqrt(3) / 2;
      const pull = DEPTH * Math.max(width, height) / 2 + LIFT;
      const marginCols = Math.ceil(pull / spacing) + 1;
      const marginRows = Math.ceil(pull / rowStep) + 1;
      cols = Math.ceil(width / spacing) + 1 + marginCols * 2;
      rows = Math.ceil(height / rowStep) + 1 + marginRows * 2;
      const count = cols * rows;
      baseX = new Float32Array(count);
      baseY = new Float32Array(count);
      screenX = new Float32Array(count);
      screenY = new Float32Array(count);
      height3d = new Float32Array(count);
      crests = new Float32Array(count);
      inBand = new Uint8Array(count);
      radii = new Float32Array(count);
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const i = row * cols + col;
          baseX[i] = (col - marginCols) * spacing + (row % 2 === 1 ? spacing / 2 : 0);
          baseY[i] = (row - marginRows) * rowStep;
        }
      }
      if (initialPointer && !pointerMoved) {
        pointerX = targetX = initialPointer.x * width;
        pointerY = targetY = initialPointer.y * height;
      }
    }
    function prepareRings(t) {
      let kept = 0;
      for (const w of waves) {
        if (t - w.bornAt < WAVE_DURATION && t >= w.bornAt) waves[kept++] = w;
      }
      waves.length = kept;
      ringCount = waves.length;
      for (let k = 0; k < ringCount; k++) {
        const w = waves[k];
        const age = t - w.bornAt;
        const radius = age * WAVE_SPEED;
        const minR = Math.max(0, radius - WAVE_BAND);
        const maxR = radius + WAVE_BAND;
        const bandMin = Math.max(0, minR - spacing);
        const bandMax = maxR + spacing;
        ringX[k] = w.x;
        ringY[k] = w.y;
        ringR[k] = radius;
        ringFade[k] = (1 - age / WAVE_DURATION) ** 2 * w.strength;
        ringMinSq[k] = minR * minR;
        ringMaxSq[k] = maxR * maxR;
        bandMinSq[k] = bandMin * bandMin;
        bandMaxSq[k] = bandMax * bandMax;
      }
    }
    function hoverEnvelope(x, y) {
      if (presence <= 0.01) return 0;
      const dx = x - pointerX;
      const dy = y - pointerY;
      const distSq = dx * dx + dy * dy;
      if (distSq >= hoverSq) return 0;
      const f = 1 - Math.sqrt(distSq) / HOVER_RADIUS;
      return f * f * presence * HOVER_STRENGTH;
    }
    function ringEnvelope(x, y) {
      let best = 0;
      for (let k = 0; k < ringCount; k++) {
        const dx = x - ringX[k];
        const dy = y - ringY[k];
        const distSq = dx * dx + dy * dy;
        if (distSq <= ringMinSq[k] || distSq >= ringMaxSq[k]) continue;
        const u = (Math.sqrt(distSq) - ringR[k]) / WAVE_BAND;
        const bell = (1 - u * u) * (1 - u * u) * ringFade[k];
        if (bell > best) best = bell;
      }
      return best;
    }
    function draw(t) {
      prepareRings(t);
      const cx = width / 2;
      const cy = height / 2;
      const count = cols * rows;
      const hovering = presence > 0.01;
      const showLinks = ringCount > 0 || hovering;
      for (let i = 0; i < count; i++) {
        const x = baseX[i];
        const y = baseY[i];
        let z = wave(x, y, t);
        let crest = 0;
        let band = 0;
        for (let k = 0; k < ringCount; k++) {
          const dx = x - ringX[k];
          const dy = y - ringY[k];
          const distSq = dx * dx + dy * dy;
          if (distSq <= bandMinSq[k] || distSq >= bandMaxSq[k]) continue;
          band = 1;
          if (distSq <= ringMinSq[k] || distSq >= ringMaxSq[k]) continue;
          const u = (Math.sqrt(distSq) - ringR[k]) / WAVE_BAND;
          const bell = (1 - u * u) * (1 - u * u) * ringFade[k];
          z += bell * (1 - 1.4 * u * u) * 0.65;
          if (bell > crest) crest = bell;
        }
        if (hovering) {
          const dx = x - pointerX;
          const dy = y - pointerY;
          if (dx * dx + dy * dy < hoverBandSq) {
            band = 1;
            const near = hoverEnvelope(x, y);
            if (near > crest) crest = near;
          }
        }
        height3d[i] = z;
        crests[i] = crest;
        inBand[i] = band;
        screenX[i] = x + (x - cx) * z * DEPTH;
        screenY[i] = y + (y - cy) * z * DEPTH - z * LIFT;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      if (showLinks) {
        for (const bucket of linkBuckets) bucket.length = 0;
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            const i = row * cols + col;
            if (inBand[i] === 0) continue;
            const odd = row % 2 === 1;
            const below = row + 1 < rows;
            if (col + 1 < cols) addLink(i, i + 1);
            if (below) addLink(i, i + cols);
            if (below && odd && col + 1 < cols) addLink(i, i + cols + 1);
            if (below && !odd && col > 0) addLink(i, i + cols - 1);
          }
        }
        ctx.lineWidth = 1;
        for (let level = 0; level < LINK_LEVELS; level++) {
          const bucket = linkBuckets[level];
          if (bucket.length === 0) continue;
          ctx.strokeStyle = `rgb(${linkRgb} / ${((level + 1) / LINK_LEVELS * 0.5).toFixed(3)})`;
          ctx.beginPath();
          for (let k = 0; k < bucket.length; k += 2) {
            ctx.moveTo(screenX[bucket[k]], screenY[bucket[k]]);
            ctx.lineTo(screenX[bucket[k + 1]], screenY[bucket[k + 1]]);
          }
          ctx.stroke();
        }
      }
      for (const bucket of nodeBuckets) bucket.length = 0;
      for (let i = 0; i < count; i++) {
        const lift = height3d[i] + 1;
        const crest = crests[i];
        const alpha = Math.min(0.08 + lift * 0.1 + crest * 0.55, 0.75);
        radii[i] = 0.6 + lift * 0.45 + crest * 0.7;
        nodeBuckets[Math.min(NODE_LEVELS - 1, Math.floor(alpha / 0.75 * NODE_LEVELS))].push(i);
      }
      ctx.fillStyle = `rgb(${nodeRgb})`;
      for (let level = 0; level < NODE_LEVELS; level++) {
        const bucket = nodeBuckets[level];
        if (bucket.length === 0) continue;
        ctx.globalAlpha = (level + 1) / NODE_LEVELS * 0.75;
        ctx.beginPath();
        for (const i of bucket) {
          ctx.moveTo(screenX[i] + radii[i], screenY[i]);
          ctx.arc(screenX[i], screenY[i], radii[i], 0, Math.PI * 2);
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    function addLink(a, b) {
      const mx = (baseX[a] + baseX[b]) / 2;
      const my = (baseY[a] + baseY[b]) / 2;
      const strength = Math.max(ringEnvelope(mx, my), hoverEnvelope(mx, my));
      const level = Math.floor(strength * LINK_LEVELS);
      if (level <= 0) return;
      linkBuckets[Math.min(LINK_LEVELS - 1, level - 1)].push(a, b);
    }
    function frame(time) {
      frameId = requestAnimationFrame(frame);
      if (lastDraw === 0) {
        lastDraw = time;
        nextDue = time;
      }
      if (time < nextDue - 1) return;
      nextDue = Math.max(nextDue + minFrameMs, time);
      const dt = Math.min((time - lastDraw) / 1e3, 0.1);
      lastDraw = time;
      elapsed += dt;
      if (targetDpr() !== dpr) rebuild();
      const follow = 1 - Math.exp(-dt * 10);
      pointerX += (targetX - pointerX) * follow;
      pointerY += (targetY - pointerY) * follow;
      presence += ((pointerActive ? 1 : 0) - presence) * (1 - Math.exp(-dt * 3));
      draw(now());
    }
    function start() {
      if (frameId !== 0 || reducedMotion || still) return;
      lastDraw = 0;
      frameId = requestAnimationFrame(frame);
    }
    function stop() {
      cancelAnimationFrame(frameId);
      frameId = 0;
    }
    function addWave(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      if (x < 0 || y < 0 || x > width || y > height) return;
      if (waves.length >= maxWaves) waves.shift();
      waves.push({ x, y, bornAt: now(), strength: 1 });
    }
    function onPointerDown(event) {
      tapStart = null;
      if (paused) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (!canWave(event)) return;
      if (event.pointerType === "touch" || event.pointerType === "pen") {
        tapStart = { id: event.pointerId, x: event.clientX, y: event.clientY, t: performance.now() };
        return;
      }
      addWave(event.clientX, event.clientY);
    }
    function onPointerUp(event) {
      if (!tapStart || tapStart.id !== event.pointerId) return;
      const s = tapStart;
      tapStart = null;
      if (paused) return;
      if (Math.hypot(event.clientX - s.x, event.clientY - s.y) > tapSlop || performance.now() - s.t > tapMs) return;
      addWave(event.clientX, event.clientY);
    }
    function onPointerCancel() {
      tapStart = null;
    }
    function onPointerMove(event) {
      if (event.pointerType === "touch") return;
      const rect = canvas.getBoundingClientRect();
      targetX = event.clientX - rect.left;
      targetY = event.clientY - rect.top;
      if (!pointerActive && presence < 0.01) {
        pointerX = targetX;
        pointerY = targetY;
      }
      pointerActive = true;
      pointerMoved = true;
    }
    function onPointerOut(event) {
      if (event.relatedTarget === null) pointerActive = false;
    }
    function onBlur() {
      pointerActive = false;
    }
    function onVisibility() {
      if (document.hidden) stop();
      else if (!paused) start();
    }
    const resizeObserver = new ResizeObserver(() => {
      rebuild();
      if (reducedMotion || still) draw(startTime);
    });
    resizeObserver.observe(canvas);
    rebuild();
    if (initialWave && !reducedMotion) {
      const age = initialWave.age;
      waves.push({
        x: initialWave.x * width,
        y: initialWave.y * height,
        bornAt: startTime - (age !== void 0 && Number.isFinite(age) && age >= 0 ? age : 0.8),
        strength: 1
      });
    }
    const interactive = !reducedMotion && !still;
    if (!interactive) {
      draw(startTime);
    } else {
      window.addEventListener("pointerdown", onPointerDown, { passive: true });
      window.addEventListener("pointerup", onPointerUp, { passive: true });
      window.addEventListener("pointercancel", onPointerCancel, { passive: true });
      window.addEventListener("pointermove", onPointerMove, { passive: true });
      document.addEventListener("pointerout", onPointerOut, { passive: true });
      window.addEventListener("blur", onBlur);
      document.addEventListener("visibilitychange", onVisibility);
      if (!document.hidden) start();
    }
    return {
      // Home fork: pause the loop while a dialog is open; the lattice keeps its last frame (DD-212).
      setPaused(value) {
        paused = !!value;
        if (!interactive) return;
        if (paused) stop();
        else if (!document.hidden) start();
      },
      isPaused() {
        return paused;
      },
      isRunning() {
        return frameId !== 0;
      },
      waveCount() {
        return waves.length;
      },
      destroy() {
        stop();
        resizeObserver.disconnect();
        if (interactive) {
          window.removeEventListener("pointerup", onPointerUp);
          window.removeEventListener("pointercancel", onPointerCancel);
          window.removeEventListener("pointerdown", onPointerDown);
          window.removeEventListener("pointermove", onPointerMove);
          document.removeEventListener("pointerout", onPointerOut);
          window.removeEventListener("blur", onBlur);
          document.removeEventListener("visibilitychange", onVisibility);
        }
      }
    };
  }
  return __toCommonJS(nexusNetwork_exports);
})();
