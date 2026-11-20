// @vitest-environment node
/**
 * Guards for the aggregate-only `.bin` analyzer (analyzer/*.ts) and its real-run entry.
 *
 * The analyzer reads a `.bin` through the application's own import reader, so the application's storage modules are
 * mocked below, in this one file, exactly like the CHORE-807 census harness. The analyzer modules are loaded from
 * LTM_IMPL_DIR (default: analyzer/ beside this file) so that scratch mutants can replace them.
 *
 * Real run: only through `node Agents/Tools/ltm-eval/run-real.mjs` (see the README). Run directly, the real-run suite
 * skips. Everything else here uses synthetic data only.
 */
import { afterAll, describe, expect, test, vi } from 'vitest'
import type { ForageLike } from 'src/ts/storage/tests/forageBackedStore'

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => { }), removeItem: vi.fn(async () => { }) }) },
}))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => { }), removeItem: vi.fn(async () => { }) },
    getSaveMarkCount: () => 0,
    isSaveClean: () => true,
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { appStoreModuleOver } = await import('src/ts/storage/tests/appStoreMock')
    const { forageStorage } = await import('src/ts/globalApi.svelte')
    return appStoreModuleOver(() => forageStorage as unknown as ForageLike) as unknown as typeof import('src/ts/storage/store/appStore')
})
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/platform'), () => ({ isTauri: false, isNodeServer: true }))
vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 },
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('src/ts/alert', () => ({
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertNormalWait: vi.fn(async () => { }),
    alertWait: vi.fn(),
    alertStore: { set: vi.fn(), subscribe: vi.fn() },
    waitAlert: vi.fn(async () => { }),
}))
const inert = vi.hoisted(() => (): Record<string, unknown> => new Proxy({}, {
    has: () => true,
    get: (_target, name) => name === 'then' ? undefined : (name === 'alertStore' ? {} : () => undefined),
}))
vi.mock('src/ts/process/coldstorage.svelte', inert)
vi.mock('src/ts/drive/restoreReplace', inert)
vi.mock('src/ts/drive/backupWorkGuard', () => ({ refuseBackupLoadWhileBusy: () => false }))
vi.mock('src/ts/storage/store2/saveActive', () => ({ getActiveStore2Save: () => null }))

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { encodeBackupEntryHeader } from 'src/ts/exportWriters'
import { RisuSaveEncoder, RisuSaveType, encodeRisuSaveStreamed, type toSaveType } from 'src/ts/storage/risuSave'
import type { Database } from 'src/ts/storage/database.svelte'
import { HANGUL_BANDS, LORE_CONTENT_EDGES, LORE_ENTRIES_EDGES, MESSAGE_LENGTH_EDGES, MESSAGES_PER_CHAT_EDGES, REGEX_SCRIPTS_EDGES, ROLES, SHAPE } from './analyzer/schema'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..', '..')
const IMPL_DIR = process.env.LTM_IMPL_DIR ? path.resolve(process.env.LTM_IMPL_DIR) : path.join(HERE, 'analyzer')
const EVAL_DIR = process.env.LTM_EVAL_DIR ? path.resolve(process.env.LTM_EVAL_DIR) : HERE
const LTM_ROOT = path.resolve(process.env.LTM_ROOT ?? path.join(os.tmpdir(), 'risu-b715', 'b61', 'ltm-p0', 'run'))
const LTM_BIN = process.env.LTM_BIN ?? ''
const LTM_OUT = process.env.LTM_OUT ?? ''
const SEALED = process.env.LTM_SEALED === '1'

type AggregateModule = typeof import('./analyzer/aggregate')
type AllowListModule = typeof import('./analyzer/allowList')
type RunPathsModule = typeof import('./analyzer/runPaths')
type BinReadModule = typeof import('./analyzer/binRead')
type SealModule = typeof import('./analyzer/seal')
type StatusModule = typeof import('./analyzer/status')
type LtmAggregates = import('./analyzer/aggregate').LtmAggregates

const load = <T>(file: string): Promise<T> => import(/* @vite-ignore */ pathToFileURL(path.join(IMPL_DIR, file)).href) as Promise<T>
const impl = {
    aggregate: await load<AggregateModule>('aggregate.ts'),
    allowList: await load<AllowListModule>('allowList.ts'),
    runPaths: await load<RunPathsModule>('runPaths.ts'),
    binRead: await load<BinReadModule>('binRead.ts'),
    seal: await load<SealModule>('seal.ts'),
    status: await load<StatusModule>('status.ts'),
}

