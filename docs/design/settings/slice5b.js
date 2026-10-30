/* Settings slice 5b mockup: 대화 기능 (장기 기억, 음성, 감정 이미지, 이미지 생성), 언어 › 번역 and the 임베딩 row of 모델.
   Synthetic mockup; not proof of native behaviour or performance. Standalone (no network, no dependencies): nothing here reads or writes the real app's storage; tests, fetches and downloads are simulated with timers and synthetic data.
   Loaded after slice5a.js and BEFORE slice1.js: it wraps the window.SS1_EXT hooks slices 2 to 5a registered (slice1.js reads them at start-up) and receives slice 1's API in X.boot.
   Implements settings/SLICE5B_SPEC.md revision 1. Store-first (DS-067): the real settings are rows of slice 1's catalogue (data5b.js), the memory flags, HypaV3 presets, translator presets, character voices and WaveSpeed choices are the SS5B_DATA.ST store;
   every page reads them by id at render time. The only drafts are the text being typed in a number field, an open dialog, a running test and the collapsed groups.
   Floor devices (Note 9 / Android 10 WebView, Raspberry Pi 3): no optional chaining, nullish coalescing, .at(), replaceAll or structuredClone; checks/ss5b/modes.mjs scans for them.
   Sections: helpers, icons, state, connections and tests, undo, page frame, 장기 기억, 음성, 감정 이미지, 이미지 생성, 번역, 임베딩 row, sub-pages, events, hooks, states, public API. */
(() => {
'use strict';
const X = window.SS1_EXT;
const D = window.SS1_DATA, D3 = window.SS3_DATA, D5 = window.SS5A_DATA, DB = window.SS5B_DATA;
const Q = new URLSearchParams(location.search);
let A = null, B = null, C3 = null;
const { K, ST, FL, EMB, IMG_PROV, SAMPLERS, LANGS, WS_MODELS, ENGINES, FILES } = DB;
const CFG = { testMs: 900, fetchMs: 500, undoMs: 10000, toastMs: 6000, coalesceMs: 1200 };
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ic = (n, s, c) => A.ic(n, s, c);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KO = () => A.S.lang === 'ko';
const pick = (ko, en) => (KO() ? ko : (en === undefined || en === '' ? ko : en));
const P = {
  sub: null,                                   // { kind: 'memory-preset' | 'imggen' | 'voices' | 'trpreset', id }: the open sub-page (a drill-in with Back)
  retFk: '', listScroll: {}, open: { adv: false, hires: false }, tests: {}, timers: {}, ws: { status: 'idle', q: '', act: -1, ta: '', taT: 0 },
  draft: {}, pending: null, missing: [], writes: 0, seq: 0, booted: false, defer: false, nomsg: 0, lu: {}, cacheT: 0, hl: '',
};
const SH = {};                                  // the value each row had at its last committed change (the "from" of the next undo step); not a copy anyone reads for display
const t5 = (k, ...a) => { const v = K[A.S.lang][k]; if (v === undefined) { P.missing.push(k); return '⟦' + k + '⟧'; } return typeof v === 'function' ? v(...a) : v; };
const R = (id) => A.ROW[id];
const rv = (id) => A.ROW[id].v;
const lab = (r) => A.L(r);
const mine = (r) => !!r && r.p5b === true;
const unavail = (r) => window.__ss1.unavail(r);
const pairOf = (s) => A.pair(s);

/* ------------------------------------------------------------------ icons (Lucide paths, inline; copied, not imported) */
const ICONS5B = {
  'volume-2': '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>',
  'play': '<polygon points="6 3 20 12 6 21 6 3"/>',
  'smile': '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" x2="9.01" y1="9" y2="9"/><line x1="15" x2="15.01" y1="9" y2="9"/>',
  'circle-x': '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  'wifi-off': '<path d="M12 20h.01"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/><path d="M5 12.859a10 10 0 0 1 5.17-2.69"/><path d="M19 12.859a10 10 0 0 0-2.007-1.523"/><path d="M2 8.82a15 15 0 0 1 4.177-2.643"/><path d="M22 8.82a15 15 0 0 0-11.288-3.764"/><path d="m2 2 20 20"/>',
  'timer': '<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>',
  'file-text': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  'hard-drive-download': '<path d="M12 2v8"/><path d="m16 6-4 4-4-4"/><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6 18h.01"/><path d="M10 18h.01"/>',
  'ban': '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  'chevrons-up-down': '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
  'file-up': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M12 12v6"/><path d="m15 15-3-3-3 3"/>',
  'sparkles': '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',
};

/* ------------------------------------------------------------------ small helpers */
function announce(msg) { A.announce(msg); }
function toast(msg, o) { B.psToast(msg, o || {}); }
function toastUndo(msg, entry, o) { toast(msg, Object.assign({ action: { label: t5('undo'), title: t5('undo') + ' (Alt+Z)', fn: () => B.runLU(entry.id) }, until: 'page' }, o || {})); }
function pushLU(label, undo, kind, data) { return B.pushLU(label, undo, kind, data); }
const firstLine = (s) => String(s || '').split(/\r?\n/)[0];
const clip = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const fmtInt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const chars = () => D5.CHARS;
const charOf = (id) => chars().find((c) => c.id === id) || null;
const charName = (c) => (c ? pick(c.ko, c.en) : '');
const activeChar = () => charOf(ST.activeChar);
const studioLink = (cid, kind) => '../studio/slice1.html?owner=character:' + encodeURIComponent(cid) + (kind ? '&kind=' + kind : '') + '&from=settings';   // SLICE1_SPEC of Studio, section 1: owner, kind, from
function download(name, text) {   // a real download of synthetic text (no network): blob URL, one click
  try { const u = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); const a = document.createElement('a'); a.href = u; a.download = name; a.hidden = true; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000); } catch (e) { /* ignore */ }
}
const inMine = () => A.S.open && A.S.view === 'page' && (A.S.page === 'chatfeat' || A.S.page === 'lang' || A.S.page === 'models');
function repaint(focusFk) {   // re-render the page keeping scroll; the focused control is found again by its data-fk
  if (!A.S.open) return; const a = document.activeElement; const fk = focusFk || (a && a.getAttribute ? a.getAttribute('data-fk') : '');
  if (P.defer) { setTimeout(() => repaint(fk), 0); return; }
  A.refreshPage(); const sc = $('#pageScroll');
  if (fk && sc) { const e = $(`[data-fk="${CSS.escape(fk)}"]`, sc); if (e) e.focus({ preventScroll: true }); }
}
function focusFk(fk) { const e = fk && $(`#pageScroll [data-fk="${CSS.escape(fk)}"]`); if (e) { e.focus({ preventScroll: true }); return true; } return false; }
function ask(o) {   // a confirm: title, body html, ok label, danger?; a dialog with a danger button is critical
  const d = A.openDialog({ critical: o.critical !== false, title: o.title, body: o.body, buttons: [{ id: 'cancel', label: t5('cancel') }, { id: 'ok', label: o.ok, danger: !!o.danger, primary: !o.danger }], initial: '[data-dlg="cancel"]', onClose: o.onClose });
  A.openDialog.handlers = { ok: () => { setTimeout(o.onOk, 0); } }; return d;
}
function watchDialog(fn) {   // slice 3's own add dialog has no close callback: wait for it to leave #layer, then run fn once
  const layer = $('#layer'); let seen = !!$('.dlg-back', layer); const mo = new MutationObserver(() => { const has = !!$('.dlg-back', layer); if (has) seen = true; else if (seen) { mo.disconnect(); setTimeout(fn, 30); } }); mo.observe(layer, { childList: true });
  setTimeout(() => { if (!seen && !$('.dlg-back', layer)) mo.disconnect(); }, 600);
}

/* ------------------------------------------------------------------ connections and service chips (DS-011, DS-013: every key and address lives in 연결; a service here only shows a reference) */
const SV = {
  elevenlab: { n: 'ElevenLabs', row: 'models.elevenKey' }, VOICEVOX: { n: 'VOICEVOX', row: 'models.voicevoxUrl', addr: true }, openai: { n: 'OpenAI', cx: 'openai' }, novelai: { n: 'NovelAI', cx: 'novelai' }, huggingface: { n: 'Hugging Face', row: 'models.hfKey' }, fishspeech: { n: 'Fish Audio', row: 'models.fishKey' },
  webui: { n: 'Stable Diffusion WebUI', row: 'models.webuiUrl', addr: true }, comfyui: { n: 'ComfyUI', row: 'models.comfyUrl', addr: true }, comfy: { n: 'ComfyUI', row: 'models.comfyUrl', addr: true }, dalle: { n: 'OpenAI', cx: 'openai' }, stability: { n: 'Stability AI', row: 'models.stabilityKey' }, fal: { n: 'Fal', row: 'models.falKey' },
  Imagen: { n: 'Google AI Studio', cx: 'google' }, 'openai-compat': { n: '호환 서버', nEn: 'Compatible server', cx: 'compat' }, wavespeed: { n: 'WaveSpeed', row: 'models.waveKey' }, deepl: { n: 'DeepL', row: 'models.deeplKey' }, deeplx: { n: 'DeepLX', row: 'models.deeplxUrl', addr: true }, voyage: { n: 'Voyage', row: 'models.voyageKey' },
};
function cxOf(provider) { const l = C3.CX.filter((c) => c.provider === provider); return l.find((c) => (provider === 'compat' ? !!c.url : C3.hasKey(c))) || null; }
function conn(id) {   // { ok, name, target }: whether the service has what it needs in 연결, and the row that shows it
  const s = SV[id]; if (!s) return { ok: false, name: String(id), target: '' };
  if (s.cx) { const c = cxOf(s.cx); return c ? { ok: true, name: c.name, target: 'models.cx.' + c.id, cx: c.id } : { ok: false, name: pick(s.n, s.nEn), target: '' }; }
  const r = R(s.row); return { ok: !!String(r.v || '').trim(), name: pick(s.n, s.nEn), target: s.row };
}
function chipHTML(id, ret) {
  const c = conn(id);
  if (c.ok) return `<button type="button" class="chip p5b-conn" data-part="settings-service-chip" data-state="ok" data-p5b="goconn" data-target="${esc(c.target)}" data-ret="${esc(ret || '')}" data-fk="cn:${esc(id)}" aria-label="${esc(t5('connAria', c.name))}" title="${esc(t5('connOpen'))}">${ic('plug', 'sm')}<span class="p5b-cn">${esc(t5('connChip', c.name))}</span></button>`;
  return `<span class="p5b-miss"><span class="chip p5b-conn missing" data-part="settings-service-missing" data-part-critical data-state="missing" role="status">${ic('circle-alert', 'sm')}<span class="p5b-cn">${esc(t5('connNeed'))}</span></span><button type="button" class="btn p5b-add" data-part="settings-button" data-p5b="addconn" data-svc="${esc(id)}" data-fk="ca:${esc(id)}" aria-label="${esc(t5('connAddOf', pick(SV[id].n, SV[id].nEn)))}" title="${esc(t5('connAddOf', pick(SV[id].n, SV[id].nEn)))}">${ic('plus', 'md')}<span>${esc(t5('connAdd'))}</span></button></span>`;
}
function addConnection(svc) {   // slice 3's own add dialog for its providers; a small dialog of ours for the service rows (voice, image, translation services have no provider in slice 3 yet: engine item 5b-4)
  const s = SV[svc]; if (!s) return;
  if (s.cx) { C3.openAddDialog({ provider: s.cx }); watchDialog(() => { repaint(); }); return; }
  const r = R(s.row); const isAddr = !!s.addr; const nm = pick(s.n, s.nEn);
  const d = A.openDialog({ title: t5('svcAddTitle', nm), body: `<p class="dlg-hint">${esc(t5(isAddr ? 'svcAddAddrHint' : 'svcAddKeyHint'))}</p><label class="dlg-l" for="p5b-svcin">${esc(t5(isAddr ? 'svcAddr' : 'svcKey'))}</label><input id="p5b-svcin" class="inp" data-part="settings-field" type="${isAddr ? 'text' : 'password'}" ${isAddr ? 'inputmode="url"' : 'data-secret autocomplete="new-password"'} spellcheck="false" aria-describedby="p5b-svcmsg"><p class="dlg-hint warn" id="p5b-svcmsg" role="alert" hidden></p>`, buttons: [{ id: 'cancel', label: t5('cancel') }, { id: 'save', label: t5('svcSave'), primary: true }], initial: '#p5b-svcin', onClose: () => { const f = $('[data-fk="ca:' + svc + '"]') || $('[data-fk="cn:' + svc + '"]'); if (f) f.focus({ preventScroll: true }); } });
  const inp = $('#p5b-svcin', d.back); inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.isComposing && ev.keyCode !== 229) { ev.preventDefault(); $('[data-dlg="save"]', d.back).click(); } });
  A.openDialog.handlers = { save: () => {
    const v = inp.value.trim(); const msg = $('#p5b-svcmsg', d.back);
    if (!v || (isAddr && !/^https?:\/\/[^\s/]+\S*$/i.test(v))) { msg.hidden = false; msg.textContent = t5(isAddr ? 'svcAddrBad' : 'svcKeyBad'); inp.setAttribute('aria-invalid', 'true'); inp.focus(); return false; }
    const old = r.v; setTimeout(() => {
      r.v = v; SH[r.id] = r.v; let e = null;
      if (isAddr) e = pushLU(t5('luSvc', nm), () => { if (r.v === v) { r.v = old; return ''; } return t5('luSkip'); }, 'svc-add');   // a key never enters undo (DS-027); an address does
      repaint(); if (e) toastUndo(t5('svcAdded', nm), e); else toast(t5('svcAdded', nm), { kind: 'svc-add' }); announce(t5('svcAdded', nm));
    }, 0);
  } };
}

