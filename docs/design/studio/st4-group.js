/* Studio slice 4, part 5: the group form (SLICE4_SPEC section 8, DD-164). Basic: name, members (talkativeness as a named radio group, a participation switch, reorder by handle / Alt+arrows / menu, add through the member picker,
   remove with a durable undo, a missing member, the last-member rule), the speaking order, the chat's author note. Display: the group picture and the view mode. Advanced: memory text and the one risky flag (shared with the character form).
   The members are ONE record per member (id, talk, active) in this model: the app's three parallel arrays are the Lane A change in engine change #26. Synthetic. */
(function () {
  'use strict';
  const ST = window.__st1, A = ST.api, S = A.S, S4 = window.__st4;
  const { nm, ic, esc, $, $$ } = A; const t = (k, v) => A.t(k, v);
  const K = S4.core, H = S4.h, BY = S4.BYKEY, dr = K.dr;
  const members = (oid) => K.fOf(oid, 'basic').members || [];
  const charOf = (id) => { const c = A.O(id); return c && c.type === 'char' ? c : null; };
  const mname = (m) => { const c = charOf(m.id); return c ? nm(c.name) : t('fMemberMissing'); };
  const toneOf = (id) => { let h = 0; String(id).split('').forEach((ch) => { h += ch.charCodeAt(0); }); return (h % 6) + 1; };
  S4.memberCounts = (oid) => { const ms = members(oid), live = ms.filter((m) => charOf(m.id)); return { total: live.length, all: ms.length, live: live.length, speakers: live.filter((m) => m.active).length }; };
  const initial = (n) => String(n || '?').trim().charAt(0);

  function memberRow(oid, m, order) {
    const c = charOf(m.id), name = mname(m), miss = !c, on = !!m.active;
    const avatar = '<span class="studio-member-avatar" data-part="studio-member-avatar" data-tone="' + toneOf(m.id) + '" aria-hidden="true">' + esc(miss ? '?' : initial(name)) + '</span>';
    if (miss) return '<li class="studio-member-row" data-part="studio-member-row" role="listitem" data-row="' + m.id + '" data-list="members" data-member-active="false" data-member-missing="true" data-talk="' + m.talk + '">' + H.handleBtn('members', m.id, name) + avatar + '<div class="studio-row-main"><span class="studio-member-name">' + esc(name) + '</span></div><button type="button" class="btn solid" data-s4-act="memberdrop" data-id="' + m.id + '">' + ic('x', 16) + '<span>' + esc(t('fDropRow')) + '</span></button></li>';
    const radios = [1, 2, 3, 4, 5, 6].map((n) => '<button type="button" role="radio" class="studio-talk-seg" data-s4-act="talk" data-id="' + m.id + '" data-n="' + n + '" aria-checked="' + (m.talk === n) + '" aria-label="' + esc(t('s4TalkSeg', { n })) + '" tabindex="' + (m.talk === n ? 0 : -1) + '"></button>').join('');
    return '<li class="studio-member-row" data-part="studio-member-row" role="listitem" data-row="' + m.id + '" data-list="members" data-member-active="' + on + '" data-talk="' + m.talk + '">' + H.handleBtn('members', m.id, name) + avatar +
      '<div class="studio-row-main"><span class="studio-member-name">' + esc(name) + (on ? '' : '<span class="studio-field-tag" data-tag="sitting-out">' + esc(t('fMemberOff')) + '</span>') + '</span>' + (order ? '' : '<span class="studio-row-meta studio-talk-text">' + esc(t('fMemberTalk', { n: m.talk })) + '</span>') + '</div>' +
      '<div class="studio-member-talk" data-part="studio-member-talk" role="radiogroup" aria-label="' + esc(t('s4TalkName', { name })) + '" aria-describedby="s4-tv-' + m.id + '" data-talk="' + m.talk + '">' + radios + '</div><span class="sr-only" id="s4-tv-' + m.id + '">' + esc(t('s4TalkValue', { n: m.talk })) + '</span>' +
      '<button type="button" role="switch" class="btn studio-member-active" data-part="studio-member-active" data-s4-act="mute" data-id="' + m.id + '" aria-checked="' + on + '" aria-label="' + esc(t('s4MuteName', { name, state: t('fMemberOn') })) + '">' + ic(on ? 'check' : 'moon', 16) + '<span>' + esc(t('fMemberOn')) + '</span></button>'   /* n-3: a stable name ("name: joins"); the state is aria-checked, the visible "sitting out" tag sits by the name */ + H.menuBtn('members', m.id, name) + '</li>';
  }
  function membersBlock(oid, f, ro) {
    const ms = f.members || [], c = S4.memberCounts(oid), order = !!f.orderByOrder, v = dr(oid);
    return '<div class="studio-field studio-members" data-part="studio-field" data-field="g_members" data-filled="' + (ms.length > 0) + '"><div class="studio-field-label" data-part="studio-field-label"><span id="s4-lab-members">' + esc(t('fMembers')) + '</span><span class="studio-field-tag" data-tag="count">' + esc(t('s4SpeakersOf', { n: c.speakers, m: c.total })) + '</span></div>' +
      (ms.length ? '<ul class="studio-member-list" data-part="studio-member-list" role="list" aria-labelledby="s4-lab-members" id="s4-members-list">' + ms.map((m) => memberRow(oid, m, order)).join('') + '</ul>' : '<p class="studio-empty-line">' + ic('users', 16) + '<span>' + esc(t('fNoMembers')) + '</span></p>') +
      (c.live > 0 && c.speakers === 0 ? '<p class="studio-field-note" data-part="studio-field-note" data-kind="info" id="s4-nospeak" role="status">' + ic('info', 14) + '<span>' + esc(t('s4NoSpeakers')) + '</span></p>' : '') +
      '<p class="studio-field-note" data-part="studio-field-note" data-kind="error" id="s4-last" role="alert"' + (v.flash.last ? '' : ' hidden') + '>' + (v.flash.last ? ic('triangle-alert', 14) + '<span>' + esc(t('fLastMember')) + '</span>' : '') + '</p>' +
      (ro ? '' : '<button type="button" class="btn solid studio-add" data-s4-act="memberadd" data-focus="g_members">' + ic('user-plus', 16) + '<span>' + esc(t('s4MemberPicker')) + '</span></button>') + '</div>';
  }
  function orderBlock(oid, f) {
    const list = !!f.orderByOrder;
    return '<div class="studio-field" data-part="studio-field" data-field="g_order" data-filled="true"><div class="studio-field-label" data-part="studio-field-label"><span id="s4-lab-order">' + esc(t('fOrderLabel')) + '</span></div><div class="studio-order-mode" data-part="studio-order-mode" role="radiogroup" aria-labelledby="s4-lab-order" aria-describedby="s4-order-help">' +
      [['random', 'fOrderRandom'], ['list', 'fOrderList']].map(([v, k]) => '<button type="button" role="radio" class="btn studio-order-opt" data-s4-act="order" data-v="' + v + '" data-focus="' + (v === 'random' ? 'g_order' : '') + '" aria-checked="' + ((v === 'list') === list) + '" tabindex="' + (((v === 'list') === list) ? 0 : -1) + '">' + (((v === 'list') === list) ? ic('check', 14) : '') + '<span>' + esc(t(k)) + '</span></button>').join('') + '</div><p class="studio-field-note" data-part="studio-field-note" data-kind="info" id="s4-order-help">' + esc(t('fOrderHelp')) + '</p></div>';
  }
  S4.forms['group:basic'] = (it, o) => {
    const oid = o.id, f = it.f; let h = A.peerBannerHtml(it);
    h += H.lineField(oid, BY.g_name, f.name, { req: true, label: t('fl_name') });
    h += membersBlock(oid, f, false) + orderBlock(oid, f) + S4.noteBlock(oid, false);
    return S4.wrapForm('basic', oid, h);
  };

  /* ---------------------------------------------------------------- member operations (all write the one members record) */
  const wm = (oid, label, fn) => K.W(oid, 'basic', t(label), (f) => { f.members = (f.members || []).map((m) => Object.assign({}, m)); fn(f.members, f); });
  S4.acts.talk = (b) => { const oid = S4.cur.oid, id = b.dataset.id, n = +b.dataset.n; wm(oid, 's4StepTalk', (ms) => { const m = ms.find((x) => x.id === id); if (m) m.talk = n; }); K.rerender('.studio-member-row[data-row="' + id + '"] .studio-talk-seg[data-n="' + n + '"]'); };
  S4.keys.talk = (e) => {
    const b = e.target.closest && e.target.closest('.studio-talk-seg'); if (!b || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return false;
    const n = +b.dataset.n; const nn = e.key === 'Home' ? 1 : e.key === 'End' ? 6 : (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? Math.min(6, n + 1) : Math.max(1, n - 1); e.preventDefault(); if (nn !== n) S4.acts.talk({ dataset: { id: b.dataset.id, n: nn } }); return true;
  };
  S4.acts.mute = (b) => { const oid = S4.cur.oid, id = b.dataset.id; wm(oid, 's4StepMute', (ms) => { const m = ms.find((x) => x.id === id); if (m) m.active = !m.active; }); K.rerender('.studio-member-row[data-row="' + id + '"] .studio-member-active'); A.renderTree(); const m = members(oid).find((x) => x.id === id); S4.say(t('s4MuteName', { name: mname(m), state: t(m.active ? 'fMemberOn' : 'fMemberOff') })); };
  S4.acts.order = (b) => { const oid = S4.cur.oid, v = b.dataset.v === 'list'; K.W(oid, 'basic', t('s4StepOrder'), (f) => { f.orderByOrder = v; }); K.rerender('.studio-order-opt[aria-checked="true"]'); };
  S4.keys.order = (e) => { const b = e.target.closest && e.target.closest('.studio-order-opt'); if (!b || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return false; e.preventDefault(); const other = $$('.studio-order-opt', b.parentElement).find((x) => x !== b); if (other) other.click(); return true; };
  S4.acts.memberdrop = (b) => OPS.members.del(S4.cur.oid, b.dataset.id, true);
  S4.acts.memberadd = (b) => {
    const oid = S4.cur.oid, cur = members(oid).map((m) => m.id), chars = A.ownerList().filter((x) => x.type === 'char');
    A.openSheet({ title: t('s4MemberPicker'), opener: b, cls: 'dlg tall', build(body) {
      const root = document.createElement('div'); root.className = 'studio-sheet-root'; body.appendChild(root);
      root.innerHTML = '<div class="studio-member-picker" data-part="studio-image-picker"><div class="studio-mp-search"><label for="s4-mp-q" class="sr-only">' + esc(t('s4MemberSearch')) + '</label><input type="text" id="s4-mp-q" data-autofocus="1" placeholder="' + esc(t('s4MemberSearch')) + '" autocomplete="off"></div><ul class="studio-pick-list" role="list" id="s4-mp-list">' +
        chars.map((c) => { const has = cur.includes(c.id); return '<li><button type="button" class="btn item studio-mp-item" data-id="' + c.id + '"' + (has ? ' aria-disabled="true" aria-describedby="s4-mp-r-' + c.id + '"' : '') + ' data-name="' + esc(nm(c.name)) + '"><span class="studio-member-avatar" data-part="studio-member-avatar" data-tone="' + toneOf(c.id) + '" aria-hidden="true">' + esc(initial(nm(c.name))) + '</span><span class="studio-pick-name"><span class="n">' + esc(nm(c.name)) + '</span>' + (has ? '<span class="m" id="s4-mp-r-' + c.id + '">' + esc(t('fMemberAlready')) + '</span>' : '') + '</span></button></li>'; }).join('') + '</ul>' +
        (K.hasChat() ? '<label class="sw studio-mp-first"><input type="checkbox" id="s4-mp-first"><span class="sw-ui"></span><span class="lbl">' + esc(t('fMemberAddFirst')) + '</span></label>' : '') + '<div class="confirm-row"><button type="button" class="btn" data-x="close">' + ic('x', 18) + '<span>' + esc(t('fPickClose')) + '</span></button></div></div>';
      const q = root.querySelector('#s4-mp-q'); q.addEventListener('input', () => { const v = q.value.trim().toLowerCase(); $$('.studio-mp-item', root).forEach((x) => { x.closest('li').hidden = !!v && !x.dataset.name.toLowerCase().includes(v) && !ST.hm(x.dataset.name, v); }); });
      root.addEventListener('click', (e) => {
        if (e.target.closest('[data-x="close"]')) { A.closeSheet(true); return; }
        const it = e.target.closest('.studio-mp-item'); if (!it || it.getAttribute('aria-disabled') === 'true') return; const id = it.dataset.id, first = root.querySelector('#s4-mp-first') && root.querySelector('#s4-mp-first').checked;
        A.closeSheet(false); wm(oid, 's4StepMemberAdd', (ms) => { ms.push({ id, talk: 3, active: true }); }); A.renderTree(); K.rerender('.studio-member-row[data-row="' + id + '"] .studio-row-handle'); const nm0 = nm(A.O(id).name);
        S4.say(t('s4MemberAdded', { name: nm0 })); if (first) { A.toast(t('s4MemberFirstPushed', { name: nm0 }), { ms: 3500 }); S4.say(t('s4MemberFirstPushed', { name: nm0 })); }
      });
    } });
  };

  const OPS = S4.rowOps;
  OPS.members = {
    kind: 'basic', key: 'members', rowSel: '.studio-member-row', add: '[data-focus="g_members"]', nameOf: mname, moveLabel: 's4StepMemberMove', delLabel: 's4StepMemberDel', get: members, delText: 'fMemberRemove',
    menu: (oid, id) => (charOf(id) ? [['user', t('fMemberOpen'), () => ST.openDeep('character:' + id, 'basic'), '']] : []),
    del(oid, id, fromMissing) {
      const ms = members(oid), i = ms.findIndex((m) => m.id === id); if (i < 0) return;
      const live = ms.filter((m) => charOf(m.id)).length; if (charOf(ms[i].id) && live <= 1) { dr(oid).flash.last = true; K.rerender(() => $('.studio-member-row[data-row="' + id + '"] .studio-row-menu', $('#formHost')) || $('.studio-member-row[data-row="' + id + '"] .studio-row-handle', $('#formHost'))); S4.say(t('fLastMember')); return; }
      dr(oid).flash.last = false; const rem = JSON.parse(JSON.stringify(ms[i])); wm(oid, 's4StepMemberDel', (a) => { a.splice(i, 1); }); A.renderTree(); const alive = S4.undoGuard(oid);
      const left = members(oid), next = left[i] || left[i - 1]; K.rerender(() => (next ? $('.studio-member-row[data-row="' + next.id + '"] .studio-row-handle', $('#formHost')) : $('[data-focus="g_members"]', $('#formHost'))));
      const msg = t('s4Removed', { name: mname(rem) }); S4.say(msg);
      A.toast(msg, { ms: 10000, endsOnClose: true, action: { label: t('undoBtn'), fn: () => { if (!alive() || members(oid).some((m) => m.id === rem.id)) return; wm(oid, 's4StepRestoreRow', (a) => { a.splice(Math.min(i, a.length), 0, rem); }); A.renderTree(); K.rerender(() => $('.studio-member-row[data-row="' + rem.id + '"] .studio-row-handle', $('#formHost'))); } } });
    }
  };
  OPS.members.set = (oid, a, label) => K.W(oid, 'basic', t(label), (f) => { f.members = a; });

  /* ---------------------------------------------------------------- Display (group): the group picture and the view mode */
  function gpicBlock(oid, f) {
    const pic = f.pic, v = dr(oid), imp = v.importing.filter((x) => x.mode === 'group');
    return '<div class="studio-field studio-portrait-block" data-part="studio-field" data-field="g_pic" data-filled="' + !!pic + '"><div class="studio-field-label" data-part="studio-field-label"><span>' + esc(t('fGroupPic')) + '</span></div>' +
      (pic ? '<div class="studio-portrait-main" data-part="studio-portrait-main" data-shape="square">' + H.tile(pic, { cls: 'studio-thumb-xl', type: 'users', ic: 40 }) + '<div class="studio-portrait-cap"><span class="studio-portrait-name">' + esc(pic.name) + '</span></div></div>' : '<div class="studio-portrait-main" data-part="studio-portrait-main" data-shape="square" data-empty="true"><span class="studio-thumb" data-part="studio-thumb-placeholder" data-image="placeholder" aria-hidden="true">' + ic('image', 40) + '</span><span class="studio-portrait-name">' + esc(t('s4NoGroupPic')) + '</span></div>') +
      '<div class="studio-portrait-actions"><button type="button" class="btn solid" data-s4-act="gpicmake" data-focus="g_pic">' + ic('users', 16) + '<span>' + esc(t('fGroupPicMake')) + '</span></button><button type="button" class="btn solid" data-s4-act="gpicpick">' + ic('image', 16) + '<span>' + esc(t('fGroupPicPick')) + '</span></button></div><p class="studio-field-note" data-part="studio-field-note" data-kind="info">' + esc(t('s4GroupPicNote')) + '</p>' +
      (imp.length ? '<p class="studio-field-note" role="status" data-kind="info">' + (S.rm || S.lp ? '' : ic('loader', 14, 'spin')) + esc(t('s4Importing', { name: imp[0].name })) + '</p>' : '') + '</div>';
  }
  S4.setGroupPic = (oid, file) => { K.W(oid, 'display', t('s4StepGroupPic'), (f) => { f.pic = { name: file.name, tone: file.tone || 3, made: false }; }); A.renderTree(); K.rerender('[data-focus="g_pic"]'); };
  S4.acts.gpicmake = () => { const oid = S4.cur.oid, ms = members(oid).filter((m) => charOf(m.id)); K.W(oid, 'display', t('s4StepGroupPic'), (f) => { f.pic = { name: t('fGroupPic'), tone: ms.length ? toneOf(ms[0].id) : 3, made: true }; }); A.renderTree(); K.rerender('[data-focus="g_pic"]'); S4.say(t('s4GroupPicMade')); };
  S4.acts.gpicpick = (b) => { S4.openPicker({ mode: 'group', multi: false, opener: b, onAdd: (files) => S4.startImport(S4.cur.oid, 'group', files, (ok) => S4.setGroupPic(S4.cur.oid, ok[0])) }); };
  S4.forms['group:display'] = (it, o) => {
    const oid = o.id, f = it.f, mode = f.viewScreen || 'none'; let h = A.peerBannerHtml(it) + gpicBlock(oid, f);
    h += '<div class="studio-field" data-part="studio-field" data-field="g_view" data-filled="' + (mode !== 'none') + '"><div class="studio-field-label" data-part="studio-field-label"><label for="f-gview">' + esc(t('fGroupView')) + '</label></div><div class="studio-field-control" data-part="studio-field-control"><select id="f-gview" class="studio-input" data-s4in="gview" data-focus="g_view">' + [['none', 'fScreenNone'], ['single', 'fViewSingle'], ['multi', 'fViewMulti'], ['emphasis', 'fViewEmp']].map(([v, k]) => '<option value="' + v + '"' + (mode === v ? ' selected' : '') + '>' + esc(t(k)) + '</option>').join('') + '</select></div></div>';
    return S4.wrapForm('display', oid, h);
  };
  S4.chg.gview = (el) => { const oid = S4.cur.oid; K.W(oid, 'display', t('s4StepScreen'), (f) => { f.viewScreen = el.value; }); K.rerender('#f-gview'); };
})();
