/* Chat slice 3 mockup: group chats. Synthetic mockup; not proof of native behaviour or performance.
   Loads after slice1.js and slice2.js and extends them through hooks (S.hooks.*, window.__s2hooks); nothing is forked.
   Implements docs/design/chat/SLICE3_SPEC.md (draft rev 1, DD-049..DD-058). Rounds, Stop, errors, auto mode and regenerate are script-driven. */
(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const Q3 = new URLSearchParams(location.search);
let X, S, ST, Y, S2, S2H;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ------------------------------------------------------------------ copy (SLICE3_SPEC section 10 plus mockup-only keys, marked "extra") */
const S3I = {
en: {
  groupMessageFrom: 'Message from {name}', missingMember: 'Deleted character', autoSwitch: 'Auto', speakNext: 'Speak next', letSpeak: 'Let {name} speak', oneMoreRound: 'One more round',
  muteMember: 'Sit out', unmuteMember: 'Rejoin', viewCharacter: 'View character', removeFromGroup: 'Remove from group', turnOf: "{name}'s turn", waiting: 'Waiting',
  roundStopped: "Stopped {a}'s reply · skipped {list}", roundStoppedLast: "Stopped {a}'s reply", roundResume: 'Let {list} speak', roundFailed: "{a}'s reply failed · skipped {list}", roundFailedLast: "{a}'s reply failed",
  memberSkippedMissing: 'Skipped {name}: not in the group', memberSkippedRestore: "Skipped {name}: couldn't load", redoRound: 'Redo this round',
  redoRoundConfirm: 'Remove {n} replies and redo the round?', regenOnlyGreetings: 'Only first messages so far, nothing to redo',
  autoRunning: 'Auto · round {n} · next {name}', autoPaused: 'Paused · round {n}', autoPause: 'Pause', autoResume: 'Resume', autoStop: 'Stop', autoEnded: 'Auto mode stopped · {reason}',
  autoReasonUser: 'by you', autoReasonError: 'error ({name})', autoReasonQuiet: "nobody's turn", autoReasonSwitched: 'moved to another chat', autoNoSpeaker: 'No member can speak',
  membersGroup: 'Members', scopeGroup: 'This group', talkativeness: 'Talkativeness', talkLess: 'Less', talkMore: 'More', orderRandom: 'By talkativeness', orderList: 'In order',
  mentionHelp: 'Name a member in a message and they speak first.', addMember: 'Add member', addWithFirst: 'Also add their first message', createGroup: 'Create group chat',
  createNeedTwo: 'Pick at least two members', groupNameMore: '{a}, {b} and {n} more', pictureLater: 'You can change this later', startChat: 'Start', startEmpty: 'Start empty',
  restoreFailedRow: "Couldn't load this character",
  /* extra */
  membersLabel: 'Group members', stNext: 'next, number {n}', stSpeaking: 'speaking', stMuted: 'sitting out', stMissing: 'not in the group', stWaiting: 'waiting',
  moreMembers: 'Members and settings', autoOn: 'Auto mode', mutedCantQueue: '{name} is sitting out', missingCantQueue: '{name} is not in the group', removedMember: 'Removed {name} from the group', undoRemove: 'Undo',
  orderLabel: 'Speaking order', listNoTalk: 'Talkativeness is not used when members speak in order.', reorderLabel: 'Move {name}', reorderMoved: '{name} is now number {n}', talkOf: '{n} of 6',
  groupName: 'Group name', groupPicture: 'Group picture', picFromMembers: 'Make from member pictures', picPick: 'Choose a picture', removeMissing: 'Remove', memberMenu: 'Member options',
  regenOne: 'New reply', regenEarlier: 'Redoing this reply removes the later replies of this round.', cancelBtn: 'Cancel', pickerSearch: 'Search characters', chosen: 'Chosen members', chooseChars: 'Characters',
  discardCreate: 'Discard this group?', keepEditing: 'Keep editing', discardBtn: 'Discard', startTitle: 'First messages', altOf: 'First message {n} of {total}', noMembersYet: 'No members yet', nameAuto: 'Name follows the members until you edit it',
  startRestore: 'Loading characters…', createdToast: 'Group created', startNone: 'No first messages to choose from', roundMore: 'Another round', quietDemo: 'nobody left to speak',
  dTitle: 'Slice 3 demo controls', dOpenGroup: 'Open the group chat', dGreet: 'Open first-messages-only chat', dNewChat: 'New chat in the group', dCreate: 'Open the create sheet', dBg: 'Start a round, then switch away', dAuto: 'Start auto mode',
  dFail: 'The 2nd speaker fails once', dList: 'Members speak in order', dRestore: 'Mira fails to load', dQuiet: 'Auto mode runs out of speakers after round 2', dNoFirst: 'Members have no first messages', dSpeed: 'Reply speed', dFreeze: 'Hold replies half-way', dReset: 'Reset', dPanel: 'Open the member panel',
},
ko: {
  groupMessageFrom: '{name}의 메시지', missingMember: '삭제된 캐릭터', autoSwitch: '자동', speakNext: '다음에 말하기', letSpeak: '{name} 차례', oneMoreRound: '한 라운드 더',
  muteMember: '쉬게 하기', unmuteMember: '다시 참여', viewCharacter: '캐릭터 보기', removeFromGroup: '그룹에서 빼기', turnOf: '{name} 차례', waiting: '대기',
  roundStopped: '{a}의 답변을 멈췄어요 · {list} 건너뜀', roundStoppedLast: '{a}의 답변을 멈췄어요', roundResume: '{list} 차례 이어가기', roundFailed: '{a}의 답변이 실패했어요 · {list} 건너뜀', roundFailedLast: '{a}의 답변이 실패했어요',
  memberSkippedMissing: '{name}(은)는 그룹에 없어서 건너뛰었어요', memberSkippedRestore: '{name}(을)를 불러오지 못해 건너뛰었어요', redoRound: '이 라운드 다시',
  redoRoundConfirm: '답변 {n}개를 지우고 이 라운드를 다시 할까요?', regenOnlyGreetings: '첫 메시지만 있어서 다시 만들 답변이 없어요',
  autoRunning: '자동 진행 · {n}라운드 · 다음 {name}', autoPaused: '일시정지 · {n}라운드', autoPause: '일시정지', autoResume: '계속', autoStop: '멈추기', autoEnded: '자동 진행을 멈췄어요 · {reason}',
  autoReasonUser: '직접 멈춤', autoReasonError: '오류 ({name})', autoReasonQuiet: '말할 차례가 없음', autoReasonSwitched: '다른 채팅으로 이동', autoNoSpeaker: '말할 수 있는 멤버가 없어요',
  membersGroup: '멤버', scopeGroup: '이 그룹', talkativeness: '말 수', talkLess: '적게', talkMore: '많이', orderRandom: '말 수에 따라', orderList: '순서대로',
  mentionHelp: '메시지에서 이름을 부르면 그 멤버가 먼저 말해요.', addMember: '멤버 추가', addWithFirst: '첫 메시지도 넣기', createGroup: '그룹 채팅 만들기',
  createNeedTwo: '멤버를 두 명 이상 골라 주세요', groupNameMore: '{a}, {b} 외 {n}명', pictureLater: '나중에 바꿀 수 있어요', startChat: '시작하기', startEmpty: '비우고 시작',
  restoreFailedRow: '이 캐릭터를 불러오지 못했어요',
  membersLabel: '그룹 멤버', stNext: '다음 순서 {n}번', stSpeaking: '말하는 중', stMuted: '쉬는 중', stMissing: '그룹에 없음', stWaiting: '대기 중',
  moreMembers: '멤버와 설정', autoOn: '자동 진행', mutedCantQueue: '{name}(은)는 쉬는 중이에요', missingCantQueue: '{name}(은)는 그룹에 없어요', removedMember: '{name}(을)를 그룹에서 뺐어요', undoRemove: '되돌리기',
  orderLabel: '말하는 순서', listNoTalk: '순서대로 말할 때는 말 수를 쓰지 않아요.', reorderLabel: '{name} 옮기기', reorderMoved: '{name}(이)가 {n}번째가 됐어요', talkOf: '6단계 중 {n}',
  groupName: '그룹 이름', groupPicture: '그룹 사진', picFromMembers: '멤버 사진으로 만들기', picPick: '사진 고르기', removeMissing: '빼기', memberMenu: '멤버 옵션',
  regenOne: '새 답변', regenEarlier: '이 답변을 다시 만들면 같은 라운드의 뒤쪽 답변이 지워져요.', cancelBtn: '취소', pickerSearch: '캐릭터 검색', chosen: '고른 멤버', chooseChars: '캐릭터',
  discardCreate: '만들던 그룹을 버릴까요?', keepEditing: '계속 만들기', discardBtn: '버리기', startTitle: '첫 메시지', altOf: '첫 메시지 {total}개 중 {n}번째', noMembersYet: '아직 멤버가 없어요', nameAuto: '직접 고치기 전까지 이름이 멤버를 따라가요',
  startRestore: '캐릭터를 불러오는 중…', createdToast: '그룹을 만들었어요', startNone: '고를 수 있는 첫 메시지가 없어요', roundMore: '한 라운드 더', quietDemo: '말할 멤버가 없음',
  dTitle: '슬라이스 3 데모 컨트롤', dOpenGroup: '그룹 채팅 열기', dGreet: '첫 메시지만 있는 채팅 열기', dNewChat: '그룹에서 새 채팅', dCreate: '만들기 시트 열기', dBg: '라운드를 시작하고 다른 채팅으로', dAuto: '자동 진행 시작',
  dFail: '두 번째 멤버의 답변이 한 번 실패', dList: '멤버가 순서대로 말하기', dRestore: '미라를 불러오지 못함', dQuiet: '2라운드 뒤 자동 진행이 말할 멤버를 못 찾음', dNoFirst: '멤버에게 첫 메시지가 없음', dSpeed: '답변 속도', dFreeze: '답변을 중간에서 멈춰 두기', dReset: '처음으로', dPanel: '멤버 패널 열기',
},
};
const t3 = (k, v) => { let s = S3I[S.lang][k] ?? S3I.en[k]; if (s === undefined) return Y.t2(k, v); if (v) for (const x in v) s = s.replaceAll('{' + x + '}', v[x]); return S.lang === 'ko' ? X.josa(s) : s; };
const L = (o) => (o && (o[S.lang] || o.en)) || '';

/* ------------------------------------------------------------------ icons (Lucide) */
const ICONS3 = {
  'repeat': '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  'volume-x': '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/>',
  'triangle-alert': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  'pause': '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
  'play': '<polygon points="6 3 20 12 6 21 6 3"/>',
  'grip-vertical': '<circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>',
  'user-plus': '<path d="M2 21a8 8 0 0 1 13.292-6"/><circle cx="10" cy="8" r="5"/><path d="M19 16v6"/><path d="M22 19h-6"/>',
  'user-x': '<path d="M2 21a8 8 0 0 1 11.873-7"/><circle cx="10" cy="8" r="5"/><path d="m17 17 5 5"/><path d="m22 17-5 5"/>',
  'arrow-up': '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  'arrow-down': '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  'rotate-ccw': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  'skip-forward': '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" x2="19" y1="5" y2="19"/>',
  'circle-stop': '<circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
  'users-round': '<path d="M18 21a8 8 0 0 0-16 0"/><circle cx="10" cy="8" r="5"/><path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3"/>',
};
const icon = (n, size = 20, cls = '') => (ICONS3[n] ? `<svg class="ic ${cls}" data-icon-size="${size}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS3[n]}</svg>` : Y.ic2(n, size, cls));

/* ------------------------------------------------------------------ synthetic members */
// lines: [en, ko] pairs a member cycles through; first: first messages (alternates)
const MEM = {
  sera: { id: 'sera', name: { en: 'Seraphina', ko: '세라핀' }, hue: 'warm', lines: [
    ['*sets the kettle down* You are late. Come in out of the wind, there is room for all of you.', '*주전자를 내려놓는다* 늦었네요. 바람 피해서 들어와요, 모두 앉을 자리는 있어요.'],
    ['The lights went out the night the tide turned. Nobody lit them again.', '조수가 바뀐 밤에 불빛이 꺼졌어요. 아무도 다시 켜지 않았죠.'],
    ['Sit by the stove. I will count the stairs again, it always comes out different.', '난로 곁에 앉아요. 계단을 다시 세어 볼게요, 늘 숫자가 달라지거든요.'],
    ['*smiles* Stay as long as you like. The lamp will wait.', '*웃는다* 있고 싶은 만큼 있어요. 등불이 기다려 줄 거예요.']],
    first: [['*looks up from the lamp* Oh, you came. Come in, the stove is lit.', '*등불에서 고개를 든다* 아, 왔군요. 들어와요, 난로가 켜져 있어요.'], ['It has been a long time since the lanterns had a guest.', '등불에 손님이 든 건 정말 오랜만이에요.'], ['Mind the third step, it creaks.', '세 번째 계단을 조심해요, 삐걱거려요.']] },
  juno: { id: 'juno', name: { en: 'Juno', ko: '주노' }, hue: 'blue', lines: [
    ['Is the kettle really still warm? I will believe it when I taste it.', '주전자가 정말 아직 따뜻해요? 맛을 보기 전엔 못 믿겠어요.'],
    ['I counted twelve stairs. Mira says it is thirteen. One of us is wrong.', '저는 계단이 열두 개였어요. 미라는 열세 개래요. 둘 중 하나가 틀렸죠.'],
    ['*leans on the doorframe* Somebody has to ask what happened to the lights.', '*문틀에 기댄다* 불빛이 왜 꺼졌는지는 누군가 물어봐야죠.'],
    ['Fine. I will sit. But only because the stove is there.', '좋아요, 앉을게요. 난로가 있어서일 뿐이에요.']],
    first: [['*waves from the window seat* Finally. I was starting to think nobody was coming.', '*창가 자리에서 손을 흔든다* 드디어요. 아무도 안 오는 줄 알았어요.']] },
  mira: { id: 'mira', name: { en: 'Mira', ko: '미라' }, hue: 'green', cold: true, lines: [
    ['*writes in her ledger* The tide table says it should have turned an hour ago.', '*장부에 적는다* 물때표로는 한 시간 전에 바뀌었어야 해요.'],
    ['Thirteen. I wrote it down the first time. I do not forget numbers.', '열세 개예요. 처음에 적어 뒀어요. 숫자는 잊지 않아요.'],
    ['If the lamp stays dark, the ledger stays open. That is how it works here.', '등불이 꺼져 있으면 장부는 계속 열려 있어요. 여기선 그렇게 돼요.'],
    ['*closes the book* Enough counting for tonight.', '*책을 덮는다* 오늘 밤은 이만 세죠.']],
    first: [['*nods without looking up* Name, and which tide you came in on.', '*고개를 들지 않고 끄덕인다* 이름이랑, 어느 물때에 들어왔는지 말해 줘요.'], ['Welcome. Sign the ledger before you sit.', '어서 와요. 앉기 전에 장부에 이름을 적어요.']] },
  tomo: { id: 'tomo', name: { en: 'Tomo', ko: '토모' }, hue: 'gold', lines: [
    ['*hums softly from the corner*', '*구석에서 조용히 흥얼거린다*'], ['I will bring the bread.', '빵은 제가 가져올게요.']], first: [['*bows slightly* I will keep to the corner, if that is all right.', '*살짝 고개를 숙인다* 괜찮다면 구석에 있을게요.']] },
  ghost: { id: 'ghost', name: { en: 'Echo', ko: '에코' }, hue: 'violet', missing: true, lines: [['…', '…']], first: [] },
  kai: { id: 'kai', name: { en: 'Kai', ko: '카이' }, hue: 'green', lines: [['Coffee is on the counter.', '커피는 카운터에 있어요.'], ['Night shift is long, sit a while.', '야간 근무는 길어요, 잠깐 앉아요.']], first: [['Evening. Quiet tonight.', '안녕하세요. 오늘 밤은 조용하네요.']] },
  arch: { id: 'arch', name: { en: 'Archivist', ko: '기록관' }, hue: 'blue', lines: [['Entry 14 is missing.', '14번 항목이 사라졌어요.'], ['Not yet.', '아직은 안 돼요.']], first: [['Please sign the index.', '색인에 서명해 주세요.'], ['The shelves are sealed.', '서가는 봉인돼 있어요.']] },
  dusk: { id: 'dusk', name: { en: 'Dusk', ko: '노을' }, hue: 'rose', lines: [['Stay a little longer.', '조금만 더 있어요.'], ['We can turn back anytime.', '언제든 돌아갈 수 있어요.']], first: [['The roof is warm still.', '옥상은 아직 따뜻해요.']] },
  mina: { id: 'mina', name: { en: 'Mina', ko: '미나' }, hue: 'gold', lines: [['Hello again.', '또 만났네요.'], ['Shall we begin?', '시작할까요?']], first: [] },
};
const LIB = ['sera', 'juno', 'mira', 'tomo', 'kai', 'arch', 'dusk', 'mina'];
const COLORS = 8;                                                    // member name colours by member order (wraps after 8)

/* ------------------------------------------------------------------ groups, chats, messages */
const S3 = { tip: false, speed: Number(Q3.get('s3speed')) || 1, failOnce: false, restoreFail: false, quietAfter: false, noFirst: false, freeze: false, lc: {}, pendingUser: '', createN: 0, undo: null };
const AU = { on: false, paused: false, round: 0, ended: null, timer: 0, endT: 0 };
const R = { round: null };
let CHARS, CHATS, uid3 = 0;
const chatById = (id) => Y.chatById(id);
const charById = (id) => CHARS.find((c) => c.id === id);
const groupOf = (c) => { const ch = c && charById(c.charId); return ch && ch.g ? ch.g : null; };
const curC = () => Y.curChat();
const cg = () => { const c = curC(); const g = groupOf(c); return g ? { c, g, ch: charById(c.charId) } : null; };
const stOf = (g, id) => g.st[id] || (g.st[id] = { talk: 3, active: true, cold: false, missing: false });
const canSpeak = (g, id) => { const s = g.st[id]; return !!s && !s.missing && s.active; };
const memColor = (g, id) => 'mc' + ((g.st[id] && g.st[id].slot !== undefined ? g.st[id].slot : Math.max(0, g.members.indexOf(id))) % COLORS);   // DD-064: a slot is assigned when the member joins and kept
const nextSlot = (g) => { const used = new Set(g.members.map((i) => g.st[i] && g.st[i].slot)); for (let n = 0; n < COLORS; n++) if (!used.has(n)) return n; return Object.keys(g.st).length % COLORS; };
const mName = (id) => (MEM[id] ? L(MEM[id].name) : t3('missingMember'));
const gName = (g, id) => (g.st[id] && g.st[id].missing ? (g.st[id].keepName ? mName(id) : t3('missingMember')) : mName(id));
const joinNames = (g, ids) => ids.map((i) => gName(g, i)).join(S.lang === 'ko' ? ', ' : ', ');
const mkMsg = (role, o) => Object.assign({ id: ++S.seq, role, alts: [{ en: '', ko: '' }], idx: 0, bookmarked: false, hidden: false, streaming: false }, o);
const gmsg = (id, pairs, o) => { const ps = Array.isArray(pairs[0]) ? pairs : [pairs]; return mkMsg('char', Object.assign({ saying: id, alts: ps.map((p) => ({ en: p[0], ko: p[1] })) }, o || {})); };
const umsg = (en, ko) => mkMsg('user', { alts: [{ en, ko }] });

function makeGroup(id, name, ids, mode, extra) {
  const g = { members: ids.slice(), orderMode: mode || 'random', st: {}, roundNo: 0, last: null };
  const talk = { sera: 5, juno: 5, mira: 4, tomo: 3, ghost: 3, kai: 3, arch: 2, dusk: 4, mina: 3 };
  ids.forEach((m, i) => { g.st[m] = { talk: talk[m] || 3, active: true, cold: !!(MEM[m] && MEM[m].cold), missing: !!(MEM[m] && MEM[m].missing), slot: i % COLORS }; });
  if (extra) Object.assign(g, extra);
  return { id, name, hue: 'group', group: true, g };
}
function seedMain() {
  const ms = [
    gmsg('sera', MEM.sera.first, { greeting: true }), gmsg('juno', MEM.juno.first, { greeting: true }), gmsg('mira', MEM.mira.first, { greeting: true }),
    umsg('Good evening. Is anyone here?', '안녕하세요. 누구 계세요?'),
    gmsg('sera', MEM.sera.lines[0]), gmsg('juno', MEM.juno.lines[1]),
    gmsg('ghost', ['I still think the lamp should be lit.', '그래도 등불은 켜 둬야 한다고 생각해요.'], { snap: { en: 'Echo', ko: '에코' } }),
    umsg('Tell me about this place.', '이곳에 대해 알려 주세요.'),
    gmsg('mira', MEM.mira.lines[0]), gmsg('ghost', ['Somebody ought to light it.', '누군가는 켜야 해요.']),
    umsg('I can wait a little longer.', '조금 더 기다릴 수 있어요.'),
    gmsg('sera', MEM.sera.lines[3]), gmsg('juno', MEM.juno.lines[3]),
  ];
  return ms;
}
function seedGreet() { return [gmsg('sera', MEM.sera.first, { greeting: true }), gmsg('juno', MEM.juno.first, { greeting: true }), gmsg('mira', MEM.mira.first, { greeting: true })]; }
function seedOld() {
  return [gmsg('sera', MEM.sera.first[0], { greeting: true }), umsg('We came in from the fog.', '안개를 뚫고 왔어요.'), gmsg('sera', MEM.sera.lines[0]), gmsg('mira', MEM.mira.lines[1]), umsg('Good. Warm the stove.', '좋아요. 난로를 데워요.'), gmsg('juno', MEM.juno.lines[0])];
}
function setupData() {
  CHARS = Y.CHARS; CHATS = Y.CHATS;
  if (charById('trio')) return;
  CHARS.push(makeGroup('trio', { en: 'Seraphina, Juno, Mira', ko: '세라핀, 주노, 미라' }, ['sera', 'juno', 'mira', 'tomo', 'ghost'], 'random'));
  const g = charById('trio').g; g.st.tomo.active = false;       // one muted member, one missing (deleted) member
  const add = (o, msgs) => { const c = Y.mk('trio', Object.assign({ persona: 2, last: { en: '', ko: '' } }, o)); c.msgs = msgs; c.built = msgs.length; c.g = { queue: [], notice: null, skips: [] }; c.seen = true; CHATS.push(c); return c; };
  add({ id: 'c-trio', name: { en: 'Lantern supper', ko: '등불 저녁 식사' }, age: 2, base: 12 }, seedMain());
  add({ id: 'c-trio-greet', name: { en: 'First meeting', ko: '첫 만남' }, age: 40, base: 3 }, seedGreet());
  add({ id: 'c-trio-old', name: { en: 'Fog arrival', ko: '안개 속 도착' }, age: 3000, date: { en: 'Oct 14', ko: '10월 14일' }, base: 6 }, seedOld());
  Y.S2.recent = ['trio', ...Y.S2.recent.filter((x) => x !== 'trio')].slice(0, 5);
}
const ensureG = (c) => { if (!c.g) c.g = { queue: [], notice: null, skips: [] }; return c.g; };

/* ------------------------------------------------------------------ hooks into slice 1 (message rendering, composer) */
const isGroupMsg = (m) => { const k = cg(); return !!(k && m && m.role === 'char' && m.saying); };
function memberLabel(g, m) { const id = m.saying; const s = g.st[id]; if (s && s.missing) return m.snap ? L(m.snap) : t3('missingMember'); return mName(id); }
function installRender() {
  S.hooks.nameOf = (m) => { const k = cg(); if (!k || m.role !== 'char' || !m.saying) return undefined; return memberLabel(k.g, m); };
  S.hooks.showMeta = (m, prev, dflt) => { const k = cg(); if (!k || m.role !== 'char' || !m.saying) return dflt; return !prev || prev.role !== 'char' || prev.saying !== m.saying; };
  S.hooks.meta = (a, m, show) => {
    const k = cg(); const av = $('.avatar', a); const nm = $('.name', a);
    if (!k || m.role !== 'char' || !m.saying) { if (a.classList.contains('gmsg')) { a.classList.remove('gmsg', 'gmissing'); av.className = 'avatar'; nm.className = 'name'; a.setAttribute('aria-labelledby', `nm-${m.id} ps-${m.id}`); $('#gm-' + m.id, a)?.remove(); } return; }
    const s = k.g.st[m.saying]; const missing = !!(s && s.missing); const mem = MEM[m.saying];
    a.classList.add('gmsg'); a.classList.toggle('gmissing', missing); a.dataset.speaker = m.saying;
    av.className = 'avatar hue-' + (mem ? mem.hue : 'violet') + (missing ? ' missing' : ''); nm.className = 'name ' + memColor(k.g, m.saying);
    av.textContent = missing && !m.snap ? '?' : [...memberLabel(k.g, m)][0];
    let sr = $('#gm-' + m.id, a); if (!sr) { sr = document.createElement('span'); sr.id = 'gm-' + m.id; sr.className = 'sr-only'; a.appendChild(sr); }
    sr.textContent = t3('groupMessageFrom', { name: memberLabel(k.g, m) }); a.setAttribute('aria-labelledby', `gm-${m.id} ps-${m.id}`);
  };
}

/* ------------------------------------------------------------------ scripted replies */
function takeLine(id) { const arr = (MEM[id] || MEM.sera).lines; const n = (S3.lc[id] = (S3.lc[id] || 0) + 1); return arr[n % arr.length]; }
const langText = (pair) => pair[S.lang === 'ko' ? 1 : 0];
function installPlan() {
  S.hooks.plan = (m, opts) => { if (!m.saying) return null; const k = cg(); if (!k) return null; m.pair = takeLine(m.saying); return { full: langText(m.pair), holds: [] }; };
  S.hooks.started = (m) => { if (m.saying && cg()) drive(m); };
}
const stepOf = () => Math.max(1, Math.round(5 * S3.speed));
function drive(m) {
  const text = ST.full; clearInterval(ST.timer);
  const failAt = S3.failOnce && R.round && R.round.i === 1 && !R.round.retry ? Math.floor(text.length * 0.5) : -1;
  ST.timer = setInterval(() => {
    if (ST.m !== m) { clearInterval(ST.timer); return; }
    const half = Math.floor(text.length * 0.5);
    if (S3.freeze && ST.pos >= half) { ST.dirty = true; return; }
    ST.pos = Math.min(text.length, ST.pos + stepOf()); ST.raw = text.slice(0, ST.pos); ST.dirty = true;
    if (failAt >= 0 && ST.pos >= failAt) { clearInterval(ST.timer); S3.failOnce = false; syncDemo3(); failRound(m); return; }
    if (ST.pos >= text.length) X.finishStream(false);
  }, 40);
}
function finalizeAlt(m, stopped) {
  if (!m.pair || stopped) return;
  m.alts[m.idx] = { en: m.pair[0], ko: m.pair[1] };
}

/* ------------------------------------------------------------------ rounds */
const mentionIds = (g, text) => { const tx = (text || '').toLowerCase(); return g.members.filter((id) => canSpeak(g, id) && MEM[id] && (tx.includes(MEM[id].name.en.toLowerCase()) || (text || '').includes(MEM[id].name.ko))); };
function planRound(c, g, userText, redo) {
  const q = c.g.queue.slice();
  if (q.length) return q;
  const n = ++g.roundNo;
  if (g.orderMode === 'list') return g.members.filter((id) => g.st[id].missing || g.st[id].active);        // a missing member is listed so the skip is shown
  const men = mentionIds(g, userText);
  let rest = g.members.filter((id, i) => canSpeak(g, id) && !men.includes(id) && ((n + i) % 6) < g.st[id].talk);
  if (rest.length > 1 && g.last) rest = rest.filter((id) => id !== g.last);
  let list = [...men, ...rest];
  if (!list.length) { const f = g.members.find((id) => canSpeak(g, id)); if (f) list = [f]; }
  return list;
}
const lastUserText = () => { const ms = S.msgs; for (let i = ms.length - 1; i >= 0; i--) { if (ms[i].role === 'user') return X.altText(ms[i]); if (i < ms.length - 6) break; } return ''; };
function startRound(opts = {}) {
  const k = cg(); if (!k || R.round || S.streaming) return false;
  const { c, g } = k; commitStart(c); clearNotice(c);
  const list = planRound(c, g, opts.text !== undefined ? opts.text : lastUserText(), opts.redo);
  c.g.queue = [];
  if (!list.length || !list.some((id) => canSpeak(g, id))) { X.toast(t3('autoNoSpeaker')); if (AU.on) autoEnd('quiet'); renderStrip3(); return false; }
  R.round = { chatId: c.id, list, i: 0, cur: null, failing: false, silent: false, retry: !!opts.retry, held: false };
  if (AU.on) { AU.round++; X.announce(t3('autoRunning', { n: AU.round, name: gName(g, list.find((id) => canSpeak(g, id)) || list[0]) })); }       // one announcement per round in auto mode, per speaker otherwise
  renderStrip3(); runNext(); return true;
}
function runNext() {
  const r = R.round; if (!r) return; const c = chatById(r.chatId); const g = groupOf(c);
  if (AU.on && AU.paused && r.i > 0) { r.held = true; renderStrip3(); return; }
  while (r.i < r.list.length) {
    const id = r.list[r.i]; const st = g.st[id];
    if (!g.members.includes(id)) { r.i++; continue; }                         // removed from the group during the round: skipped without a note
    if (!st || st.missing) { addSkip(c, 'missing', id); r.i++; continue; }
    if (!st.active) { r.i++; continue; }
    if (st.cold && S3.restoreFail && id === 'mira') { addSkip(c, 'restore', id); r.i++; continue; }
    r.held = false; speak(id); return;
  }
  endRound();
}
function speak(id) {
  const r = R.round; const c = chatById(r.chatId); const g = groupOf(c);
  if (!AU.on) X.announce(t3('turnOf', { name: gName(g, id) }));
  if (Y.S2.chatId === r.chatId && !Y.S2.loading) {
    const m = X.generateNew({ newMsg: true, saying: id });
    r.cur = m || null; if (!m) { R.round = null; renderStrip3(); return; }
    if (Y.S2.chatId === c.id) { const el = X.msgEl(m); if (el && S.atBottom) X.scrollBottom(); }
  } else bgSpeak(id);
  renderStrip3();
}
function endRound() {
  const r = R.round; if (!r) return; const c = chatById(r.chatId); const g = groupOf(c);
  g.last = r.list.filter((id) => canSpeak(g, id)).pop() || g.last; R.round = null; renderStrip3();
  if (AU.on) autoAfterRound();
}
function addSkip(c, kind, id) {
  const ms = Y.S2.chatId === c.id ? S.msgs : c.msgs; const after = ms.length ? ms[ms.length - 1].id : 0;
  ensureG(c).skips.push({ kind, id, after }); if (Y.S2.chatId === c.id) renderExtras3(c);
  X.announce(t3(kind === 'missing' ? 'memberSkippedMissing' : 'memberSkippedRestore', { name: gName(groupOf(c), id) }));
}
function remainingAfter(r, g) { return r.list.slice(r.i + 1).filter((id) => canSpeak(g, id) || g.st[id].missing); }
function cancelRound(kind, m, why) {
  const r = R.round; if (!r) return; const c = chatById(r.chatId); const g = groupOf(c);
  const rest = (kind === 'ended' ? r.list.slice(r.i) : remainingAfter(r, g)).filter((id) => canSpeak(g, id) && g.members.includes(id));       // after a finished reply r.i already points at the next member
  R.round = null;
  if (kind !== 'ended' || rest.length) { ensureG(c).notice = { kind, a: m && m.saying, skipped: rest, retryFirst: kind === 'failed' }; if (Y.S2.chatId === c.id) renderExtras3(c); }
  if (AU.on && kind === 'failed') autoEnd('error', gName(g, m.saying));
  else if (AU.on) autoEnd('user');
  renderStrip3(); X.syncSend();
}
// auto mode ended while no reply is running (paused, or Home): the members who did not get their turn are noted like after a Stop
function endHeld() {
  const r = R.round; if (!r) return; const c = chatById(r.chatId); const g = groupOf(c);
  const rest = r.list.slice(r.i).filter((id) => canSpeak(g, id) && g.members.includes(id)); R.round = null;
  if (rest.length) { ensureG(c).notice = { kind: 'ended', a: '', skipped: rest }; if (Y.S2.chatId === c.id) renderExtras3(c); }
  renderStrip3(); X.syncSend();
}
function failRound(m) { if (!R.round) return; R.round.failing = true; X.stopStream(); }
function onStreamEnd(m, stopped) {
  const r = R.round; if (!r || r.cur !== m) return;
  if (r.failing) { const mm = m; X.removeMsgs([mm], {}); cancelRound('failed', mm); return; }
  if (stopped) { cancelRound('stopped', m); return; }
  finalizeAlt(m, false); r.cur = null; r.i++;
  if (r.afterCurrent) { cancelRound('ended', m); return; }                       // Home: auto mode ends after this reply (DD-060)
  if (S3.pendingUser && AU.on) { const v = S3.pendingUser; S3.pendingUser = ''; $$('.s3-pending').forEach((e) => e.remove()); insertUser(v); const k = cg(); if (k) { r.list = planRound(k.c, k.g, v); r.i = 0; k.c.g.queue = []; } }
  runNext();
}
// a message sent during auto mode is never inserted into a later round: when auto mode ends first it returns to the box
function returnPending() {
  if (!S3.pendingUser) return; const v = S3.pendingUser; S3.pendingUser = ''; $$('.s3-pending').forEach((e) => e.remove());
  const ta = $('#input'); ta.value = ta.value.trim() ? ta.value + '\n' + v : v; ta.dispatchEvent(new Event('input', { bubbles: true })); X.fitInput(); X.syncSend(); X.announce(t3('pendingReturned'));
}
function insertUser(v) {
  S.msgs.push(mkMsg('user', { alts: [{ en: v, ko: v }] })); const k = cg(); X.renderTranscript(false); if (k) renderExtras3(k.c);
}
function retryRound(c) { const g = groupOf(c); const n = c.g.notice; if (!n) return; const list = [n.a, ...n.skipped].filter((id) => canSpeak(g, id)); clearNotice(c); c.g.queue = list; startRound({ retry: true, text: '' }); }
function resumeRound(c) { const n = c.g.notice; if (!n) return; const g = groupOf(c); const list = n.skipped.filter((id) => canSpeak(g, id)); clearNotice(c); c.g.queue = list; startRound({ text: '' }); }

/* ------------------------------------------------------------------ notices (inline, no timer, role=status) */
function clearNotice(c) { if (!c.g) return; c.g.notice = null; c.g.skips = []; if (Y.S2.chatId === c.id) $$('.s3-notice, .s3-skip').forEach((e) => e.remove()); }
function renderExtras3(c) {
  $$('.s3-notice, .s3-skip').forEach((e) => e.remove()); if (!c || !c.g || Y.S2.chatId !== c.id) return; const g = groupOf(c); if (!g) return;
  const th = X.thread();
  c.g.skips.forEach((sk) => {
    const d = document.createElement('p'); d.className = 's3-skip'; d.setAttribute('role', 'note'); d.dataset.kind = sk.kind;
    d.innerHTML = icon('triangle-alert', 16) + '<span>' + esc(t3(sk.kind === 'missing' ? 'memberSkippedMissing' : 'memberSkippedRestore', { name: gName(g, sk.id) })) + '</span>';
    const after = sk.after && $(`.msg[data-id="${sk.after}"]`); if (after && after.nextSibling) th.insertBefore(d, after.nextSibling); else th.appendChild(d);
  });
  const n = c.g.notice; if (!n) return;
  const d = document.createElement('div'); d.className = 's3-notice'; d.setAttribute('data-part', 'chat-status-row'); d.setAttribute('role', 'status'); d.dataset.kind = n.kind;
  const failed = n.kind === 'failed'; const list = n.skipped.length ? joinNames(g, n.skipped) : '';
  const text = n.kind === 'ended' ? t3('roundEndedSkipped', { list }) : failed ? (n.skipped.length ? t3('roundFailed', { a: gName(g, n.a), list }) : t3('roundFailedLast', { a: gName(g, n.a) })) : (n.skipped.length ? t3('roundStopped', { a: gName(g, n.a), list }) : t3('roundStoppedLast', { a: gName(g, n.a) }));
  d.innerHTML = `<span class="s3-n-ic">${icon(failed ? 'triangle-alert' : n.kind === 'ended' ? 'repeat' : 'circle-stop', 18)}</span><span class="s3-n-t">${esc(text)}</span><span class="s3-n-act"></span>`;
  const act = $('.s3-n-act', d);
  const mkb = (ico, label, fn, cls) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn s3-n-btn' + (cls ? ' ' + cls : ''); b.innerHTML = icon(ico, 18) + '<span>' + esc(label) + '</span>'; b.addEventListener('click', fn); act.appendChild(b); return b; };
  if (failed) { mkb('refresh-cw', t3('retryBtn'), () => retryRound(c), 'accent'); mkb('chevron-right', t3('detailBtn'), () => openErrorDetail(c)); }
  else if (n.skipped.length) mkb('chevron-right', t3('roundResume', { list }), () => resumeRound(c), 'accent');
  th.appendChild(d); if (S.atBottom) X.scrollBottom();
}
function openErrorDetail(c) {
  X.openSheet({ title: t3('detailBtn'), opener: document.activeElement, build(body) { const p = document.createElement('p'); p.className = 'confirm-text'; p.textContent = t3('errorDetailText'); body.appendChild(p); body.appendChild(X.item('x', t3('cancelBtn'), () => X.closeSheet(), '', { 'data-autofocus': '' })); } });
}
Object.assign(S3I.en, { retryBtn: 'Try again', detailBtn: 'Details', errorDetailText: 'The provider returned an error while this member was writing. Nothing was kept from that reply.', stripMemberWriting: '{name} is writing a reply', stripMemberWritingAuto: '{name} is writing', dQueueDemo: 'Queue Seraphina, then Mira', stopRound: 'Stop the round' });
Object.assign(S3I.ko, { retryBtn: '다시 시도', detailBtn: '자세히', errorDetailText: '이 멤버가 답변을 쓰는 동안 제공자가 오류를 돌려줬어요. 그 답변은 남기지 않았어요.', stripMemberWriting: '{name} 답변 쓰는 중', stripMemberWritingAuto: '{name} 쓰는 중', dQueueDemo: '세라핀, 미라 순서로 예약', stopRound: '라운드 멈추기' });

/* ------------------------------------------------------------------ background rounds (slice 2 job, driven here) */
function bgSpeak(id) {
  const r = R.round; const c = chatById(r.chatId); const pair = takeLine(id);
  const m = mkMsg('char', { saying: id, pair }); c.msgs.push(m); r.cur = m;
  startBgJob(c, m, pair, 0);
}
function startBgJob(c, m, pair, pos) {
  clearInterval(Y.S2.job && Y.S2.job.timer);
  const job = { chatId: c.id, charId: c.charId, m, full: langText(pair), pos, state: 'writing', timer: 0, fail: false, failAt: -1, auto: AU.on || !!(Y.S2.job && Y.S2.job.auto), group: true, member: m.saying };
  if (S3.failOnce && R.round && R.round.i === 1) { job.failAt = Math.floor(job.full.length * 0.5); S3.failOnce = false; syncDemo3(); }
  job.timer = setInterval(() => bgTick(job), 40);
  Y.S2.job = job; Y.updateBlock(); Y.renderGenStrip(); Y.refreshAllSide();
}
function bgTick(job) {
  if (Y.S2.job !== job || job.state !== 'writing') { clearInterval(job.timer); return; }
  job.pos = Math.min(job.full.length, job.pos + stepOf()); job.m.alts[job.m.idx][S.lang] = job.full.slice(0, job.pos);
  if (job.failAt >= 0 && job.pos >= job.failAt) { clearInterval(job.timer); return bgFail(job); }
  if (job.pos >= job.full.length) { clearInterval(job.timer); bgNext(job); }
}
function bgNext(job) {
  const r = R.round; const c = chatById(job.chatId); finalizeAlt(job.m, false); if (!r) return; r.cur = null; r.i++;
  const g = groupOf(c); const more = r.list.slice(r.i).some((id) => g.st[id] && (g.st[id].missing || g.st[id].active));
  if (more) { runNext(); if (!R.round || !R.round.cur) bgEnd(job); return; }
  bgEnd(job);
}
function bgEnd(job) {
  const c = chatById(job.chatId); const g = groupOf(c); const r = R.round; if (r) { g.last = r.list.filter((id) => canSpeak(g, id)).pop() || g.last; R.round = null; }
  job.state = 'done'; const S2 = Y.S2; c.unseen = true; c.age = 0; c.err = false; Y.addNote({ kind: 'done', chatId: c.id, auto: false }); Y.scheduleDone(); S2.jobsDone++;
  Y.updateBlock(); Y.renderGenStrip(); Y.refreshAllSide(); X.announce(Y.t2('stripDone', { chat: Y.stripName(c) }));
}
function bgFail(job) {
  const c = chatById(job.chatId); const g = groupOf(c); const r = R.round; const rest = r ? remainingAfter(r, g).filter((id) => canSpeak(g, id)) : [];
  c.msgs = c.msgs.filter((x) => x !== job.m); job.state = 'failed'; R.round = null; ensureG(c).notice = { kind: 'failed', a: job.m.saying, skipped: rest };
  c.failed = true; c.err = true; Y.addNote({ kind: 'failed', chatId: c.id, auto: false }); Y.updateBlock(); Y.renderGenStrip(); Y.refreshAllSide(); X.announce(Y.t2('stripFailed', { chat: Y.stripName(c) }));
}
function installBackground() {
  S2H.leave = (c, autoFlag) => {
    if (!groupOf(c)) return false; if (c.g) c.g.queue = []; if (S3.pendingUser) { returnPending(); c.draft = $('#input').value; } const r = R.round; const wasAuto = AU.on;
    if (r && r.chatId === c.id) {
      const d = S.streaming && ST.m === r.cur ? X.detachStream() : null;
      if (d) startBgJob(c, d.m, d.m.pair || [d.full, d.full], d.pos); else if (!r.cur) runNext();
      if (wasAuto && Y.S2.job) Y.S2.job.auto = true;
      if (wasAuto) autoEnd('switched');
      return true;
    }
    if (wasAuto) { Y.addNote({ kind: 'auto', chatId: c.id }); autoEnd('switched'); return true; }
    return false;
  };
  S2H.jobStop = (job) => {
    if (!job.group) return false;
    clearInterval(job.timer); const c = chatById(job.chatId); const m = job.m; const raw = job.full.slice(0, job.pos); m.alts[m.idx] = { en: raw, ko: raw };
    const r = R.round; const g = groupOf(c); if (r) { const rest = remainingAfter(r, g).filter((id) => canSpeak(g, id)); ensureG(c).notice = { kind: 'stopped', a: m.saying, skipped: rest }; R.round = null; }
    Y.S2.job = null; Y.updateBlock(); Y.renderGenStrip(); Y.refreshAllSide(); X.toast(X.t('stopHint')); return true;
  };
  S2H.stripText = (st, c) => {
    if (!groupOf(c)) return null; const job = Y.S2.job;
    if (st.kind === 'writing' && job && job.group) {
      const nm = Y.stripName(c); const who = gName(groupOf(c), job.member);
      const status = t3('stripMemberWriting', { name: who }); const shown = job.auto ? t3('stripMemberWritingAuto', { name: who }) + ' · ' + Y.t2('stripAutoSoon') : status;
      return [nm, '— ' + status + (job.auto ? ' · ' + Y.t2('stripAutoSoon') : ''), shown];
    }
    return null;
  };
  S2H.home = () => {                                                                // DD-060: leaving the chat for Home ends auto mode after the current reply
    if (!AU.on) return; autoEnd('away'); const r = R.round;
    if (r) { if (S.streaming && r.cur) r.afterCurrent = true; else endHeld(); }
  };
  S2H.homeBack = () => { if (!AU.homeHold) return; AU.homeHold = false; clearTimeout(AU.endT); AU.endT = setTimeout(() => { AU.ended = null; renderStrip3(); }, 6000); };     // N4: the reason is shown for 6 s from the first return
  S2H.show = (c) => { renderStrip3(); renderExtras3(c); if (c.startPanel && !(c.msgs || []).length) renderStart(c); };
  S2H.newChat = (c, ch) => { if (!ch.g) return; ensureG(c); c.persona = 2; c.startPanel = hasFirst(ch.g); };
  S2H.newMenu = () => [['users', t3('createGroup'), () => { X.closeSheet(false); setTimeout(() => openCreate('create', $('#s2NMenu')), 0); }]];
  const prevEnd = S.hooks.streamEnd; S.hooks.streamEnd = (m, stopped) => { if (prevEnd) prevEnd(m, stopped); onStreamEnd(m, stopped); };
  const prevLang = S.hooks.lang; S.hooks.lang = () => { if (prevLang) prevLang(); const k = cg(); renderStrip3(); renderDemo3(); if (k) { X.refreshAll(); renderExtras3(k.c); } };
}

/* ------------------------------------------------------------------ auto mode (DD-055) */
function eligible(g) { return g.members.some((id) => canSpeak(g, id)); }
function autoStart() {
  const k = cg(); if (!k) return; if (!eligible(k.g)) { X.toast(t3('autoNoSpeaker')); renderStrip3(); return; }
  commitStart(k.c);
  AU.on = true; AU.paused = false; AU.round = 0; AU.ended = null; clearTimeout(AU.timer); clearTimeout(AU.endT);
  renderStrip3(); if (!R.round && !S.streaming) startRound({ text: '' }); else AU.round = 1;
  renderStrip3();
}
function nextName() { const k = cg(); if (!k) return ''; const r = R.round; if (r) { const id = r.list.slice(r.cur ? r.i + 1 : r.i).find((x) => canSpeak(k.g, x)) || r.list.find((x) => canSpeak(k.g, x)); return gName(k.g, id); } const id = k.c.g.queue[0] || k.g.members.find((x) => canSpeak(k.g, x)); return gName(k.g, id); }
function autoPause() { AU.paused = true; renderStrip3(); X.announce(t3('autoPaused', { n: AU.round })); }
function autoResume() { AU.paused = false; clearTimeout(AU.timer); $$('.s3-pending, .s3-pausednote').forEach((e) => e.remove()); const r = R.round; if (r && r.held) runNext(); else if (!R.round && !S.streaming) startRound({ text: '' }); renderStrip3(); }
// DD-061: the bar's Stop is the composer's Stop (cut the reply now, standard skipped notice with resume) and it ends auto mode
function autoStop() {
  if (S.streaming && R.round && R.round.cur) { X.stopStream(); }
  else if (R.round) { endHeld(); autoEnd('user'); }
  else autoEnd('user');
  renderStrip3(); X.syncSend();
}
function autoEnd(reason, name) {
  const wasOn = AU.on; AU.homeHold = reason === 'away'; AU.on = false; AU.paused = false; clearTimeout(AU.timer); AU.ended = { reason, name: name || '', at: Date.now() }; returnPending(); $$('.s3-pausednote').forEach((e) => e.remove());
  clearTimeout(AU.endT); const hold = Q3.get('keep') === '1' || AU.homeHold; if (!hold) AU.endT = setTimeout(function tick() { const b = $('#s3Strip'); if (b && b.contains(document.activeElement) && document.activeElement.closest('.s3-barrow')) { AU.endT = setTimeout(tick, 1500); return; } AU.ended = null; renderStrip3(); }, 6000);
  if (wasOn) { X.announce(t3('autoEnded', { reason: reasonText(AU.ended) })); renderStrip3(); X.syncSend(); }
}
const reasonText = (e) => t3({ user: 'autoReasonUser', error: 'autoReasonError', quiet: 'autoReasonQuiet', switched: 'autoReasonSwitched', away: 'autoReasonAway' }[e.reason], { name: e.name });
function autoAfterRound() {
  if (S3.quietAfter && AU.round >= 2) { autoEnd('quiet'); return; }
  const k = cg(); if (!k || !eligible(k.g)) { autoEnd('quiet'); return; }
  if (AU.paused) { renderStrip3(); return; }
  clearTimeout(AU.timer); AU.timer = setTimeout(() => { if (AU.on && !AU.paused && !R.round && !S.streaming && cg()) startRound({ text: '' }); }, Math.round(700 / S3.speed));
}

/* ------------------------------------------------------------------ member strip (DD-051) */
const stripEl = () => $('#s3Strip');
function memberStates(k, id) {
  const { c, g } = k; const s = g.st[id]; const r = R.round && R.round.chatId === c.id ? R.round : null; const out = []; let num = 0;
  if (s.missing) out.push('missing'); else if (!s.active) out.push('muted');
  const qi = c.g.queue.indexOf(id); if (qi >= 0) { out.push('next'); num = qi + 1; }
  if (r) { const cur = r.cur && r.cur.saying === id && S.streaming; if (cur) out.push('speaking'); else if (r.list.indexOf(id) > (r.cur ? r.i : r.i - 1) && canSpeak(g, id)) out.push('waiting'); }
  if (!r && c.g.notice && c.g.notice.skipped.includes(id)) out.push('skipped');          // DD-063: skipped members stay marked until the next round
  return { out, num };
}
function memberAria(k, id, st) {
  const { g } = k; const parts = [gName(g, id)];
  if (st.out.includes('next')) parts.push(t3('stNext', { n: st.num })); if (st.out.includes('speaking')) parts.push(t3('stSpeaking')); if (st.out.includes('waiting')) parts.push(t3('stWaiting'));
  if (st.out.includes('skipped')) parts.push(t3('stSkipped')); if (st.out.includes('muted')) parts.push(t3('stMuted')); if (st.out.includes('missing')) parts.push(t3('stMissing'));
  return parts.join(', ');
}
function renderStrip3() {
  const el = stripEl(); if (!el) return; const k = cg();
  if (!k) { el.hidden = true; el.replaceChildren(); layoutSoon(); return; }
  const { c, g } = k; const hadEl = el.contains(document.activeElement) ? document.activeElement : null; const had = hadEl ? (hadEl.dataset.m || hadEl.id || hadEl.dataset.lead || '') : '';
  const keepTab = $('[tabindex="0"]', el); const keepId = keepTab ? (keepTab.dataset.m || keepTab.id || '') : '';
  const opKey = X.Sh.open && X.Sh.opener && el.contains(X.Sh.opener) ? (X.Sh.opener.dataset.m || X.Sh.opener.id) : '';   // a sheet opened from the strip keeps a live opener across re-renders
  el.hidden = false; el.setAttribute('aria-label', t3('membersLabel'));
  const nameN = S.lang === 'ko' ? 4 : 7; const wasBar = el.dataset.bar || '';
  // the run bar is its own row above the members (M1): the members row keeps its full width, nothing is covered
  let bar = ''; let mini = '';
  if (AU.on && S.kb) {                                                                  // N3: keyboard open: icon + round number + Pause + Stop inside the 36 dp row, no separate bar
    const paused = AU.paused; const full = paused ? t3('autoPausedNext', { n: AU.round, name: nextName() }) : t3('autoRunning', { n: Math.max(1, AU.round), name: nextName() });
    mini = `<div class="s3-barmini" id="s3Bar" role="group" aria-label="${esc(full)}"><span class="s3-bar-ic" aria-hidden="true">${icon('repeat', 16)}</span><span class="s3-bar-t s3-bar-n" title="${esc(full)}">${Math.max(1, AU.round)}</span>` +
      `<button type="button" class="btn s3-bb" id="s3Pause" tabindex="-1" data-lead="pause" aria-label="${esc(t3(paused ? 'autoResume' : 'autoPause'))}" title="${esc(t3(paused ? 'autoResume' : 'autoPause'))}">${icon(paused ? 'play' : 'pause', 18)}</button>` +
      `<button type="button" class="btn s3-bb s3-bstop" id="s3Stop" tabindex="-1" data-lead="stop" aria-label="${esc(t3('autoStop'))}" title="${esc(t3('autoStop'))}">${icon('square', 16)}</button></div><span class="s3-sep" aria-hidden="true"></span>`;
  } else if (AU.on) {
    const paused = AU.paused; const txt = paused ? t3('autoPausedNext', { n: AU.round, name: nextName() }) : t3('autoRunning', { n: Math.max(1, AU.round), name: nextName() });
    bar = `<div class="s3-barrow" id="s3Bar" role="group" aria-label="${esc(t3('autoOn'))}"><span class="s3-bar-ic" aria-hidden="true">${icon('repeat', 18)}</span><span class="s3-bar-t">${esc(txt)}</span>` +
      `<button type="button" class="btn s3-bb" id="s3Pause" tabindex="-1" data-lead="pause" aria-label="${esc(t3(paused ? 'autoResume' : 'autoPause'))}" title="${esc(t3(paused ? 'autoResume' : 'autoPause'))}">${icon(paused ? 'play' : 'pause', 20)}</button>` +
      `<span class="s3-bgap" aria-hidden="true"></span>` +
      `<button type="button" class="btn s3-bb s3-bstop" id="s3Stop" tabindex="-1" data-lead="stop" aria-label="${esc(t3('autoStop'))}" title="${esc(t3('autoStop'))}">${icon('square', 18)}</button></div>`;
  } else if (AU.ended) {
    bar = `<div class="s3-barrow ended" id="s3Bar" role="status"><span class="s3-bar-ic" aria-hidden="true">${icon('circle-alert', 16)}</span><span class="s3-bar-t">${esc(t3('autoEnded', { reason: reasonText(AU.ended) }))}</span></div>`;
  }
  const lead = AU.on ? mini : `<button type="button" class="btn s3-auto" id="s3Auto" data-lead="auto" role="switch" aria-checked="false" aria-label="${esc(t3('autoOn'))}" title="${esc(t3('autoOn'))}">${icon('repeat', 18)}<span>${esc(t3('autoSwitch'))}</span></button><span class="s3-sep" aria-hidden="true"></span>`;
  const mem = g.members.map((id, n) => {
    const st = memberStates(k, id); const s = st.out; const nm = gName(g, id); const mm = MEM[id]; const missing = s.includes('missing'); const shown = missing ? t3('missingShort') : nm;
    const badge = s.includes('next') ? `<span class="s3-badge b-next">${st.num}</span>` : s.includes('muted') ? `<span class="s3-badge b-mute">${icon('volume-x', 12)}</span>` : missing ? `<span class="s3-badge b-miss">${icon('triangle-alert', 12)}</span>` : s.includes('speaking') ? `<span class="s3-badge b-spk">…</span>` : s.includes('skipped') ? `<span class="s3-badge b-skip">${icon('skip-forward', 11)}</span>` : '';
    const short = [...shown].length > nameN ? [...shown].slice(0, nameN).join('') + '…' : shown;
    return `<button type="button" class="btn s3-m ${memColor(g, id)}" data-m="${id}" data-st="${s.join(' ')}" tabindex="-1" aria-label="${esc(memberAria(k, id, st))}" aria-pressed="${s.includes('next')}" ${n < 9 ? `aria-keyshortcuts="Alt+${n + 1}"` : ''} title="${esc(n < 9 ? t3('shortcutTitle', { name: nm, n: n + 1 }) : nm)}">` +
      `<span class="s3-av"><span class="s3-ring" aria-hidden="true"></span><span class="avatar hue-${mm ? mm.hue : 'violet'}${missing ? ' missing' : ''}" aria-hidden="true">${esc(missing ? '?' : [...nm][0])}</span>${badge}${s.includes('waiting') ? '<span class="s3-wdot" aria-hidden="true"></span>' : ''}</span>` +
      `<span class="s3-nm">${esc(short)}</span></button>`;
  }).join('');
  el.innerHTML = bar + `<div class="s3-row" id="s3Row">` + lead + mem + `<button type="button" class="btn s3-more" id="s3More" data-lead="more" tabindex="-1" aria-haspopup="dialog" aria-label="${esc(t3('moreMembers'))}" title="${esc(t3('moreMembers'))}">${icon('ellipsis-vertical', 20)}</button></div>`;
  el.dataset.bar = AU.on ? 'run' : AU.ended ? 'end' : '';
  const items = $$('button', el); let tab = items.find((b) => (b.dataset.m || b.id) === keepId) || items.find((b) => b.dataset.lead && b.dataset.lead !== 'more') || items[0]; if (tab) tab.tabIndex = 0;
  if (had) { const f = items.find((b) => (b.dataset.m || b.id || b.dataset.lead) === had) || (/^s3(Pause|Stop)$/.test(had) ? $('#s3Auto', el) : null) || tab; if (f) f.focus({ preventScroll: true }); }
  if (el.dataset.bar === 'run' && !S.lp) {                                          // the bar fades/slides in once; quick re-renders keep the same animation running (negative delay)
    if (wasBar !== 'run') S3.barAt = performance.now(); const el2 = $('#s3Bar', el); const dt = performance.now() - (S3.barAt || 0);
    if (el2 && dt < 600) { el2.classList.add('enter'); el2.style.animationDelay = `-${Math.round(dt)}ms`; }
  }
  if (opKey) { const no = items.find((b) => (b.dataset.m || b.id) === opKey); if (no) X.Sh.opener = no; }
  X.syncSend(); layoutSoon();
}
let lay = 0; function layoutSoon() { cancelAnimationFrame(lay); lay = requestAnimationFrame(() => { try { X.layout(); } catch (_) {} }); }
function toggleQueue(id) {
  const k = cg(); if (!k) return; const { c, g } = k; const s = g.st[id];
  if (s.missing) { X.toast(t3('missingCantQueue', { name: gName(g, id) })); return; }
  if (!s.active) { X.announce(t3('mutedCantQueue', { name: gName(g, id) })); openMemberMenu(id, $(`.s3-m[data-m="${id}"]`)); return; }     // a muted member: the menu says why and offers Rejoin
  const q = c.g.queue; const i = q.indexOf(id); if (i >= 0) q.splice(i, 1); else q.push(id);
  if (i < 0 && q.length === 1 && !S3.tip) { S3.tip = true; let seen = false; try { seen = localStorage.getItem('s3tip') === '1'; localStorage.setItem('s3tip', '1'); } catch (_) {} if (!seen) X.toast(t3('queueTip')); }
  renderStrip3(); X.syncSend(); X.announce(i >= 0 ? gName(g, id) : t3('stNext', { n: q.length }) + ', ' + gName(g, id));
}
function stripEvents() {
  X.thread().addEventListener('click', (e) => { const b = e.target.closest('.newbtn.s3-refused'); if (b) X.toast(t3('regenOnlyGreetings')); }, true);   // a refused New reply still says why when pressed
  const el = stripEl(); let lp = 0, lpFired = false;
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || !el.contains(b)) return;
    if (lpFired) { lpFired = false; return; }
    if (b.dataset.m) { toggleQueue(b.dataset.m); return; }
    const d = b.dataset.lead; if (d === 'auto') autoStart(); else if (d === 'pause') (AU.paused ? autoResume() : autoPause()); else if (d === 'stop') autoStop(); else if (d === 'more') openPanelSheet(b);
  });
  el.addEventListener('contextmenu', (e) => { const b = e.target.closest('.s3-m'); if (!b) return; e.preventDefault(); openMemberMenu(b.dataset.m, b); });
  el.addEventListener('pointerdown', (e) => { const b = e.target.closest('.s3-m'); if (!b || e.pointerType === 'mouse') return; lpFired = false; clearTimeout(lp); lp = setTimeout(() => { lpFired = true; openMemberMenu(b.dataset.m, b); setTimeout(() => { lpFired = false; }, 700); }, 500); });
  ['pointerup', 'pointercancel', 'pointermove'].forEach((n) => el.addEventListener(n, (e) => { if (n === 'pointermove' && Math.hypot(e.movementX, e.movementY) < 3) return; clearTimeout(lp); }));
  el.addEventListener('keydown', (e) => {
    const items = $$('button', el).filter((b) => b.getAttribute('aria-disabled') !== 'true'); const i = items.indexOf(document.activeElement); if (i < 0) return;
    const go = (n) => { e.preventDefault(); items.forEach((b) => (b.tabIndex = -1)); n.tabIndex = 0; n.focus(); };
    if (e.key === 'ArrowRight') go(items[(i + 1) % items.length]); else if (e.key === 'ArrowLeft') go(items[(i - 1 + items.length) % items.length]);
    else if (e.key === 'Home') go(items[0]); else if (e.key === 'End') go(items[items.length - 1]);
    else if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') { const b = document.activeElement; if (b.dataset.m) { e.preventDefault(); openMemberMenu(b.dataset.m, b); } }
  });
}
function installKeys() {
  addEventListener('keydown', (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.isComposing) return; const m = /^Digit([1-9])$/.exec(e.code || ''); if (!m) return;
    const k = cg(); if (!k || X.Sh.open || Y.S2.home || (!S.desktop && S.sbOpen)) return; const tg = e.target;
    if (tg && (tg.tagName === 'TEXTAREA' || tg.tagName === 'SELECT' || (tg.tagName === 'INPUT' && /^(text|search|)$/.test(tg.type)) || tg.isContentEditable)) return;
    const id = k.g.members[Number(m[1]) - 1]; if (!id) return; e.preventDefault(); toggleQueue(id);
  }, true);
}

