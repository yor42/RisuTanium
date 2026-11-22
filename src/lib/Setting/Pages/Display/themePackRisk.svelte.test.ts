/**
 * The risk warning before every theme-pack install from a file (MC-3641, MC-3756): one confirm with the approved text, asked
 * after every refusal check and the large-pack question and before Replace? and the first write, on every platform. NO installs
 * nothing and says nothing. Built-ins and re-selecting an installed pack never ask.
 *
 * The expected texts are the approved English literals, not the new key, so a missing key or a changed paragraph fails on an
 * assertion. The flow, the intake, the judge and the install transaction are real and packs come from the pack builder
 * (MC-329); the asset store, the save, the dialogs and the platform test are stand-ins.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import { beginBusy, resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'
import { judgePackSheets } from 'src/ts/themePack'
import { installThemePack, type InstallRequest } from 'src/ts/themePack/install'
import { intakePackBytes, type IntakeResult, type PackJudge } from 'src/ts/themePack/intake'
import { manifestText, validPackFiles, zipPack } from 'src/ts/themePack/fixtures/packBuilder'
import { PACK_SIZE_WARN_BYTES } from 'src/ts/themePack/packSize'
import { pngBytes } from 'src/ts/themePack/fixtures/imageBuilder'

//#region module mocks

const world = vi.hoisted(() => ({
    files: new Map<string, Uint8Array>(),
    log: [] as string[],
    android: false,
    requestSaveNow: vi.fn(),
    alertConfirm: vi.fn(async (_message: string) => true),
}))

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => { }), removeItem: vi.fn(async () => { }) }) },
}))
vi.mock(import('src/ts/alert'), () => ({
    alertConfirm: (message: string) => world.alertConfirm(message),
    alertNormal: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/util'), () => ({
    selectSingleFileObject: vi.fn(async () => null),
    readPickedFileBytes: vi.fn(),
}) as unknown as typeof import('src/ts/util'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    requestSaveNow: world.requestSaveNow,
    saveAsset: vi.fn(async (data: Uint8Array, customId = '', fileName = '') => {
        const key = `assets/${customId}.${fileName.split('.').pop()}`
        world.log.push(`write:${key}`)
        world.files.set(key, data.slice())
        return key
    }),
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: async () => ({
        read: async (key: string) => ({ bytes: world.files.get(key) ?? null }),
    }),
}) as unknown as typeof import('src/ts/storage/store/appStore'))
vi.mock(import('src/ts/storage/tauriByteTransport'), async (importOriginal) => ({
    ...await importOriginal(),
    isAndroidTransport: () => world.android,
}))
vi.mock(import('src/ts/gui/colorschemeCore'), () => ({ leavePackScheme: vi.fn(), dropPackSchemeCopy: vi.fn(() => null) }) as unknown as typeof import('src/ts/gui/colorschemeCore'))
vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return { DBState: state } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/gui/colorscheme'), () => ({ leavePackScheme: vi.fn(), dropPackSchemeCopy: vi.fn(() => null) }) as unknown as typeof import('src/ts/gui/colorscheme'))

//#endregion

import { DBState } from 'src/ts/stores.svelte'
import {
    attachRow, installFlowState, resetThemePackInstallFlowForTests, runThemePackInstall, selectThemePack, type InstallFlowDeps,
} from './themePackInstallFlow.svelte'

const ANDROID_TEXT = [
    'A theme pack can make the app hard or impossible to use.',
    'If that happens, long-press the app icon and choose "Start without theme pack". If the app is frozen, close it from recent apps first, or Force stop it in App info.',
    'While a pack is on, data-loss warnings and save-failure notices may be hidden or hard to read.',
    'Install this theme pack?',
].join('\n\n')
const PLAIN_TEXT = [
    'A theme pack can make the app hard or impossible to use.',
    'While a pack is on, data-loss warnings and save-failure notices may be hidden or hard to read.',
    'Install this theme pack?',
].join('\n\n')
const REPLACE_PREFIX = 'Replace the installed theme pack '
const LARGE_PREFIX = 'This theme pack is '

const realJudge: PackJudge = async (sheets) => judgePackSheets(sheets)
const MIB = 1024 * 1024

function fileOf(bytes: Uint8Array): File {
    return { name: 'pack.risutheme', size: bytes.length } as unknown as File
}

function validPack(overrides: Readonly<Record<string, unknown>> = {}, extra: Record<string, string | Uint8Array> = {}): Uint8Array {
    return zipPack(validPackFiles({ ...extra, 'manifest.json': manifestText(overrides) }))
}

/** What each question and each write was, in the order the run made them. */
const sequence: string[] = []

