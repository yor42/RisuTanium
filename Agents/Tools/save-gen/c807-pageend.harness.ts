// @vitest-environment node
/**
 * CHORE-807 stage 1 (measurement tooling, diagnostic; not a regression test): the pure page-end classifier, the stop classes and the
 * ladder verdict of the G4 import ladder (Agents/Tools/node-scale/c807-pageend.mjs).
 *
 * T4s builds every probe from the app's own English and Korean strings (src/lang/en.ts and ko.ts, imported), and builds the
 * classifier's table from the text of those two files, so a reworded app string turns a row red instead of silently falling to
 * page-other. T4v is a table over classifyStop and ladderVerdict. No Chrome, no server, no file is written.
 *
 * Run (from the repo root; name this one file, never the whole folder: a folder run rewrites golden fixtures):
 *   npx --no-install vitest run --config Agents/Tools/vitest.harness.config.ts Agents/Tools/save-gen/c807-pageend.harness.ts
 *
 * C807_PAGEEND_MODULE=<file> runs the same rows against a mutated scratch copy of c807-pageend.mjs; it is honoured only for a file
 * under the c807 run root in the temp folder.
 */
import { beforeAll, describe, expect, test } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { languageEnglish } from '../../../src/lang/en'
import { languageKorean } from '../../../src/lang/ko'

interface AlertProbe { h2: string, text: string, buttons: string[], progress: boolean }
interface BootProbe { heading: string, paragraphs: string[], details: string | null, enabledKeys: string[], disabledKeys: string[] }
interface Probe { alerts: AlertProbe[], boot: BootProbe | null }
interface Decision { kind: string, label?: string, alertType?: string, text?: string, blockedReason?: string | null }
interface Attempt { median: number, class: string, why?: string, atFailure?: { alertType: string, alertText: string } }
interface Verdict { action: string, verdict: string | null, note: string | null }
interface PageEnd {
    tableFromLangSource(sources: string[]): { unconfirmedTexts: string[], progress: RegExp[] }
    classifyProbe(probe: Probe, table: unknown): Decision
    classifyStop(evidence: Record<string, unknown>): string
    ladderVerdict(attempts: Attempt[], options: { confirm?: boolean, planned?: number[] }): Verdict
    isBreaking(cls: string): boolean
    censusRetryLimit(freeMiB: number, floorMiB: number): { limitMiB: number, skipped: boolean }
}

const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HARNESS_DIR, '..', '..', '..')
const C807_ROOT = path.resolve(os.tmpdir(), 'risu-b715', 'b61', 'c807')

function moduleUnderTest(): string {
    const override = process.env.C807_PAGEEND_MODULE
    if (override) {
        const full = path.resolve(override)
        if (!full.toLowerCase().startsWith(C807_ROOT.toLowerCase() + path.sep)) {
            throw new Error('C807_PAGEEND_MODULE must lie under ' + C807_ROOT + ': ' + full)
        }
        return full
    }
    return path.join(REPO_ROOT, 'Agents', 'Tools', 'node-scale', 'c807-pageend.mjs')
}

let mod: PageEnd
let table: ReturnType<PageEnd['tableFromLangSource']>
const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

beforeAll(async () => {
    mod = await import(/* @vite-ignore */ pathToFileURL(moduleUnderTest()).href) as PageEnd
    table = mod.tableFromLangSource([
        fs.readFileSync(path.join(REPO_ROOT, 'src', 'lang', 'en.ts'), 'utf8'),
        fs.readFileSync(path.join(REPO_ROOT, 'src', 'lang', 'ko.ts'), 'utf8'),
    ])
})

//#region probes built from the app's own strings
const languages = [
    ['en', languageEnglish, ['YES', 'NO']],
    ['ko', languageKorean, ['예', '아니오']],
] as const

const box = (h2: string, text: string, buttons: string[]): AlertProbe => ({ h2, text: norm([h2, text, ...buttons].join(' ')), buttons, progress: false })
const probe = (alerts: AlertProbe[], boot: BootProbe | null = null): Probe => ({ alerts, boot })
const boot = (heading: string, paragraphs: string[], details: string | null, enabledKeys: string[], disabledKeys: string[] = []): BootProbe => ({ heading, paragraphs, details, enabledKeys, disabledKeys })

