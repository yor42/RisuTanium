// Named-filler (NF) sentence templates, English. NF filler puts character names into the ordinary filler so a name is
// no longer a near-unique retrieval key. Two kinds, neither of which states any fact:
//   presence:   a name with a gesture, a mood or a place;
//   co-mention: a name next to a word from a fact pool (animal, weapon, food, ...) with no fact relation between them.
export const presence = [
  (n, g, m, pl) => `${n} stood near ${pl} for a while, ${g}.`,
  (n, g, m, pl) => `${n} looked ${m} when the talk drifted past ${pl}.`,
  (n, g, m, pl) => `Somebody mentioned that ${n} had passed through ${pl} earlier, ${g}.`,
  (n, g, m, pl) => `${n} waved from across ${pl} and then turned away.`,
  (n, g, m, pl) => `${n} muttered something to nobody in particular, ${g}.`,
  (n, g, m, pl) => `${n} seemed ${m} all evening, and nobody asked why.`,
];

export const co = [
  { pool: 'animal', fn: (n, w) => `${n} remarked that a ${w} had followed the cart all morning.` },
  { pool: 'weapon', fn: (n, w) => `${n} eyed a ${w} in a shop window, then walked on.` },
  { pool: 'food', fn: (n, w) => `${n} traded a joke for a handful of ${w} at the stall.` },
  { pool: 'drink', fn: (n, w) => `${n} ordered ${w} and left it untouched on the counter.` },
  { pool: 'place', fn: (n, w) => `${n} claimed the road to ${w} was longer than it looked.` },
  { pool: 'trade', fn: (n, w) => `${n} said the town needed another ${w} more than another inn.` },
  { pool: 'objt', fn: (n, w) => `${n} picked up a ${w} from the table and put it back again.` },
  { pool: 'term', fn: (n, w) => `${n} frowned at the word ${w} and changed the subject.` },
];