function kindOf(message: string): string {
    if (message === ANDROID_TEXT || message === PLAIN_TEXT) {
        return 'risk'
    }
    if (message.startsWith(REPLACE_PREFIX)) {
        return 'replace'
    }
    return message.startsWith(LARGE_PREFIX) ? 'large' : `other:${message}`
}

interface Run {
    deps: Partial<InstallFlowDeps>
    notify: ReturnType<typeof vi.fn<(message: string) => void>>
    confirm: ReturnType<typeof vi.fn<(message: string) => Promise<boolean>>>
    activations: Array<{ id: string }>
}

/** The real intake and install; the confirm answers from `answers` (true once they run out) and records the store at ask time. */
function runOf(bytes: Uint8Array, answers: boolean[] = [], extra: Partial<InstallFlowDeps> = {}): Run {
    const notify = vi.fn<(message: string) => void>()
    const activations: Array<{ id: string }> = []
    const confirm = vi.fn<(message: string) => Promise<boolean>>(async (message) => {
        sequence.push(`ask:${kindOf(message)}`)
        return answers.shift() ?? true
    })
    const install: typeof installThemePack = (request: InstallRequest<never>) => installThemePack({
        ...request,
        onActivate: (activation) => {
            activations.push({ id: activation.id })
            return request.onActivate?.(activation)
        },
    } as never)
    const deps: Partial<InstallFlowDeps> = {
        pickFile: async () => fileOf(bytes),
        readFile: async () => bytes,
        intake: (verified) => intakePackBytes(verified, realJudge),
        install,
        confirm,
        notify,
        ...extra,
    }
    return { deps, notify, confirm, activations }
}

function storedPacks(): unknown[] {
    const list = DBState.db.themePacks
    return Array.isArray(list) ? [...list] : []
}

function writesOf(): string[] {
    return world.log.filter((entry) => entry.startsWith('write:'))
}

/** The sequence with every archive write reduced to `write`. */
function shape(): string[] {
    return sequence.map((entry) => entry.startsWith('write:') ? 'write' : entry)
}

async function largePack(bytes: Uint8Array): Promise<IntakeResult> {
    const real = await intakePackBytes(bytes, realJudge)
    if (!real.ok) throw new Error('the fixture pack was refused')
    return { ok: true, pack: { ...real.pack, totalBytes: 21 * MIB, size: { warn: true, limitBytes: PACK_SIZE_WARN_BYTES } } }
}

let detachRow: (() => void) | null = null

beforeEach(() => {
    DBState.db = {} as unknown as Database
    world.files.clear()
    world.log.length = 0
    world.android = false
    world.requestSaveNow.mockClear()
    world.alertConfirm.mockReset()
    world.alertConfirm.mockImplementation(async () => true)
    sequence.length = 0
    resetBusyActionsForTest()
    resetThemePackInstallFlowForTests()
    detachRow = attachRow()
})

afterEach(() => {
    detachRow?.()
    detachRow = null
    resetBusyActionsForTest()
    resetThemePackInstallFlowForTests()
})

/** Interleaves the writes into the question order: the saveAsset stand-in logs into `world.log`, so it is merged by position. */
function recordWrites(run: Run): void {
    const original = run.deps.install as typeof installThemePack
    run.deps.install = (request) => {
        const before = world.log.length
        return original(request).finally(() => {
            for (const entry of world.log.slice(before)) {
                sequence.push(entry)
            }
        })
    }
}