/** The progress texts the import path shows, with example numbers (backuplocal.ts, boot branch of LoadLocalBackup). */
const PROGRESS_TEXTS = [
    'Checking local backup... (0.00%)', 'Checking local backup... (100.00%)', 'Reading the database in the backup...',
    'Loading local Backup... (37.52%)', 'Finishing copying files...', 'Loading backup...',
]
//#endregion

describe('T4s page-end classifier (pure table, app strings)', () => {
    describe.each(languages)('%s', (_name, lang, [yes, no]) => {
        test('an error box is page-error', () => {
            const d = mod.classifyProbe(probe([box(lang.error, 'Failed, Is file corrupted?', ['OK'])]), table)
            expect(d.kind).toBe('end')
            expect(d.label).toBe('page-error')
            expect(d.alertType).toBe('error')
            expect(d.text).toContain('Failed, Is file corrupted?')
        })

        test('a buttonless wait with the unconfirmed text is page-unconfirmed', () => {
            const d = mod.classifyProbe(probe([box('', lang.store2ImportUnconfirmed, [])]), table)
            expect(d.kind).toBe('end')
            expect(d.label).toBe('page-unconfirmed')
            expect(d.alertType).toBe('wait')
        })

        test('the incomplete-data confirmation is page-refused and not answered', () => {
            const d = mod.classifyProbe(probe([box('', lang.store2ImportIncompleteConfirm('- x'), [yes, no])]), table)
            expect(d.kind).toBe('end')
            expect(d.label).toBe('page-refused')
            expect(d.alertType).toBe('confirm')
        })

        test('the boot blocked screen is page-blocked with its reason parsed', () => {
            for (const reason of ['install-unknown', 'install-upload-failed']) {
                const text = lang.store2Boot
                const d = mod.classifyProbe(probe([], boot(text.blockedTitle, [text.blockedInstall], `${text.blockedDetailsHeading}: ${reason}: connection reset`, ['reload'])), table)
                expect(d.kind).toBe('end')
                expect(d.label).toBe('page-blocked')
                expect(d.alertType).toBe('boot')
                expect(d.blockedReason).toBe(reason)
            }
        })

        test('every progress text of the import path is progress', () => {
            for (const text of [...PROGRESS_TEXTS, lang.restoreCheckingOtherTabs, lang.store2ImportDone]) {
                expect(mod.classifyProbe(probe([box('', text, [])]), table).kind, text).toBe('progress')
            }
        })

        test('the answered offer screen and a screen without an enabled button are none', () => {
            const text = lang.store2Boot
            const answered = boot(text.offerTitle, [text.working], null, [], ['offerRestoreNewest', 'offerImport'])
            expect(mod.classifyProbe(probe([], answered), table).kind).toBe('none')
            expect(mod.classifyProbe(probe([], boot(text.recoveryWorkingTitle, [text.working], null, [])), table).kind).toBe('none')
        })

        test('the size, time and space warnings are answered', () => {
            const warnings = [lang.store2ImportSizeWarning(5, true), lang.store2ImportTimeWarning(12, 3, 2, 5), lang.store2ImportSpaceWarning(3, 1, 5)]
            for (const text of warnings) {
                expect(mod.classifyProbe(probe([box('', text, [yes, no])]), table).kind).toBe('answer')
            }
        })

        test('anything else ends as page-other: unknown wait, normal notice, unknown confirm, progress text with a button, other boot screen', () => {
            const text = lang.store2Boot
            const rows: Probe[] = [
                probe([box('', 'Something is happening that nobody listed.', [])]),
                probe([box('', 'Some assets were skipped.', ['OK'])]),
                probe([box('', 'Delete everything?', [yes, no])]),
                probe([box('', 'Loading backup...', ['Cancel'])]),
                probe([], boot(text.offerTitle, [text.offerBody(1, '2026-01-01')], null, ['offerRestoreNewest', 'offerImport'])),
            ]
            for (const row of rows) {
                const d = mod.classifyProbe(row, table)
                expect(d.kind, JSON.stringify(row)).toBe('end')
                expect(d.label, JSON.stringify(row)).toBe('page-other')
            }
        })
    })

    test('nothing shown is none', () => {
        expect(mod.classifyProbe(probe([]), table).kind).toBe('none')
    })

    test('an end beats progress and an answer when several surfaces show', () => {
        const mixed = probe([box('', 'Loading backup...', []), box('', languageEnglish.store2ImportUnconfirmed, [])])
        expect(mod.classifyProbe(mixed, table).label).toBe('page-unconfirmed')
        const withAnswer = probe([box('', languageEnglish.store2ImportSizeWarning(5, true), ['Yes', 'No']), box('', 'unlisted', [])])
        expect(mod.classifyProbe(withAnswer, table).label).toBe('page-other')
    })

    test('the table is read from the language files, not typed here', () => {
        for (const lang of [languageEnglish, languageKorean]) {
            expect(table.unconfirmedTexts).toContain(norm(lang.store2ImportUnconfirmed))
            expect(table.progress.some((re) => re.test(norm(lang.store2ImportDone)))).toBe(true)
            expect(table.progress.some((re) => re.test(norm(lang.restoreCheckingOtherTabs)))).toBe(true)
        }
    })
})

