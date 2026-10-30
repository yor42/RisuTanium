// DD-256 assertions of the regression suite: the sheet-height rule per area (calibrated against rendered pages, see calibration.txt) and the rule's engine.
import fs from 'node:fs'; import path from 'node:path';
export function dd256(A, LINT, REG, here, why) {
  const CEILP = {   // every geometry token the area's sheet model reads, at its ceiling
    chat: { '--sheet-padding-bottom': '48px', '--sheet-padding-x': '48px', '--font-size-lg': '24px', '--font-size-md': '24px', '--size-touch-lg': '72px' },
    settings: { '--settings-dialog-padding': '48px', '--font-size-xl': '28px', '--font-size-base': '24px', '--settings-dialog-actions-margin-top': '48px', '--size-touch': '72px' },
    studio: { '--studio-font-lg': '24px', '--studio-font-md': '24px', '--studio-size-touch-lg': '72px' },
    home: { '--home-dialog-pad': '32px', '--home-dialog-margin': '48px', '--home-text-lg': '24px', '--home-text-base': '24px', '--home-text-sm': '24px', '--home-control-height': '72px' },
  };
  const regs = { chat: undefined, settings: { ...REG.s5b.REG5B, sheets: REG.sbase.SETTINGS_SHEETS }, studio: REG.st.STUDIO_REGISTRY, home: REG.home.HOME_REGISTRY };
  const mine = (a) => (a === 'chat' ? 'chat critical sheet' : { settings: 'settings critical dialog', studio: 'studio protected sheet', home: 'home confirm dialog' }[a]);
  for (const a of Object.keys(CEILP)) {
    const css = ':root{' + Object.entries(CEILP[a]).map(([k, v]) => `${k}:${v}`).join(';') + '}'; const r = LINT[a](css, 'ceilings');
    const at = REG.chat.sheetReport(css, regs[a]).find(([n]) => n === mine(a)), df = REG.chat.sheetReport('', regs[a]).find(([n]) => n === mine(a));
    const geo = (r.errors || []).filter((e) => /DD-256/.test(e.why));
    A(`dd256:${a}`, `every sheet token at its ceiling: content ${at[1]} px (default ${df[1]}), shown ${at[2] ?? at[1]} px of a ${at[2] !== undefined ? 'capped scrolling sheet' : 'sheet'}, fixed part ${at[3] ?? 'n/a'} px: the actions still scroll into view, so the pack is not rejected for height`, geo.length === 0, why(r).slice(0, 160));
  }
  // calibration against rendered pages (theme/checks/measure/calibrate.mjs wrote calibration.json)
  const cal = JSON.parse(fs.readFileSync(path.join(here, 'calibration.json'), 'utf8'));
  for (const [a, c] of Object.entries(cal.refs)) A(`dd256-calibrated:${a}`, `the reference model (${c.reference} px) is an upper bound of every rendered protected sheet of the area and within 1.0 to 1.35 of the tallest (${c.tallest.measured} px, ${c.tallest.id}): ratio ${c.ratio}`, c.allUnder && c.ratio >= 1 && c.ratio <= 1.35, JSON.stringify(c));
  // the engine
  const sched = (cap) => ({ sheets: [{ name: 'synthetic sheet', terms: [{ t: '--control-gap', n: 40 }], fixed: [{ t: '--control-gap', n: 10 }], cap }] });
  const unc = { sheets: [{ name: 'synthetic sheet', terms: [{ t: '--control-gap', n: 40 }] }] };   // 40 x gap px, no cap: judged whole
  const E = (css, reg) => REG.chat.lintPack(css, 's', reg);
  A('dd256:engine-uncapped', 'a sheet without a cap is judged whole: 480 px accepted, 800 px rejected, an @media branch counts, an unresolvable size fails closed', E(':root{--control-gap:12px}', unc).ok && !E(':root{--control-gap:20px}', unc).ok && !E(':root{--control-gap:12px}@media (min-width:1px){:root{--control-gap:20px}}', unc).ok && !E(':root{--control-gap:var(--nope)}', unc).ok);
  A('dd256:engine-capped', 'a scrolling sheet is judged on the part that does not scroll: with a 384 px cap, 10 x 20 px fixed + 96 fits, 10 x 32 px does not; the content (40 x 32) may be taller than the screen', E(':root{--control-gap:20px}', sched(384)).ok && !E(':root{--control-gap:32px}', sched(384)).ok && REG.chat.sheetReport(':root{--control-gap:32px}', sched(384)).some(([, c]) => c > 640));
}
