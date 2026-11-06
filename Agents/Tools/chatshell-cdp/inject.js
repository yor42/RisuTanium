(() => {
  if (window.__h && window.__h.stop) window.__h.stop();
  const t = document.querySelector('[data-part=chat-transcript]');
  const hdr = document.querySelector('[data-part=chat-header]');
  const host = document.querySelector('[data-part=chat-header-host]');
  const comp = document.querySelector('[data-part=chat-composer]');
  const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
  const Hh = { log: [], raw: [], frames: [], t0: performance.now(), on: true, anchorEl: null, targetEl: null, rec: false };
  const r1 = (v) => Math.round(v * 10) / 10;
  const now = () => r1(performance.now() - Hh.t0);
  const L = (k, ...a) => { if (Hh.on) Hh.log.push([now(), k, ...a]); };
  const top = () => desc.get.call(t);
  Object.defineProperty(t, 'scrollTop', {
    configurable: true,
    get() { return desc.get.call(this); },
    set(v) {
      const before = desc.get.call(this);
      const st = (new Error().stack || '').split('\n').slice(2, 5).map(s => s.trim().replace(/^at /, '').replace(/https?:\/\/[^/]+\//, '').slice(0, 70)).join(' < ');
      desc.set.call(this, v);
      L('JSW', 'val=' + Math.round(v), 'before=' + Math.round(before), 'after=' + Math.round(desc.get.call(this)), st);
    }
  });
  const onScroll = () => L('SCR', 'top=' + r1(top()), 'h=' + t.scrollHeight, 'c=' + t.clientHeight, 'hdrHidden=' + (hdr.hasAttribute('data-hidden') ? 1 : 0));
  t.addEventListener('scroll', onScroll, true);
  const mo = new MutationObserver(() => L('HDR', 'data-hidden=' + (hdr.hasAttribute('data-hidden') ? 'set' : 'cleared'), 'top=' + r1(top())));
  mo.observe(hdr, { attributes: true, attributeFilter: ['data-hidden'] });
  const msgs = () => [...t.querySelectorAll('[data-part=chat-message]')];
  const idxOf = (e) => Number(e.dataset.chatIndex);
  const byIdx = (i) => msgs().find(m => idxOf(m) === i) || null;
  // Raw input recorder (T-A1): every input/scroll event the page receives, with its final defaultPrevented.
  const RAW = ['touchstart', 'touchmove', 'touchend', 'touchcancel', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel', 'keydown', 'keyup', 'click', 'contextmenu'];
  const tgt = (e) => { const n = e.target; if (!n || !n.tagName) return ''; const p = n.closest && n.closest('[data-part]'); return n.tagName.toLowerCase() + (p ? '@' + p.dataset.part : ''); };
  const rawH = (e) => {
    if (!Hh.rec) return;
    const o = { t: r1(performance.now() - Hh.t0), ts: r1(e.timeStamp), type: e.type, trusted: e.isTrusted, cancelable: e.cancelable, dp: false, target: tgt(e) };
    if (e.pointerType !== undefined) { o.pointerType = e.pointerType; o.pointerId = e.pointerId; o.x = r1(e.clientX); o.y = r1(e.clientY); o.buttons = e.buttons; o.isPrimary = e.isPrimary; }
    if (e.type.startsWith('touch')) { const p = (e.changedTouches && e.changedTouches[0]) || {}; o.x = r1(p.clientX); o.y = r1(p.clientY); o.touches = e.touches.length; o.changed = e.changedTouches.length; o.id = p.identifier; }
    if (e.type === 'wheel') { o.x = r1(e.clientX); o.y = r1(e.clientY); o.dx = e.deltaX; o.dy = e.deltaY; o.dm = e.deltaMode; o.ctrl = e.ctrlKey; o.shift = e.shiftKey; }
    if (e.type.startsWith('key')) { o.key = e.key; o.code = e.code; o.ctrl = e.ctrlKey; o.shift = e.shiftKey; o.alt = e.altKey; }
    if (e.type === 'click') { o.x = r1(e.clientX); o.y = r1(e.clientY); }
    Hh.raw.push(o);
    setTimeout(() => { o.dp = e.defaultPrevented; }, 0);
  };
  RAW.forEach(k => window.addEventListener(k, rawH, { capture: true, passive: true }));
  const scrRaw = () => { if (Hh.rec) Hh.raw.push({ t: r1(performance.now() - Hh.t0), type: 'scroll', top: r1(top()), h: t.scrollHeight, c: t.clientHeight }); };
  t.addEventListener('scroll', scrRaw, { capture: true, passive: true });
  let raf = 0;
  const tick = () => {
    const ms = msgs();
    if (Hh.on && ms.length) {
      const ids = ms.map(idxOf);
      const tr = t.getBoundingClientRect(), hh = host.getBoundingClientRect(), hr = hdr.getBoundingClientRect(), cr = comp.getBoundingClientRect();
      const newest = ms.reduce((a, m) => idxOf(m) > idxOf(a) ? m : a);
      const f = {
        t: now(), st: r1(top()), max: t.scrollHeight - t.clientHeight, hdrHidden: hdr.hasAttribute('data-hidden') ? 1 : 0,
        hostTop: r1(hh.top), hostH: r1(hh.height), hdrTop: r1(hr.top), trTop: r1(tr.top), trH: r1(tr.height), compTop: r1(cr.top),
        n: ms.length, first: Math.min(...ids), last: Math.max(...ids), newestBottom: r1(newest.getBoundingClientRect().bottom),
        anchor: Hh.anchorEl && Hh.anchorEl.isConnected ? r1(Hh.anchorEl.getBoundingClientRect().top) : null,
        target: Hh.targetIdx != null && byIdx(Hh.targetIdx) ? r1(byIdx(Hh.targetIdx).getBoundingClientRect().top) : null
      };
      Hh.frames.push(f);
      setTimeout(() => { const te = Hh.targetIdx != null && byIdx(Hh.targetIdx) ? r1(byIdx(Hh.targetIdx).getBoundingClientRect().top) : null; f.te = te; f.ste = r1(top()); }, 0);
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  Hh.stop = () => { Hh.on = false; cancelAnimationFrame(raf); mo.disconnect(); t.removeEventListener('scroll', onScroll, true); t.removeEventListener('scroll', scrRaw, true); RAW.forEach(k => window.removeEventListener(k, rawH, true)); delete t.scrollTop; };
  Hh.reset = () => { Hh.log.length = 0; Hh.raw.length = 0; Hh.frames.length = 0; Hh.t0 = performance.now(); };
  Hh.firstVisible = () => { const tr = t.getBoundingClientRect(); const m = msgs().filter(x => x.getBoundingClientRect().bottom > tr.top + 20).sort((a, b) => idxOf(a) - idxOf(b))[0]; return m ? idxOf(m) : null; };
  Hh.setAnchor = (i) => { Hh.anchorEl = byIdx(i); return !!Hh.anchorEl; };
  Hh.setTarget = (i) => { Hh.targetIdx = i; return !!byIdx(i); };
  Hh.hitProbe = (x, y, ms) => new Promise(res => { const out = [], t1 = performance.now(); const f = () => { const e = document.elementFromPoint(x, y); const p = e && e.closest('[data-part]'); out.push([r1(performance.now() - t1), (e && e.closest('[data-part=chat-header]') ? 'header' : e && e.closest('[data-part=chat-transcript]') ? 'transcript' : (p ? p.dataset.part : 'other')), hdr.hasAttribute('data-hidden') ? 1 : 0]); if (performance.now() - t1 < ms) requestAnimationFrame(f); else res(out); }; f(); });
  Hh.rowTop = (i) => { const e = byIdx(i); return e ? e.getBoundingClientRect().top : null; };
  Hh.altBtn = (i, label) => { const e = byIdx(i); const b = e && e.querySelector('[data-part=chat-message-alts] button[aria-label="' + label + '"]'); if (!b) return null; const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; };
  Hh.altLabel = (i) => { const e = byIdx(i); const a = e && e.querySelector('[data-part=chat-message-alts]'); return a ? a.getAttribute('aria-label') : null; };
  Hh.newestIdx = () => Math.max(...msgs().map(idxOf));
  Hh.body = (i) => { const e = byIdx(i); const b = e && e.querySelector('[data-part=chat-message-body]'); if (!b) return null; const r = b.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; };
  Hh.metrics = () => [r1(top()), t.scrollHeight, t.clientHeight, hdr.hasAttribute('data-hidden') ? 1 : 0, msgs().length];
  window.__h = Hh;
  return 'ok';
})()