/* ------------------------------------------------------------------ tests (DS-140): a simulated 테스트 per service; new app work */
const VOICE_SVCS = ['elevenlab', 'VOICEVOX', 'openai', 'novelai', 'huggingface', 'fishspeech'];
function plan(kind, s) {   // '' = it works, or the failure code
  const k = kind + ':' + s; const sv = SV[s];
  if (ST.sim.fail[k]) return ST.sim.fail[k];
  const c = conn(s);
  if (kind === 'translate') {   // R5B-3: Google, the AI model and the local engine have no key or address to miss
    const bad = ST.sim.all;
    if (s === 'google') return bad ? 'offline' : '';
    if (s === 'llm') return bad ? 'notrmodel' : '';
    if (s === 'bergamot') return bad ? 'dlfail' : '';
    if (s === 'deepl') return !c.ok ? 'nokey' : bad ? 'badkey' : '';
    return !c.ok ? 'noaddr' : bad ? 'unreachable' : '';
  }
  if (ST.sim.all) {
    if (kind === 'image' && s === 'wavespeed' && !ST.ws.model) return 'nomodel';
    if (kind === 'voice' && s === 'huggingface') return 'warming';
    if (kind === 'image' && (s === 'comfyui' || s === 'comfy')) return 'timeout';
    if (!c.ok) return sv && sv.addr ? 'noaddr' : 'nokey';
    return sv && sv.addr ? 'unreachable' : 'badkey';
  }
  if (kind === 'image' && s === 'wavespeed') { if (!c.ok) return 'nokey'; return ST.ws.model ? '' : 'nomodel'; }
  if (!c.ok) return sv && sv.addr ? 'noaddr' : 'nokey';
  if (kind === 'voice' && s === 'huggingface' && ST.sim.hf503) return 'warming';
  return '';
}
const FAILKEY = { nokey: 'testNoKey', noaddr: 'testNoAddr', unreachable: 'testUnreachable', badkey: 'testBadKey', timeout: 'testTimeout', warming: 'testWarming', nomodel: 'testNoModel', offline: 'testOffline', notrmodel: 'testNoTrModel', dlfail: 'testDlFail' };
const COST = { webui: 0, comfyui: 0, comfy: 0, novelai: 0.02, dalle: 0.04, stability: 0.03, fal: 0.01, 'openai-compat': 0.011, wavespeed: 0.004 };   // Imagen has no number on purpose (DS-147: unknown = none)
const PAID = { voice: ['elevenlab', 'openai', 'novelai', 'huggingface', 'fishspeech'], image: ['novelai', 'dalle', 'stability', 'fal', 'Imagen', 'openai-compat', 'wavespeed'], translate: ['deepl', 'llm'] };
const isPaid = (kind, s) => PAID[kind].indexOf(s) >= 0 && !(s === 'deepl' && rv('models.deeplFree'));
function testFailText(code) { return t5(FAILKEY[code] || 'testUnreachable'); }
function runTest(kind, s) {
  const k = kind + ':' + s; const cur = P.tests[k]; if (cur && cur.s === 'run') return;
  const code = plan(kind, s); P.tests[k] = { s: 'run' }; paintTest(k); announce(t5('testRunning'));
  P.timers[k] = setTimeout(() => {
    delete P.timers[k]; const ms = 1400 + (s.length * 137) % 900;
    P.tests[k] = code ? { s: 'fail', code } : { s: 'ok', ms, cost: (s in COST ? COST[s] : null) };
    paintTest(k); announce(code ? testFailText(code) : t5('testOkShort'));
  }, CFG.testMs);
}
function cancelTest(k) { if (P.timers[k]) { clearTimeout(P.timers[k]); delete P.timers[k]; } P.tests[k] = { s: 'cancel' }; paintTest(k); announce(t5('testCancelled')); }
function clearTests() { Object.keys(P.timers).forEach((k) => { clearTimeout(P.timers[k]); delete P.timers[k]; }); P.tests = {}; if (P.cacheT) { clearTimeout(P.cacheT); P.cacheT = 0; } }
function sampleOut() {   // the sample sentence of the translation test, in the language the translator is set to (synthetic)
  const l = rv('lang.translator'); const m = { ko: '안녕하세요, 만나서 반가워요.', ja: 'こんにちは、はじめまして。', zh: '你好，很高兴认识你。', 'zh-TW': '你好，很高興認識你。', ru: 'Здравствуйте, рад знакомству.', fr: 'Bonjour, ravi de vous rencontrer.', es: 'Hola, encantado de conocerte.', pt: 'Olá, prazer em conhecer você.', de: 'Hallo, schön, Sie kennenzulernen.', id: 'Halo, senang bertemu denganmu.', ms: 'Helo, gembira berjumpa dengan anda.', uk: 'Вітаю, радий знайомству.', fa: 'سلام، از آشنایی با شما خوشحالم.' };
  return m[l] || '';
}
function testBoxHTML(kind, s, o) {
  o = o || {}; const k = kind + ':' + s; const st = P.tests[k] || { s: 'idle' }; const nm = o.name || '';
  const run = st.s === 'run';
  const btn = run ? `<button type="button" class="btn solid p5b-test" data-part="settings-test-button" data-p5b="testcancel" data-key="${esc(k)}" data-fk="t:${esc(k)}" aria-label="${esc(t5('testCancelOf', nm))}" title="${esc(t5('testCancel'))}">${ic('x', 'lg')}<span>${esc(t5('testCancel'))}</span></button>`
    : `<button type="button" class="btn solid p5b-test" data-part="settings-test-button" data-p5b="test" data-kind="${kind}" data-svc="${esc(s)}" data-fk="t:${esc(k)}" aria-label="${esc(t5('testOf', nm))}" title="${esc(t5('testOf', nm))}">${ic(kind === 'voice' ? 'volume-2' : kind === 'image' ? 'image' : 'languages', 'lg')}<span>${esc(t5('test'))}</span></button>`;
  let res = '';
  if (run) res = `<span class="p5b-tres" data-part="settings-service-test-result" data-part-critical data-state="run">${ic('loader', 'md', 'p5b-spin')}<span>${esc(t5(kind === 'voice' ? 'testRunVoice' : kind === 'image' ? 'testRunImage' : 'testRunTr'))}</span>${kind === 'voice' ? waveHTML() : ''}</span>`;
  else if (st.s === 'ok') res = `<span class="p5b-tres" data-part="settings-service-test-result" data-part-critical data-state="ok">${ic('circle-check', 'md')}<span class="p5b-tt">${esc(okText(kind, s, st))}</span></span>${kind === 'image' ? tileHTML(st) : ''}`;
  else if (st.s === 'fail') res = `<span class="p5b-tres" data-part="settings-service-test-result" data-part-critical data-state="fail" data-code="${esc(st.code)}">${ic(st.code === 'warming' ? 'timer' : 'circle-alert', 'md')}<span class="p5b-tt">${esc(testFailText(st.code))}</span></span>`;
  else if (st.s === 'cancel') res = `<span class="p5b-tres" data-part="settings-service-test-result" data-part-critical data-state="cancel">${ic('ban', 'md')}<span class="p5b-tt">${esc(t5('testCancelled'))}</span></span>`;
  const notice = (cls, ico, txt) => `<p class="${cls}" data-part="settings-notice" data-part-critical>${ic(ico, 'sm')}<span>${esc(txt)}</span></p>`;
  const notes = (kind === 'voice' ? notice('p5b-tvoice', 'volume-2', voiceTestLine(s)) : '') + (isPaid(kind, s) ? notice('p5b-paid', 'circle-alert', t5('testPaid')) : '');   // DS-144: whose voice, and that it may cost money, before it runs and without a confirm
  return `<div class="p5b-tbox" data-testbox="${esc(k)}"><div class="p5b-trow">${btn}<p class="p5b-tline" role="status" aria-live="polite">${res}</p></div>${notes}</div>`;
}
function voiceTestLine(s) {   // the test speaks with the active character's voice on this engine, else the first character that uses it, else the service's default
  const a = activeChar(); const v = ST.voices.find((x) => a && x.id === a.id && x.engine === s) || ST.voices.find((x) => x.engine === s);
  return v ? t5('testVoiceUses', charName(charOf(v.id)), v.voice || t5('vcAuto')) : t5('testVoiceDefault');
}
function okText(kind, s, st) {
  if (kind === 'voice') return t5('testOkVoice');
  if (kind === 'image') return st.cost === null ? t5('testOkImageNoCost', (st.ms / 1000).toFixed(1)) : t5('testOkImage', (st.ms / 1000).toFixed(1), st.cost ? '$' + st.cost.toFixed(3) : t5('costFree'));
  return t5('testOkTr', sampleOut());
}
const waveHTML = () => `<span class="p5b-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>`;
const tileHTML = () => `<span class="p5b-tile" aria-hidden="true">${ic('image', 'xl')}</span>`;
function paintTest(k) {
  const el = $(`#pageScroll [data-testbox="${CSS.escape(k)}"]`); if (!el) return; const had = el.contains(document.activeElement);
  const kind = k.split(':')[0], s = k.slice(kind.length + 1); const nm = el.dataset.name || ''; const tmp = document.createElement('div'); tmp.innerHTML = testBoxHTML(kind, s, { name: nm }); const nu = tmp.firstElementChild; if (nm) nu.dataset.name = nm; el.replaceWith(nu);
  if (had) { const b = $('[data-fk="t:' + k + '"]', nu); if (b) b.focus({ preventScroll: true }); }
}
const tbox = (kind, s, name) => testBoxHTML(kind, s, { name }).replace('<div class="p5b-tbox"', `<div class="p5b-tbox" data-name="${esc(name)}"`);

/* ------------------------------------------------------------------ undo for plain rows (a switch, a select, a typed value): one step per committed change */
const pkOf = (r) => (r.pkey ? (ST[r.pkey] || ST[r.pact]) : '');   // the preset a template row reads and writes (the one open in an editor, else the active one)
const shKey = (r) => r.id + (r.pkey ? '@' + pkOf(r) : '');
function shadow(r) { const k = shKey(r); if (!(k in SH)) SH[k] = r.v; }
function commitRow(r, fresh) {   // r.v has just changed (slice 1 wrote it): one undo step from the last committed value; typing in one field is one step (an explicit action such as a reset is never merged)
  const k = shKey(r); const from = SH[k], to = r.v; if (from === undefined || from === to) { SH[k] = to; return; }
  const pid = pkOf(r); const prev = P.lu[k]; const now = Date.now();
  if (!fresh && prev && prev.e && B.LU.indexOf(prev.e) >= 0 && now - prev.t < CFG.coalesceMs && B.LU[B.LU.length - 1] === prev.e) { prev.to = to; prev.t = now; SH[k] = to; return; }
  const rec = { to, t: now, e: null };
  rec.e = pushLU(t5('luEdit', lab(r)), () => {
    const saved = r.pkey ? ST[r.pkey] : ''; if (r.pkey) { if (!(r.pkey === 'editId' ? pmById('mem', pid) : pmById('tr', pid))) return t5('luSkip'); ST[r.pkey] = pid; }
    const cur = r.v; let note = t5('luSkip'); if (cur === rec.to) { r.v = from; SH[k] = from; note = ''; } if (r.pkey) ST[r.pkey] = saved; return note;
  }, 'p5b-edit'); P.lu[k] = rec; SH[k] = to;
}
function setRow(r, v) {   // an outside or scripted write to a row (the store): same as typing, with the side effects
  r.v = v; SH[shKey(r)] = v; P.writes++;
}

