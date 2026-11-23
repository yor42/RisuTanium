/**
 * The flow behind the Theme pack row: the in-flight latch, the order of the questions (size check before any read, the
 * 20 MiB confirm, the risk warning and Replace? before the first write, in that order), the outcome text of every result, the outcome lifetime, and Remove
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
import { beginBusy, beginDialogWait, resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'
import { beginRestoreRun, resetRestoreInProgressForTests } from 'src/ts/drive/restoreInProgress'
import { judgePackSheets } from 'src/ts/themePack'
import { installThemePack, type InstallOutcome, type InstallRequest } from 'src/ts/themePack/install'
import { intakePackBytes, type IntakeRefusal, type IntakeResult, type PackJudge } from 'src/ts/themePack/intake'
import { createJudgeClient } from 'src/ts/themePack/judgeClient'
import { createHash } from 'node:crypto'
import { apngBytes, padPngTo, pngBytes, riffWebp, vp8Chunk, vp8lChunk, vp8xChunk, WEBP_ALPHA, WEBP_ANIMATED, WEBP_LOSSY } from 'src/ts/themePack/fixtures/imageBuilder'
import { fakeFont, manifestText, PLAIN_CHAT_SHEET, PNG_1X1, utf8, validPackFiles, zipPack } from 'src/ts/themePack/fixtures/packBuilder'
import studioScratchWhite from '../../../../../docs/design/studio/themes/scratch-white.css?raw'
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
}) as unknown as typeof import('src/ts/storage/store/appStore'))
// The pack safe-mode module reads the light colour module directly, so it is stubbed like the colour module.
vi.mock(import('src/ts/gui/colorschemeCore'), () => ({ leavePackScheme: vi.fn(), dropPackSchemeCopy: vi.fn(() => null) }) as unknown as typeof import('src/ts/gui/colorschemeCore'))
vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return { DBState: state } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/gui/colorscheme'), () => ({ leavePackScheme: vi.fn(), dropPackSchemeCopy: vi.fn(() => null) }) as unknown as typeof import('src/ts/gui/colorscheme'))

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
        expect(confirm).toHaveBeenCalledTimes(3)
        expect(confirm.mock.calls[1][0]).toBe(language.themePackLargeConfirm('21.0 MiB'))
        expect(confirm.mock.calls[2][0]).toBe(language.themePackRiskConfirm(false))
        expect(world.log).toHaveLength(1)
        expect(outcomeLines()).toEqual([language.themePackInstalled('Test Pack')])
    })

    test('a pack under the warning size asks only the risk question', async () => {
        attach()
        const { deps, confirm } = runOf(validPack())
        await runThemePackInstall(deps)
        expect(confirm).toHaveBeenCalledTimes(1)
        expect(confirm.mock.calls[0][0]).toBe(language.themePackRiskConfirm(false))
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
            iconMissing: { code: 'iconMissing' },
            iconType: { code: 'iconType' },
            iconAnimated: { code: 'iconAnimated' },
            iconUnreadable: { code: 'iconUnreadable' },
            iconTooLarge: { code: 'iconTooLarge', limitBytes: 262144 },
            iconDimensions: { code: 'iconDimensions', limitPx: 512 },
        }
        const texts = Object.values(sample).map((refusal) => refusalText(refusal))
        for (const text of texts) {
            expect(text).not.toBe('')
            expect(text).not.toContain('Nothing was installed')
        }
        expect(new Set(texts).size).toBe(texts.length)
        expect(Object.keys(sample)).toHaveLength(32)
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
        const bytes = zipPack(validPackFiles({ 'home.css': PLAIN_CHAT_SHEET }))
        await runThemePackInstall(runOf(bytes).deps)
        expect(outcomeLines()).toEqual([language.themePackInstalled('Test Pack'), language.themePackSkippedAreas('home.css')])
        expect(storedPacks()).toHaveLength(1)
    })
})

describe('W1 a studio-only pack installs (MC-3121, MC-3123)', () => {
    const STUDIO_LEAF = '[data-part="studio-asset-row"]{opacity:1}'
    const STUDIO_NOTE = { selector: '[data-part="studio-asset-row"]', prop: 'opacity', why: 'a studio note' }
    const studioOnly = (sheet: string = STUDIO_LEAF): Uint8Array => zipPack({ 'manifest.json': manifestText(), 'studio.css': sheet })
    const storedRecord = (): Record<string, unknown> => $state.snapshot(storedPacks()[0]) as Record<string, unknown>
    const noteJudge: PackJudge = async (sheets) => {
        const judged = judgePackSheets(sheets)
        const studio = judged.areas.studio
        if (studio === undefined) throw new Error('the fixture pack has no studio sheet')
        return { ...judged, areas: { ...judged.areas, studio: { ...studio, warnings: [STUDIO_NOTE] } } }
    }

    test('the pack is stored and the outcome is the installed line alone', async () => {
        attach()
        await runThemePackInstall(runOf(studioOnly()).deps)
        expect(outcomeLines()).toEqual([language.themePackInstalled('Test Pack')])
        expect(installFlowState.outcome?.tone).toBe('info')
        expect(storedPacks()).toHaveLength(1)
    })

    test('the studio notes show under the installed line, naming studio.css, and nothing throws', async () => {
        attach()
        const bytes = studioOnly()
        await runThemePackInstall(runOf(bytes, [], { intake: (verified) => intakePackBytes(verified, noteJudge) }).deps)
        expect(outcomeLines()).toEqual([
            language.themePackInstalled('Test Pack'),
            language.themePackInstalledWithWarnings('studio.css'),
            language.themePackLintLine(STUDIO_NOTE.selector, STUDIO_NOTE.prop, STUDIO_NOTE.why),
        ])
    })

    test('no tile colours are derived from a studio sheet that declares the tile tokens', async () => {
        attach()
        await runThemePackInstall(runOf(studioOnly(':root{--nexus-canvas:#21222c;--nexus-accent:#8be9fd}')).deps)
        const record = storedRecord()
        expect(Object.hasOwn(record, 'mainColor')).toBe(false)
        expect(Object.hasOwn(record, 'secondaryColor')).toBe(false)
    })

    test('a chat and studio pack lists the notes of each sheet in area order', async () => {
        attach()
        const bytes = zipPack(validPackFiles({ 'studio.css': STUDIO_LEAF }))
        const bothNotes: PackJudge = async (sheets) => {
            const judged = await noteJudge(sheets)
            const chat = judged.areas.chat
            if (chat === undefined) throw new Error('the fixture pack has no chat sheet')
            return { ...judged, areas: { ...judged.areas, chat: { ...chat, warnings: [STUDIO_NOTE] } } }
        }
        await runThemePackInstall(runOf(bytes, [], { intake: (verified) => intakePackBytes(verified, bothNotes) }).deps)
        expect((outcomeLines() ?? []).filter((line) => line === language.themePackInstalledWithWarnings('chat.css') || line === language.themePackInstalledWithWarnings('studio.css')))
            .toEqual([language.themePackInstalledWithWarnings('chat.css'), language.themePackInstalledWithWarnings('studio.css')])
    })
})

describe('S4a notices: colours held back and a pack that shows nothing (MC-3125, MC-3127)', () => {
    const DESIGN = studioScratchWhite.replace(/\r\n/g, '\n')
    const IMAGE_ONLY = '[data-part="studio-asset-row"]{background-image:url(images/s.png)}'
    const TOKEN_COLOURS = ':root{--nexus-canvas:#21222c;--nexus-accent:#8be9fd}'
    const studioOnly = (sheet: string, extra: Record<string, Uint8Array> = {}): Uint8Array => zipPack({ 'manifest.json': manifestText(), 'studio.css': sheet, ...extra })

    test('a studio sheet whose colours are held back adds the held-colours notice naming studio.css, and nothing else when chat shows something', async () => {
        attach()
        await runThemePackInstall(runOf(zipPack(validPackFiles({ 'studio.css': DESIGN }))).deps)
        expect(outcomeLines()).toEqual([language.themePackInstalled('Test Pack'), language.themePackColoursHeld('studio.css')])
    })

    test('C9: a settings sheet with colours adds the held-colours notice naming settings.css; a shape-only settings sheet adds none', async () => {
        attach()
        const colours = '[data-part="settings-section-title"]{color:#ff0000;border-radius:6px}'
        await runThemePackInstall(runOf(zipPack(validPackFiles({ 'settings.css': colours }))).deps)
        expect(outcomeLines()).toEqual([language.themePackInstalled('Test Pack'), language.themePackColoursHeld('settings.css')])
        attach()
        await runThemePackInstall(runOf(zipPack(validPackFiles({ 'settings.css': '[data-part="settings-section-title"]{border-radius:6px}' }))).deps)
        expect(outcomeLines()).toEqual([language.themePackInstalled('Test Pack')])
    })

    test('a studio-only pack whose shape variant has only empty blocks adds the held notice and the shows-nothing line', async () => {
        attach()
        await runThemePackInstall(runOf(studioOnly(IMAGE_ONLY, { 'images/s.png': PNG_1X1 })).deps)
        expect(outcomeLines()).toEqual([language.themePackInstalled('Test Pack'), language.themePackColoursHeld('studio.css'), language.themePackShowsNothing])
        expect(storedPacks()).toHaveLength(1)
    })

    test('a studio-only pack of colour tokens only is accepted with both notices', async () => {
        attach()
        await runThemePackInstall(runOf(studioOnly(TOKEN_COLOURS)).deps)
        expect(outcomeLines()).toEqual([language.themePackInstalled('Test Pack'), language.themePackColoursHeld('studio.css'), language.themePackShowsNothing])
    })

    test('a studio sheet that is already shape-only adds no notice', async () => {
        attach()
        await runThemePackInstall(runOf(studioOnly('[data-part="studio-asset-row"]{opacity:0.5}')).deps)
        expect(outcomeLines()).toEqual([language.themePackInstalled('Test Pack')])
    })

    test('a comment-only chat sheet beside a studio sheet of colours only shows nothing', async () => {
        attach()
        await runThemePackInstall(runOf(zipPack(validPackFiles({ 'chat.css': '/* nothing */', 'studio.css': TOKEN_COLOURS }))).deps)
        expect(outcomeLines()).toEqual([language.themePackInstalled('Test Pack'), language.themePackColoursHeld('studio.css'), language.themePackShowsNothing])
    })

    test('a chat-only pack never gets either notice, even with a comment-only chat sheet (guard)', async () => {
        attach()
        await runThemePackInstall(runOf(zipPack(validPackFiles({ 'chat.css': '/* nothing */' }))).deps)
        expect(outcomeLines()).toEqual([language.themePackInstalled('Test Pack')])
    })
})