/* ------------------------------------------------------------------ member menu, talkativeness, remove with undo */
function talkSeg(g, id, onChange) {
  const el = document.createElement('div'); el.className = 's3-talk'; el.innerHTML = `<div class="s3-seg" role="radiogroup" aria-label="${esc(t3('talkativeness') + ': ' + gName(g, id))}"></div><div class="s3-talk-ends" aria-hidden="true"><span>${esc(t3('talkLess'))}</span><span>${esc(t3('talkMore'))}</span></div>`;
  const seg = $('.s3-seg', el);
  for (let n = 1; n <= 6; n++) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn s3-step'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(g.st[id].talk === n)); b.setAttribute('aria-label', t3('talkOf', { n })); b.textContent = String(n); b.tabIndex = g.st[id].talk === n ? 0 : -1; b.dataset.n = n;
    b.addEventListener('click', () => { g.st[id].talk = n; $$('.s3-step', seg).forEach((x) => { const on = Number(x.dataset.n) === n; x.setAttribute('aria-checked', String(on)); x.tabIndex = on ? 0 : -1; }); X.announce(t3('talkativeness') + ' ' + n + ' / 6'); if (onChange) onChange(n); });
    b.addEventListener('keydown', (e) => { if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return; e.preventDefault(); const nn = Math.min(6, Math.max(1, g.st[id].talk + (e.key === 'ArrowRight' ? 1 : -1))); const nb = $(`.s3-step[data-n="${nn}"]`, seg); nb.click(); nb.focus(); });
    seg.appendChild(b); }
  return el;
}
function removeMember(c, g, id, host) {
  if (g.members.length <= 1) { X.toast(t3('lastMemberRefuse')); return false; }       // DD-065: the last member cannot be removed
  const idx = g.members.indexOf(id); if (idx < 0) return false; const st = g.st[id]; g.members.splice(idx, 1); c.g.queue = c.g.queue.filter((x) => x !== id);
  S3.undo = { chatId: c.id, id, idx, st };
  renderStrip3(); X.syncSend(); showUndo3(t3('removedMember', { name: gName2(st, id) }), () => { const u = S3.undo; if (!u) return; g.members.splice(Math.min(u.idx, g.members.length), 0, u.id); g.st[u.id] = u.st; S3.undo = null; renderStrip3(); refreshPanel(); }, host);
  return true;
}
function removeItem(c, g, id, cls, label, after) {
  const last = g.members.length <= 1; const it = X.item('user-x', label, () => { X.closeSheet(); removeMember(c, g, id); if (after) after(); }, cls);
  if (last) { it.setAttribute('aria-disabled', 'true'); it.title = t3('lastMemberRefuse'); it.setAttribute('aria-description', t3('lastMemberRefuse')); it.addEventListener('click', () => X.toast(t3('lastMemberRefuse'))); }
  if (last) it.dataset.why = t3('lastMemberRefuse');
  return it;
}
const gName2 = (st, id) => (st && st.missing ? t3('missingMember') : mName(id));
let undoT = 0;
function showUndo3(text, onUndo, host) {
  clearTimeout(undoT); $$('.s3-undo').forEach((e) => e.remove());
  const row = document.createElement('div'); row.className = 's3-undo undo-row'; row.setAttribute('role', 'status'); row.tabIndex = -1;
  row.innerHTML = `<span class="undo-text">${esc(text)}</span><button type="button" class="btn undo-btn" aria-label="${esc(t3('undoRemove'))}">${X.ic('undo-2', 18)}<span>${esc(t3('undoRemove'))}</span></button>`;
  $('.undo-btn', row).addEventListener('click', () => { clearTimeout(undoT); row.remove(); onUndo(); });
  let hold = 0; const arm = () => { clearTimeout(undoT); undoT = setTimeout(() => { if (hold) { arm(); return; } row.remove(); S3.undo = null; }, 6000); };
  row.addEventListener('pointerenter', () => hold++); row.addEventListener('pointerleave', () => { hold = Math.max(0, hold - 1); }); row.addEventListener('focusin', () => hold++); row.addEventListener('focusout', () => { hold = Math.max(0, hold - 1); });
  (host || X.thread()).appendChild(row); arm(); X.announce(text);
}
function openMemberMenu(id, opener) {
  const k = cg(); if (!k) return; const { c, g } = k; const s = g.st[id]; const nm = gName(g, id);
  X.openSheet({ title: nm, opener, build(body) {
    body.setAttribute('role', 'group'); body.setAttribute('aria-label', t3('memberMenu'));
    if (s.missing) {
      const p = document.createElement('p'); p.className = 'confirm-text'; p.textContent = t3('missingCantQueue', { name: nm }); body.appendChild(p);
      body.appendChild(removeItem(c, g, id, 'danger dangerous', t3('removeMissing'))); body.lastChild.setAttribute('data-autofocus', ''); return;
    }
    const q = c.g.queue.includes(id);
    const a = X.item('chevron-right', q ? t3('speakNext') + ' ✓' : t3('speakNext'), () => { X.closeSheet(); toggleQueue(id); }, '', { 'data-autofocus': '' }); if (!s.active) { a.setAttribute('aria-disabled', 'true'); a.title = t3('mutedCantQueue', { name: nm }); a.onclick = (e) => { e.stopImmediatePropagation(); X.toast(a.title); }; } body.appendChild(a);
    body.appendChild(X.item(s.active ? 'volume-x' : 'users', s.active ? t3('muteMember') : t3('unmuteMember'), () => { s.active = !s.active; if (!s.active) c.g.queue = c.g.queue.filter((x) => x !== id); X.closeSheet(); renderStrip3(); X.syncSend(); X.announce(nm + ', ' + (s.active ? t3('unmuteMember') : t3('stMuted'))); }, ''));
    const tw = document.createElement('div'); tw.className = 's3-mm-talk';
    if (g.orderMode === 'list') { const n = document.createElement('p'); n.className = 's3-note'; n.textContent = t3('listNoTalk'); tw.appendChild(n); } else { const l = document.createElement('div'); l.className = 's3-mm-l'; l.textContent = t3('talkativeness'); tw.appendChild(l); tw.appendChild(talkSeg(g, id)); }
    body.appendChild(tw);
    body.appendChild(X.item('user', t3('viewCharacter'), () => { X.closeSheet(); X.toast(X.t('simulated', { what: t3('viewCharacter') })); }, ''));
    { const ri = removeItem(c, g, id, 'danger', t3('removeFromGroup')); body.appendChild(ri); if (ri.dataset.why) { const w = document.createElement('p'); w.className = 's3-note s3-pexp-why'; w.textContent = ri.dataset.why; body.appendChild(w); } }
  } });
}

