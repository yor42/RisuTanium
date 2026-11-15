/**
 * The flow behind the Theme pack row: the in-flight latch, the order of the questions (size check before any read, the
 * 20 MiB confirm and Replace? before the first write), the outcome text of every result, the outcome lifetime, and Remove
 * and select. All are guards for new behaviour: the flow does not exist on the base, so each fails only when a scratch
 * mutant breaks the rule it names.
 *
 * `DBState` is a real `$state` object (Remove's identity check depends on the live proxy). The asset store, the save and the
 * page storage selection are stand-ins; the busy registry, the restore signal, the intake, the judge and the install
 * transaction are the real modules, and packs come from the pack builder like the real producer (MC-329).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import type { Database } from 'src/ts/storage/database.svelte'
import { beginBusy, resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'
import { beginRestoreRun, resetRestoreInProgressForTests } from 'src/ts/drive/restoreInProgress'
import { judgePackSheets } from 'src/ts/themePack'
import { installThemePack } from 'src/ts/themePack/install'
import { intakePackBytes, type IntakeRefusal, type IntakeResult, type PackJudge } from 'src/ts/themePack/intake'
import { createJudgeClient } from 'src/ts/themePack/judgeClient'
import { manifestText, PLAIN_CHAT_SHEET, utf8, validPackFiles, zipPack } from 'src/ts/themePack/fixtures/packBuilder'
import { PACK_SIZE_WARN_BYTES } from 'src/ts/themePack/packSize'
import { PACK_FILE_MAX_BYTES, PACK_MAX_UNPACKED_BYTES } from 'src/ts/themePack/zipTail'

//#region module mocks

const world = vi.hoisted(() => ({
    files: new Map<string, Uint8Array>(),
    log: [] as string[],
    requestSaveNow: vi.fn(),
}))

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => { }), removeItem: vi.fn(async () => { }) }) },
}))
vi.mock(import('src/ts/alert'), () => ({
    alertConfirm: vi.fn(async () => true),
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
    pageStoreIsOpfsTransitional: async () => false,
}) as unknown as typeof import('src/ts/storage/store/appStore'))
vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return { DBState: state } as unknown as typeof import('src/ts/stores.svelte')
})

//#endregion

import { DBState } from 'src/ts/stores.svelte'
import {
    attachRow, formatPackSize, installFlowState, refusalText, removeThemePack, resetThemePackInstallFlowForTests, runThemePackInstall,
    selectThemePack, type InstallFlowDeps,
} from './themePackInstallFlow.svelte'

const realJudge: PackJudge = async (sheets) => judgePackSheets(sheets)
const MIB = 1024 * 1024

/** A picked file whose body is the bytes; `arrayBuffer` is never called by the flow (the reader is injected). */
function fileOf(bytes: Uint8Array, size = bytes.length): File {
    return { name: 'pack.risutheme', size } as unknown as File
}

interface Run {
    deps: Partial<InstallFlowDeps>
    notify: ReturnType<typeof vi.fn<(message: string) => void>>
    confirm: ReturnType<typeof vi.fn<(message: string) => Promise<boolean>>>
}

/** Deps that pick `bytes`, read them as they are and run the real intake and install; confirms answer from `answers`. */
function runOf(bytes: Uint8Array, answers: boolean[] = [], extra: Partial<InstallFlowDeps> = {}): Run {
    const notify = vi.fn<(message: string) => void>()
    const confirm = vi.fn<(message: string) => Promise<boolean>>(async () => answers.shift() ?? true)
    const deps: Partial<InstallFlowDeps> = {
        pickFile: async () => fileOf(bytes),
        readFile: async () => bytes,
        intake: (verified) => intakePackBytes(verified, realJudge),
        install: installThemePack,
        confirm,
        notify,
        ...extra,
    }
    return { deps, notify, confirm }
}

function validPack(overrides: Readonly<Record<string, unknown>> = {}, extra: Record<string, string> = {}): Uint8Array {
    return zipPack(validPackFiles({ ...extra, 'manifest.json': manifestText(overrides) }))
}

function outcomeLines(): string[] | null {
    return installFlowState.outcome === null ? null : [...installFlowState.outcome.lines]
}

function storedPacks(): unknown[] {
    const list = DBState.db.themePacks
    return Array.isArray(list) ? [...list] : []
}

let detachRow: (() => void) | null = null