const scratch: string[] = []
const makeTmp = (label: string): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ltm-ana-' + label + '-'))
    scratch.push(dir)
    return dir
}
afterAll(() => {
    for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true })
})

// ---- the recorder: test-only capture of every channel the seal covers; it forwards nothing

type Recording = { text: string; calls: number }

/** Replaces the console, stdout, stderr and emitWarning with text collectors for the duration of `fn`. */
async function recordOutput<T>(fn: () => Promise<T>): Promise<{ result: T | undefined; failed: boolean; recording: Recording }> {
    const recording: Recording = { text: '', calls: 0 }
    const restores: Array<() => void> = []
    const swap = (target: object, name: string) => {
        const holder = target as Record<string, unknown>
        const own = Object.prototype.hasOwnProperty.call(target, name)
        const original = holder[name]
        holder[name] = (...args: unknown[]) => {
            recording.calls += 1
            recording.text += args.map((a) => String(a)).join(' ') + '\n'
            return true
        }
        restores.push(() => { if (own) holder[name] = original; else delete holder[name] })
    }
    const names = new Set<string>(Object.getOwnPropertyNames(console))
    for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(console) ?? {})) names.add(name)
    names.delete('constructor')
    for (const name of names) if (typeof (console as unknown as Record<string, unknown>)[name] === 'function') swap(console, name)
    swap(process.stdout, 'write')
    swap(process.stderr, 'write')
    swap(process, 'emitWarning')
    try {
        return { result: await fn(), failed: false, recording }
    } catch {
        return { result: undefined, failed: true, recording }
    } finally {
        for (const restore of restores.reverse()) restore()
    }
}

const TOKEN_RE = /plnt|플랜트비밀이름/i
const expectNoToken = (text: string, what: string): void => {
    expect(TOKEN_RE.test(text), what + ' carries no planted token').toBe(false)
}

// ---- hand-written expectation helpers

const sparse = (edges: readonly number[], at: Record<number, number>): number[] => edges.map((_, i) => at[i] ?? 0)
const H = (edges: readonly number[], at: Record<number, number>, n: number, p50: number, p90: number, p99: number, max: number) =>
    ({ edges: [...edges], counts: sparse(edges, at), n, p50, p90, p99, max })
const EMPTY = (edges: readonly number[]) => H(edges, {}, 0, 0, 0, 0, 0)

type Dbish = Pick<Database, 'characters' | 'modules' | 'enabledModules'>
const asDb = (value: object): Dbish => value as unknown as Dbish
const lore = (content: string, extra: Record<string, unknown> = {}) =>
    ({ key: '', secondkey: '', insertorder: 100, comment: '', content, mode: 'normal', alwaysActive: false, selective: false, ...extra })
const msg = (role: string, data: unknown, extra: Record<string, unknown> = {}) => ({ role, data, ...extra })

// ---- B1, B4, B6: shape checker, writer, path guards

describe('allow-list', () => {
    const empty = () => impl.aggregate.aggregateDatabase(asDb({ characters: [], modules: [], enabledModules: [] }))
    const clone = (): Record<string, unknown> => JSON.parse(JSON.stringify(empty())) as Record<string, unknown>

    test('B1: a conforming object passes; every non-conforming shape is refused without echoing the data', () => {
        expect(impl.allowList.checkAggregates(empty())).toEqual([])
        const cases: Record<string, (o: Record<string, unknown>) => void> = {
            extraTopKey: (o) => { o['PLNT-EXTRA-KEY'] = 1 },
            extraNestedKey: (o) => { (o.totals as Record<string, unknown>)['PLNT-NESTED-KEY'] = 1 },
            stringLeaf: (o) => { (o.totals as Record<string, unknown>).characters = 'PLNT-STRING-VALUE' },
            stringInCounts: (o) => { (o.messagesPerChat as { counts: unknown[] }).counts[0] = 'PLNT-IN-COUNTS' },
            booleanLeaf: (o) => { o.hiddenShare = true },
            nullLeaf: (o) => { o.hiddenShare = null },
            nanLeaf: (o) => { o.hiddenShare = Number.NaN },
            infinityLeaf: (o) => { o.hiddenShare = Number.POSITIVE_INFINITY },
            missingKey: (o) => { delete (o.totals as Record<string, unknown>).messages },
            objectAtLeaf: (o) => { o.hiddenShare = { PLNT: 1 } },
            leafAtObject: (o) => { o.totals = 5 },
        }
        for (const [label, mutate] of Object.entries(cases)) {
            const o = clone()
            mutate(o)
            const violations = impl.allowList.checkAggregates(o)
            expect(violations.length, label).toBeGreaterThanOrEqual(1)
            expectNoToken(violations.join('\n'), label)
        }
    })

    test('B4: the writer refuses a non-conforming object and writes nothing; a valid one is written and passes', () => {
        const dir = makeTmp('b4')
        const bad = { ...clone(), leak: 'x' }
        expect(() => impl.binRead.writeAggregates(dir, bad)).toThrow(/output refused/)
        expect(fs.readdirSync(dir)).toEqual([])
        impl.binRead.writeAggregates(dir, empty())
        const written = JSON.parse(fs.readFileSync(path.join(dir, 'ltm-aggregates.json'), 'utf8')) as unknown
        expect(impl.allowList.checkAggregates(written)).toEqual([])
    })

    test('B1: SHAPE has no string-valued leaf of its own kind: every leaf is a number kind', () => {
        const kinds = new Set<string>()
        const walk = (shape: unknown): void => {
            if (typeof shape === 'string') kinds.add(shape)
            else for (const child of Object.values(shape as Record<string, unknown>)) walk(child)
        }
        walk(SHAPE)
        expect([...kinds].sort()).toEqual(['n', 'n[]'])
    })
})