/* ------------------------------------------------------------------ member panel inside the "This chat" sheet (DD-050) */
let panelCtx = null;
function refreshPanel(focusSel) { if (!panelCtx || !panelCtx.wrap.isConnected) return; fillPanel(panelCtx.wrap, panelCtx.c, panelCtx.g, panelCtx.H, focusSel ? { focus: focusSel } : {}); }
function installPanel() {
  S2H.thisChat = (body, c, H) => {
    const g = groupOf(c); if (!g) return;
    const grp = H.grp(body, 'members', t3('membersGroup'), 'character'); const tag = $('.s2-scope span', grp); if (tag) tag.textContent = t3('scopeGroup'); grp.classList.add('s3-pgrp');
    const wrap = document.createElement('div'); wrap.className = 's3-panel'; grp.appendChild(wrap); panelCtx = { wrap, c, g, H, open: '' }; fillPanel(wrap, c, g, H);
  };
}
// members first, the group's name and picture last (the reason people open this sheet is the members)
function fillPanel(wrap, c, g, H, opts = {}) {
  wrap.replaceChildren(); if (panelCtx) panelCtx.open = opts.open || '';
  const ch = charById(c.charId);
  const om = document.createElement('div'); om.className = 's3-order'; om.innerHTML = `<div class="s3-ol" id="s3OL">${esc(t3('orderLabel'))}</div><div class="s3-segw" role="group" aria-labelledby="s3OL"><button type="button" class="btn" data-mode="random" aria-pressed="${g.orderMode === 'random'}">${esc(t3('orderRandom'))}</button><button type="button" class="btn" data-mode="list" aria-pressed="${g.orderMode === 'list'}">${esc(t3('orderList'))}</button></div><p class="s3-note">${esc(g.orderMode === 'random' ? t3('mentionHelp') : t3('listNoTalk'))}</p>`;
  $$('[data-mode]', om).forEach((b) => b.addEventListener('click', () => { g.orderMode = b.dataset.mode; fillPanel(wrap, c, g, H); const f = $(`[data-mode="${g.orderMode}"]`, wrap); if (f) f.focus(); X.announce(t3(g.orderMode === 'random' ? 'orderRandom' : 'orderList')); }));
  wrap.appendChild(om);
  const miss = g.members.filter((id) => g.st[id].missing); const rest = g.members.filter((id) => !g.st[id].missing);
  const list = document.createElement('div'); list.className = 's3-plist'; list.setAttribute('role', 'list'); list.setAttribute('aria-label', t3('membersLabel'));
  [...miss, ...rest].forEach((id) => list.appendChild(panelRow(wrap, c, g, H, id, opts)));
  wrap.appendChild(list);
  const add = H.btnRow(wrap, 'user-plus', t3('addMember'), '', () => openCreate('add', $('#s3AddBtn'))); add.id = 's3AddBtn';
  const np = document.createElement('div'); np.className = 's3-np';
  np.innerHTML = `<label class="s3-fl" for="s3GName">${esc(t3('groupName'))}</label><input id="s3GName" class="s3-input" type="text" value="${esc(L(ch.name))}" data-esc-leave><div class="s3-fl">${esc(t3('groupPicture'))}</div><div class="s3-picrow"><button type="button" class="btn s3-pic" data-pic="members">${icon('users', 18)}<span>${esc(t3('picFromMembers'))}</span></button><button type="button" class="btn s3-pic" data-pic="pick">${icon('image', 18)}<span>${esc(t3('picPick'))}</span></button></div>`;
  $('#s3GName', np).addEventListener('change', (e) => { const v = e.target.value.trim(); if (v) { ch.name = { en: v, ko: v }; Y.renderSidebar(); $('#hdrName').textContent = v; X.announce(t3('groupName') + ': ' + v); } else e.target.value = L(ch.name); });   // an empty name is not accepted
  $$('.s3-pic', np).forEach((b) => b.addEventListener('click', () => X.toast(X.t('simulated', { what: $('span', b).textContent }))));
  wrap.appendChild(np);
  if (opts.open && opts.focusKey) { const ex = $(`.s3-prow[data-m="${opts.open}"] .s3-pexp`, wrap); if (ex) { let f = $(`[data-k="${opts.focusKey}"]`, ex); if (!f || f.getAttribute('aria-disabled') === 'true') f = $('.s3-pexp-b:not([aria-disabled="true"])', ex); if (f) f.focus({ preventScroll: true }); } }
  if (opts.focus) { const f = $(opts.focus, wrap); if (f) f.focus({ preventScroll: true }); }
}
function panelRow(wrap, c, g, H, id, opts) {
  const s = g.st[id]; const nm = gName(g, id); const mm = MEM[id]; const missing = s.missing;
  const row = document.createElement('div'); row.className = 's3-prow' + (missing ? ' missing' : '') + (!s.active && !missing ? ' muted' : ''); row.dataset.m = id; row.setAttribute('role', 'listitem');
  const sub = missing ? '' : (g.orderMode === 'random' ? `<span class="s3-pval">${esc(t3('talkValue', { n: s.talk }))}</span>` : '');
  row.innerHTML = (missing ? '<span class="s3-grip-sp"></span>' : `<button type="button" class="btn s3-grip" aria-label="${esc(t3('reorderLabel', { name: nm }))}" title="${esc(t3('reorderLabel', { name: nm }))}" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown">${icon('grip-vertical', 20)}</button>`) +
    `<span class="avatar hue-${mm ? mm.hue : 'violet'}${missing ? ' missing' : ''}" aria-hidden="true">${esc(missing ? '?' : [...nm][0])}</span><div class="s3-pmain"><div class="s3-pnl"><span class="s3-pname ${memColor(g, id)}">${esc(nm)}</span>${!s.active && !missing ? `<span class="s3-tag">${esc(t3('sittingOutTag'))}</span>` : ''}</div><div class="s3-psub">${sub}</div></div>` +
    (missing ? `<button type="button" class="btn s3-miss-btn" data-act="remove">${icon('user-x', 18)}<span>${esc(t3('removeMissing'))}</span></button>`
      : `<label class="sw s3-psw"><input type="checkbox" role="switch" ${s.active ? 'checked' : ''} aria-label="${esc(nm + ': ' + t3('partLabel'))}"><span class="sw-ui"></span><span class="s3-sw-t">${esc(s.active ? t3('partLabel') : t3('sittingOutTag'))}</span></label><button type="button" class="btn s3-pmore" data-act="more" aria-expanded="false" aria-label="${esc(t3('memberMenu') + ': ' + nm)}" title="${esc(t3('memberMenu') + ': ' + nm)}">${icon('ellipsis-vertical', 20)}</button>`);
  const undoHost = () => wrap.parentElement;
  if (!missing) {
    const sw = $('input', row); sw.addEventListener('change', () => { s.active = sw.checked; if (!s.active) c.g.queue = c.g.queue.filter((x) => x !== id); row.classList.toggle('muted', !s.active); $('.s3-sw-t', row).textContent = s.active ? t3('partLabel') : t3('sittingOutTag'); renderStrip3(); X.syncSend(); X.announce(nm + ', ' + (s.active ? t3('unmuteMember') : t3('stMuted'))); fillPanel(wrap, c, g, H, { focus: `.s3-prow[data-m="${id}"] .s3-psw input` }); });
    const more = $('[data-act="more"]', row);
    const openExp = (focusSel) => {
      let ex = $('.s3-pexp', row); if (ex) return ex;
      ex = document.createElement('div'); ex.className = 's3-pexp'; more.setAttribute('aria-expanded', 'true');
      if (g.orderMode === 'random') { const tw = document.createElement('div'); tw.className = 's3-pexp-talk'; tw.innerHTML = `<div class="s3-fl">${esc(t3('talkEdit'))}</div>`; tw.appendChild(talkSeg(g, id, (n) => { const v = $('.s3-pval', row); if (v) v.textContent = t3('talkValue', { n }); })); ex.appendChild(tw); }
      const mk = (ico, label, fn, cls, key) => { const x = document.createElement('button'); x.type = 'button'; x.className = 'btn s3-pexp-b' + (cls ? ' ' + cls : ''); if (key) x.dataset.k = key; x.innerHTML = icon(ico, 18) + '<span>' + esc(label) + '</span>'; x.addEventListener('click', fn); ex.appendChild(x); return x; };
      mk('user', t3('viewCharacter'), () => X.toast(X.t('simulated', { what: t3('viewCharacter') })));
      const rest = g.members.filter((x) => !g.st[x].missing); const pos = rest.indexOf(id);
      const up = mk('arrow-up', t3('moveUp'), () => { if (pos > 0) moveMember(wrap, c, g, H, id, -1, 'up'); }, '', 'up'); const dn = mk('arrow-down', t3('moveDown'), () => { if (pos < rest.length - 1) moveMember(wrap, c, g, H, id, 1, 'down'); }, '', 'down');
      if (pos <= 0) up.setAttribute('aria-disabled', 'true'); if (pos >= rest.length - 1) dn.setAttribute('aria-disabled', 'true');
      const last = g.members.length <= 1;
      const rm = mk('user-x', t3('removeFromGroup'), () => { if (last) { X.toast(t3('lastMemberRefuse')); return; } removeMember(c, g, id, undoHost()); fillPanel(wrap, c, g, H); }, 'danger', 'remove');
      if (last) { rm.setAttribute('aria-disabled', 'true'); rm.title = t3('lastMemberRefuse'); rm.setAttribute('aria-description', t3('lastMemberRefuse')); const why = document.createElement('p'); why.className = 's3-note s3-pexp-why'; why.textContent = t3('lastMemberRefuse'); ex.appendChild(why); }
      row.appendChild(ex); if (focusSel) { const f = $(focusSel, ex); if (f && f.getAttribute('aria-disabled') !== 'true') f.focus({ preventScroll: true }); else { const o = $('.s3-pexp-b:not([aria-disabled="true"])', ex); if (o) o.focus({ preventScroll: true }); } }
      return ex;
    };
    more.addEventListener('click', () => { const ex = $('.s3-pexp', row); if (ex) { ex.remove(); more.setAttribute('aria-expanded', 'false'); return; } openExp('.s3-pexp-b'); });
    if (opts.open === id) openExp(null);
    const grip = $('.s3-grip', row);
    grip.addEventListener('keydown', (e) => { if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return; e.preventDefault(); moveMember(wrap, c, g, H, id, e.key === 'ArrowUp' ? -1 : 1); });
    grip.addEventListener('pointerdown', (e) => gripDrag(e, wrap, c, g, H, id, row));
  } else $('[data-act="remove"]', row).addEventListener('click', () => { if (g.members.length <= 1) { X.toast(t3('lastMemberRefuse')); return; } removeMember(c, g, id, undoHost()); fillPanel(wrap, c, g, H); });
  return row;
}
function moveMember(wrap, c, g, H, id, d, via) {
  const rest = g.members.filter((x) => !g.st[x].missing); const i = rest.indexOf(id); const j = i + d; if (j < 0 || j >= rest.length) { X.toast(t3('reorderMoved', { name: gName(g, id), n: i + 1 })); return; }
  const other = rest[j]; const a = g.members.indexOf(id), b = g.members.indexOf(other); g.members[a] = other; g.members[b] = id;
  if (via) fillPanel(wrap, c, g, H, { open: id, focusKey: via }); else fillPanel(wrap, c, g, H, { focus: `.s3-prow[data-m="${id}"] .s3-grip` });
  renderStrip3(); X.announce(t3('reorderMoved', { name: gName(g, id), n: j + 1 }));
}
function gripDrag(e, wrap, c, g, H, id, row) {
  if (e.button !== undefined && e.button > 0) return; e.preventDefault(); const y0 = e.clientY; const h = row.getBoundingClientRect().height; row.classList.add('dragging'); const grip = e.currentTarget; try { grip.setPointerCapture(e.pointerId); } catch (_) {}
  const move = (ev) => { row.style.transform = `translate3d(0,${ev.clientY - y0}px,0)`; };
  const up = (ev) => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up); row.classList.remove('dragging'); row.style.transform = ''; const steps = Math.round((ev.clientY - y0) / h); if (ev.type === 'pointerup' && steps) { const dir = steps > 0 ? 1 : -1; for (let i = 0; i < Math.abs(steps); i++) moveMember(wrap, c, g, H, id, dir); } };
  grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
}
function openPanelSheet(opener) { Y.openThisChat(opener); setTimeout(() => { const h = $('#s2g-members'); if (h) { h.scrollIntoView({ block: 'start' }); const f = $('.s3-prow button, .s3-panel button', h.parentElement); } }, 80); }

