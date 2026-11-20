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

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import v8 from 'node:v8'
import vm from 'node:vm'
import { encodeBackupEntryHeader } from 'src/ts/exportWriters'
import { coldStorageHeader, getColdStorageBackupName } from 'src/ts/process/coldstorageData'
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
type RunPathsModule = typeof import('./analyzer/runPaths.mjs')
type RealRunModule = typeof import('./analyzer/realRun')
type BinReadModule = typeof import('./analyzer/binRead')
type SealModule = typeof import('./analyzer/seal')
type StatusModule = typeof import('./analyzer/status')
type LtmAggregates = import('./analyzer/aggregate').LtmAggregates

const load = <T>(file: string): Promise<T> => import(/* @vite-ignore */ pathToFileURL(path.join(IMPL_DIR, file)).href) as Promise<T>
const impl = {
    aggregate: await load<AggregateModule>('aggregate.ts'),
    allowList: await load<AllowListModule>('allowList.ts'),
    runPaths: await load<RunPathsModule>('runPaths.mjs'),
    binRead: await load<BinReadModule>('binRead.ts'),
    realRun: await load<RealRunModule>('realRun.ts'),
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

    test('B5b: a nested safeStep keeps the inner step and class', async () => {
        const { safeStep, STEP, ERROR_CLASSES, StepError } = impl.status
        const error = await safeStep(STEP.stream, () => safeStep(STEP.scan, async () => { throw new TypeError('PLNT-NESTED') }))
            .catch((e: unknown) => e)
        expect(error).toBeInstanceOf(StepError)
        const stepError = error as InstanceType<typeof StepError>
        expect(stepError.step).toBe(STEP.scan)
        expect(ERROR_CLASSES[stepError.errorClass]).toBe('TypeError')
    })

    test('B10: degraded is 1 when a unit is incomplete or a block was omitted, else 0', () => {
        const counts = { console: 0, streams: 0, warnings: 0 }
        const progress = { phase: 5, streamed: 1, declineReason: -1, peakHeapMiB: 12, maxRssMiB: 99, heapLimitMiB: 4096 }
        const ok = (incompleteUnits: number, omittedBlocks: number) =>
            impl.status.statusOf({ ok: true, value: { incompleteUnits, omittedBlocks }, counts }, progress)
        expect(ok(0, 0).degraded).toBe(0)
        expect(ok(1, 0).degraded).toBe(1)
        expect(ok(0, 2).degraded).toBe(1)
        expect(ok(0, 0)).toMatchObject({ started: 1, completed: 1, phase: 5, streamed: 1, peakHeapMiB: 12, maxRssMiB: 99, heapLimitMiB: 4096 })
        expect(impl.allowList.checkShape(ok(0, 0), impl.status.STATUS_SHAPE)).toEqual([])
        const failed = impl.status.statusOf({ ok: false, failedStep: 3, errorClass: 4, counts }, progress)
        expect(failed).toMatchObject({ completed: 0, failedStep: 3, errorClass: 4 })
        expect(impl.allowList.checkShape(failed, impl.status.STATUS_SHAPE)).toEqual([])
        const started = impl.status.startedStatus(progress)
        expect(started).toMatchObject({ started: 1, completed: 0, failedStep: -1, errorClass: -1, phase: 5 })
        expect(impl.allowList.checkShape(started, impl.status.STATUS_SHAPE)).toEqual([])
        // A number written as a string is refused by the shape.
        expect(impl.allowList.checkShape({ ...started, peakHeapMiB: '12' }, impl.status.STATUS_SHAPE).length).toBeGreaterThanOrEqual(1)
    })

    test('declineIndexOf: each listed reason has its own index and an unlisted one is other', () => {
        const { declineIndexOf, DECLINE_REASONS } = impl.status
        expect(DECLINE_REASONS.length).toBe(12)
        for (const [index, reason] of DECLINE_REASONS.slice(0, -1).entries()) expect(declineIndexOf(reason)).toBe(index)
        expect(declineIndexOf('blocks')).toBe(10)
        expect(declineIndexOf('PLNT-NEW-REASON')).toBe(11)
        expect(declineIndexOf(undefined)).toBe(11)
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
        // The token check above therefore covers the streamed path.
        expect(analyzed.streamed).toBe(1)
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
            // The streamed path skips the whole decode's own log line but keeps the omitted-block warning and the assembly catch.
            expect(sealed.value.streamed).toBe(1)
            expect(sealed.counts.console).toBeGreaterThanOrEqual(2)
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

// ---- fixtures for the streamed path: the application's producers, wrapped in the container header

const uuidN = (n: number): string => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')

/** Strings stay under 48 characters: msgpackr's encoder breaks on longer ones under Node 24. */
function richChat(tag: string): Record<string, unknown> {
    return {
        id: 'chat-' + tag, name: 'c' + tag, note: '', localLore: [lore('@@depth 2\nlocal ' + tag), lore('f', { mode: 'folder' })],
        message: [
            msg('user', 'hello ' + tag), msg('char', '안녕하세요 ' + tag), msg('user', 'hidden', { disabled: true }),
            msg('char', 'reset', { disabled: 'allBefore' }), msg('user', 'after reset ' + tag),
        ],
        alt: [{ m: msg('user', 'alt ' + tag), p: null, a: 1 }],
    }
}

function richCharacter(n: number): Record<string, unknown> {
    return {
        type: 'character', chaId: uuidN(n), name: 'char ' + n, chatPage: 0, desc: 'd', firstMessage: 'f',
        globalLore: [lore('@@depth 4\nbody ' + n, { selective: true }), lore('@@role user\nb', { mode: 'constant' }), lore('f', { mode: 'folder' })],
        customscript: [{ comment: 's', in: 'a', out: 'b', type: 'editinput' }],
        chats: [richChat(n + 'a'), richChat(n + 'b')],
    }
}

function richRoot(characters: unknown[]): Record<string, unknown> {
    return {
        formatversion: 5, botPresetsId: 0, botPresets: [{ name: 'preset' }], loadouts: [], plugins: [], pluginCustomStorage: {},
        modules: [
            { id: 'mod-1', name: 'm1', lorebook: [lore('@@depth 1\nmod body'), lore('f', { mode: 'folder' })], regex: [{ comment: 'r', in: 'a', out: 'b', type: 'editinput' }] },
            { id: 'mod-2', name: 'm2', lorebook: [], regex: [] },
        ],
        enabledModules: ['mod-1'],
        characters,
    }
}

/** `count` characters, one group, two modules (one enabled): chats with hidden, reset and alt messages, folder lore, scripts. */
function richDatabase(count = 4): Record<string, unknown> {
    const characters: unknown[] = []
    for (let n = 1; n <= count; n++) characters.push(richCharacter(n))
    characters.push({ type: 'group', chaId: uuidN(900), name: 'group', globalLore: [], customscript: [{}], chats: [richChat('g')] })
    return richRoot(characters)
}

const stubCharacterOf = (chaId: string, unit: string): Record<string, unknown> => ({
    type: 'character', chaId, name: 'stub ' + chaId.slice(-4), chatPage: 0, firstMsgIndex: 0, coldstorage: unit, coldStoragedChats: [],
    chats: [{ message: [{ data: '', role: 'char' }], note: '', name: '', localLore: [] }],
})
const pointerCharacterOf = (chaId: string, unit: string): Record<string, unknown> => ({
    type: 'character', chaId, name: 'pointer ' + chaId.slice(-4), chatPage: 0, globalLore: [], customscript: [],
    chats: [richChat(chaId.slice(-4)), { id: 'cp', message: [{ data: coldStorageHeader + unit, role: 'char' }], note: '', name: '', localLore: [] }],
})

const concatBytes = (parts: Uint8Array[]): Uint8Array => {
    const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0))
    let at = 0
    for (const part of parts) { out.set(part, at); at += part.length }
    return out
}

const entryOf = (name: string, data: Uint8Array): Uint8Array =>
    concatBytes([encodeBackupEntryHeader(new TextEncoder().encode(name), data.length), data])

/** A cold unit entry as the application names it, with a JSON body. */
const coldEntryOf = (unit: string, body: unknown): Uint8Array =>
    entryOf(getColdStorageBackupName(unit), new TextEncoder().encode(JSON.stringify(body)))

/** The 'compressed' gzip msgpack database entry of the application's own streaming encoder. */
function msgpackDatabaseEntry(db: object): Uint8Array {
    const streamed = encodeRisuSaveStreamed(db)
    return concatBytes(streamed.pieces)
}

/** A block-format database entry of the application's encoder (every block gzipped when `compression`), plus extra blocks. */
async function blockDatabaseEntry(db: Record<string, unknown>, compression: boolean, extra: (encoder: RisuSaveEncoder) => Promise<Uint8Array[]> = async () => []): Promise<Uint8Array> {
    const encoder = new RisuSaveEncoder()
    await encoder.init(db as unknown as Database, { compression })
    await encoder.set(db as unknown as Database, toSave())
    return concatBytes([new Uint8Array(encoder.encode()!), ...(await extra(encoder))])
}

function binOf(dir: string, name: string, databaseEntry: Uint8Array, extraEntries: Uint8Array[] = []): string {
    const file = path.join(dir, name)
    fs.writeFileSync(file, concatBytes([entryOf('database.risudat', databaseEntry), ...extraEntries]))
    return file
}

type Analyzed = Awaited<ReturnType<BinReadModule['analyzeBin']>>

/** Streamed (auto) and whole results of one file. */
async function bothPaths(bin: string): Promise<{ auto: Analyzed; whole: Analyzed }> {
    const whole = await impl.binRead.analyzeBin(bin, { mode: 'whole' })
    const auto = await impl.binRead.analyzeBin(bin)
    return { auto, whole }
}

/** The streamed result must equal the whole path's in every aggregate and both counts. */
function expectEqualResults(a: Analyzed, b: Analyzed): void {
    assert.deepStrictEqual(a.aggregates, b.aggregates)
    expect(a.incompleteUnits).toBe(b.incompleteUnits)
    expect(a.omittedBlocks).toBe(b.omittedBlocks)
}

describe('streamed path equals the whole path', () => {
    test('Q1: a compressed msgpack file gives the same aggregates and counts; streamed is 1 and 0', async () => {
        const dir = makeTmp('q1')
        const bin = binOf(dir, 'q1.bin', msgpackDatabaseEntry(richDatabase()))
        const { auto, whole } = await bothPaths(bin)
        expect(auto.streamed).toBe(1)
        expect(whole.streamed).toBe(0)
        expect(auto.declineReason).toBe(-1)
        expectEqualResults(auto, whole)
        expect(auto.aggregates.totals).toMatchObject({ characters: 4, groups: 1, chats: 9, modules: 2, enabledModules: 1 })
    }, 60000)

    test('Q2: a block-format file gives the same aggregates and counts', async () => {
        const dir = makeTmp('q2')
        const bin = binOf(dir, 'q2.bin', await blockDatabaseEntry(richDatabase(), true))
        const { auto, whole } = await bothPaths(bin)
        expect(auto.streamed).toBe(1)
        expect(whole.streamed).toBe(0)
        expectEqualResults(auto, whole)
        expect(auto.aggregates.totals).toMatchObject({ characters: 4, groups: 1, chats: 9, modules: 2, enabledModules: 1 })
    }, 60000)

    test('Q3: stub, missing-unit stub and pointer chat give equal results with incomplete units counted', async () => {
        const dir = makeTmp('q3')
        const [unitStub, unitMissing, unitPointer] = [uuidN(701), uuidN(702), uuidN(703)]
        const db = richDatabase(2)
        ;(db.characters as unknown[]).push(
            stubCharacterOf(uuidN(711), unitStub), stubCharacterOf(uuidN(712), unitMissing), pointerCharacterOf(uuidN(713), unitPointer),
        )
        const bin = binOf(dir, 'q3.bin', msgpackDatabaseEntry(db), [
            coldEntryOf(unitStub, { character: { chaId: uuidN(711), name: 'archived', type: 'character', chatPage: 0, chats: [richChat('arch')] } }),
            coldEntryOf(unitPointer, [msg('user', 'archived one'), msg('char', 'archived two')]),
        ])
        const { auto, whole } = await bothPaths(bin)
        expect(auto.streamed).toBe(1)
        expectEqualResults(auto, whole)
        expect(auto.incompleteUnits).toBeGreaterThanOrEqual(1)
        // The archived messages of the resolved stub and of the pointer chat are counted: 2 characters x 2 chats x 5, the group's 5, and more.
        expect(auto.aggregates.totals.messages).toBeGreaterThan(25)
    }, 60000)

    test('Q4: a decline after characters were handed out falls back with fresh state and an equal result', async () => {
        const dir = makeTmp('q4')
        const db = richDatabase(4)
        const missingUnit = uuidN(799)
        const bin = binOf(dir, 'q4.bin', await blockDatabaseEntry(db, false, async (encoder) => [
            // A stub whose unit is missing, handed out and counted before the decline, then a second root component.
            await encoder.encodeBlock({ type: RisuSaveType.CHARACTER_WITH_CHAT, name: uuidN(721), data: JSON.stringify(stubCharacterOf(uuidN(721), missingUnit)), compression: false }),
            await encoder.encodeBlock({ type: RisuSaveType.ROOT_COMPONENT, name: 'component-modules', data: JSON.stringify({ key: 'modules', data: [{ id: 'mod-late', lorebook: [lore('late')], regex: [] }] }), compression: false }),
        ]))
        const declines: number[] = []
        const whole = await impl.binRead.analyzeBin(bin, { mode: 'whole' })
        const auto = await impl.binRead.analyzeBin(bin, { onDecline: (index) => { declines.push(index) } })
        expect(auto.streamed).toBe(0)
        // 10 is 'blocks' in DECLINE_REASONS; the literal keeps a broken mapping from agreeing with itself.
        expect(auto.declineReason).toBe(10)
        expect(declines).toEqual([10])
        expect(auto.aggregates.totals.characters).toBe(5)
        expect(whole.incompleteUnits).toBeGreaterThanOrEqual(1)
        expectEqualResults(auto, whole)
        expect(auto.aggregates.totals.modules).toBe(1)
    }, 60000)
})

// ---- H1: the streamed path holds no owner list

describe('streamed path memory shape', () => {
    v8.setFlagsFromString('--expose-gc')
    const gc = vm.runInNewContext('gc') as () => void

    /** How many of the resolved owners are still alive when the root is resolved and aggregated (phase 5). */
    async function liveOwnersAtAggregate(bin: string, mode: 'auto' | 'whole'): Promise<{ total: number; live: number }> {
        const refs: Array<WeakRef<object>> = []
        let live = -1
        await impl.binRead.analyzeBin(bin, {
            mode,
            onOwner: (owner) => { refs.push(new WeakRef(owner as object)) },
            async onPhase(phase) {
                if (phase !== impl.status.STEP.aggregate) return
                // Ends the job that keeps a fresh WeakRef target alive, then collects twice.
                await new Promise<void>((resolve) => { setImmediate(resolve) })
                gc()
                gc()
                live = refs.filter((ref) => ref.deref() !== undefined).length
            },
        })
        return { total: refs.length, live }
    }

    const twelve = (): Record<string, unknown> => {
        const db = richRoot([])
        for (let n = 1; n <= 12; n++) (db.characters as unknown[]).push(richCharacter(n))
        return db
    }

    test('H1: at most one resolved owner is alive at the root step; the whole path holds all twelve (the control)', async () => {
        // This shows the analyzer keeps no owner list. It does not show the application's reader holds one character, nor any memory bound.
        const dir = makeTmp('h1')
        const files = {
            msgpack: binOf(dir, 'h1-m.bin', msgpackDatabaseEntry(twelve())),
            block: binOf(dir, 'h1-b.bin', await blockDatabaseEntry(twelve(), true)),
        }
        for (const [kind, bin] of Object.entries(files)) {
            const control = await liveOwnersAtAggregate(bin, 'whole')
            expect(control, kind + ' whole control').toEqual({ total: 12, live: 12 })
            const streamed = await liveOwnersAtAggregate(bin, 'auto')
            expect(streamed.total, kind + ' streamed owners').toBe(12)
            expect(streamed.live, kind + ' streamed live owners').toBeLessThanOrEqual(1)
        }
    }, 60000)
})

// ---- A-split, B11: the incremental aggregator and the file adapter

describe('aggregator split and file adapter', () => {
    test('A-split: owners fed one at a time plus the root equal aggregateDatabase', () => {
        const db = richDatabase(3)
        const whole = impl.aggregate.aggregateDatabase(db as unknown as Dbish)
        const aggregator = impl.aggregate.createAggregator()
        for (const owner of db.characters as unknown[]) aggregator.addOwner(owner)
        aggregator.addRoot(db as unknown as Dbish)
        assert.deepStrictEqual(aggregator.finish(), whole)
        expect(whole.totals.characters).toBe(3)
    })

    test('B11: a read past the end of a short file returns only the bytes read', async () => {
        const dir = makeTmp('b11')
        const file = path.join(dir, 'short.bin')
        const content = Uint8Array.from({ length: 100 }, (_, i) => (i * 7 + 1) & 0xFF)
        fs.writeFileSync(file, content)
        const fd = fs.openSync(file, 'r')
        try {
            const adapter = impl.binRead.nodeBinFile(fd, 200)
            const read = new Uint8Array(await adapter.slice(0, 200).arrayBuffer())
            expect(read.length).toBe(100)
            expect(Buffer.from(read).equals(Buffer.from(content))).toBe(true)
            const exact = new Uint8Array(await adapter.slice(10, 60).arrayBuffer())
            expect(Buffer.from(exact).equals(Buffer.from(content.subarray(10, 60)))).toBe(true)
        } finally {
            fs.closeSync(fd)
        }
    })
})

// ---- S1: the started marker at every phase

describe('real-run progress file', () => {
    test('S1: the status exists with started 1, completed 0 at every phase; owner progress adds writes; the end is completed', async () => {
        const root = makeTmp('s1')
        const bin = path.join(root, 'blocks.bin')
        fs.writeFileSync(bin, backupFileOf((await blockFormatFile()).file))
        const out = path.join(root, 'out')
        const statusFile = path.join(out, 'ltm-status.json')
        const seen: Array<{ phase: number; status: Record<string, number> }> = []
        const r = await impl.realRun.runRealAnalysis({ bin, out, root, repoRoot: REPO_ROOT }, {
            ownerWriteIntervalMs: 1e9,
            afterWrite: (phase) => { seen.push({ phase, status: JSON.parse(fs.readFileSync(statusFile, 'utf8')) as Record<string, number> }) },
        })
        expect(r.ok).toBe(true)
        const during = seen.slice(0, -1)
        expect(during.map((s) => s.phase)).toEqual([-1, 0, 1, 6, 4, 5])
        for (const { phase, status } of during) {
            expect(status, 'phase ' + phase).toMatchObject({ started: 1, completed: 0, failedStep: -1, errorClass: -1, phase })
            expect(impl.allowList.checkShape(status, impl.status.STATUS_SHAPE), 'shape at phase ' + phase).toEqual([])
        }
        const last = seen[seen.length - 1].status
        expect(last).toMatchObject({ started: 1, completed: 1, streamed: 1, declineReason: -1 })
        expect(last.heapLimitMiB).toBeGreaterThan(0)
        expect(last.maxRssMiB).toBeGreaterThan(0)
        expect(last.peakHeapMiB).toBeGreaterThan(0)
        expect(impl.allowList.checkShape(last, impl.status.STATUS_SHAPE)).toEqual([])
        expect(fs.readdirSync(out).sort()).toEqual(['ltm-aggregates.json', 'ltm-status.json'])

        // With no interval, every owner writes the status again while the stream runs.
        const rich = binOf(root, 'rich.bin', msgpackDatabaseEntry(richDatabase()))
        const ownerWrites: number[] = []
        await impl.realRun.runRealAnalysis({ bin: rich, out: path.join(root, 'out2'), root, repoRoot: REPO_ROOT }, {
            ownerWriteIntervalMs: 0,
            afterWrite: (phase) => { ownerWrites.push(phase) },
        })
        expect(ownerWrites.filter((phase) => phase === 6).length).toBeGreaterThan(1)

        // With a huge interval a file that has owners still writes once in the stream phase: the phase write, no owner write.
        const quietWrites: number[] = []
        await impl.realRun.runRealAnalysis({ bin: rich, out: path.join(root, 'out3'), root, repoRoot: REPO_ROOT }, {
            ownerWriteIntervalMs: 1e9,
            afterWrite: (phase) => { quietWrites.push(phase) },
        })
        expect(quietWrites.filter((phase) => phase === 6).length).toBe(1)
    }, 60000)

    test('S1: a declined stream is recorded in the status file, in the mid-run write after the decline and at the end', async () => {
        const root = makeTmp('s1d')
        const missingUnit = uuidN(799)
        const db = richDatabase(2)
        const bin = binOf(root, 'decline.bin', await blockDatabaseEntry(db, false, async (encoder) => [
            await encoder.encodeBlock({ type: RisuSaveType.CHARACTER_WITH_CHAT, name: uuidN(721), data: JSON.stringify(stubCharacterOf(uuidN(721), missingUnit)), compression: false }),
            await encoder.encodeBlock({ type: RisuSaveType.ROOT_COMPONENT, name: 'component-modules', data: JSON.stringify({ key: 'modules', data: [{ id: 'mod-late', lorebook: [lore('late')], regex: [] }] }), compression: false }),
        ]))
        const out = path.join(root, 'out')
        const statusFile = path.join(out, 'ltm-status.json')
        const seen: Array<{ phase: number; status: Record<string, number> }> = []
        const r = await impl.realRun.runRealAnalysis({ bin, out, root, repoRoot: REPO_ROOT }, {
            afterWrite: (phase) => { seen.push({ phase, status: JSON.parse(fs.readFileSync(statusFile, 'utf8')) as Record<string, number> }) },
        })
        expect(r.ok).toBe(true)
        // 10 is 'blocks' in DECLINE_REASONS; the whole-tree path starts with the readDatabase phase write.
        const afterDecline = seen.find((s) => s.phase === impl.status.STEP.readDatabase)
        expect(afterDecline?.status).toMatchObject({ streamed: 0, declineReason: 10, completed: 0 })
        const last = seen[seen.length - 1].status
        expect(last).toMatchObject({ started: 1, completed: 1, streamed: 0, declineReason: 10 })
    }, 60000)

    test('S1: a refused layout throws a fixed message before anything is written', async () => {
        const root = makeTmp('s1g')
        const out = path.join(os.tmpdir(), 'ltm-s1g-elsewhere-' + process.pid)
        const error = await impl.realRun.runRealAnalysis({ bin: path.join(root, 'x.bin'), out, root, repoRoot: REPO_ROOT }).catch((e: unknown) => e)
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toBe('ltm-eval: run paths refused, 1 problems')
        expect(fs.existsSync(out)).toBe(false)
    })
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
        expect(status).toMatchObject({ started: 1, completed: 1, phase: 5, streamed: 1, omittedBlocks: 2, degraded: 1 })
        const peaks = status as { peakHeapMiB: number; maxRssMiB: number; heapLimitMiB: number }
        expect(peaks.peakHeapMiB).toBeGreaterThan(0)
        expect(peaks.maxRssMiB).toBeGreaterThan(0)
        expect(peaks.heapLimitMiB).toBeGreaterThan(0)
    }, 180000)

    /** The launcher run in `cwd` with the given paths; stdout is the one fixed line. */
    const launch = (cwd: string, vars: Record<string, string>, extraEnv: Record<string, string> = {}) =>
        spawnSync(process.execPath, [path.join(EVAL_DIR, 'run-real.mjs')], {
            encoding: 'utf8', cwd, timeout: 170000,
            env: { ...process.env, LTM_REPO_ROOT: REPO_ROOT, ...vars, ...extraEnv },
        })

    test('E2: a refused layout prints exit 3 and touches nothing; relative paths are judged where the child will use them', () => {
        const root = makeTmp('e2')
        const outside = makeTmp('e2-outside')
        for (const dir of [outside, path.join(root, 'out')]) {
            fs.mkdirSync(dir, { recursive: true })
            fs.writeFileSync(path.join(dir, 'ltm-status.json'), 'seeded')
        }
        // The output folder lies outside the run root.
        const absolute = launch(root, { LTM_ROOT: root, LTM_BIN: path.join(root, 'x.bin'), LTM_OUT: outside })
        expect(absolute.stdout.trim()).toBe('ltm-eval real run: exit 3')
        expect(absolute.status).toBe(3)
        expect(fs.readFileSync(path.join(outside, 'ltm-status.json'), 'utf8')).toBe('seeded')
        // A relative .bin that climbs out of the root: refused, and the relative output folder keeps its seeded file.
        const relative = launch(root, { LTM_ROOT: root, LTM_BIN: path.join('..', 'elsewhere.bin'), LTM_OUT: 'out' })
        expect(relative.stdout.trim()).toBe('ltm-eval real run: exit 3')
        expect(relative.status).toBe(3)
        expect(fs.readFileSync(path.join(root, 'out', 'ltm-status.json'), 'utf8')).toBe('seeded')
    })

    test('E2: a launcher-side exception exits 4, never the child code 1, and prints one fixed line', () => {
        const root = makeTmp('e2x')
        const out = path.join(root, 'out')
        // A directory where the stale status file would be: removing it fails inside the launcher.
        fs.mkdirSync(path.join(out, 'ltm-status.json'), { recursive: true })
        const r = launch(root, { LTM_ROOT: root, LTM_BIN: path.join(root, 'x.bin'), LTM_OUT: out })
        expect(r.stdout.trim()).toBe('ltm-eval real run: exit 4')
        expect(r.status).toBe(4)
        expect(r.stdout.trim().split('\n').length).toBe(1)
        expect(r.stderr).toBe('')
    })

    test('E2: the child status is mapped: only 0, 1 and 134 keep their value; any other status is 5', () => {
        // A stand-in repository whose vitest ends with a chosen status; the real path guard module is copied in.
        const fake = makeTmp('e2-fake')
        fs.mkdirSync(path.join(fake, 'Agents', 'Tools', 'ltm-eval', 'analyzer'), { recursive: true })
        fs.mkdirSync(path.join(fake, 'node_modules', 'vitest'), { recursive: true })
        fs.copyFileSync(path.join(IMPL_DIR, 'runPaths.mjs'), path.join(fake, 'Agents', 'Tools', 'ltm-eval', 'analyzer', 'runPaths.mjs'))
        fs.writeFileSync(path.join(fake, 'node_modules', 'vitest', 'vitest.mjs'), 'process.exit(Number(process.env.FAKE_CHILD_STATUS))\n')
        const root = makeTmp('e2-fake-root')
        const run = (status: number) => launch(root, { LTM_ROOT: root, LTM_BIN: path.join(root, 'x.bin'), LTM_OUT: path.join(root, 'out') },
            { LTM_REPO_ROOT: fake, FAKE_CHILD_STATUS: String(status) })
        const codes = new Map<number, number | null>()
        for (const status of [0, 1, 2, 3, 4, 7, 134]) {
            const r = run(status)
            expect(r.stdout.trim().split('\n').length).toBe(1)
            expect(r.stdout.trim()).toBe('ltm-eval real run: exit ' + r.status)
            codes.set(status, r.status)
        }
        expect([...codes]).toEqual([[0, 0], [1, 1], [2, 5], [3, 5], [4, 5], [7, 5], [134, 134]])
    })

    test('E3: a failing file leaves a failure status and no stale aggregates, with relative paths resolved once', () => {
        const root = makeTmp('e3')
        fs.writeFileSync(path.join(root, 'bad.bin'), 'PLNT-GARBAGE-BIN-BYTES that are not a backup container at all')
        const out = path.join(root, 'out')
        fs.mkdirSync(out, { recursive: true })
        fs.writeFileSync(path.join(out, 'ltm-aggregates.json'), '{"stale":true}')
        // Relative paths, with the launcher's cwd inside the run root and the child's cwd in the repository.
        const r = launch(root, { LTM_ROOT: root, LTM_BIN: 'bad.bin', LTM_OUT: 'out' })
        const text = (r.stdout ?? '') + (r.stderr ?? '')
        expect(r.stdout.trim()).toBe('ltm-eval real run: exit 1')
        expect(r.stdout.trim().split('\n').length).toBe(1)
        expectNoToken(text, 'the launcher output')
        expect(fs.readdirSync(out)).toEqual(['ltm-status.json'])
        const status = JSON.parse(fs.readFileSync(path.join(out, 'ltm-status.json'), 'utf8')) as Record<string, number>
        expect(status).toMatchObject({ started: 1, completed: 0 })
        expect(status.failedStep).toBeGreaterThanOrEqual(0)
        expect(status.phase).toBeGreaterThanOrEqual(0)
        expect(impl.allowList.checkShape(status, impl.status.STATUS_SHAPE)).toEqual([])
        expectNoToken(JSON.stringify(status), 'the status file')
    }, 180000)
})

// ---- D1: the real run, only through run-real.mjs

describe.skipIf(LTM_BIN === '' || !SEALED)('ltm real run', () => {
    test('analysis of LTM_BIN under the output seal', { timeout: 6 * 60 * 60 * 1000 }, async () => {
        const bin = path.resolve(LTM_BIN)
        const out = path.resolve(LTM_OUT)
        expect(impl.runPaths.checkRunPaths({ bin, out, root: LTM_ROOT, repoRoot: REPO_ROOT })).toEqual([])
        const r = await impl.realRun.runRealAnalysis({ bin, out, root: LTM_ROOT, repoRoot: REPO_ROOT })
        // End-to-end launcher test only: a write after the seal window must still not reach the launcher's streams.
        if (process.env.LTM_CANARY) {
            console.error(process.env.LTM_CANARY)
            process.stderr.write(process.env.LTM_CANARY)
        }
        expect(r.ok).toBe(true)
    })
})