/** Keeps a row attached for the test, so outcomes stay on the row instead of being alerted. */
function attach(): void {
    detachRow = attachRow()
}

beforeEach(() => {
    DBState.db = {} as unknown as Database
    world.files.clear()
    world.log.length = 0
    world.requestSaveNow.mockClear()
    resetBusyActionsForTest()
    resetRestoreInProgressForTests()
    resetThemePackInstallFlowForTests()
})

afterEach(() => {
    detachRow?.()
    detachRow = null
    resetBusyActionsForTest()
    resetRestoreInProgressForTests()
    resetThemePackInstallFlowForTests()
})

describe('T4-14 a file over the size cap is refused before it is read', () => {
    function oversized(size: number): { file: File, arrayBuffer: ReturnType<typeof vi.fn> } {
        const arrayBuffer = vi.fn(() => { throw new Error('the file must not be read') })
        return { file: { name: 'big.risutheme', size, arrayBuffer } as unknown as File, arrayBuffer }
    }

    test('above the cap: nothing is read, checked or installed, and the pack-too-large line shows at once', async () => {
        attach()
        const { file, arrayBuffer } = oversized(PACK_FILE_MAX_BYTES + 1)
        const readFile = vi.fn(async () => new Uint8Array())
        const intake = vi.fn(async (): Promise<IntakeResult> => ({ ok: false, refusals: [] }))
        const installCalls = vi.fn()
        const install: typeof installThemePack = (request) => {
            installCalls()
            return installThemePack(request)
        }
        await runThemePackInstall({ pickFile: async () => file, readFile, intake, install })
        expect(readFile).not.toHaveBeenCalled()
        expect(arrayBuffer).not.toHaveBeenCalled()
        expect(intake).not.toHaveBeenCalled()
        expect(installCalls).not.toHaveBeenCalled()
        expect(outcomeLines()).toEqual([language.themePackRefusedHeader, language.themePackRefusePackTooLarge(formatPackSize(PACK_MAX_UNPACKED_BYTES))])
        expect(installFlowState.pending).toBe(false)
    })

    test('at the cap: the file is read once', async () => {
        const { file } = oversized(PACK_FILE_MAX_BYTES)
        const readFile = vi.fn(async () => new Uint8Array())
        const installCalls = vi.fn()
        const install: typeof installThemePack = async () => {
            installCalls()
            return { ok: false, kind: 'declinedReplace' }
        }
        await runThemePackInstall({ pickFile: async () => file, readFile, install })
        expect(readFile).toHaveBeenCalledTimes(1)
        expect(installCalls).toHaveBeenCalledTimes(1)
    })
})

describe('T4-2a the 20 MiB question comes before any write', () => {
    async function largePack(): Promise<IntakeResult> {
        const real = await intakePackBytes(validPack(), realJudge)
        if (!real.ok) throw new Error('the fixture pack was refused')
        return { ok: true, pack: { ...real.pack, totalBytes: 21 * MIB, size: { warn: true, limitBytes: PACK_SIZE_WARN_BYTES } } }
    }

    test('the question names the unpacked size; a decline writes nothing and shows nothing; an accept installs', async () => {
        attach()
        const pack = await largePack()
        const { deps, confirm } = runOf(validPack(), [false, true], { intake: async () => pack })

        await runThemePackInstall(deps)
        expect(confirm).toHaveBeenCalledTimes(1)
        expect(confirm.mock.calls[0][0]).toBe(language.themePackLargeConfirm('21.0 MiB'))
        expect(world.log).toEqual([])
        expect(installFlowState.outcome).toBeNull()
        expect(storedPacks()).toEqual([])

        await runThemePackInstall(deps)
        expect(confirm).toHaveBeenCalledTimes(2)
        expect(world.log).toHaveLength(1)
        expect(outcomeLines()).toEqual([language.themePackInstalled('Test Pack')])
    })

    test('a pack under the warning size asks nothing', async () => {
        attach()
        const { deps, confirm } = runOf(validPack())
        await runThemePackInstall(deps)
        expect(confirm).not.toHaveBeenCalled()
        expect(world.log).toHaveLength(1)
    })
})

