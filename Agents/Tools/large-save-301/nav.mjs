// Navigation helpers: rail (hamburger), settings, home. Viewport 1280x800 desktop.
import { sleep, mouseAt } from './flow.mjs'

const railOpen = (c) => c.ev(`(()=>{const e=document.elementFromPoint(40,84);const b=e&&e.closest('button');if(!b)return false;const r=b.getBoundingClientRect();return Math.round(r.x)===12&&Math.round(r.y)===56&&b.querySelector('svg')!==null})()`)
export async function ensureRail(c) {
  if (await railOpen(c)) return
  const under = await c.ev(`(()=>{const e=document.elementFromPoint(40,24);return e?(e.closest('button')?'button':e.tagName):null})()`)
  if (under !== 'button' && under !== 'path' && under !== 'svg') throw new Error('hamburger not under the point: ' + under)
  await mouseAt(c, 40, 24)
  await sleep(1000)
  if (!(await railOpen(c))) throw new Error('rail did not open')
}
export async function openSettings(c) {
  await ensureRail(c)
  await mouseAt(c, 40, 84)
  await sleep(1500)
}
export async function goHome(c) {
  await ensureRail(c)
  await mouseAt(c, 40, 148)
  await sleep(1500)
}