describe('run paths', () => {
    test('B6: the guards refuse an in-repository .bin, an out folder outside ROOT and a ROOT inside the repository', () => {
        const root = makeTmp('b6')
        const bin = path.join(root, 'x.bin')
        const out = path.join(root, 'out')
        const repoRoot = REPO_ROOT
        expect(impl.runPaths.checkRunPaths({ bin, out, root, repoRoot })).toEqual([])
        expect(impl.runPaths.checkRunPaths({ bin: path.join(repoRoot, 'x.bin'), out, root, repoRoot }).length).toBeGreaterThanOrEqual(1)
        expect(impl.runPaths.checkRunPaths({ bin, out: path.join(os.tmpdir(), 'ltm-b6-elsewhere'), root, repoRoot }).length).toBeGreaterThanOrEqual(1)
        const inRepo = path.join(repoRoot, 'Agents')
        expect(impl.runPaths.checkRunPaths({ bin: path.join(inRepo, 'a.bin'), out: path.join(inRepo, 'o'), root: inRepo, repoRoot }).length).toBeGreaterThanOrEqual(3)
        expect(impl.runPaths.isInside(path.join(root, 'a'), root)).toBe(true)
        expect(impl.runPaths.isInside(root + '-sibling', root)).toBe(false)
    })
})

// ---- B2: exact counts on a handcrafted database

