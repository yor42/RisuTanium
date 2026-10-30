/* Studio slice 4, part 1: the form frame (SLICE4_SPEC sections 1, 2, 4.1, 10, 12). Store access by id, the field catalogue (one source for the forms, the fold rule, search and deep links), HTML helpers with the spec's part names and data-* state,
   the long-text glue (slice 3's editor mounted on every long field), the draft holder, device-only UI memory, event delegation and the hooks into slice1.js (ST.ext). Synthetic: nothing here proves native behaviour.
   Part 2 (st4-basic.js): the character Basic form. Part 3 (st4-adv.js): Advanced and the protected risky section. Part 4 (st4-disp.js): Display, the simulated picker, emotion images and assets. Part 5 (st4-group.js): the group form.
   Part 6 (st4-states.js): ?state=f-... and the test hook window.__st4. Load after lte-states.js. */
(function () {
  'use strict';
  const ST = window.__st1, A = ST.api, S = A.S, LT = window.LTX, C = window.LTCore, DD = window.StudioData4;
  const { nm, ic, esc, $, $$ } = A;
  const t = (k, v) => A.t(k, v);
  const Q = new URLSearchParams(location.search);
  const S4 = window.__st4 = { last: '', importMs: Q.get('imp') != null ? +Q.get('imp') : 400, settings: DD.SETTINGS, acts: {}, ins: {}, chg: {}, keys: {}, forms: {}, mounts: {}, h: {}, cur: null, rm: false };
  const say = (m) => { S4.last = m; A.announce(m); }; S4.say = say;

  /* ---------------------------------------------------------------- device-only memory (DD-099): which groups are open, which Display segment, the notes language */
  let UI = {}; try { UI = JSON.parse(localStorage.getItem('st4:ui') || '{}') || {}; } catch (_) { UI = {}; }
  if (Q.get('state')) { try { localStorage.removeItem('st4:ui'); } catch (_) {} UI = {}; }
  const saveUI = () => { try { localStorage.setItem('st4:ui', JSON.stringify(UI)); } catch (_) {} };
  const uiOf = (oid) => (UI[oid] = UI[oid] || { open: {} });
  S4.UI = () => UI; S4.saveUI = saveUI; S4.uiOf = uiOf;

  /* ---------------------------------------------------------------- the draft holder (DD-157): keyed by owner, apart from the store. Holds the pending risky question, the picker selection, the add-a-field lists the author opened,
     the fields kept visible this visit, a name being renamed. Removed on commit, cancel or when the author leaves the item. Only the risky question is also kept for a reload (device-only). */
  const V = S4.V = { d: {} };
  const dr = (oid) => (V.d[oid] = V.d[oid] || { shown: new Set(), addOpen: {}, help: {}, rename: {}, rejects: [], failed: [], importing: [], png: 0, uses: {}, preview: {}, scan: {}, scanDone: false, lang: null, pick: null, flash: {} });
  S4.dr = dr;
  const RISK_KEY = 'st4:risky';
  const riskSave = (p) => { try { if (p) sessionStorage.setItem(RISK_KEY, JSON.stringify(p)); else sessionStorage.removeItem(RISK_KEY); } catch (_) {} };
  const riskLoad = () => { try { return JSON.parse(sessionStorage.getItem(RISK_KEY) || 'null'); } catch (_) { return null; } };
  S4.riskSave = riskSave; S4.riskLoad = riskLoad;

  /* ---------------------------------------------------------------- store access: the forms keep an owner id and read everything from the store on each render */
  const O = (id) => A.O(id);
  const itemOf = (oid, kind) => { const o = O(oid); return o ? o.items.find((i) => i.kind === kind && i.id !== 'chat1.n') || null : null; };
  const fOf = (oid, kind) => (itemOf(oid, kind) || { f: {} }).f;
  const chatIt = () => { const o = O('chat1'); return o ? o.items.find((i) => i.id === 'chat1.n') || null : null; };
  const chatF = () => (chatIt() || { f: {} }).f;
  const hasChat = () => !!S.ctx.chat && !!chatIt();
  const isGroup = (o) => !!o && o.type === 'group';
  const isPrivate = (oid) => { const o = O(oid); return !!o && o.type === 'char' && fOf(oid, 'basic').license === 'private'; };
  S4.revealed = new Set();   /* DD-188: characters whose private content the author chose to see, in memory only */
  const hiddenPrivate = (oid) => isPrivate(oid) && !S4.revealed.has(oid);
  const txt = (v) => String(v == null ? '' : v).trim() !== '';
  const hashStr = (s) => A.hash(String(s));
  /* one write path: an owner-history step with an owner-named label (SLICE1 section 5); typing coalesces by key */
  function W(oid, kind, label, fn, key) {
    const it = kind === 'chat' ? chatIt() : itemOf(oid, kind); if (!it) return false; const ow = kind === 'chat' ? 'chat1' : oid;
    A.edit(ow, label, () => fn(it.f, it), key ? { key: it.id + '.' + key } : undefined); A.renderHeader(); return true;
  }
  S4.W = W;

  /* ---------------------------------------------------------------- the field catalogue (spec 4.2). One source: forms, fold rule, search index, deep links, tree counts */
  const G = [{ id: 'prompt', lab: 'fGroupPrompt', icon: 'sparkles' }, { id: 'conv', lab: 'fGroupConv', icon: 'messages-square' }, { id: 'info', lab: 'fGroupInfo', icon: 'contact' }, { id: 'vars', lab: 'fGroupVars', icon: 'braces' }, { id: 'gen', lab: 'fGroupGen', icon: 'sliders' }, { id: 'memory', lab: 'fGroupMemory', icon: 'history' }, { id: 'module', lab: 'fGroupModule', icon: 'puzzle' }];
  const hasText = (f, d) => txt(f[d.sk]);
  const CAT = [
    // Basic (character)
    { key: 'name', kind: 'basic', sk: 'name', ctl: 'line', req: true, syn: '이름 name 성함' },
    { key: 'desc', kind: 'basic', sk: 'description', ctl: 'lt', mode: 'cbs', chip: true, syn: '설명 소개 description about' },
    { key: 'firstMessage', kind: 'basic', sk: 'first', ctl: 'lt', mode: 'html+cbs', chip: true, syn: '첫 메시지 인사 first message greeting' },
    { key: 'alternateGreetings', kind: 'basic', sk: 'alts', ctl: 'alts', syn: '다른 첫 메시지 인사 alternate greeting first message' },
    { key: 'note', kind: 'basic', sk: 'note', ctl: 'lt', mode: 'cbs', chip: true, scope: 'chat', syn: '작가 노트 메모 author note' },
    // Advanced: prompt
    { key: 'systemPrompt', kind: 'advanced', group: 'prompt', sk: 'systemPrompt', ctl: 'lt', mode: 'cbs', chip: true, help: true, count: true, has: hasText, syn: '시스템 프롬프트 지침 system prompt' },
    { key: 'replaceGlobalNote', kind: 'advanced', group: 'prompt', sk: 'replaceGlobalNote', ctl: 'lt', mode: 'cbs', chip: true, help: true, count: true, has: hasText, syn: '전역 노트 대체 global note replace jailbreak' },
    { key: 'additionalText', kind: 'advanced', group: 'prompt', sk: 'additionalText', ctl: 'lt', mode: 'cbs', chip: true, count: true, has: hasText, syn: '추가 설명 덧붙임 additional description extra' },
    { key: 'personality', kind: 'advanced', group: 'prompt', sk: 'personality', ctl: 'lt', mode: 'cbs', chip: true, count: true, notRec: true, has: hasText, syn: '성격 personality' },
    { key: 'scenario', kind: 'advanced', group: 'prompt', sk: 'scenario', ctl: 'lt', mode: 'cbs', chip: true, count: true, notRec: true, has: hasText, syn: '시나리오 상황 scenario' },
    { key: 'depth_prompt', kind: 'advanced', group: 'prompt', sk: 'depthPrompt', ctl: 'depth', mode: 'cbs', chip: true, help: true, count: true, has: hasText, syn: '깊이 프롬프트 depth prompt' },
    // conversation
    { key: 'exampleMessage', kind: 'advanced', group: 'conv', sk: 'examples', ctl: 'ex', count: true, has: hasText, syn: '예시 대화 example message dialogue' },
    // about the work
    { key: 'creatorNotes', kind: 'advanced', group: 'info', sk: 'creatorNotes', ctl: 'notes', help: true, count: true, has: (f) => { const n = f.creatorNotes || {}; return Object.keys(n).some((k) => txt(n[k])); }, syn: '제작자 코멘트 소개 creator comment notes' },
    { key: 'creator', kind: 'advanced', group: 'info', sk: 'creator', ctl: 'line', count: true, has: hasText, syn: '제작자 만든 사람 creator author' },
    { key: 'version', kind: 'advanced', group: 'info', sk: 'version', ctl: 'line', count: true, has: hasText, syn: '버전 version' },
    { key: 'nickname', kind: 'advanced', group: 'info', sk: 'nickname', ctl: 'line', help: true, count: true, has: hasText, syn: '별명 닉네임 nickname' },
    // variables and translation
    { key: 'defaultVariables', kind: 'advanced', group: 'vars', sk: 'defvars', ctl: 'lt', mode: 'plain', mono: true, help: true, count: true, has: hasText, syn: '기본 변수 default variables var' },
    { key: 'translatorNote', kind: 'advanced', group: 'vars', sk: 'tnote', ctl: 'lt', mode: 'plain', count: true, has: hasText, syn: '번역가 메모 번역 translator note' },
    { key: 'customModuleToggle', kind: 'advanced', group: 'vars', sk: 'toggles', ctl: 'link', fold: false, syn: '토글 정의 toggle definitions' },
    // generation
    { key: 'bias', kind: 'advanced', group: 'gen', sk: 'bias', ctl: 'bias', help: true, count: true, has: (f) => Array.isArray(f.bias) && f.bias.length > 0, syn: '토큰 편향 bias logit' },
    // memory (chat-scoped, only with a chat and content)
    { key: 'supaMemoryData', kind: 'advanced', group: 'memory', sk: 'supa', ctl: 'lt', mode: 'plain', scope: 'chat', fold: false, cond: () => hasChat() && txt(chatF().supa), has: () => txt(chatF().supa), syn: '슈퍼메모리 기억 요약 supa memory summary' },
    { key: 'hypaV2', kind: 'advanced', group: 'memory', ctl: 'action', fold: false, lab: 's4HypaV2', cond: () => S4.settings.hypav2, syn: '하이파 메모리 V2 hypa memory' },
    { key: 'hypaV3', kind: 'advanced', group: 'memory', ctl: 'action', fold: false, lab: 's4HypaV3', cond: () => S4.settings.hypav3, syn: '하이파 메모리 V3 hypa memory' },
    // module
    { key: 'moduleApply', kind: 'advanced', group: 'module', ctl: 'action', fold: false, lab: 'fModuleApply', syn: '모듈 적용 apply module copy' },
    { key: 'moduleConvert', kind: 'advanced', group: 'module', ctl: 'action', fold: false, lab: 'fModuleConvert', syn: '모듈로 변환 convert to module' },
    // risky (protected: never folded, never in an add-a-field list)
    { key: 'lowLevelAccess', kind: 'advanced', group: 'risky', sk: 'lowLevel', ctl: 'risky', lab: 'fFlagLow', explain: 'fFlagLowExplain', fold: false, owners: 'both', syn: '낮은 수준 접근 low level access lua' },
    { key: 'utilityBot', kind: 'advanced', group: 'risky', sk: 'utilityBot', ctl: 'risky', lab: 'fFlagUtility', explain: 'fFlagUtilityExplain', fold: false, syn: '유틸리티 봇 utility bot' },
    { key: 'escapeOutput', kind: 'advanced', group: 'risky', sk: 'escapeOutput', ctl: 'risky', lab: 'fFlagEscape', explain: 'fFlagEscapeExplain', fold: false, syn: '출력 이스케이프 escape output' },
    // Display
    { key: 'mainPortrait', kind: 'display', seg: 'photo', sk: 'main', ctl: 'portrait', lab: 'fMainPortrait', syn: '대표 사진 초상화 main portrait icon image' },
    { key: 'altPortraits', kind: 'display', seg: 'photo', sk: 'alts', ctl: 'portrait', lab: 's4AltPhotos', syn: '다른 사진 alternate portraits' },
    { key: 'largePortrait', kind: 'display', seg: 'photo', sk: 'largePortrait', ctl: 'sw', lab: 'fTallPhoto', syn: '세로 사진 tall portrait' },
    { key: 'hideChatIcon', kind: 'display', seg: 'photo', sk: 'hideChatIcon', ctl: 'sw', lab: 'fHidePhoto', syn: '채팅에서 사진 숨기기 hide icon' },
    { key: 'viewScreen', kind: 'display', seg: 'screen', sk: 'viewScreen', ctl: 'select', lab: 'fScreenMode', syn: '화면 방식 view screen mode' },
    { key: 'emotions', kind: 'display', seg: 'screen', sk: 'emotions', ctl: 'emotions', lab: 'fScreenEmotion', syn: '감정 이미지 emotion images' },
    { key: 'inlay', kind: 'display', seg: 'screen', sk: 'inlay', ctl: 'sw', lab: 'fInlay', syn: '채팅 화면에 넣기 인레이 inlay' },
    { key: 'emotionInstr', kind: 'display', seg: 'screen', sk: 'emotionInstr', ctl: 'lt', mode: 'cbs', chip: true, lab: 'fEmotionInstr', syn: '감정 지시사항 emotion instructions' },
    { key: 'imgPrompt', kind: 'display', seg: 'screen', sk: 'imgPrompt', ctl: 'lt', mode: 'cbs', chip: true, lab: 'fImgPrompt', syn: '프롬프트 이미지 생성 image prompt' },
    { key: 'imgNeg', kind: 'display', seg: 'screen', sk: 'imgNeg', ctl: 'lt', mode: 'cbs', chip: true, lab: 'fImgNeg', syn: '부정 프롬프트 negative prompt' },
    { key: 'imgInstr', kind: 'display', seg: 'screen', sk: 'imgInstr', ctl: 'lt', mode: 'cbs', chip: true, lab: 'fImgInstr', syn: '지시사항 이미지 생성 instructions' },
    { key: 'assets', kind: 'display', seg: 'assets', sk: 'assets', ctl: 'assets', lab: 'fSegAssets', syn: '에셋 additional assets 소리 이미지' },
    // Group
    { key: 'g_name', kind: 'basic', owners: 'group', sk: 'name', ctl: 'line', req: true, lab: 'fl_name', syn: '이름 name' },
    { key: 'g_members', kind: 'basic', owners: 'group', sk: 'members', ctl: 'members', lab: 'fMembers', syn: '멤버 members 캐릭터 character' },
    { key: 'g_order', kind: 'basic', owners: 'group', sk: 'orderByOrder', ctl: 'order', lab: 'fOrderLabel', syn: '말하는 순서 order talk' },
    { key: 'g_pic', kind: 'display', owners: 'group', sk: 'pic', ctl: 'gpic', lab: 'fGroupPic', syn: '그룹 사진 group picture' },
    { key: 'g_view', kind: 'display', owners: 'group', sk: 'viewScreen', ctl: 'select', lab: 'fGroupView', syn: '화면 방식 view screen' }
  ];
  CAT.forEach((d) => { d.lab = d.lab || 'fl_' + d.key; });
  const BYKEY = {}; CAT.forEach((d) => { BYKEY[d.key] = d; });
  const advDefs = (o) => CAT.filter((d) => d.kind === 'advanced' && (isGroup(o) ? (d.owners === 'both' || d.key === 'supaMemoryData') : d.owners !== 'group'));
  S4.CAT = CAT; S4.G = G; S4.BYKEY = BYKEY;
  const label = (d) => t(d.lab);

  /* ---------------------------------------------------------------- derived values (recomputed from the store on every call; nothing is cached in a component) */
  function advState(oid) {
    const o = O(oid), f = fOf(oid, 'advanced'), v = dr(oid), ui = uiOf(oid), defs = advDefs(o);
    const groups = G.map((g) => {
      const list = defs.filter((d) => d.group === g.id && (!d.cond || d.cond()));
      const rows = list.map((d) => { const filled = d.has ? !!d.has(f, d) : false; const fold = d.fold !== false; return { d, filled, shown: !fold || filled || v.shown.has(d.key), fold }; });
      const shown = rows.filter((r) => r.shown), folded = rows.filter((r) => !r.shown);
      const dataShown = shown.filter((r) => r.fold), valued = rows.filter((r) => r.filled).length;
      const open = typeof ui.open[g.id] === 'boolean' ? ui.open[g.id] : valued > 0;
      return { g, rows, shown, folded, valued, dataShown, open, empty: dataShown.length === 0 && folded.length > 0, none: rows.length === 0 };
    }).filter((x) => !x.none);
    const counted = defs.filter((d) => d.count && (!d.cond || d.cond()));
    return { groups, filled: counted.filter((d) => d.has(f, d)).length, total: counted.length };
  }
  S4.advState = advState;
  /* the keys that are folded right now (empty and not kept visible), by group */
  const foldedKeys = (oid) => { const r = {}; advState(oid).groups.forEach((x) => { r[x.g.id] = x.folded.map((y) => y.d.key); }); return r; };
  S4.folded = foldedKeys;
  const dispCount = (oid) => { const o = O(oid), f = fOf(oid, 'display'); if (isGroup(o)) return f.pic ? 1 : 0; return (f.main ? 1 : 0) + (f.alts || []).length + (f.emotions || []).length + (f.assets || []).length; };
  S4.dispCount = dispCount;
  const tgItem = (oid) => { const o = O(oid); return o ? o.items.find((i) => i.kind === 'toggles') || null : null; };
  const togglesN = (oid) => { const it = tgItem(oid); return it ? String(it.f.defs || '').split('\n').filter((l) => /^[^=\s][^=]*=/.test(l.trim())).length : 0; };
  S4.togglesN = togglesN;

  /* ---------------------------------------------------------------- HTML helpers (part names and data-* state: spec section 12) */
  const labelOf = (d) => t(d.lab);
  const peerOf = (itemId, sk) => { const p = S.peers[itemId]; return !!p && p.field === sk; };
  const tagHtml = (d) => (d.scope === 'chat' ? '<span class="studio-field-tag" data-scope="chat">' + ic('message-square', 12) + '<span>' + esc(t('fChatScope')) + '</span></span>' : '') + (d.notRec ? '<span class="studio-field-tag" data-tag="not-recommended">' + esc(t('fNotRecommended')) + '</span>' : '');
  const peerMark = (itemId, sk) => (peerOf(itemId, sk) ? '<span class="studio-field-peer" role="img" aria-label="' + esc(t('peerMark')) + '" title="' + esc(t('peerMark')) + '">' + ic('git-compare', 14) + '</span>' : '');
  const helpBtn = (oid, d) => { if (!d.help) return ''; const open = !!dr(oid).help[d.key]; return '<button type="button" class="btn sm studio-field-help-btn" data-s4-act="help" data-key="' + d.key + '" aria-expanded="' + open + '" aria-controls="s4-help-' + d.key + '" aria-label="' + esc(t('s4Help') + ': ' + labelOf(d)) + '" title="' + esc(t('s4Help')) + '">' + ic('circle-help', 16) + '</button>'; };
  const helpBody = (oid, d) => (d.help ? '<p class="studio-field-help" data-part="studio-field-help" id="s4-help-' + d.key + '" role="group" aria-label="' + esc(labelOf(d)) + '"' + (dr(oid).help[d.key] ? '' : ' hidden') + '>' + esc(t('fh_' + d.key)) + '</p>' : '');
  const noteSlot = (key, msg, kind) => '<p class="studio-field-note" data-part="studio-field-note" id="s4-note-' + key + '"' + (kind ? ' data-kind="' + kind + '"' : '') + (msg ? '' : ' hidden') + '>' + (msg ? ic(kind === 'error' ? 'triangle-alert' : 'info', 14) + '<span>' + esc(msg) + '</span>' : '') + '</p>';
  function box(d, itemId, inner, filled, extraAttr) {
    return '<div class="studio-field" data-part="studio-field" data-field="' + d.key + '" data-filled="' + (!!filled) + '"' + (d.scope ? ' data-scope="' + d.scope + '"' : '') + (peerOf(itemId, d.sk) ? ' data-peer="changed"' : '') + (extraAttr || '') + '>' + inner + '</div>';
  }
  /* a plain (single-line) field */
  function lineField(oid, d, value, o) {
    o = o || {}; const it = itemOf(oid, d.kind), id = 'f-' + (o.id || d.sk), ro = !!o.ro;
    const lab = '<div class="studio-field-label" data-part="studio-field-label"><label for="' + id + '">' + esc(o.label || labelOf(d)) + '</label>' + tagHtml(d) + helpBtn(oid, d) + peerMark(it && it.id, d.sk) + '</div>';
    const ctl = '<div class="studio-field-control" data-part="studio-field-control"><input type="text" id="' + id + '" class="studio-input" data-s4in="' + (o.handler || 'line') + '" data-sk="' + d.sk + '" data-key="' + d.key + '" data-focus="' + d.key + '" value="' + esc(value == null ? '' : value) + '" autocomplete="off" spellcheck="false"' + (ro ? ' disabled' : '') + (o.req ? ' aria-describedby="s4-note-' + d.key + '"' : '') + '></div>';
    return box(d, it && it.id, lab + ctl + helpBody(oid, d) + noteSlot(d.key, o.note, o.noteKind), txt(value));
  }
  /* a long-text field: the textarea is mounted on slice 3's editor in afterForm (label, token chip and tools come from it; the extras row is moved into the editor's header) */
  function ltField(oid, d, value, o) {
    o = o || {}; const itemId = o.itemId || (itemOf(oid, d.kind) || {}).id, ro = !!o.ro, id = 'f4-' + (o.id || d.sk);
    const extras = tagHtml(d) + (o.tagExtra || '') + helpBtn(oid, d) + peerMark(itemId, d.sk), before = o.before || '';
    const ta = ro ? '<div class="studio-field-label" data-part="studio-field-label"><label for="' + id + '">' + esc(labelOf(d)) + '</label>' + extras + '</div><textarea id="' + id + '" class="studio-input studio-ro" readonly rows="3" data-focus="' + d.key + '">' + esc(value == null ? '' : value) + '</textarea>'
      : before + '<div class="studio-field-extras" hidden data-s4-extras>' + extras + '</div><textarea id="' + id + '" class="studio-input" data-s4lt="' + (o.mode || d.mode) + '" data-s4item="' + itemId + '" data-sk="' + (o.sk || d.sk) + '" data-key="' + d.key + '" data-focus="' + d.key + '"' + (o.set ? ' data-s4set="' + o.set + '"' : '') + (o.compact ? ' data-compact="1"' : '') + (d.mono ? ' data-mono="1"' : '') + (o.ph ? ' placeholder="' + esc(o.ph) + '"' : '') + '>' + esc(value == null ? '' : value) + '</textarea>';
    return box(d, itemId, ta + (o.below || '') + helpBody(oid, d) + noteSlot(d.key, o.note, o.noteKind), txt(value), o.attr);
  }
  /* a switch: the shell's own switch look; the store is written by the form's handler (data-s4in), never by the shell's field handler */
  function swField(oid, d, on, o) {
    o = o || {}; const id = 'f-' + (o.id || d.sk);
    return '<div class="studio-field studio-field-switch" data-part="studio-field" data-field="' + d.key + '" data-filled="' + (!!on) + '"><label class="sw"><input type="checkbox" role="switch" id="' + id + '" data-s4in="' + (o.handler || 'sw') + '" data-sk="' + d.sk + '" data-key="' + d.key + '" data-focus="' + d.key + '"' + (on ? ' checked' : '') + (o.ro ? ' disabled' : '') + '><span class="sw-ui"></span><span class="lbl">' + esc(o.label || labelOf(d)) + '</span></label>' + (o.note ? '<p class="studio-field-note" data-part="studio-field-note" data-kind="info">' + esc(o.note) + '</p>' : '') + '</div>';
  }
  /* a section (Advanced group, Display segment panel, group-form block) */
  function section(id, o) {
    const open = o.open !== false;
    return '<section class="studio-form-section" data-part="studio-form-section" data-group="' + id + '" data-open="' + open + '"' + (o.cls ? ' data-kind="' + o.cls + '"' : '') + (o.peer ? ' data-peer="changed"' : '') + '>' +
      (o.title ? '<h3 class="studio-form-section-title"><button type="button" class="studio-form-section-header" data-part="studio-form-section-header" data-s4-act="sec" data-id="' + id + '" aria-expanded="' + open + '" aria-controls="s4-sec-' + id + '"' + (o.collapsible === false ? ' disabled' : '') + '>' + (o.icon ? ic(o.icon, 18) : '') + '<span class="studio-form-section-name">' + esc(o.title) + '</span>' + (o.peer ? '<span class="studio-field-peer" role="img" aria-label="' + esc(t('peerMark')) + '" title="' + esc(t('peerMark')) + '">' + ic('git-compare', 14) + '</span>' : '') + (o.count != null ? '<span class="studio-form-section-count">' + esc(o.count) + '</span>' : '') + (o.collapsible === false ? '' : ic(open ? 'chevron-up' : 'chevron-down', 16, 'studio-chev')) + '</button></h3>' : '') +
      (o.preBody || '') + '<div class="studio-form-section-body" data-part="studio-form-section-body" id="s4-sec-' + id + '"' + (open ? '' : ' hidden') + '>' + (open ? o.body || '' : '') + '</div></section>';
  }
  /* a synthetic image stand-in: a tinted tile, never a real picture (tone 1..6 maps to a role token) */
  function tile(it, o) {
    o = o || {}; const state = o.state || it.state || 'ok';
    const inner = state === 'failed' ? ic('image-off', o.ic || 22) : state === 'loading' ? '<span class="studio-thumb-txt">' + esc(t('fImporting')) + '</span>' : (o.type ? ic(o.type, o.ic || 22) : '<span class="studio-thumb-num">' + esc(String(it.tone || 1)) + '</span>');
    return '<span class="studio-thumb' + (o.cls ? ' ' + o.cls : '') + '" data-part="' + (o.part || 'studio-thumb') + '" data-image="' + state + '" data-tone="' + (it.tone || 1) + '"' + (o.shape ? ' data-shape="' + o.shape + '"' : '') + ' aria-hidden="true">' + inner + '</span>';
  }
  const menuBtn = (kind, id, name) => '<button type="button" class="btn sm studio-row-menu" data-part="studio-row-menu" data-s4-act="rowmenu" data-list="' + kind + '" data-id="' + id + '" aria-haspopup="menu" aria-label="' + esc(t('s4MenuOf', { name })) + '" title="' + esc(t('s4Menu')) + '">' + ic('ellipsis', 18) + '</button>';
  const handleBtn = (kind, id, name) => '<button type="button" class="btn sm studio-row-handle" data-part="studio-row-handle" data-list="' + kind + '" data-id="' + id + '" aria-label="' + esc(t('s4Handle') + ': ' + name) + '" title="' + esc(t('s4Handle')) + '" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown">' + ic('grip-vertical', 18) + '</button>';
  const sizeTxt = (e) => (e.ext === 'mp3' || e.ext === 'mp4' || e.ext === 'ttf' || e.ext === 'webm' ? '' : '') + t('s4FakeKb', { n: e.size });
  S4.h = { box, lineField, ltField, swField, section, tile, menuBtn, handleBtn, noteSlot, helpBtn, helpBody, tagHtml, peerMark, sizeTxt, label: labelOf };

  /* ---------------------------------------------------------------- long-text glue: slice 3's editor on every long field. Writes are owner-history steps with a field-named label; typing coalesces */
  const touchShown = (oid, key) => { const d = BYKEY[key]; if (d && d.kind === 'advanced' && d.fold !== false) dr(oid).shown.add(key); };
  S4.touchShown = touchShown;
  function mkSet(itemId, sk, key, def) {
    return (val, o) => {
      o = o || {}; const f = A.findItem(itemId); if (!f) return; const { it, o: ow } = f;
      const base = def && def.sub ? ((it.f[sk] || {})[def.sub]) : it.f[sk]; const old = String(base == null ? '' : base); val = C.mergeEdit(old, val); if (old === val) return;
      const d = BYKEY[key]; if (ow.type !== 'chat') touchShown(ow.id, key);
      const lab = d ? labelOf(d) : sk;
      A.edit(ow.id, o.label || t('s4StepField', { f: lab }), () => { if (def && def.sub) { it.f[sk] = Object.assign({}, it.f[sk] || {}, { [def.sub]: val }); } else it.f[sk] = val; if (it.f.isDefault && it.f.isDefault[sk]) { it.f.isDefault = Object.assign({}, it.f.isDefault, { [sk]: false }); }   /* edited: no longer the default wording, but the reset stays */ }, o.label ? undefined : { key: it.id + '.' + sk + (def && def.sub ? '.' + def.sub : '') });
      A.renderHeader(); LT.shellRefresh(o.defer);
      const wrap = document.querySelector('.studio-field[data-field="' + key + '"]'); if (wrap) wrap.dataset.filled = String(txt(val));
      if (S4.onTextWrite) S4.onTextWrite(it, sk, val);
    };
  }
  S4.mkSet = mkSet;
  function mountLT(host, it) {
    $$('textarea[data-s4lt]', host).forEach((ta) => {
      const key = ta.dataset.key, d = BYKEY[key], itemId = ta.dataset.s4item, sk = ta.dataset.sk, mode = ta.dataset.s4lt, setId = ta.dataset.s4set || '';
      const def = setId.indexOf('sub:') === 0 ? { sub: setId.slice(4) } : null;
      const lkey = itemId + ':' + sk + (def ? '.' + def.sub : '');
      if (ta.dataset.compact) LT.caps[lkey] = 1;
      const F = LT.mountField(ta, { mode, itemId, field: sk, key: lkey, label: d ? labelOf(d) : sk, noGrip: !!ta.dataset.compact, set: mkSet(itemId, sk, key, def), value: undefined });
      if (ta.dataset.mono) ta.classList.add('mono');
      const wrap = F.wrap, fld = wrap.closest('.studio-field');
      wrap.setAttribute('data-part', 'studio-field-control');
      if (F.head) { const lab = F.head.querySelector('.lt-lab'); if (lab) { lab.setAttribute('data-part', 'studio-field-label'); lab.id = 's4-lab-' + key; } }
      if (F.chipHost) F.chipHost.setAttribute('data-part', 'studio-field-chip');
      const ex = fld && fld.querySelector('[data-s4-extras]');
      if (ex && F.head) { const sp = F.head.querySelector('.lt-sp'); while (ex.firstChild) F.head.insertBefore(ex.firstChild, sp); ex.remove(); }
    });
  }

  /* ---------------------------------------------------------------- re-render helper: structural edits redraw the form (cheap), keep the scroll and put the focus where the author expects */
  function rerender(focus) {
    if (S4.quiet) return;   /* a result that arrives while the author is elsewhere writes its step and the tree only (re-review N-3) */
    LT.flushAll(); const m = $('#main'), top = m ? m.scrollTop : 0; A.renderMain(); if (m) m.scrollTop = top;
    if (focus) { const el = typeof focus === 'function' ? focus() : $(focus, $('#formHost')); if (el) el.focus({ preventScroll: false }); }
  }
  S4.rerender = rerender;
  const hostEl = () => $('#formHost');

  /* ---------------------------------------------------------------- form dispatch (slice1.js asks ext.renderForm first; this wraps slice 2/3's handlers) */
  const prevRender = ST.ext.renderForm, prevAfter = ST.ext.afterForm, prevFocus = ST.ext.focusFirst, prevBefore = ST.ext.beforeOpen;
  const formKey = (o, it) => (isGroup(o) ? 'group:' : o.type === 'char' ? 'char:' : 'other:') + it.kind;
  ST.ext.renderForm = (it, o, host) => {
    if (o.type === 'char' && hiddenPrivate(o.id)) { host.classList.remove('tgb-host'); host.classList.add('studio-host'); S4.cur = { oid: o.id, itemId: it.id, kind: it.kind }; host.innerHTML = S4.hiddenForm(it.kind, o); return true; }   /* DD-194: every item kind of a hidden private character opens the notice */
    const fn = S4.forms[formKey(o, it)];
    if (!fn) { host.classList.remove('studio-host'); return prevRender ? prevRender(it, o, host) : false; }
    host.classList.remove('tgb-host'); host.classList.add('studio-host'); S4.cur = { oid: o.id, itemId: it.id, kind: it.kind };
    host.innerHTML = fn(it, o); return true;
  };
  ST.ext.afterForm = (it, o, host) => {
    if (prevAfter) prevAfter(it, o, host);
    if (!host.classList.contains('studio-host')) return;
    mountLT(host, it); const m = S4.mounts[formKey(o, it)]; if (m) m(it, o, host);
    const pend = S4.afterMountOnce; if (pend) { S4.afterMountOnce = null; pend(); }
    const ac = document.activeElement, lf = S4.lastFocus; if ((!ac || ac === document.body || ac.id === 'main') && lf && lf.sel && lf.itemId === it.id) { const el = $(lf.sel, host); if (el) el.focus({ preventScroll: true }); }   /* a history step redraws the form: keep the author's place */
  };
  ST.ext.focusFirst = (it) => {
    const o = A.findItem(it.id) && A.findItem(it.id).o; if (o && S4.forms[formKey(o, it)]) {
      const host = hostEl(); const el = $('.studio-form [role="tab"][aria-selected="true"]', host) || $('.studio-form [data-focus]:not([disabled]), .studio-form button:not([disabled])', host);   /* m-7: a Display form starts on its selected tab */ if (el) { el.focus({ preventScroll: false }); return true; }
    }
    return prevFocus ? prevFocus(it) : false;
  };
  /* leaving the item ends the visit: the empty fields kept visible fold again (DD-174), drafts of this visit go (DD-157) */
  ST.ext.ownerHidden = (oid) => hiddenPrivate(oid); ST.ext.ownerLocked = (oid) => isPrivate(oid);   /* DD-194: the shell's guard asks here */
  /* what the Test panel and the sandbox hold must go when a private card hides: the field target, the last result and its node (re-review N-6) */
  const scrub = () => { S.tf = null; S.tr = null; if (LT && LT.sb) { LT.sb.target = null; LT.sb.out = null; } const so = document.getElementById('sbOut'); if (so) { so.textContent = ''; so.removeAttribute('data-stale'); } const st = document.getElementById('sbStale'); if (st) { st.hidden = true; st.textContent = ''; } };
  S4.scrub = scrub;
  /* a revealed item of a kind this slice does not draw (lorebook, regex, scripts, toggles, background HTML): the shell's own form, locked read only, with the notice on top (DD-194) */
  let lockObs = null;
  ST.ext.lockHost = (host, card, it, o) => {
    if (S4.forms[formKey(o, it)]) return;
    host.classList.add('studio-host'); S4.cur = { oid: o.id, itemId: it.id, kind: it.kind };
    if (!host.querySelector('[data-part="studio-private-notice"]')) host.insertAdjacentHTML('afterbegin', S4.privateNote(o.id));
    const roots = [host, card].filter(Boolean);
    const lock = () => roots.forEach((r) => { r.querySelectorAll('input,select,textarea,button,[contenteditable]').forEach((el) => {
      if (el.closest('[data-part="studio-private-notice"]')) return;
      if (el.hasAttribute('contenteditable')) { el.setAttribute('contenteditable', 'false'); return; }
      if (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && /^(text|search|number|url|)$/.test(el.type))) { if (!el.readOnly) el.readOnly = true; } else if (!el.disabled) el.disabled = true;
    }); });
    lock(); if (lockObs) lockObs.disconnect(); lockObs = new MutationObserver(lock); roots.forEach((r) => lockObs.observe(r, { childList: true, subtree: true }));
  };
  ST.ext.onMain = (view, openId) => {
    const cur = S4.visit; const now = view && view.type === 'item' ? openId : null;
    if (lockObs) { lockObs.disconnect(); lockObs = null; }
    { const ow = now && A.findItem(now); if (ow && hiddenPrivate(ow.o.id)) scrub(); }   /* DD-188: the Test panel does not render hidden text either */
    if (cur && cur !== now) endVisit(cur);
    if (cur && cur !== now && S4.undoScope) { S4.undoScope = null; setTimeout(() => A.renderHeader(), 0); }
    S4.visit = now;
  };
  function endVisit(itemId) {
    const f = A.findItem(itemId); if (!f) return; const oid = f.o.id, v = dr(oid);
    if (f.it.kind === 'advanced' && v.shown.size) {
      const st = advState(oid); const msg = []; v.shown.clear();
      const after = advState(oid); after.groups.forEach((g, i) => { const was = st.groups[i]; if (was && g.folded.length > was.folded.length) msg.push(t('s4FoldAnn', { g: t(g.g.lab), n: g.folded.length - was.folded.length })); });
      if (msg.length) say(msg.join(' · '));
    } else v.shown.clear();
    v.addOpen = {}; v.rename = {}; if (v.keepOnce) v.keepOnce = false; else { v.rejects = []; v.failed = []; } v.png = 0; v.uses = {}; v.preview = {}; v.flash = {}; v.pick = null;   /* an import in flight is not touched: it finishes and reports (DD-191) */
  }
  S4.endVisit = endVisit;

  /* ---------------------------------------------------------------- reveal a field by its catalogue key: used by deep links (field=), search hits and "add a field" (SLICE4 section 4.1) */
  function reveal(oid, key, opt) {
    opt = opt || {}; const d = BYKEY[key]; const o = O(oid); if (!d || !o) return false;
    if (d.kind === 'advanced' && d.group !== 'risky') { if (d.fold !== false) dr(oid).shown.add(key); uiOf(oid).open[d.group] = true; saveUI(); }
    if (d.kind === 'advanced' && d.group === 'risky') { uiOf(oid).open.risky = true; }
    if (d.kind === 'display' && d.seg) { uiOf(oid).seg = d.seg; saveUI(); }
    const it = itemOf(oid, d.kind); if (!it) return false;
    if (S.open !== it.id) A.openItem(it.id, { focus: false, user: true }); else A.renderMain();
    if (opt.focus !== false) focusKey(key);
    return true;
  }
  function focusKey(key) {
    const host = hostEl(); const el = $('[data-focus="' + key + '"]', host) || (key === 'alternateGreetings' ? $('#ltAlts', host) : key === 'exampleMessage' ? $('#ltEx', host) : null); if (!el) return false;
    el.scrollIntoView({ block: 'center' }); el.focus({ preventScroll: true }); return true;
  }
  S4.reveal = reveal; S4.focusKey = focusKey;
  /* a change that arrived from elsewhere (DD-102), kept per field: the banner is the item's, the marker and the announcement are the field's. The shell's own peerChange picks one field by itself; this one is told which. */
  S4.peerField = (itemId, key, theirs) => {
    const f = A.findItem(itemId); if (!f) return false; const d = BYKEY[key]; if (!d) return false; const { it, o } = f;
    S.peers[it.id] = { itemId: it.id, oid: o.id, field: d.sk, theirs: theirs == null ? String(it.f[d.sk] || '') + (S.lang === 'ko' ? ' (다른 곳에서 고침)' : ' (edited elsewhere)') : theirs };
    (S.peerLog[o.id] = S.peerLog[o.id] || new Map()).set(it.id, d.sk); A.renderTree(); A.renderStatus(); if (S.open === it.id) A.renderMain(); say(t('s4PeerField', { f: labelOf(d) })); return true;
  };

  /* ---------------------------------------------------------------- event delegation: one listener set on the form host */
  const host0 = hostEl();
  host0.addEventListener('click', (e) => {
    if (!host0.classList.contains('studio-host')) return;
    const b = e.target.closest('[data-s4-act]'); if (!b || !host0.contains(b)) return; const fn = S4.acts[b.dataset.s4Act]; if (fn) fn(b, e);
  });
  host0.addEventListener('input', (e) => { if (!host0.classList.contains('studio-host')) return; const el = e.target.closest('[data-s4in]'); if (!el) return; const fn = S4.ins[el.dataset.s4in]; if (fn) fn(el, e); });
  host0.addEventListener('change', (e) => { if (!host0.classList.contains('studio-host')) return; const el = e.target.closest('[data-s4in]'); if (!el) return; const fn = S4.chg[el.dataset.s4in]; if (fn) fn(el, e); });
  host0.addEventListener('focusout', (e) => { if (!host0.classList.contains('studio-host')) return; const el = e.target.closest('[data-s4in]'); if (!el) return; const fn = S4.chg['out:' + el.dataset.s4in]; if (fn) fn(el, e); });
  host0.addEventListener('focusin', (e) => { if (!host0.classList.contains('studio-host')) return; const el = e.target.closest('[data-s4in]'); if (!el) return; const fn = S4.chg['in:' + el.dataset.s4in]; if (fn) fn(el, e); });
  S4.undoScope = null;
  const focusSel = (el) => (el.id ? '#' + el.id : el.closest('[data-row]') ? '[data-row="' + el.closest('[data-row]').dataset.row + '"] .' + (String(el.className).split(' ').find((c) => /^studio-row-/.test(c)) || 'btn') : null);
  host0.addEventListener('focusin', (e) => {
    if (!host0.classList.contains('studio-host')) return; const w = e.target.closest('.studio-field'), sc = w && w.dataset.scope === 'chat' ? 'chat' : null; const was = S4.undoScope; S4.undoScope = sc;
    S4.lastFocus = { itemId: S4.cur && S4.cur.itemId, sel: focusSel(e.target) }; if (was !== sc) setTimeout(() => A.renderHeader(), 0);
  });
  ST.ext.undoOwner = () => (S4.undoScope === 'chat' && chatIt() && S4.visit ? { id: 'chat1', name: t('fChatScope') } : null);
  ST.ext.onLeave = () => {   /* Studio closes: revealed text goes from the memory set, the hidden DOM and the side panel (re-review m-5) */
    const had = S4.revealed.size > 0; S4.revealed.clear(); S4.undoScope = null;
    if (had) { scrub(); const h = hostEl(); if (h) h.innerHTML = ''; const ed = $('#editor-panel'); if (ed) ed.hidden = true; try { LT.flushAll(); } catch (_) {} }
  };
  /* a reload simulation forgets the reveal like a real reload would (the set is memory only), then draws the hidden form (re-review m-4) */
  S4.afterReloadPriv = () => { if (!S4.revealed.size) return; S4.revealed.clear(); scrub(); A.renderTree(); A.renderMain(); A.renderSide(); };
  host0.addEventListener('keydown', (e) => { if (!host0.classList.contains('studio-host')) return; for (const k of Object.keys(S4.keys)) { if (S4.keys[k](e)) return; } });

  S4.acts.sec = (b) => {
    const oid = S4.cur.oid, id = b.dataset.id, ui = uiOf(oid), was = b.getAttribute('aria-expanded') === 'true'; ui.open[id] = !was; saveUI();
    rerender('.studio-form-section-header[data-id="' + id + '"]'); say(t(was ? 's4SecClose' : 's4SecOpen') + ': ' + b.textContent.trim());
  };
  S4.acts.help = (b) => {
    const oid = S4.cur.oid, key = b.dataset.key, v = dr(oid), open = !v.help[key]; v.help[key] = open; b.setAttribute('aria-expanded', String(open));
    const p = document.getElementById('s4-help-' + key); if (p) p.hidden = !open;
  };
  /* "add a field": the folded row, its list, choosing one (DD-163, DD-174) */
  S4.acts.addopen = (b) => {
    const oid = S4.cur.oid, g = b.dataset.group, v = dr(oid), open = !v.addOpen[g]; v.addOpen[g] = open;
    const list = document.getElementById('s4-add-' + g); if (list) list.hidden = !open; b.setAttribute('aria-expanded', String(open)); b.closest('.studio-addfield').dataset.open = String(open);
    if (open && list) { const first = list.querySelector('button'); if (first) first.focus(); }
  };
  S4.acts.addpick = (b) => {
    const oid = S4.cur.oid, key = b.dataset.key, d = BYKEY[key]; const v = dr(oid); v.shown.add(key); v.addOpen[d.group] = false; uiOf(oid).open[d.group] = true; saveUI();
    rerender(); focusKey(key); say(t('s4FieldAdded', { f: labelOf(d) }));
  };
  S4.keys.addEsc = (e) => {
    if (e.key !== 'Escape') return false; const row = e.target.closest('.studio-addfield'); if (!row || row.dataset.open !== 'true') return false;
    e.preventDefault(); e.stopPropagation(); const g = row.dataset.group, v = dr(S4.cur.oid); v.addOpen[g] = false;
    const btn = row.querySelector('.studio-addfield-btn'); row.dataset.open = 'false'; row.querySelector('.studio-addfield-list').hidden = true; btn.setAttribute('aria-expanded', 'false'); btn.focus(); return true;
  };
  /* the folded row + list HTML for a group */
  function addRow(oid, gx) {
    if (!gx.folded.length) return ''; const v = dr(oid), open = !!v.addOpen[gx.g.id], n = gx.folded.length;
    const label = gx.empty ? t('fGroupEmpty', { n }) : t('fAddField', { n });
    return '<div class="studio-addfield" data-part="studio-addfield" data-group="' + gx.g.id + '" data-open="' + open + '"><button type="button" class="btn studio-addfield-btn" data-s4-act="addopen" data-group="' + gx.g.id + '" aria-expanded="' + open + '" aria-controls="s4-add-' + gx.g.id + '">' + ic('list-plus', 18) + '<span>' + esc(label) + '</span></button>' +
      '<ul class="studio-addfield-list" data-part="studio-addfield-list" id="s4-add-' + gx.g.id + '" aria-label="' + esc(t('s4AddFieldList')) + '"' + (open ? '' : ' hidden') + '>' + gx.folded.map((r) => '<li><button type="button" class="studio-addfield-item" data-part="studio-addfield-item" data-folded="true" data-s4-act="addpick" data-key="' + r.d.key + '"><span class="n">' + esc(labelOf(r.d)) + '</span>' + (r.d.notRec ? '<span class="studio-field-tag" data-tag="not-recommended">' + esc(t('fNotRecommended')) + '</span>' : '') + '<span class="d">' + esc(t('fd_' + r.d.key)) + '</span></button></li>').join('') + '</ul></div>';
  }
  S4.h.addRow = addRow;

  /* ---------------------------------------------------------------- hooks that need no change in slice1.js beyond the ones listed in builder-checks-s4.md */
  ST.ext.kindCount = (o, k, its) => {
    if (o.type !== 'char' && o.type !== 'group') return its.length;
    if (k === 'basic' || hiddenPrivate(o.id)) return ''; if (k === 'display') return String(dispCount(o.id));
    if (k === 'advanced') { if (isGroup(o)) return ''; const a = advState(o.id); return a.filled + '/' + a.total; }
    return its.length;
  };
  /* problems of the long-text fields that are not on the basics (slice 3's hook only knows the basic item): the same CBS checks, with the field's label */
  const prevProblems = ST.ext.problems;
  ST.ext.problems = (it) => {
    let out = prevProblems ? prevProblems(it) : [];
    { const ow = A.findItem(it.id); if (ow && hiddenPrivate(ow.o.id)) return out.filter((p) => p.field === 'name'); }   /* DD-188: a hidden card leaks nothing through the Problems list */
    if (it.kind !== 'advanced' && it.kind !== 'display') return out; if (!LT || !LT.probsFor) return out;
    CAT.filter((d) => d.kind === it.kind && d.ctl === 'lt' && d.mode !== 'plain' && d.sk && it.f[d.sk]).forEach((d) => {
      const text = String(it.f[d.sk] || ''); if (!text) return; (LT.probsFor(text, d.mode).probs || []).slice(0, 30).forEach((p) => out.push({ sev: p.sev, field: d.sk, pos: p.pos, msg: labelOf(d) + ' · ' + t('ltLineN', { n: p.line }) + ' · ' + LT.probMsg(p) }));
    });
    if (it.kind === 'advanced' && it.f.examples) (LT.probsFor(it.f.examples, 'ex').probs || []).forEach((p) => out.push({ sev: p.sev, field: 'examples', pos: p.pos, msg: t('ltExTitle') + ' · ' + t('ltLineN', { n: p.line }) + ' · ' + LT.probMsg(p) }));
    return out;
  };

  /* ---------------------------------------------------------------- search: one entry per catalogue field (DD-163), so an empty field is found by its name and synonyms */
  const textOfAlts = (f) => (f.alts || []).join('\n');
  ST.ext.searchFields = (it, o) => {
    if (!o || (o.type !== 'char' && o.type !== 'group')) return null;
    if (!['basic', 'advanced', 'display'].includes(it.kind)) return null;   /* lorebook, regex, scripts, toggles, background HTML: the shell's own fields (re-review N-7); a hidden card is skipped by the shell itself (DD-194) */
    const f = it.f || {}, out = [];
    // text: what a content hit shows; empty: the catalogue's own "has a value" answer; tag: a state word for a field whose value is not text
    const add = (d, text, o2) => { o2 = o2 || {}; const empty = o2.empty != null ? o2.empty : (d.has ? !d.has(f, d) : !txt(text)); out.push({ k: d.key, label: labelOf(d), text: text || '', syn: d.syn + ' ' + labelOf(d) + (empty ? ' ' + t('s4SearchEmpty') : ''), empty, tag: empty ? '' : (o2.tag || '') }); };
    const onoff = (v) => (v ? t('s4On') : t('s4Off')), cnt = (n) => t('s4CountN', { n });
    if (hiddenPrivate(o.id)) { if (it.kind === 'basic') out.push({ k: 'name', label: labelOf(BYKEY.name), text: f.name || '', syn: BYKEY.name.syn, empty: false, tag: '' }); return out; }   // DD-188: content search never reaches hidden text
    if (isGroup(o)) {
      if (it.kind === 'basic') { add(BYKEY.g_name, f.name); add(BYKEY.g_members, (f.members || []).map((m) => { const c = O(m.id); return c ? nm(c.name) : ''; }).join(' '), { empty: !(f.members || []).length, tag: cnt((f.members || []).length) }); add(BYKEY.g_order, '', { empty: false, tag: t(f.orderByOrder ? 'fOrderList' : 'fOrderRandom') }); }
      else if (it.kind === 'advanced') { add(BYKEY.lowLevelAccess, '', { empty: false, tag: onoff(f.lowLevel) }); }
      return out;
    }
    if (it.kind === 'basic') { add(BYKEY.name, f.name); add(BYKEY.desc, f.description); add(BYKEY.firstMessage, f.first); add(BYKEY.alternateGreetings, textOfAlts(f), { empty: !(f.alts || []).length, tag: cnt((f.alts || []).length) }); }
    else if (it.kind === 'advanced') {
      CAT.filter((d) => d.kind === 'advanced' && d.group !== 'risky' && d.group !== 'memory' && d.group !== 'module' && d.owners !== 'group' && d.ctl !== 'link').forEach((d) => {
        let text = ''; if (d.ctl === 'notes') text = Object.keys(f.creatorNotes || {}).map((k) => f.creatorNotes[k]).join('\n'); else if (d.ctl === 'bias') text = (f.bias || []).map((b) => b.token).join(' '); else if (d.ctl === 'depth') text = f.depthPrompt; else text = f[d.sk];
        add(d, text);
      });
      ['lowLevelAccess', 'utilityBot', 'escapeOutput'].forEach((k) => add(BYKEY[k], '', { empty: false, tag: onoff(f[BYKEY[k].sk]) }));
    } else if (it.kind === 'display') {
      add(BYKEY.mainPortrait, '', { empty: !f.main }); add(BYKEY.largePortrait, '', { empty: false, tag: onoff(f.largePortrait) }); add(BYKEY.hideChatIcon, '', { empty: false, tag: onoff(f.hideChatIcon) });
      add(BYKEY.viewScreen, '', { empty: false, tag: t(f.viewScreen === 'emotion' ? 'fScreenEmotion' : f.viewScreen === 'imggen' ? 'fScreenImgGen' : 'fScreenNone') }); add(BYKEY.inlay, '', { empty: false, tag: onoff(f.inlay) });
      add(BYKEY.assets, '', { empty: !(f.assets || []).length, tag: cnt((f.assets || []).length) }); add(BYKEY.emotions, '', { empty: !(f.emotions || []).length, tag: cnt((f.emotions || []).length) });
      ['emotionInstr', 'imgPrompt', 'imgNeg', 'imgInstr'].forEach((k) => add(BYKEY[k], f[BYKEY[k].sk]));
    }
    return out;
  };
  ST.ext.openHit = (h) => {
    if (!h || !h.o || (h.o.type !== 'char' && h.o.type !== 'group')) return false; const d = BYKEY[h.field && h.field.k]; if (!d) return false;
    const it = h.it; S4.afterMountOnce = null; reveal(h.o.id, d.key, { focus: true });
    if (h.range && h.range[1] > h.range[0]) { const F = LT.fields.get(it.id + ':' + d.sk); if (F && F.ta.isConnected) { F.ta.focus(); try { F.ta.setSelectionRange(h.range[0], h.range[1]); } catch (_) {} } }
    return true;
  };
  /* deep links: ?owner=character:c1&kind=advanced&field=systemPrompt (spec 1) */
  ST.ext.deepItem = (o, kind) => { if ((o.type !== 'char' && o.type !== 'group') || !['basic', 'display', 'advanced'].includes(kind)) return null; const it = itemOf(o.id, kind); return it ? it.id : null; };
  ST.ext.afterDeep = (it, field) => {
    if (!field) return; const f = A.findItem(it.id); if (!f) return; const oid = f.o.id; let key = field; if (field === 'lowLevel') key = 'lowLevelAccess';
    if (hiddenPrivate(oid)) { A.showNotice(t('s4PrivateGone')); if (ST.deep) ST.deep.status = 'field-missing'; return; }
    const d = BYKEY[key]; if (d && d.kind === it.kind && forKindOwner(d, f.o) && d.cond && !d.cond()) { A.showNotice(t('s4FieldCond', { f: labelOf(d), why: t(d.key === 'supaMemoryData' ? 's4CondChat' : 's4CondSetting') })); if (ST.deep) ST.deep.status = 'field-missing'; return; }
    if (!d || d.kind !== it.kind || !forKindOwner(d, f.o)) { A.showNotice(t('fFieldGone', { kind: A.kindName(it.kind) })); if (ST.deep) ST.deep.status = 'field-missing'; return; }
    reveal(oid, key, { focus: true }); if (ST.deep) ST.deep.field = key;
  };
  const forKindOwner = (d, o) => (isGroup(o) ? (d.owners === 'group' || d.owners === 'both' || d.key === 'supaMemoryData') : d.owners !== 'group');
  S4.forKindOwner = forKindOwner;

  /* the shell calls these after a reload simulation and before undo/redo/revert applies a snapshot; st4-adv.js fills them in */
  /* a protected question sheet (DD-149): alertdialog, data-part-critical, own child parts, Cancel focused, Esc / outside / Back mean Cancel */
  S4.critical = (o) => {
    let bd = null; const sheet = () => $('#sheet');
    const cleanup = () => { const sh = sheet(); if (sh) { ['data-part', 'data-part-critical', 'aria-describedby'].forEach((a) => sh.removeAttribute(a)); } const tt = $('#sheetTitle'); if (tt) tt.removeAttribute('data-part'); if (bd) { $('#sheetBackdrop').removeEventListener('click', bd); bd = null; } };
    const cancel = () => { cleanup(); if (o.onCancel) o.onCancel(); };
    A.openSheet({ title: o.title, opener: o.opener, cls: 'dlg', build(body) {
      const root = document.createElement('div'); root.className = 'studio-sheet-root'; body.appendChild(root);
      root.innerHTML = '<div class="studio-critical-inner">' + o.body.map((b, i) => '<p class="' + o.part + '-body-line" data-part="' + o.part + '-body"' + (i === 0 ? ' id="s4-crit-body"' : '') + '>' + b + '</p>').join('') +
        '<div class="confirm-row"><button type="button" class="btn" data-part="' + o.part + '-cancel" data-x="cancel" data-autofocus="1">' + ic('x', 18) + '<span>' + esc(o.cancelText) + '</span></button><button type="button" class="btn solid" data-part="' + o.part + '-ok" data-x="ok">' + ic(o.okIcon || 'triangle-alert', 18) + '<span>' + esc(o.okText) + '</span></button></div></div>';
      root.querySelector('[data-x="cancel"]').onclick = () => { cancel(); A.closeSheet(true); };
      root.querySelector('[data-x="ok"]').onclick = () => { cleanup(); A.closeSheet(false); o.onOk(); };
    } });
    const sh = sheet(); sh.setAttribute('role', 'alertdialog'); sh.setAttribute('data-part', o.part); sh.setAttribute('data-part-critical', ''); sh.setAttribute('aria-describedby', 's4-crit-body'); $('#sheetTitle').setAttribute('data-part', o.part + '-title'); sh.setAttribute('data-kind', 'question'); if (A.sheetCritical) A.sheetCritical();   /* DD-200: the shared sheet's own header, handle and content wear the protected child parts (studio-critical-*) */
    const lay = S.layers[S.layers.length - 1]; if (lay) { const c0 = lay.close; lay.close = () => { cancel(); c0(); }; }
    bd = cancel; $('#sheetBackdrop').addEventListener('click', bd);
  };
  /* M1: a delete toast's Undo and a history Undo are two routes to one step. The toast only acts while the delete step is still applied in the owner's history (a durable undo after later edits still works). */
  S4.undoGuard = (oid) => { const h = A.S.H[oid], st = h && h.steps[h.idx]; return () => { if (!h) return true; const k = h.steps.indexOf(st), ok = k >= 0 && k <= h.idx; if (!ok) { S4.say(t('s4ToastGone')); A.toast(t('s4ToastGone'), { ms: 2500 }); } return ok; }; };   /* m-6: a toast Undo that no longer applies says so */
  S4.viewing = (oid, kind) => { const f = S.inStudio && S.open && A.findItem(S.open); return !!f && f.o.id === oid && (!kind || f.it.kind === kind); };
  S4.core = { hiddenPrivate, O, itemOf, fOf, chatIt, chatF, hasChat, isGroup, isPrivate, txt, W, say, dr, rerender, advState, label: labelOf, mountLT, tgItem, saveUI, uiOf };
})();