/* ------------------------------------------------------------------ page frame and shared pieces */
function headHTML(pid, extra) {
  const Pg = A.PAGE[pid]; let h = `<div class="pg p5b p5b-${pid}" data-page="${pid}" data-part="settings-page-body"><div class="pg-head" data-part="settings-page-header"><h1 class="pg-title" id="pgTitle" tabindex="-1">${esc(A.L(Pg))}</h1>`;
  if (A.S.notice) h += `<p class="banner warn" data-part="settings-warning-banner" data-part-critical role="status">${ic('info', 'lg')}<span>${esc(A.S.notice)}</span></p>`;
  return h + (extra || '') + '</div>';
}
function subHead(page, title, sub) {
  return `<div class="pg p5b p5b-sub" data-page="${page}" data-view="${P.sub.kind}" data-part="settings-page-body"><div class="pg-head" data-part="settings-page-header"><h1 class="pg-title" id="pgTitle" tabindex="-1">${esc(title)}</h1>${sub || ''}</div>`;
}
const secOpen = (id, title, cls) => `<section class="sec${cls ? ' ' + cls : ''}" id="sec-${id}" data-sec="${id}" data-part="settings-section" aria-labelledby="h-${id}"><h2 class="sec-h" id="h-${id}" data-part="settings-section-title" tabindex="-1">${esc(title)}</h2>`;
const subSec = (id, title) => `<section class="sec" id="sec-${id}" data-sec="${id}" data-part="settings-section" aria-labelledby="h-${id}"><h2 class="sec-h" id="h-${id}" data-part="settings-section-title" tabindex="-1">${esc(title)}</h2>`;
function revealNote(r) {   // a search hit on a row that is not available now: slice 1's explanation, with the way to the switch
  const un = unavail(r); if (!un) return ''; const sw = un.goto ? R(un.goto) : null;
  return `<div class="row unavail-note" data-row="${esc(r.id)}" data-row-kind="unavailable" data-part="settings-row" role="group" aria-labelledby="l-${esc(r.id)}" tabindex="-1">${ic('triangle-alert', 'lg')}<div class="un-body"><p data-part="settings-row-label" class="r-label" id="l-${esc(r.id)}">${esc(lab(r))}</p><p data-part="settings-row-description" class="r-desc">${esc(un.text)}</p>` +
    (sw ? `<button type="button" data-part="settings-button" class="btn solid un-go" data-goto="${esc(un.goto)}" data-ctl><span>${esc(A.t('goToSwitch', lab(sw)))}</span>${ic('chevron-right', 'md')}</button>` : '') + '</div></div>';
}
function rowF(r, o) {   // a row of the catalogue rendered by slice 1 (changed dot, ⋯ reset, help); a number field gets its step and an error slot, a dimmed row is read-only with its reason (DS-096)
  o = o || {}; shadow(r);
  if (r.id === 'chatfeat.hv3.extraSummarizationRatio') r.max = Math.max(0, 100 - R('chatfeat.hv3.memoryTokensRatio').v);
  let h = A.rowHTML(o.asText ? Object.assign({}, r, { type: 'text' }) : r);
  if (r.ph) h = h.replace(/<(textarea|input) /, (m, t) => `<${t} placeholder="${esc(t5('phDefault'))}" `);   // blank = the built-in default: the placeholder says so, it never shows an invented prompt (R5B-2)
  if (r.type === 'slider' && r.pct && o.vt) h = h.replace(/aria-valuetext="(\d+%)"/, `aria-valuetext="${esc(o.vt)}$1"`);
  if (o.dim) {   // DS-096: a dimmed row is read-only and says why; its reset menu goes (nothing can change it from here)
    h = h.replace(/<textarea /, '<textarea readonly aria-readonly="true" data-dim ').replace(/^<div class="row/, '<div class="row p5b-dimrow').replace(/<button[^>]*class="btn r-more[^>]*>[\s\S]*?<\/button>/, '').replace(/<\/div>$/, `<p class="p5b-reason" id="dr-${esc(r.id)}" data-part="settings-dim-reason" data-part-critical>${ic('circle-alert', 'sm')}<span class="p5b-rt">${esc(o.dim)}</span></p></div>`);
  }
  return h;
}
function secBody(items) { return `<div class="rows" data-part="settings-rows">${items.join('')}</div>`; }
function noteLine(cls, icon, text, part) { return `<p class="p5b-note ${cls || ''}"${part ? ` data-part="${part}"` : ''}>${ic(icon || 'info', 'sm')}<span>${esc(text)}</span></p>`; }
function goBtn(target, ret, text, icon, fk) { return `<button type="button" class="btn p5b-lnk" data-part="settings-button" data-p5b="goto" data-target="${esc(target)}" data-ret="${esc(ret || '')}" data-fk="go:${esc(fk || target)}">${ic(icon || 'chevron-right', 'md')}<span>${esc(text)}</span></button>`; }
function goRow(target, ret) {   // a jump to a row of another page: Back returns to the row it was started from (slice 1's retRow)
  const r = R(target); if (!r) return; A.openRow(r, { fromJump: true, fromSearch: false }); A.S.retRow = ret && R(ret) ? ret : null;
}
function taskModelName(rowId) { const id = C3.resolved(rowId); const m = id ? C3.modelById(id) : null; return m ? C3.mname(m) : '—'; }
const embOf = (v) => EMB.find((e) => e[0] === v) || EMB[0];
const embName = (v) => { const e = embOf(v); return pick(e[1], e[2]); };
const embGroup = (v) => embOf(v)[3];
function choiceHTML(o) {   // a native radio group: legend, one sentence per option linked with aria-describedby, text marks (not only colour)
  return `<fieldset class="p5b-choices" data-part="settings-choice-list" data-row="${esc(o.row)}"><legend class="p5b-leg">${esc(o.legend)}</legend>` + o.items.map((it) => {
    const id = 'ch-' + o.row.replace(/\./g, '-') + '-' + String(it.v).replace(/[^\w-]/g, '_'); const on = it.v === o.cur;
    return `<div class="p5b-optw${on ? ' cur' : ''}" data-part="settings-choice"${o.pid ? ` data-p5bid="${o.pid}:${esc(it.v)}"` : ''}><label class="p5b-opt${on ? ' cur' : ''}" data-v="${esc(it.v)}"><input type="radio" class="p5b-rad" name="${esc(o.row)}" value="${esc(it.v)}" data-p5b="radio" data-rowid="${esc(o.row)}" data-fk="rd:${esc(o.row)}:${esc(it.v)}"${on ? ' checked data-ctl' : ''} aria-describedby="${id}"><span class="p5b-ob"><span class="p5b-on">${esc(it.label)}${it.tags || ''}</span><span class="p5b-od" id="${id}">${esc(it.desc || '')}</span></span></label>${it.after ? `<div class="p5b-optx">${it.after}</div>` : ''}</div>`;
  }).join('') + '</fieldset>';
}
const tagRec = () => `<span class="chip p5b-tag rec" data-part="settings-choice-recommended">${esc(t5('tagRec'))}</span>`;
const tagOld = () => `<span class="chip p5b-tag old" data-part="settings-choice-legacy" data-part-critical>${ic('history', 'sm')}<span>${esc(t5('tagOld'))}</span></span>`;

/* ------------------------------------------------------------------ preset managers: HypaV3 presets (DS-136) and AI translator presets share one bar */
const PM = {
  mem: { arr: () => ST.presets, act: () => ST.presetActive, set: (id) => { ST.presetActive = id; }, name: (p) => p.name, label: 'pmLabelMem', bar: 'pmBarMem', newName: 'pmNewNameMem', ext: '.json', pre: 'hp', mk(name) { return DB.mkHv('hp' + (100 + (++ST.seq)), name); }, copy(p, name) { return { id: 'hp' + (100 + (++ST.seq)), name, settings: Object.assign({}, p.settings) }; } },
  tr: { arr: () => ST.trPresets, act: () => ST.trActive, set: (id) => { ST.trActive = id; }, name: (p) => p.name, label: 'pmLabelTr', bar: 'pmBarTr', newName: 'pmNewNameTr', ext: '.risutl', pre: 'tp', mk(name) { return { id: 'tp' + (100 + (++ST.trSeq)), name, prompt: '', maxResponse: 1000 }; }, copy(p, name) { return { id: 'tp' + (100 + (++ST.trSeq)), name, prompt: p.prompt, maxResponse: p.maxResponse }; } },
};
const pmAct = (k) => { const M = PM[k]; return M.arr().find((p) => p.id === M.act()) || M.arr()[0]; };
const pmById = (k, id) => PM[k].arr().find((p) => p.id === id) || null;
const pmTaken = (k, name, except) => PM[k].arr().some((p) => p.id !== except && p.name.trim().toLowerCase() === name.trim().toLowerCase());
function pmUnique(k, base) { if (!pmTaken(k, base)) return base; let i = 2; while (pmTaken(k, base + ' ' + i)) i++; return base + ' ' + i; }
function presetBar(k) {
  const M = PM[k]; const arr = M.arr(); const a = pmAct(k); const last = arr.length <= 1;
  return `<div class="p5b-pbar" data-part="settings-preset-bar" role="group" aria-labelledby="p5b-pl-${k}"><span class="p5b-plab" id="p5b-pl-${k}">${esc(t5(M.label))}</span>` +
    `<button type="button" class="btn p5b-psel" data-part="settings-button" data-p5b="pm-choose" data-pm="${k}" data-fk="pm:${k}:sel" aria-haspopup="menu" aria-label="${esc(t5('pmChooseAria', a.name))}" title="${esc(t5('pmChooseAria', a.name))}"><span class="p5b-pn">${esc(a.name)}</span>${ic('chevrons-up-down', 'md')}</button>` +
    `<button type="button" class="btn solid p5b-pedit" data-part="settings-button" data-p5b="pm-edit" data-pm="${k}" data-fk="pm:${k}:edit" aria-label="${esc(t5('pmEditAria', a.name))}" title="${esc(t5('pmEditAria', a.name))}">${ic('sliders-horizontal', 'lg')}<span>${esc(t5('pmEdit'))}</span></button>` +
    `<button type="button" class="btn p5b-more" data-part="settings-button" data-p5b="pm-menu" data-pm="${k}" data-fk="pm:${k}:menu" aria-haspopup="menu" aria-label="${esc(t5('pmMenuAria'))}" title="${esc(t5('pmMenuAria'))}">${ic('ellipsis', 'xl')}</button></div>` +
    (last ? `<p class="p5b-guard" id="p5b-guard-${k}" data-part="settings-preset-guard" data-part-critical role="note">${ic('triangle-alert', 'md')}<span>${esc(t5('pmLast'))}</span></p>` : '');
}
function pmChooseMenu(k, anchor) {
  const M = PM[k]; A.showMenu(M.arr().map((p) => ({ icon: p.id === M.act() ? 'check' : 'bookmark', label: p.name, fn: () => pmChoose(k, p.id) })), anchor, null, anchor, t5('pmChooseMenu'));
}
function pmChoose(k, id) {
  const M = PM[k]; const p = pmById(k, id); const was = M.act(); if (!p || was === id) { announce(t5('pmSame')); return; }
  M.set(id); const e = pushLU(t5('luPmChoose', t5(M.label)), () => { if (pmById(k, was)) M.set(was); return ''; }, 'p5b-preset');
  repaint('pm:' + k + ':sel'); toastUndo(t5('pmChosen'), e, { sub: p.name }); announce(t5('pmChosen') + ' ' + p.name);
}
function nameDialog(o) {   // a name field with a live duplicate check (DS-136: create asks for a name); Enter confirms
  const d = A.openDialog({ title: o.title, body: `<label class="dlg-l" for="p5b-nm">${esc(o.label)}</label><input id="p5b-nm" class="inp" data-part="settings-field" type="text" maxlength="40" autocomplete="off" spellcheck="false" value="${esc(o.value)}" aria-describedby="p5b-nmh"><p class="dlg-hint warn" id="p5b-nmh" role="status" hidden>${esc(t5('pmNameTaken'))}</p>`, buttons: [{ id: 'cancel', label: t5('cancel') }, { id: 'ok', label: o.ok, primary: true }], initial: '#p5b-nm', onClose: o.onClose });
  const inp = $('#p5b-nm', d.back), btn = $('[data-dlg="ok"]', d.back), hint = $('#p5b-nmh', d.back);
  const upd = () => { const v = inp.value.trim(); const bad = !v || o.taken(v); btn.setAttribute('aria-disabled', bad ? 'true' : 'false'); hint.hidden = !(v && o.taken(v)); };
  inp.addEventListener('input', upd); inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.isComposing && ev.keyCode !== 229) { ev.preventDefault(); if (btn.getAttribute('aria-disabled') !== 'true') btn.click(); } }); inp.select(); upd();
  A.openDialog.handlers = { ok: () => { const v = inp.value.trim(); if (!v || o.taken(v)) return false; setTimeout(() => o.done(v), 0); } };
  return d;
}
function pmNew(k) {
  const M = PM[k]; const was = M.act();
  nameDialog({ title: t5('pmNewT'), label: t5('pmName'), value: pmUnique(k, t5(M.newName)), ok: t5('pmCreate'), taken: (v) => pmTaken(k, v), onClose: () => { focusFk('pm:' + k + ':menu'); },
    done: (v) => { const p = M.mk(v); M.arr().push(p); M.set(p.id); const e = pushLU(t5('luPmNew', t5(M.label)), () => { const i = M.arr().indexOf(p); if (i >= 0) M.arr().splice(i, 1); if (M.act() === p.id) M.set(pmById(k, was) ? was : M.arr()[0].id); return ''; }, 'p5b-preset'); repaint('pm:' + k + ':sel'); toastUndo(t5('pmCreated'), e, { sub: p.name }); announce(t5('pmCreated') + ' ' + p.name); } });
}
function pmDup(k) {
  const M = PM[k]; const src = pmAct(k); const was = M.act(); const p = M.copy(src, pmUnique(k, t5('pmCopyName', src.name))); const i = M.arr().indexOf(src); M.arr().splice(i + 1, 0, p); M.set(p.id);
  const e = pushLU(t5('luPmDup', t5(M.label)), () => { const j = M.arr().indexOf(p); if (j >= 0) M.arr().splice(j, 1); if (M.act() === p.id) M.set(pmById(k, was) ? was : M.arr()[0].id); return ''; }, 'p5b-preset');
  repaint('pm:' + k + ':sel'); toastUndo(t5('pmDuped'), e, { sub: p.name }); announce(t5('pmDuped') + ' ' + p.name);
}
function pmRename(k) {
  const M = PM[k]; const p = pmAct(k); const old = p.name;
  nameDialog({ title: t5('pmRenameT'), label: t5('pmName'), value: old, ok: t5('pmRenameDo'), taken: (v) => pmTaken(k, v, p.id), onClose: () => { focusFk('pm:' + k + ':menu'); },
    done: (v) => { if (v === old) return; p.name = v; const e = pushLU(t5('luPmRename', old), () => { if (p.name === v) p.name = old; return ''; }, 'p5b-preset'); A.buildIndex(); repaint('pm:' + k + ':menu'); toastUndo(t5('pmRenamed'), e, { sub: v }); announce(t5('pmRenamed') + ' ' + v); } });
}
function pmExport(k) {
  const M = PM[k]; const p = pmAct(k);
  const text = k === 'mem' ? JSON.stringify({ type: 'risu', ver: 1, data: p }, null, 1) : 'risutl-synthetic\n' + JSON.stringify({ name: p.name, prompt: p.prompt, maxResponse: p.maxResponse }, null, 1);
  download((k === 'mem' ? 'hypaV3_export_' : 'translator_') + p.name.replace(/[<>:"/\\|?*.,]/g, '') + M.ext, text); toast(t5('pmExported'), { sub: p.name }); announce(t5('pmExported') + ' ' + p.name);
}
function pmImport(k) {
  const M = PM[k]; const files = FILES[k === 'mem' ? 'hypa' : 'tr']; let sel = '';
  const body = () => `<p>${esc(t5('pmImportPick'))}</p><ul class="p5b-files" role="list">${files.map((f) => `<li><label class="p5b-filel"><input type="radio" name="p5b-file" data-pf="${f.id}"${sel === f.id ? ' checked' : ''}><span>${esc(f.file)}</span></label></li>`).join('')}</ul><p class="p5b-fmsg" id="p5b-fmsg" role="alert" aria-live="assertive"></p>`;
  const d = A.openDialog({ title: t5('pmImportT'), body: body(), buttons: [{ id: 'cancel', label: t5('cancel') }, { id: 'ok', label: t5('pmImportDo'), primary: true, disabled: true }], initial: '[data-pf]', onClose: () => { focusFk('pm:' + k + ':menu'); } });
  const paint = () => { const f = files.find((x) => x.id === sel); const btn = $('[data-dlg="ok"]', d.back); const m = $('#p5b-fmsg', d.back); btn.setAttribute('aria-disabled', f && f.ok ? 'false' : 'true'); m.textContent = !f ? '' : f.ok ? t5('pmImportOkLine', f.name) : t5(f.kind === 'broken' ? 'pmImportBroken' : 'pmImportForeign'); m.className = 'p5b-fmsg' + (f && !f.ok ? ' bad' : ''); };
  d.back.addEventListener('change', (ev) => { const c = ev.target.closest('[data-pf]'); if (c) { sel = c.dataset.pf; paint(); } });
  A.openDialog.handlers = { ok: () => { const f = files.find((x) => x.id === sel); if (!f || !f.ok) return false;
    setTimeout(() => { const was = M.act(); const nm = pmUnique(k, f.name); const p = k === 'mem' ? Object.assign(M.mk(nm), { settings: Object.assign(DB.HV3_DEF(), { memoryTokensRatio: 0.1, maxChatsPerSummary: 12 }) }) : Object.assign(M.mk(nm), { prompt: f.prompt, maxResponse: f.maxResponse });
      M.arr().push(p); M.set(p.id); const e = pushLU(t5('luPmImport', t5(M.label)), () => { const j = M.arr().indexOf(p); if (j >= 0) M.arr().splice(j, 1); if (M.act() === p.id) M.set(pmById(k, was) ? was : M.arr()[0].id); return ''; }, 'p5b-preset'); A.buildIndex(); repaint('pm:' + k + ':sel'); toastUndo(t5('pmImported'), e, { sub: nm }); }, 0); } };
  return d;
}
function pmDelete(k) {
  const M = PM[k]; const p = pmAct(k); if (M.arr().length <= 1) { announce(t5('pmLast')); return; }
  ask({ title: t5('pmDelT'), body: `<p class="p5b-dname">${esc(p.name)}</p><p>${esc(t5('pmDelBody'))}</p>`, ok: t5('pmDelDo'), danger: true, onClose: () => { focusFk('pm:' + k + ':menu') || focusFk('pm:' + k + ':sel'); }, onOk: () => {
    const i = M.arr().indexOf(p); const wasAct = M.act() === p.id; M.arr().splice(i, 1); if (wasAct) M.set(M.arr()[0].id);   // today: the first preset becomes the active one
    const e = pushLU(t5('luPmDel', p.name), () => { if (M.arr().indexOf(p) < 0) M.arr().splice(Math.min(i, M.arr().length), 0, p); if (wasAct) M.set(p.id); return ''; }, 'p5b-delete');
    A.buildIndex(); repaint('pm:' + k + ':sel'); toastUndo(t5('pmDeleted'), e, { kind: 'delete', sub: p.name }); announce(t5('pmDeleted') + ' ' + p.name); } });
}
function pmMenu(k, anchor) {
  const last = PM[k].arr().length <= 1;
  A.showMenu([{ icon: 'plus', label: t5('pmNew'), fn: () => pmNew(k) }, { icon: 'copy', label: t5('pmDup'), fn: () => pmDup(k) }, { icon: 'pencil', label: t5('pmRename'), fn: () => pmRename(k) }, { icon: 'download', label: t5('pmExport', PM[k].ext), fn: () => pmExport(k) }, { icon: 'upload', label: t5('pmImport'), fn: () => pmImport(k) }, { icon: 'trash-2', label: t5('pmDelete'), disabled: last, fn: () => pmDelete(k) }], anchor, null, anchor, t5('pmMenuAria'));
}

/* ------------------------------------------------------------------ 장기 기억 (DS-129, DS-135, DS-136, DS-138) */
const ENGDESC = { none: 'engNone', hypav3: 'engV3', hanurai: 'engHanurai', hypav2: 'engV2', supa: 'engSupa' };
const ENGNAME = { none: 'engNoneN', hypav3: 'HypaMemory V3', hanurai: 'HanuraiMemory', hypav2: 'HypaMemory V2', supa: 'SupaMemory' };
const engName = (e) => (e === 'none' ? t5('engNoneN') : ENGNAME[e]);
const SUMMODEL_MB = { distilbart: 270 };
const dlText = (mb) => (mb ? t5('costDownload', fmtInt(mb) + ' MB') : t5('costDownloadNoSize'));
const GPU_MB = { 'qwen3-1.7b': 1100, 'qwen3-4b': 2500, 'qwen3-8b': 5000 };
function embLine(withChat) {
  const v = rv('models.embedModel'); return `<p class="p5b-embline" data-part="settings-embedding-line">${ic('database', 'sm')}<span>${esc(t5('memEmbA', embName(v)))}</span>${goBtn('models.embedModel', 'chatfeat.memEngine', t5('memEmbGo'), 'chevron-right', 'emb')}<span>${esc(t5(withChat ? 'memEmbB' : 'memEmbC'))}</span></p>` +
    (embGroup(v) === 'cpu' || embGroup(v) === 'gpu' ? `<p class="p5b-cost" data-part="settings-cost-line" data-part-critical>${ic('hard-drive-download', 'sm')}<span>${esc(dlText(embOf(v)[4]))}</span></p>` : '');
}
function sumCost(model) {   // the cost lines of a summary model (design default: today shows none)
  if (model === 'distilbart') return `<p class="p5b-cost" data-part="settings-cost-line" data-part-critical>${ic('hard-drive-download', 'sm')}<span>${esc(t5('costDownload', SUMMODEL_MB.distilbart + ' MB'))}</span></p>`;
  if (GPU_MB[model]) return `<p class="p5b-cost" data-part="settings-cost-line" data-part-critical>${ic('hard-drive-download', 'sm')}<span>${esc(t5('costDownload', fmtInt(GPU_MB[model]) + ' MB'))}</span></p>`;
  if (model === 'instruct35') return `<div class="p5b-needrow">${chipHTML('openai', 'chatfeat.memEngine')}<span class="p5b-nr">${esc(t5('memNeedOpenai'))}</span></div><p class="p5b-cost" data-part="settings-cost-line" data-part-critical>${ic('info', 'sm')}<span>${esc(t5('costRequests'))}</span></p>`;
  return `<p class="p5b-cost" data-part="settings-cost-line" data-part-critical>${ic('info', 'sm')}<span>${esc(t5('costRequests'))}</span></p><div class="p5b-memmodel"><span>${esc(t5('memModelIs', taskModelName('models.memModel')))}</span>${goBtn('models.memModel', 'chatfeat.memEngine', t5('memModelGo'), 'chevron-right', 'mm')}</div>`;
}
function v3Summary() {
  const s = pmAct('mem').settings; const m = Math.round(s.memoryTokensRatio * 100), r = Math.round(s.recentMemoryRatio * 100), si = Math.round(s.similarMemoryRatio * 100);
  const sm = s.summarizationModel === 'subModel' ? t5('memSumMem', taskModelName('models.memModel')) : pick(R('chatfeat.hv3.summarizationModel').opt.find((o) => o[0] === s.summarizationModel)[1], R('chatfeat.hv3.summarizationModel').opt.find((o) => o[0] === s.summarizationModel)[2]);
  return `<ul class="p5b-psum" data-part="settings-preset-summary" aria-label="${esc(t5('pmSumAria', pmAct('mem').name))}"><li>${esc(t5('pmSumRatio', m))}</li><li>${esc(t5('pmSumShares', r, si, Math.max(0, 100 - r - si)))}</li><li>${esc(t5('pmSumModel', sm))}</li></ul>`;
}
function engineBlock(e) {
  let h = '';
  if (e === 'hypav3') h = presetBar('mem') + v3Summary() + sumCost(pmAct('mem').settings.summarizationModel === 'subModel' ? 'subModel' : pmAct('mem').settings.summarizationModel) + embLine(true);
  else if (e === 'hanurai') h = rowF(R('chatfeat.hanuraiTokens')) + rowF(R('chatfeat.hanuraiSplit')) + embLine(true);
  else if (e === 'hypav2') h = rowF(R('chatfeat.supaModelType')) + sumCost(rv('chatfeat.supaModelType')) + rowF(R('chatfeat.hypaChunkSize')) + rowF(R('chatfeat.hypaAllocatedTokens')) + rowF(R('chatfeat.supaMemoryPrompt')) + embLine(true);
  else if (e === 'supa') h = rowF(R('chatfeat.supaModelType')) + sumCost(rv('chatfeat.supaModelType')) + rowF(R('chatfeat.maxSupaChunkSize')) + rowF(R('chatfeat.supaMemoryPrompt'), { asText: true }) + rowF(R('chatfeat.hypaMemory')) + (rv('chatfeat.hypaMemory') ? embLine(true) : '');
  return `<div class="p5b-eng" data-eng="${e}">${h}</div>`;
}
function memHTML(o) {
  const e = rv('chatfeat.memEngine'); const rev = o && o.reveal && R(o.reveal) && R(o.reveal).sec === 'chatfeat.memory' ? revealNote(R(o.reveal)) : '';
  const items = ENG_ORDER.map((v) => ({ v, label: engName(v), desc: t5(ENGDESC[v]), tags: (v === 'hypav3' ? tagRec() : '') + (v === 'hypav2' || v === 'supa' ? tagOld() : '') }));
  return secOpen('chatfeat.memory', A.L(A.SEC['chatfeat.memory'])) + secBody([rev, choiceHTML({ row: 'chatfeat.memEngine', legend: t5('memLegend'), items, cur: e, pid: 'eng' }), `<p class="p5b-status" id="p5b-memstatus">${ic('message-square', 'sm')}<span>${esc(t5('memPerChat'))}</span></p>`, `<p class="p5b-status" id="p5b-memalways">${ic('toggle-right', 'sm')}<span>${esc(t5('memAlways'))}</span></p>`, engineBlock(e)]) + '</section>';
}
const ENG_ORDER = ['none', 'hypav3', 'hanurai', 'hypav2', 'supa'];
function setEngine(v) {   // live save: the five derived fields are written together, one undo step restores all five
  const R0 = R('chatfeat.memEngine'); const from = DB.MF_KEYS.map((k) => DB.ST.mf[k]); const was = R0.v; if (v === was) return;
  R0.v = v; const to = DB.MF_KEYS.map((k) => ST.mf[k]);
  const e = pushLU(t5('luEngine'), () => { if (JSON.stringify(DB.MF_KEYS.map((k) => ST.mf[k])) !== JSON.stringify(to)) return t5('luSkip'); DB.MF_KEYS.forEach((k, i) => { ST.mf[k] = from[i]; }); return ''; }, 'p5b-engine');
  P.writes++; A.buildIndex(); repaint('rd:chatfeat.memEngine:' + v); toastUndo(t5('engSwitched', engName(v)), e, { kind: 'p5b-engine' }); announce(t5('engSwitched', engName(v)));
}

/* ------------------------------------------------------------------ the HypaV3 preset editor (view=memory-preset, DS-136, DS-138) */
const HV = (f) => R('chatfeat.hv3.' + f);
function ratioBarHTML(s) {
  const r = Math.round(s.recentMemoryRatio * 100), si = Math.round(s.similarMemoryRatio * 100), rest = Math.max(0, 100 - r - si);
  return `<div class="p5b-ratio" data-part="settings-ratio-bar" role="group" aria-labelledby="p5b-rt"><p class="p5b-rtitle" id="p5b-rt">${esc(t5('ratTitle'))}</p>` +
    `<svg class="p5b-rbar" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true" focusable="false"><rect class="s-recent" x="0" y="0" width="${r}" height="6"/><rect class="s-similar" x="${r}" y="0" width="${si}" height="6"/><rect class="s-random" x="${r + si}" y="0" width="${rest}" height="6"/></svg>` +
    `<ul class="p5b-rleg"><li><i class="k-recent"></i><span>${esc(t5('ratRecent', r))}</span></li><li><i class="k-similar"></i><span>${esc(t5('ratSimilar', si))}</span></li><li><i class="k-random"></i><span>${esc(t5('ratRandom', rest))}</span></li></ul>` +
    `</div><p class="p5b-remain" id="p5b-remain" data-part="settings-ratio-remainder" data-part-critical role="status" aria-live="polite">${esc(t5('ratRemain', rest))}</p>`;   // the remainder (the random share) stays outside the hideable bar (R5B-5)
}
function ratioRow(f, vt) {   // a slider row of slice 1 plus a number field; the bar above and the remainder below follow
  const r = HV(f); let h = rowF(r, { vt });
  h = h.replace(/(<output for="[^"]*"[^>]*>[^<]*<\/output>)/, `$1<input type="number" class="inp num p5b-pct" data-part="settings-field" data-p5b="pct" data-rowid="${esc(r.id)}" data-fk="pc:${esc(r.id)}" min="0" max="100" step="1" inputmode="numeric" value="${r.v}" aria-label="${esc(lab(r) + ' (%)')}">`).replace('<div class="row ', '<div class="row p5b-ratiorow ');
  return h;
}
function maxRatioHTML() {
  const has = !!activeChar(); const s = pmAct('mem').settings; const val = has ? Math.max(0, Math.round((0.9 - 0.18 - Math.min(0.3, s.memoryTokensRatio / 2)) * 100)) : 0;
  return `<div class="row p5b-maxrow" data-row="chatfeat.hv3.maxMemoryRatio" data-part="settings-row"><div class="r-main"><div class="r-text"><div class="r-title"><span class="r-label" data-part="settings-row-label">${esc(t5('maxTitle'))}</span></div><p class="r-desc" data-part="settings-row-description">${esc(has ? t5('maxHave', charName(activeChar())) : t5('maxNone'))}</p></div><div class="r-ctl" data-part="settings-row-control"><output class="p5b-maxv" data-part="settings-readout">${has ? esc(val + '%') : '—'}</output></div></div></div>`;
}
function memPresetHTML() {
  const id = P.sub.id; const p = pmById('mem', id); if (!p) return null; ST.editId = id; const s = p.settings; const act = p.id === ST.presetActive;
  const ex = !!s.useExperimentalImpl; const gpuOpts = FL.gpu;
  const sm0 = HV('summarizationModel'); const sumModel = gpuOpts ? sm0 : Object.assign({}, sm0, { opt: sm0.opt.filter((o) => o[0] === 'subModel' || o[0] === s.summarizationModel) });
  const adv = [rowF(HV('useExperimentalImpl')), rowF(HV('alwaysToggleOn'))];
  if (ex) ['summarizationRequestsPerMinute', 'summarizationMaxConcurrent', 'embeddingRequestsPerMinute', 'embeddingMaxConcurrent'].forEach((f) => adv.push(rowF(HV(f)))); else adv.push(rowF(HV('enableSimilarityCorrection')));
  const rev = ''; void rev;
  return subHead('chatfeat', p.name, `<p class="p5b-subnote">${esc(act ? t5('pedActive') : t5('pedNotActive'))}</p>`) +
    subSec('mp-sum', t5('pedSumSec')) + secBody([rowF(sumModel), sumCost(s.summarizationModel === 'subModel' ? 'subModel' : s.summarizationModel), rowF(HV('summarizationPrompt')), rowF(HV('reSummarizationPrompt')), rowF(HV('summaryChunkSeparator')), `<p class="p5b-note" data-part="settings-note">${ic('info', 'sm')}<span>${esc(t5('pedSepHelpA'))} <code class="p5b-code">\\n</code>${esc(t5('pedSepHelpB'))} <code class="p5b-code">${esc(s.summaryChunkSeparator)}</code></span></p>`, rowF(HV('maxChatsPerSummary')), rowF(HV('doNotSummarizeUserMessage')), rowF(HV('processRegexScript')), rowF(HV('preserveOrphanedMemory'))]) + '</section>' +
    subSec('mp-ratio', t5('pedRatioSec')) + secBody([rowF(HV('memoryTokensRatio')), rowF(HV('extraSummarizationRatio')), ratioBarHTML(s), ratioRow('recentMemoryRatio', t5('ratVtRecent') + ' '), ratioRow('similarMemoryRatio', t5('ratVtSimilar') + ' '), rowF(HV('queryChatCount')), maxRatioHTML()]) + '</section>' +
    subSec('mp-adv', t5('pedAdvSec')) + `<details class="p5b-details" id="p5b-adv" data-part="settings-disclosure"${P.open.adv ? ' open' : ''}><summary class="p5b-sum" data-fk="adv:sum">${esc(t5('pedAdvSum'))}</summary>${secBody(adv)}</details></section>` +
    `<div class="p5b-acts"><button type="button" class="btn solid${act ? '' : ' accent'}" data-part="settings-button" data-p5b="mp-use" data-fk="mp:use"${act ? ' aria-disabled="true"' : ''}>${ic(act ? 'check' : 'bookmark', 'md')}<span>${esc(act ? t5('pedUsed') : t5('pedUse'))}</span></button><button type="button" class="btn solid" data-part="settings-button" data-p5b="mp-reset" data-fk="mp:reset">${ic('rotate-ccw', 'md')}<span>${esc(t5('pedResetAll'))}</span></button></div></div>`;
}
function mpResetAll() {
  const p = pmById('mem', P.sub && P.sub.id); if (!p) return; const from = Object.assign({}, p.settings); const to = DB.HV3_DEF();
  if (JSON.stringify(from) === JSON.stringify(to)) { announce(t5('pedResetNone')); toast(t5('pedResetNone'), { ms: 3000 }); return; }
  p.settings = to; Object.keys(SH).forEach((k) => { if (k.indexOf('@' + p.id) > 0) delete SH[k]; });
  const e = pushLU(t5('luPedReset', p.name), () => { p.settings = from; Object.keys(SH).forEach((k) => { if (k.indexOf('@' + p.id) > 0) delete SH[k]; }); return ''; }, 'p5b-preset');
  A.buildIndex(); repaint('mp:reset'); toastUndo(t5('pedResetDone'), e, { sub: p.name }); announce(t5('pedResetDone'));
}
function mpUse() { const id = P.sub && P.sub.id; if (id) pmChoose('mem', id); }
function ratioWrite(which, n, src) {   // DS-129: the three shares are one whole: a change is clamped to what the other leaves (0 included), the remainder is the random share
  const s = pmById('mem', P.sub && P.sub.id); if (!s) return null; const key = which === 'recent' ? 'recentMemoryRatio' : 'similarMemoryRatio'; const other = which === 'recent' ? 'similarMemoryRatio' : 'recentMemoryRatio';
  let v = Math.round(Number(n)); if (!isFinite(v)) return null; v = Math.max(0, Math.min(100, v)); const lim = 100 - Math.round(s.settings[other] * 100); const clamped = v > lim; if (clamped) v = lim;
  s.settings[key] = v / 100; return { v, clamped, lim };
}
function paintRatio() {
  const s = pmById('mem', P.sub && P.sub.id); const el = $('#pageScroll .p5b-ratio'); if (!s || !el) return;
  const tmp = document.createElement('div'); tmp.innerHTML = ratioBarHTML(s.settings); const nu = tmp.firstElementChild; $('.p5b-rbar', el).replaceWith($('.p5b-rbar', nu)); $('.p5b-rleg', el).replaceWith($('.p5b-rleg', nu)); const rm = $('#p5b-remain'); const nt = $('#p5b-remain', tmp).textContent; if (rm.textContent !== nt) rm.textContent = nt;
  ['recentMemoryRatio', 'similarMemoryRatio'].forEach((f) => { const r = HV(f); const row = $(`#pageScroll [data-row="${CSS.escape(r.id)}"]`); if (!row) return; const sl = $('input[type=range]', row), nf = $('.p5b-pct', row), out = $('output', row); const v = r.v; if (+sl.value !== v) sl.value = v; if (nf && document.activeElement !== nf) nf.value = v; if (out) out.textContent = v + '%'; sl.setAttribute('aria-valuetext', t5('ratVt' + (f === 'recentMemoryRatio' ? 'Recent' : 'Similar')) + ' ' + v + '%'); });
}

/* ------------------------------------------------------------------ 음성 (DS-130, DS-128, DS-140) */
const VOICE_LISTED = [['webspeech', 'listBrowser', 'needNone'], ['vits', 'listVits', 'needFile'], ['gptsovits', 'listSovits', 'needAddr']];
const NEEDS = { elevenlab: 'needKey', VOICEVOX: 'needAddr', openai: 'needKey', novelai: 'needKey', huggingface: 'needKey', fishspeech: 'needKey' };
function voiceSvcHTML(s) {
  const nm = pick(SV[s].n, SV[s].nEn); let more = '';
  if (s === 'elevenlab') more = `<p class="r-desc p5b-fix" data-part="settings-row-description">${esc(t5('vsEleven'))}</p>`;
  else if (s === 'VOICEVOX') more = `<p class="r-desc p5b-fix" data-part="settings-row-description">${esc(t5('vsVoicevox'))}</p><p class="p5b-vlink" id="p5b-vv-tr">${ic('languages', 'sm')}<span>${esc(t5('vsVoicevoxTr', trSummary()))}</span>${goBtn('lang.translator', 'chatfeat.ttsAutoSpeech', t5('vsVoicevoxGo'), 'chevron-right', 'vtr')}</p>`;
  else if (s === 'openai') more = `<p class="r-desc p5b-fix" data-part="settings-row-description">${esc(t5('vsOpenai'))}</p>`;
  else if (s === 'huggingface') more = `<p class="r-desc p5b-fix" data-part="settings-row-description">${esc(t5('vsHf'))}</p>`;
  return `<li class="p5b-svc" data-part="settings-service-row" data-p5bid="vs:${esc(s)}" data-svc="${esc(s)}"><div class="p5b-svch"><span class="p5b-svcn">${esc(nm)}</span><span class="p5b-svcneed">${esc(t5(NEEDS[s]))}</span></div>${more}<div class="p5b-svcc">${chipHTML(s, 'chatfeat.ttsAutoSpeech')}</div>${tbox('voice', s, nm)}</li>`;
}
function voiceHTML(o) {
  const rev = o && o.reveal && R(o.reveal) && R(o.reveal).sec === 'chatfeat.voice' ? revealNote(R(o.reveal)) : '';
  const listed = VOICE_LISTED.map((x) => `<li class="p5b-listed" data-part="settings-service-row" data-p5bid="vs:${x[0]}"><span class="p5b-svcn">${esc(t5(x[1]))}</span><span class="p5b-svcneed">${esc(t5(x[2]))}</span></li>`).join('');
  const withVoice = ST.voices.filter((v) => v.engine).length;
  return secOpen('chatfeat.voice', A.L(A.SEC['chatfeat.voice'])) + secBody([rev, rowF(R('chatfeat.ttsAutoSpeech')),
    `<h3 class="p5b-h3" id="p5b-h-vs">${esc(t5('vsTitle'))}</h3><ul class="p5b-svcs" data-part="settings-service-list" aria-labelledby="p5b-h-vs">${VOICE_SVCS.map(voiceSvcHTML).join('')}</ul>`,
    `<h3 class="p5b-h3" id="p5b-h-vl">${esc(t5('vsListedTitle'))}</h3><ul class="p5b-svcs listed" data-part="settings-service-list" aria-labelledby="p5b-h-vl">${listed}</ul><p class="p5b-note" data-part="settings-note">${ic('info', 'sm')}<span>${esc(t5('vsListedNote'))}</span></p>`,
    `<div class="row row-link p5b-voices" data-row="chatfeat.voices" data-part="settings-row"><button type="button" class="rl" data-ctl data-p5b="open-voices" data-fk="vo:open"><span class="r-text"><span class="r-label" data-part="settings-row-label">${esc(t5('vcTitle'))}</span><span class="r-desc" data-part="settings-row-description">${esc(t5('vcSummary', withVoice, ST.voices.length))}</span></span><span class="rl-end">${ic('chevron-right', 'lg')}</span></button></div>`]) + '</section>';
}
function voicesHTML() {
  const rows = ST.voices.map((v) => { const c = charOf(v.id); const eng = ENGINES.find((e) => e[0] === v.engine); const en = eng ? eng[1].split('|') : null; const engL = en ? (en.length > 1 ? pick(en[0], en[1]) : en[0]) : '';
    return `<li class="p5b-vrow" data-part="settings-voice-row" data-p5bid="vc:${esc(v.id)}" data-cid="${esc(v.id)}"><div class="p5b-vmain"><span class="p5b-vname">${esc(charName(c))}</span><span class="p5b-vsub">${v.engine ? esc(t5('vcVoice', engL, v.voice || t5('vcAuto'))) : esc(t5('vcNone'))}</span>${v.engine && v.quote ? `<span class="chip p5b-quote">${esc(t5('vcQuote'))}</span>` : ''}</div><a class="btn solid p5b-studio" data-part="settings-studio-link" data-p5b="studio" data-fk="sl:${esc(v.id)}" href="${esc(studioLink(v.id))}" aria-label="${esc(t5('vcStudioOf', charName(c)))}" title="${esc(t5('vcStudioOf', charName(c)))}">${ic('external-link', 'md')}<span>${esc(t5('vcStudio'))}</span></a></li>`; }).join('');
  return subHead('chatfeat', t5('vcTitle'), `<p class="p5b-subnote">${esc(t5('vcIntro'))}</p><p class="p5b-subnote" id="p5b-novoice">${esc(t5('vcNoVoiceTab'))}</p>`) + `<section class="sec" data-part="settings-section" data-sec="chatfeat.voices" aria-label="${esc(t5('vcTitle'))}"><ul class="p5b-vlist" data-part="settings-voice-list" aria-label="${esc(t5('vcTitle'))}">${rows}</ul><p class="p5b-note" data-part="settings-note">${ic('info', 'sm')}<span>${esc(t5('vcNote'))}</span></p></section></div>`;
}

/* ------------------------------------------------------------------ 감정 이미지 (DS-134, DS-137) */
function emoHTML(o) {
  const m = rv('chatfeat.emotionProcesser'); const c = activeChar(); const rev = o && o.reveal && R(o.reveal) && R(o.reveal).sec === 'chatfeat.emotion' ? revealNote(R(o.reveal)) : '';
  const items = [
    { v: 'submodel', label: t5('emoModelL'), desc: t5('emoModelD'), after: `<div class="p5b-memmodel"><span>${esc(t5('emoModelIs', taskModelName('models.emoModel')))}</span>${goBtn('models.emoModel', 'chatfeat.emotionProcesser', t5('emoModelGo'), 'chevron-right', 'em')}</div>` },
    { v: 'embedding', label: t5('emoEmbL'), desc: t5('emoEmbD'), after: embLine(false) },
  ];
  const dim = m === 'embedding' ? t5('emoPromptDim') : '';
  const studio = c ? `<a class="btn solid p5b-studio" data-part="settings-studio-link" data-p5b="studio" data-fk="sl:emo" href="${esc(studioLink(c.id, 'display'))}" aria-label="${esc(t5('emoStudioOf', charName(c)))}">${ic('external-link', 'md')}<span>${esc(t5('emoStudio'))}</span></a>` : `<span class="p5b-nochar">${esc(t5('emoNoChar'))}</span>`;
  return secOpen('chatfeat.emotion', A.L(A.SEC['chatfeat.emotion'])) + secBody([rev, choiceHTML({ row: 'chatfeat.emotionProcesser', legend: t5('emoLegend'), items, cur: m }), rowF(R('chatfeat.emotionPrompt2'), dim ? { dim } : {}), `<p class="p5b-note" data-part="settings-note" id="p5b-emonote">${ic('info', 'sm')}<span>${esc(t5('emoPromptNote'))}</span></p>`,
    `<div class="p5b-studiorow" data-part="settings-link-card" data-p5bid="em:studio"><div class="p5b-sr"><p class="p5b-srt">${esc(t5('emoPerChar'))}</p>${c ? `<ul class="p5b-chips" aria-label="${esc(t5('emoNames', charName(c)))}">${ST.emotions.map((e) => `<li class="chip">${esc(e)}</li>`).join('')}</ul>` : ''}</div>${studio}</div>`]) + '</section>';
}

/* ------------------------------------------------------------------ 이미지 생성 (DS-128, DS-131, DS-140) */
const IMG_NEED = { url: 'needAddr', key: 'needKey', urlkey: 'needAddrKey' };
const IMG_FIELDS = { novelai: 'igFieldsNai', dalle: 'igFieldsDalle', stability: 'igFieldsStab', fal: 'igFieldsFal', comfyui: 'igFieldsComfy', Imagen: 'igFieldsImagen', comfy: 'igFieldsComfyOld' };
const provName = (id) => { const p = IMG_PROV.find((x) => x[0] === id); return p ? pick(p[1], p[2]) : (id === 'comfy' ? 'ComfyUI' : String(id)); };
function wsSel() { return WS_MODELS.find((m) => m.id === ST.ws.model) || ST.ws.models.find((m) => m.id === ST.ws.model) || null; }
const tickHTML = (on, txt) => `<span class="p5b-tick${on ? ' on' : ''}">${ic(on ? 'check' : 'minus', 'sm')}<span>${esc(txt)}</span><span class="sr-only"> ${esc(t5(on ? 'wsYes' : 'wsNo'))}</span></span>`;
function wsListHTML() {
  const q = P.ws.q.trim().toLowerCase(); const list = ST.ws.models.filter((m) => !q || (m.name + ' ' + m.id).toLowerCase().indexOf(q) >= 0);
  const st = P.ws.status; let stat = '';
  if (st === 'loading') stat = t5('wsLoading'); else if (st === 'fail') stat = t5('wsFail'); else if (st === 'empty') stat = t5('wsEmpty'); else if (!ST.ws.models.length) stat = t5('wsNever'); else if (!list.length) stat = t5('wsNoMatch', P.ws.q.trim()); else stat = t5('wsCount', list.length, ST.ws.models.length);
  if (P.ws.act >= list.length) P.ws.act = list.length - 1;
  const opts = list.map((m, i) => `<li class="p5b-wopt${m.id === ST.ws.model ? ' cur' : ''}${i === P.ws.act ? ' act' : ''}" data-part="settings-model-option" role="option" id="p5b-wo-${i}" data-id="${esc(m.id)}" aria-selected="${m.id === ST.ws.model ? 'true' : 'false'}"><span class="p5b-wn">${esc(m.name)}</span> <span class="p5b-wp">${m.price == null ? '' : esc('$' + m.price.toFixed(4))}</span> ${tickHTML(m.lora, t5('wsLora'))} ${tickHTML(m.ref, t5('wsRef'))}</li>`).join('');
  return `<p class="p5b-wsstat" id="p5b-wsstat" role="status" aria-live="polite" data-state="${st}">${st === 'fail' ? ic('circle-alert', 'sm') : ''}<span>${esc(stat)}</span></p>` +
    `<ul class="p5b-wlist" id="p5b-wlist" data-part="settings-model-list" role="listbox" tabindex="0" data-p5b="ws-list" data-fk="ws:list" aria-label="${esc(t5('wsListAria'))}"${P.ws.act >= 0 && list[P.ws.act] ? ` aria-activedescendant="p5b-wo-${P.ws.act}"` : ''}>${opts}</ul>`;
}
function wsHTML() {
  const sel = wsSel(); const loraOk = !!(sel && sel.lora), refOk = !!(sel && sel.ref);
  let h = `<div class="p5b-ws" data-p5bid="ip:wavespeed-models"><div class="p5b-wshead"><label class="dlg-l" for="p5b-wsq">${esc(t5('wsSearch'))}</label><div class="p5b-wsrow"><input id="p5b-wsq" type="search" class="inp" data-part="settings-field" data-p5b="ws-q" data-fk="ws:q" value="${esc(P.ws.q)}" autocomplete="off" spellcheck="false" aria-controls="p5b-wlist"><button type="button" class="btn solid" data-part="settings-button" data-p5b="ws-refresh" data-fk="ws:refresh" aria-label="${esc(t5('wsRefresh'))}" title="${esc(t5('wsRefresh'))}"${P.ws.status === 'loading' ? ' aria-disabled="true"' : ''}>${ic('refresh-cw', 'lg', P.ws.status === 'loading' ? 'p5b-spin' : '')}</button></div></div><div class="p5b-wbody" id="p5b-wbody">${wsListHTML()}</div>`;
  h += `<p class="p5b-wssel" id="p5b-wssel">${sel ? esc(sel.price == null ? t5('wsChosenNoPrice', sel.name) : t5('wsChosen', sel.name, '$' + sel.price.toFixed(4))) : esc(t5('wsNone'))}</p>`;
  if (loraOk) h += loraHTML(); else if (sel) h += `<p class="p5b-note" data-part="settings-note">${ic('info', 'sm')}<span>${esc(t5('wsNoLora'))}</span></p>`;
  if (refOk) h += rowF(R('chatfeat.wsRef')); else if (sel) h += `<p class="p5b-note" data-part="settings-note">${ic('info', 'sm')}<span>${esc(t5('wsNoRef'))}</span></p>`;
  return h + '</div>';
}
function loraHTML() {
  const L2 = ST.ws.loras;
  return `<div class="p5b-lora" data-part="settings-lora-list"><p class="p5b-h3" id="p5b-lh">${esc(t5('loraTitle'))}</p>` + L2.map((l, i) => `<div class="p5b-lrow" data-i="${i}"><label class="sr-only" for="p5b-lu-${i}">${esc(t5('loraUrl', i + 1))}</label><input id="p5b-lu-${i}" class="inp" data-part="settings-field" data-p5b="lora-url" data-i="${i}" data-fk="lu:${i}" value="${esc(l.url)}" placeholder="${esc(t5('loraUrlPh'))}" autocomplete="off" spellcheck="false"><label class="sr-only" for="p5b-ls-${i}">${esc(t5('loraScale', i + 1))}</label><input id="p5b-ls-${i}" class="inp num" data-part="settings-field" type="number" min="0" max="2" step="0.05" inputmode="decimal" data-p5b="lora-scale" data-i="${i}" data-fk="ls:${i}" value="${l.scale}"><button type="button" class="btn" data-part="settings-button" data-p5b="lora-del" data-i="${i}" data-fk="ld:${i}" aria-label="${esc(t5('loraDel', i + 1))}" title="${esc(t5('loraDel', i + 1))}">${ic('trash-2', 'lg')}</button></div>`).join('') +
    `<button type="button" class="btn solid" data-part="settings-button" data-p5b="lora-add" data-fk="lora:add"${L2.length >= 3 ? ' aria-disabled="true"' : ''} aria-describedby="p5b-lmax">${ic('plus', 'md')}<span>${esc(t5('loraAdd'))}</span></button><p class="p5b-lmax" id="p5b-lmax">${esc(t5('loraMax', L2.length))}</p></div>`;
}
function samplerRow() {
  const r = R('chatfeat.sdSampler'); shadow(r); const custom = P.open.samplerCustom || SAMPLERS.indexOf(r.v) < 0;
  const opt = SAMPLERS.map((s) => `<option value="${esc(s)}"${!custom && s === r.v ? ' selected' : ''}>${esc(s)}</option>`).join('') + `<option value="__custom"${custom ? ' selected' : ''}>${esc(t5('sdCustom'))}</option>`;
  return `<div class="row type-select" data-row="${r.id}" data-type="select" data-part="settings-row" role="group" aria-labelledby="l-${r.id}"><div class="r-main"><div class="r-text"><div class="r-title"><label class="r-label" data-part="settings-row-label" id="l-${r.id}" for="c-${r.id}">${esc(lab(r))}</label></div><p class="r-desc" data-part="settings-row-description">${esc(t5('sdSamplerD'))}</p></div><div class="r-ctl" data-part="settings-row-control"><select id="c-${r.id}" data-ctl data-part="settings-field" class="inp" data-p5b="sampler">${opt}</select></div></div>` +
    (custom ? `<div class="p5b-custom"><label class="dlg-l" for="p5b-smp">${esc(t5('sdCustomL'))}</label><input id="p5b-smp" class="inp" data-part="settings-field" data-p5b="sampler-text" data-fk="smp:text" value="${esc(r.v)}" autocomplete="off" spellcheck="false"></div>` : '') + '</div>';
}
function webuiFields() {
  const hires = `<details class="p5b-details" id="p5b-hires" data-part="settings-disclosure"${P.open.hires ? ' open' : ''}><summary class="p5b-sum" data-fk="hires:sum">${esc(t5('sdHiresSum'))}</summary>${secBody([rowF(R('chatfeat.sdHr')), rowF(R('chatfeat.sdDenoise')), rowF(R('chatfeat.sdHrScale')), rowF(R('chatfeat.sdHrUpscaler'))])}</details>`;
  return `<div class="p5b-needrow"><span class="p5b-nl">${esc(t5('igAddr'))}</span>${chipHTML('webui', 'chatfeat.sdProvider')}</div>` + secBody([rowF(R('chatfeat.sdSteps')), rowF(R('chatfeat.sdCFG')), rowF(R('chatfeat.sdWidth')), rowF(R('chatfeat.sdHeight')), samplerRow()]) + hires +
    `<ul class="p5b-notes" data-part="settings-notes" data-part-critical><li>${ic('info', 'sm')}<span>${esc(t5('sdApi'))}</span></li><li>${ic('info', 'sm')}<span>${esc(t5('sdLicense'))}</span></li>${FL.web ? `<li>${ic('triangle-alert', 'sm')}<span>${esc(t5('sdTunnel'))}</span></li>` : ''}</ul>`;
}
function svcFields(id) {   // the fields of one service (inline on wide screens, a sub-page on phones; design default)
  if (id === 'webui') return webuiFields();
  if (id === 'openai-compat') return `<div class="p5b-needrow"><span class="p5b-nl">${esc(t5('igAddrKey'))}</span>${chipHTML('openai-compat', 'chatfeat.sdProvider')}</div>` + secBody([rowF(R('chatfeat.oaiImgModel')), rowF(R('chatfeat.oaiImgSize')), rowF(R('chatfeat.oaiImgQuality'))]);
  if (id === 'wavespeed') return `<div class="p5b-needrow"><span class="p5b-nl">${esc(t5('igKey'))}</span>${chipHTML('wavespeed', 'chatfeat.sdProvider')}</div>` + wsHTML();
  const p = IMG_PROV.find((x) => x[0] === id); const need = p ? p[3] : 'url';
  return `<div class="p5b-needrow"><span class="p5b-nl">${esc(t5(IMG_NEED[need]))}</span>${chipHTML(id === 'comfy' ? 'comfy' : id, 'chatfeat.sdProvider')}</div><p class="p5b-listednote" data-part="settings-note">${ic('info', 'sm')}<span>${esc(t5('igListed'))} ${esc(t5(IMG_FIELDS[id]))}</span></p>`;
}
function promptView() {
  const c = activeChar(); const cs = ST.chars.find((x) => c && x.id === c.id);
  if (!c || !cs) return `<div class="p5b-pview" data-part="settings-prompt-view" data-state="none"><p class="p5b-pvt">${esc(t5('pvTitle'))}</p><p class="p5b-nochar">${esc(t5('noChar'))}</p></div>`;
  return `<div class="p5b-pview" data-part="settings-prompt-view"><p class="p5b-pvt">${esc(t5('pvOf', charName(c)))}</p><dl class="p5b-pvl"><dt>${esc(t5('pvPrefix'))}</dt><dd>${esc(clip(cs.prompt, 120))}</dd><dt>${esc(t5('pvNegative'))}</dt><dd>${esc(clip(cs.negative, 120))}</dd></dl><a class="btn solid p5b-studio" data-part="settings-studio-link" data-p5b="studio" data-fk="sl:img" href="${esc(studioLink(c.id, 'display'))}" aria-label="${esc(t5('pvStudioOf', charName(c)))}">${ic('external-link', 'md')}<span>${esc(t5('pvStudio'))}</span></a></div>`;
}
function imgHTML(o) {
  const cur = rv('chatfeat.sdProvider'); const rev = o && o.reveal && R(o.reveal) && R(o.reveal).sec === 'chatfeat.imagegen' ? revealNote(R(o.reveal)) : '';
  const items = [{ v: '', label: t5('igOff'), desc: t5('igOffD') }].concat(IMG_PROV.map((p) => ({ v: p[0], label: pick(p[1], p[2]), desc: t5(IMG_NEED[p[3]]), after: chipHTML(p[0], 'chatfeat.sdProvider') })));
  if (cur === 'comfy') items.push({ v: 'comfy', label: 'ComfyUI', desc: t5(IMG_NEED.url), tags: tagOld(), after: chipHTML('comfy', 'chatfeat.sdProvider') });
  let body = [rev, choiceHTML({ row: 'chatfeat.sdProvider', legend: t5('igLegend'), items, cur, pid: 'ip' })];
  if (cur) {
    body.push(`<p class="p5b-cost" data-part="settings-cost-line" data-part-critical>${ic('info', 'sm')}<span>${esc(t5('igCost'))}</span></p>`);
    const nm = provName(cur);
    if (A.S.lay === 'phone') body.push(`<div class="row row-link p5b-fieldlink" data-row="chatfeat.igFields" data-part="settings-row"><button type="button" class="rl" data-ctl data-p5b="open-imggen" data-svc="${esc(cur)}" data-fk="ig:open"><span class="r-text"><span class="r-label" data-part="settings-row-label">${esc(t5('igFieldsOf', nm))}</span></span><span class="rl-end">${ic('chevron-right', 'lg')}</span></button></div>`);
    else body.push(`<div class="p5b-fields" data-part="settings-service-fields" data-svc="${esc(cur)}" role="group" aria-label="${esc(t5('igFieldsOf', nm))}"><h3 class="p5b-h3">${esc(t5('igFieldsOf', nm))}</h3>${svcFields(cur)}</div>`);
    body.push(promptView()); body.push(tbox('image', cur, nm));
  } else body.push(promptView());
  return secOpen('chatfeat.imagegen', A.L(A.SEC['chatfeat.imagegen'])) + secBody(body) + '</section>';
}
function imggenHTML() {   // view=imggen&svc=: the fields of one service as a page (phones; a deep link at any width)
  const id = P.sub.id; const nm = provName(id);
  return subHead('chatfeat', nm, `<p class="p5b-subnote">${esc(t5('igSubNote'))}</p>`) + `<section class="sec" data-part="settings-section" data-sec="chatfeat.imagegen" aria-label="${esc(nm)}"><div class="p5b-fields" data-part="settings-service-fields">${svcFields(id)}</div>${promptView()}${tbox('image', id, nm)}</section></div>`;
}
function wsFetch() {
  if (P.ws.status === 'loading') return; P.ws.status = 'loading'; paintWs(); announce(t5('wsLoading'));
  P.timers.ws = setTimeout(() => {
    delete P.timers.ws; const f = ST.sim.all ? 'fail' : ST.sim.wsFetch;
    if (f === 'fail') P.ws.status = 'fail'; else if (f === 'empty') { ST.ws.models = []; P.ws.status = 'empty'; } else { ST.ws.models = WS_MODELS.map((m) => Object.assign({}, m)); P.ws.status = 'ok'; }
    paintWs(); announce(P.ws.status === 'ok' ? t5('wsLoaded', ST.ws.models.length) : P.ws.status === 'empty' ? t5('wsEmpty') : t5('wsFail'));
  }, CFG.fetchMs);
}
function paintWs(listOnly) {
  const el = $('#pageScroll .p5b-ws'); if (!el) return;
  const body = $('#p5b-wbody', el); if (body) { body.innerHTML = wsListHTML(); }
  const btn = $('[data-p5b="ws-refresh"]', el); if (btn) { if (P.ws.status === 'loading') btn.setAttribute('aria-disabled', 'true'); else btn.removeAttribute('aria-disabled'); btn.innerHTML = ic('refresh-cw', 'lg', P.ws.status === 'loading' ? 'p5b-spin' : ''); }
  const s = $('#p5b-wssel', el); if (s) { const sel = wsSel(); s.textContent = sel ? t5('wsChosen', sel.name, '$' + sel.price.toFixed(4)) : t5('wsNone'); }
  if (!listOnly) void 0;
}
function wsChoose(id) {
  const from = ST.ws.model; if (from === id) return; ST.ws.model = id; const m = wsSel();
  const e = pushLU(t5('luWsModel'), () => { if (ST.ws.model === id) ST.ws.model = from; return ''; }, 'p5b-edit'); P.writes++;
  repaint('ws:list'); toastUndo(t5('wsPicked'), e, { sub: m ? m.name : '' }); announce(t5('wsPicked') + ' ' + (m ? m.name : ''));
}

/* ------------------------------------------------------------------ 언어 › 번역 (DS-133, DS-139, DS-140) */
const TYPE_ORDER = ['google', 'deepl', 'deeplx', 'llm', 'bergamot'];
const TYPE_KEY = { google: 'ttGoogle', deepl: 'ttDeepl', deeplx: 'ttDeeplx', llm: 'ttLlm', bergamot: 'ttLocal' };
const typeName = (v) => (v === 'google' ? 'Google' : v === 'deepl' ? 'DeepL' : v === 'deeplx' ? 'DeepLX' : t5(v === 'llm' ? 'ttLlmN' : 'ttLocalN'));
function trSummary() {
  const l = rv('lang.translator'); if (!l) return t5('trSumOff'); const li = LANGS.find((x) => x[0] === l); return t5('trSum', li ? pick(li[1], li[2]) : l, typeName(rv('lang.translatorType')));
}
const trLangGoogleOnly = (v) => { const li = LANGS.find((x) => x[0] === v); return !!(li && li[3]); };
function trLangRow() {
  const r = R('lang.translator'); const type = rv('lang.translatorType'); let h = rowF(r);
  LANGS.filter((l) => l[3]).forEach((l) => { h = h.replace(new RegExp('<option value="' + l[0] + '"([^>]*)>([^<]*)</option>'), (m, a, tx) => `<option value="${l[0]}"${a}${type !== 'google' && rv('lang.translator') !== l[0] ? ' disabled' : ''}>${tx} · ${esc(t5('googleOnly'))}</option>`); });
  return h;
}
function presetsBlock() {
  const a = pmAct('tr');
  return `<div class="p5b-trpre" data-p5bid="tp:bar"><p class="p5b-h3" id="p5b-trph">${esc(t5('trPresetTitle'))}</p>${presetBar('tr')}<p class="p5b-trpv"><span class="p5b-trpn">${esc(clip(a.prompt || t5('trPromptDefault'), 80))}</span><span class="p5b-trpm">${esc(t5('trMaxIs', a.maxResponse))}</span></p></div>`;
}
function cacheBlock(type) {
  if (type !== 'llm') return `<div class="p5b-cache" data-part="settings-cache-block" data-state="na"><p class="p5b-cache-note" data-part="settings-notice" data-part-critical>${ic('info', 'sm')}<span>${esc(t5('cacheNa'))}</span></p></div>`;
  return `<div class="p5b-cache" data-part="settings-cache-block" data-state="on" role="group" aria-labelledby="p5b-ch"><p class="p5b-h3" id="p5b-ch">${esc(t5('cacheTitle'))}</p><p class="p5b-cache-n" id="p5b-cachen">${esc(t5('cacheCount', fmtInt(ST.trCache)))}</p><div class="p5b-cacheb"><button type="button" class="btn solid" data-part="settings-button" data-p5b="cache-export" data-fk="ca:export">${ic('download', 'md')}<span>${esc(t5('cacheExport'))}</span></button><button type="button" class="btn solid" data-part="settings-button" data-p5b="cache-import" data-fk="ca:import">${ic('upload', 'md')}<span>${esc(t5('cacheImport'))}</span></button><button type="button" class="btn solid danger" data-part="settings-button" data-p5b="cache-clear" data-fk="ca:clear"${ST.trCache ? '' : ' aria-disabled="true"'}>${ic('trash-2', 'md')}<span>${esc(t5('cacheClear'))}</span></button></div></div>`;
}
function typePanel(type) {
  if (type === 'google') return rowF(R('lang.translatorInputLanguage'));
  if (type === 'deepl') return `<div class="p5b-needrow"><span class="p5b-nl">${esc(t5('needKey'))}</span>${chipHTML('deepl', 'lang.translatorType')}</div>` + rowF(R('models.deeplFree')) + (FL.web ? `<p class="p5b-note warn" data-part="settings-note">${ic('triangle-alert', 'sm')}<span>${esc(t5('deeplWeb'))}</span></p>` : '');
  if (type === 'deeplx') return `<div class="p5b-needrow"><span class="p5b-nl">${esc(t5('needAddrToken'))}</span>${chipHTML('deeplx', 'lang.translatorType')}</div>`;
  if (type === 'llm') return `<div class="p5b-memmodel"><span>${esc(t5('trModelIs', taskModelName('models.transModel')))}</span>${goBtn('models.transModel', 'lang.translatorType', t5('trModelGo'), 'chevron-right', 'tm')}</div>` + presetsBlock() + rowF(R('lang.translateBeforeHTMLFormatting')) + rowF(R('lang.autoTranslateCachedOnly'));
  return `<p class="p5b-cost" data-part="settings-cost-line" data-part-critical>${ic('hard-drive-download', 'sm')}<span>${esc(t5('costDownload', '90 MB'))}</span></p>` + rowF(R('lang.htmlTranslation'));
}
function trBody(o) {
  const lang = rv('lang.translator'); const type = rv('lang.translatorType'); const rev = o && o.reveal && R(o.reveal) && R(o.reveal).sec === 'lang.translate' && !R(o.reveal).trp ? revealNote(R(o.reveal)) : '';
  let items = [];
  if (lang) {
    items = TYPE_ORDER.map((v) => ({ v, pid: 'tt', label: typeName(v), desc: t5(TYPE_KEY[v]), after: v === type ? `<div class="p5b-typepanel" data-type="${v}">${typePanel(v)}</div>` : '' }));
  }
  const reasonG = lang && trLangGoogleOnly(lang) && type !== 'google' ? `<p class="p5b-reason" data-part="settings-dim-reason" data-part-critical id="p5b-gr">${ic('circle-alert', 'sm')}<span class="p5b-rt">${esc(t5('googleOnlyWarn'))}</span></p>` : '';
  const srcNote = lang && type !== 'google' ? `<p class="p5b-note" data-part="settings-note">${ic('info', 'sm')}<span>${esc(t5('srcNote'))}</span></p>` : '';
  const vox = lang && conn('VOICEVOX').ok ? `<p class="p5b-vlink">${ic('volume-2', 'sm')}<span>${esc(t5('trVoicevox'))}</span>${goBtn('chatfeat.ttsAutoSpeech', 'lang.translator', t5('trVoicevoxGo'), 'chevron-right', 'tv')}</p>` : '';
  return secBody([rev, trLangRow(), lang ? choiceHTML({ row: 'lang.translatorType', legend: t5('trTypeLegend'), items, cur: type, pid: 'tt' }) : `<p class="p5b-note" data-part="settings-note">${ic('info', 'sm')}<span>${esc(t5('trOffNote'))}</span></p>`, reasonG, srcNote,
    lang ? rowF(R('lang.autoTranslate')) + rowF(R('lang.combineTranslation')) + rowF(R('lang.legacyTranslation')) : '', lang ? cacheBlock(type) : '', lang ? `<div class="p5b-trtest"><p class="p5b-h3">${esc(t5('trTestTitle'))}</p><p class="p5b-trsample">${esc(t5('trSample'))}</p>${tbox('translate', type, typeName(type))}</div>` : '', vox]);
}
function trPresetHTML() {
  const id = P.sub.id; const p = pmById('tr', id); if (!p) return null; ST.trEdit = id; const act = id === ST.trActive;
  return subHead('lang', p.name, `<p class="p5b-subnote">${esc(act ? t5('pedActive') : t5('pedNotActive'))}</p>`) + subSec('tp-main', t5('trpTitle')) + secBody([rowF(R('lang.trPrompt')), `<p class="p5b-note" data-part="settings-note">${ic('info', 'sm')}<span>${esc(t5('trpSlot'))}</span></p>`, rowF(R('lang.trMaxResponse'))]) + '</section>' +
    `<div class="p5b-acts"><button type="button" class="btn solid${act ? '' : ' accent'}" data-part="settings-button" data-p5b="tp-use" data-fk="tp:use"${act ? ' aria-disabled="true"' : ''}>${ic(act ? 'check' : 'bookmark', 'md')}<span>${esc(act ? t5('pedUsed') : t5('pedUse'))}</span></button></div></div>`;
}
function cacheExport() { download('translation-cache.json', JSON.stringify({ synthetic: true, count: ST.trCache }, null, 1)); toast(t5('cacheExported', fmtInt(ST.trCache)), { ms: 4000 }); announce(t5('cacheExported', fmtInt(ST.trCache))); }
function cacheImport() {
  const files = FILES.cache; let sel = '';
  const d = A.openDialog({ title: t5('cacheImportT'), body: `<p>${esc(t5('cacheImportBody'))}</p><ul class="p5b-files" role="list">${files.map((f) => `<li><label class="p5b-filel"><input type="radio" name="p5b-cfile" data-pf="${f.id}"><span>${esc(f.file)}</span></label></li>`).join('')}</ul><p class="p5b-fmsg" id="p5b-fmsg" role="alert" aria-live="assertive"></p>`, buttons: [{ id: 'cancel', label: t5('cancel') }, { id: 'ok', label: t5('cacheImportDo'), primary: true, disabled: true }], initial: '[data-pf]', onClose: () => { focusFk('ca:import'); } });
  d.back.addEventListener('change', (ev) => { const c = ev.target.closest('[data-pf]'); if (!c) return; sel = c.dataset.pf; const f = files.find((x) => x.id === sel); $('[data-dlg="ok"]', d.back).setAttribute('aria-disabled', f.ok ? 'false' : 'true'); const m = $('#p5b-fmsg', d.back); m.textContent = f.ok ? t5('cacheImportOk', fmtInt(f.count)) : t5('cacheImportBad'); m.className = 'p5b-fmsg' + (f.ok ? '' : ' bad'); });
  A.openDialog.handlers = { ok: () => { const f = files.find((x) => x.id === sel); if (!f || !f.ok) return false; setTimeout(() => { const from = ST.trCache; ST.trCache = from + f.count; const to = ST.trCache; const e = pushLU(t5('luCacheImport'), () => { if (ST.trCache === to) ST.trCache = from; return ''; }, 'p5b-cache'); repaint('ca:import'); toastUndo(t5('cacheImported', fmtInt(f.count)), e); }, 0); } };
}
function cacheClear() {
  if (!ST.trCache) { announce(t5('cacheEmpty')); return; }
  ask({ title: t5('cacheClearT'), body: `<p>${esc(t5('cacheClearBody', fmtInt(ST.trCache)))}</p>`, ok: t5('cacheClearDo'), danger: true, onClose: () => { focusFk('ca:clear') || focusFk('ca:export'); }, onOk: () => {
    const from = ST.trCache, t0 = Date.now(); ST.trCache = 0;
    const e = pushLU(t5('luCacheClear'), () => { if (Date.now() - t0 > CFG.undoMs) return t5('cacheGone'); if (ST.trCache === 0) ST.trCache = from; return ''; }, 'p5b-delete');
    repaint('ca:export'); toastUndo(t5('cacheCleared', fmtInt(from)), e, { kind: 'delete', ms: CFG.undoMs, until: '10s' }); announce(t5('cacheCleared', fmtInt(from))); } });
}

/* ------------------------------------------------------------------ 모델 › 임베딩 (DS-137) */
function embRowHTML() {
  const r = R('models.embedModel'); shadow(r); const v = r.v; const g = embGroup(v);
  const grp = { cpu: t5('embCpu'), gpu: t5('embGpu'), hosted: t5('embHosted'), custom: t5('embCustom') };
  const og = ['cpu', 'gpu', 'hosted', 'custom'].filter((k) => k !== 'gpu' || FL.gpu).map((k) => `<optgroup label="${esc(grp[k])}">${EMB.filter((e) => e[3] === k).map((e) => `<option value="${esc(e[0])}"${e[0] === v ? ' selected' : ''}>${esc(pick(e[1], e[2]))}</option>`).join('')}</optgroup>`).join('');
  let h = A.rowHTML(r); const sa = h.indexOf('<select'), sb = h.indexOf('</select>');
  h = h.slice(0, h.indexOf('>', sa) + 1) + og + h.slice(sb);
  h = h.replace('<div class="row ', '<div class="row p5b-emb ').replace('data-part="settings-row"', 'data-part="settings-embedding-row"');
  let extra = '';
  if (g === 'hosted') extra = `<div class="p5b-needrow">${chipHTML(v === 'voyageContext3' ? 'voyage' : 'openai', 'models.embedModel')}</div>`;
  else if (g === 'custom') extra = `<div class="p5b-needrow">${chipHTML('openai-compat', 'models.embedModel')}</div>` + rowF(R('models.embedCustomModel'));
  else extra = `<p class="p5b-cost" data-part="settings-cost-line" data-part-critical>${ic('hard-drive-download', 'sm')}<span>${esc(dlText(embOf(v)[4]))}</span></p>`;
  extra += `<p class="p5b-note p5b-embshared" data-part="settings-notice" data-part-critical>${ic('info', 'sm')}<span>${esc(t5('embShared'))}</span></p>`;
  if (P.embWarn) extra += `<p class="p5b-note warn p5b-embwarn" data-part="settings-notice" data-part-critical role="status">${ic('triangle-alert', 'sm')}<span>${esc(t5('embWarn'))}</span></p><p class="p5b-pending" data-demo-only>${esc(t5('demoPending'))}</p>`;   // DS-141: shown after a change; ships only when Lane A confirms the vectors go stale
  return h.replace(/<\/div>$/, `<div class="p5b-embx">${extra}</div></div>`);
}
function insertEmb(html) {
  const mark = '</div><div class="c3-grp" data-part="settings-model-group" role="group" aria-labelledby="c3gh-fb">'; const i = html.indexOf(mark);
  return i < 0 ? html + embRowHTML() : html.slice(0, i) + embRowHTML() + html.slice(i);
}

/* ------------------------------------------------------------------ the page (대화 기능) */
function chatfeatHTML(o) {
  if (P.sub) {
    let h = null;
    if (P.sub.kind === 'memory-preset') h = memPresetHTML(); else if (P.sub.kind === 'voices') h = voicesHTML(); else if (P.sub.kind === 'imggen') h = (IMG_PROV.some((p) => p[0] === P.sub.id) || P.sub.id === 'comfy') ? imggenHTML() : null;
    if (h) return h; P.sub = null; ST.editId = '';
  }
  const secs = D.SECTIONS.filter((s) => s.page === 'chatfeat' && A.L(s));
  const chips = `<nav class="chips" data-part="settings-jump-chips" aria-label="${esc(A.t('sectionNav'))}">${secs.map((s) => `<button type="button" class="chip-b" data-secjump="${esc(s.id)}">${esc(A.L(s))}</button>`).join('')}</nav>`;
  const trSec = secOpen('chatfeat.translate', A.L(A.SEC['chatfeat.translate'])) + secBody([`<div class="row row-link p5b-trcard" data-row="chatfeat.trLink" data-row-kind="nav" data-part="settings-row"><button type="button" class="rl" data-ctl data-nav="lang.translator"><span class="r-text"><span data-part="settings-row-label" class="r-label">${esc(t5('trLinkT'))}</span><span data-part="settings-row-description" class="r-desc" id="p5b-trsum">${esc(trSummary())}</span></span><span class="rl-end"><span class="rl-txt">${esc(t5('trLinkGo'))}</span>${ic('chevron-right', 'lg')}</span></button></div>`]) + '</section>';
  return headHTML('chatfeat') + chips + memHTML(o) + voiceHTML(o) + emoHTML(o) + imgHTML(o) + trSec + '</div>';
}
function subTitleOf() {
  if (!P.sub) return '';
  if (P.sub.kind === 'memory-preset' || P.sub.kind === 'trpreset') { const p = pmById(P.sub.kind === 'trpreset' ? 'tr' : 'mem', P.sub.id); return p ? p.name : ''; }
  if (P.sub.kind === 'voices') return t5('vcTitle'); if (P.sub.kind === 'imggen') return provName(P.sub.id); return '';
}

/* ------------------------------------------------------------------ sub-pages (a drill-in with Back) */
const pageOf = (kind) => (kind === 'trpreset' ? 'lang' : 'chatfeat');
function openSub(kind, id, retFk) {
  const sc = $('#pageScroll'); if (!P.sub && sc) P.listScroll[pageOf(kind)] = sc.scrollTop; if (retFk) P.retFk = retFk;
  P.sub = { kind, id: id || '' }; if (kind === 'memory-preset') ST.editId = id; if (kind === 'trpreset') ST.trEdit = id;
  A.showPage(pageOf(kind), { p5b: true, noRestore: true, noAnim: false, keepFocus: true, force: true });
  const h = $('#pgTitle'); if (h) h.focus({ preventScroll: true });
}
function subClose() {
  if (!P.sub) return; const page = pageOf(P.sub.kind); const fk = P.retFk; P.sub = null; ST.editId = ''; ST.trEdit = '';
  A.showPage(page, { p5b: true, noAnim: true, noRestore: true, keepFocus: true, force: true }); const sc = $('#pageScroll'); if (sc && P.listScroll[page] !== undefined) sc.scrollTop = P.listScroll[page];
  if (!focusFk(fk)) { const h = $('#pgTitle'); if (h) h.focus({ preventScroll: true }); }
}

/* ------------------------------------------------------------------ enhancing the rows slice 1 renders (a number field gets its step and an error slot, a ratio slider its number field); runs after every render and after a row is re-rendered on its own */
let enhancing = false;
function enhance(root) {
  const sc = root || $('#pageScroll'); if (!sc || enhancing) return; enhancing = true;
  try {
    $$('.row[data-row]', sc).forEach((row) => {
      const r = R(row.dataset.row); if (!mine(r)) return;
      if (r.type === 'number') { const i = $('input[type=number]', row); if (i && r.max == null) i.removeAttribute('max'); if (i && !i.hasAttribute('step')) { i.setAttribute('step', r.step || 1); i.setAttribute('inputmode', 'decimal'); } if (i && !$('.p5b-err', row)) { const p = document.createElement('p'); p.className = 'p5b-err'; p.id = 'e-' + r.id; p.setAttribute('role', 'alert'); p.hidden = true; row.appendChild(p); } }
      if (r.type === 'slider' && r.pct && /recent|similar/i.test(r.id) && !$('.p5b-pct', row)) { row.classList.add('p5b-ratiorow'); const o = $('output', row); if (o) { const n = document.createElement('input'); n.type = 'number'; n.className = 'inp num p5b-pct'; n.setAttribute('data-p5b', 'pct'); n.setAttribute('data-rowid', r.id); n.setAttribute('data-fk', 'pc:' + r.id); n.min = '0'; n.max = '100'; n.step = '1'; n.setAttribute('inputmode', 'numeric'); n.value = r.v; n.setAttribute('aria-label', lab(r) + ' (%)'); o.insertAdjacentElement('afterend', n); } }
    });
  } finally { enhancing = false; }
}
function syncDot(r, row) {
  const ch = A.isChanged(r); row.classList.toggle('changed', ch); const dot = $('.dot', row); if (dot) dot.hidden = !ch; const sr = $('.r-chg', row); if (sr) sr.textContent = ch ? ' (' + A.t('changedFromDefault') + ')' : '';
  const mb = $('.r-more', row); if (mb) { mb.classList.toggle('rest', !ch); mb.tabIndex = ch ? 0 : -1; }
}

/* ------------------------------------------------------------------ events. Plain rows (switch, select, text, slider, segmented) are slice 1's; everything with data-p5b is handled here in the capture phase and stops. */
function disabledMsg(k) { if (k === 'cache-clear') announce(t5('cacheEmpty')); else if (k === 'lora-add') { announce(t5('loraFull')); toast(t5('loraFull'), { ms: 3000 }); } else if (k === 'mp-use') announce(t5('pedUsed')); else if (k === 'tp-use') announce(t5('pedUsed')); else if (k === 'ws-refresh') announce(t5('wsLoading')); }
function onClick(ev) {
  const t = ev.target; if (!(t instanceof Element)) return; const sc = $('#pageScroll'); if (!sc.contains(t)) return;
  const more = t.closest('.r-more');
  if (more) { const row = more.closest('[data-row]'); const r = row && R(row.dataset.row); if (mine(r) && r.d !== undefined) { ev.preventDefault(); ev.stopPropagation(); openResetMenu(r, more); return; } }
  const b = t.closest('[data-p5b]'); if (!b || !sc.contains(b)) return; const k = b.dataset.p5b;
  if (k === 'radio' || k === 'sampler' || k === 'pct' || k === 'ws-q' || k === 'lora-url' || k === 'lora-scale' || k === 'sampler-text') return;
  if (k !== 'studio') ev.preventDefault();
  if (b.getAttribute('aria-disabled') === 'true') { ev.stopPropagation(); disabledMsg(k); return; }
  ev.stopPropagation(); const d = b.dataset;
  switch (k) {
    case 'goconn': case 'goto': goRow(d.target, d.ret); break;
    case 'addconn': addConnection(d.svc); break;
    case 'test': runTest(d.kind, d.svc); break;
    case 'testcancel': cancelTest(d.key); break;
    case 'pm-choose': pmChooseMenu(d.pm, b); break;
    case 'pm-edit': openSub(d.pm === 'mem' ? 'memory-preset' : 'trpreset', pmAct(d.pm).id, 'pm:' + d.pm + ':edit'); break;
    case 'pm-menu': pmMenu(d.pm, b); break;
    case 'mp-use': mpUse(); break;
    case 'tp-use': { const id = P.sub && P.sub.id; if (id) pmChoose('tr', id); break; }
    case 'mp-reset': mpResetAll(); break;
    case 'open-voices': openSub('voices', '', 'vo:open'); break;
    case 'open-imggen': openSub('imggen', d.svc, 'ig:open'); break;
    case 'ws-refresh': wsFetch(); break;
    case 'ws-list': { const li = t.closest('.p5b-wopt'); if (li) wsChoose(li.dataset.id); break; }
    case 'lora-add': loraAdd(); break;
    case 'lora-del': loraDel(+d.i); break;
    case 'cache-export': cacheExport(); break;
    case 'cache-import': cacheImport(); break;
    case 'cache-clear': cacheClear(); break;
    default: break;
  }
}
function openResetMenu(r, anchor) { A.showMenu([{ icon: 'rotate-ccw', label: A.t('resetToDefault'), disabled: !A.isChanged(r), fn: () => resetMine(r) }], anchor, null, anchor, A.t('moreOfRow', lab(r))); }
function resetMine(r) { r.v = r.d; commitRow(r, true); onMineChanged(r, true); repaint(); announce(t5('resetDone', lab(r))); }
function onMineChanged(r, force) {   // side effects of one row's change; the dependent rows hide and show through slice 1's own refresh (the dep chain)
  P.writes++;
  if (r.id === 'models.embedModel' && !P.embWarn) { P.embWarn = true; setTimeout(() => announce(t5('embWarn')), 0); }
  if (r.id === 'chatfeat.hv3.memoryTokensRatio') { const ex = R('chatfeat.hv3.extraSummarizationRatio'); const lim = 100 - r.v; if (ex.v > lim) { ex.v = lim; } ex.max = lim; const row = $(`#pageScroll [data-row="${CSS.escape(ex.id)}"]`); if (row) { const sl = $('input[type=range]', row); if (sl) { sl.max = String(lim); sl.value = String(ex.v); } const o = $('output', row); if (o) o.textContent = ex.v + '%'; syncDot(ex, row); } }
  if (r.id === 'models.embedModel' || REPAINT.has(r.id) || force) { /* a repaint follows from the caller or the dep refresh */ }
}
const REPAINT = new Set(['chatfeat.supaModelType', 'chatfeat.hv3.summarizationModel', 'chatfeat.hypaMemory', 'models.embedModel', 'models.deeplFree', 'chatfeat.sdHr']);
function setChoice(rowId, v) {   // a radio group bound to a select row: one undo step, then the page follows
  if (rowId === 'chatfeat.memEngine') { setEngine(v); return; }
  const r = R(rowId); if (!r || r.v === v) return; shadow(r); r.v = v; commitRow(r); onMineChanged(r); A.buildIndex(); repaint('rd:' + rowId + ':' + v); announce(lab(r) + ': ' + A.optLabel(r, v));
}
function onChange(ev) { P.defer = true; try { onChange0(ev); } finally { P.defer = false; } }
function onChange0(ev) {
  const el = ev.target; const sc = $('#pageScroll'); if (!(el instanceof Element) || !sc.contains(el)) return; const k = el.dataset ? el.dataset.p5b : '';
  if (k === 'radio') { ev.stopPropagation(); setChoice(el.dataset.rowid, el.value); return; }
  if (k === 'sampler') { ev.stopPropagation(); const r = R('chatfeat.sdSampler'); if (el.value === '__custom') { P.open.samplerCustom = true; repaint('smp:text'); const f = $('#p5b-smp'); if (f) f.focus({ preventScroll: true }); } else { P.open.samplerCustom = false; r.v = el.value; commitRow(r); repaint('c-chatfeat.sdSampler'); } return; }
  if (k === 'sampler-text') { ev.stopPropagation(); const r = R('chatfeat.sdSampler'); const v = el.value.trim(); if (!v) { el.value = r.v; announce(t5('sdBlank')); toast(t5('sdBlank'), { ms: 3500 }); return; } r.v = v; commitRow(r); return; }
  if (k === 'pct') { ev.stopPropagation(); pctInput(el, true); return; }
  if (k === 'lora-url' || k === 'lora-scale') { ev.stopPropagation(); loraEdit(el, true); return; }
  if (k === 'ws-q') { ev.stopPropagation(); return; }
  if (el.matches && el.matches('input[type=number]')) { const row = el.closest('[data-row]'); const r = row && R(row.dataset.row); if (mine(r)) { ev.stopPropagation(); numInput(el, true); return; } }
  const row = el.closest ? el.closest('[data-row]') : null; const r = row && R(row.dataset.row); if (mine(r) && (r.type === 'text' || r.type === 'textarea' || r.type === 'slider')) { commitRow(r); onMineChanged(r); if (REPAINT.has(r.id)) repaint(); }
}
function numInput(el, final) {
  const row = el.closest('[data-row]'); const r = row && R(row.dataset.row); if (!mine(r) || r.type !== 'number') return false;
  const raw = el.value.trim(); const n = Number(raw); const ok = raw !== '' && isFinite(n) && n >= r.min && (r.max == null || n <= r.max); const err = $('.p5b-err', row);
  if (ok) { el.removeAttribute('aria-invalid'); if (err) err.hidden = true; if (final && r.v !== n) { r.v = n; commitRow(r); syncDot(r, row); onMineChanged(r); } }   // a typed number is checked as it is typed and written when it is committed (blur, Enter, the spinner): a half-typed 1 on the way to 1000 is never stored
  else if (final) { el.value = r.v; el.removeAttribute('aria-invalid'); if (err) err.hidden = true; { const m = r.max == null ? t5('numMin', lab(r), r.min) : t5('numBad', lab(r), r.min, r.max); announce(m); toast(m, { ms: 3500 }); } }
  else { el.setAttribute('aria-invalid', 'true'); if (err) { err.hidden = false; err.textContent = r.max == null ? t5('numMinR', r.min) : t5('numRange', r.min, r.max); } }
  return true;
}
function pctInput(el, final) {   // the number field of a ratio row: the same clamp as the slider, written through the slider so slice 1 keeps the row in step
  const row = el.closest('[data-row]'); const r = R(el.dataset.rowid); if (!row || !mine(r)) return; const sl = $('input[type=range]', row); const raw = el.value.trim(); const n = Number(raw);
  if (raw === '' || !isFinite(n)) { if (final) el.value = r.v; return; }
  sl.value = String(Math.max(0, Math.min(100, Math.round(n)))); sl.dispatchEvent(new Event('input', { bubbles: true })); if (final) el.value = r.v;
}
function onInput(ev) {
  const el = ev.target; const sc = $('#pageScroll'); if (!(el instanceof Element) || !sc.contains(el)) return; const k = el.dataset ? el.dataset.p5b : '';
  if (k === 'pct') { ev.stopPropagation(); pctInput(el, false); return; }
  if (k === 'ws-q') { ev.stopPropagation(); P.ws.q = el.value; P.ws.act = -1; paintWs(true); return; }
  if (k === 'lora-url' || k === 'lora-scale') { ev.stopPropagation(); loraEdit(el, false); return; }
  if (k === 'sampler-text') { ev.stopPropagation(); const r = R('chatfeat.sdSampler'); if (el.value.trim()) { r.v = el.value; P.writes++; } return; }
  if (el.matches && el.matches('input[type=number]')) { const row = el.closest('[data-row]'); const r = row && R(row.dataset.row); if (mine(r)) { ev.stopPropagation(); numInput(el, false); return; } }
  if (el.matches && el.matches('input[type=range]')) {   // the shares of a HypaV3 preset are one whole: a change is clamped before slice 1 writes it (0 included)
    const row = el.closest('[data-row]'); const r = row && R(row.dataset.row);
    if (mine(r) && (r.id === 'chatfeat.hv3.recentMemoryRatio' || r.id === 'chatfeat.hv3.similarMemoryRatio')) {
      const w = r.id === 'chatfeat.hv3.recentMemoryRatio' ? 'recent' : 'similar'; const o = ratioWrite(w, el.value, 'slider'); if (o) { el.value = String(o.v); if (o.clamped) { announce(t5('ratClamped', o.lim)); } setTimeout(paintRatio, 0); }
    } else if (mine(r) && r.id === 'chatfeat.hv3.extraSummarizationRatio') { const lim = 100 - R('chatfeat.hv3.memoryTokensRatio').v; if (+el.value > lim) el.value = String(lim); }
  }
}
function onKeydown(ev) {
  const t = ev.target; const sc = $('#pageScroll'); if (!(t instanceof Element) || !sc.contains(t)) return;
  if (t.matches('[data-dim]') && (ev.key.length === 1 || ev.key === 'Backspace' || ev.key === 'Delete' || ev.key === 'Enter') && !ev.ctrlKey && !ev.metaKey && !ev.altKey) { ev.preventDefault(); ev.stopPropagation(); blockedDim(); return; }
  if (ev.key === 'Enter' && t.matches('input[type=number], input[data-p5b="lora-url"]') && !ev.isComposing && ev.keyCode !== 229) { ev.preventDefault(); t.dispatchEvent(new Event('change', { bubbles: true })); return; }
  if (t.matches('[data-p5b="ws-q"]') && ev.key === 'ArrowDown') { ev.preventDefault(); const l = $('#p5b-wlist'); if (l) l.focus({ preventScroll: true }); return; }
  if (t.matches('[data-p5b="ws-list"]')) wsKey(ev, t);
}
function wsKey(ev, ul) {
  const q = P.ws.q.trim().toLowerCase(); const list = ST.ws.models.filter((m) => !q || (m.name + ' ' + m.id).toLowerCase().indexOf(q) >= 0); if (!list.length) return; let a = P.ws.act < 0 ? Math.max(0, list.findIndex((m) => m.id === ST.ws.model)) : P.ws.act;
  const set = (i) => { P.ws.act = Math.max(0, Math.min(list.length - 1, i)); const opts = $$('.p5b-wopt', ul); opts.forEach((o, j) => o.classList.toggle('act', j === P.ws.act)); ul.setAttribute('aria-activedescendant', 'p5b-wo-' + P.ws.act); const cur = opts[P.ws.act]; if (cur) cur.scrollIntoView({ block: 'nearest' }); };
  if (ev.key === 'ArrowDown') { ev.preventDefault(); set(P.ws.act < 0 ? a : a + 1); } else if (ev.key === 'ArrowUp') { ev.preventDefault(); set(P.ws.act < 0 ? a : a - 1); } else if (ev.key === 'Home') { ev.preventDefault(); set(0); } else if (ev.key === 'End') { ev.preventDefault(); set(list.length - 1); }
  else if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); if (P.ws.act >= 0 && list[P.ws.act]) wsChoose(list[P.ws.act].id); }
  else if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) { ev.preventDefault(); const now = Date.now(); P.ws.ta = (now - P.ws.taT > 700 ? '' : P.ws.ta) + ev.key.toLowerCase(); P.ws.taT = now; const from = P.ws.ta.length === 1 ? Math.max(0, P.ws.act) + 1 : Math.max(0, P.ws.act); let i = -1; for (let n = 0; n < list.length; n++) { const j = (from + n) % list.length; if (list[j].name.toLowerCase().indexOf(P.ws.ta) === 0) { i = j; break; } } if (i >= 0) set(i); }
}
function onFocusin(ev) { const t = ev.target; if (t instanceof Element && t.matches && t.matches('[data-p5b="ws-list"]') && P.ws.act < 0) { const q = P.ws.q.trim().toLowerCase(); const list = ST.ws.models.filter((m) => !q || (m.name + ' ' + m.id).toLowerCase().indexOf(q) >= 0); const i = Math.max(0, list.findIndex((m) => m.id === ST.ws.model)); P.ws.act = list.length ? i : -1; if (list.length) { $$('.p5b-wopt', t).forEach((o, j) => o.classList.toggle('act', j === P.ws.act)); t.setAttribute('aria-activedescendant', 'p5b-wo-' + P.ws.act); } } }
function blockedDim() { const now = Date.now(); if (now - P.nomsg < 1500) return; P.nomsg = now; announce(t5('dimBlocked')); toast(t5('dimBlocked'), { ms: 3500 }); }
function onPointerDown(ev) { const t = ev.target; if (t instanceof Element && t.closest('[data-dim]')) { setTimeout(blockedDim, 0); } }
function loraAdd() { if (ST.ws.loras.length >= 3) return; ST.ws.loras.push({ url: '', scale: 1 }); const i = ST.ws.loras.length - 1; const e = pushLU(t5('luLoraAdd'), () => { ST.ws.loras.splice(i, 1); return ''; }, 'p5b-edit'); repaint('lu:' + i); void e; const f = $('[data-fk="lu:' + i + '"]'); if (f) f.focus({ preventScroll: true }); announce(t5('loraAdded', ST.ws.loras.length)); }
function loraDel(i) { const l = ST.ws.loras[i]; if (!l) return; ST.ws.loras.splice(i, 1); const e = pushLU(t5('luLoraDel'), () => { ST.ws.loras.splice(Math.min(i, ST.ws.loras.length), 0, l); return ''; }, 'p5b-edit'); repaint('lora:add'); toastUndo(t5('loraRemoved'), e); }
function loraEdit(el, final) {
  const i = +el.dataset.i; const l = ST.ws.loras[i]; if (!l) return; const isUrl = el.dataset.p5b === 'lora-url';
  if (isUrl) l.url = el.value; else { const n = Number(el.value); if (el.value !== '' && isFinite(n) && n >= 0 && n <= 2) { l.scale = n; el.removeAttribute('aria-invalid'); } else if (final) { el.value = l.scale; el.removeAttribute('aria-invalid'); announce(t5('numBad', t5('loraScale', i + 1), 0, 2)); } else el.setAttribute('aria-invalid', 'true'); }
  P.writes++;
}

function bindPage5b() {
  const sc = $('#pageScroll');
  [['click', onClick], ['input', onInput], ['change', onChange], ['keydown', onKeydown], ['focusin', onFocusin], ['pointerdown', onPointerDown]].forEach((p) => sc.addEventListener(p[0], p[1], true));
  sc.addEventListener('toggle', (ev) => { if (ev.target.id === 'p5b-adv') P.open.adv = ev.target.open; else if (ev.target.id === 'p5b-hires') P.open.hires = ev.target.open; }, true);
  new MutationObserver(() => { enhance(); }).observe(sc, { childList: true, subtree: true });
}

/* ------------------------------------------------------------------ hooks called by slice1.js (wrapping slice 2's, 3's, 4's and 5a's) */
const H = {};
['boot', 'pageHTML', 'rendered', 'nav', 'back', 'closing', 'backLabel', 'headerTitle', 'indexExtra', 'lang', 'title', 'demoPanel', 'afterInit', 'ready', 'rowChanged', 'sectionBody'].forEach((k) => { H[k] = X[k]; });
X.pageHTML = (pid, o) => {
  if (pid === 'chatfeat') return chatfeatHTML(o);
  if (pid === 'lang' && P.sub && P.sub.kind === 'trpreset') { const h = trPresetHTML(); if (h) return h; P.sub = null; ST.trEdit = ''; }
  return H.pageHTML ? H.pageHTML(pid, o) : null;
};
X.sectionBody = (s, body, o) => {
  if (s.id === 'lang.translate') return trBody(o);
  const r = H.sectionBody ? H.sectionBody(s, body, o) : undefined;
  if (s.id === 'models.models') return insertEmb(r != null ? r : body);
  return r;
};
X.rowChanged = (r) => {
  if (H.rowChanged) H.rowChanged(r);
  if (!mine(r)) return;
  if (r.type === 'switch' || r.type === 'select' || r.type === 'segmented') commitRow(r);
  onMineChanged(r); if (REPAINT.has(r.id) && A.S.open && r.type !== 'slider') setTimeout(() => repaint(), 0);
};
X.rendered = (pg) => {
  if (H.rendered) H.rendered(pg);
  enhance(); P.hl = '';
};
function runPending() {
  const pd = P.pending; P.pending = null; if (!pd || !A.S.open) return;
  if (pd.kind === 'mp') { if (pmById('mem', pd.id)) openSub('memory-preset', pd.id, 'pm:mem:edit'); return; }
  if (pd.kind === 'tp') { if (pmById('tr', pd.id)) openSub('trpreset', pd.id, 'pm:tr:edit'); return; }
  const el = $(`#pageScroll [data-p5bid="${pd.kind}:${CSS.escape(pd.id)}"]`); if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: A.S.rm || A.S.lp ? 'auto' : 'smooth' }); A.highlight(el); const f = $('input:checked, button, input, a', el); if (f) f.focus({ preventScroll: true });
}
X.nav = (pid, o) => {
  if (H.nav) H.nav(pid, o);
  if (!o.p5b) { P.sub = null; ST.editId = ''; ST.trEdit = ''; }
  const r = o.row;
  if (r && mine(r) && !o.p5b && !unavail(r)) {   // a search hit or a jump to a row that lives on a sub-page opens that page first
    if (r.hv) { P.sub = { kind: 'memory-preset', id: ST.presetActive }; ST.editId = ST.presetActive; }
    else if (r.trp) { P.sub = { kind: 'trpreset', id: ST.trActive }; ST.trEdit = ST.trActive; }
    else if (r.dep && r.dep.id === 'chatfeat.sdProvider' && A.S.lay === 'phone') P.sub = { kind: 'imggen', id: rv('chatfeat.sdProvider') };
  }
  if (o.thing) { const m = /^chatitem:(\w+):(.+)$/.exec(o.thing); if (m) { P.pending = { kind: m[1], id: m[2] }; setTimeout(runPending, 0); } }
};
X.back = () => {
  if (A.S.open && P.sub && !A.S.resume && inMine()) { subClose(); return true; }
  return H.back ? H.back() : false;
};
X.backLabel = () => {
  if (A.S.open && P.sub && inMine()) { const k = P.sub.kind; const key = k === 'memory-preset' ? 'Mem' : k === 'voices' ? 'Voice' : k === 'imggen' ? 'Img' : 'Tr'; return { label: t5('back' + key), vis: t5('back' + key + 'S') }; }
  return H.backLabel ? H.backLabel() : null;
};
X.headerTitle = () => { if (A.S.open && P.sub && inMine()) { const t = subTitleOf(); if (t) return t; } return H.headerTitle ? H.headerTitle() : null; };
X.closing = () => {
  const r = H.closing ? H.closing() : true; if (r === false) return false;
  P.embWarn = false; clearTests(); if (P.timers.ws) { clearTimeout(P.timers.ws); delete P.timers.ws; if (P.ws.status === 'loading') P.ws.status = ST.ws.models.length ? 'ok' : 'idle'; }
  P.sub = null; P.draft = {}; ST.editId = ''; ST.trEdit = ''; return true;
};
X.lang = (l) => { if (H.lang) H.lang(l); document.title = K[l].title; };
X.title = (l) => K[l].title;
X.indexExtra = (mk, IDX) => {
  if (H.indexExtra) H.indexExtra(mk, IDX);
  const pg = A.PAGE, SEC = A.SEC;
  const thing = (id, ico, ko, en, syn, dk, de, pid, sid) => { const p = pg[pid], s = SEC[sid]; IDX.push(mk('chatitem', 'chatitem:' + id, ico, ko, en || ko, syn, id, p.ko + (s.ko ? ' › ' + s.ko : ''), p.en + (s.en ? ' › ' + s.en : ''), dk, de === undefined ? dk : de, '', '', { page: pid, sec: sid, thing: id, nocr: true })); };
  ST.presets.forEach((p) => thing('mp:' + p.id, 'brain', p.name, p.name, 'hypa v3 preset 프리셋 하이파', K.ko.srchMemPreset, K.en.srchMemPreset, 'chatfeat', 'chatfeat.memory'));
  ST.trPresets.forEach((p) => thing('tp:' + p.id, 'languages', p.name, p.name, 'translator preset 번역 프리셋 risutl', K.ko.srchTrPreset, K.en.srchTrPreset, 'lang', 'lang.translate'));
  VOICE_SVCS.forEach((s) => thing('vs:' + s, 'volume-2', SV[s].n, SV[s].nEn || SV[s].n, 'tts voice 음성 읽어주기 목소리 ' + s, K.ko.srchVoice, K.en.srchVoice, 'chatfeat', 'chatfeat.voice'));
  VOICE_LISTED.forEach((x) => thing('vs:' + x[0], 'volume-2', K.ko[x[1]], K.en[x[1]], 'tts voice 음성 목소리 ' + x[0], K.ko.srchVoice, K.en.srchVoice, 'chatfeat', 'chatfeat.voice'));
  IMG_PROV.forEach((p) => thing('ip:' + p[0], 'image', p[1], p[2], 'image generation provider 이미지 생성 서비스 그림 ' + p[0], K.ko.srchImg, K.en.srchImg, 'chatfeat', 'chatfeat.imagegen'));
  TYPE_ORDER.forEach((v) => thing('tt:' + v, 'languages', v === 'llm' ? K.ko.ttLlmN : v === 'bergamot' ? K.ko.ttLocalN : typeName(v), v === 'llm' ? K.en.ttLlmN : v === 'bergamot' ? K.en.ttLocalN : typeName(v), 'translator type 번역 방식 번역기 ' + v, K.ko.srchTrType, K.en.srchTrType, 'lang', 'lang.translate'));
};
X.demoPanel = (p) => {
  if (H.demoPanel) H.demoPanel(p);
  const h = document.createElement('div'); h.className = 'ps-demo p5b-demo';
  const sw = (id, label, on) => `<label class="d-row"><span>${esc(label)}</span><span class="sw" data-part="settings-toggle"><input type="checkbox" role="switch" id="${id}"${on ? ' checked' : ''}><span class="sw-ui" aria-hidden="true"></span></span></label>`;
  h.innerHTML = `<h3 class="d-h">${esc(t5('demo5b'))}</h3><p class="d-note" id="d5bSim">${esc(t5('demoSim'))}</p><label class="d-row"><span>${esc(t5('demoSet'))}</span><select id="d5bSet">${[['demo', 'setDemo'], ['legacy', 'setLegacy'], ['failing', 'setFailing'], ['empty', 'setEmpty']].map(([v, k]) => `<option value="${v}"${DB.SET5B === v ? ' selected' : ''}>${esc(t5(k))}</option>`).join('')}</select></label>` +
    sw('d5bGpu', t5('demoGpu'), FL.gpu) + sw('d5bChar', t5('demoChar'), !!ST.activeChar) + sw('d5bWeb', t5('demoWeb'), FL.web) + sw('d5bAll', t5('demoAllFail'), ST.sim.all) + sw('d5bHf', t5('demoHf'), ST.sim.hf503) +
    `<label class="d-row"><span>${esc(t5('demoWsFetch'))}</span><select id="d5bWs">${['ok', 'fail', 'empty'].map((v) => `<option value="${v}"${ST.sim.wsFetch === v ? ' selected' : ''}>${v}</option>`).join('')}</select></label>` +
    `<label class="d-row"><span>${esc(t5('demoState'))}</span><select id="d5bState">${STATES5B.map((s) => `<option>${s}</option>`).join('')}</select></label><div class="d-btns"><button type="button" data-part="settings-button" class="btn solid" id="d5bGo"><span>${esc(t5('demoGo'))}</span></button></div>`;
  p.appendChild(h);
  const reload = (k, v) => { const u = new URL(location.href); u.searchParams.set(k, v); location.href = u.toString(); };
  $('#d5bSet', h).onchange = (e) => reload('set', e.target.value); $('#d5bGpu', h).onchange = (e) => reload('gpu', e.target.checked ? '1' : '0'); $('#d5bWeb', h).onchange = (e) => reload('web', e.target.checked ? '1' : '0');
  $('#d5bChar', h).onchange = (e) => { ST.activeChar = e.target.checked ? 'ch1' : ''; if (A.S.open) repaint(); };
  $('#d5bAll', h).onchange = (e) => { ST.sim.all = e.target.checked; };
  $('#d5bHf', h).onchange = (e) => { ST.sim.hf503 = e.target.checked; };
  $('#d5bWs', h).onchange = (e) => { ST.sim.wsFetch = e.target.value; };
  $('#d5bGo', h).onclick = () => { runState5b($('#d5bState', h).value); };
};
X.afterInit = (o) => {
  if (H.afterInit) H.afterInit(o);
  const v = Q.get('view'), id = Q.get('id'), svc = Q.get('svc');
  if (v === 'memory-preset' && id && pmById('mem', id)) { A.showPage('chatfeat', { p5b: true, noAnim: true, keepFocus: true, force: true }); openSub('memory-preset', id, 'pm:mem:edit'); }
  else if (v === 'trpreset' && id && pmById('tr', id)) { A.showPage('lang', { p5b: true, noAnim: true, keepFocus: true, force: true }); openSub('trpreset', id, 'pm:tr:edit'); }
  else if (v === 'voices') { A.showPage('chatfeat', { p5b: true, noAnim: true, keepFocus: true, force: true }); openSub('voices', '', 'vo:open'); }
  else if (v === 'imggen' && svc && (IMG_PROV.some((p) => p[0] === svc) || svc === 'comfy')) { A.showPage('chatfeat', { p5b: true, noAnim: true, keepFocus: true, force: true }); openSub('imggen', svc, 'ig:open'); }
  else if (v) A.showPage(v === 'trpreset' ? 'lang' : 'chatfeat', { noAnim: true, notice: A.t('settingNotFound'), force: true });
};
X.ready = () => { if (H.ready) H.ready(); window.__ss5bReady = true; };
X.boot = (api) => {
  if (H.boot) H.boot(api);
  A = api; B = window.__ss2; C3 = window.__ss3; Object.assign(A.ICONS, ICONS5B); document.title = K[A.S.lang].title;
  A.GROUPS.splice(A.GROUPS.indexOf('setting') + 1, 0, 'chatitem'); A.T.ko.grp.chatitem = K.ko.grpItem; A.T.en.grp.chatitem = K.en.grpItem;
  P.ws.status = ST.ws.models.length ? 'ok' : 'idle';
  P.booted = true; bindPage5b(); window.__ss5b = API();
  const st = Q.get('state'); if (st && STATES5B.indexOf(st) >= 0) setTimeout(() => runState5b(st), 0);
};

