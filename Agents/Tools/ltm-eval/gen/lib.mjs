// Shared helpers for the synthetic roleplay memory evaluation generator.
export function rng(seed) {
  let a = seed >>> 0;
  const f = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.int = (n) => Math.floor(f() * n);
  f.pick = (arr) => arr[f.int(arr.length)];
  f.shuffle = (arr) => {
    const r = arr.slice();
    for (let i = r.length - 1; i > 0; i--) { const j = f.int(i + 1); [r[i], r[j]] = [r[j], r[i]]; }
    return r;
  };
  f.chance = (p) => f() < p;
  return f;
}

// Korean particle helpers (batchim-aware).
export function batchim(w) {
  for (let i = w.length - 1; i >= 0; i--) {
    const c = w.charCodeAt(i);
    if (c >= 0xAC00 && c <= 0xD7A3) return (c - 0xAC00) % 28;
    if (/[A-Za-z0-9]/.test(w[i])) return /[lmnrLMNR0136-8]/.test(w[i]) ? 1 : 0;
  }
  return 0;
}
export const josa = (w, type) => {
  const b = batchim(w);
  switch (type) {
    case '은': return w + (b ? '은' : '는');
    case '이': return w + (b ? '이' : '가');
    case '을': return w + (b ? '을' : '를');
    case '과': return w + (b ? '과' : '와');
    case '로': return w + ((b && b !== 8) ? '으로' : '로');
    case '이라': return w + (b ? '이라' : '라');
    case '이었': return w + (b ? '이었' : '였');
    case '의': return w + '의';
    default: throw new Error('josa ' + type);
  }
};
export const ordEn = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'));
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