describe('T4-2b refusals show their text and write nothing', () => {
    test.each([
        ['a file that is not a zip', utf8('this is not a zip file, only some plain text of a fair length'), language.themePackRefuseNotAPack],
        ['a pack without chat.css', zipPack({ 'manifest.json': manifestText() }), language.themePackRefuseNoArea],
    ] as const)('%s', async (_name, bytes, text) => {
        attach()
        const { deps } = runOf(bytes)
        await runThemePackInstall(deps)
        expect(outcomeLines()).toEqual([language.themePackRefusedHeader, text])
        expect(world.log).toEqual([])
        expect(storedPacks()).toEqual([])
    })

    test('every refusal code has its own non-empty text, none of which claims what was or was not stored', () => {
        const sample: { [C in IntakeRefusal['code']]: IntakeRefusal & { code: C } } = {
            manifestUnreadable: { code: 'manifestUnreadable' },
            notThisKind: { code: 'notThisKind' },
            newerFormat: { code: 'newerFormat' },
            manifestField: { code: 'manifestField', field: 'name' },
            notAPack: { code: 'notAPack' },
            zip64: { code: 'zip64' },
            manifestMissing: { code: 'manifestMissing' },
            noArea: { code: 'noArea' },
            couldNotCheck: { code: 'couldNotCheck' },
            tooManyFiles: { code: 'tooManyFiles', limit: 512 },
            packTooLarge: { code: 'packTooLarge', limitBytes: PACK_MAX_UNPACKED_BYTES },
            damaged: { code: 'damaged', name: 'a.css' },
            unsafeName: { code: 'unsafeName', name: '../a' },
            duplicateName: { code: 'duplicateName', name: 'a.css' },
            encrypted: { code: 'encrypted', name: 'a.css' },
            compression: { code: 'compression', name: 'a.css' },
            unknownFile: { code: 'unknownFile', name: 'a.exe' },
            svg: { code: 'svg', name: 'a.svg' },
            wrongContent: { code: 'wrongContent', name: 'a.png' },
            notUtf8: { code: 'notUtf8', name: 'a.css' },
            fileTooLarge: { code: 'fileTooLarge', name: 'a.png', limitBytes: 64 * MIB },
            target: { code: 'target', sheet: 'chat.css', target: 'x.png' },
            wrongKind: { code: 'wrongKind', sheet: 'chat.css', target: 'x.txt' },
            fontLicense: { code: 'fontLicense', file: 'fonts/a.woff2' },
            licenseWithoutFont: { code: 'licenseWithoutFont', file: 'fonts/a.woff2' },
            sheetRefused: { code: 'sheetRefused', sheet: 'chat.css', errors: [{ selector: '.a', prop: 'color', why: 'not allowed' }] },
        }
        const texts = Object.values(sample).map((refusal) => refusalText(refusal))
        for (const text of texts) {
            expect(text).not.toBe('')
            expect(text).not.toContain('Nothing was installed')
        }
        expect(new Set(texts).size).toBe(texts.length)
        expect(Object.keys(sample)).toHaveLength(26)
        expect(refusalText(sample.sheetRefused)).toBe(`${language.themePackSheetRefused('chat.css')}\n${language.themePackLintLine('.a', 'color', 'not allowed')}`)
        expect(refusalText(sample.packTooLarge)).toContain('256.0 MiB')
    })
})

describe('T4-2c a judge that cannot run is shown as could-not-check and nothing is written', () => {
    test('a worker that cannot start', async () => {
        attach()
        const judge = createJudgeClient({ spawn: () => { throw new Error('no worker') } })
        const bytes = validPack()
        const { deps } = runOf(bytes, [], { intake: (verified) => intakePackBytes(verified, judge) })
        await runThemePackInstall(deps)
        expect(outcomeLines()).toEqual([language.themePackRefusedHeader, language.themePackCouldNotCheck])
        expect(world.log).toEqual([])
    })
})

describe('T4-2d a thrown error shows the generic text and releases the latch', () => {
    test.each([
        ['the read', (deps: Partial<InstallFlowDeps>) => ({ ...deps, readFile: async (): Promise<Uint8Array> => { throw new Error('read') } })],
        ['the intake', (deps: Partial<InstallFlowDeps>) => ({ ...deps, intake: async (): Promise<IntakeResult> => { throw new Error('intake') } })],
        ['the install', (deps: Partial<InstallFlowDeps>) => ({ ...deps, install: async () => { throw new Error('install') } })],
    ] as const)('%s throws', async (_name, breakIt) => {
        attach()
        const bytes = validPack()
        const first = runOf(bytes)
        await runThemePackInstall(breakIt(first.deps))
        expect(outcomeLines()).toEqual([language.themePackInstallFailed])
        expect(installFlowState.pending).toBe(false)

        const intake = vi.fn((verified: Uint8Array) => intakePackBytes(verified, realJudge))
        const second = runOf(bytes, [], { intake })
        await runThemePackInstall(second.deps)
        expect(intake).toHaveBeenCalledTimes(1)
        expect(outcomeLines()).toEqual([language.themePackInstalled('Test Pack')])
    })
})