/* ------------------------------------------------------------------ outside writes (the store: another tab, Studio, a chat); every page reads the store by id, so a write shows at once */
function storeWrite(kind, id, v) {
  switch (kind) {
    case 'row': { const r = R(id); if (r) setRow(r, v); break; }
    case 'engine': R('chatfeat.memEngine').v = id; break;
    case 'hv-preset': { const p = pmById('mem', id); if (p) { if (v && v.name !== undefined) p.name = v.name; if (v && v.settings) Object.assign(p.settings, v.settings); } break; }
    case 'hv-active': if (pmById('mem', id)) ST.presetActive = id; break;
    case 'tr-preset': { const p = pmById('tr', id); if (p) Object.assign(p, v); break; }
    case 'tr-active': if (pmById('tr', id)) ST.trActive = id; break;
    case 'voice': { const x = ST.voices.find((q) => q.id === id); if (x) Object.assign(x, v); break; }
    case 'cache': ST.trCache = Number(id); break;
    case 'ws-model': ST.ws.model = String(id); break;
    case 'active-char': ST.activeChar = id; break;
    default: break;
  }
  ST.extWrites++; Object.keys(SH).forEach((k) => { delete SH[k]; }); A.buildIndex(); if (A.S.open) repaint();
}

/* ------------------------------------------------------------------ states (SLICE5B_SPEC 10.3) */
const STATES5B = ['me-engines', 'me-switch-undo', 'me-v3-preset', 'me-preset-menu', 'me-preset-editor', 'me-ratio-clamp', 'me-experimental', 'me-supa-needs-key',
  'vo-list', 'vo-test', 'vo-test-fail', 'vo-voices', 'vo-voicevox-translate', 'em-model', 'em-embedding',
  'ig-list', 'ig-webui', 'ig-openai', 'ig-wavespeed', 'ig-wavespeed-fail', 'ig-test', 'ig-legacy-comfy', 'ig-prompt-nochar',
  'tr-ai', 'tr-google', 'tr-deeplx', 'tr-firefox', 'tr-preset', 'tr-cache-clear', 'tr-test', 'mo-embedding', 'mo-embedding-warn', 'mo-embedding-nosize', 'se-hypa', 'se-sampler', 'se-emotionprompt'];