describe('T4v stop classes and the ladder verdict (pure table)', () => {
    const base = { crashed: false, chromeExited: false, floorTripped: false, pageEnd: null, cap: null, importedHome: false, censusSkipped: false, censusMismatch: false, censusToolFailed: false, toolError: null }
    const stop = (over: Record<string, unknown>) => mod.classifyStop({ ...base, ...over })

    test('classifyStop: every class, in precedence order', () => {
        expect(stop({ importedHome: true })).toBe('ok')
        expect(stop({ importedHome: true, censusSkipped: true })).toBe('unverified')
        expect(stop({ importedHome: true, censusMismatch: true })).toBe('page-mismatch')
        expect(stop({ importedHome: true, censusToolFailed: true })).toBe('census-unverified')
        expect(stop({ toolError: 'generator failed' })).toBe('tool')
        expect(stop({})).toBe('tool')
        expect(stop({ cap: 'cap-alive' })).toBe('cap-alive')
        expect(stop({ cap: 'cap-unresponsive' })).toBe('cap-unresponsive')
        expect(stop({ pageEnd: 'page-other' })).toBe('page-other')
        for (const label of ['page-error', 'page-unconfirmed', 'page-blocked', 'page-refused']) expect(stop({ pageEnd: label })).toBe(label)
        expect(stop({ floorTripped: true })).toBe('host-floor')
        expect(stop({ crashed: true })).toBe('renderer-crash')
        expect(stop({ chromeExited: true })).toBe('renderer-crash')
        // precedence: crash over floor over page end over cap over mismatch over census tool failure over tool
        expect(stop({ crashed: true, floorTripped: true, pageEnd: 'page-error' })).toBe('renderer-crash')
        expect(stop({ floorTripped: true, pageEnd: 'page-error', cap: 'cap-alive' })).toBe('host-floor')
        expect(stop({ pageEnd: 'page-other', cap: 'cap-alive', toolError: 'x' })).toBe('page-other')
        expect(stop({ pageEnd: 'page-error', importedHome: true, censusMismatch: true })).toBe('page-error')
        expect(stop({ cap: 'cap-alive', importedHome: true, censusMismatch: true })).toBe('cap-alive')
        expect(stop({ importedHome: true, censusMismatch: true, censusToolFailed: true, toolError: 'x' })).toBe('page-mismatch')
        expect(stop({ importedHome: true, censusToolFailed: true, toolError: 'x' })).toBe('census-unverified')
    })

    test('breaking classes: crash, error, unconfirmed, blocked, refused and mismatch; nothing else', () => {
        for (const cls of ['renderer-crash', 'page-error', 'page-unconfirmed', 'page-blocked', 'page-refused', 'page-mismatch']) expect(mod.isBreaking(cls), cls).toBe(true)
        for (const cls of ['page-other', 'cap-alive', 'cap-unresponsive', 'host-floor', 'tool', 'census-unverified', 'ok', 'unverified']) expect(mod.isBreaking(cls), cls).toBe(false)
    })

    test('the census retry limit is min(28672, free - floor - 2048) MiB and is skipped at or below 16384', () => {
        expect(mod.censusRetryLimit(60000, 8192)).toEqual({ limitMiB: 28672, skipped: false })
        expect(mod.censusRetryLimit(30000, 8192)).toEqual({ limitMiB: 19760, skipped: false })
        expect(mod.censusRetryLimit(26625, 8192)).toEqual({ limitMiB: 16385, skipped: false })
        expect(mod.censusRetryLimit(26624, 8192)).toEqual({ limitMiB: 16384, skipped: true })
        expect(mod.censusRetryLimit(19216, 4096)).toEqual({ limitMiB: 13072, skipped: true })
    })

    const a = (median: number, cls: string, atFailure?: { alertType: string, alertText: string }, why?: string): Attempt => ({ median, class: cls, atFailure, why })
    const verdict = (attempts: Attempt[], confirm = false, planned: number[] = [6, 8]) => mod.ladderVerdict(attempts, { confirm, planned })

    test('passing classes continue; the top rung ends the ladder with no breaking point', () => {
        for (const cls of ['ok', 'unverified', 'census-unverified']) expect(verdict([a(6, cls)]).action, cls).toBe('continue')
        const top = verdict([a(6, 'ok'), a(8, 'ok')])
        expect(top.action).toBe('stop')
        expect(top.verdict).toBe('no breaking point up to rung 8')
    })

    test('a breaking class re-runs once under --confirm-failure and is a BREAKING POINT on two outcomes, carrying both alert texts', () => {
        const first = a(8, 'page-blocked', { alertType: 'boot', alertText: 'FIRST-TEXT' })
        expect(verdict([a(6, 'ok'), first], true).action).toBe('rerun')
        const second = a(8, 'page-error', { alertType: 'error', alertText: 'SECOND-TEXT' })
        const done = verdict([a(6, 'ok'), first, second], true)
        expect(done.action).toBe('stop')
        expect(done.verdict).toMatch(/^BREAKING POINT at rung 8 \(page-blocked, page-error\)/)
        expect(done.verdict).toContain('FIRST-TEXT')
        expect(done.verdict).toContain('SECOND-TEXT')
        const unconfirmed = verdict([a(6, 'ok'), first, a(8, 'ok')], true, [6, 8, 10])
        expect(unconfirmed.action).toBe('continue')
        expect(unconfirmed.note).toMatch(/unconfirmed-failure/)
        expect(verdict([a(6, 'ok'), first], false).verdict).toMatch(/^BREAKING POINT at rung 8/)
    })

    test('refused, crash and mismatch are breaking points', () => {
        for (const cls of ['page-refused', 'renderer-crash', 'page-mismatch', 'page-unconfirmed']) {
            expect(verdict([a(6, 'ok'), a(8, cls)], false).verdict, cls).toMatch(/^BREAKING POINT at rung 8/)
        }
    })

    test('page-other stops as PAGE ENDED and is never a BREAKING POINT; it re-runs once under --confirm-failure', () => {
        const other = a(8, 'page-other', { alertType: 'normal', alertText: 'A NOTICE' })
        const alone = verdict([a(6, 'ok'), other], false)
        expect(alone.action).toBe('stop')
        expect(alone.verdict).toMatch(/^PAGE ENDED at rung 8 \(page-other\): not a breaking point until a human reads atFailure\.alertText/)
        expect(alone.verdict).not.toMatch(/BREAKING POINT/)
        expect(verdict([a(6, 'ok'), other], true).action).toBe('rerun')
        const twice = verdict([a(6, 'ok'), other, other], true)
        expect(twice.action).toBe('stop')
        expect(twice.verdict).toMatch(/^PAGE ENDED/)
        expect(twice.verdict).toContain('A NOTICE')
    })

    test('a cap stops as STALLED, never as a breaking point', () => {
        expect(verdict([a(6, 'ok'), a(8, 'cap-alive')]).verdict).toBe('STALLED at rung 8 (cap-alive)')
        expect(verdict([a(6, 'ok'), a(8, 'cap-unresponsive')]).verdict).toBe('STALLED at rung 8 (cap-unresponsive)')
    })

    test('the host floor and a second tool failure stop as UNRESOLVED above the previous rung; a first tool failure re-runs', () => {
        expect(verdict([a(6, 'ok'), a(8, 'host-floor')]).verdict).toBe('UNRESOLVED above rung 6 (host floor at rung 8)')
        expect(verdict([a(6, 'ok'), a(8, 'tool', undefined, 'generator failed')]).action).toBe('rerun')
        const second = verdict([a(6, 'ok'), a(8, 'tool'), a(8, 'tool', undefined, 'generator failed')])
        expect(second.action).toBe('stop')
        expect(second.verdict).toBe('UNRESOLVED above rung 6 (tool: generator failed)')
    })
})
