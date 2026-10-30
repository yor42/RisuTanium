/* Studio slice 4, part 2: the character Basic form (SLICE4_SPEC section 3). Order: name, description, first message, alternate first messages (slice 3's card list, DD-167), author note (chat-scoped, DD-172).
   A character whose licence is private opens read only (design default). Synthetic. */
(function () {
  'use strict';
  const ST = window.__st1, A = ST.api, S = A.S, LT = window.LTX, S4 = window.__st4;
  const { nm, ic, esc, $ } = A; const t = (k, v) => A.t(k, v);
  const K = S4.core, H = S4.h, BY = S4.BYKEY;

  /* a private licence (DD-188): the content is hidden by default; the notice carries the way to see it (a protected question), and says what stays blocked */
  function privateNote(oid) {
    const shown = S4.revealed.has(oid);
    return '<div class="studio-private" data-part="studio-private-notice" data-shown="' + shown + '" role="group" aria-label="' + esc(t('fPrivate')) + '"><p class="studio-private-line" role="status">' + ic('lock', 14) + '<span>' + esc(t('fPrivate')) + '</span></p><p class="studio-private-sub">' + esc(t(shown ? 's4PrivateShown' : 's4PrivateHidden')) + '</p>' +
      '<button type="button" class="btn solid" data-s4-act="' + (shown ? 'privhide' : 'privshow') + '" data-focus="privateReveal">' + ic(shown ? 'eye-off' : 'eye', 16) + '<span>' + esc(t(shown ? 's4PrivateHide' : 's4PrivateShow')) + '</span></button></div>';
  }
  S4.privateNote = privateNote;
  S4.hiddenForm = (kind, o) => S4.wrapForm(kind, o.id, privateNote(o.id) + (kind === 'basic' ? H.lineField(o.id, BY.name, K.fOf(o.id, 'basic').name, { ro: true }) : ''));
  function askPrivate(oid, opener) {
    S4.critical({ part: 'studio-private-confirm', title: t('s4PrivateAskTitle'), opener, okText: t('s4PrivateShow'), cancelText: t('fRiskyCancel'), okIcon: 'eye', body: [esc(t('s4PrivateAskBody1')), esc(t('s4PrivateAskBody2'))],
      onCancel: () => {}, onOk: () => { S4.revealed.add(oid); A.renderTree(); K.rerender('[data-s4-act="privhide"]'); S4.say(t('s4PrivateRevealed')); } });
  }
  S4.acts.privshow = (b) => askPrivate(S4.cur.oid, b);
  S4.acts.privhide = () => { S4.revealed.delete(S4.cur.oid); S4.scrub(); A.renderTree(); K.rerender('[data-s4-act="privshow"]'); A.renderSide(); S4.say(t('s4PrivateHiddenAgain')); };   /* N-6: the Test panel and the sandbox forget the text at once */
  function wrapForm(kind, oid, body) { return '<div class="studio-form" data-part="studio-form" data-kind="' + kind + '" data-oid="' + oid + '">' + body + '</div>'; }
  S4.wrapForm = wrapForm;

  /* the author note: the open chat's, not the character's. Shown only with a context chat, tagged "this chat"; else one line that says where it lives */
  function noteBlock(oid, ro) {
    const d = BY.note;
    if (!K.hasChat()) return '<p class="studio-pointer" data-part="studio-field-note" data-kind="info" id="s4-note-pointer">' + ic('message-square', 14) + '<span>' + esc(t('fNoteNoChat')) + '</span></p>';
    return H.ltField(oid, d, K.chatF().note, { itemId: 'chat1.n', sk: 'note', ro, ph: t('s4NoteDefault') });
  }
  S4.noteBlock = noteBlock;

  S4.forms['char:basic'] = (it, o) => {
    if (K.hiddenPrivate(o.id)) return S4.hiddenForm('basic', o);
    const f = it.f, ro = K.isPrivate(o.id); let h = A.peerBannerHtml(it) + (ro ? privateNote(o.id) : '');
    h += H.lineField(o.id, BY.name, f.name, { ro, req: true });
    h += H.ltField(o.id, BY.desc, f.description, { ro });
    h += H.ltField(o.id, BY.firstMessage, f.first, { ro });
    h += ro ? '<div class="studio-field" data-part="studio-field" data-field="alternateGreetings" data-filled="' + (!!(f.alts && f.alts.length)) + '"><div class="studio-field-label" data-part="studio-field-label"><span>' + esc(t('fl_alternateGreetings')) + '</span></div><p class="studio-field-note" data-part="studio-field-note" data-kind="info">' + esc(t('s4AltsCount', { n: (f.alts || []).length })) + '</p></div>'
      : '<div class="studio-field" data-part="studio-field" data-field="alternateGreetings" data-filled="' + (!!(f.alts && f.alts.length)) + '"><section class="lt-sec" id="ltAlts" data-lt-list="alts" data-f="alts" data-focus="alternateGreetings" tabindex="-1" aria-label="' + esc(t('ltAltTitle')) + '"></section></div>';
    h += noteBlock(o.id, ro);
    if (K.hasChat()) h += '<div class="studio-togglerow" data-part="studio-field-note" data-kind="info"><span>' + ic('toggle-right', 14) + '<span>' + esc(t('s4ToggleBack')) + '</span></span><button type="button" class="btn solid" data-s4-act="backchat">' + ic('arrow-left', 16) + '<span>' + esc(t('s4BackToChat')) + '</span></button></div>';
    return S4.wrapForm('basic', o.id, h);
  };
  S4.acts.backchat = () => { A.backPress(); };

  /* the name: a plain input written on every change; an emptied name reverts on blur with a note (same rule as a group's name, chat slice 3 section 6) */
  S4.nameHandlers = (kind) => ({
    input(el) { const oid = S4.cur.oid; const v = el.value; const note = document.getElementById('s4-note-' + el.dataset.key); if (note && v.trim()) { note.hidden = true; note.textContent = ''; el.removeAttribute('aria-invalid'); }
      K.W(oid, 'basic', t('s4StepName'), (f) => { f.name = v; }, 'name'); A.refreshProblemsOnly && A.refreshProblemsOnly(); },
    focusin(el) { S4.core.dr(S4.cur.oid).lastName = el.value; },
    focusout(el) {
      const oid = S4.cur.oid; if (el.value.trim()) return; const keep = S4.core.dr(oid).lastName || '';
      if (!keep.trim()) return; K.W(oid, 'basic', t('s4StepName'), (f) => { f.name = keep; }); el.value = keep;
      const note = document.getElementById('s4-note-' + el.dataset.key); if (note) { note.hidden = false; note.dataset.kind = 'error'; note.innerHTML = ic('triangle-alert', 14) + '<span>' + esc(t('fNameEmpty')) + '</span>'; el.setAttribute('aria-invalid', 'true'); }
      S4.say(t('fNameEmpty')); A.renderTree();
    }
  });
  const nh = S4.nameHandlers('basic');
  S4.ins.line = (el, e) => { if (el.dataset.key === 'name' || el.dataset.key === 'g_name') nh.input(el, e); else S4.lineInput(el); };
  S4.chg['out:line'] = (el, e) => { if (el.dataset.key === 'name' || el.dataset.key === 'g_name') nh.focusout(el, e); };
  S4.chg['in:line'] = (el, e) => { if (el.dataset.key === 'name' || el.dataset.key === 'g_name') nh.focusin(el, e); };
  /* every other single-line field (creator, version, nickname): a history step per pause, keyed so typing coalesces */
  S4.lineInput = (el) => {
    const oid = S4.cur.oid, d = BY[el.dataset.key], sk = el.dataset.sk, v = el.value; if (!d) return; K.W(oid, d.kind, t('s4StepField', { f: H.label(d) }), (f) => { f[sk] = v; }, sk);
    S4.touchShown(oid, d.key); const w = el.closest('.studio-field'); if (w) w.dataset.filled = String(!!v.trim()); A.renderTree();
  };
})();