/* ------------------------------------------------------------------ create sheet and member picker (DD-056, spec 7.1) */
const autoName = (ids, lang) => { const ns = ids.map((i) => (MEM[i].name[lang] || MEM[i].name.en)); if (ns.length <= 3) return ns.join(', '); const f = S3I[lang].groupNameMore; return f.replace('{a}', ns[0]).replace('{b}', ns[1]).replace('{n}', ns.length - 2); };
function openCreate(mode, opener, init) {
  const k = cg(); const add = mode === 'add'; const g0 = add && k ? k.g : null;
  const st = Object.assign({ sel: [], q: '', name: '', edited: false, order: 'random', withFirst: false, chipMenu: '' }, init || {});
  const avail = LIB.filter((id) => !g0 || !g0.members.includes(id));
  const nameNow = () => ((st.edited && st.name.trim()) ? st.name : autoName(st.sel, S.lang));
  const cls = S.desktop ? 'panel s3wide' : 's2tall s3create'; const title = add ? t3('addMember') : t3('createGroup');
  const cr = S3.cr = { st, add, mode: 'edit', force: false };
  const syncBack = () => setTimeout(() => {                                          // Back and Esc follow the same rule as Cancel (M7)
    if (S3.cr !== cr) return;
    if (cr.mode === 'ask') Y.S2.sheetBack = { fn: cr.keep, at: X.Sh.at };
    else if (add) Y.S2.sheetBack = { fn: () => { if (st.sel.length) cr.ask(); else { S3.cr = null; Y.openThisChat($('#moreBtn')); } }, at: X.Sh.at };
    else Y.S2.sheetBack = st.sel.length ? { fn: cr.ask, at: X.Sh.at } : null;
  }, 0);
  const build = (body) => {
    body.replaceChildren(); body.className = 'sheet-body s3-create'; body.setAttribute('role', 'group');
    const sBox = document.createElement('div'); sBox.className = 's3-csearch'; sBox.innerHTML = `<span class="s2-search-ic" aria-hidden="true">${Y.ic2('search', 18)}</span><input type="search" id="s3CSearch" autocomplete="off" spellcheck="false" placeholder="${esc(t3('pickerSearch'))}" aria-label="${esc(t3('pickerSearch'))}" value="${esc(st.q)}" data-esc-leave>`; body.appendChild(sBox);
    const chips = document.createElement('div'); chips.className = 's3-chips'; chips.id = 's3Chips'; chips.setAttribute('role', 'list'); chips.setAttribute('aria-label', t3('chosen')); body.appendChild(chips);
    const cmenu = document.createElement('div'); cmenu.className = 's3-chipmenu'; cmenu.id = 's3ChipMenu'; cmenu.hidden = true; body.appendChild(cmenu);
    const list = document.createElement('div'); list.className = 's3-clist'; list.setAttribute('role', 'group'); list.setAttribute('aria-label', t3('chooseChars')); body.appendChild(list);
    const foot = document.createElement('div'); foot.className = 's3-cfoot'; body.appendChild(foot);
    const act = document.createElement('div'); act.className = 's3-actions'; body.appendChild(act);
    const moveChip = (id, d, viaMenu) => { const i = st.sel.indexOf(id); const j = i + d; if (j < 0 || j >= st.sel.length) return; [st.sel[i], st.sel[j]] = [st.sel[j], st.sel[i]]; paint(); X.announce(t3('reorderMoved', { name: L(MEM[id].name), n: j + 1 })); const f = viaMenu ? ($(`.s3-chipmenu [data-k="${d < 0 ? 'earlier' : 'later'}"]`, body) && $(`.s3-chipmenu [data-k="${d < 0 ? 'earlier' : 'later'}"]`, body).getAttribute('aria-disabled') !== 'true' ? $(`.s3-chipmenu [data-k="${d < 0 ? 'earlier' : 'later'}"]`, body) : $('.s3-chipmenu .s3-pexp-b:not([aria-disabled="true"])', body)) : $(`.s3-chip[data-id="${id}"]`, chips); if (f) f.focus({ preventScroll: true }); };
    const paintChips = () => {
      chips.replaceChildren(); if (!st.sel.length) { const e = document.createElement('span'); e.className = 's3-chips-empty'; e.textContent = t3('noMembersYet'); chips.appendChild(e); }
      st.sel.forEach((id, i) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn s3-chip'; b.dataset.id = id; b.setAttribute('role', 'listitem'); b.setAttribute('aria-haspopup', 'true'); b.setAttribute('aria-expanded', String(st.chipMenu === id)); b.setAttribute('aria-label', `${L(MEM[id].name)}, ${i + 1} / ${st.sel.length}, ${t3('chipMenu', { name: L(MEM[id].name) })}`); b.title = t3('chipMenu', { name: L(MEM[id].name) });
        b.innerHTML = `<span class="avatar hue-${MEM[id].hue}" aria-hidden="true">${esc([...L(MEM[id].name)][0])}</span><span>${esc(L(MEM[id].name))}</span>${X.ic('chevron-down', 14)}`;
        b.addEventListener('click', () => { st.chipMenu = st.chipMenu === id ? '' : id; paint(); const f = st.chipMenu ? $('.s3-chipmenu .s3-pexp-b', body) : $(`.s3-chip[data-id="${id}"]`, chips); if (f) f.focus({ preventScroll: true }); });
        b.addEventListener('keydown', (e) => { if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); moveChip(id, e.key === 'ArrowLeft' ? -1 : 1, false); } });
        chips.appendChild(b); });
      cmenu.hidden = !st.chipMenu; cmenu.replaceChildren();
      if (st.chipMenu) {                                                                // a non-drag way to reorder or remove (WCAG 2.5.7)
        const id = st.chipMenu; const i = st.sel.indexOf(id); cmenu.setAttribute('role', 'group'); cmenu.setAttribute('aria-label', t3('chipMenu', { name: L(MEM[id].name) }));
        const mk = (ico, label, fn, key, dis, cls2) => { const x = document.createElement('button'); x.type = 'button'; x.className = 'btn s3-pexp-b' + (cls2 ? ' ' + cls2 : ''); x.dataset.k = key; x.innerHTML = icon(ico, 18) + '<span>' + esc(label) + '</span>'; if (dis) x.setAttribute('aria-disabled', 'true'); x.addEventListener('click', () => { if (dis) return; fn(); }); cmenu.appendChild(x); };
        mk('arrow-up', t3('chipEarlier'), () => moveChip(id, -1, true), 'earlier', i <= 0); mk('arrow-down', t3('chipLater'), () => moveChip(id, 1, true), 'later', i >= st.sel.length - 1);
        mk('x', t3('chipRemove'), () => { st.sel.splice(st.sel.indexOf(id), 1); st.chipMenu = ''; paint(); const f = $('#s3CSearch', body); if (f) f.focus({ preventScroll: true }); }, 'remove', false, 'danger');
      }
    };
    const paintList = () => {
      list.replaceChildren(); const q = st.q.trim(); const vis = avail.filter((id) => !q || Y.hmatch(MEM[id].name.en, q) || Y.hmatch(MEM[id].name.ko, q));
      vis.forEach((id) => { const on = st.sel.includes(id); const lab = document.createElement('label'); lab.className = 's3-pick' + (on ? ' on' : ''); lab.innerHTML = `<input type="checkbox" ${on ? 'checked' : ''} data-id="${id}"><span class="avatar hue-${MEM[id].hue}" aria-hidden="true">${esc([...L(MEM[id].name)][0])}</span><span class="s3-pick-n">${esc(L(MEM[id].name))}</span>`;
        $('input', lab).addEventListener('change', (e) => { if (e.target.checked) st.sel.push(id); else { st.sel.splice(st.sel.indexOf(id), 1); if (st.chipMenu === id) st.chipMenu = ''; } const keep = id; paint(); const f = $(`input[data-id="${keep}"]`, list); if (f) f.focus({ preventScroll: true }); }); list.appendChild(lab); });
      if (!vis.length) { const e = document.createElement('p'); e.className = 's3-note'; e.textContent = Y.t2('noResults') || ''; list.appendChild(e); }
    };
    const composite = () => { const ids = st.sel.slice(0, 3); return ids.length ? ids.map((id, n) => `<span class="avatar hue-${MEM[id].hue}" style="--n:${n}">${esc([...L(MEM[id].name)][0])}</span>`).join('') : `<span class="avatar hue-violet">${icon('users', 16)}</span>`; };
    const paintFoot = () => {
      foot.replaceChildren();
      if (!add) {
        const nmw = document.createElement('div'); nmw.className = 's3-cname'; nmw.innerHTML = `<label class="s3-fl" for="s3CName">${esc(t3('groupName'))}</label><input id="s3CName" class="s3-input" type="text" value="${esc(nameNow())}" data-esc-leave><p class="s3-note">${esc(st.edited && st.name.trim() ? '' : t3('nameAuto'))}</p>`;
        const inp = $('input', nmw); inp.addEventListener('input', (e) => { st.edited = true; st.name = e.target.value; $('.s3-note', nmw).textContent = ''; });
        inp.addEventListener('blur', () => { if (!inp.value.trim()) { st.edited = false; st.name = ''; paintFoot(); } });            // an empty name goes back to the automatic one
        foot.appendChild(nmw);
        const om = document.createElement('div'); om.className = 's3-order'; om.innerHTML = `<div class="s3-ol" id="s3COL">${esc(t3('orderLabel'))}</div><div class="s3-segw" role="group" aria-labelledby="s3COL"><button type="button" class="btn" data-mode="random" aria-pressed="${st.order === 'random'}">${esc(t3('orderRandom'))}</button><button type="button" class="btn" data-mode="list" aria-pressed="${st.order === 'list'}">${esc(t3('orderList'))}</button></div>`;
        $$('[data-mode]', om).forEach((b) => b.addEventListener('click', () => { st.order = b.dataset.mode; $$('[data-mode]', om).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); })); foot.appendChild(om);
        const pic = document.createElement('div'); pic.className = 's3-pict'; pic.innerHTML = `<div class="s3-fl" id="s3PicL">${esc(t3('groupPicture'))}</div><div class="s3-pictrow" role="group" aria-labelledby="s3PicL"><span class="s3-comp" aria-hidden="true">${composite()}</span><p class="s3-note">${esc(t3('groupPictureNote'))}</p></div>`; foot.appendChild(pic);
      } else {
        const wf = document.createElement('label'); wf.className = 'sw s3-wf'; wf.innerHTML = `<input type="checkbox" role="switch" ${st.withFirst ? 'checked' : ''}><span class="sw-ui"></span><span class="lbl">${esc(t3('addWithFirst'))}</span>`; $('input', wf).addEventListener('change', (e) => { st.withFirst = e.target.checked; }); foot.appendChild(wf);
      }
      act.replaceChildren(); const need = add ? 1 : 2; const ok = st.sel.length >= need;
      const why = document.createElement('p'); why.className = 's3-why'; why.id = 's3Why'; why.setAttribute('role', 'status'); why.textContent = ok ? '' : (add ? t3('noMembersYet') : t3('createNeedTwo'));
      const row = document.createElement('div'); row.className = 's3-crow';
      const go = document.createElement('button'); go.type = 'button'; go.className = 'btn solid s3-go'; go.id = 's3Go'; go.innerHTML = icon(add ? 'user-plus' : 'users', 18) + `<span>${esc(add ? t3('addMember') : t3('createGroup'))}</span>`; go.setAttribute('aria-disabled', String(!ok)); if (!ok) go.setAttribute('aria-describedby', 's3Why');
      go.addEventListener('click', () => { if (!ok) { X.toast(why.textContent); return; } if (add) doAdd(st); else doCreate(st, nameNow()); });
      const cn = document.createElement('button'); cn.type = 'button'; cn.className = 'btn s3-cancel'; cn.id = 's3Cancel'; cn.innerHTML = X.ic('x', 18) + `<span>${esc(t3('cancelBtn'))}</span>`; cn.addEventListener('click', () => { if (st.sel.length) cr.ask(); else { S3.cr = null; X.closeSheet(); if (add) Y.openThisChat($('#moreBtn')); } });
      row.append(go, cn); act.append(why, row);
    };
    const paint = () => { paintChips(); paintList(); paintFoot(); syncBack(); };
    $('#s3CSearch', body).addEventListener('input', (e) => { st.q = e.target.value; paintList(); });
    paint();
  };
  const confirmBuild = (body) => {
    body.replaceChildren(); body.className = 'sheet-body s3-ask'; X.markCritical(body); const p = document.createElement('p'); p.className = 'confirm-text'; p.textContent = t3('discardCreate'); body.appendChild(p);
    const row = document.createElement('div'); row.className = 'confirm-row';
    row.appendChild(X.item('chevron-left', t3('keepEditing'), () => cr.keep(), '', { 'data-autofocus': '' }));
    row.appendChild(X.item('trash-2', t3('discardBtn'), () => { cr.force = true; S3.cr = null; X.closeSheet(); if (add) setTimeout(() => Y.openThisChat($('#moreBtn')), 60); }, 'danger dangerous')); body.appendChild(row);
  };
  cr.ask = () => { cr.mode = 'ask'; X.swapSheet(t3('discardCreate'), confirmBuild, cls); syncBack(); };      // Cancel, Back, Esc, backdrop and drag-down all ask once
  cr.keep = () => { cr.mode = 'edit'; X.swapSheet(title, build, cls); syncBack(); };                            // Esc or Back on the question means "keep editing"
  if (X.Sh.open) X.swapSheet(title, build, cls); else X.openSheet({ title, opener: opener || document.activeElement, build, cls });
}
const installCreateGuard = () => { S.hooks.beforeClose = () => {
  const cr = S3.cr; if (!cr) return false; if (!document.querySelector('.s3-create, .s3-ask')) { S3.cr = null; return false; }     // stale: another sheet is open
  if (cr.force) return false; if (cr.mode === 'ask') { cr.keep(); return true; } if (cr.st.sel.length) { cr.ask(); return true; } S3.cr = null; return false;
}; };
function doAdd(st) {
  const k = cg(); if (!k) return; const { c, g } = k;
  st.sel.forEach((id) => { g.members.push(id); g.st[id] = { talk: 3, active: true, cold: !!MEM[id].cold, missing: false, slot: nextSlot(g) }; if (st.withFirst && MEM[id].first.length && Y.S2.chatId === c.id) { const m = gmsg(id, MEM[id].first); S.msgs.push(m); } });
  S3.cr && (S3.cr.force = true); S3.cr = null; X.closeSheet(); if (st.withFirst) X.renderTranscript(false); renderStrip3(); renderExtras3(c); X.toast(t3('addMember') + ': ' + st.sel.map(mName).join(', ')); setTimeout(() => Y.openThisChat($('#moreBtn')), 60);
}
function doCreate(st, name) {
  const id = 'g-new' + (++S3.createN); const nm = (name || '').trim() || autoName(st.sel, S.lang); const ch = makeGroup(id, { en: nm, ko: nm }, st.sel, st.order); if (!(st.edited && st.name.trim())) ch.name = { en: autoName(st.sel, 'en'), ko: autoName(st.sel, 'ko') };
  CHARS.push(ch); Y.S2.recent = [id, ...Y.S2.recent.filter((x) => x !== id)].slice(0, 5);
  const c = Y.mk(id, { id: 'c-g' + S3.createN, name: { en: 'New chat', ko: '새 채팅' }, age: 0, base: 0, last: { en: '', ko: '' }, msgs: [], built: 0, seen: true, persona: 2 }); c.g = { queue: [], notice: null, skips: [] }; c.startPanel = hasFirst(ch.g);
  CHATS.unshift(c); S3.cr && (S3.cr.force = true); S3.cr = null; X.closeSheet(false); Y.openChat(c.id, { force: true }); X.toast(t3('createdToast'));
}
/* ------------------------------------------------------------------ first messages of a new group chat (DD-057, spec 7.2) */
const hasFirst = (g) => !S3.noFirst && g.members.some((id) => !g.st[id].missing && MEM[id] && MEM[id].first.length);
const emph = (t) => esc(t).replace(/\*([^*]+)\*/g, '<em>$1</em>');
// the ticked first messages go in before anything else starts (a typed Send, a queued turn, One more round, Auto): they are never dropped (M9)
function commitStart(c) {
  if (!c || !c.startPanel || Y.S2.chatId !== c.id) return false; const g = groupOf(c); if (!g) return false;
  const rows = g.members.filter((id) => !g.st[id].missing && MEM[id] && MEM[id].first.length); const fails = (id) => S3.restoreFail && id === 'mira';
  const sp = c.sp || {}; const ms = rows.filter((id) => (sp[id] ? sp[id].on : g.st[id].active) && !fails(id)).map((id) => { const m = gmsg(id, MEM[id].first, { greeting: true }); m.idx = sp[id] ? sp[id].alt : 0; return m; });
  c.startPanel = false; c.sp = null; $$('.s3-start').forEach((e) => e.remove());
  if (ms.length) { ms.forEach((m) => S.msgs.push(m)); c.msgs = S.msgs; X.renderTranscript(false); renderExtras3(c); X.announce(t3('firstAdded', { n: ms.length })); }
  return true;
}
function renderStart(c) {
  const g = groupOf(c); if (!g) return; $$('.s3-start').forEach((e) => e.remove());
  const rows = g.members.filter((id) => !g.st[id].missing && MEM[id] && MEM[id].first.length);
  if (!rows.length) { c.startPanel = false; return; }
  c.sp = c.sp || {}; rows.forEach((id) => { c.sp[id] = c.sp[id] || { on: g.st[id].active, alt: 0 }; });                 // DD-062: a member who sits out starts unticked
  const box = document.createElement('section'); box.className = 's3-start'; box.setAttribute('aria-labelledby', 's3StartH');
  box.innerHTML = `<h2 id="s3StartH" class="s3-sh">${esc(t3('startTitle'))}</h2><div class="s3-srows" role="list"></div><div class="s3-sfoot"><button type="button" class="btn solid" id="s3StartGo">${icon('check', 18)}<span>${esc(t3('startChat'))}</span></button><button type="button" class="btn" id="s3StartEmpty">${icon('x', 18)}<span>${esc(t3('startEmpty'))}</span></button></div>`;
  const rw = $('.s3-srows', box);
  const fails = (id) => S3.restoreFail && id === 'mira';
  const paint = () => {
    rw.replaceChildren();
    rows.forEach((id) => {
      const sp = c.sp[id]; const mm = MEM[id]; const nm = gName(g, id); const N = mm.first.length; const bad = fails(id);
      const row = document.createElement('div'); row.className = 's3-srow' + (bad ? ' bad' : ''); row.setAttribute('role', 'listitem'); row.dataset.m = id;
      row.innerHTML = `<label class="s3-sck"><input type="checkbox" ${sp.on && !bad ? 'checked' : ''} ${bad ? 'disabled' : ''} aria-label="${esc(nm)}"></label><span class="avatar hue-${mm.hue}" aria-hidden="true">${esc([...nm][0])}</span><div class="s3-smain"><div class="s3-sname ${memColor(g, id)}">${esc(nm)}${g.st[id].active ? '' : ` <span class="s3-tag">${esc(t3('sittingOutTag'))}</span>`}</div>` +
        (bad ? `<div class="s3-sprev bad-t">${icon('triangle-alert', 14)}<span>${esc(t3('restoreFailedRow'))}</span></div>` : `<div class="s3-sprev">${emph(langText(mm.first[sp.alt]))}</div>`) + `</div>` +
        (N > 1 && !bad ? `<div class="s3-pg" role="group" aria-label="${esc(t3('altOf', { n: sp.alt + 1, total: N }))}"><button type="button" class="btn" data-d="-1" aria-label="${esc(X.t('prevReply'))}" ${sp.alt <= 0 ? 'aria-disabled="true"' : ''}>${X.ic('chevron-left', 18)}</button><span class="s3-pgc" aria-hidden="true">${sp.alt + 1} / ${N}</span><button type="button" class="btn" data-d="1" aria-label="${esc(X.t('nextReply'))}" ${sp.alt >= N - 1 ? 'aria-disabled="true"' : ''}>${X.ic('chevron-right', 18)}</button></div>` : '');
      $('input', row).addEventListener('change', (e) => { sp.on = e.target.checked; });
      $$('[data-d]', row).forEach((b) => b.addEventListener('click', () => { if (b.getAttribute('aria-disabled') === 'true') return; sp.alt = Math.min(N - 1, Math.max(0, sp.alt + Number(b.dataset.d))); paint(); const f = $(`.s3-srow[data-m="${id}"] [data-d="${b.dataset.d}"]`, rw); if (f && f.getAttribute('aria-disabled') !== 'true') f.focus(); else { const o = $(`.s3-srow[data-m="${id}"] [data-d]:not([aria-disabled="true"])`, rw); if (o) o.focus(); } }));
      rw.appendChild(row);
    });
  };
  paint(); X.thread().appendChild(box); if (S.atBottom) X.scrollBottom();
  $('#s3StartGo', box).addEventListener('click', () => { commitStart(c); $('#input').focus({ preventScroll: true }); });
  $('#s3StartEmpty', box).addEventListener('click', () => { c.startPanel = false; c.sp = null; box.remove(); const p = document.createElement('p'); p.className = 'note s2-emptynote'; p.textContent = Y.t2('emptyChat'); X.thread().appendChild(p); $('#input').focus({ preventScroll: true }); });
}

