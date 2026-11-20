// English turn cues. ask: the M4 question_paraphrase wording inside a speech wrapper. allude: one statement per template
// key (45) over the question's slots. An allude statement names the key entity (e: subject, invented term, ...) and may
// use at most one more word shared with the planted span; it never states the answer or the stale answer.
const A = (e, t) => ({ e, t });

export const askCue = (qp, user, gesture) => `"${qp}" ${user} asked, ${gesture}.`;

export const ALLUDE = {
  // single fact
  pet: A((s) => [s.subj], (s) => `${s.subj} was fussing over that furry ${s.animal} again.`),
  hometown: A((s) => [s.subj], (s) => `${s.subj} drifted into memories of the village where childhood passed.`),
  allergy: A((s) => [s.subj], (s) => `${s.subj} kept a wary eye on the menu, still careful about what could be eaten.`),
  sibling: A((s) => [s.subj], (s) => `${s.subj} read another message from a relative back home and sighed.`),
  forged: A((s) => [s.subj], (s) => `${s.subj} ran a thumb along the old ${s.weapon} and recalled where it came from.`),
  promise: A((s) => [s.subj], (s) => `${s.subj} was thinking about a vow made to someone dear.`),
  profession: A((s) => [s.subj], (s) => `${s.subj} grew nostalgic about a former line of employment.`),
  scar: A((s) => [s.subj], (s) => `${s.subj} absently traced the mark near the chin.`),
  fear: A((s) => [s.subj], (s) => `${s.subj} went pale, haunted by an old dread.`),
  hobby: A((s) => [s.subj], (s) => `${s.subj} was looking for a quiet way to unwind after sunset.`),
  birthday: A((s) => [s.subj], (s) => `${s.subj} wondered whether anybody would remember the celebration this year.`),
  charm: A((s) => [s.subj], (s) => `${s.subj} fidgeted with a keepsake for good fortune.`),
  motto: A((s) => [s.subj], (s) => `${s.subj} quoted a family adage yet again.`),
  rival: A((s) => [s.subj], (s) => `${s.subj} bristled at the memory of a lost wager.`),
  mentor: A((s) => [s.subj], (s) => `${s.subj} credited a former instructor for every skill.`),
  horse: A((s) => [s.subj], (s) => `${s.subj} stroked the glossy coat of a loyal steed.`),
  // knowledge update
  residence: A((s) => [s.subj], (s) => `${s.subj} was busy getting used to a different address.`),
  job: A((s) => [s.subj], (s) => `${s.subj} had thoughts about daily livelihood lately.`),
  drink: A((s) => [s.subj], (s) => `${s.subj} was picky about what filled the cup these days.`),
  rent: A((s) => [s.place], (s) => `Travelers kept grumbling about the ${s.place} lodging bill.`),
  rank: A((s) => [s.subj], (s) => `${s.subj} wore a different insignia lately.`),
  meeting: A((s) => [s.group], (s) => `${s.group} members were seen heading somewhere else again.`),
  password: A((s) => [s.place], (s) => `Visitors fretted about getting past the ${s.place} entrance.`),
  ship: A((s) => [s.subj], (s) => `${s.subj} grumbled about a relative's vessel yet again.`),
  // temporal date lookup
  event: A((s) => [s.event], (s) => `People kept asking when the ${s.event} would finally arrive.`),
  lastseen: A((s) => [s.subj], (s) => `${s.subj} had been missing for a while, rumor said.`),
  caravan: A((s) => [s.place], (s) => `Everyone awaited the carts rolling in from ${s.place}.`),
  deadline: A((s) => [s.subj], (s) => `${s.subj} was sweating over an unpaid debt.`),
  departure: A((s) => [s.subj], (s) => `${s.subj} kept glancing at the packed bags by the door.`),
  wedding: A((s) => [s.subj, s.npc], (s) => `${s.subj} and ${s.npc} were surrounded by talk of a joyful ceremony.`),
  // temporal order
  order: A((s) => [s.A.clause, s.B.clause], (s) => `People kept replaying that ${s.A.clause} and that ${s.B.clause}.`),
  // multi message
  'shop-price': A((s) => [s.npc, s.shop], (s) => `${s.npc} drove a hard bargain at the ${s.shop}.`),
  hermit: A((s) => [s.npc, s.place], (s) => `${s.npc} had grim news from up on ${s.place}.`),
  'captain-birth': A((s) => [s.npc, s.ship], (s) => `${s.npc}, master of the ${s.ship}, kept an obscure past.`),
  'sister-husband': A((s) => [s.subj, s.npc], (s) => `${s.subj} sighed over ${s.npc}'s household affairs.`),
  'key-door': A((s) => [s.subj, s.npc], (s) => `${s.npc} gave ${s.subj} a curious object, no explanation attached.`),
  'commander-unit': A((s) => [s.subj, s.npc], (s) => `${s.subj} followed orders from ${s.npc} faithfully.`),
  // invented name
  'IN.artifact': A((s) => [s.T], (s) => `Everyone whispered about ${s.T} as a legend.`),
  'IN.valley': A((s) => [s.T], (s) => `${s.T} kept surfacing in rumors among travelers.`),
  'IN.creature': A((s) => [s.T], (s) => `Locals felt a shiver whenever ${s.T} was mentioned.`),
  'IN.order': A((s) => [s.T], (s) => `${s.T} came up in hushed talk about a clandestine society.`),
  'IN.word': A((s) => [s.T], (s) => `Somebody scrawled ${s.T} on the wall again.`),
  'IN.tea': A((s) => [s.T], (s) => `${s.T} was served again that night.`),
  'IN.title': A((s) => [s.T], (s) => `Nobody dared to claim ${s.T} these days.`),
  'IN.curse': A((s) => [s.T], (s) => `${s.T} haunted the village for generations.`),
};