const SET_OF = { 'me-supa-needs-key': 'legacy', 'ig-legacy-comfy': 'legacy', 'tr-firefox': 'legacy' };
const needSet = (set) => { if (DB.SET5B === set) return false; const u = new URL(location.href); u.searchParams.set('set', set); location.replace(u.toString()); return true; };
async function until(f, ms) { const t0 = Date.now(); while (Date.now() - t0 < (ms || 4000)) { if (f()) return true; await sleep(15); } return false; }
async function runState5b(name) {
  window.__ss5bReady = false; const q = Q.get('q');
  if (SET_OF[name] && needSet(SET_OF[name])) return new Promise(() => {});
  const openS = (opt) => { if (!A.S.open) A.openSettings($('#oSettings'), Object.assign({ noFocus: true }, opt || {})); };
  const page = (pid, opt) => { openS({ page: pid }); P.sub = null; ST.editId = ''; ST.trEdit = ''; A.showPage(pid, Object.assign({ noAnim: true, keepFocus: true, force: true }, opt || {})); };
  const toEl = (sel) => { const e = $(sel); if (e) e.scrollIntoView({ block: 'center' }); return e; };
  const settle = () => sleep(60);
  const quick = async (kind, s) => { const keep = CFG.testMs; CFG.testMs = 80; runTest(kind, s); await until(() => P.tests[kind + ':' + s] && P.tests[kind + ':' + s].s !== 'run', 3000); CFG.testMs = keep; };
  const igSub = async () => { if (A.S.lay === 'phone') { openSub('imggen', rv('chatfeat.sdProvider'), 'ig:open'); await settle(); } };   // on a phone the fields of a service are a sub-page
  const slide = (rowId, v) => { const sl = $(`#pageScroll [data-row="${rowId}"] input[type=range]`); if (sl) { sl.value = String(v); sl.dispatchEvent(new Event('input', { bubbles: true })); sl.dispatchEvent(new Event('change', { bubbles: true })); } };
  if (/^me-(v3|preset|ratio|exp)/.test(name) && R('chatfeat.memEngine').v !== 'hypav3') R('chatfeat.memEngine').v = 'hypav3';   // a state run after another one on the same page starts from HypaV3, as its own page load does
  switch (name) {
    case 'me-engines': page('chatfeat', { section: 'chatfeat.memory' }); break;
    case 'me-switch-undo': page('chatfeat', { section: 'chatfeat.memory' }); await settle(); setEngine('hanurai'); break;
    case 'me-v3-preset': page('chatfeat', { section: 'chatfeat.memory' }); await settle(); toEl('.p5b-pbar'); break;
    case 'me-preset-menu': page('chatfeat', { section: 'chatfeat.memory' }); await settle(); toEl('.p5b-pbar'); pmMenu('mem', $('[data-fk="pm:mem:menu"]')); break;
    case 'me-preset-editor': page('chatfeat'); await settle(); openSub('memory-preset', 'hp1', 'pm:mem:edit'); break;
    case 'me-ratio-clamp': page('chatfeat'); await settle(); openSub('memory-preset', 'hp1', 'pm:mem:edit'); await settle(); slide('chatfeat.hv3.recentMemoryRatio', 70); slide('chatfeat.hv3.similarMemoryRatio', 60); await settle(); toEl('.p5b-ratio'); break;
    case 'me-experimental': page('chatfeat'); await settle(); P.open.adv = true; openSub('memory-preset', 'hp3', 'pm:mem:edit'); await settle(); toEl('#p5b-adv'); break;
    case 'me-supa-needs-key': page('chatfeat', { section: 'chatfeat.memory' }); await settle(); toEl('.p5b-eng'); break;
    case 'vo-list': page('chatfeat', { section: 'chatfeat.voice' }); break;
    case 'vo-test': page('chatfeat', { section: 'chatfeat.voice' }); await settle(); await quick('voice', 'elevenlab'); toEl('[data-p5bid="vs:elevenlab"]'); break;
    case 'vo-test-fail': page('chatfeat', { section: 'chatfeat.voice' }); await settle(); await quick('voice', 'fishspeech'); toEl('[data-p5bid="vs:fishspeech"]'); break;
    case 'vo-voices': page('chatfeat'); await settle(); openSub('voices', '', 'vo:open'); break;
    case 'vo-voicevox-translate': page('chatfeat', { section: 'chatfeat.voice' }); await settle(); toEl('[data-p5bid="vs:VOICEVOX"]'); break;
    case 'em-model': page('chatfeat', { section: 'chatfeat.emotion' }); break;
    case 'em-embedding': R('chatfeat.emotionProcesser').v = 'embedding'; page('chatfeat', { section: 'chatfeat.emotion' }); break;
    case 'ig-list': page('chatfeat', { section: 'chatfeat.imagegen' }); break;
    case 'ig-webui': page('chatfeat', { section: 'chatfeat.imagegen' }); await settle(); await igSub(); toEl('.p5b-fields'); break;
    case 'ig-openai': R('chatfeat.sdProvider').v = 'openai-compat'; page('chatfeat', { section: 'chatfeat.imagegen' }); await settle(); await igSub(); toEl('.p5b-fields'); break;
    case 'ig-wavespeed': R('chatfeat.sdProvider').v = 'wavespeed'; page('chatfeat', { section: 'chatfeat.imagegen' }); await settle(); await igSub(); toEl('.p5b-ws'); break;
    case 'ig-wavespeed-fail': R('chatfeat.sdProvider').v = 'wavespeed'; ST.sim.wsFetch = 'fail'; page('chatfeat', { section: 'chatfeat.imagegen' }); await settle(); await igSub(); { const keep = CFG.fetchMs; CFG.fetchMs = 80; wsFetch(); await until(() => P.ws.status !== 'loading', 3000); CFG.fetchMs = keep; } toEl('.p5b-ws'); break;
    case 'ig-test': page('chatfeat', { section: 'chatfeat.imagegen' }); await settle(); await quick('image', rv('chatfeat.sdProvider')); toEl('[data-testbox^="image:"]'); break;
    case 'ig-legacy-comfy': page('chatfeat', { section: 'chatfeat.imagegen' }); await settle(); await igSub(); toEl('.p5b-fields'); break;
    case 'ig-prompt-nochar': ST.activeChar = ''; page('chatfeat', { section: 'chatfeat.imagegen' }); await settle(); toEl('.p5b-pview'); break;
    case 'tr-ai': page('lang', { section: 'lang.translate' }); break;
    case 'tr-google': R('lang.translatorType').v = 'google'; page('lang', { section: 'lang.translate' }); break;
    case 'tr-deeplx': R('lang.translatorType').v = 'deeplx'; page('lang', { section: 'lang.translate' }); break;
    case 'tr-firefox': page('lang', { section: 'lang.translate' }); break;
    case 'tr-preset': page('lang'); await settle(); openSub('trpreset', 'tp2', 'pm:tr:edit'); break;
    case 'tr-cache-clear': page('lang', { section: 'lang.translate' }); await settle(); toEl('.p5b-cache'); cacheClear(); break;
    case 'tr-test': page('lang', { section: 'lang.translate' }); await settle(); await quick('translate', rv('lang.translatorType')); toEl('.p5b-trtest'); break;
    case 'mo-embedding-warn': R('models.embedModel').v = 'nomic'; P.embWarn = true; openS({ page: 'models', noFocus: true }); P.sub = null; A.showPage('models', { noAnim: true, keepFocus: true, force: true, row: R('models.embedModel') }); break;
    case 'mo-embedding-nosize': R('models.embedModel').v = 'bge-m3-ko'; openS({ page: 'models', noFocus: true }); P.sub = null; A.showPage('models', { noAnim: true, keepFocus: true, force: true, row: R('models.embedModel') }); break;
    case 'mo-embedding': openS({ page: 'models', noFocus: true }); P.sub = null; A.showPage('models', { noAnim: true, keepFocus: true, force: true, row: R('models.embedModel') }); break;
    case 'se-hypa': openS({ page: 'chatfeat', noFocus: true }); window.__ss1.setQuery(q || 'hypaV3'); break;
    case 'se-sampler': openS({ page: 'chatfeat', noFocus: true }); window.__ss1.setQuery(q || 'sampler'); break;
    case 'se-emotionprompt': openS({ page: 'chatfeat', noFocus: true }); window.__ss1.setQuery(q || 'emotionPrompt'); break;
    default: break;
  }
  await sleep(60); window.__ss5bReady = name;
}

/* ------------------------------------------------------------------ public API (checks, the demo panel and reviewers) */
function API() {
  return {
    P, ST, K, CFG, t5, A, B, C3, D, DB, FL, SV, SH, PM, STATES: STATES5B, runState: runState5b, repaint, openSub, subClose, storeWrite, enhance, mine, rowF, commitRow, numInput, studioLink,
    setEngine, setChoice, pmAct, pmById, pmNew, pmDup, pmRename, pmExport, pmImport, pmDelete, pmChoose, pmMenu, mpResetAll, ratioWrite, paintRatio, ENG_ORDER, embRowHTML, trSummary,
    runTest, cancelTest, plan, wsFetch, wsChoose, conn, chipHTML, addConnection, cacheClear, cacheExport, cacheImport, loraAdd, loraDel, taskModelName, embName, typeName,
  };
}
})();