describe('aggregateDatabase', () => {
    test('B2: counts, histograms and decorator statistics equal the hand-written expectation', () => {
        const loreA = [
            lore('@@depth 4\n@@@role user\nbody one', { selective: true }),
            lore('@@xdecor\n@@@role user\nbody', { mode: 'constant', useRegex: true, alwaysActive: true }),
            lore('@@depth x\n@@@role user\n@@@depth 2\nb', { mode: 'multiple', selective: true }),
            lore('@@role narrator\n@@@depth 3\nb', { mode: 'child' }),
            lore('@@keep_activate_after_match\n@@@xdecor\n@@@position after_desc\nb', { mode: 'weird' }),
            lore('@@@role user\nb'),
            lore('@@@end\nb', { alwaysActive: true }),
            lore('@@position\nb'),
            lore('@@depth 1\n@@probability 50'),
            lore('folder text', { mode: 'folder' }),
        ]
        const chatA1 = {
            message: [
                msg('user', 'hello world'),
                msg('char', '안녕하세요 반갑습니다'),
                msg('user', 'ab 가'),
                msg('char', 'x', { disabled: true }),
                msg('user', 'reset', { disabled: 'allBefore' }),
                msg('char', 'later'),
                msg('user', 'z', { disabled: true }),
                msg('user', 123),
                msg('char', 'a가가가가'),
            ],
            localLore: [lore('abc'), lore('f', { mode: 'folder' })],
            alt: [{ m: msg('user', 'a'), p: null, a: 1 }, { m: msg('char', 'b'), p: null, a: 2 }],
        }
        const db = asDb({
            characters: [
                { type: 'character', chats: [chatA1, { message: [], localLore: [] }], globalLore: loreA, customscript: [{}] },
                { type: 'character', chats: [], globalLore: [], customscript: [{}, {}, {}] },
                { type: 'group', chats: [{ message: [msg('user', 'hi')], localLore: [] }], globalLore: [lore('')], customscript: [{}, {}] },
            ],
            modules: [
                { lorebook: [lore('@@depth 1\nbody')], regex: [{}, {}] },
                { regex: [] },
            ],
            enabledModules: ['x'],
        })
        const got = impl.aggregate.aggregateDatabase(db)
        const ML = MESSAGE_LENGTH_EDGES
        const expected: LtmAggregates = {
            schemaVersion: 1,
            totals: {
                characters: 2, groups: 1, chats: 3, messages: 10, messagesUser: 6, messagesChar: 4, nonStringMessageData: 1,
                hiddenMessages: 6, hiddenByFlag: 1, hiddenByReset: 5, altMessages: 2, modules: 2, enabledModules: 1,
                loreEntriesCharacter: 9, loreEntriesGroup: 1, loreEntriesChat: 1, loreEntriesModule: 1,
                regexScriptsGroup: 2, incompleteUnits: 0, omittedBlocks: 0,
            },
            hiddenShare: 0.6,
            hangulBandEdges: [0, 0.1, 0.5, 0.9],
            messageLength: {
                edges: [...ML],
                byRole: {
                    user: H(ML, { 0: 5 }, 5, 4, 11, 11, 11),
                    char: H(ML, { 0: 4 }, 4, 5, 11, 11, 11),
                },
                byHangulBand: {
                    none: H(ML, { 0: 6 }, 6, 2, 11, 11, 11),
                    low: H(ML, { 0: 1 }, 1, 4, 4, 4, 4),
                    mixed: H(ML, { 0: 1 }, 1, 5, 5, 5, 5),
                    high: H(ML, { 0: 1 }, 1, 11, 11, 11, 11),
                },
                byRoleAndHangulBand: {
                    user: {
                        none: H(ML, { 0: 4 }, 4, 2, 11, 11, 11), low: H(ML, { 0: 1 }, 1, 4, 4, 4, 4),
                        mixed: EMPTY(ML), high: EMPTY(ML),
                    },
                    char: {
                        none: H(ML, { 0: 2 }, 2, 1, 5, 5, 5), low: EMPTY(ML),
                        mixed: H(ML, { 0: 1 }, 1, 5, 5, 5, 5), high: H(ML, { 0: 1 }, 1, 11, 11, 11, 11),
                    },
                },
            },
            messagesPerChat: H(MESSAGES_PER_CHAT_EDGES, { 0: 1, 1: 2 }, 3, 1, 9, 9, 9),
            loreEntriesPerCharacter: H(LORE_ENTRIES_EDGES, { 0: 1, 2: 1 }, 2, 0, 9, 9, 9),
            loreEntriesPerChat: H(LORE_ENTRIES_EDGES, { 0: 2, 1: 1 }, 3, 0, 1, 1, 1),
            loreEntriesPerModule: H(LORE_ENTRIES_EDGES, { 0: 1, 1: 1 }, 2, 0, 1, 1, 1),
            loreContentLength: H(LORE_CONTENT_EDGES, { 0: 11 }, 11, 1, 4, 8, 8),
            lore: {
                selective: 2, useRegex: 1, alwaysActive: 2, withDecorators: 9, decoratorLines: 15, decoratorThrows: 1,
                decorators: {
                    end: 1, activate_only_after: 0, activate_only_every: 0, keep_activate_after_match: 1, dont_activate_after_match: 0,
                    depth: 5, reverse_depth: 0, instruct_depth: 0, reverse_instruct_depth: 0, instruct_scan_depth: 0, role: 3,
                    scan_depth: 0, is_greeting: 0, position: 2, inject_lore: 0, inject_at: 0, inject_replace: 0, inject_prepend: 0,
                    ignore_on_max_context: 0, additional_keys: 0, exclude_keys: 0, exclude_keys_all: 0, match_full_word: 0,
                    match_partial_word: 0, is_user_icon: 0, activate: 0, dont_activate: 0, disable_ui_prompt: 0, probability: 1,
                    priority: 0, unrecursive: 0, recursive: 0, no_recursive_search: 0, other: 2,
                },
                mode: { normal: 8, constant: 1, multiple: 1, child: 1, folder: 2, other: 1 },
            },
            regexScriptsPerCharacter: H(REGEX_SCRIPTS_EDGES, { 1: 2 }, 2, 1, 3, 3, 3),
            regexScriptsPerModule: H(REGEX_SCRIPTS_EDGES, { 0: 1, 1: 1 }, 2, 0, 2, 2, 2),
        }
        expect(got).toEqual(expected)
        expect(HANGUL_BANDS.length).toBe(4)
        expect(ROLES.length).toBe(2)
    })
})

