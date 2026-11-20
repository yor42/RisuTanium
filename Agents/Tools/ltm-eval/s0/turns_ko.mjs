// Korean turn cues; same contract as turns_en.mjs. Every cue is a fixed template over the slots, so the function-word
// rule of the KO overlap count (turns.mjs) applies to the template vocabulary, not to anything chosen after a run.
import { josa as j } from '../gen/lib.mjs';

const A = (e, t) => ({ e, t });

export const askCue = (qp, user, gesture) => `${j(user, '이')} ${gesture} 물었다. "${qp}"`;

export const ALLUDE = {
  // single fact
  pet: A((s) => [s.subj], (s) => `${j(s.subj, '이')} 아끼는 털북숭이 ${s.animal} 얘기를 또 꺼냈다.`),
  hometown: A((s) => [s.subj], (s) => `${j(s.subj, '은')} 어린 시절의 마을을 아련하게 떠올렸다.`),
  allergy: A((s) => [s.subj], (s) => `${j(s.subj, '은')} 식탁 앞에서 조심스럽게 눈치를 살폈다.`),
  sibling: A((s) => [s.subj], (s) => `${j(s.subj, '은')} 고향 소식을 담은 서신을 읽고 한숨을 쉬었다.`),
  forged: A((s) => [s.subj], (s) => `${j(s.subj, '은')} 오래된 ${s.weapon} 자루를 손으로 쓸어 보았다.`),
  promise: A((s) => [s.subj], (s) => `${j(s.subj, '은')} 누군가와 나눈 굳은 다짐을 곱씹었다.`),
  profession: A((s) => [s.subj], (s) => `${j(s.subj, '은')} 지난날의 생업을 그리워하는 얼굴이었다.`),
  scar: A((s) => [s.subj], (s) => `${j(s.subj, '은')} 턱 아래 자국을 무심히 쓰다듬었다.`),
  fear: A((s) => [s.subj], (s) => `${j(s.subj, '은')} 식은땀을 흘리며 오래된 공포에 사로잡혔다.`),
  hobby: A((s) => [s.subj], (s) => `${j(s.subj, '은')} 해 진 뒤 조용히 쉴 만한 소일거리를 찾았다.`),
  birthday: A((s) => [s.subj], (s) => `${j(s.subj, '은')} 올해는 누가 축하해 줄지 궁금해했다.`),
  charm: A((s) => [s.subj], (s) => `${j(s.subj, '은')} 행복을 부르는 노리개를 만지작거렸다.`),
  motto: A((s) => [s.subj], (s) => `${j(s.subj, '은')} 가훈 같은 격언을 또 읊어 댔다.`),
  rival: A((s) => [s.subj], (s) => `${j(s.subj, '은')} 지난 승부를 떠올리며 이를 갈았다.`),
  mentor: A((s) => [s.subj], (s) => `${j(s.subj, '은')} 스승 같은 어른 이야기를 길게 이어 갔다.`),
  horse: A((s) => [s.subj], (s) => `${j(s.subj, '은')} 충직한 동반자의 갈기를 쓸어 주었다.`),
  // knowledge update
  residence: A((s) => [s.subj], (s) => `${j(s.subj, '은')} 낯선 주소에 적응하느라 분주했다.`),
  job: A((s) => [s.subj], (s) => `${j(s.subj, '은')} 요새 생계 문제를 자주 입에 올렸다.`),
  drink: A((s) => [s.subj], (s) => `${j(s.subj, '은')} 요즘 잔에 담을 것을 유난히 가렸다.`),
  rent: A((s) => [s.place], (s) => `나그네들은 ${s.place} 숙소 셈에 연신 불평했다.`),
  rank: A((s) => [s.subj], (s) => `${j(s.subj, '은')} 달라진 견장을 어색한 듯 매만졌다.`),
  meeting: A((s) => [s.group], (s) => `${s.group} 일행이 또 다른 방향으로 향하는 게 목격됐다.`),
  password: A((s) => [s.place], (s) => `방문객들이 ${s.place} 출입 문제로 쑥덕거렸다.`),
  ship: A((s) => [s.subj], (s) => `${j(s.subj, '은')} 친척의 선박 얘기를 다시 투덜댔다.`),
  // temporal date lookup
  event: A((s) => [s.event], (s) => `사람들은 ${s.event} 소식을 손꼽아 기다렸다.`),
  lastseen: A((s) => [s.subj], (s) => `${j(s.subj, '은')} 한동안 행방이 묘연하다는 소문이 돌았다.`),
  caravan: A((s) => [s.place], (s) => `${s.place}에서 올 행렬을 다들 기다렸다.`),
  deadline: A((s) => [s.subj], (s) => `${j(s.subj, '은')} 갚지 못한 빚 때문에 식은땀을 흘렸다.`),
  departure: A((s) => [s.subj], (s) => `${j(s.subj, '은')} 꾸려 놓은 짐을 자꾸 만지작거렸다.`),
  wedding: A((s) => [s.subj, s.npc], (s) => `${j(s.subj, '과')} ${j(s.npc, '은')} 축하 인사에 둘러싸였다.`),
  // temporal order
  order: A((s) => [s.A.clause, s.B.clause], (s) => `사람들은 아직도 "${s.A.clause}"는 얘기와 "${s.B.clause}"는 얘기를 곱씹었다.`),
  // multi message
  'shop-price': A((s) => [s.npc, s.shop], (s) => `${j(s.npc, '은')} ${s.shop}에서 흥정을 어찌나 세게 하는지 몰랐다.`),
  hermit: A((s) => [s.npc, s.place], (s) => `${j(s.npc, '이')} ${s.place}에서 불길한 전갈을 보냈다.`),
  'captain-birth': A((s) => [s.npc, s.ship], (s) => `${j(s.ship, '을')} 모는 ${j(s.npc, '의')} 과거는 베일에 싸여 있었다.`),
  'sister-husband': A((s) => [s.subj, s.npc], (s) => `${s.npc}네 살림살이 걱정에 ${j(s.subj, '은')} 한숨을 쉬었다.`),
  'key-door': A((s) => [s.subj, s.npc], (s) => `${j(s.npc, '이')} ${s.subj}에게 묘한 물건을 슬며시 건넸다.`),
  'commander-unit': A((s) => [s.subj, s.npc], (s) => `${j(s.subj, '은')} ${j(s.npc, '의')} 명령을 충실히 따랐다.`),
  // invented name
  'IN.artifact': A((s) => [s.T], (s) => `다들 ${s.T}에 대해 괴담처럼 수군거렸다.`),
  'IN.valley': A((s) => [s.T], (s) => `${s.T} 이야기는 나그네들 사이에서 자꾸 오르내렸다.`),
  'IN.creature': A((s) => [s.T], (s) => `${s.T}라는 말만 나와도 사람들은 몸을 움츠렸다.`),
  'IN.order': A((s) => [s.T], (s) => `${s.T} 얘기가 나오면 모두 목소리를 낮췄다.`),
  'IN.word': A((s) => [s.T], (s) => `누군가 ${j(s.T, '을')} 담벼락에 또 휘갈겨 썼다.`),
  'IN.tea': A((s) => [s.T], (s) => `${j(s.T, '은')} 그날 밤에도 어김없이 올라왔다.`),
  'IN.title': A((s) => [s.T], (s) => `아무도 ${j(s.T, '을')} 감히 입에 올리지 못했다.`),
  'IN.curse': A((s) => [s.T], (s) => `${j(s.T, '이')} 몇 대째 마을을 괴롭혔다.`),
};
