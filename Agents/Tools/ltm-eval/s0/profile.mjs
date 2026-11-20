// Message-length profiles. A profile is { name, sample(r, role) } and returns a length in characters.
// The real profile reads the maintainer's aggregate histograms at run time from a path outside the repository;
// nothing read from it is ever copied into a repository file (MC-2633).
import fs from 'node:fs';

const Z90 = 1.2816; // standard normal quantile of 0.90

function normal(r) {
  const u = Math.max(r(), 1e-12), v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function lognormal(median, p90, max) {
  const mu = Math.log(median), sigma = Math.log(p90 / median) / Z90;
  return (r) => Math.min(max, Math.max(40, Math.round(Math.exp(mu + sigma * normal(r)))));
}

const SPEC = {
  long: { char: [1000, 3000, 8000] },
  short: { char: [220, 900, 4000] },
};

// Spec 9 profiles: lognormal with mu = ln median and sigma = ln(p90 / median) / 1.2816, clipped to [40, max].
// Users always use the short profile.
export function specProfile(kind) {
  const s = SPEC[kind];
  if (!s) throw new Error('spec profile ' + kind);
  const char = lognormal(...s.char);
  const user = lognormal(...SPEC.short.char);
  return { name: 'spec-' + kind, sample: (r, role) => (role === 'user' ? user(r) : char(r)) };
}

// Empirical inverse CDF over one histogram {edges, counts, max}: choose a bucket by its count, then a uniform value
// inside it. The last bucket runs from the last edge to max.
export function histogramSampler(h) {
  const total = h.counts.reduce((a, b) => a + b, 0);
  if (!(total > 0)) throw new Error('empty histogram');
  const cum = [];
  let acc = 0;
  for (const c of h.counts) { acc += c; cum.push(acc); }
  return (r) => {
    const x = r() * total;
    let i = 0;
    while (i < cum.length - 1 && cum[i] <= x) i++;
    const lo = h.edges[i];
    const hi = i === h.edges.length - 1 ? Math.max(h.max, lo + 1) : h.edges[i + 1];
    return Math.max(1, Math.min(h.max, Math.floor(lo + r() * (hi - lo))));
  };
}

export function loadAggregates(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Real profile from an aggregates object (messageLength.byRole.{user,char} and messagesPerChat).
export function realProfileFromAgg(agg) {
  const user = histogramSampler(agg.messageLength.byRole.user);
  const char = histogramSampler(agg.messageLength.byRole.char);
  return { name: 'real', sample: (r, role) => (role === 'user' ? user(r) : char(r)), messagesPerChat: agg.messagesPerChat };
}

export function realProfile(file) {
  return realProfileFromAgg(loadAggregates(file));
}

// Coarse share of chats long enough to drop anything at history allowance C: a bucket of messagesPerChat counts as long
// when its lower-edge message count times the given mean tokens per message exceeds C. Estimate only.
export function longShare(messagesPerChat, tokensPerMessage, C) {
  const total = messagesPerChat.counts.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return 0;
  let long = 0;
  messagesPerChat.counts.forEach((c, i) => { if (messagesPerChat.edges[i] * tokensPerMessage > C) long += c; });
  return long / total;
}