/* ------------------------------------------------------------------ plus sheet, message menu, regenerate (DD-053), composer */
const trailingRound = () => { const ms = S.msgs; let i = ms.length; while (i > 0 && ms[i - 1].role === 'char') i--; return ms.slice(i); };
const hasUser = () => S.msgs.some((m) => m.role === 'user');
function redoRound(opener) {
  const k = cg(); if (!k) return; if (!hasUser()) { X.toast(t3('regenOnlyGreetings')); return; }
  const tr = trailingRound(); if (!tr.length) return; if (S.streaming || R.round) { X.toast(X.t('writingNow')); return; }
  const doit = () => { clearNotice(k.c); X.removeMsgs(tr, {}); startRound({ redo: true, text: lastUserText() }); };
  if (tr.length > 1) {
    X.openSheet({ title: t3('redoRound'), opener: opener || document.activeElement, build(body) {
      const p = document.createElement('p'); p.className = 'confirm-text'; X.markCritical(body); p.textContent = t3('redoRoundConfirm', { n: tr.length }); body.appendChild(p);
      const row = document.createElement('div'); row.className = 'confirm-row s3-stack';
      row.appendChild(X.item('x', X.t('cancel'), () => X.closeSheet(), '', { 'data-autofocus': '' })); row.appendChild(X.item('rotate-ccw', t3('redoRound'), () => { X.closeSheet(false); doit(); }, 'danger dangerous')); body.appendChild(row);
    } });
  } else doit();
}
function explainEarlier(m, opener) {
  const k = cg(); if (!k) return; const tr = trailingRound(); const after = tr.length - 1 - tr.indexOf(m);
  X.openSheet({ title: t3('regenOne'), opener: opener || document.activeElement, build(body) {
    const p = document.createElement('p'); p.className = 'confirm-text'; p.textContent = t3('regenEarlierN', { n: after }); body.appendChild(p);
    const row = document.createElement('div'); row.className = 'confirm-row s3-stack';
    row.appendChild(X.item('x', X.t('cancel'), () => X.closeSheet(), '', { 'data-autofocus': '' })); row.appendChild(X.item('rotate-ccw', t3('redoRound'), () => { X.closeSheet(false); setTimeout(() => redoRound(), 0); }, 'accent', { 'data-drops-data': '' })); body.appendChild(row);
  } });
}
function installComposer() {
  S.hooks.regenWhy = (m) => (cg() && !hasUser() ? t3('regenOnlyGreetings') : '');
  const prevSend = S.hooks.send; S.hooks.send = () => { const k = cg(); if (k) commitStart(k.c); if (prevSend) prevSend(); };      // a typed Send inserts the ticked first messages before the user's message
  S.hooks.quietReply = (m) => !!(m.saying && cg());                                                                                  // one announcement per speaker, not per reply position
  S.hooks.altRow = (a, m) => { const k = cg(); const b = $('.newbtn', a); if (!k || !b || m.streaming) return; if (!hasUser()) { b.setAttribute('aria-disabled', 'true'); b.classList.add('s3-refused'); const why = t3('regenOnlyGreetings'); b.title = X.t('newReply') + ': ' + why; b.setAttribute('aria-description', why); } };
  installCreateGuard();
  S.hooks.sendRound = (v) => {
    const k = cg(); if (!k) return false;
    if (R.round && R.round.held) {                                                                                                    // sent while paused: the held round is planned again from it, and Resume says so
      R.round.list = planRound(k.c, k.g, v); R.round.i = 0; k.c.g.queue = []; renderStrip3(); $$('.s3-pausednote').forEach((e) => e.remove());
      const p = document.createElement('p'); p.className = 's3-pending s3-pausednote'; p.setAttribute('role', 'status'); p.textContent = t3('pausedSendNote', { name: nextName() }); X.thread().appendChild(p); if (S.atBottom) X.scrollBottom(); X.announce(p.textContent); return true;
    }
    startRound({ text: v }); return true;
  };
  S.hooks.busySend = (v) => { const k = cg(); if (!k || !AU.on) return false; S3.pendingUser = v; X.announce(t3('pendingNote')); showPending(); return true; };
  S.hooks.syncSend = (b) => {
    const k = cg(); b.dataset.s3 = ''; if (!k) return; const ta = $('#input'); const empty = !ta.value.trim(); const q = k.c.g.queue;
    const qn = q.map((i) => gName(k.g, i)).join(', ');
    if (!S.sendBlock) ta.placeholder = q.length ? t3('queueHint', { names: qn }) : X.t('composerPh'); else ta.placeholder = S.kb ? t3('blockedShort') : S.sendBlock;       // N3: one line while the keyboard is open                              // DD-059: the box says who will answer
    if (!S.streaming && !empty && q.length && !S.sendBlock) { const lab = t3('sendOnly', { names: qn }); b.setAttribute('aria-label', lab); b.title = lab; b.dataset.s3 = 'only'; }
    if (!S.streaming && empty && q.length && !S.sendBlock) { const nm = q.map((i) => gName(k.g, i)).join(', '); const lab = t3('letSpeak', { name: nm }); b.setAttribute('aria-disabled', 'false'); b.setAttribute('aria-label', lab); b.title = lab; b.dataset.s3 = 'queue'; }
    else if (AU.on && S.streaming && !empty) { b.classList.remove('stopping'); const lab = X.t('send'); b.setAttribute('aria-label', lab); b.title = lab; b.setAttribute('aria-disabled', 'false'); b.dataset.s3 = 'busy'; }
  };
  S.hooks.submit = (e) => {
    const k = cg(); if (!k) return false; const b = $('#sendBtn'); const v = $('#input').value.trim();
    if (b.dataset.s3 === 'queue') { startRound({ text: '' }); return true; }
    if (b.dataset.s3 === 'busy') { if (S.hooks.busySend(v)) { $('#input').value = ''; X.fitInput(); X.syncSend(); } return true; }
    return false;
  };
  S.hooks.plus = (body) => {
    const k = cg(); if (!k) return; const items = $$('[role="menuitem"]', body); const cont = items[4];
    if (cont) { $('span:last-child', cont) && ($('span:last-child', cont).textContent = t3('oneMoreRound')); cont.setAttribute('aria-label', t3('oneMoreRound')); cont.onclick = null; const nb = cont.cloneNode(true); cont.replaceWith(nb); nb.addEventListener('click', () => { X.closeSheet(); setTimeout(() => startRound({ text: '' }), 30); }); }
    const rr = X.item('rotate-ccw', t3('redoRound'), () => { X.closeSheet(false); setTimeout(() => redoRound($('#plusBtn')), 30); }, '', { role: 'menuitem' }); rr.tabIndex = -1; (nb2(body) || body).appendChild(rr);
  };
  S.hooks.actions = (m, body) => {
    const k = cg(); if (!k || m.role !== 'char' || !m.saying || !hasUser()) return; const tr = trailingRound(); if (!tr.includes(m)) return;
    const g = X.group(t3('redoRound'), 'g-round', 'tiles');
    if (m !== S.msgs[S.msgs.length - 1]) g.appendChild(X.tile('refresh-cw', t3('regenOne'), () => { X.closeSheet(false); setTimeout(() => explainEarlier(m, document.activeElement), 0); }, { attrs: { 'data-aid': 'regen-earlier' } }));
    g.appendChild(X.tile('rotate-ccw', t3('redoRound'), () => { X.closeSheet(false); setTimeout(() => redoRound(), 0); }, { attrs: { 'data-aid': 'redo-round' } })); body.appendChild(g);
  };
  S.hooks.kb = (on) => { const el = stripEl(); if (el) el.classList.toggle('compact', on); if (AU.on || AU.ended) renderStrip3(); X.syncSend(); X.fitInput(); layoutSoon(); };
}
const nb2 = (body) => body;
function showPending() {
  $$('.s3-pending').forEach((e) => e.remove()); const p = document.createElement('div'); p.className = 's3-pending'; p.setAttribute('role', 'status');
  p.innerHTML = `<span>${esc(t3('pendingNote'))}</span><button type="button" class="btn s3-pend-btn">${X.ic('undo-2', 16)}<span>${esc(t3('pendingCancel'))}</span></button>`;
  $('button', p).addEventListener('click', () => { returnPending(); const ta = $('#input'); if (ta) ta.focus({ preventScroll: true }); });
  X.thread().appendChild(p); if (S.atBottom) X.scrollBottom();
}
Object.assign(S3I.en, { blockedShort: 'Writing elsewhere', queueHint: 'Only {names} will answer', queueTip: 'Only the members you tap speak in the next round.', sendOnly: 'Send · only {names} will answer', autoReasonAway: 'moved to another screen', roundEndedSkipped: 'Auto mode ended · skipped {list}',
  stSkipped: 'skipped', sittingOutTag: 'Sitting out', lastMemberRefuse: 'A group needs at least one member', moveUp: 'Move up', moveDown: 'Move down', chipEarlier: 'Move earlier', chipLater: 'Move later', chipRemove: 'Remove', chipMenu: 'Options for {name}',
  pendingCancel: 'Take it back', pendingReturned: 'Your message is back in the box', pausedSendNote: 'Resume and they answer · next {name}', autoPausedNext: 'Paused · round {n} · next {name}', regenEarlierN: 'Redoing this reply removes {n} later replies of this round.',
  groupPictureNote: 'Made from the member pictures · you can change this later', talkValue: 'Talkativeness {n}/6', missingShort: 'Deleted', shortcutTitle: '{name} (Alt+{n})', firstAdded: 'Added {n} first messages', startTick: 'Tick to include', talkEdit: 'Talkativeness' });
