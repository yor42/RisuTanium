/* Studio slice 4, part 3: the Advanced form (SLICE4_SPEC section 4) and the protected risky section (section 6, DD-165, DD-169). Seven groups, empty fields folded behind "add a field" (DD-163, DD-174),
   token bias rows, the creator's comment in language tabs, the depth prompt (number beside a compact editor), the toggle link row, memory and module actions; the risky flags ask once per turn-on. Synthetic. */
(function () {
  'use strict';
  const ST = window.__st1, A = ST.api, S = A.S, LT = window.LTX, S4 = window.__st4;
  const { nm, ic, esc, $, $$ } = A; const t = (k, v) => A.t(k, v);
  const K = S4.core, H = S4.h, BY = S4.BYKEY, dr = K.dr;
  S4.seq = 0;
  const LANGS = { ko: '한국어', en: 'English', ja: '日本語', zh: '中文', es: 'Español' };

  /* ---------------------------------------------------------------- field renderers */
  function biasRows(oid, f, ro) {
    const rows = f.bias || [], d = BY.bias, v = dr(oid);
    return '<div class="studio-field" data-part="studio-field" data-field="bias" data-filled="' + (rows.length > 0) + '"><div class="studio-field-label" data-part="studio-field-label"><span id="s4-lab-bias">' + esc(H.label(d)) + '</span>' + H.helpBtn(oid, d) + '</div>' +
      '<div class="studio-bias-list" role="list" aria-labelledby="s4-lab-bias">' + (rows.length ? rows.map((b) => '<div class="studio-bias-row" data-part="studio-bias-row" role="listitem" data-row="' + b.id + '"><div class="studio-bias-fld"><label for="s4-bt-' + b.id + '">' + esc(t('s4BiasToken')) + '</label><input type="text" id="s4-bt-' + b.id + '" class="studio-input" data-s4in="biasTok" data-id="' + b.id + '" value="' + esc(b.token) + '" autocomplete="off" spellcheck="false"' + (ro ? ' disabled' : '') + '></div>' +
        '<div class="studio-bias-fld"><label for="s4-bv-' + b.id + '">' + esc(t('fBiasValue')) + '</label><input type="number" id="s4-bv-' + b.id + '" class="studio-input" data-s4in="biasVal" data-id="' + b.id + '" min="-100" max="100" step="1" inputmode="numeric" value="' + esc(b.value) + '"' + (ro ? ' disabled' : '') + '></div>' +
        (ro ? '' : '<button type="button" class="btn sm studio-bias-del" data-s4-act="biasdel" data-id="' + b.id + '" aria-label="' + esc(t('s4BiasDel') + ': ' + (b.token || '')) + '" title="' + esc(t('s4BiasDel')) + '">' + ic('trash-2', 18) + '</button>') +
        '<p class="studio-field-note" data-part="studio-field-note" id="s4-bn-' + b.id + '"' + noteOf(rows, b, v) + '</p></div>').join('') : '<p class="studio-empty-line">' + esc(t('s4BiasEmpty')) + '</p>') + '</div>' +
      (ro ? '' : '<button type="button" class="btn solid studio-bias-add" data-s4-act="biasadd" data-focus="bias">' + ic('plus', 16) + '<span>' + esc(t('s4BiasAdd')) + '</span></button>') + H.helpBody(oid, d) + '</div>';
  }
  /* note text for a bias row: this token is listed twice (info), or the value was brought into range (info); computed from the store */
  function noteOf(rows, b, v) {
    const dup = b.token.trim() && rows.filter((x) => x.token.trim().toLowerCase() === b.token.trim().toLowerCase()).length > 1; const clamp = v.flash['bias' + b.id];
    const msg = [dup ? t('fBiasDup') : '', clamp ? t(clamp === 'empty' ? 's4BiasZeroed' : 'fBiasClamp') : ''].filter(Boolean).join(' · ');
    return (msg ? ' data-kind="info">' + ic('info', 14) + '<span>' + esc(msg) + '</span>' : ' hidden>');
  }
  function refreshBiasNotes(oid) {
    const f = K.fOf(oid, 'advanced'), rows = f.bias || [], v = dr(oid);
    rows.forEach((b) => { const p = document.getElementById('s4-bn-' + b.id); if (!p) return; const html = noteOf(rows, b, v); const on = !html.startsWith(' hidden'); p.hidden = !on; p.innerHTML = on ? html.slice(html.indexOf('>') + 1) : ''; if (on) p.dataset.kind = 'info'; });
  }
  S4.ins.biasTok = (el) => { const oid = S4.cur.oid, id = el.dataset.id, v = el.value; K.W(oid, 'advanced', t('s4StepBias'), (f) => { const b = (f.bias || []).find((x) => x.id === id); if (b) b.token = v; }, 'bias.' + id + '.t'); S4.touchShown(oid, 'bias'); refreshBiasNotes(oid); A.renderTree(); };
  S4.chg.biasVal = (el) => {
    const oid = S4.cur.oid, id = el.dataset.id, raw = parseInt(el.value, 10); let n = isNaN(raw) ? 0 : raw; const clamped = n > 100 ? 100 : n < -100 ? -100 : n; const was = el.value.trim() === '' ? 'empty' : clamped !== raw ? 'clamp' : false;   /* n-1: an emptied value says so */
    K.W(oid, 'advanced', t('s4StepBias'), (f) => { const b = (f.bias || []).find((x) => x.id === id); if (b) b.value = clamped; }, 'bias.' + id + '.v'); el.value = clamped; dr(oid).flash['bias' + id] = was; refreshBiasNotes(oid); if (was) S4.say(t(was === 'empty' ? 's4BiasZeroed' : 'fBiasClamp'));
  };
  S4.ins.biasVal = (el) => { const oid = S4.cur.oid; if (dr(oid).flash['bias' + el.dataset.id]) { dr(oid).flash['bias' + el.dataset.id] = false; refreshBiasNotes(oid); } };
  S4.acts.biasadd = () => {
    const oid = S4.cur.oid, id = 'n' + (++S4.seq); K.W(oid, 'advanced', t('s4StepBias'), (f) => { f.bias = (f.bias || []).concat([{ id, token: '', value: 0 }]); }); S4.touchShown(oid, 'bias'); A.renderTree(); K.rerender('#s4-bt-' + id);
  };
  S4.acts.biasdel = (b) => {
    const oid = S4.cur.oid, id = b.dataset.id, f = K.fOf(oid, 'advanced'), i = (f.bias || []).findIndex((x) => x.id === id); if (i < 0) return; const rem = JSON.parse(JSON.stringify(f.bias[i]));
    K.W(oid, 'advanced', t('s4StepBiasDel'), (ff) => { ff.bias = ff.bias.filter((x) => x.id !== id); }); A.renderTree(); const alive = S4.undoGuard(oid);
    const left = K.fOf(oid, 'advanced').bias || []; const next = left[i] || left[i - 1];
    K.rerender(next ? '#s4-bt-' + next.id : '.studio-bias-add'); A.toast(t('s4Deleted', { name: rem.token || t('fl_bias') }), { ms: 10000, endsOnClose: true, action: { label: t('undoBtn'), fn: () => { if (!alive() || (K.fOf(oid, 'advanced').bias || []).some((x) => x.id === rem.id)) return; K.W(oid, 'advanced', t('s4StepRestoreRow'), (ff) => { const a = (ff.bias || []).slice(); a.splice(Math.min(i, a.length), 0, rem); ff.bias = a; }); A.renderTree(); K.rerender('#s4-bt-' + rem.id); } } });
    S4.say(t('s4Deleted', { name: rem.token || t('fl_bias') }));
  };

  /* creator's comment: one editor per language, tabs on top (KO and EN first, + adds a language) */
  function notesHtml(oid, f, ro) {
    const d = BY.creatorNotes, notes = f.creatorNotes || {}, v = dr(oid); const langs = ['ko', 'en'].concat(Object.keys(notes).filter((k) => k !== 'ko' && k !== 'en'));
    const cur = langs.includes(v.lang) ? v.lang : (langs.includes(S.lang) ? S.lang : langs[0]);
    const tabs = '<div class="studio-lang-tabs" role="tablist" aria-label="' + esc(t('s4LangTabs')) + '">' + langs.map((l) => '<button type="button" role="tab" class="btn sm studio-lang-tab" id="s4-lt-' + l + '" data-s4-act="lang" data-lang="' + l + '" aria-selected="' + (l === cur) + '" aria-controls="s4-lp" tabindex="' + (l === cur ? 0 : -1) + '">' + esc(LANGS[l] || l) + '</button>').join('') + (ro ? '' : '<button type="button" class="btn sm" data-s4-act="langadd" aria-haspopup="menu" aria-label="' + esc(t('s4LangAdd')) + '" title="' + esc(t('s4LangAdd')) + '">' + ic('plus', 16) + '</button>') + '</div>';
    return '<div class="studio-notes">' + tabs + '<div role="tabpanel" id="s4-lp" aria-labelledby="s4-lt-' + cur + '" data-lang="' + cur + '">' + H.ltField(oid, d, notes[cur], { ro, mode: 'plain', set: 'sub:' + cur }) + '</div></div>';
  }
  S4.acts.lang = (b) => { dr(S4.cur.oid).lang = b.dataset.lang; K.rerender('[role="tab"][aria-selected="true"]'); };
  S4.acts.langadd = (b) => {
    const oid = S4.cur.oid, notes = K.fOf(oid, 'advanced').creatorNotes || {}, items = Object.keys(LANGS).filter((l) => !(l in notes) && l !== 'ko' && l !== 'en').map((l) => ['plus', LANGS[l], () => {
      K.W(oid, 'advanced', t('s4StepLang'), (f) => { f.creatorNotes = Object.assign({}, f.creatorNotes || {}, { [l]: '' }); }); dr(oid).lang = l; S4.touchShown(oid, 'creatorNotes'); K.rerender('[data-key="creatorNotes"]');
    }, '']);
    if (!items.length) return; A.openMenu(b, t('s4LangAdd'), items);
  };
  /* arrow keys in any tablist of the forms: left / right / home / end move and activate (cheap panels) */
  S4.keys.tabs = (e) => {
    const tab = e.target.closest && e.target.closest('[role="tab"]'); if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return false;
    const tabs = $$('[role="tab"]', tab.parentElement).filter((x) => x.dataset.s4Act === tab.dataset.s4Act); const i = tabs.indexOf(tab); if (i < 0) return false;
    const rtl = getComputedStyle(tab.parentElement).direction === 'rtl'; const step = e.key === 'ArrowRight' ? (rtl ? -1 : 1) : e.key === 'ArrowLeft' ? (rtl ? 1 : -1) : 0;
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + step + tabs.length) % tabs.length; e.preventDefault(); tabs[n].click(); return true;
  };

  S4.ins.depth = (el) => { const oid = S4.cur.oid; const n = Math.max(0, parseInt(el.value, 10) || 0); K.W(oid, 'advanced', t('s4StepField', { f: t('fl_depth_prompt') }), (f) => { f.depth = n; }, 'depth'); S4.touchShown(oid, 'depth_prompt'); };
  S4.acts.togglelink = () => { const oid = S4.cur.oid, it = K.tgItem(oid); if (it) A.openItem(it.id, { focus: true, user: true }); else ST.addItem(oid, 'toggles'); };

  /* ---------------------------------------------------------------- module actions (simulated) and Hypa memory (a stub that stands for today's modal) */
  S4.acts.moduleApply = (b) => {
    const oid = S4.cur.oid, mods = A.ownerList().filter((x) => x.type === 'module');
    A.openSheet({ title: t('fModuleApply'), opener: b, cls: 'dlg', build(body) {
      const root = document.createElement('div'); root.className = 'studio-sheet-root'; body.appendChild(root);
      root.innerHTML = '<p class="txt">' + esc(t('s4ModulePick')) + '</p><p class="txt">' + esc(t('fModuleApplyNote')) + '</p><div class="studio-modlist">' + mods.map((m) => '<button type="button" class="btn item" data-mod="' + m.id + '">' + ic('puzzle', 20) + '<span>' + esc(nm(m.name)) + '</span></button>').join('') + '</div><div class="confirm-row"><button type="button" class="btn" data-x="cancel" data-autofocus="1">' + ic('x', 18) + '<span>' + esc(t('fRiskyCancel')) + '</span></button></div>';
      root.addEventListener('click', (e) => { const m = e.target.closest('[data-mod]'); if (m) { A.closeSheet(true); const mo = A.O(m.dataset.mod); A.toast(t('s4ModuleApplied', { m: nm(mo.name) }), { ms: 10000, endsOnClose: true, action: { label: t('undoBtn'), fn: () => { A.toast(t('s4ModuleUndone'), { ms: 4000 }); S4.say(t('s4ModuleUndone')); } } });   /* DD-246: Apply runs at once and offers the 10 s Undo (simulated) */ S4.say(t('s4ModuleApplied', { m: nm(mo.name) })); } else if (e.target.closest('[data-x="cancel"]')) A.closeSheet(true); });
    } });
  };
  S4.acts.moduleConvert = () => {
    const oid = S4.cur.oid, o = A.O(oid), id = 'mx' + (++S.seq), name = t('s4ModuleNameFor', { c: nm(o.name) });
    S.db.owners[id] = { id, type: 'module', name, scope: 'chat', active: true, items: [] }; S.db.order.push(id); S.extra.push(id); A.touchSave(); A.renderTree();
    A.toast(t('fModuleMade'), { ms: 6000, action: { label: t('s4ModuleOpen'), fn: () => { S.exp.add('s:modules'); S.exp.add('o:' + id); S.sel = 'o:' + id; S.view = { type: 'owner', ownerId: id }; S.open = null; if (S.layout === 'phone') S.phone = 'detail'; A.renderAll(); A.focusRow('o:' + id, true); } } });
    S4.say(t('fModuleMade'));
  };
  S4.acts.hypa = (b) => { A.openSheet({ title: t(b.dataset.v === '3' ? 's4HypaV3' : 's4HypaV2'), opener: b, cls: 'dlg', build(body) { body.innerHTML = '<p class="txt">' + esc(t('s4HypaSim')) + '</p><div class="confirm-row"><button type="button" class="btn" data-x="close" data-autofocus="1">' + ic('x', 18) + '<span>' + esc(t('fPickClose')) + '</span></button></div>'; body.querySelector('[data-x="close"]').onclick = () => A.closeSheet(true); } }); };

  function fieldFor(oid, o, d, f, ro) {
    switch (d.ctl) {
      case 'lt': return d.key === 'supaMemoryData' ? H.ltField(oid, d, K.chatF().supa, { itemId: 'chat1.n', sk: 'supa', ro }) : H.ltField(oid, d, f[d.sk], { ro });
      case 'depth': {
        const before = '<div class="studio-depth" data-part="studio-field-label"><label for="f-depth">' + esc(t('s4DepthLabel')) + '</label><input type="number" id="f-depth" class="studio-input" min="0" step="1" inputmode="numeric" data-s4in="depth" value="' + esc(f.depth == null ? 4 : f.depth) + '"' + (ro ? ' disabled' : '') + '></div>';
        return H.ltField(oid, d, f.depthPrompt, { ro, compact: true, before });
      }
      case 'ex': return ro ? '<div class="studio-field" data-part="studio-field" data-field="exampleMessage" data-filled="true"><div class="studio-field-label" data-part="studio-field-label"><span>' + esc(H.label(d)) + '</span></div></div>'
        : '<div class="studio-field" data-part="studio-field" data-field="exampleMessage" data-filled="' + K.txt(f.examples) + '"><section class="lt-sec" id="ltEx" data-lt-list="examples" data-f="examples" data-focus="exampleMessage" tabindex="-1" aria-label="' + esc(t('ltExTitle')) + '"></section></div>';
      case 'notes': return notesHtml(oid, f, ro);
      case 'line': return H.lineField(oid, d, f[d.sk], { ro });
      case 'bias': return biasRows(oid, f, ro);
      case 'link': { const n = S4.togglesN(oid); return '<div class="studio-field studio-linkrow" data-part="studio-field" data-field="customModuleToggle" data-filled="' + (n > 0) + '"><button type="button" class="btn solid" data-s4-act="togglelink" data-focus="customModuleToggle"' + (ro ? ' disabled' : '') + '>' + ic('toggle-right', 18) + '<span>' + esc(n ? t('fToggleLink', { n }) : t('s4ToggleAdd')) + '</span>' + ic('chevron-right', 16) + '</button></div>'; }
      case 'action':
        if (d.key === 'moduleApply') return '<div class="studio-field studio-action" data-part="studio-field" data-field="moduleApply"><button type="button" class="btn solid" data-s4-act="moduleApply" data-focus="moduleApply"' + (ro ? ' disabled' : '') + '>' + ic('puzzle', 18) + '<span>' + esc(t('fModuleApply')) + '</span></button><p class="studio-field-note" data-part="studio-field-note" data-kind="info">' + esc(t('fModuleApplyNote')) + '</p></div>';
        if (d.key === 'moduleConvert') return '<div class="studio-field studio-action" data-part="studio-field" data-field="moduleConvert"><button type="button" class="btn solid" data-s4-act="moduleConvert" data-focus="moduleConvert"' + (ro ? ' disabled' : '') + '>' + ic('package', 18) + '<span>' + esc(t('fModuleConvert')) + '</span></button></div>';
        return '<div class="studio-field studio-action" data-part="studio-field" data-field="' + d.key + '"><button type="button" class="btn solid" data-s4-act="hypa" data-v="' + (d.key === 'hypaV3' ? 3 : 2) + '" data-focus="' + d.key + '"' + (ro ? ' disabled' : '') + '>' + ic('history', 18) + '<span>' + esc(t(d.key === 'hypaV3' ? 's4HypaV3' : 's4HypaV2')) + '</span></button></div>';
    }
    return '';
  }

  /* ---------------------------------------------------------------- the risky section: always last, never folded, a warning that is always visible, each flag with its own line */
  function riskyHtml(oid, o, f, ro) {
    const defs = S4.CAT.filter((d) => d.group === 'risky' && (o.type === 'group' ? d.owners === 'both' : true));
    return '<section class="studio-risky" data-part="studio-risky" data-part-critical data-group="risky" aria-labelledby="s4-risky-h"><h3 class="studio-risky-header" data-part="studio-risky-header" id="s4-risky-h">' + ic('triangle-alert', 18) + '<span>' + esc(t('fRiskyTitle')) + '</span></h3>' +
      '<p class="studio-risky-warning" data-part="studio-risky-warning" id="s4-risky-warn">' + esc(t('fRiskyWarn')) + '</p>' +
      defs.map((d) => { const on = !!f[d.sk]; return '<div class="studio-risky-flag" data-part="studio-risky-flag" data-flag="' + d.key + '" data-on="' + on + '"><label class="sw studio-risky-switch" data-part="studio-risky-switch"><input type="checkbox" role="switch" id="f-' + d.sk + '" data-s4in="risky" data-flag="' + d.key + '" data-focus="' + d.key + '"' + (on ? ' checked' : '') + (ro ? ' disabled' : '') + ' aria-describedby="s4-risky-warn s4-expl-' + d.key + '"><span class="sw-ui"></span><span class="lbl">' + esc(H.label(d)) + '</span></label><p class="studio-risky-explain" data-part="studio-risky-explain" id="s4-expl-' + d.key + '"' + (d.key === 'escapeOutput' ? ' data-mockup="true"' : '') + '>' + esc(t(d.explain)) + (d.key === 'escapeOutput' ? ' ' + mockTag() : '') + '</p></div>'; }).join('') + '</section>';
  }

  function advForm(it, o) {
    if (K.hiddenPrivate(o.id)) return S4.hiddenForm('advanced', o);
    const oid = o.id, ro = K.isPrivate(oid), st = K.advState(oid), f = it.f; let h = A.peerBannerHtml(it) + (ro ? S4.privateNote(oid) : '');
    st.groups.forEach((gx) => {
      const nonfold = gx.shown.filter((r) => !r.fold).length, coll = !gx.empty;
      const open = coll ? gx.open : nonfold > 0;
      const body = gx.shown.map((r) => fieldFor(oid, o, r.d, f, ro)).join('') + (gx.empty || ro ? '' : H.addRow(oid, gx));
      const pe = S.peers[it.id]; h += H.section(gx.g.id, { title: t(gx.g.lab), count: gx.valued ? String(gx.valued) : null, icon: gx.g.icon, open, collapsible: coll, body, peer: !!pe && gx.rows.some((r) => r.d.sk === pe.field), preBody: gx.empty && !ro ? H.addRow(oid, gx) : '' });
    });
    h += riskyHtml(oid, o, f, ro);
    return S4.wrapForm('advanced', oid, h);
  }
  S4.forms['char:advanced'] = advForm; S4.forms['group:advanced'] = advForm;
  S4.mounts['char:advanced'] = (it, o, host) => { if (LT.mountLists && $('#ltEx', host)) LT.mountLists(it, o, host); };

  /* ---------------------------------------------------------------- the question: per flag, once per turn-on; the switch is controlled by the store and stays off until the author confirms */
  const SK = {}; S4.CAT.filter((d) => d.group === 'risky').forEach((d) => { SK[d.sk] = d; });
  function riskDom(oid, key, on) { const row = document.querySelector('.studio-risky-flag[data-flag="' + key + '"]'); if (!row) return; row.dataset.on = String(on); const inp = row.querySelector('input'); if (inp) inp.checked = on; }
  function writeFlag(oid, key, on) {
    const d = BY[key]; K.W(oid, 'advanced', t(on ? 's4StepRiskyOn' : 's4StepRiskyOff', { name: H.label(d) }), (f) => { f[d.sk] = on; }); riskDom(oid, key, on); A.renderTree();
    if (on) S4.say(t('fRiskyAnnounce', { name: H.label(d) }));
  }
  S4.chg.risky = (el) => {
    const oid = S4.cur.oid, key = el.dataset.flag;
    if (el.checked) { el.checked = false; askRisk(oid, key, el); } else writeFlag(oid, key, false);
  };
  function clearAsk(oid) { if (oid) dr(oid).risk = null; S4.riskSave(null); }
  const josa = (name) => { const c = String(name).trim().slice(-1).charCodeAt(0); return c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 !== 0 ? '을' : '를'; };
  S4.askTitle = (name) => (S.lang === 'en' ? t('fRiskyAsk', { name }) : name + josa(name) + ' 켤까요?');
  const mockTag = () => '<span class="studio-field-tag" data-tag="mockup-note">' + esc(t('s4MockupNote')) + '</span>';
  function askRisk(oid, key, opener, opt) {
    opt = opt || {}; const d = BY[key], name = H.label(d); const persist = !opt.retry;
    dr(oid).risk = key; if (persist) S4.riskSave({ oid, key });
    S4.critical({ part: 'studio-risky-confirm', title: S4.askTitle(name), opener, okText: t('fRiskyOn'), cancelText: t('fRiskyCancel'),
      body: [esc(t(d.explain)) + (key === 'escapeOutput' ? ' ' + mockTag() : '')].concat(key === 'lowLevelAccess' ? [esc(t('fRiskyAskLow'))] : []),
      onCancel: () => { clearAsk(oid); S4.okFlags.clear(); },
      onOk: () => {
        clearAsk(oid);
        if (opt.retry) { S4.okFlags.add(key); opt.retry(); S4.say(t('fRiskyAnnounce', { name })); return; }
        writeFlag(oid, key, true); const sw = document.querySelector('.studio-risky-flag[data-flag="' + key + '"] input'); if (sw) sw.focus({ preventScroll: true });
      } });
  }
  S4.askRisk = askRisk; S4.okFlags = new Set();
  /* a pending question survives a reload on this device (a draft, DD-157 (b)) */
  S4.reopenRisk = () => {
    const p = S4.riskLoad(); if (!p || !A.O(p.oid)) return false; const it = K.itemOf(p.oid, 'advanced'); if (!it) return false;
    if (S.open !== it.id) A.openItem(it.id, { focus: false, user: true });
    const sw = document.querySelector('.studio-risky-flag[data-flag="' + p.key + '"] input'); askRisk(p.oid, p.key, sw || document.activeElement); return true;
  };
  ST.ext.afterReload = () => { S4.afterReloadPriv(); S4.reopenRisk(); };
  /* redo, or a history / restore-point step, that would turn a flag from off to on asks first (design default); undo of "turn on" turns it off without a question; the stored value coming from another tab does not ask */
  ST.ext.guardSnap = (oid, snap, retry) => {
    const o = A.O(oid); if (!o || (o.type !== 'char' && o.type !== 'group')) return false; let items; try { items = JSON.parse(snap); } catch (_) { return false; }
    const cur = K.itemOf(oid, 'advanced'), nx = items.find((i) => i.kind === 'advanced' && i.id !== 'chat1.n'); if (!cur || !nx) return false;
    const key = ['lowLevel', 'utilityBot', 'escapeOutput'].find((k) => !cur.f[k] && nx.f[k] && !S4.okFlags.has(SK[k].key)); if (!key) { S4.okFlags.clear(); return false; }
    askRisk(oid, SK[key].key, document.activeElement, { retry }); return true;
  };
})();