// ---- B5, B10: errors and status

describe('errors and status', () => {
    test('B5: safeStep rethrows a fixed message with indices only', async () => {
        const { safeStep, STEP, STEP_NAMES, ERROR_CLASSES, StepError } = impl.status
        const throwing = (value: unknown) => async () => { throw value }
        const named = new Error('PLNT-NAME-MSG')
        named.name = 'PLNT-NAME'
        const getter = new Error('PLNT-GETTER-MSG')
        Object.defineProperty(getter, 'name', { get() { throw new Error('PLNT-GETTER') } })
        const cases: Array<[unknown, string]> = [
            [new Error('PLNT-ERR-77'), 'Error'], [null, 'non-Error'], ['PLNT-STR', 'non-Error'], [named, 'other'], [getter, 'other'],
        ]
        for (const [thrown, cls] of cases) {
            const error = await safeStep(STEP.decode, throwing(thrown)).catch((e: unknown) => e)
            expect(error).toBeInstanceOf(StepError)
            const stepError = error as InstanceType<typeof StepError>
            expectNoToken(stepError.message, 'the message')
            expectNoToken(String(stepError.stack ?? '').split('\n')[0], 'the first stack line')
            expect(stepError.step).toBe(STEP.decode)
            expect(ERROR_CLASSES[stepError.errorClass]).toBe(cls)
            expect(stepError.message).toBe('ltm-eval: ' + STEP_NAMES[STEP.decode] + ' failed (' + cls + ')')
        }
        const critical = new (class CriticalBlockError extends Error {})('PLNT-CRIT')
        const crit = await safeStep(STEP.decode, throwing(critical)).catch((e: unknown) => e) as InstanceType<typeof StepError>
        expect(ERROR_CLASSES[crit.errorClass]).toBe('CriticalBlockError')
        const type = await safeStep(STEP.scan, throwing(new TypeError('PLNT-T'))).catch((e: unknown) => e) as InstanceType<typeof StepError>
        expect(ERROR_CLASSES[type.errorClass]).toBe('TypeError')
    })

    test('B5 case c: aggregation runs inside safeStep', async () => {
        const hostile = new Proxy([], { get() { throw new TypeError('PLNT-AGG') } })
        const error = await impl.binRead.analyzeTree(asDb({ characters: hostile, modules: [], enabledModules: [] }), 0, 0).catch((e: unknown) => e)
        expect(error).toBeInstanceOf(impl.status.StepError)
        const stepError = error as InstanceType<typeof impl.status.StepError>
        expect(stepError.step).toBe(impl.status.STEP.aggregate)
        expect(impl.status.ERROR_CLASSES[stepError.errorClass]).toBe('TypeError')
        expectNoToken(stepError.message, 'the message')
    })

    test('B10: degraded is 1 when a unit is incomplete or a block was omitted, else 0', () => {
        const counts = { console: 0, streams: 0, warnings: 0 }
        const ok = (incompleteUnits: number, omittedBlocks: number) =>
            impl.status.statusOf({ ok: true, value: { incompleteUnits, omittedBlocks }, counts })
        expect(ok(0, 0).degraded).toBe(0)
        expect(ok(1, 0).degraded).toBe(1)
        expect(ok(0, 2).degraded).toBe(1)
        expect(impl.allowList.checkShape(ok(0, 0), impl.status.STATUS_SHAPE)).toEqual([])
        const failed = impl.status.statusOf({ ok: false, failedStep: 3, errorClass: 4, counts })
        expect(failed).toMatchObject({ completed: 0, failedStep: 3, errorClass: 4 })
        expect(impl.allowList.checkShape(failed, impl.status.STATUS_SHAPE)).toEqual([])
    })
})

// ---- B8: the in-process seal