describe('WR-1 and WR-5 the approved text, once, before any write', () => {
    test('WR-1 reproducer: Android, a fresh install asks exactly the Android text while the store and list are untouched, and through the default dialog with that string alone', async () => {
        world.android = true
        const seen: Array<{ writes: number, packs: number }> = []
        const run = runOf(validPack())
        run.confirm.mockImplementation(async (message) => {
            seen.push({ writes: writesOf().length, packs: storedPacks().length })
            sequence.push(`ask:${kindOf(message)}`)
            return true
        })
        await runThemePackInstall(run.deps)
        expect(run.confirm).toHaveBeenCalledTimes(1)
        expect(run.confirm.mock.calls[0]).toEqual([ANDROID_TEXT])
        expect(seen).toEqual([{ writes: 0, packs: 0 }])
        expect(storedPacks()).toHaveLength(1)

        const second = runOf(validPack({ name: 'Second Pack' }))
        delete second.deps.confirm
        await runThemePackInstall(second.deps)
        expect(world.alertConfirm.mock.calls).toEqual([[ANDROID_TEXT]])
        expect(storedPacks()).toHaveLength(2)
    })

    test('WR-5 reproducer: desktop, web and Node ask exactly the three-paragraph text before any write', async () => {
        world.android = false
        const seen: number[] = []
        const run = runOf(validPack())
        run.confirm.mockImplementation(async () => {
            seen.push(writesOf().length)
            return true
        })
        await runThemePackInstall(run.deps)
        expect(run.confirm).toHaveBeenCalledTimes(1)
        expect(run.confirm.mock.calls[0]).toEqual([PLAIN_TEXT])
        expect(seen).toEqual([0])
        expect(storedPacks()).toHaveLength(1)

        const second = runOf(validPack({ name: 'Second Pack' }))
        delete second.deps.confirm
        await runThemePackInstall(second.deps)
        expect(world.alertConfirm.mock.calls).toEqual([[PLAIN_TEXT]])
    })
})

describe('WR-2 NO installs nothing and says nothing', () => {
    test.each([['Android', true], ['desktop or web', false]] as const)('WR-2 reproducer: %s', async (_name, android) => {
        world.android = android
        const run = runOf(validPack(), [false])
        await runThemePackInstall(run.deps)
        expect(run.confirm).toHaveBeenCalledTimes(1)
        expect(run.confirm.mock.calls[0]).toEqual([android ? ANDROID_TEXT : PLAIN_TEXT])
        expect(world.log).toEqual([])
        expect(storedPacks()).toEqual([])
        expect('activeThemePack' in DBState.db).toBe(false)
        expect(run.activations).toEqual([])
        expect(run.notify).not.toHaveBeenCalled()
        expect(installFlowState.outcome).toBeNull()
        expect(world.requestSaveNow).not.toHaveBeenCalled()
        expect(installFlowState.pending).toBe(false)
    })
})

