// Declarations the allowlist lets through on ANCESTORS of protected surfaces (reach tier): lint, then load.
import fs from 'node:fs';
import { launch, BASE, sleep } from './cdp.mjs';
import { STATES } from './states.mjs';
import { METRICS } from './metrics.mjs';
import { lintPack } from '../../studio/checks/th4/packlint-studio.mjs';
const R = [
  ['R1 sheet-root padding+font', '[data-part="studio-sheet-root"]{padding:64px;font-size:40px;line-height:3}'],
  ['R2 form-host padding+font', '[data-part="studio-form-host"]{padding:64px;font-size:40px;line-height:3}'],
  ['R3 main padding', '[data-part="studio-main"]{padding:64px}[data-part="studio-body"]{padding:64px}'],
  ['R4 toast-box padding/gap/width', '[data-part="studio-toast-box"]{padding:64px;gap:64px;width:50%;max-width:50%}'],
  ['R5 toast-box border 16px', '[data-part="studio-toast-box"]{border:16px solid #f8f8f2;box-shadow:0 0 0 64px #f8f8f2}'],
  ['R6 sheet-root border 16 + shadow 64', '[data-part="studio-sheet-root"]{border:16px solid #21222c;box-shadow:inset 0 0 0 64px #21222c}'],
  ['R7 shell font-size 40', '[data-part="studio-shell"]{font-size:40px}'],
  ['R8 sheet-root letter-spacing/text-decoration/transform', '[data-part="studio-sheet-root"]{letter-spacing:2px;text-transform:uppercase;text-decoration:line-through}'],
  ['R9 sheet-root font-family dingbat', '[data-part="studio-sheet-root"]{font-family:Wingdings,"Segoe UI Symbol",serif}[data-part="studio-form-host"]{font-family:Wingdings}'],
  ['R10 toast-box text-align + width 100%', '[data-part="studio-toast-box"]{text-align:right}'],
  ['R11 alert via data-kind box', '[data-kind="peer"]{padding:64px;border:16px dashed #f8f8f2;font-size:40px}'],
  ['R12 data-kind=conflict padding', '[data-kind="conflict"],[data-kind="restore"],[data-kind="apply"],[data-kind="leave"]{padding:64px;border-width:16px}'],
  ['R13 color on ancestors', '[data-part="studio-sheet-root"],[data-part="studio-form-host"],[data-part="studio-toast-box"]{color:#8b8b8b}'],
  ['R14 data-kind=restore color/background close to bg', '[data-kind="restore"]{background:#2b2d3a;color:#8a8fa8}'],
  ['R15 data-state=ask outline', '[data-state="ask"]{outline:64px solid #21222c;background:#21222c;color:#8a8fa8}'],
  ['R16 font-size 11 on sheet + width 50%', '[data-part="studio-sheet-root"]{width:50%;max-width:50%}'],
];
const b = await launch('reach');
const W = +(process.argv[2] || 1280), H = W === 360 ? 740 : 800;
const load = async (st, css) => { await b.goto(st.url(BASE, W), { w: W, h: H, touch: W < 600 }); if (!(await b.waitReady())) return null; if (css) await b.ev(`(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);return 1})()`); await sleep(100); if (st.act) { await b.ev(st.act); await sleep(300); } return b.ev(METRICS); };
const base = {}; for (const st of STATES) base[st.id] = await load(st, '');
for (const [name, css] of R) {
  const ok = lintPack(css, name).ok; const why = ok ? '' : lintPack(css, name).errors[0].why.slice(0, 80);
  if (!ok) { console.log('reject', name, '<-', why); continue; }
  const bad = new Set();
  for (const st of STATES) { const ms = await load(st, css); if (!ms) continue; const bs = base[st.id]; ms.forEach((m, i) => { const bm = bs[i]; if (!bm || m.part !== bm.part) return; const f = []; if (m.hidden && !bm.hidden) f.push('hidden'); if (!m.inView && bm.inView) f.push('out of view'); if (m.offscreenBy > bm.offscreenBy + 40) f.push('below screen ' + m.offscreenBy); if (m.btnOut > bm.btnOut) f.push('button off screen'); if (m.btnCovered > bm.btnCovered) f.push('button covered'); const bw = bm.rect[2] - bm.rect[0], w = m.rect[2] - m.rect[0]; if (bw > 10 && w < bw * 0.6) f.push(`width ${bw}->${w}`); if (m.minFont !== null && bm.minFont !== null && Math.abs(m.minFont - bm.minFont) > 3) f.push(`font ${bm.minFont}->${m.minFont}`); if (m.worstContrast !== null && bm.worstContrast !== null && m.worstContrast < 4.5 && bm.worstContrast >= 4.5) f.push(`contrast ${bm.worstContrast}->${m.worstContrast}`); if (m.clipped > bm.clipped) f.push('text past edge'); if (f.length) bad.add(`${st.id}:${m.part} ${f.join('; ')}`); }); }
  console.log('PASS-LINT', name, bad.size ? '\n    ' + [...bad].slice(0, 6).join('\n    ') : '(no flagged damage)');
}
await b.close();