describe('output seal', () => {
    test('B8: every channel is swallowed and counted, and every replaced property is restored', async () => {
        let sealed: Awaited<ReturnType<typeof impl.seal.withSealedOutput<number>>> | undefined
        const notRestored: string[] = []
        const { recording } = await recordOutput(async () => {
            // Identity is checked inside the recorder window: the recorder restores its own originals afterwards and would hide a seal that does not.
            const consoleBefore = new Map<string, unknown>()
            for (const name of ['error', 'table', 'dir', 'log', 'warn', 'info', 'debug', 'trace', 'group']) consoleBefore.set(name, (console as unknown as Record<string, unknown>)[name])
            const before = { out: process.stdout.write, err: process.stderr.write, warn: process.emitWarning }
            sealed = await impl.seal.withSealedOutput<number>(() => {
                console.error('PLNT-S1')
                console.table([{ a: 'PLNT-S2' }])
                console.dir({ a: 'PLNT-S3' })
                process.stdout.write('PLNT-S4')
                process.stderr.write('PLNT-S5')
                process.emitWarning('PLNT-S6')
                throw new Error('PLNT-S7')
            })
            for (const [name, fn] of consoleBefore) if ((console as unknown as Record<string, unknown>)[name] !== fn) notRestored.push('console.' + name)
            if (process.stdout.write !== before.out) notRestored.push('stdout.write')
            if (process.stderr.write !== before.err) notRestored.push('stderr.write')
            if (process.emitWarning !== before.warn) notRestored.push('emitWarning')
        })
        expectNoToken(recording.text, 'the recorder')
        expect(sealed?.ok).toBe(false)
        expect(sealed?.counts).toEqual({ console: 3, streams: 2, warnings: 1 })
        expect(notRestored).toEqual([])
    })

    test('B8: a successful call returns its value and the counts', async () => {
        const r = await impl.seal.withSealedOutput(() => { console.log('PLNT-OK'); return 7 })
        expect(r).toEqual({ ok: true, value: 7, counts: { console: 1, streams: 0, warnings: 0 } })
    })
})

// ---- fixtures built with the application's own producers

const toSave = (): toSaveType => ({ character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false })

function backupFileOf(databaseEntry: Uint8Array): Uint8Array {
    const header = encodeBackupEntryHeader(new TextEncoder().encode('database.risudat'), databaseEntry.length)
    const out = new Uint8Array(header.length + databaseEntry.length)
    out.set(header, 0)
    out.set(databaseEntry, header.length)
    return out
}

function plantedStreamDatabase(): object {
    return {
        formatversion: 5,
        username: 'PLNT-USER-NAME',
        openAIKey: 'sk-PLNT-OPENAI',
        proxyKey: 'PLNT-PROXY-KEY',
        claudeAPIKey: 'sk-ant-PLNT-CLAUDE',
        mainPrompt: 'PLNT-MAIN-PROMPT',
        globalNote: 'PLNT-GLOBAL-NOTE',
        personaPrompt: 'PLNT-PERSONA',
        enabledModules: ['PLNT-MODID'],
        modules: [
            {
                id: 'PLNT-MODID', name: 'PLNT-MODULE-ONE', description: 'PLNT-MOD-DESC',
                lorebook: [lore('@@depth 2\n@@plntdecorsecret\nPLNT-MOD-LORE', { key: 'PLNT-MOD-KEY', comment: 'PLNT-MOD-COMMENT' }), lore('f', { mode: 'folder' })],
                regex: [{ comment: 'PLNT-RX-COMMENT', in: 'PLNT-RX-IN', out: 'PLNT-RX-OUT', type: 'editinput' }],
            },
            { id: 'PLNT-MODID-2', name: 'PLNT-MODULE-TWO', lorebook: [lore('x'), lore('y')], regex: [] },
        ],
        characters: [
            {
                type: 'character', name: 'PLNT-CHAR-ONE', chaId: 'plnt-cha-1', desc: 'PLNT-DESC', firstMessage: 'PLNT-FIRST',
                globalLore: [lore('@@depth 4\n@@plntdecorsecret\nPLNT-LORE-BODY', { key: 'PLNT-KEY', secondkey: 'PLNT-KEY2', comment: 'PLNT-LORE-COMMENT' }),
                    lore('/PLNT-RX-[0-9]+/', { useRegex: true })],
                customscript: [],
                chats: [{
                    name: 'PLNT-CHAT-NAME', note: 'PLNT-CHAT-NOTE', id: 'plnt-chat-id', localLore: [lore('PLNT-LOCAL-LORE')],
                    message: [
                        msg('user', 'PLNT-USER-MSG hello there', { saying: 'PLNT-SAYING', name: 'PLNT-MSG-NAME', chatId: 'plnt-msg-1' }),
                        msg('char', '플랜트비밀이름 메시지입니다'),
                        msg('user', '플랜트비밀 숨김메시지', { disabled: true }),
                    ],
                }],
            },
            { type: 'character', name: '플랜트비밀이름', chaId: 'plnt-cha-2', desc: '', firstMessage: '', globalLore: [], customscript: [], chats: [] },
            {
                type: 'group', name: 'PLNT-GROUP', chaId: 'plnt-grp-1', globalLore: [], customscript: [],
                chats: [{ name: 'PLNT-GROUP-CHAT', note: '', id: 'plnt-gchat', localLore: [], message: [msg('char', 'PLNT-GROUP-MSG')] }],
            },
        ],
    }
}