Object.assign(S3I.ko, { blockedShort: '다른 채팅 작성 중', queueHint: '{names}만 답해요', queueTip: '고른 멤버만 다음 라운드에 말해요.', sendOnly: '보내기 · {names}만 답해요', autoReasonAway: '다른 화면으로 이동', roundEndedSkipped: '자동 진행이 끝나서 {list} 건너뜀',
  stSkipped: '건너뜀', sittingOutTag: '쉬는 중', lastMemberRefuse: '그룹에는 멤버가 한 명 이상 있어야 해요', moveUp: '위로 옮기기', moveDown: '아래로 옮기기', chipEarlier: '앞으로 옮기기', chipLater: '뒤로 옮기기', chipRemove: '빼기', chipMenu: '{name} 옵션',
  pendingCancel: '되돌리기', pendingReturned: '메시지를 입력창으로 되돌렸어요', pausedSendNote: '계속을 누르면 이어서 답해요 · 다음 {name}', autoPausedNext: '일시정지 · {n}라운드 · 다음 {name}', regenEarlierN: '이 답변을 다시 만들면 뒤쪽 답변 {n}개가 지워져요.',
  groupPictureNote: '멤버 사진으로 만들어져요 · 나중에 바꿀 수 있어요', talkValue: '말 수 {n}/6', missingShort: '삭제됨', shortcutTitle: '{name} (Alt+{n})', firstAdded: '첫 메시지 {n}개를 넣었어요', startTick: '체크하면 넣어요', talkEdit: '말 수' });