describe('W1 warnings of an accepted sheet show under the installed line', () => {
    const WARNINGS = [
        { selector: '[data-part="chat-message-text"]', prop: 'font-family', why: 'first note' },
        { selector: '.b', prop: 'color', why: 'second note' },
    ]
    const warningLines = WARNINGS.map((w) => language.themePackLintLine(w.selector, w.prop, w.why))

    /** The real judge, with the chat judgement carrying warnings: the seam for a rule that does not warn yet. */
    const warnJudge: PackJudge = async (sheets) => {
        const judged = judgePackSheets(sheets)
        const chat = judged.areas.chat
        if (chat === undefined) throw new Error('the fixture pack has no chat sheet')
        return { ...judged, areas: { ...judged.areas, chat: { ...chat, warnings: WARNINGS } } }
    }
    const warnIntake = (verified: Uint8Array): Promise<IntakeResult> => intakePackBytes(verified, warnJudge)
    // The real producer (MC-329): a chat sheet naming a family the pack does not bundle, judged by the real validator.
    const UNBUNDLED_SHEET = '[data-part="chat-message-text"]{font-family:"pack-missing", serif}'
    const unbundledWhy = (name: string): string => `font family "${name}" is not bundled with the pack: it shows only on devices that have it installed, and others use the next family in the list, so end the list with a generic family such as serif, sans-serif or monospace (MC-2542, MC-2543)`
    const unbundledPack = (): Uint8Array => zipPack(validPackFiles({ 'chat.css': UNBUNDLED_SHEET }))

    test('V-T10: a real unbundled family installs and shows its warning under the installed line (MC-2542)', async () => {
        attach()
        await runThemePackInstall(runOf(unbundledPack()).deps)
        expect(outcomeLines()).toEqual([
            language.themePackInstalled('Test Pack'),
            language.themePackInstalledWithWarnings('chat.css'),
            language.themePackLintLine('[data-part="chat-message-text"]', 'font-family', unbundledWhy('pack-missing')),
        ])
        expect(installFlowState.outcome?.tone).toBe('info')
        expect(storedPacks()).toHaveLength(1)
    })

    test('V-T11: a real symbol font installs with a readability note under the notes header', async () => {
        attach()
        const sheet = '[data-part="chat-message-text"]{font-family:wingdings, serif}'
        const bytes = zipPack(validPackFiles({ 'chat.css': sheet }))
        await runThemePackInstall(runOf(bytes).deps)
        const lines = outcomeLines() ?? []
        expect(installFlowState.outcome?.tone).toBe('info')
        expect(lines[0]).toBe(language.themePackInstalled('Test Pack'))
        expect(lines[1]).toBe(language.themePackInstalledWithNotes('chat.css'))
        expect(lines[2]).toContain('it is a symbol font')
        expect(lines.some((line) => line === language.themePackRefusedHeader)).toBe(false)
        expect(storedPacks()).toHaveLength(1)
    })

    test('V-T11b: a kept refusal beside a symbol font still refuses, and shows no note header', async () => {
        attach()
        const bytes = zipPack(validPackFiles({ 'chat.css': '[data-part="chat-message-text"]{font-family:wingdings, serif;z-index:5}' }))
        await runThemePackInstall(runOf(bytes).deps)
        const lines = outcomeLines() ?? []
        expect(installFlowState.outcome?.tone).toBe('error')
        expect(lines[0]).toBe(language.themePackRefusedHeader)
        expect(lines.some((line) => line === language.themePackInstalledWithNotes('chat.css'))).toBe(false)
        expect(world.log).toEqual([])
    })

    // The real producer (MC-329): a plain dark header colour, judged by the real validator, installs with contrast notes.
    const NOTED_SHEET = '[data-part="chat-header"]{color:#111111}'
    const notedLines = (sheet: string): string[] => (judgePackSheets({ chat: sheet }).areas.chat?.result.notes ?? []).map((n) => language.themePackLintLine(n.selector, n.prop, n.why))

    test('T-IF1: a pack whose sheet only carries notes installs and lists them after the notes header', async () => {
        attach()
        const expected = notedLines(NOTED_SHEET)
        expect(expected.length).toBeGreaterThan(0)
        await runThemePackInstall(runOf(zipPack(validPackFiles({ 'chat.css': NOTED_SHEET }))).deps)
        expect(outcomeLines()).toEqual([language.themePackInstalled('Test Pack'), language.themePackInstalledWithNotes('chat.css'), ...expected])
        expect(installFlowState.outcome?.tone).toBe('info')
        expect(storedPacks()).toHaveLength(1)
    })

    test('T-IF1: the notes come after the warning groups', async () => {
        attach()
        const judge: PackJudge = async (sheets) => {
            const judged = judgePackSheets(sheets)
            const chat = judged.areas.chat
            if (chat === undefined) throw new Error('the fixture pack has no chat sheet')
            return { ...judged, areas: { ...judged.areas, chat: { ...chat, warnings: WARNINGS } } }
        }
        await runThemePackInstall(runOf(zipPack(validPackFiles({ 'chat.css': NOTED_SHEET })), [], { intake: (verified) => intakePackBytes(verified, judge) }).deps)
        expect(outcomeLines()).toEqual([
            language.themePackInstalled('Test Pack'),
            language.themePackInstalledWithWarnings('chat.css'),
            ...warningLines,
            language.themePackInstalledWithNotes('chat.css'),
            ...notedLines(NOTED_SHEET),
        ])
    })

    test('T-IF1: a stored record carries no notes', async () => {
        attach()
        await runThemePackInstall(runOf(zipPack(validPackFiles({ 'chat.css': NOTED_SHEET }))).deps)
        const record = storedPacks()[0]
        expect(record).toBeDefined()
        expect(Object.keys(record as object)).not.toContain('notes')
        expect(JSON.stringify(record)).not.toContain('contrast')
    })

    test('T-IF2: a refused sheet that also carries notes shows only the refusal, and nothing is stored', async () => {
        attach()
        const sheet = '[data-part="chat-header"]{z-index:5;color:#111111}'
        const judged = judgePackSheets({ chat: sheet })
        expect(judged.areas.chat?.result.notes?.length).toBeGreaterThan(0)
        expect(judged.areas.chat?.result.ok).toBe(false)
        await runThemePackInstall(runOf(zipPack(validPackFiles({ 'chat.css': sheet }))).deps)
        const lines = outcomeLines() ?? []
        expect(installFlowState.outcome?.tone).toBe('error')
        expect(lines[0]).toBe(language.themePackRefusedHeader)
        expect(lines).toHaveLength(2)
        expect(lines.some((line) => line === language.themePackInstalledWithNotes('chat.css') || notedLines(sheet).includes(line))).toBe(false)
        expect(world.log).toEqual([])
        expect(storedPacks()).toEqual([])
    })

    test.each([
        ['the write fails', { ok: false, kind: 'writeFailed', error: new Error('write') } as const, language.themePackWriteFailed],
        ['the stored files are found damaged', { ok: false, kind: 'filesDamaged' } as const, language.themePackInstallFailedFiles],
    ])('verify accepts a noted pack, then %s: only the failure line shows', async (_name, failure, text) => {
        attach()
        const install = async <R>(request: InstallRequest<R>): Promise<InstallOutcome<R>> => {
            const verdict = await request.verify(request.bytes)
            if (verdict.ok === false) return { ok: false, kind: 'refused', refusal: verdict.refusal }
            return failure
        }
        await runThemePackInstall(runOf(zipPack(validPackFiles({ 'chat.css': NOTED_SHEET })), [], { install }).deps)
        expect(outcomeLines()).toEqual([text])
    })

    test('the installed line is followed by the header and one line per warning, in the info tone', async () => {
        attach()
        await runThemePackInstall(runOf(validPack(), [], { intake: warnIntake }).deps)
        expect(outcomeLines()).toEqual([language.themePackInstalled('Test Pack'), language.themePackInstalledWithWarnings('chat.css'), ...warningLines])
        expect(installFlowState.outcome?.tone).toBe('info')
    })

    test('the warnings come after the skipped-areas line', async () => {
        attach()
        const bytes = zipPack(validPackFiles({ 'home.css': PLAIN_CHAT_SHEET }))
        await runThemePackInstall(runOf(bytes, [], { intake: warnIntake }).deps)
        expect(outcomeLines()).toEqual([
            language.themePackInstalled('Test Pack'),
            language.themePackSkippedAreas('home.css'),
            language.themePackInstalledWithWarnings('chat.css'),
            ...warningLines,
        ])
    })

    test('a refused sheet shows only the refusal, even when its judgement carries warnings', async () => {
        attach()
        const bytes = zipPack(validPackFiles({ 'chat.css': 'a{background:url(https://example.invalid/x.png)}' }))
        await runThemePackInstall(runOf(bytes, [], { intake: warnIntake }).deps)
        const lines = outcomeLines() ?? []
        expect(installFlowState.outcome?.tone).toBe('error')
        expect(lines[0]).toBe(language.themePackRefusedHeader)
        expect(lines).toHaveLength(2)
        expect(lines[1].startsWith(language.themePackSheetRefused('chat.css'))).toBe(true)
        expect(lines.some((line) => line === language.themePackInstalledWithWarnings('chat.css') || warningLines.includes(line))).toBe(false)
        expect(world.log).toEqual([])
    })

    test.each([
        ['the write fails', { ok: false, kind: 'writeFailed', error: new Error('write') } as const, language.themePackWriteFailed],
        ['the second other-work check refuses', { ok: false, kind: 'busy' } as const, language.themePackBusy],
        ['the stored files are found damaged', { ok: false, kind: 'filesDamaged' } as const, language.themePackInstallFailedFiles],
    ])('verify accepts a pack with warnings, then %s: only the failure line shows', async (_name, failure, text) => {
        attach()
        const verified: boolean[] = []
        const install = async <R>(request: InstallRequest<R>): Promise<InstallOutcome<R>> => {
            const verdict = await request.verify(request.bytes)
            verified.push(verdict.ok)
            if (verdict.ok === false) return { ok: false, kind: 'refused', refusal: verdict.refusal }
            return failure
        }
        await runThemePackInstall(runOf(unbundledPack(), [], { install }).deps)
        expect(verified).toEqual([true])
        expect(outcomeLines()).toEqual([text])
        expect(installFlowState.outcome?.tone).toBe('error')
        expect(outcomeLines()?.some((line) => line.startsWith(language.themePackInstalledWithWarnings('chat.css')))).toBe(false)
        expect(world.log).toEqual([])
    })

    test('Replace?: a decline shows nothing, an accept shows the warnings', async () => {
        attach()
        const bytes = validPack()
        await runThemePackInstall(runOf(bytes, [], { intake: warnIntake }).deps)
        const writes = world.log.length

        await runThemePackInstall(runOf(bytes, [true, false], { intake: warnIntake }).deps)
        expect(installFlowState.outcome).toBeNull()
        expect(world.log).toHaveLength(writes)

        await runThemePackInstall(runOf(bytes, [true, true], { intake: warnIntake }).deps)
        expect(outcomeLines()).toEqual([language.themePackInstalled('Test Pack'), language.themePackInstalledWithWarnings('chat.css'), ...warningLines])
    })

    test('with no row open nothing is alerted; the first row shows the warnings and clears them when it closes', async () => {
        const { deps, notify } = runOf(validPack(), [], { intake: warnIntake })
        await runThemePackInstall(deps)
        expect(notify).not.toHaveBeenCalled()
        expect(outcomeLines()).toEqual([language.themePackInstalled('Test Pack'), language.themePackInstalledWithWarnings('chat.css'), ...warningLines])
        const first = attachRow()
        expect(outcomeLines()).toContain(language.themePackInstalledWithWarnings('chat.css'))
        first()
        expect(installFlowState.outcome).toBeNull()
    })

    test('a later clean install shows no warnings of the earlier one', async () => {
        attach()
        await runThemePackInstall(runOf(validPack(), [], { intake: warnIntake }).deps)
        expect(outcomeLines()).toEqual([language.themePackInstalled('Test Pack'), language.themePackInstalledWithWarnings('chat.css'), ...warningLines])
        await runThemePackInstall(runOf(validPack({ name: 'Second Pack' })).deps)
        expect(outcomeLines()).toEqual([language.themePackInstalled('Second Pack')])
    })

    test('the stored record carries no warnings', async () => {
        attach()
        await runThemePackInstall(runOf(validPack(), [], { intake: warnIntake }).deps)
        const record = storedPacks()[0]
        expect(record).toBeDefined()
        expect(Object.keys(record as object)).not.toContain('warnings')
        expect(JSON.stringify(record)).not.toContain('first note')
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

        const declined = runOf(bytes, [true, false])
        await runThemePackInstall(declined.deps)
        expect(declined.confirm).toHaveBeenCalledTimes(2)
        expect(declined.confirm.mock.calls[0][0]).toBe(language.themePackRiskConfirm(false))
        expect(declined.confirm.mock.calls[1][0]).toBe(language.themePackReplaceConfirm('Test Pack'))
        expect(world.log).toHaveLength(writes)
        expect(installFlowState.outcome).toBeNull()

        await runThemePackInstall(runOf(bytes, [true, true]).deps)
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

    test('an export waiting on an Android save dialog does not make the page busy', async () => {
        attach()
        beginDialogWait(beginBusy('export'))
        await runThemePackInstall(runOf(validPack()).deps)
        expect(outcomeLines()).not.toContain(language.themePackBusy)
        expect(storedPacks()).toHaveLength(1)
    })

    test('remove and select with the default busy check are allowed while an export waits on its save dialog', async () => {
        attach()
        const [first] = await (async () => {
            await runThemePackInstall(runOf(validPack({ name: 'First Pack' })).deps)
            return storedPacks()
        })()
        beginDialogWait(beginBusy('export'))
        expect(selectThemePack('builtin:origin-navy')).toBe('selected')
        expect(await removeThemePack(first, 'First Pack', { confirm: async () => true })).toBe('removed')
        expect(storedPacks()).toEqual([])
    })

    test('remove and select with the default busy check are refused while an export is not waiting on a dialog', async () => {
        attach()
        await runThemePackInstall(runOf(validPack({ name: 'First Pack' })).deps)
        const [first] = storedPacks()
        beginBusy('export')
        const confirm = vi.fn(async () => true)
        expect(selectThemePack('builtin:origin-navy')).toBe('busy')
        expect(await removeThemePack(first, 'First Pack', { confirm })).toBe('busy')
        expect(confirm).not.toHaveBeenCalled()
        expect(storedPacks()).toHaveLength(1)
    })

    test('a restore running shows the busy text and writes nothing', async () => {
        attach()
        beginRestoreRun()
        await runThemePackInstall(runOf(validPack()).deps)
        expect(outcomeLines()).toEqual([language.themePackBusy])
        expect(world.log).toEqual([])
    })

    test('the read-only notice comes from the install refusal', async () => {
        attach()
        const install: typeof installThemePack = async () => ({ ok: false, kind: 'readOnly' })
        await runThemePackInstall(runOf(validPack(), [], { install }).deps)
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

describe('T2b the tile colours of an installed pack', () => {
    const DECLARED = ':root{--nexus-canvas:#21222c;--nexus-accent:#8be9fd}'
    const packWith = (overrides: Readonly<Record<string, unknown>>, sheet: string): Uint8Array => zipPack(validPackFiles({ 'chat.css': sheet, 'manifest.json': manifestText(overrides) }))
    const storedRecord = (): Record<string, unknown> => $state.snapshot(storedPacks()[0]) as Record<string, unknown>

    test('T2b-3: colours the sheet declares are derived at install and stored on the record', async () => {
        attach()
        await runThemePackInstall(runOf(packWith({}, DECLARED)).deps)
        expect(storedRecord()).toMatchObject({ mainColor: '#8be9fd', secondaryColor: '#21222c' })
    })

    test('T2b-3: a manifest colour wins over the sheet and is stored lower-case; the other field is still derived', async () => {
        attach()
        await runThemePackInstall(runOf(packWith({ colors: { main: '#FFAA00' } }, DECLARED)).deps)
        expect(storedRecord()).toMatchObject({ mainColor: '#ffaa00', secondaryColor: '#21222c' })
    })

    test('T2b-3: a sheet that declares neither token stores no colour keys at all', async () => {
        attach()
        await runThemePackInstall(runOf(packWith({}, PLAIN_CHAT_SHEET)).deps)
        const record = storedRecord()
        expect(Object.hasOwn(record, 'mainColor')).toBe(false)
        expect(Object.hasOwn(record, 'secondaryColor')).toBe(false)
    })

    test.each([
        ['an invalid main colour', { colors: { main: 'rgb(1,2,3)' } }, 'colors.main'],
        ['an invalid secondary colour', { colors: { secondary: '#12' } }, 'colors.secondary'],
        ['a colors value that is not an object', { colors: '#fff' }, 'colors'],
        ['an invalid icon', { icon: '' }, 'icon'],
    ])('T2b-4: %s is refused naming its field, before the large-pack question, and nothing is written', async (_label, overrides, field) => {
        attach()
        const large: InstallFlowDeps['intake'] = async (verified) => {
            const real = await intakePackBytes(verified, realJudge)
            return real.ok ? { ok: true, pack: { ...real.pack, totalBytes: 21 * MIB, size: { warn: true, limitBytes: PACK_SIZE_WARN_BYTES } } } : real
        }
        const { deps, confirm } = runOf(packWith(overrides, DECLARED), [true, true], { intake: large })

        await runThemePackInstall(deps)

        expect(confirm).not.toHaveBeenCalled()
        expect(outcomeLines()).toEqual([language.themePackRefusedHeader, language.themePackRefuseManifestField(field)])
        expect(world.log).toEqual([])
        expect(storedPacks()).toEqual([])
    })
})

describe('T3 the optional pack icon', () => {
    const iconPack = (path: string, bytes: Uint8Array | null, extraManifest: Readonly<Record<string, unknown>> = {}, extraFiles: Record<string, Uint8Array> = {}): Uint8Array =>
        zipPack(validPackFiles({ ...(bytes === null ? {} : { [path]: bytes }), ...extraFiles, 'manifest.json': manifestText({ icon: path, ...extraManifest }) }))
    const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
    const storedRecord = (): Record<string, unknown> => $state.snapshot(storedPacks()[0]) as Record<string, unknown>

    test.each([
        ['a PNG', 'images/icon.png', pngBytes(24, 16), 'png'],
        ['a lossy WebP', 'images/icon.webp', WEBP_LOSSY, 'webp'],
        ['a WebP with alpha', 'images/icon.webp', WEBP_ALPHA, 'webp'],
    ])('T3-2: %s installs; the bytes saved are the file in the archive and the record names them', async (_label, path, bytes, ext) => {
        attach()

        await runThemePackInstall(runOf(iconPack(path, bytes)).deps)

        const key = `assets/tp-${sha(bytes)}.${ext}`
        expect(world.files.get(key)).toEqual(bytes)
        expect(world.log.filter((entry) => entry.endsWith(`.${ext}`))).toEqual([`write:${key}`])
        expect(storedRecord().icon).toBe(key)
        expect(outcomeLines()).toEqual([language.themePackInstalled('Test Pack')])
    })

    test('T3-1g: a .webp path holding PNG bytes is refused by the intake as wrongContent and nothing is saved', async () => {
        attach()
        await runThemePackInstall(runOf(iconPack('images/icon.webp', pngBytes(8, 8))).deps)

        expect(outcomeLines()).toEqual([language.themePackRefusedHeader, language.themePackRefuseWrongContent('images/icon.webp')])
        expect(world.log).toEqual([])
    })

    test.each([
        ['an icon the pack does not hold', iconPack('images/a.png', null), language.themePackRefuseIconMissing],
        ['a font named as the icon', iconPack('fonts/x.woff2', fakeFont(), { fonts: [{ file: 'fonts/x.woff2', license: 'OFL-1.1' }] }), language.themePackRefuseIconType],
        ['an SVG path', iconPack('images/a.svg', null), language.themePackRefuseIconType],
        ['a PNG of 262145 bytes', iconPack('images/a.png', padPngTo(pngBytes(8, 8), 262145)), language.themePackRefuseIconTooLarge('256.0 KiB')],
        ['a PNG 513 wide', iconPack('images/a.png', pngBytes(513, 1)), language.themePackRefuseIconDimensions(512)],
        ['a PNG 513 tall', iconPack('images/a.png', pngBytes(1, 513)), language.themePackRefuseIconDimensions(512)],
        ['a PNG of width 0', iconPack('images/a.png', pngBytes(1, 1, { declaredWidth: 0 })), language.themePackRefuseIconUnreadable],
        ['a PNG with a truncated IHDR', iconPack('images/a.png', pngBytes(8, 8).subarray(0, 20)), language.themePackRefuseIconUnreadable],
        ['a 600 x 600 WebP', iconPack('images/a.webp', riffWebp([vp8xChunk(600, 600), vp8Chunk(600, 600)])), language.themePackRefuseIconDimensions(512)],
        ['a 513-wide lossless WebP', iconPack('images/a.webp', riffWebp([vp8lChunk(513, 8)])), language.themePackRefuseIconDimensions(512)],
        ['an APNG', iconPack('images/a.png', apngBytes(8, 8)), language.themePackRefuseIconAnimated],
        ['an APNG with acTL after the image data', iconPack('images/a.png', apngBytes(8, 8, 'after')), language.themePackRefuseIconAnimated],
        ['a WebP with the animation flag over a still image', iconPack('images/a.webp', (() => { const b = WEBP_ALPHA.slice(); b[20] = 0x12; return b })()), language.themePackRefuseIconAnimated],
        ['an animated WebP', iconPack('images/a.webp', WEBP_ANIMATED), language.themePackRefuseIconAnimated],
        ['ANMF chunks without the flag', iconPack('images/a.webp', (() => { const b = WEBP_ANIMATED.slice(); b[20] = 0; return b })()), language.themePackRefuseIconAnimated],
        ['a WebP whose RIFF size is wrong', iconPack('images/a.webp', riffWebp([vp8Chunk(8, 8)], 2)), language.themePackRefuseIconUnreadable],
    ])('T3-1: %s is refused with its reason, before the large-pack question, and nothing is written', async (_label, pack, text) => {
        attach()
        const large: InstallFlowDeps['intake'] = async (verified) => {
            const real = await intakePackBytes(verified, realJudge)
            return real.ok ? { ok: true, pack: { ...real.pack, totalBytes: 21 * MIB, size: { warn: true, limitBytes: PACK_SIZE_WARN_BYTES } } } : real
        }
        const { deps, confirm } = runOf(pack, [true, true], { intake: large })

        await runThemePackInstall(deps)

        expect(confirm).not.toHaveBeenCalled()
        expect(outcomeLines()).toEqual([language.themePackRefusedHeader, text])
        expect(world.log).toEqual([])
        expect(storedPacks()).toEqual([])
    })

    test('T3-1g: an SVG in the pack and a PNG that holds WebP bytes keep their intake refusals, which come before the icon check', async () => {
        attach()
        await runThemePackInstall(runOf(zipPack(validPackFiles({ 'images/x.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>', 'manifest.json': manifestText({ icon: 'images/x.svg' }) }))).deps)
        expect(outcomeLines()).toEqual([language.themePackRefusedHeader, language.themePackRefuseSvg('images/x.svg')])

        await runThemePackInstall(runOf(iconPack('images/x.png', WEBP_LOSSY)).deps)
        expect(outcomeLines()).toEqual([language.themePackRefusedHeader, language.themePackRefuseWrongContent('images/x.png')])
        expect(world.log).toEqual([])
    })

    test('T3-1: a PNG of exactly 262144 bytes installs', async () => {
        attach()
        const icon = padPngTo(pngBytes(8, 8), 262144)

        await runThemePackInstall(runOf(iconPack('images/a.png', icon)).deps)

        expect(storedRecord().icon).toBe(`assets/tp-${sha(icon)}.png`)
    })

    test('T3-2: a pack that names no icon writes no icon asset and its record has no icon key', async () => {
        attach()

        await runThemePackInstall(runOf(validPack()).deps)

        expect(Object.hasOwn(storedRecord(), 'icon')).toBe(false)
        expect(world.log.filter((entry) => /\.(png|webp)$/.test(entry))).toEqual([])
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
