/* Studio slice 3 mockup: the long-text editor (SLICE3_SPEC.md rev 1). Synthetic; not proof of native behaviour or performance.
   Part 1 (this file): field (textarea + mirror overlay), writes, CBS problems, token chip, {{ autocomplete, macro sheet, sandbox preview, form integration, keys.
   Part 2: lte-focus.js (focus mode, find/replace). Part 3: lte-lists.js (alternate first messages, example messages). Part 4: lte-states.js (?state=lt-... and the test hook window.__st3).
   Plugs into slice1.js through window.__st1.ext (afterForm, cbsRender, cbsRun, problems, gotoPos, renderForm) and window.__st1.api; slice1.html and slice2.html never load these files. */
(function () {
  'use strict';
  const ST = window.__st1, A = ST.api, S = A.S, C = window.LTCore, DD = window.StudioData3;
  { const t0 = A.t; A.t = (k, p) => { if (p && p.n === 1 && document.documentElement.lang === 'en') { const r = t0(k + '1', p); if (r !== k + '1') return r; } return t0(k, p); }; }   // English singular ("1 line"): a key named <key>1 is used when n is 1
  const { t, nm, ic, esc, $, $$, announce } = A;
  const Q = new URLSearchParams(location.search);
  const PAUSE = 50;            // write + re-colour pause after the last key (short on purpose: counted by the check harness's timer wrapper)
  const TOK_PAUSE = 500;       // token count pause (spec section 7)
  const BIG = 20000;           // above this only the lines around the view are coloured
  const LT = window.LTX = {
    fields: new Map(), byTa: new WeakMap(), seq: 0, timers: new Set(), tok: { mode: ['exact', 'offline', 'online'].indexOf(Q.get('tok')) >= 0 ? Q.get('tok') : 'exact', model: 'GPT-4o' },
    caps: {}, budget: 150, sb: { user: '', char: '', vars: {}, raw: false, target: null, out: null }, ac: { open: false, F: null, items: [], idx: 0, el: null, ctx: null, chosen: false }, view: { alts: 'list', ex: 'list' },
    PAUSE, TOK_PAUSE, BIG, mem: []
  };
  /* DD-200 (THEMING.md rule 2, DD-144): state a pack may style is mirrored as data-* on the element that changes. Classes and aria stay; one observer on #studio keeps the mirrors in step and LT.sync / LT.syncAll set them when markup is built.
     field: data-collapsed, data-capped, data-focused, data-dirty, data-composing, data-nohl, data-focus-mode (the field inside focus mode); card: data-open (its field is expanded), data-opening, data-dragging, data-drop=before|after; popup: data-variant=popup|strip; focus mode: data-open; preview output: data-raw; buttons and options of the studio-lt-* parts: data-pressed, data-selected, data-expanded from the aria attribute. */
  const MIRROR_ARIA = [['aria-pressed', 'data-pressed'], ['aria-selected', 'data-selected'], ['aria-expanded', 'data-expanded']];
  const MIRROR_CLASS = { 'lt-collapsed': 'data-collapsed', 'lt-capped': 'data-capped', 'lt-focused': 'data-focused', 'lt-dirty': 'data-dirty', 'lt-composing': 'data-composing', 'lt-nohl': 'data-nohl', 'lt-fillw': 'data-focus-mode' };
  function ltSync(el) {
    if (!el || el.nodeType !== 1) return; const cl = el.classList, part = el.getAttribute('data-part') || '';
    if (part.indexOf('studio-lt-') === 0) MIRROR_ARIA.forEach(([a, d]) => { if (el.hasAttribute(a)) el.toggleAttribute(d, el.getAttribute(a) === 'true'); });
    if (cl.contains('lt')) { Object.keys(MIRROR_CLASS).forEach((c) => el.toggleAttribute(MIRROR_CLASS[c], cl.contains(c))); const card = el.closest('.lt-card'); if (card) card.toggleAttribute('data-open', !cl.contains('lt-collapsed')); }
    else if (cl.contains('lt-card')) { el.toggleAttribute('data-opening', cl.contains('opening')); el.toggleAttribute('data-dragging', cl.contains('dragging')); if (cl.contains('drop-before')) el.setAttribute('data-drop', 'before'); else if (cl.contains('drop-after')) el.setAttribute('data-drop', 'after'); else el.removeAttribute('data-drop'); }
    else if (cl.contains('lt-ac')) el.setAttribute('data-variant', cl.contains('strip') ? 'strip' : 'popup');
    else if (cl.contains('lt-focus')) el.toggleAttribute('data-open', cl.contains('open'));
    else if (cl.contains('sb-out')) el.toggleAttribute('data-raw', cl.contains('raw'));
  }
  LT.sync = ltSync; LT.syncAll = (root) => { if (!root) return; ltSync(root); root.querySelectorAll('[data-part^="studio-lt-"], .lt, .lt-card').forEach(ltSync); };
  if ($('#studio') && typeof MutationObserver !== 'undefined') new MutationObserver((rs) => rs.forEach((r) => ltSync(r.target))).observe($('#studio'), { attributes: true, subtree: true, attributeFilter: ['class', 'aria-pressed', 'aria-selected', 'aria-expanded'] });
  try { LT.caps = JSON.parse(localStorage.getItem('st3:caps') || '{}') || {}; } catch (_) { LT.caps = {}; }   // remembered on the device (DD-099); a blocked or full store just forgets
  if (Q.get('state')) { try { localStorage.removeItem('st3:caps'); } catch (_) {} LT.caps = {}; }
  const saveCaps = () => { try { localStorage.setItem('st3:caps', JSON.stringify(LT.caps)); } catch (_) {} };
  const fmtN = (n) => Number(n).toLocaleString(S.lang === 'ko' ? 'ko-KR' : 'en-US');
  const later = (fn, ms, fast) => { const h = { id: 0, ms, fast: !!fast }; h.id = setTimeout(() => { LT.timers.delete(h); fn(); }, ms); LT.timers.add(h); return h; };
  const cancel = (h) => { if (h) { clearTimeout(h.id); LT.timers.delete(h); } };
  LT.later = later; LT.cancel = cancel; LT.pend = () => LT.timers.size; LT.pendFast = () => [...LT.timers].filter((h) => h.fast || h.ms <= 100).length; LT.countN = 0; LT.fmtN = fmtN;
  C.setMacros(DD.MACROS.filter((m) => m.n !== '//' && m.n !== ':else'));

  /* ---------------------------------------------------------------- which fields use the editor */
  const FIELD_MODE = { basic: { description: 'cbs', first: 'html+cbs', system: 'cbs', bghtml: 'html+cbs', defvars: 'plain', tnote: 'plain' }, lore: { content: 'lore' }, regex: { replace: 'cbs' }, display: { body: 'cbs' }, advanced: { body: 'cbs' }, html: { body: 'html+cbs' } };
  const LABEL_KEY = { description: 'fDesc', first: 'fFirst', system: 'fSystem', bghtml: 'fBgHtml', defvars: 'fDefVars', tnote: 'fTNote' };
  LT.FIELD_MODE = FIELD_MODE;
  const probMemo = [];
  function probsFor(text, mode) {
    for (let i = 0; i < probMemo.length; i++) { const e = probMemo[i]; if (e.mode === mode && e.text === text) return e.an; }
    const an = C.analyze(text, { lore: mode === 'lore', html: mode === 'html+cbs', slotOK: false }); probMemo.unshift({ mode, text, an }); if (probMemo.length > 10) probMemo.pop(); return an;
  }
  LT.probsFor = probsFor;
  const sevIc = { error: 'circle-alert', warning: 'triangle-alert', info: 'info' };
  function probMsg(p) {
    if (p.code === 'unbalanced') return t('cbsUnbalanced');
    if (p.code === 'unclosed') return t('cbsUnclosed', { block: '{{#' + p.block + '}}' });
    if (p.code === 'unopened') return t('cbsUnopened', { block: '{{#' + p.block + '}}' });
    if (p.code === 'unknown') return t('cbsUnknown') + ' · ' + p.name;
    if (p.code === 'deprecated') return t(p.to ? 'cbsDeprecated' : 'cbsDepNoFix') + ' · ' + p.from;
    if (p.code === 'slot') return t('cbsSlot');
    if (p.code === 'strayclose') return t('cbsStray');
    return p.code;
  }
  LT.probMsg = probMsg;

  /* ---------------------------------------------------------------- sandbox values (DD-121): never written back */
  function defVars() { const o = {}; try { const b = A.ctxChar().items.find((i) => i.f && typeof i.f.defvars === 'string'); String((b && b.f.defvars) || '').split('\n').forEach((l) => { const k = l.indexOf('='); if (k > 0) o[l.slice(0, k).trim()] = l.slice(k + 1).trim(); }); } catch (_) {} return o; }
  function sbVals() {
    const sb = LT.sb, vars = Object.assign({}, defVars(), sb.vars);
    const glob = {}; Object.keys(S.tv || {}).forEach((k) => { glob['toggle_' + k] = S.tv[k] ? '1' : '0'; });   // toggles are global chat variables, a second table beside the chat variables
    return { glob, user: sb.user || (S.lang === 'ko' ? '나' : 'me'), char: sb.char || nm(A.ctxChar().name), vars, fields: sbFields() };
  }
  /* what {{description}}, {{lastmessage}} ... expand to in the sandbox: the character's own description and invented sample lines (a count that said one token for them would be wrong) */
  function sbFields() {
    const ko = S.lang === 'ko'; let desc = ''; try { const b = A.ctxChar().items.find((i) => i.kind === 'basic'); desc = String((b && b.f.description) || ''); } catch (_) {}
    return { description: desc, personality: ko ? '차분하고 믿음직하며 말수가 적다.' : 'Calm, dependable and sparing with words.', scenario: ko ? '숲길 어귀에서 길 잃은 나그네를 만난다.' : 'Meets a lost traveller at the forest gate.', persona: ko ? '길을 잃은 약사. 짐이 많다.' : 'A lost apothecary with a heavy pack.',
      lastmessage: ko ? '등불이 꺼지면 어떻게 되나요?' : 'What happens if the lantern goes out?', lastusermessage: ko ? '등불이 꺼지면 어떻게 되나요?' : 'What happens if the lantern goes out?', previoususerchat: ko ? '길이 많이 남았나요?' : 'Is it far?', lastcharmessage: ko ? '곁에 계시면 길이 사라지지 않아요.' : 'Stay close and the path will not vanish.', previouscharchat: ko ? '어서 오세요. 오늘 밤은 길어질 거예요.' : 'Welcome. It will be a long night.' };
  }
  LT.sbVals = sbVals;
  const filled = (text) => C.evalCbs(text, sbVals());

  /* ---------------------------------------------------------------- field */
  const btn = (act, icon, label, cls) => '<button type="button" class="btn sm ' + (cls || '') + '" data-part="studio-lt-tool" data-lt-act="' + act + '" aria-label="' + esc(label) + '" title="' + esc(label) + '">' + ic(icon, 18) + '</button>';
  function mountField(ta, o) {
    const F = { n: ++LT.seq, ta, o, key: o.key || (o.itemId + ':' + o.field), mode: o.mode || 'cbs', composing: false, dirty: false, focused: false, hlOff: false, hlWhy: '', slow: 0, text: '', tok: null, probs: [], an: null, win: null, limited: false, marks: null, emKey: -1, label: o.label || '' };
    F.flags = { cbs: F.mode !== 'plain', html: F.mode === 'html+cbs', lore: F.mode === 'lore', ex: F.mode === 'ex' };
    const old = LT.fields.get(F.key); if (old && old !== F) unmount(old);
    const wrap = document.createElement('div'); wrap.className = 'lt' + (o.collapsed ? ' lt-collapsed' : ''); wrap.dataset.ltKey = F.key; wrap.dataset.mode = F.mode; wrap.setAttribute('data-part', 'studio-lt-field');
    const stage = document.createElement('div'); stage.className = 'lt-stage'; stage.setAttribute('data-part', 'studio-lt-stage');
    const mir = document.createElement('pre'); mir.className = 'lt-mirror lt-text'; mir.setAttribute('aria-hidden', 'true'); mir.setAttribute('data-part', 'studio-lt-mirror');
    const fld = ta.closest('.fld'); let lab = fld && fld.querySelector('label[for="' + ta.id + '"]');
    ta.parentNode.insertBefore(wrap, ta);
    if (!o.noHead) {
      const head = document.createElement('div'); head.className = 'lt-head'; head.setAttribute('data-part', 'studio-lt-head'); wrap.appendChild(head); F.head = head;
      if (lab) head.appendChild(lab); else if (F.label) { const l = document.createElement('span'); l.className = 'lt-lab'; l.setAttribute('data-part', 'studio-lt-label'); l.textContent = F.label; head.appendChild(l); }
      if (lab) F.label = lab.textContent;
      const sp = document.createElement('span'); sp.className = 'lt-sp'; head.appendChild(sp);
      if (F.flags.cbs && !o.noChip) { const w = document.createElement('span'); w.className = 'lt-tokw'; F.chipHost = w; head.appendChild(w); }
      const tools = document.createElement('span'); tools.className = 'lt-tools'; tools.setAttribute('data-part', 'studio-lt-tools');
      tools.innerHTML = (F.flags.cbs ? btn('macro', 'braces', t('ltInsertMacro')) + btn('preview', 'eye', t('ltPreview')) : '') + btn('find', 'search', t('ltFind')) + btn('focus', 'maximize-2', t('ltFocus'));
      head.appendChild(tools);
    } else if (o.chipHost) F.chipHost = o.chipHost;
    stage.append(mir, ta); wrap.appendChild(stage);
    const probsEl = document.createElement('div'); probsEl.className = 'lt-probs'; probsEl.setAttribute('data-part', 'studio-lt-problems'); probsEl.hidden = true; wrap.appendChild(probsEl);
    const note = document.createElement('p'); note.className = 'lt-note'; note.setAttribute('data-part', 'studio-lt-note'); note.hidden = true; note.setAttribute('role', 'status'); wrap.appendChild(note);
    const desc = document.createElement('span'); desc.className = 'sr-only'; desc.id = 'ltd-' + F.n; wrap.appendChild(desc);
    Object.assign(F, { wrap, stage, mir, probsEl, note, desc });
    ta.classList.add('lt-in', 'lt-text'); ta.setAttribute('data-part', 'studio-lt-text'); ta.setAttribute('dir', 'auto'); ta.removeAttribute('rows'); ta.setAttribute('aria-describedby', desc.id + (ta.getAttribute('aria-describedby') ? ' ' + ta.getAttribute('aria-describedby').replace(/ltd-\d+\s*/g, '') : ''));
    if (!lab && F.label) ta.setAttribute('aria-label', F.label);
    if (F.flags.cbs) { ta.setAttribute('aria-haspopup', 'listbox'); ta.setAttribute('aria-autocomplete', 'list'); ta.setAttribute('aria-expanded', 'false'); }
    if (o.value != null) ta.value = o.value;
    if (!o.noGrip) {
      const g = document.createElement('div'); g.className = 'lt-capgrip'; g.setAttribute('data-part', 'studio-lt-cap-grip'); g.setAttribute('role', 'separator'); g.setAttribute('aria-orientation', 'horizontal'); g.tabIndex = 0; g.setAttribute('aria-label', t('ltCapGrip')); g.innerHTML = ic('grip-horizontal', 16); stage.appendChild(g); F.grip = g;
    }
    LT.fields.set(F.key, F); LT.byTa.set(ta, F); wire(F);
    if (typeof ResizeObserver !== 'undefined') { F.ro = new ResizeObserver(() => { if (F.ta.isConnected && F.lastW !== F.stage.clientWidth) { F.lastW = F.stage.clientWidth; fit(F); if (F.limited) render(F); } }); F.ro.observe(stage); }
    if (F.flags.cbs && !o.noChip) { LT.io = LT.io || (typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver((es) => es.forEach((e) => { const f = e.target.__lt; if (e.isIntersecting && f && f.ta.isConnected && (!f.tok || f.tokStale) && !f.composing) tokSchedule(f, 0); })) : null); if (LT.io) { wrap.__lt = F; LT.io.observe(wrap); } }
    fit(F); render(F); drawChip(F); ltSync(wrap);
    return F;
  }
  function unmount(F) { if (F.dirty) flush(F); cancel(F.pendT); cancel(F.tokT); cancel(F.scrT); if (F.ro) F.ro.disconnect(); if (LT.io && F.wrap) LT.io.unobserve(F.wrap); if (LT.fields.get(F.key) === F) LT.fields.delete(F.key); }
  const staleSweep = () => { LT.fields.forEach((F) => { if (!F.ta.isConnected && !F.o.keep) unmount(F); }); };

  /* the textarea resolves dir=auto itself; its twins get the same answer from the first strong character (dir=auto on a twin makes every DOM insertion re-scan its subtree: 200 ms for 9 000 nodes) */
  const RTL1 = /[֐-ࣿיִ-﷿ﹰ-﻿]/, LTR1 = /[A-Za-zÀ-ʯͰ-֏ऀ-﬜︀-﹯Ａ-ｚ]/;
  function autoDir(text) { for (let i = 0, n = Math.min(text.length, 4000); i < n; i++) { const ch = text[i]; if (RTL1.test(ch)) return 'rtl'; if (LTR1.test(ch)) return 'ltr'; } return 'ltr'; }
  LT.autoDir = autoDir;
  const lineHeightOf = (ta) => parseFloat(getComputedStyle(ta).lineHeight) || 24;
  function capPx(F) {
    const ta = F.ta, lh = lineHeightOf(ta), pv = (parseFloat(getComputedStyle(ta).paddingTop) || 0) * 2 + 2;
    if (F.o.fill) return 1e6;
    if (F.o.collapsed && !F.focused && !F.expanded) return Math.round(lh * 4 + pv);
    const base = Math.round((S.layout === 'phone' ? 0.6 : 0.7) * innerHeight), c = LT.caps[F.key];
    return c ? Math.max(Math.round(lh * 3 + pv), c) : base;
  }
  function fit(F) {
    const ta = F.ta; if (!ta.isConnected || F.o.fill) return;
    const lh = lineHeightOf(ta), pv = (parseFloat(getComputedStyle(ta).paddingTop) || 0) * 2 + 2, minH = Math.round(lh * 3 + pv);
    ta.style.height = 'auto'; const sh = ta.scrollHeight, cap = capPx(F), h = Math.max(minH, Math.min(sh, cap));
    ta.style.height = h + 'px'; ta.style.overflowY = sh > cap + 1 ? 'auto' : 'hidden'; F.capped = sh > cap + 1; F.wrap.classList.toggle('lt-capped', F.capped);
    if (F.grip) { F.grip.setAttribute('aria-valuenow', String(h)); }
    F.mir.scrollTop = ta.scrollTop;
  }
  function setHl(F, on) { F.wrap.classList.toggle('lt-nohl', !on); if (!on) { F.mir.textContent = ''; F.mirSrc = null; } }
  /* while typing the overlay stays visible: the edit is applied to it in place (typed characters take the colour of their neighbour until the next paint), so colours do not blink off at every key. Windowed (long) text keeps the old rule: overlay hidden until the pause. */
  function patchMirror(F, newT) {
    const old = F.mirSrc; if (old == null || F.limited || F.wrap.classList.contains('lt-nohl') || newT.length > BIG) return false; if (old === newT) return true;
    let a = 0; const m = Math.min(old.length, newT.length); while (a < m && old.charCodeAt(a) === newT.charCodeAt(a)) a++;
    let b = 0; while (b < m - a && old.charCodeAt(old.length - 1 - b) === newT.charCodeAt(newT.length - 1 - b)) b++;
    const del = old.length - a - b, add = newT.slice(a, newT.length - b), w = document.createTreeWalker(F.mir, NodeFilter.SHOW_TEXT);
    const locate = (idx, prev) => { w.currentNode = F.mir; let pos = 0, node, last = null; while ((node = w.nextNode())) { const len = node.nodeValue.length; last = node; if (prev ? (idx > pos && idx <= pos + len) : (idx >= pos && idx < pos + len)) return { node, off: idx - pos }; pos += len; } return last && idx === pos ? { node: last, off: last.nodeValue.length } : null; };
    const st = locate(a, del === 0 && a > 0); if (!st) return false; let en = st; if (del > 0) { en = locate(a + del, true); if (!en) return false; }
    try { if (del === 0) st.node.insertData(st.off, add); else if (st.node === en.node) st.node.replaceData(st.off, del, add); else { const r = document.createRange(); r.setStart(st.node, st.off); r.setEnd(en.node, en.off); r.deleteContents(); st.node.insertData(Math.min(st.off, st.node.nodeValue.length), add); } } catch (_) { return false; }
    F.mirSrc = newT; F.mir.scrollTop = F.ta.scrollTop; return true;
  }
  function hlOff(F, why) { F.hlOff = true; F.hlWhy = why; setHl(F, false); F.limited = false; drawNote(F); }
  function drawNote(F) {
    const n = F.note; let k = '';
    if (F.hlOff) k = F.hlWhy === 'budget' ? 'ltHlOffBudget' : 'ltHlOff'; else if (F.limited) k = 'ltHlLimited';
    n.hidden = !k; n.textContent = k ? t(k) : ''; n.dataset.k = k;
  }
  function drawDesc(F) {
    if (!F.desc) return; const coarse = matchMedia('(pointer: coarse)').matches, bits = []; if (F.flags.cbs) bits.push(t(coarse ? 'ltFldHintTouch' : 'ltFldHint')); else if (!coarse) bits.push(t('ltFldHintPlain'));   // no keyboard shortcut is read out to touch users if (F.chipHost && F.tok) bits.push(chipText(F)); if (F.probs && F.probs.length) bits.push(t('problemsN', { n: F.probs.length }));
    F.desc.textContent = bits.join(' · ');
  }
  function visRange(F) {
    const text = F.ta.value, n = text.length; let probe = F.probe;
    if (!probe) { probe = F.probe = document.createElement('pre'); probe.className = 'lt-probe lt-text'; probe.setAttribute('aria-hidden', 'true'); F.stage.insertBefore(probe, F.mir); }
    if (F.probeText !== text) { probe.dir = autoDir(text); probe.textContent = text; F.probeText = text; }
    probe.scrollTop = F.ta.scrollTop; const node = probe.firstChild;
    if (!node) return { top: 0, bot: 0, a: 0, b: Math.min(n, 12000) };
    const pr = probe.getBoundingClientRect(), rg = document.createRange();
    const yAt = (i) => { rg.setStart(node, i); rg.setEnd(node, Math.min(n, i + 1)); const r = rg.getClientRects(); return r.length ? r[0].top : null; };
    const find = (y) => { let lo = 0, hi = n - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1, v = yAt(mid); if (v === null || v <= y) lo = mid; else hi = mid - 1; } return lo; };
    const top = find(pr.top), bot = find(pr.bottom);
    return { top, bot, a: C.snapLine(text, Math.max(0, top - 3000), -1), b: C.snapLine(text, Math.min(n, bot + 3000), 1) };
  }
  function render(F, opt) {
    opt = opt || {}; const ta = F.ta, text = ta.value; F.text = text; F.renders = (F.renders || 0) + 1;
    if (!F.flags.cbs) { setHl(F, false); drawDesc(F); return; }
    const n = text.length, an = probsFor(text, F.mode); F.an = an; F.probs = an.probs; if (F.focused && LT.ac.open && LT.ac.F === F && LT.ac.ctx) F.probs = F.probs.filter((p) => !(p.code === 'unbalanced' && p.which === 'open' && p.pos === LT.ac.ctx.start)); drawProbs(F);   // the {{ being typed is not an error yet
    if (F.hlOff && F.hlWhy === 'long' && !(S.lp && n > BIG)) F.hlOff = false;
    if (S.lp && n > BIG && !F.hlOff) { F.hlOff = true; F.hlWhy = 'long'; }
    const want = !F.hlOff && !(S.lp && !F.focused && !opt.force);
    if (!want) { setHl(F, false); F.limited = false; drawNote(F); drawDesc(F); return; }
    const t0 = performance.now(), o = { html: F.flags.html, lore: F.flags.lore, ex: F.flags.ex, marks: F.marks, charName: F.flags.ex ? nm(A.ctxChar().name) : null }; let html;
    const caret = F.focused && ta.selectionStart === ta.selectionEnd ? ta.selectionStart : null;
    if (n <= BIG) { o.caret = caret; html = C.paint(text, an, o); F.limited = false; F.win = null; F.emKey = emKeyOf(F, caret); }
    else { const w = visRange(F); o.caret = null; html = C.paintWindow(text, w.a, w.b, o); F.win = w; F.limited = true; }
    F.mir.dir = autoDir(text); F.mir.innerHTML = html + '\n'; setHl(F, true); F.mirSrc = text; F.mir.scrollTop = ta.scrollTop; F.wrap.classList.remove('lt-dirty');
    const dt = performance.now() - t0; if (dt > LT.budget) { if (++F.slow >= 2) hlOff(F, 'budget'); } else F.slow = 0;
    drawNote(F); drawDesc(F);
  }
  function emKeyOf(F, caret) { if (caret == null || !F.an) return -1; let best = -1, bs = 1e9; F.an.blocks.forEach((b, i) => { if (caret >= b.o1 && caret <= b.c2 + 2 && b.c2 - b.o1 < bs) { best = i; bs = b.c2 - b.o1; } }); return best; }
  LT.render = render; LT.fit = fit;

  /* ---------------------------------------------------------------- writes (direct edits of the owner history; typing coalesces into one step per pause as slice 2) */
  function formSet(F) {
    return (val, o) => {
      o = o || {}; const f = A.findItem(F.o.itemId); if (!f) return; const { it, o: ow } = f; const oldV = String(it.f[F.o.field] == null ? '' : it.f[F.o.field]); val = C.mergeEdit(oldV, val); if (oldV === val) return;   // an edit never rewrites the line endings of lines it did not reach
      const label = o.label || t('stepEdit', { kind: A.kindName(it.kind), name: nm(it.name) || A.kindName(it.kind) });
      A.edit(ow.id, label, () => { it.f[F.o.field] = val; }, o.label ? undefined : { key: it.id + '.' + F.o.field });
      A.renderHeader(); shellRefresh(o.defer);
    };
  }
  /* the shell's tree and Problems list are refreshed after the pause too (and later still on a slow device: the delay follows what the last refresh cost), so a key pressed meanwhile is served first */
  LT.secMs = 0;
  function runSecondary() { cancel(LT.secT); LT.secT = null; const t0 = performance.now(); A.renderTree(); A.refreshProblemsOnly(); LT.secMs = performance.now() - t0; }
  function shellRefresh(defer) { if (!defer) { runSecondary(); return; } cancel(LT.secT); LT.secT = later(runSecondary, Math.max(60, Math.round(LT.secMs * 3)), true); }
  LT.shellRefresh = shellRefresh; LT.runSecondary = runSecondary;
  const pauseFor = (F) => Math.min(450, Math.max(F.ta.value.length > BIG ? 250 : PAUSE, Math.round((F.lastMs || 0) * 2.5)));   // short on a fast device, longer for a 100 000-character field or a slow device
  /* flush: write, colour, count, now (blur, structural edits, tests). The pause timer calls stage() instead: the write first, the colouring in a later task, so typing is never behind the work */
  function flush(F, opts) {
    cancel(F.pendT); cancel(F.stageT); F.pendT = F.stageT = null; if (!F.dirty && !(opts && opts.force)) return false;
    const t0 = performance.now(); F.dirty = false; const val = F.ta.value; F.o.set(val, opts || {}); render(F); fit(F); afterWrite(F); F.lastMs = performance.now() - t0; return true;
  }
  function stage(F) {
    F.pendT = null; if (!F.dirty) return; const t0 = performance.now(); F.dirty = false; F.o.set(F.ta.value, { defer: true }); F.lastMs = performance.now() - t0;
    F.stageT = later(() => { F.stageT = null; const t1 = performance.now(); render(F); fit(F); afterWrite(F); F.lastMs += performance.now() - t1; }, 0, true);
  }
  function flushAll() { let n = 0; LT.fields.forEach((F) => { if ((F.dirty || F.stageT) && flush(F, F.stageT && !F.dirty ? { force: true } : null)) n++; }); if (LT.secT) runSecondary(); return n; }
  function afterWrite(F) { tokSchedule(F); sbMark(F); if (LT.onWrite) LT.onWrite(F); }
  LT.flush = flush; LT.flushAll = flushAll; LT.mountField = mountField; LT.formSet = formSet;

  function wire(F) {
    const ta = F.ta;
    ta.addEventListener('input', (e) => {
      e.stopPropagation();   // the shell's own field handler never sees long-text input: writes go through flush()
      if (e.isComposing || F.composing) { acUpdate(F, true); return; }    // nothing is written, drawn or counted mid-composition; the macro list may show and filter (read only)
      ta.dataset.it = e.inputType || ''; F.dirty = true; if (!patchMirror(F, ta.value)) F.wrap.classList.add('lt-dirty'); sbMark(F);
      if (ta.value.length < 5000 || ta.clientHeight < capPx(F)) fit(F);
      cancel(F.pendT); cancel(F.stageT); F.stageT = null; F.pendT = later(() => stage(F), pauseFor(F), true);
      acUpdate(F, !e.inputType || /^insert/.test(e.inputType)); tokSchedule(F);   // the list opens only from typing, never from moving the caret
    });
    ta.addEventListener('compositionstart', () => { F.composing = true; F.wrap.classList.add('lt-composing'); cancel(F.pendT); if (F.stageT) { cancel(F.stageT); F.stageT = null; F.dirty = true; } });
    ta.addEventListener('compositionend', () => { F.composing = false; F.wrap.classList.remove('lt-composing'); F.dirty = true; F.wrap.classList.add('lt-dirty'); cancel(F.pendT); F.pendT = later(() => stage(F), pauseFor(F), true); fit(F); acUpdate(F, true); });
    ta.addEventListener('focus', () => {
      F.focused = true; F.wrap.classList.add('lt-focused'); if (F.o.collapsed) { fit(F); F.wrap.classList.remove('lt-collapsed'); }
      if (F.flags.cbs) { LT.sb.target = F; if (F.o.card) { S.tf = { f: 'lt:' + F.key, label: F.label }; A.renderSide(); } if (S.lp) render(F, { force: true }); }
      if (F.o.onFocus) F.o.onFocus(F);
    });
    ta.addEventListener('blur', () => {
      F.focused = false; F.wrap.classList.remove('lt-focused'); if (!F.composing) flush(F); acClose();
      if (F.o.collapsed && !F.expanded) { F.wrap.classList.add('lt-collapsed'); fit(F); }
      if (S.lp) { render(F); if (F.chipHost && F.tok !== 'busy') countNow(F, true); }
      if (F.o.onBlur) F.o.onBlur(F);
    });
    ta.addEventListener('scroll', () => {
      F.mir.scrollTop = ta.scrollTop; if (F.probe) F.probe.scrollTop = ta.scrollTop;
      if (F.limited && !F.dirty && !F.pendT && !F.stageT && !F.composing) { cancel(F.scrT); F.scrT = later(() => { const vr = visRange(F); if (!F.win || vr.top < F.win.a + 200 || vr.bot > F.win.b - 200) render(F); }, 80); }
    });
    const heldCheck = () => { if (F.dirty && !F.pendT && !F.stageT && !F.composing && F.o.holds && !F.o.holds(F)) flush(F); };
    const caretMoved = () => { heldCheck();   /* a write held back while the caret sat on a typed start line (DD-128) goes out once the caret leaves it */
      if (F.flags.cbs && F.focused && !F.limited && F.an && F.an.blocks.length) { const k = emKeyOf(F, ta.selectionStart === ta.selectionEnd ? ta.selectionStart : null); if (k !== F.emKey) { cancel(F.emT); F.emT = later(() => render(F), 40); } } if (LT.ac.open && LT.ac.F === F) acUpdate(F, false); };
    ta.addEventListener('keyup', (e) => { heldCheck(); if (!F.composing && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') caretMoved(); });
    ta.addEventListener('click', caretMoved);
    if (F.o.onPaste) ta.addEventListener('paste', (e) => F.o.onPaste(e, F));
    if (F.grip) wireGrip(F);
    if (!F.o.set) F.o.set = formSet(F);
  }
  function wireGrip(F) {
    const g = F.grip; let d = null;
    const setCap = (px) => { LT.caps[F.key] = Math.max(80, Math.round(px)); saveCaps(); fit(F); };
    g.addEventListener('pointerdown', (e) => { if (e.button) return; d = { y: e.clientY, h: F.ta.clientHeight, id: e.pointerId }; try { g.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); });
    g.addEventListener('pointermove', (e) => { if (d && d.id === e.pointerId) { F.ta.style.height = Math.max(80, d.h + e.clientY - d.y) + 'px'; setCap(d.h + e.clientY - d.y); } });
    const end = (e) => { if (d && d.id === e.pointerId) d = null; }; g.addEventListener('pointerup', end); g.addEventListener('pointercancel', end);
    g.addEventListener('keydown', (e) => { const h = F.ta.clientHeight; if (e.key === 'ArrowDown') { e.preventDefault(); setCap(h + 32); } else if (e.key === 'ArrowUp') { e.preventDefault(); setCap(h - 32); } else if (e.key === 'Home') { e.preventDefault(); delete LT.caps[F.key]; saveCaps(); fit(F); } });
  }
  LT.setCap = (key, px) => { const F = LT.fields.get(key); if (!F) return; LT.caps[key] = px; saveCaps(); fit(F); };

  /* replace [s,e) with text through the browser's own editing command so native undo keeps working */
  function replaceRange(F, s, e, str, caretAt) {
    const ta = F.ta; ta.focus({ preventScroll: true }); ta.setSelectionRange(s, e); let ok = false;
    try { ok = document.execCommand('insertText', false, str); } catch (_) {}
    if (!ok || ta.value.slice(s, s + str.length) !== str) { ta.setRangeText(str, s, e, 'end'); ta.dispatchEvent(new Event('input', { bubbles: true })); }
    if (caretAt != null) ta.setSelectionRange(s + caretAt, s + caretAt);
  }
  LT.replaceRange = replaceRange;
  const BIGOP = 20000;
  function setRange(F, from, to, str, label) {
    const ta = F.ta, st = ta.scrollTop, a = ta.selectionStart, b = ta.selectionEnd, delta = str.length - (to - from), map = (x) => (x <= from ? x : x >= to ? x + delta : from + str.length);
    if (ta.value.length + delta >= BIGOP) { ta.value = ta.value.slice(0, from) + str + ta.value.slice(to); F.nativeUndoLost = true; }
    else { ta.focus({ preventScroll: true }); ta.setSelectionRange(from, to); let ok = false; try { ok = document.execCommand('insertText', false, str); } catch (_) {} if (!ok || ta.value.slice(from, from + str.length) !== str) ta.setRangeText(str, from, to, 'end'); }
    try { ta.setSelectionRange(map(a), map(b)); } catch (_) {} ta.scrollTop = st; F.dirty = true; flush(F, { label, force: true });
  }
  LT.setRange = setRange;
  function gotoPos(F, pos) {
    const ta = F.ta; ta.focus({ preventScroll: true }); ta.setSelectionRange(pos, pos);
    const m = measureCaret(F, pos); if (m) { if (ta.scrollHeight > ta.clientHeight + 2) ta.scrollTop = Math.max(0, m.offTop - ta.clientHeight / 2); ta.scrollIntoView({ block: 'nearest' }); const r = ta.getBoundingClientRect(); const y = r.top + m.offTop - ta.scrollTop; const main = $('#main'); if (main && (y < 80 || y > innerHeight - 100)) main.scrollTop += y - innerHeight / 3; }
    if (F.limited) render(F);
  }
  LT.gotoPos = gotoPos;
  ST.ext.gotoPos = (el, pos, card) => { const F = LT.byTa.get(el); if (F) { gotoPos(F, pos || 0); return; } if (el && el.dataset && el.dataset.ltList && LT.gotoCard) LT.gotoCard(el.dataset.ltList, card, pos); };

  /* caret position in viewport coordinates (a hidden twin of the textarea); long text falls back to the bottom edge of the field */
  function measureCaret(F, pos) {
    const ta = F.ta; if (!ta.isConnected) return null; const r = ta.getBoundingClientRect(), cs = getComputedStyle(ta), lh = lineHeightOf(ta);
    if (ta.value.length > BIG) return { x: r.left + 24, y: r.bottom - lh * 2, offTop: ta.scrollTop + ta.clientHeight - lh * 2, lh };
    let m = LT.measure; if (!m) { m = LT.measure = document.createElement('div'); m.className = 'lt-measure lt-text'; m.setAttribute('aria-hidden', 'true'); document.body.appendChild(m); }
    m.style.width = ta.clientWidth + 'px'; m.style.padding = cs.padding; m.style.fontSize = cs.fontSize; m.style.fontFamily = cs.fontFamily; m.style.lineHeight = cs.lineHeight; m.style.letterSpacing = cs.letterSpacing;
    m.dir = autoDir(ta.value); m.textContent = ta.value.slice(0, pos); const sp = document.createElement('span'); sp.textContent = '​'; m.appendChild(sp);
    return { x: r.left + ta.clientLeft + sp.offsetLeft - ta.scrollLeft, y: r.top + ta.clientTop + sp.offsetTop - ta.scrollTop, offTop: sp.offsetTop, lh };
  }
  LT.measureCaret = measureCaret;

  /* ---------------------------------------------------------------- problems under the field (underline is in the overlay; the Problems tab gets the same list through ext.problems) */
  function drawProbs(F) {
    const el = F.probsEl, ps = F.probs || []; el.hidden = !ps.length; if (!ps.length) { el.textContent = ''; return; }
    const show = ps.slice(0, 3);
    el.innerHTML = '<ul class="lt-plist" data-part="studio-lt-problem-list" aria-label="' + esc(t('ltProbs')) + '">' + show.map((p, i) => '<li class="lt-prob ' + p.sev + '" data-part="studio-lt-problem" data-severity="' + p.sev + '" data-i="' + i + '"><button type="button" class="lt-pgo" data-part="studio-lt-problem-go" data-lt-act="pgo" data-i="' + i + '">' + ic(sevIc[p.sev], 14) + '<span class="ln" data-part="studio-lt-problem-line">' + esc(t('ltLineN', { n: p.line })) + '</span><span class="m" data-part="studio-lt-problem-text">' + esc(probMsg(p)) + '</span></button>' + (p.to ? '<button type="button" class="btn sm lt-pfix" data-part="studio-lt-problem-fix" data-lt-act="pfix" data-i="' + i + '">' + ic('wand', 14) + '<span>' + esc(t('cbsDepFix', { to: p.to })) + '</span></button>' : '') + '</li>').join('') + '</ul>' + (ps.length > 3 ? '<p class="lt-pmore" data-part="studio-lt-problem-more">' + esc(t('ltProbMore', { n: ps.length - 3 })) + '</p>' : '');
  }
  function fixProblem(F, p) {
    flush(F); const cur = F.probs.find((x) => x.code === p.code && x.from === p.from && x.pos === p.pos) || F.probs.find((x) => x.code === 'deprecated' && x.to && x.from === p.from); if (!cur || !cur.to) return;
    replaceRange(F, cur.s, cur.e, cur.to, cur.to.length); flush(F, { label: t('ltStepFix', { what: cur.from + ' → ' + cur.to }), force: true }); announce(t('ltFixed'));
    F.ta.focus({ preventScroll: true });
  }
  /* the shell's Problems tab: line, message, jump (ST.ext.gotoPos) */
  const PROB_CAP = 30;   // a 100 000-character field can hold hundreds of old-form hits: the shell lists the first 30 and says how many more
  const prevProblems = ST.ext.problems;
  ST.ext.problems = (it) => {
    const out = prevProblems ? prevProblems(it) : []; const fm = FIELD_MODE[it.kind]; if (!fm) return out;
    Object.keys(fm).forEach((k) => { if (fm[k] === 'plain') return; const text = String(it.f[k] || ''); if (!text) return; const ps = probsFor(text, fm[k]).probs; ps.slice(0, PROB_CAP).forEach((p) => out.push({ sev: p.sev, field: k, pos: p.pos, msg: t('ltLineN', { n: p.line }) + ' · ' + probMsg(p) })); if (ps.length > PROB_CAP) out.push({ sev: 'info', field: k, pos: ps[PROB_CAP].pos, msg: t('ltProbMore', { n: ps.length - PROB_CAP }) + ' · ' + t('ltLineN', { n: ps[PROB_CAP].line }) }); });
    if (it.kind === 'basic') {
      (it.f.alts || []).forEach((s, i) => { if (s) probsFor(s, 'html+cbs').probs.forEach((p) => out.push({ sev: p.sev, field: 'alts', card: i, pos: p.pos, msg: t('ltAltTitle') + ' ' + (i + 1) + ' · ' + t('ltLineN', { n: p.line }) + ' · ' + probMsg(p) })); });
      if (it.f.examples) probsFor(it.f.examples, 'ex').probs.forEach((p) => out.push({ sev: p.sev, field: 'examples', pos: p.pos, msg: t('ltExTitle') + ' · ' + t('ltLineN', { n: p.line }) + ' · ' + probMsg(p) }));
    }
    return out;
  };

  /* ---------------------------------------------------------------- token chip (DD-119) */
  function chipText(F) {
    const k = F.tok; if (!k || k === 'busy') return t('ltTokCounting'); if (k === 'stale') return t('ltTokTap');
    const n = fmtN(k.n); return LT.tok.mode === 'exact' ? (k.vary ? '≈ ' : '') + t('ltTokens', { n, model: LT.tok.model }) : t('ltTokensEst', { n });   // an estimate is already approximate: no "≈" in front of "약"
  }
  function tipText(F) {
    const parts = []; if (LT.tok.mode !== 'exact') parts.push(t(LT.tok.mode === 'offline' ? 'ltTokEstOffline' : 'ltTokEstOnline', { model: LT.tok.model }) + '. ' + t('ltTokRule')); else parts.push(t('ltTokMock'));
    parts.push(t('ltTokNote')); if (F.tok && F.tok.vary) parts.push(t('ltTokVary')); return parts;
  }
  function drawChip(F) {
    const h = F.chipHost; if (!h) return; if (!h.hasAttribute('data-part')) h.setAttribute('data-part', 'studio-lt-chip-host'); const k = F.tok; const est = LT.tok.mode !== 'exact';
    const idT = 'ltt-' + F.n, wasOpen = !!h.querySelector('.lt-tip:not([hidden])');
    h.innerHTML = '<span class="lt-tok" data-part="studio-lt-chip" data-state="' + (k && k !== 'busy' && k !== 'stale' ? (est ? 'est' : 'exact') : k === 'stale' ? 'stale' : 'busy') + '"' + (k && k.vary ? ' data-vary="1"' : '') + '>' + (k === 'stale' ? '<button type="button" class="lt-tokgo" data-part="studio-lt-chip-action" data-lt-act="count">' + esc(t('ltTokTap')) + '</button>' : '<span class="lt-toktx" data-part="studio-lt-chip-text">' + esc(chipText(F)) + '</span>' + (est ? '' : '<span class="lt-mock" data-part="studio-lt-chip-mock" title="' + esc(t('ltMockTagTip')) + '">' + esc(t('ltMockTag')) + '</span>')) + '</span>' +
      '<button type="button" class="btn sm lt-tokinfo" data-part="studio-lt-chip-info" data-lt-act="tokinfo" aria-label="' + esc(t('ltTokInfo')) + '" aria-expanded="false" aria-controls="' + idT + '" title="' + esc(t('ltTokInfo')) + '">' + ic('info', 16) + '</button>' +
      '<div class="lt-tip" data-part="studio-lt-tip" id="' + idT + '" role="group" aria-label="' + esc(t('ltTokInfo')) + '"' + (wasOpen ? '' : ' hidden') + '>' + tipText(F).map((x) => '<p>' + esc(x) + '</p>').join('') + '</div>';
    if (wasOpen) { h.querySelector('.lt-tokinfo').setAttribute('aria-expanded', 'true'); placeTip(h.querySelector('.lt-tip')); }   // a count that lands while the explanation is open does not close it
    drawDesc(F);
  }
  function countNow(F, force) {
    if (!F.chipHost) return; if (F.composing) { tokSchedule(F); return; }
    if (S.lp && !force && !F.tapCount) { F.tok = F.tok && F.tok !== 'busy' ? 'stale' : 'stale'; drawChip(F); return; }
    LT.countN++; (LT.countLog = LT.countLog || []).push(F.key); if (LT.countLog.length > 300) LT.countLog.shift(); const text = F.ta.value, r = filled(text); const raw = LT.tok.mode === 'exact' ? C.exactCount(r.out) : C.roundApprox(C.estimate(r.out));
    F.tok = { n: raw, vary: r.vary || C.analyze(text, {}).vary, mode: LT.tok.mode }; F.tapCount = false; F.tokStale = false; drawChip(F);
    if (F.o.onTok) F.o.onTok(F);
  }
  function tokSchedule(F, ms) {
    if (!F.chipHost) return; cancel(F.tokT);
    if (S.lp) { if (F.tok && F.tok !== 'stale') { F.tok = 'stale'; drawChip(F); } else if (!F.tok) { F.tok = 'stale'; drawChip(F); } return; }
    F.tokT = later(() => countNow(F), ms == null ? TOK_PAUSE : ms);
  }
  LT.countRaw = (text) => { const r = filled(text); return { n: LT.tok.mode === 'exact' ? C.exactCount(r.out) : C.roundApprox(C.estimate(r.out)), vary: r.vary || C.analyze(text, {}).vary }; };
  LT.countNow = countNow; LT.tokSchedule = tokSchedule; LT.drawChip = drawChip; LT.chipText = chipText;
  function visible(el) { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.width > 0; }
  function countVisible() { LT.fields.forEach((F) => { if (F.chipHost && F.ta.isConnected && !S.lp && visible(F.wrap) && (!F.tok || F.tok === 'stale' || F.tok === 'busy')) countNow(F); }); }
  function recountAll() { LT.fields.forEach((F) => { if (!F.chipHost || !F.ta.isConnected || !F.tok || F.tok === 'stale') return; if (visible(F.wrap)) tokSchedule(F, 0); else F.tokStale = true; }); }   // chips in view recount now; the ones off screen recount when they are revealed
  LT.visRange = visRange; LT.countVisible = countVisible; LT.recountAll = recountAll;
  function closeTip() { $$('.lt-tip:not([hidden])').forEach((e) => { e.hidden = true; }); $$('.lt-tokinfo[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false')); LT.tipOpen = false; }
  function placeTip(tip) { tip.style.transform = ''; const r = tip.getBoundingClientRect(); let dx = 0; if (r.left < 8) dx = 8 - r.left; else if (r.right > innerWidth - 8) dx = innerWidth - 8 - r.right; if (dx) tip.style.transform = 'translateX(' + Math.round(dx) + 'px)'; }
  function toggleTip(b) { const tip = document.getElementById(b.getAttribute('aria-controls')); const open = tip.hidden; closeTip(); if (open) { tip.hidden = false; placeTip(tip); b.setAttribute('aria-expanded', 'true'); LT.tipOpen = true; } }

  /* ---------------------------------------------------------------- {{ autocomplete (DD-118): a popup under the caret on desktop, a strip above the keyboard on phones */
  function toggleMacros() {
    const out = [];
    A.mergeOrder('toggles').forEach((o) => A.itemsOf(o, 'toggles').forEach((it) => String(it.f.defs || '').split('\n').forEach((l) => {
      const p = l.split('='); const k = (p[0] || '').trim(); if (!k || p.length < 2 || /^#/.test(k)) return; const ty = (p[2] || '').trim(); if (ty === 'group' || ty === 'groupEnd' || ty === 'divider' || ty === 'caption') return;
      if (!out.some((x) => x.key === k)) out.push({ n: 'toggle_' + k, kind: 'toggle', sig: '', ko: (p[1] || k).trim(), en: (p[1] || k).trim(), kw: k, ins: 'toggle', key: k });
    })));
    return out;
  }
  const allMacros = () => DD.MACROS.concat(toggleMacros());
  LT.allMacros = allMacros;
  const dispName = (m) => (m.kind === 'block' && m.n.charAt(0) !== ':' ? '#' + m.n : m.n);
  const descOf = (m) => (S.lang === 'en' ? m.en : m.ko);
  function acEl() {
    if (!LT.ac.el) { const d = document.createElement('div'); d.id = 'ltAc'; d.className = 'lt-ac'; d.setAttribute('data-part', 'studio-lt-popup'); d.hidden = true; d.setAttribute('role', 'listbox'); $('#studio').appendChild(d); const pick = (e) => { e.preventDefault(); const o = e.target.closest('[data-i]'); if (o && e.type === 'pointerdown') acPick(+o.dataset.i); }; d.addEventListener('pointerdown', pick); d.addEventListener('mousedown', (e) => e.preventDefault()); LT.ac.el = d; }
    return LT.ac.el;
  }
  function acClose() {
    const ac = LT.ac; if (!ac.open && (!ac.el || ac.el.hidden)) return; ac.open = false; if (ac.el) ac.el.hidden = true;
    if (ac.F) { ac.F.ta.setAttribute('aria-expanded', 'false'); ac.F.ta.removeAttribute('aria-activedescendant'); ac.F.ta.removeAttribute('aria-controls'); }
  }
  function acDraw() {
    const ac = LT.ac, el = acEl(), strip = S.layout === 'phone'; el.className = 'lt-ac' + (strip ? ' strip' : ''); el.hidden = false; el.setAttribute('aria-label', t('acLabel'));
    el.innerHTML = ac.items.map((m, i) => '<div role="option" id="ltAc-' + i + '" data-i="' + i + '" aria-selected="' + (i === ac.idx) + '" class="lt-aco" data-part="studio-lt-option"><span class="n" data-part="studio-lt-option-name">' + esc(dispName(m)) + '</span><span class="sig" data-part="studio-lt-option-sig">' + esc(m.sig || '') + '</span><span class="d" data-part="studio-lt-option-desc">' + esc(descOf(m)) + '</span></div>').join('');
    LT.syncAll(el); ac.open = true; const ta = ac.F.ta; ta.setAttribute('aria-expanded', 'true'); ta.setAttribute('aria-controls', 'ltAc'); ta.setAttribute('aria-activedescendant', 'ltAc-' + ac.idx);
    const cur = el.querySelector('[aria-selected="true"]'); if (cur && cur.scrollIntoView && strip) { const l = cur.offsetLeft - 8; if (l < el.scrollLeft || l > el.scrollLeft + el.clientWidth - cur.offsetWidth) el.scrollLeft = l; }
  }
  function acPosition() {
    const ac = LT.ac, el = ac.el; if (S.layout === 'phone') { const vv = window.visualViewport; const kb = vv ? Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop)) : 0; el.style.left = ''; el.style.top = ''; el.style.bottom = kb + 'px'; return; }   /* DD-200: .lt-ac.strip has left: 0 in the stylesheet; a cleared top is auto */
    const m = measureCaret(ac.F, ac.ctx.start); if (!m) return; const w = el.offsetWidth, h = el.offsetHeight; let x = Math.min(Math.max(8, m.x), innerWidth - w - 8), y = m.y + m.lh + 4;
    if (y + h > innerHeight - 8) y = Math.max(8, m.y - h - 4);
    el.style.bottom = ''; el.style.left = x + 'px'; el.style.top = y + 'px';
  }
  /* the list opens only when {{ is typed (allowOpen); moving the caret into or along an existing macro never opens it. While it is open it follows the typing and may show during an IME composition (read only). */
  function acUpdate(F, allowOpen) {
    const ac = LT.ac; if (!F || !F.flags.cbs || F.o.noAc || document.activeElement !== F.ta || F.ta.selectionStart !== F.ta.selectionEnd) { acClose(); return; }
    if (!allowOpen && !(ac.open && ac.F === F)) return;
    const text = F.ta.value, caret = F.ta.selectionStart, ctx = C.acContext(text, caret); if (!ctx) { acClose(); return; }
    if (/[\w\-가-힣ㄱ-ㅎ]/.test(text.charAt(caret))) { acClose(); return; }   // the caret sits inside an existing name: Enter or Tab would cut it in two
    const items = C.filterMacros(ctx.query, allMacros(), S.lang, S.layout === 'phone' ? 24 : 8); if (!items.length) { acClose(); return; }
    const same = ac.open && ac.F === F && ac.items.map((m) => m.n).join() === items.map((m) => m.n).join(), fresh = !ac.open; ac.F = F; ac.ctx = ctx; ac.items = items; if (!same) { ac.idx = 0; ac.chosen = false; }
    acDraw(); acPosition(); if (fresh || !same) announce(t('acN', { n: items.length }));
  }
  function acPick(i) {
    const ac = LT.ac, m = ac.items[i], F = ac.F; if (!m || !F) return; const ta = F.ta, caret = ta.selectionStart, ctx = C.acContext(ta.value, caret); if (!ctx) { acClose(); return; } let end = caret; if (ta.value.slice(end, end + 2) === '}}') end += 2;
    const ins = C.insertion(m); acClose(); replaceRange(F, ctx.start, end, ins.text, ins.caret); announce(t('msInserted', { name: dispName(m) }));
  }
  /* Enter inserts when an item was chosen with the arrows or a name has been typed; Tab only for a chosen item (otherwise Tab leaves the field as usual, and Enter is a new line) */
  function acKey(e) {
    const ac = LT.ac; if (!ac.open) return false; const k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); ac.idx = (ac.idx + (k === 'ArrowDown' ? 1 : ac.items.length - 1)) % ac.items.length; ac.chosen = true; acDraw(); return true; }
    if (k === 'Enter') { if (ac.chosen || (ac.ctx && ac.ctx.query.length > 0)) { e.preventDefault(); acPick(ac.idx); return true; } acClose(); return false; }
    if (k === 'Tab') { if (ac.chosen) { e.preventDefault(); acPick(ac.idx); return true; } acClose(); return false; }
    if (k === 'Escape') { e.preventDefault(); acClose(); return true; }
    return false;
  }
  LT.acUpdate = acUpdate; LT.acClose = acClose; LT.acPick = acPick;
  const acReposition = () => { if (LT.ac.open) acPosition(); };
  addEventListener('resize', () => { if (LT.ac.open) acUpdate(LT.ac.F, false); });
  addEventListener('scroll', acReposition, true);
  if (window.visualViewport) { visualViewport.addEventListener('resize', acReposition); visualViewport.addEventListener('scroll', acReposition); }   // the keyboard coming or going moves the strip

  /* ---------------------------------------------------------------- macro sheet (braces button, Ctrl+Space) */
  function openMacroSheet(F, opener) {
    const sel = [F.ta.selectionStart, F.ta.selectionEnd];
    A.openSheet({ title: t('msTitle'), opener: opener || F.ta, cls: 'dlg tall ltms', kind: 'lt-macros', build(body) {
      body.innerHTML = '<div class="ms-top" data-part="studio-lt-macro-top"><input type="text" class="ms-q" data-part="studio-lt-macro-search" id="msQ" autocomplete="off" spellcheck="false" aria-label="' + esc(t('msSearch')) + '" placeholder="' + esc(t('msSearch')) + '" data-autofocus="1"></div><div class="ms-list" data-part="studio-lt-macro-list" id="msList"></div>';
      const list = $('#msList', body), q = $('#msQ', body);
      const draw = () => {
        const items = C.filterMacros(q.value, allMacros(), S.lang, 0); let h = '';
        const groups = DD.GROUPS.concat(['toggle']);
        groups.forEach((g) => { const its = items.filter((m) => m.kind === g); if (!its.length) return; h += '<section class="ms-g" data-part="studio-lt-macro-group" role="group" aria-label="' + esc(t('g' + g.charAt(0).toUpperCase() + g.slice(1))) + '"><h3 data-part="studio-lt-macro-group-title">' + esc(t('g' + g.charAt(0).toUpperCase() + g.slice(1))) + '</h3>' + its.map((m) => '<button type="button" class="ms-it" data-part="studio-lt-macro-item" data-n="' + esc(m.n) + '"><span class="n" data-part="studio-lt-macro-item-name">' + esc(dispName(m)) + '</span><span class="sig" data-part="studio-lt-macro-item-sig">' + esc(m.sig || '') + '</span><span class="d" data-part="studio-lt-macro-item-desc">' + esc(descOf(m)) + '</span></button>').join('') + '</section>'; });
        list.innerHTML = h || '<p class="ms-none" data-part="studio-lt-macro-none">' + esc(t('msNone')) + '</p>';
      };
      q.addEventListener('input', draw); draw();
      list.addEventListener('click', (e) => { const b = e.target.closest('.ms-it'); if (!b) return; const m = allMacros().find((x) => x.n === b.dataset.n); if (!m) return; A.closeSheet(false); const ins = C.insertion(m); replaceRange(F, sel[0], sel[1], ins.text, ins.caret); announce(t('msInserted', { name: dispName(m) })); });
    } });
  }
  LT.openMacroSheet = openMacroSheet;

  /* ---------------------------------------------------------------- CBS preview sandbox in the test panel (DD-121): sample values, nothing written back */
  function renderRich(src) {
    const doc = new DOMParser().parseFromString('<body>' + src + '</body>', 'text/html'), ok = new Set(['B', 'I', 'EM', 'STRONG', 'BR', 'P', 'DIV', 'SPAN', 'HR', 'UL', 'OL', 'LI', 'CODE', 'PRE', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'A', 'IMG', 'U', 'S', 'SMALL']);
    const clean = (node) => {
      [...node.childNodes].forEach((ch) => {
        if (ch.nodeType === 3) { md(ch); return; } if (ch.nodeType !== 1) { ch.remove(); return; }
        if (!ok.has(ch.tagName)) { if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT'].indexOf(ch.tagName) >= 0) { ch.remove(); return; } const kids = [...ch.childNodes]; kids.forEach((k) => node.insertBefore(k, ch)); ch.remove(); clean(node); return; }
        const alt = ch.getAttribute('alt'); [...ch.attributes].forEach((a) => ch.removeAttribute(a.name));
        if (ch.tagName === 'IMG') { const sp = document.createElement('span'); sp.className = 'sb-img'; sp.textContent = '[' + (alt || 'image') + ']'; ch.replaceWith(sp); return; }
        clean(ch);
      });
    };
    const md = (tn) => {
      const s = tn.nodeValue; if (!/[*>]|\n/.test(s)) return; const frag = document.createDocumentFragment(); const re = /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|\n/g; let last = 0, m;
      while ((m = re.exec(s))) { if (m.index > last) frag.appendChild(document.createTextNode(s.slice(last, m.index))); if (m[0] === '\n') frag.appendChild(document.createElement('br')); else { const e = document.createElement(m[1] ? 'strong' : 'em'); e.textContent = m[1] || m[2]; frag.appendChild(e); } last = m.index + m[0].length; }
      if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last))); tn.replaceWith(frag);
    };
    clean(doc.body); return doc.body.innerHTML;
  }
  LT.renderRich = renderRich;
  const SB_MAX = 6000;
  function sbTarget(c) { const F = LT.sb.target; if (F && F.ta.isConnected && F.flags.cbs) return { text: F.ta.value, label: F.label, F }; return { text: c ? c.text : '', label: '', F: null }; }
  const sbSig = (tg) => C.hash ? '' : tg.text.length + '|' + tg.text.slice(0, 64) + '|' + tg.text.slice(-64) + '|' + JSON.stringify(sbVals());
  function sbBuild(host, tg) {
    const names = C.usedNames(tg.text), u = C.hasUser(tg.text), ch = C.hasChar(tg.text), vals = sbVals(), noChat = !S.ctx.chat;
    let h = '<section class="sb" data-part="studio-lt-sandbox" id="ltSb" aria-label="' + esc(t('sbValues')) + '"><h3 class="sb-h" data-part="studio-lt-sandbox-title">' + ic('flask-conical', 14) + '<span>' + esc(t('sbValues')) + '</span></h3><p class="sb-note" data-part="studio-lt-sandbox-note">' + esc(t('sbNote')) + '</p>';
    if (u) h += '<div class="sb-row" data-part="studio-lt-sandbox-row"><label data-part="studio-lt-sandbox-label" for="sbUser">' + esc(t('sbUserLbl')) + '</label><input type="text" data-part="studio-lt-sandbox-input" id="sbUser" data-sb="user" value="' + esc(LT.sb.user) + '" placeholder="' + esc(vals.user) + '" autocomplete="off"></div>';
    if (ch) h += '<div class="sb-row" data-part="studio-lt-sandbox-row"><label data-part="studio-lt-sandbox-label" for="sbChar">' + esc(t('sbCharLbl')) + '</label><input type="text" data-part="studio-lt-sandbox-input" id="sbChar" data-sb="char" value="' + esc(LT.sb.char) + '" placeholder="' + esc(vals.char) + '" autocomplete="off"></div>';
    names.vars.forEach((k, i) => { h += '<div class="sb-row" data-part="studio-lt-sandbox-row"><label data-part="studio-lt-sandbox-label" for="sbV' + i + '">' + esc(k) + '</label><input type="text" data-part="studio-lt-sandbox-input" id="sbV' + i + '" data-sb-var="' + esc(k) + '" value="' + esc(vals.vars[k] == null ? '' : vals.vars[k]) + '" autocomplete="off"></div>'; });
    const defs = {}; try { toggleMacros().forEach((m) => { defs[m.key] = m.ko; }); } catch (_) {}
    names.toggles.forEach((k) => { h += '<label class="sw sb-sw" data-part="studio-lt-sandbox-toggle"><input type="checkbox" data-tk="' + esc(k) + '"' + (S.tv[k] ? ' checked' : '') + '><span class="sw-ui"></span><span class="lbl">' + esc(defs[k] || k) + ' <small class="hint">' + esc(t('sbGlobal')) + ' · toggle_' + esc(k) + '</small></span></label>'; });
    if (!u && !ch && !names.vars.length && !names.toggles.length) h += '<p class="sb-none" data-part="studio-lt-sandbox-none">' + esc(t('sbNone')) + '</p>';
    h += '<div class="sb-acts" data-part="studio-lt-sandbox-actions"><button type="button" class="btn solid" data-part="studio-lt-sandbox-copy" data-sb-act="copy" aria-disabled="' + noChat + '"' + (noChat ? ' aria-describedby="sbWhy"' : '') + '>' + ic('download', 16) + '<span>' + esc(t('sbCopyChat')) + '</span></button>' + (noChat ? '<span class="hint sb-why" data-part="studio-lt-sandbox-why" id="sbWhy">' + ic('info', 12) + ' ' + esc(t('sbNoChat')) + '</span>' : '') + '</div>';
    h += '<p class="sb-writes" data-part="studio-lt-sandbox-writes" id="sbWrites" hidden></p><p class="sb-unk hint" data-part="studio-lt-sandbox-unknown" id="sbUnk" hidden></p>';
    h += '<div class="sb-outhead" data-part="studio-lt-sandbox-outhead"><h3 class="sb-h" data-part="studio-lt-sandbox-title">' + ic('eye', 14) + '<span>' + esc(t('sbOutTitle')) + '</span></h3><div class="seg sb-seg" data-part="studio-lt-sandbox-modes" role="group" aria-label="' + esc(t('sbOutTitle')) + '"><button type="button" class="btn sm txt" data-part="studio-lt-sandbox-mode" data-sb-act="rendered" aria-pressed="' + !LT.sb.raw + '">' + esc(t('sbRendered')) + '</button><button type="button" class="btn sm txt" data-part="studio-lt-sandbox-mode" data-sb-act="raw" aria-pressed="' + LT.sb.raw + '">' + esc(t('sbRaw')) + '</button></div><button type="button" class="btn sm" data-part="studio-lt-sandbox-run" data-sb-act="run" aria-label="' + esc(t('sbRefresh')) + '" title="' + esc(t('sbRefresh')) + '">' + ic('refresh-cw', 16) + '</button></div>';
    h += '<p class="sb-stale" data-part="studio-lt-sandbox-stale" id="sbStale" role="status" hidden></p><div class="sb-out" data-part="studio-lt-sandbox-output" id="sbOut" tabindex="0" aria-label="' + esc(t('sbOutTitle')) + '"></div>' + (S.lp ? '<p class="hint">' + esc(t('sbManual')) + '</p>' : '') + '</section>';
    host.innerHTML = h; LT.syncAll(host);
  }
  function sbRun(tg) {
    tg = tg || sbTarget(null); const res = filled(tg.text), out = $('#sbOut'); LT.sb.out = { sig: sbSig(tg), res, text: tg.text }; LT.sb.runs = (LT.sb.runs || 0) + 1; const vs = JSON.stringify(Object.assign({}, sbVals(), { fields: 0 })), valuesChanged = vs !== LT.sb.lastVals; LT.sb.lastVals = vs;   /* vs leaves out the field texts: typing in a field is not a change of the preview values */
    if (out) {
      const shown = res.out.length > SB_MAX ? res.out.slice(0, SB_MAX) + '…' : res.out;
      if (LT.sb.raw) { out.className = 'sb-out raw'; out.textContent = shown || t('sbEmpty'); } else { out.className = 'sb-out'; out.innerHTML = shown ? renderRich(shown) : '<span class="hint">' + esc(t('sbEmpty')) + '</span>'; }
      const vw = res.writes.filter((k) => !/^toggle_/.test(k)), wr = $('#sbWrites'); if (wr) { wr.hidden = !vw.length; wr.innerHTML = vw.length ? ic('flask-conical', 14) + '<span>' + esc(t('sbWrites', { n: vw.length })) + '</span><small>' + esc(vw.join(', ')) + '</small>' : ''; }
      const uk = $('#sbUnk'); if (uk) { uk.hidden = !res.unknown.length; uk.textContent = res.unknown.length ? t('sbUnknown', { n: res.unknown.length }) : ''; }
      const st = $('#sbStale'); if (st) st.hidden = true; out.removeAttribute('data-stale');
    }
    if (valuesChanged) recountAll();   // counts follow the preview values, not every keystroke
  }
  function sbRender(c) {
    const host = $('#tSw'); if (!host) return; ['#tIn', '#test-meta', '#preview-out', '.tact', '#sim-note'].forEach((s) => { const e = $(s); if (e) e.hidden = true; });
    const tg = sbTarget(c), names = C.usedNames(tg.text);
    const key = [S.open, tg.F ? tg.F.key : '', names.vars.join(), names.toggles.join(), C.hasUser(tg.text), C.hasChar(tg.text), S.lang, !!S.ctx.chat, S.lp, LT.sb.raw].join('|');
    const rebuilt = host.dataset.sbKey !== key || !$('#ltSb', host);
    if (rebuilt) { const ae = document.activeElement; const keep = ae && host.contains(ae) && ae.dataset ? (ae.dataset.sb || ae.dataset.sbVar || ae.dataset.tk) : null; sbBuild(host, tg); host.dataset.sbKey = key; if (keep) { const e = host.querySelector('[data-sb="' + keep + '"],[data-sb-var="' + keep + '"],[data-tk="' + keep + '"]'); if (e) e.focus({ preventScroll: true }); } sbRun(tg); return; }
    sbMark(tg.F, true);
  }
  function sbMark(F, fromPanel) {
    const host = $('#tSw'); if (!host || !$('#ltSb', host)) return; const tg = sbTarget(null); if (!tg.F) return; if (F && F !== tg.F && !fromPanel) return;
    if (LT.sb.out && LT.sb.out.sig === sbSig(tg)) return;
    const st = $('#sbStale'), out = $('#sbOut'); if (st) { st.hidden = false; st.innerHTML = ic('info', 14) + '<span>' + esc(t('sbStale')) + '</span>'; } if (out) out.setAttribute('data-stale', '1');
    cancel(LT.sbT); if (!S.lp) LT.sbT = later(() => { LT.sbT = null; const h = $('#tSw'); if (h && $('#ltSb', h)) sbRun(sbTarget(null)); }, 300);
  }
  ST.ext.cbsRender = sbRender; ST.ext.cbsRun = () => { const h = $('#tSw'); if (h && $('#ltSb', h)) sbRun(sbTarget(null)); else sbRender(null); };
  LT.sbRun = () => sbRun(sbTarget(null)); LT.sbRender = () => sbRender(null);
  $('#tSw').addEventListener('input', (e) => {
    const el = e.target; if (el.dataset.sb) LT.sb[el.dataset.sb] = el.value; else if (el.dataset.sbVar) LT.sb.vars[el.dataset.sbVar] = el.value; else return;
    sbMark(null, true); recountAll();
  });
  $('#tSw').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sb-act]'); if (!b) return; const a = b.dataset.sbAct;
    if (a === 'copy') { if (b.getAttribute('aria-disabled') === 'true') { announce(t('sbNoChat')); return; } LT.sb.vars = Object.assign({}, DD.CHAT.vars); Object.keys(DD.CHAT.toggles).forEach((k) => { S.tv[k] = DD.CHAT.toggles[k]; }); const n = Object.keys(DD.CHAT.vars).length + Object.keys(DD.CHAT.toggles).length; const h = $('#tSw'); h.dataset.sbKey = ''; sbRender(null); recountAll(); A.toast(t('sbCopied', { n }), { ms: 3000 }); announce(t('sbCopied', { n })); const nb = $('#tSw [data-sb-act="copy"]'); if (nb) nb.focus({ preventScroll: true }); }
    else if (a === 'raw' || a === 'rendered') { LT.sb.raw = a === 'raw'; $$('#tSw .sb-seg .btn').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.sbAct === a))); sbRun(); }
    else if (a === 'run') sbRun();
  });
  $('#tSw').addEventListener('change', (e) => { if (e.target.dataset && e.target.dataset.tk) recountAll(); });

  /* ---------------------------------------------------------------- form integration */
  const prevRenderForm = ST.ext.renderForm;
  function inp(f, labKey, v) { return '<div class="fld" data-part="studio-field" data-field="' + f + '"><label for="f-' + f + '" data-part="studio-field-label">' + esc(t(labKey)) + '</label><input type="text" data-part="studio-field-control" id="f-' + f + '" data-f="' + f + '" value="' + esc(v == null ? '' : v) + '" autocomplete="off" spellcheck="false"></div>'; }
  function ltFld(it, f) { const mode = FIELD_MODE.basic[f]; return '<div class="fld lt-fld" data-part="studio-field" data-field="' + f + '"><label for="f-' + f + '" data-part="studio-field-label">' + esc(t(LABEL_KEY[f])) + '</label><textarea id="f-' + f + '" data-f="' + f + '"' + (mode !== 'plain' ? ' data-cbs="1"' : '') + ' data-lt="' + mode + '" class="' + (mode === 'plain' ? 'mono' : '') + '">' + esc(it.f[f] == null ? '' : it.f[f]) + '</textarea></div>'; }
  ST.ext.renderForm = (it, o, host) => {
    if (it.kind !== 'basic') return prevRenderForm ? prevRenderForm(it, o, host) : false;
    host.classList.remove('tgb-host');
    host.innerHTML = A.peerBannerHtml(it) + inp('name', 'fName', it.f.name) + ltFld(it, 'description') + ltFld(it, 'first') +
      '<section class="lt-sec" data-part="studio-lt-list" id="ltAlts" data-lt-list="alts" data-f="alts" tabindex="-1" aria-label="' + esc(t('ltAltTitle')) + '"></section><section class="lt-sec" data-part="studio-lt-list" id="ltEx" data-lt-list="examples" data-f="examples" tabindex="-1" aria-label="' + esc(t('ltExTitle')) + '"></section>' +
      ltFld(it, 'system') + ltFld(it, 'bghtml') + ltFld(it, 'defvars') + ltFld(it, 'tnote');
    return true;
  };
  ST.ext.afterForm = (it, o, host) => {
    staleSweep(); closeTip(); acClose();
    const fm = FIELD_MODE[it.kind] || {};
    $$('textarea[data-f]', host).forEach((ta) => { const f = ta.dataset.f, mode = ta.dataset.lt || fm[f]; if (!mode) return; mountField(ta, { mode, itemId: it.id, field: f, label: '' }); });
    if (it.kind === 'basic' && LT.mountLists) LT.mountLists(it, o, host);
    if (LT.afterForm) LT.afterForm(it, o, host);
    buildDemo();
  };

  /* ---------------------------------------------------------------- keys (called first, from lte-early.js) */
  const fieldOf = (el) => (el && el.classList && el.classList.contains('lt-in') ? LT.byTa.get(el) : null);
  window.__ltKey = (e) => {
    if (e.isComposing || e.keyCode === 229) return false;
    const k = e.key, kl = k.length === 1 ? k.toLowerCase() : k, mod = e.ctrlKey || e.metaKey, F = fieldOf(e.target);
    if (k === 'Escape' && LT.tipOpen) { closeTip(); e.preventDefault(); return true; }
    if (F && LT.ac.open && LT.ac.F === F && acKey(e)) return true;
    if (LT.focusKey && LT.focusKey(e, F)) return true;
    if (F && mod && !e.altKey && !e.shiftKey && kl === 'e') { e.preventDefault(); if (LT.openFocus) LT.openFocus(F); return true; }
    if (F && F.flags.cbs && mod && !e.altKey && e.shiftKey && e.code === 'Space') { e.preventDefault(); openMacroSheet(F); return true; }
    if (LT.listKey && LT.listKey(e, F)) return true;
    return false;
  };

  /* ---------------------------------------------------------------- clicks on the field's own buttons */
  document.addEventListener('click', (e) => {
    if (LT.tipOpen && !e.target.closest('.lt-tokw')) closeTip();
    const b = e.target.closest('[data-lt-act]'); if (!b) return; const act = b.dataset.ltAct, w = b.closest('.lt'), F = w ? LT.fields.get(w.dataset.ltKey) : null;
    if (act === 'tokinfo') { toggleTip(b); return; }
    if (!F) return;
    if (act === 'macro') openMacroSheet(F, b);
    else if (act === 'focus') LT.openFocus && LT.openFocus(F, b);
    else if (act === 'find') LT.openFocus && LT.openFocus(F, b, { find: true });
    else if (act === 'preview') showPreview(F, b);
    else if (act === 'count') { F.tapCount = true; countNow(F, true); }
    else if (act === 'pgo') { const p = F.probs[+b.dataset.i]; if (p) gotoPos(F, p.pos); }
    else if (act === 'pfix') { const p = F.probs[+b.dataset.i]; if (p) fixProblem(F, p); }
  });
  function showPreview(F, opener) {
    LT.sb.target = F; S.tf = { f: F.o.card ? 'lt:' + F.key : F.o.field, label: F.label }; A.renderSide();
    if (S.layout === 'wide') { A.openSide('test', opener); } else A.openSide('test', opener);
  }
  LT.showPreview = showPreview;
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.lt')) flushAll(); }, true);

  /* ---------------------------------------------------------------- demo controls (token source, open chat) */
  function buildDemo() {
    const d = $('#demo'); if (!d) return; let b = $('#ltDemo');
    if (!b) { b = document.createElement('div'); b.id = 'ltDemo'; b.className = 'demo-body'; d.appendChild(b); b.addEventListener('click', (e) => { const x = e.target.closest('[data-ltd]'); if (!x) return; const [k, v] = x.dataset.ltd.split(':'); if (k === 'tok') { LT.tok.mode = v; LT.fields.forEach((F) => { if (F.chipHost) { F.tok = null; drawChip(F); } }); recountAll(); setTimeout(countVisible, 0); buildDemo(); } else if (k === 'chat') { S.ctx.chat = v === 'on'; A.renderAll(); buildDemo(); } }); }
    const pr = (on) => ' aria-pressed="' + on + '"';
    b.innerHTML = '<label class="l">' + esc(t('dTok')) + '</label><div class="row">' + [['exact', 'dTokExact'], ['offline', 'dTokOff'], ['online', 'dTokOn']].map(([k, l]) => '<button type="button" class="btn" data-ltd="tok:' + k + '"' + pr(LT.tok.mode === k) + '>' + esc(t(l)) + '</button>').join('') + '</div><label class="l">' + esc(t('dChat')) + '</label><div class="row"><button type="button" class="btn" data-ltd="chat:on"' + pr(!!S.ctx.chat) + '>on</button><button type="button" class="btn" data-ltd="chat:off"' + pr(!S.ctx.chat) + '>off</button></div>';
  }
  LT.buildDemo = buildDemo;
  LT.sbMark = sbMark; LT.fieldOf = fieldOf; LT.dispName = dispName; LT.sevIc = sevIc; LT.btn = btn; LT.closeTip = closeTip; LT.drawProbs = drawProbs; LT.drawNote = drawNote; LT.setHl = setHl;
})();