Object.assign(S3I.en, { pendingNote: 'Your message goes in after this reply', partLabel: 'Takes part' });
Object.assign(S3I.ko, { pendingNote: '내 메시지는 이 답변 뒤에 들어가요', partLabel: '참여' });

/* ------------------------------------------------------------------ demo controls (collapsed "Slice 3 demo controls" panel) */
function renderDemo3() {
  const el = $('#s3Demo'); if (!el) return; $('#s3CtlSum').textContent = t3('dTitle');
  const sw = (k, label) => `<label class="sw"><input type="checkbox" role="switch" data-d3="${k}"><span class="sw-ui"></span><span class="lbl">${esc(t3(label))}</span></label>`;
  const bt = (id, ico, label) => `<button type="button" class="btn act" id="${id}">${icon(ico, 18)}<span>${esc(t3(label))}</span></button>`;
  el.innerHTML = `<h2 class="s2-dh">${esc(t3('dTitle'))}</h2>` + bt('d3Open', 'users', 'dOpenGroup') + bt('d3Greet', 'message', 'dGreet') + bt('d3New', 'plus', 'dNewChat') + bt('d3Create', 'user-plus', 'dCreate') + bt('d3Panel', 'sliders', 'dPanel') + bt('d3Bg', 'sparkles', 'dBg') + bt('d3Auto', 'repeat', 'dAuto') +
    sw('failOnce', 'dFail') + sw('list', 'dList') + sw('restoreFail', 'dRestore') + sw('quietAfter', 'dQuiet') + sw('noFirst', 'dNoFirst') + sw('freeze', 'dFreeze') +
    `<label class="s3-speedl">${esc(t3('dSpeed'))}<select id="d3Speed" data-esc-leave>${[0.25, 1, 3, 8].map((v) => `<option value="${v}" ${S3.speed === v ? 'selected' : ''}>×${v}</option>`).join('')}</select></label>` + bt('d3Reset', 'rotate-ccw', 'dReset');
  $$('[data-d3]', el).forEach((i) => i.addEventListener('change', () => { const k = i.dataset.d3; if (k === 'list') { const g = cg(); if (g) g.g.orderMode = i.checked ? 'list' : 'random'; refreshPanel(); } else { S3[k] = i.checked; } }));
  $('#d3Speed', el).addEventListener('change', (e) => { S3.speed = Number(e.target.value); });
  const go = (fn) => () => { fn(); if (!S.desktop && S.sbOpen) X.closeSidebar(); };
  $('#d3Open').addEventListener('click', go(() => Y.openChat('c-trio', { force: true }))); $('#d3Greet').addEventListener('click', go(() => Y.openChat('c-trio-greet', { force: true })));
  $('#d3New').addEventListener('click', go(() => { const ch = charById('trio'); Y.S2.charId = 'trio'; Y.newChat('trio'); }));
  $('#d3Create').addEventListener('click', go(() => setTimeout(() => openCreate('create', document.body), 300))); $('#d3Panel').addEventListener('click', go(() => setTimeout(() => openPanelSheet($('#moreBtn')), 300)));
  $('#d3Bg').addEventListener('click', go(() => { Y.openChat('c-trio', { force: true }); setTimeout(() => { startRound({ text: '' }); setTimeout(() => Y.openChat('c-first', { force: true }), 700); }, 450); }));
  $('#d3Auto').addEventListener('click', go(() => { if (Y.S2.chatId !== 'c-trio') Y.openChat('c-trio', { force: true }); setTimeout(autoStart, 450); }));
  $('#d3Reset').addEventListener('click', () => location.reload());
  syncDemo3();
}
function syncDemo3() { const g = cg(); $$('[data-d3]').forEach((i) => { const k = i.dataset.d3; i.checked = k === 'list' ? !!(g && g.g.orderMode === 'list') : !!S3[k]; }); }