describe('T4-2e one install at a time', () => {
    test('a second run while the first is checking never starts a second intake and shows the busy text', async () => {
        attach()
        const bytes = validPack()
        let release: () => void = () => {}
        const gate = new Promise<void>((resolve) => { release = resolve })
        const intake = vi.fn(async (verified: Uint8Array) => {
            await gate
            return intakePackBytes(verified, realJudge)
        })
        const first = runOf(bytes, [], { intake })
        const running = runThemePackInstall(first.deps)
        await vi.waitFor(() => expect(installFlowState.pending).toBe(true))

        await runThemePackInstall(runOf(bytes, [], { intake }).deps)
        expect(intake).toHaveBeenCalledTimes(1)
        expect(outcomeLines()).toEqual([language.themePackBusy])

        release()
        await running
        expect(installFlowState.pending).toBe(false)
        expect(outcomeLines()).toEqual([language.themePackInstalled('Test Pack')])
    })

    test('a chooser that never answers does not take the latch', async () => {
        const bytes = validPack()
        let calls = 0
        const pickFile = vi.fn((): Promise<File | null> => {
            calls += 1
            return calls === 1 ? new Promise<File | null>(() => { }) : Promise.resolve(fileOf(bytes))
        })
        const hung = runOf(bytes, [], { pickFile })
        void runThemePackInstall(hung.deps)
        await Promise.resolve()
        expect(installFlowState.pending).toBe(false)

        attach()
        await runThemePackInstall(runOf(bytes, [], { pickFile }).deps)
        expect(pickFile).toHaveBeenCalledTimes(2)
        expect(outcomeLines()).toEqual([language.themePackInstalled('Test Pack')])
    })

    test('a cancelled chooser changes nothing', async () => {
        attach()
        await runThemePackInstall({ pickFile: async () => null })
        expect(installFlowState.pending).toBe(false)
        expect(installFlowState.outcome).toBeNull()
    })
})

describe('T4-2f an outcome that arrives with no row open', () => {
    test('an error is alerted once and not kept', async () => {
        const { deps, notify } = runOf(utf8('not a zip file but it is long enough to be looked at'))
        await runThemePackInstall(deps)
        expect(notify).toHaveBeenCalledTimes(1)
        expect(notify.mock.calls[0][0]).toBe([language.themePackRefusedHeader, language.themePackRefuseNotAPack].join('\n'))
        expect(installFlowState.outcome).toBeNull()
    })

    test('with a row open the error shows on the row and is not alerted', async () => {
        attach()
        const { deps, notify } = runOf(utf8('not a zip file but it is long enough to be looked at'))
        await runThemePackInstall(deps)
        expect(notify).not.toHaveBeenCalled()
        expect(installFlowState.outcome?.tone).toBe('error')
    })

    test('a success is kept silently', async () => {
        const { deps, notify } = runOf(validPack())
        await runThemePackInstall(deps)
        expect(notify).not.toHaveBeenCalled()
        expect(outcomeLines()).toEqual([language.themePackInstalled('Test Pack')])
    })
})

