// Shared loader for the theme-lint regression suite: one lint function per area, the shipped packs, and small helpers.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
export const here = path.dirname(fileURLToPath(import.meta.url));
export const DESIGN = path.resolve(here, '..', '..');
const imp = (rel) => import(pathToFileURL(path.join(DESIGN, rel)).href);
export const read = (rel) => fs.readFileSync(path.join(DESIGN, rel), 'utf8');
const chat = await imp('chat/checks/th/packlint.mjs');
const st = await imp('studio/checks/th4/packlint-studio.mjs');
const home = await imp('home/registry-home.mjs');
const s5b = await imp('settings/checks/th5b/registry5b.mjs');
const s4 = await imp('settings/checks/th4/registry4.mjs');
const s5a = await imp('settings/checks/th5a/registry5a.mjs');
const sbase = await imp('settings/checks/th/packlint-settings.mjs');
// the lint function of each area: the registry the area's newest page set is judged with
export const LINT = {
  chat: (css, name) => chat.lintPack(css, name),
  settings: (css, name) => s5b.lint5b(css, name),
  studio: (css, name) => st.lintPack(css, name),
  home: (css, name) => home.lintHome(css, name),
};
export const REG = { chat, st, home, s5b, s4, s5a, sbase };
export const AREA_NAMES = Object.keys(LINT);
export const PACKS = Object.fromEntries(AREA_NAMES.flatMap((a) => ['origin-navy', 'banana-cocoa'].map((p) => [a + '/' + p, `${a}/themes/${p}.css`])));
export const verdict = (r) => (r.ok ? 'ACCEPT' : 'REJECT');
export const reasons = (r) => r.errors.map((e) => `${e.selector} { ${e.prop} }: ${e.why}`);
