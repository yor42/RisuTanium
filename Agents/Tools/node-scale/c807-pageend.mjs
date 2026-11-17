// CHORE-807 stage 1: the pure part of the G4 import ladder: how a page end is told, how a rung stops, and what a ladder says.
//
// Library use only (no commands, nothing is started or written): c806-import.mjs and the harness c807-pageend.harness.ts import it.
// Invariants:
// - A page end is decided by which surface the page shows, not by an error text. After the file is handed over, an alert box or a boot
//   screen with an enabled button that is not on the answer whitelist, the progress allowlist or the answered offer screen ends the
//   rung at once; only then is it labelled from its recorded text. Nothing that is not whitelisted is ever answered.
// - Two surfaces are watched: every visible alert box ([data-alert-box]) and the store2 boot screen ([data-boot-heading], buttons
//   [data-boot-key]). A commit-time failure of the boot import ends on the boot "blocked" screen with no alert box.
// - The first-life boot import (a different flow from the page import the ladder drives) clears the alerts of a read-failed, repair-refused, unsavable or decode-failure end at once and the dispatch asks
//   the offer again, so those ends are seen as the re-asked offer screen and land as page-other; the cause is in the page's import phase
//   ring (the "boot import <status>" note), which atFailure carries. An error box that stays (the restore catch) is page-error.
// - A skipped-assets or skipped-inlays notice after a landed install is a normal alert with an OK button: it may end a rung as
//   page-other although nothing failed. It is a notice, not a breaking point, and a human reads atFailure.alertText.
// - page-other is never a breaking point until a human has read the recorded text.
// - The progress allowlist is the one list kept by hand: the buttonless wait texts that backuplocal.ts LoadLocalBackup shows on the page
//   import (the Welcome screen's restore) between the file change and the import's done; the first-life boot import shows the same texts. Lang-sourced entries (the other-tabs wait, the import-done wait) and every label
//   text are read from src/lang/en.ts and ko.ts (tableFromLangSource), never typed here. A progress text that is missing ends a rung
//   early as page-other: visible, recorded, and the list is amended.
// - The boot UI language follows the browser language and the table matches English and Korean; another language lands as page-other.
// Self-check mutants (scratch copies of this file, never the repository file): wait-blind, boot-screen-blind, progress-ends,
// other-answered (classifyProbe); refused-not-breaking, tool-stops-after-import, cap-breaks, classify-swap, other-as-breaking
// (classifyStop and ladderVerdict). Run by c807-pageend.harness.ts.

//#region probe
/** Run in the page with Runtime.evaluate (returnByValue): every visible alert box and, when shown, the boot screen. */
export const PROBE_EXPRESSION = `(() => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim()
  const shown = (e) => e.getClientRects().length > 0
  const alerts = [...document.querySelectorAll('[data-alert-box]')].filter(shown).map((box) => ({
    h2: norm(box.querySelector('h2') ? box.querySelector('h2').innerText : '').slice(0, 80),
    text: norm(box.innerText).slice(0, 600),
    buttons: [...box.querySelectorAll('button')].filter(shown).map((b) => norm(b.innerText).slice(0, 60)),
    progress: !!box.querySelector('.saving-animation'),
  }))
  const heading = document.querySelector('[data-boot-heading]')
  let boot = null
  if (heading) {
    const section = heading.closest('section') || document.body
    const keys = [...section.querySelectorAll('[data-boot-key]')]
    const details = section.querySelector('p.text-xs')
    boot = {
      heading: norm(heading.innerText).slice(0, 200),
      paragraphs: [...section.querySelectorAll('p')].map((p) => norm(p.innerText).slice(0, 300)).slice(0, 12),
      details: details ? norm(details.innerText).slice(0, 400) : null,
      enabledKeys: keys.filter((b) => !b.disabled).map((b) => b.dataset.bootKey),
      disabledKeys: keys.filter((b) => b.disabled).map((b) => b.dataset.bootKey),
    }
  }
  return { alerts, boot }
})()`
//#endregion

//#region the text table
const normText = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()