describe('WR-3 the order of the questions', () => {
    test('WR-3 reproducer: a fresh install asks the warning, then writes', async () => {
        const run = runOf(validPack())
        recordWrites(run)
        await runThemePackInstall(run.deps)
        expect(shape()).toEqual(['ask:risk', 'write'])
    })

    test('WR-3 reproducer: an update asks the warning, then Replace?, then writes; two installs warn twice', async () => {
        const first = runOf(validPack())
        recordWrites(first)
        await runThemePackInstall(first.deps)
        sequence.length = 0
        const second = runOf(validPack())
        recordWrites(second)
        await runThemePackInstall(second.deps)
        expect(shape()).toEqual(['ask:risk', 'ask:replace', 'write'])
        expect(second.confirm.mock.calls[0]).toEqual([PLAIN_TEXT])
        expect(storedPacks()).toHaveLength(1)
        expect(first.confirm).toHaveBeenCalledTimes(1)
        expect(second.confirm).toHaveBeenCalledTimes(2)
    })

    test('WR-3 reproducer: a large pack asks the size, then the warning, then writes', async () => {
        const bytes = validPack()
        const pack = await largePack(bytes)
        const run = runOf(bytes, [], { intake: async () => pack })
        recordWrites(run)
        await runThemePackInstall(run.deps)
        expect(shape()).toEqual(['ask:large', 'ask:risk', 'write'])
    })

    test('WR-3 reproducer: a large update asks size, warning, Replace?, then writes', async () => {
        const bytes = validPack()
        await runThemePackInstall(runOf(bytes).deps)
        sequence.length = 0
        const pack = await largePack(bytes)
        const run = runOf(bytes, [], { intake: async () => pack })
        recordWrites(run)
        await runThemePackInstall(run.deps)
        expect(shape()).toEqual(['ask:large', 'ask:risk', 'ask:replace', 'write'])
    })

    test('WR-3 reproducer: declining Replace? after the warning writes nothing and shows nothing', async () => {
        const bytes = validPack()
        await runThemePackInstall(runOf(bytes).deps)
        const writes = writesOf().length
        const run = runOf(bytes, [true, false])
        await runThemePackInstall(run.deps)
        expect(run.confirm).toHaveBeenCalledTimes(2)
        expect(run.confirm.mock.calls[0]).toEqual([PLAIN_TEXT])
        expect(writesOf()).toHaveLength(writes)
        expect(installFlowState.outcome).toBeNull()
    })
})

describe('WR-4 no warning where nothing is installed', () => {
    test('guard: a refused intake, a bad tile field and a bad icon ask nothing', async () => {
        const cases: Uint8Array[] = [
            new TextEncoder().encode('this is not a zip file, only some plain text of a fair length'),
            zipPack(validPackFiles({ 'manifest.json': manifestText({ colors: { main: 'rgb(1,2,3)' } }) })),
            zipPack(validPackFiles({ 'images/a.png': pngBytes(513, 1), 'manifest.json': manifestText({ icon: 'images/a.png' }) })),
        ]
        for (const bytes of cases) {
            const run = runOf(bytes)
            await runThemePackInstall(run.deps)
            expect(run.confirm).not.toHaveBeenCalled()
            expect(installFlowState.outcome?.tone).toBe('error')
        }
        expect(world.log).toEqual([])
    })

    test('guard: a declined size question ends the run without the warning', async () => {
        const bytes = validPack()
        const pack = await largePack(bytes)
        const run = runOf(bytes, [false], { intake: async () => pack })
        await runThemePackInstall(run.deps)
        expect(shape()).toEqual(['ask:large'])
        expect(world.log).toEqual([])
    })

    test('guard: a read-only page and a busy page ask nothing', async () => {
        const readOnly = runOf(validPack(), [], { install: async () => ({ ok: false, kind: 'readOnly' }) })
        await runThemePackInstall(readOnly.deps)
        expect(readOnly.confirm).not.toHaveBeenCalled()

        beginBusy('import')
        const busy = runOf(validPack())
        await runThemePackInstall(busy.deps)
        expect(busy.confirm).not.toHaveBeenCalled()
        expect(world.log).toEqual([])
    })
})

describe('WR-6 built-ins and re-selecting never ask', () => {
    test('guard: selecting a built-in and re-selecting an installed pack show no confirm', async () => {
        const run = runOf(validPack())
        await runThemePackInstall(run.deps)
        const id = (storedPacks()[0] as { id: string }).id
        world.alertConfirm.mockClear()
        const confirm = vi.fn(async () => true)
        const idle = { isBusy: () => false, restoreInProgress: () => false, confirm }
        expect(selectThemePack('builtin:origin-navy', idle)).toBe('selected')
        expect(selectThemePack(id, idle)).toBe('selected')
        expect(selectThemePack(id, idle)).toBe('selected')
        expect(confirm).not.toHaveBeenCalled()
        expect(world.alertConfirm).not.toHaveBeenCalled()
    })
})