describe('T4-16 an outcome is shown once', () => {
    test('a shown outcome is gone when its row closes and the next row does not show it', async () => {
        attach()
        await runThemePackInstall(runOf(validPack()).deps)
        expect(outcomeLines()).not.toBeNull()
        detachRow?.()
        detachRow = null
        expect(installFlowState.outcome).toBeNull()
        attach()
        expect(installFlowState.outcome).toBeNull()
    })

    test('a success kept with no row is shown by the first row that opens and cleared when that row closes', async () => {
        await runThemePackInstall(runOf(validPack()).deps)
        expect(outcomeLines()).toEqual([language.themePackInstalled('Test Pack')])
        const first = attachRow()
        expect(outcomeLines()).toEqual([language.themePackInstalled('Test Pack')])
        first()
        expect(installFlowState.outcome).toBeNull()
        const second = attachRow()
        expect(installFlowState.outcome).toBeNull()
        second()
    })

    test('closing a row while an install runs keeps the latch, and the outcome lands once it ends', async () => {
        const bytes = validPack()
        let release: () => void = () => {}
        const gate = new Promise<void>((resolve) => { release = resolve })
        const intake = async (verified: Uint8Array): Promise<IntakeResult> => {
            await gate
            return intakePackBytes(verified, realJudge)
        }
        const detach = attachRow()
        const running = runThemePackInstall(runOf(bytes, [], { intake }).deps)
        await vi.waitFor(() => expect(installFlowState.pending).toBe(true))
        detach()
        expect(installFlowState.pending).toBe(true)
        release()
        await running
        expect(outcomeLines()).toEqual([language.themePackInstalled('Test Pack')])
    })

    test('a successful Remove and a select clear a shown outcome', async () => {
        attach()
        await runThemePackInstall(runOf(validPack()).deps)
        expect(installFlowState.outcome).not.toBeNull()
        selectThemePack(undefined, { isBusy: () => false, restoreInProgress: () => false })
        expect(installFlowState.outcome).toBeNull()

        await runThemePackInstall(runOf(validPack({ name: 'Second Pack' })).deps)
        expect(installFlowState.outcome).not.toBeNull()
        const entry = storedPacks()[1]
        expect(await removeThemePack(entry, 'Second Pack', { confirm: async () => true })).toBe('removed')
        expect(installFlowState.outcome).toBeNull()
    })
})

describe('T4-4 a pack with another area keeps it and says so', () => {
    test('the installed line is followed by the skipped-areas line', async () => {
        attach()
        const bytes = zipPack(validPackFiles({ 'studio.css': PLAIN_CHAT_SHEET }))
        await runThemePackInstall(runOf(bytes).deps)
        expect(outcomeLines()).toEqual([language.themePackInstalled('Test Pack'), language.themePackSkippedAreas('studio.css')])
        expect(storedPacks()).toHaveLength(1)
    })
})

describe('T4-5 Replace? names the pack it replaces', () => {
    test.each([
        ['no author id (matched by name)', {}],
        ['the same author id', { id: 'same-author-pack' }],
    ] as const)('%s: a decline writes nothing and shows nothing; an accept replaces the one record', async (_name, overrides) => {
        attach()
        const bytes = validPack(overrides)
        await runThemePackInstall(runOf(bytes).deps)
        expect(storedPacks()).toHaveLength(1)
        const writes = world.log.length

        const declined = runOf(bytes, [false])
        await runThemePackInstall(declined.deps)
        expect(declined.confirm).toHaveBeenCalledTimes(1)
        expect(declined.confirm.mock.calls[0][0]).toBe(language.themePackReplaceConfirm('Test Pack'))
        expect(world.log).toHaveLength(writes)
        expect(installFlowState.outcome).toBeNull()

        await runThemePackInstall(runOf(bytes, [true]).deps)
        expect(world.log).toHaveLength(writes + 1)
        expect(storedPacks()).toHaveLength(1)
    })
})

describe('T4-6 another task running', () => {
    test('a busy page shows the busy text and writes nothing', async () => {
        attach()
        beginBusy('import')
        await runThemePackInstall(runOf(validPack()).deps)
        expect(outcomeLines()).toEqual([language.themePackBusy])
        expect(world.log).toEqual([])
    })

    test('a restore running shows the busy text and writes nothing', async () => {
        attach()
        beginRestoreRun()
        await runThemePackInstall(runOf(validPack()).deps)
        expect(outcomeLines()).toEqual([language.themePackBusy])
        expect(world.log).toEqual([])
    })

    test('the read-only notices come from the install refusal', async () => {
        attach()
        const install = (cause: 'opfs' | 'mode'): typeof installThemePack => async () => ({ ok: false, kind: 'readOnly', cause })
        await runThemePackInstall(runOf(validPack(), [], { install: install('opfs') }).deps)
        expect(outcomeLines()).toEqual([language.opfsReadOnlyNotice])
        await runThemePackInstall(runOf(validPack(), [], { install: install('mode') }).deps)
        expect(outcomeLines()).toEqual([language.store2Boot.readOnlyRefusal])
    })
})