/* ------------------------------------------------------------------ states (?state=g-...) */
function waitChat(id, fn) { Y.openChat(id, { force: true }); setTimeout(fn, 520); }
function runState3(s) {
  const lastId = () => S.msgs[S.msgs.length - 1].id;
  const q = (ids) => { const k = cg(); k.c.g.queue = ids; renderStrip3(); X.syncSend(); };
  const ended = (reason, name) => { Q3.set('keep', '1'); autoEnd(reason, name); AU.ended.at = 0; renderStrip3(); };
  const withSheetPanel = (fn) => { Y.openThisChat($('#moreBtn')); setTimeout(() => { const h = $('#s2g-members'); if (h) h.scrollIntoView({ block: 'start' }); if (fn) fn(); }, 400); };
  const trio = (fn) => waitChat('c-trio', fn);
  switch (s) {
    case 'g-default': return trio(() => {});
    case 'g-queue1': return trio(() => q(['juno']));
    case 'g-queue2': return trio(() => q(['mira', 'sera']));
    case 'g-sendnext': return trio(() => q(['sera']));
    case 'g-kbd': return trio(() => { X.setKb(true); q(['juno']); });
    case 'g-speaking': return trio(() => { S3.freeze = true; syncDemo3(); startRound({ text: '' }); });
    case 'g-stopped': return trio(() => { const k = cg(); k.c.g.notice = { kind: 'stopped', a: 'sera', skipped: ['juno', 'mira'] }; renderExtras3(k.c); renderStrip3(); });
    case 'g-failed': return trio(() => { const k = cg(); k.c.g.notice = { kind: 'failed', a: 'juno', skipped: ['mira'] }; renderExtras3(k.c); renderStrip3(); });
    case 'g-skipped': return trio(() => { const k = cg(); k.g.orderMode = 'list'; k.c.g.skips.push({ kind: 'missing', id: 'ghost', after: lastId() }); renderExtras3(k.c); });
    case 'g-skipped-restore': return trio(() => { const k = cg(); k.c.g.skips.push({ kind: 'restore', id: 'mira', after: lastId() }); renderExtras3(k.c); });
    case 'g-regen': return trio(() => { const m = S.msgs[S.msgs.length - 1]; m.alts.push({ en: 'Another way to say it: stay as long as you like.', ko: '다르게 말하면: 있고 싶은 만큼 있어요.' }); m.idx = 1; X.rerenderMsg(m); X.refreshAll(); });
    case 'g-redo-confirm': return trio(() => redoRound());
    case 'g-earlier': return trio(() => { const tr = trailingRound(); explainEarlier(tr[0], $('#input')); });
    case 'g-greetings': return waitChat('c-trio-greet', () => { X.newReply('state'); });
    case 'g-auto': return trio(() => { S3.freeze = true; syncDemo3(); autoStart(); });
    case 'g-auto-paused': return trio(() => { S3.freeze = true; syncDemo3(); autoStart(); setTimeout(autoPause, 300); });
    case 'g-auto-user': return trio(() => ended('user'));
    case 'g-auto-error': return trio(() => ended('error', mName('juno')));
    case 'g-auto-quiet': return trio(() => ended('quiet'));
    case 'g-auto-switched': return trio(() => ended('switched'));
    case 'g-auto-send': return trio(() => { S3.freeze = true; syncDemo3(); autoStart(); setTimeout(() => { const ta = $('#input'); ta.value = S.lang === 'ko' ? '모두 잠깐 쉬어요.' : 'Everyone take a breath.'; ta.dispatchEvent(new Event('input', { bubbles: true })); X.syncSend(); }, 400); });
    case 'g-auto-send-sent': return trio(() => { S3.freeze = true; syncDemo3(); autoStart(); setTimeout(() => { S3.pendingUser = ' '; S3.pendingUser = S.lang === 'ko' ? '모두 잠깐 쉬어요.' : 'Everyone take a breath.'; showPending(); }, 400); });
    case 'g-auto-away': return trio(() => ended('away'));
    case 'g-create-kbd': return trio(() => { openCreate('create', $('#input'), { sel: ['sera', 'juno'] }); setTimeout(() => X.setKb(true), 800); });
    case 'g-chipmenu': return trio(() => openCreate('create', $('#input'), { sel: ['sera', 'juno', 'mira'], chipMenu: 'juno' }));
    case 'g-panel-expand': return trio(() => withSheetPanel(() => { const b = $('.s3-prow[data-m="juno"] [data-act="more"]'); if (b) b.click(); }));
    case 'g-last-member': return trio(() => { const k = cg(); k.g.members = ['sera']; renderStrip3(); withSheetPanel(() => { const b = $('.s3-prow[data-m="sera"] [data-act="more"]'); if (b) b.click(); }); });
    case 'g-member-menu': return trio(() => openMemberMenu('juno', $('.s3-m[data-m="juno"]')));
    case 'g-member-menu-missing': return trio(() => openMemberMenu('ghost', $('.s3-m[data-m="ghost"]')));
    case 'g-panel': return trio(() => withSheetPanel());
    case 'g-panel-list': return trio(() => { cg().g.orderMode = 'list'; syncDemo3(); withSheetPanel(); });
    case 'g-panel-undo': return trio(() => withSheetPanel(() => { const k = cg(); const btn = $('.s3-prow[data-m="juno"] [data-act="more"]'); if (btn) { btn.click(); const rm = $('.s3-pexp-b[data-k="remove"]'); if (rm) rm.click(); } }));
    case 'g-picker': return trio(() => withSheetPanel(() => $('#s3AddBtn').click()));
    case 'g-create0': return trio(() => openCreate('create', $('#input')));
    case 'g-create1': return trio(() => openCreate('create', $('#input'), { sel: ['sera'] }));
    case 'g-create3': return trio(() => openCreate('create', $('#input'), { sel: ['sera', 'juno', 'mira'] }));
    case 'g-create5': return trio(() => openCreate('create', $('#input'), { sel: ['sera', 'juno', 'mira', 'kai', 'arch'] }));
    case 'g-create-edited': return trio(() => openCreate('create', $('#input'), { sel: ['sera', 'juno', 'mira'], edited: true, name: S.lang === 'ko' ? '등불 식구들' : 'Lantern crew', order: 'list' }));
    case 'g-create-cancel': return trio(() => { openCreate('create', $('#input'), { sel: ['sera', 'juno'] }); setTimeout(() => $('#s3Cancel').click(), 500); });
    case 'g-start': return Y.openChat('c-trio', { force: true }), setTimeout(() => { Y.newChat('trio'); }, 520), undefined;
    case 'g-start-edit': return Y.openChat('c-trio', { force: true }), setTimeout(() => { Y.newChat('trio'); setTimeout(() => { const c = curC(); c.sp.juno.on = false; c.sp.sera.alt = 1; renderStart(c); }, 450); }, 520), undefined;
    case 'g-start-fail': return S3.restoreFail = true, Y.openChat('c-trio', { force: true }), setTimeout(() => Y.newChat('trio'), 520), undefined;
    case 'g-start-none': return S3.noFirst = true, Y.openChat('c-trio', { force: true }), setTimeout(() => Y.newChat('trio'), 520), undefined;
    case 'g-bg': return trio(() => { startRound({ text: '' }); setTimeout(() => Y.openChat('c-first', { force: true }), 650); });
    case 'g-bg-auto': return trio(() => { autoStart(); setTimeout(() => Y.openChat('c-first', { force: true }), 650); });
    case 'g-hidenames': return trio(() => { const c = curC(); c.hideNames = true; S.hideNames = true; document.documentElement.classList.add('hide-names'); X.refreshAll(); });
    default: return undefined;
  }
}

/* ------------------------------------------------------------------ start */
function init3() {
  X = window.__slice1; S = X.S; ST = X.ST; Y = window.__slice2; S2 = Y.S2; S2H = Y.S2H;
  setupData(); installRender(); installPlan(); installBackground(); installPanel(); installComposer(); stripEvents(); installKeys();
  S2H.title = () => (S.lang === 'ko' ? '슬라이스 3 목업' : 'Chat slice 3 mockup');
  X.setLang && 0;
  renderDemo3(); document.title = 'Chat slice 3 · mockup';
  const st = Q3.get('state');
  const first = Q3.get('chat') === 'forest' ? null : 'c-trio';
  if (first && !(st && /^g-/.test(st) && st !== 'g-greetings')) Y.openChat(first, { force: true });
  Y.refreshList(); Y.renderSidebar(); renderStrip3();
  if (st) setTimeout(() => runState3(st), 120);
  window.__slice3 = { S3, AU, R, MEM, LIB, cg, groupOf, charById, startRound, runNext, autoStart, autoPause, autoResume, autoStop, autoEnd, toggleQueue, renderStrip3, renderExtras3, openMemberMenu, openCreate, openPanelSheet, redoRound, explainEarlier, renderStart, trailingRound, removeMember, t3, planRound, mkMsg, gmsg, stepOf, showPending, onStreamEnd, makeGroup, hasFirst };
}
(function wait() { if (window.__slice1 && window.__slice2 && window.__slice2.S2 && window.__slice2.CHARS) init3(); else setTimeout(wait, 20); })();
})();