/** A block-format save made by the application's encoder, plus two appended blocks the strict reader refuses. */
async function blockFormatFile(): Promise<{ file: Uint8Array; lengthFieldAt: number }> {
    const db = {
        formatversion: 5, botPresetsId: 0, botPresets: [{ name: 'preset' }], modules: [], loadouts: [], plugins: [],
        pluginCustomStorage: {}, enabledModules: [], characters: [],
    } as unknown as Database
    const encoder = new RisuSaveEncoder()
    await encoder.init(db, { compression: false })
    await encoder.set(db, toSave())
    const encoded = new Uint8Array(encoder.encode()!)
    const unreadable = await encoder.encodeBlock({ type: RisuSaveType.CHARACTER_WITH_CHAT, name: 'PLNT-BLK-NAME-41', data: 'PLNT-BLK-DATA-42 not json', compression: false })
    const unknown = await encoder.encodeBlock({ type: 99 as RisuSaveType, name: 'PLNT-BLK-UNK-43', data: '{}', compression: false })
    const out = new Uint8Array(encoded.length + unreadable.length + unknown.length)
    out.set(encoded, 0)
    out.set(unreadable, encoded.length)
    out.set(unknown, encoded.length + unreadable.length)
    // A block is `type, compression, name length, name, u32 length, ...`: the length field follows the name.
    return { file: out, lengthFieldAt: encoded.length + 3 + 'PLNT-BLK-NAME-41'.length }
}

function writeBin(dir: string, name: string, databaseEntry: Uint8Array): string {
    const file = path.join(dir, name)
    fs.writeFileSync(file, backupFileOf(databaseEntry))
    return file
}

describe('analyzeBin on a planted stream-format .bin', () => {
    test('B3: a conforming JSON, exact positive counts, and no planted token in the JSON or any channel', async () => {
        const dir = makeTmp('b3')
        const streamed = encodeRisuSaveStreamed(plantedStreamDatabase())
        const entry = new Uint8Array(streamed.length)
        let at = 0
        for (const piece of streamed.pieces) { entry.set(piece, at); at += piece.length }
        const bin = writeBin(dir, 'planted.bin', entry)
        const { result, failed, recording } = await recordOutput(() => impl.binRead.analyzeBin(bin))
        expect(failed).toBe(false)
        const analyzed = result!
        expect(impl.allowList.checkAggregates(analyzed.aggregates)).toEqual([])
        const json = JSON.stringify(analyzed.aggregates)
        expectNoToken(json, 'the aggregates JSON')
        expectNoToken(recording.text, 'every channel')
        expect(analyzed.omittedBlocks).toBe(0)
        expect(analyzed.incompleteUnits).toBe(0)
        expect(analyzed.aggregates.totals).toMatchObject({ characters: 2, groups: 1, modules: 2, enabledModules: 1, loreEntriesModule: 3, chats: 2, messages: 4, hiddenMessages: 1 })
        expect(analyzed.aggregates.messageLength.byHangulBand.high.n).toBe(2)
        expect(analyzed.aggregates.lore.decorators.other).toBeGreaterThanOrEqual(1)
        expect(analyzed.aggregates.lore.decorators.depth).toBe(2)
    }, 60000)
})

// ---- B7, B7b: block-format files, the seal and the error path

describe('block-format .bin with planted block names', () => {
    test('B7: sealed, the app logs nothing out; unsealed control proves the fixture reaches the log sites', async () => {
        const dir = makeTmp('b7')
        const bin = writeBin(dir, 'blocks.bin', (await blockFormatFile()).file)

        const sealedRun = await recordOutput(() => impl.binRead.analyzeBinSealed(bin))
        expect(sealedRun.failed).toBe(false)
        const sealed = sealedRun.result!
        expectNoToken(sealedRun.recording.text, 'the recorder (sealed)')
        expect(sealed.ok).toBe(true)
        if (sealed.ok) {
            expect(sealed.counts.console).toBeGreaterThanOrEqual(3)
            expect(sealed.value.omittedBlocks).toBe(2)
            expect(impl.allowList.checkAggregates(sealed.value.aggregates)).toEqual([])
            expectNoToken(JSON.stringify(sealed.value.aggregates), 'the aggregates')
            const status = impl.status.statusOf(sealed)
            expect(impl.allowList.checkShape(status, impl.status.STATUS_SHAPE)).toEqual([])
            expectNoToken(JSON.stringify(status), 'the status')
            expect(status.degraded).toBe(1)
        }

        const control = await recordOutput(() => impl.binRead.analyzeBin(bin))
        expect(control.failed).toBe(false)
        expect(control.recording.text).toContain('PLNT-BLK-NAME-41')
        expect(control.recording.text).toContain('PLNT-BLK-UNK-43')
    }, 60000)
})