describe('T4-2g Remove', () => {
    async function installTwo(): Promise<unknown[]> {
        await runThemePackInstall(runOf(validPack({ name: 'First Pack' })).deps)
        await runThemePackInstall(runOf(validPack({ name: 'Second Pack' })).deps)
        return storedPacks()
    }

    test('a decline leaves the list; an accept removes the live entry and asks for one save', async () => {
        attach()
        const [first] = await installTwo()
        world.requestSaveNow.mockClear()
        const confirm = vi.fn(async () => false)
        expect(await removeThemePack(first, 'First Pack', { confirm })).toBe('declined')
        expect(confirm.mock.calls[0]).toEqual([language.themePackRemoveConfirm('First Pack')])
        expect(storedPacks()).toHaveLength(2)
        expect(world.requestSaveNow).not.toHaveBeenCalled()

        expect(await removeThemePack(first, 'First Pack', { confirm: async () => true })).toBe('removed')
        expect(storedPacks()).toHaveLength(1)
        expect(world.requestSaveNow).toHaveBeenCalledTimes(1)
    })

    test('a list replaced while the question was open removes nothing and says so', async () => {
        attach()
        const [first] = await installTwo()
        world.requestSaveNow.mockClear()
        const confirm = async (): Promise<boolean> => {
            DBState.db.themePacks = JSON.parse(JSON.stringify($state.snapshot(DBState.db.themePacks))) as typeof DBState.db.themePacks
            return true
        }
        expect(await removeThemePack(first, 'First Pack', { confirm })).toBe('changed')
        expect(storedPacks()).toHaveLength(2)
        expect(outcomeLines()).toEqual([language.themePackRemoveChanged])
        expect(world.requestSaveNow).not.toHaveBeenCalled()
    })

    test('a busy page and a restore each refuse before any question', async () => {
        attach()
        const [first] = await installTwo()
        const confirm = vi.fn(async () => true)
        beginBusy('import')
        expect(await removeThemePack(first, 'First Pack', { confirm })).toBe('busy')
        expect(outcomeLines()).toEqual([language.themePackBusy])
        resetBusyActionsForTest()
        expect(await removeThemePack(first, 'First Pack', { confirm, restoreInProgress: () => true })).toBe('busy')
        expect(confirm).not.toHaveBeenCalled()
        expect(storedPacks()).toHaveLength(2)
    })

    test('an unreadable entry can be removed too', async () => {
        attach()
        DBState.db.themePacks = [{ v: 99, id: 'future' }]
        const entry = (DBState.db.themePacks as unknown[])[0]
        expect(await removeThemePack(entry, language.themePackUnreadableName, { confirm: async () => true })).toBe('removed')
        expect(storedPacks()).toEqual([])
    })
})

describe('T4-2h select', () => {
    const idle = { isBusy: () => false, restoreInProgress: () => false }

    test('a pack is stored as the active id and saved; None leaves no key behind', () => {
        expect(selectThemePack('builtin:origin-navy', idle)).toBe('selected')
        expect(DBState.db.activeThemePack).toBe('builtin:origin-navy')
        expect(world.requestSaveNow).toHaveBeenCalledTimes(1)
        expect(selectThemePack(undefined, idle)).toBe('selected')
        expect('activeThemePack' in DBState.db).toBe(false)
        expect(world.requestSaveNow).toHaveBeenCalledTimes(2)
    })

    test('a busy page and a restore each leave the id unchanged and say so', () => {
        attach()
        DBState.db.activeThemePack = 'builtin:banana-cocoa'
        expect(selectThemePack('builtin:origin-navy', { isBusy: () => true, restoreInProgress: () => false })).toBe('busy')
        expect(selectThemePack(undefined, { isBusy: () => false, restoreInProgress: () => true })).toBe('busy')
        expect(DBState.db.activeThemePack).toBe('builtin:banana-cocoa')
        expect(world.requestSaveNow).not.toHaveBeenCalled()
        expect(outcomeLines()).toEqual([language.themePackBusy])
    })
})

describe('formatPackSize', () => {
    test('KiB below one MiB, MiB from there on, one decimal', () => {
        expect(formatPackSize(512)).toBe('0.5 KiB')
        expect(formatPackSize(MIB - 1)).toMatch(/KiB$/)
        expect(formatPackSize(MIB)).toBe('1.0 MiB')
        expect(formatPackSize(21 * MIB)).toBe('21.0 MiB')
    })
})