function decodeLiteral(literal) {
  if (literal.startsWith('"')) return JSON.parse(literal)
  // a single-quoted literal: only \' and the JSON escapes occur in the language files
  return JSON.parse('"' + literal.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"') + '"')
}

/** The value of a string-literal key written at `indent` spaces, quoted or not (en.ts writes bare keys, ko.ts quoted ones). */
function langString(src, key, indent) {
  const re = new RegExp('^' + ' '.repeat(indent) + '(?:"' + key + '"|' + key + '):\\s*("(?:[^"\\\\\\n]|\\\\.)*"|\'(?:[^\'\\\\\\n]|\\\\.)*\')\\s*,?\\s*$', 'm')
  const m = re.exec(src)
  if (m === null) throw new Error('language key not found as a string literal at indent ' + indent + ': ' + key)
  return decodeLiteral(m[1])
}

/** The literal text a template-literal function starts with, up to its first ${...}. */
function langTemplatePrefix(src, key) {
  const re = new RegExp('(?:"' + key + '"|' + key + '):\\s*\\([^)]*\\)\\s*=>\\s*`([^$`]*)')
  const m = re.exec(src)
  if (m === null) throw new Error('language template not found: ' + key)
  return normText(m[1].replace(/\\n/g, ' ').replace(/\\(.)/g, '$1'))
}

const exactly = (text) => new RegExp('^' + normText(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$')

/**
 * The text table of the import path, read from the text of src/lang/en.ts and ko.ts (the files are TypeScript; their literals are
 * read, not executed). `answer` stays the size, time and space warnings' closing question ("Continue?"), as the c806 answerer has it.
 */
export function tableFromLangSource(sources) {
  const each = (fn) => sources.map(fn)
  const progressStatic = [
    // backuplocal.ts LoadLocalBackup, between the file change and the import's done
    /^Checking local backup\.\.\. \(\d+(?:\.\d+)?%\)$/,
    /^Reading the database in the backup\.\.\.$/,
    /^Loading local Backup\.\.\. \(\d+(?:\.\d+)?%\)$/,
    /^Finishing copying files\.\.\.$/,
    /^Loading backup\.\.\.$/,
  ]
  const tabs = each((s) => normText(langString(s, 'restoreCheckingOtherTabs', 4)))
  const done = each((s) => normText(langString(s, 'store2ImportDone', 4)))
  return {
    answer: /계속하시겠습니까|Continue\?/,
    errorHeadings: each((s) => normText(langString(s, 'error', 4))),
    incompletePrefixes: each((s) => langTemplatePrefix(s, 'store2ImportIncompleteConfirm')),
    unconfirmedTexts: each((s) => normText(langString(s, 'store2ImportUnconfirmed', 4))),
    blockedTitles: each((s) => normText(langString(s, 'blockedTitle', 8))),
    detailsHeadings: each((s) => normText(langString(s, 'blockedDetailsHeading', 8))),
    progress: [...progressStatic, ...tabs.map(exactly), ...done.map(exactly)],
  }
}
//#endregion

//#region the page-end classifier
// the English UI renders its confirm buttons in capitals ("YES"), the Korean one as 예
const YES_RE = /^(예|yes)$/i
const contains = (text, parts) => parts.some((p) => p !== '' && text.includes(p))

function alertTypeOf(a) {
  if (a.buttons.length === 0) return 'wait'
  if (a.buttons.some((b) => YES_RE.test(b))) return 'confirm'
  return 'normal'
}

function alertDecision(a, table) {
  const text = normText(a.text)
  const isError = table.errorHeadings.includes(normText(a.h2))
  const refused = contains(text, table.incompletePrefixes)
  const unconfirmed = contains(text, table.unconfirmedTexts)
  const hasYes = a.buttons.some((b) => YES_RE.test(b))
  if (!isError && !refused && !unconfirmed && hasYes && table.answer.test(text)) return { kind: 'answer' }
  if (!isError && !refused && !unconfirmed && a.buttons.length === 0 && table.progress.some((re) => re.test(text))) return { kind: 'progress' }
  const label = isError ? 'page-error' : refused ? 'page-refused' : unconfirmed ? 'page-unconfirmed' : 'page-other'
  return { kind: 'end', label, alertType: isError ? 'error' : alertTypeOf(a), text: a.text }
}

function bootDecision(boot, table) {
  // the answered offer screen and any screen without an enabled button (a screen that is only working) wait for the dispatch
  if (boot.enabledKeys.length === 0) return { kind: 'none' }
  const heading = normText(boot.heading)
  const text = [boot.heading, ...boot.paragraphs, boot.details ?? ''].filter(Boolean).join(' | ')
  if (!table.blockedTitles.includes(heading)) return { kind: 'end', label: 'page-other', alertType: 'boot', text }
  let reason = null
  let detail = null
  for (const head of table.detailsHeadings) {
    const m = new RegExp('^' + head.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:\\s*([a-z][a-z0-9-]*)\\s*:\\s*(.*)$').exec(normText(boot.details ?? ''))
    if (m !== null) { reason = m[1]; detail = m[2]; break }
  }
  return { kind: 'end', label: 'page-blocked', alertType: 'boot', text, blockedReason: reason, blockedDetail: detail }
}

/**
 * One probe (PROBE_EXPRESSION's value) against the table. Returns { kind: 'none' | 'progress' | 'answer' | 'end', ... }; an end
 * carries label, alertType (error, confirm, wait, normal, boot) and the recorded text, and a blocked screen its parsed reason.
 * Several surfaces at once: an end beats an answer beats progress. Nothing but a whitelisted confirm is ever to be answered.
 */
export function classifyProbe(probe, table) {
  const decisions = []
  for (const a of probe.alerts ?? []) decisions.push(alertDecision(a, table))
  if (probe.boot) decisions.push(bootDecision(probe.boot, table))
  const end = decisions.find((d) => d.kind === 'end')
  if (end) return end
  if (decisions.some((d) => d.kind === 'answer')) return { kind: 'answer' }
  if (decisions.some((d) => d.kind === 'progress')) return { kind: 'progress' }
  return { kind: 'none' }
}
//#endregion

//#region stop classes
export const BREAKING_CLASSES = new Set(['renderer-crash', 'page-error', 'page-unconfirmed', 'page-blocked', 'page-refused', 'page-mismatch'])
export const PASSING_CLASSES = new Set(['ok', 'unverified', 'census-unverified'])
export const isBreaking = (cls) => BREAKING_CLASSES.has(cls)

/**
 * The class of a finished rung, from what was observed. Precedence: a crash or a Chrome exit, the host floor, a page end (an
 * app-shown end first; page-other after it), a cap, a census mismatch, a census tool failure after a good import, a tool failure,
 * then ok or unverified. evidence = { crashed, chromeExited, floorTripped, pageEnd (a label or null), cap ('cap-alive' |
 * 'cap-unresponsive' | null), importedHome, censusSkipped, censusMismatch, censusToolFailed, toolError }.
 */
export function classifyStop(ev) {
  if (ev.crashed || ev.chromeExited) return 'renderer-crash'
  if (ev.floorTripped) return 'host-floor'
  if (ev.pageEnd && ev.pageEnd !== 'page-other') return ev.pageEnd
  if (ev.pageEnd === 'page-other') return 'page-other'
  if (ev.cap) return ev.cap
  if (ev.importedHome && ev.censusMismatch) return 'page-mismatch'
  if (ev.importedHome && ev.censusToolFailed) return 'census-unverified'
  if (ev.toolError) return 'tool'
  if (ev.importedHome) return ev.censusSkipped ? 'unverified' : 'ok'
  return 'tool'
}
//#endregion

//#region census retry
/**
 * The V8 old-space limit of the census retry, in MiB: min(28672, free - floor - 2048). At or below 16384 (the first run's fixed
 * old space) the retry has no headroom and is skipped.
 */
export function censusRetryLimit(freeMiB, floorMiB) {
  const limitMiB = Math.min(28672, freeMiB - floorMiB - 2048)
  return { limitMiB, skipped: limitMiB <= 16384 }
}
//#endregion

//#region ladder verdict
const textOf = (a) => (a.atFailure && a.atFailure.alertText ? ' [' + (a.atFailure.alertType ?? '?') + ': ' + String(a.atFailure.alertText).slice(0, 400) + ']' : '')
const describe = (a) => a.class + textOf(a)

/**
 * What the ladder does after the last attempt of `attempts` (every attempt in order: { median, class, why, atFailure }).
 * Returns { action: 'continue' | 'rerun' | 'stop', verdict: string | null, note: string | null }.
 * - A breaking class re-runs the rung once under `confirm`; two breaking outcomes are a BREAKING POINT, and a pass on the re-run
 *   is noted unconfirmed-failure. Without `confirm` the first breaking outcome is the BREAKING POINT.
 * - page-other (re-run once under `confirm` the same way) ends as PAGE ENDED and is never a breaking point.
 * - ok, unverified and census-unverified continue; a cap stops as STALLED; the host floor and a second tool failure stop as
 *   UNRESOLVED above the previous rung; a first tool failure re-runs the rung once.
 * - `planned` (the rung list) lets the last passing rung say "no breaking point up to rung X".
 */
export function ladderVerdict(attempts, { confirm = false, planned = [] } = {}) {
  const last = attempts[attempts.length - 1]
  const sameRung = attempts.filter((a) => a.median === last.median)
  const prev = sameRung.length > 1 ? sameRung[sameRung.length - 2] : null
  const earlier = [...new Set(attempts.map((a) => a.median))].filter((m) => m !== last.median)
  const below = earlier.length ? earlier[earlier.length - 1] : 'none'
  const cls = last.class
  if (PASSING_CLASSES.has(cls)) {
    const note = prev !== null && !PASSING_CLASSES.has(prev.class) ? 'unconfirmed-failure: rung ' + last.median + ' failed once (' + prev.class + ') and passed on the re-run' : null
    if (planned.length > 0 && last.median === planned[planned.length - 1]) return { action: 'stop', verdict: 'no breaking point up to rung ' + last.median, note }
    return { action: 'continue', verdict: null, note }
  }
  if (isBreaking(cls)) {
    const breaking = sameRung.filter((a) => isBreaking(a.class))
    if (!confirm) return { action: 'stop', verdict: 'BREAKING POINT at rung ' + last.median + ' (' + describe(last) + ') (unconfirmed, no --confirm-failure)', note: null }
    if (breaking.length >= 2) return { action: 'stop', verdict: 'BREAKING POINT at rung ' + last.median + ' (' + breaking.map((a) => a.class).join(', ') + '): ' + breaking.map((a, i) => 'attempt ' + (i + 1) + ' ' + describe(a)).join('; '), note: null }
    if (sameRung.length < 3) return { action: 'rerun', verdict: null, note: null }
    return { action: 'stop', verdict: 'BREAKING POINT at rung ' + last.median + ' (' + describe(last) + ') (one confirming outcome only)', note: null }
  }
  if (cls === 'page-other') {
    const earlierOther = sameRung.filter((a) => a.class === 'page-other')
    if (confirm && earlierOther.length < 2 && sameRung.length < 3) return { action: 'rerun', verdict: null, note: null }
    return { action: 'stop', verdict: 'PAGE ENDED at rung ' + last.median + ' (page-other): not a breaking point until a human reads atFailure.alertText; ' + earlierOther.map((a, i) => 'attempt ' + (i + 1) + ' ' + describe(a)).join('; '), note: null }
  }
  if (cls === 'cap-alive' || cls === 'cap-unresponsive') return { action: 'stop', verdict: 'STALLED at rung ' + last.median + ' (' + cls + ')', note: null }
  if (cls === 'host-floor') return { action: 'stop', verdict: 'UNRESOLVED above rung ' + below + ' (host floor at rung ' + last.median + ')', note: null }
  if (cls === 'tool') {
    if (prev !== null && prev.class === 'tool') return { action: 'stop', verdict: 'UNRESOLVED above rung ' + below + ' (tool: ' + String(last.why ?? 'unknown').slice(0, 300) + ')', note: null }
    return { action: 'rerun', verdict: null, note: null }
  }
  return { action: 'stop', verdict: 'UNRESOLVED above rung ' + below + ' (unknown class ' + cls + ')', note: null }
}
//#endregion