describe('block-format .bin with a damaged block header', () => {
    test('B7b: an application error that names a planted block leaves only numbers and no aggregates file', async () => {
        const dir = makeTmp('b7b')
        const built = await blockFormatFile()
        const damaged = built.file.slice()
        damaged[built.lengthFieldAt] ^= 0xFF
        const bin = writeBin(dir, 'damaged.bin', damaged)

        const run = await recordOutput(() => impl.binRead.analyzeBinSealed(bin))
        expect(run.failed).toBe(false)
        const sealed = run.result!
        expectNoToken(run.recording.text, 'the recorder')
        expect(sealed.ok).toBe(false)
        if ('failedStep' in sealed) {
            expect(sealed.failedStep).toBe(impl.status.STEP.decode)
            expect(impl.status.ERROR_CLASSES[sealed.errorClass]).toBe('CriticalBlockError')
            const status = impl.status.statusOf(sealed)
            expect(impl.allowList.checkShape(status, impl.status.STATUS_SHAPE)).toEqual([])
            expectNoToken(JSON.stringify(status), 'the status')
            const out = path.join(dir, 'out')
            impl.status.writeStatus(out, status)
            expect(fs.readdirSync(out)).toEqual(['ltm-status.json'])
            expectNoToken(fs.readFileSync(path.join(out, 'ltm-status.json'), 'utf8'), 'the status file')
        }
    }, 60000)
})

// ---- E1: the launcher, end to end

describe.skipIf(SEALED)('launcher', () => {
    test('E1: the launcher prints one fixed line and nothing derived from the file', async () => {
        const root = makeTmp('e1')
        const bin = path.join(root, 'blocks.bin')
        fs.writeFileSync(bin, backupFileOf((await blockFormatFile()).file))
        const out = path.join(root, 'out')
        const r = spawnSync(process.execPath, [path.join(EVAL_DIR, 'run-real.mjs')], {
            encoding: 'utf8',
            env: { ...process.env, LTM_REPO_ROOT: REPO_ROOT, LTM_ROOT: root, LTM_BIN: bin, LTM_OUT: out, LTM_CANARY: 'PLNT-CANARY-55' },
            timeout: 170000,
        })
        const text = (r.stdout ?? '') + (r.stderr ?? '')
        expect(r.stdout.trim()).toMatch(/^ltm-eval real run: exit 0$/)
        expect(r.stdout.trim().split('\n').length).toBe(1)
        expectNoToken(text, 'the launcher output')
        expect(fs.readdirSync(out).sort()).toEqual(['ltm-aggregates.json', 'ltm-status.json'])
        const aggregates = JSON.parse(fs.readFileSync(path.join(out, 'ltm-aggregates.json'), 'utf8')) as unknown
        const status = JSON.parse(fs.readFileSync(path.join(out, 'ltm-status.json'), 'utf8')) as unknown
        expect(impl.allowList.checkAggregates(aggregates)).toEqual([])
        expect(impl.allowList.checkShape(status, impl.status.STATUS_SHAPE)).toEqual([])
        expect(status).toMatchObject({ completed: 1, omittedBlocks: 2, degraded: 1 })
    }, 180000)
})

// ---- D1: the real run, only through run-real.mjs

describe.skipIf(LTM_BIN === '' || !SEALED)('ltm real run', () => {
    test('analysis of LTM_BIN under the output seal', { timeout: 6 * 60 * 60 * 1000 }, async () => {
        const bin = path.resolve(LTM_BIN)
        const out = path.resolve(LTM_OUT)
        expect(impl.runPaths.checkRunPaths({ bin, out, root: LTM_ROOT, repoRoot: REPO_ROOT })).toEqual([])
        const r = await impl.binRead.analyzeBinSealed(bin)
        impl.status.writeStatus(out, impl.status.statusOf(r))
        if (r.ok) impl.binRead.writeAggregates(out, r.value.aggregates)
        // End-to-end launcher test only: a write after the seal window must still not reach the launcher's streams.
        if (process.env.LTM_CANARY) {
            console.error(process.env.LTM_CANARY)
            process.stderr.write(process.env.LTM_CANARY)
        }
        expect(r.ok).toBe(true)
    })
})
