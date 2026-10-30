/* Studio slice 4, part 6: demo states (?state=f-...) listed in SLICE4_SPEC section 15, and the test hook window.__st4 (the same object the form code hangs its parts on). Synthetic data only.
   The characters: Seraphina (c1, every field filled, 4 emotion images, 6 assets, 2 alternate portraits, the context chat 등불의 숲 with a note), Haru (c4, almost empty), the sealed record (c5, private licence).
   The groups: g1 (3 members, one muted, one missing), g2 (one member), g3 (empty). A state script never needs requestAnimationFrame (a hidden tab does not fire it). */
(function () {
  'use strict';
  const ST = window.__st1, A = ST.api, S = A.S, LT = window.LTX, S4 = window.__st4, DD = window.StudioData4;
  const { $, $$, ic, esc } = A; const t = (k, v) => A.t(k, v);
  const K = S4.core, STATES = ST.STATES, Q = new URLSearchParams(location.search);
  const lang = (ko, en) => (S.lang === 'en' ? en : ko);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const sync = () => { if (window.__st3 && window.__st3.sync) window.__st3.sync(); };
  async function openForm(oid, kind, opt) {
    opt = opt || {}; ST.enter({ from: 'chat', noFocus: true }); S.ctx = { char: oid, chat: opt.chat !== undefined ? !!opt.chat : (oid === 'c1' || oid.charAt(0) === 'g') };
    A.renderAll(); const it = K.itemOf(oid, kind); A.openItem(it.id, { focus: false }); await tick();
  }
  const seg = (oid, s) => { K.uiOf(oid).seg = s; K.saveUI(); A.renderMain(); };
  const scrollTo = (sel) => { const e = $(sel, $('#formHost')); const m = $('#main'); if (e && m) m.scrollTop = Math.max(0, e.getBoundingClientRect().top - m.getBoundingClientRect().top + m.scrollTop - 60); };
  const itemF = (oid, kind) => K.itemOf(oid, kind).f;
  const fileById = (id) => DD.pickerFiles(S.lang).find((f) => f.id === id);
  const waitScan = async () => { for (let i = 0; i < 40; i++) { const v = S4.dr(S4.cur.oid); if (v.scanDone) return; await new Promise((r) => setTimeout(r, 15)); } };
  const ex = {
    /* Basic */
    'f-basic': async () => { await openForm('c1', 'basic'); },
    'f-basic-alternates': async () => { await openForm('c1', 'basic'); scrollTo('#ltAlts'); },
    'f-basic-alternates-empty': async () => { itemF('c1', 'basic').alts = []; await openForm('c1', 'basic'); scrollTo('#ltAlts'); },
    'f-basic-nochat': async () => { await openForm('c1', 'basic', { chat: false }); },
    'f-basic-private': async () => { await openForm('c5', 'basic', { chat: false }); },
    'f-basic-private-shown': async () => { await openForm('c5', 'basic', { chat: false }); S4.revealed.add('c5'); A.renderTree(); A.renderMain(); },
    'f-private-ask': async () => { await openForm('c5', 'basic', { chat: false }); S4.acts.privshow($('[data-s4-act="privshow"]')); await tick(); },
    'f-adv-private': async () => { await openForm('c5', 'advanced', { chat: false }); },
    'f-adv-private-shown': async () => { await openForm('c5', 'advanced', { chat: false }); S4.revealed.add('c5'); A.renderTree(); A.renderMain(); },
    'f-basic-nameempty': async () => { await openForm('c1', 'basic'); const el = $('#f-name'); el.focus(); el.dispatchEvent(new Event('focusin', { bubbles: true })); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); el.blur(); },
    /* Advanced */
    'f-adv-filled': async () => { await openForm('c1', 'advanced'); },
    'f-adv-empty': async () => { itemF('c4', 'advanced').creator = ''; await openForm('c4', 'advanced', { chat: false }); },
    'f-adv-addfield-open': async () => { itemF('c4', 'advanced').creator = ''; await openForm('c4', 'advanced', { chat: false }); S4.acts.addopen($('[data-s4-act="addopen"][data-group="prompt"]')); },
    'f-adv-added-empty': async () => { itemF('c4', 'advanced').creator = ''; await openForm('c4', 'advanced', { chat: false }); S4.reveal('c4', 'systemPrompt', { focus: true }); },
    'f-adv-search-empty-hit': async () => { itemF('c4', 'advanced').creator = ''; await openForm('c4', 'basic', { chat: false }); ST.openSearch($('#searchBtn')); $('#searchInput').value = lang('시스템', 'system'); $('#searchInput').dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => setTimeout(r, 200)); },
    'f-adv-bias': async () => { const f = itemF('c1', 'advanced'); f.bias[1].token = f.bias[0].token; await openForm('c1', 'advanced'); scrollTo('[data-field="bias"]'); },
    'f-adv-toggle-link': async () => { await openForm('c1', 'advanced'); scrollTo('[data-field="customModuleToggle"]'); },
    'f-adv-memory': async () => { S4.settings.hypav2 = true; await openForm('c1', 'advanced'); scrollTo('[data-group="memory"]'); },
    'f-adv-actions': async () => { K.uiOf('c1').open.module = true; await openForm('c1', 'advanced'); scrollTo('[data-group="module"]'); },
    /* the protected risky section */
    'f-risky': async () => { await openForm('c1', 'advanced'); scrollTo('[data-part="studio-risky"]'); },
    'f-risky-ask-low': async () => { await openForm('c1', 'advanced'); scrollTo('[data-part="studio-risky"]'); $('#f-lowLevel').click(); await tick(); },
    'f-risky-ask-utility': async () => { await openForm('c1', 'advanced'); scrollTo('[data-part="studio-risky"]'); $('[data-flag="utilityBot"] input').click(); await tick(); },
    'f-risky-pending-reload': async () => { await openForm('c1', 'advanced'); scrollTo('[data-part="studio-risky"]'); $('#f-lowLevel').click(); await tick(); ST.reloadSim(); await new Promise((r) => setTimeout(r, 60)); },
    'f-risky-on': async () => { await openForm('c1', 'advanced'); scrollTo('[data-part="studio-risky"]'); $('#f-lowLevel').click(); await tick(); $('[data-part="studio-risky-confirm-ok"]').click(); await tick(); },
    /* Display */
    'f-disp-photo': async () => { await openForm('c1', 'display'); seg('c1', 'photo'); },
    'f-disp-photo-empty': async () => { await openForm('c4', 'display', { chat: false }); seg('c4', 'photo'); },
    'f-disp-photo-promote': async () => { await openForm('c1', 'display'); seg('c1', 'photo'); S4.delPortrait('c1', itemF('c1', 'display').main.id); await tick(); },
    'f-disp-screen-none': async () => { await openForm('c4', 'display', { chat: false }); seg('c4', 'screen'); },
    'f-disp-screen-emotion': async () => { await openForm('c1', 'display'); seg('c1', 'screen'); },
    'f-disp-screen-imggen': async () => { const f = itemF('c1', 'display'); f.viewScreen = 'imggen'; f.imgPrompt = lang('등불을 든 여인, 안개 낀 숲길', 'A woman with a lantern on a foggy forest path'); f.imgNeg = lang('흐릿함', 'blurry'); f.imgInstr = lang('장면이 바뀔 때만 그려 주세요.', 'Draw only when the scene changes.'); await openForm('c1', 'display'); seg('c1', 'screen'); },
    'f-disp-mode-filled': async () => { await openForm('c4', 'display', { chat: false }); seg('c4', 'screen'); const sel = $('#f-viewScreen'); sel.value = 'imggen'; sel.dispatchEvent(new Event('change', { bubbles: true })); await tick(); },
    'f-disp-emotion-dup': async () => { const f = itemF('c1', 'display'); f.emotions[1].name = f.emotions[0].name; await openForm('c1', 'display'); seg('c1', 'screen'); },
    'f-disp-emotion-fail': async () => { itemF('c1', 'display').emotions[2].state = 'failed'; await openForm('c1', 'display'); seg('c1', 'screen'); },
    'f-disp-assets': async () => { await openForm('c1', 'display'); seg('c1', 'assets'); await waitScan(); },
    'f-disp-assets-rename': async () => {
      await openForm('c1', 'display'); seg('c1', 'assets'); await waitScan(); const first = itemF('c1', 'display').assets[0], el = $('#s4-an-in-' + first.id); el.focus(); el.dispatchEvent(new Event('focusin', { bubbles: true }));
      el.value = first.name + lang('2', '2'); el.dispatchEvent(new Event('input', { bubbles: true })); await tick();
    },
    'f-disp-assets-beta': async () => { S4.settings.assetCommandSetting = true; S4.settings.newImageBeta = true; await openForm('c1', 'display'); seg('c1', 'assets'); await waitScan(); },
    /* the simulated picker and its results */
    'f-picker': async () => { await openForm('c1', 'display'); seg('c1', 'screen'); S4.acts.emotionadd($('[data-s4-act="emotionadd"]')); await tick(); },
    'f-picker-result': async () => { await openForm('c1', 'display'); seg('c1', 'screen'); S4.importMs = 0; S4.startImport('c1', 'emotion', ['f1', 'f2', 'f6', 'f7'].map(fileById), (ok) => S4.addEmotions('c1', ok)); await tick(); },
    'f-picker-storefail': async () => { await openForm('c1', 'display'); seg('c1', 'screen'); S4.importMs = 0; S4.startImport('c1', 'emotion', ['f7'].map(fileById), (ok) => S4.addEmotions('c1', ok)); await tick(); },
    'f-picker-importing': async () => { await openForm('c1', 'display'); seg('c1', 'screen'); S4.importMs = 600000; S4.startImport('c1', 'emotion', ['f1', 'f2'].map(fileById), (ok) => S4.addEmotions('c1', ok)); await tick(); },
    /* changed elsewhere, per field (DD-102) */
    'f-peer-field': async () => { await openForm('c1', 'advanced'); S4.peerField('c1.adv', 'systemPrompt'); },
    /* the group form */
    'f-group-basic': async () => { await openForm('g1', 'basic'); },
    'f-group-orderlist': async () => { itemF('g1', 'basic').orderByOrder = true; await openForm('g1', 'basic'); },
    'f-group-missing': async () => { await openForm('g1', 'basic'); const b = $('.studio-member-row[data-member-missing="true"] button.btn.solid'); if (b) b.focus(); },
    'f-group-lastmember': async () => { await openForm('g2', 'basic'); S4.rowOps.members.del('g2', 'c1'); await tick(); },
    'f-group-empty': async () => { await openForm('g3', 'basic'); },
    'f-group-add': async () => { await openForm('g1', 'basic'); S4.acts.memberadd($('[data-s4-act="memberadd"]')); await tick(); },
    'f-group-nochat': async () => { await openForm('g1', 'basic', { chat: false }); },
    'f-group-display': async () => { await openForm('g1', 'display'); },
    'f-group-adv': async () => { await openForm('g1', 'advanced'); }
  };
  Object.keys(ex).forEach((k) => { const f = ex[k]; STATES[k] = async () => { await f(); sync(); }; });
  S4.states = Object.keys(ex); S4.STATES = STATES;
  /* a page opened with keep=1 after a reload brings a pending risky question back (device-only draft, DD-157 (b)) */
  document.addEventListener('DOMContentLoaded', () => { if (Q.get('keep') === '1' && !Q.get('state')) setTimeout(() => S4.reopenRisk(), 0); });
  /* demo controls (the shell's collapsed drawer): the app settings that decide what the forms show today, and the import delay. All synthetic. */
  (function () {
    const d = $('#demo'); if (!d) return; const box = document.createElement('div'); box.className = 'demo-body'; box.id = 'st4-demo-box'; d.appendChild(box);
    const NAMES = [['previewSetting', '미리보기 설정', 'Asset preview setting'], ['assetCommandSetting', '에셋 프롬프트 설정', 'Asset prompt setting'], ['newImageBeta', '새 이미지 처리(베타)', 'New image handling (beta)'], ['hypav2', '하이파 V2', 'Hypa V2'], ['hypav3', '하이파 V3', 'Hypa V3']];
    const draw = () => { const ko = S.lang !== 'en'; box.innerHTML = '<label class="l">' + (ko ? '4단계 모의 설정' : 'Slice 4 mock settings') + '</label><div class="row">' + NAMES.map(([k, a, b]) => '<button type="button" class="btn" data-s4d="' + k + '" aria-pressed="' + !!S4.settings[k] + '">' + (ko ? a : b) + '</button>').join('') + '</div><div class="row"><button type="button" class="btn" data-s4d="imp" aria-pressed="' + (S4.importMs > 0) + '">' + (ko ? '가져오기 지연 (파일당 400 ms)' : 'Import delay (400 ms a file)') + '</button></div>'; };
    box.addEventListener('click', (e) => { const b = e.target.closest('[data-s4d]'); if (!b) return; const k = b.dataset.s4d; if (k === 'imp') S4.importMs = S4.importMs > 0 ? 0 : 400; else S4.settings[k] = !S4.settings[k]; draw(); A.renderMain(); });
    draw(); document.addEventListener('click', (e) => { if (e.target.closest('[data-d^="lang"]')) setTimeout(draw, 0); });
  })();
  S4.LT = LT; S4.A = A; S4.S = S;
})();
