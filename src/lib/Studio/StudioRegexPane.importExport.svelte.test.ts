// @vitest-environment jsdom
/**
 * The Import and Export buttons of the regex pane over the real history service on the memory doubles, the real flow of
 * `regexFileActions.ts`, the real `exportRegex` (its bytes are the fixtures) and the real English `language`.
 * MOCKED: the page store (DBState is a `$state` object), the file picker (a deferred promise the test settles), the file
 * save (`downloadFile`, which captures the bytes), the alert layer and the heavy modules `process/scripts` imports.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    pickCalls: 0,
    resolvePick: null as null | ((file: { name: string, data: Uint8Array } | null) => void),
    downloads: 0,
    saved: null as Uint8Array | null,
    saveResult: true,
}))

vi.mock('src/ts/globalApi.svelte', () => ({
    getSaveMarkCount: () => 0,
    saveAsset: vi.fn(),
    downloadFile: vi.fn(async (_name: string, data: Uint8Array) => {
        h.downloads += 1
        h.saved = data
        return h.saveResult
    }),
    AppendableBuffer: class {},
}))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const state = $state({ db: { characters: [], modules: [] } as unknown })
    return {
        DBState: state,
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        ReloadGUIPointer: writable(0),
        selectedCharID: writable(0),
        clearCharEmotionCache: () => {},
    }
})
vi.mock('src/ts/storage/database.svelte', async () => {
    const { DBState: state } = await import('src/ts/stores.svelte')
    return { getDatabase: () => state.db, getCurrentCharacter: vi.fn(), getCurrentChat: vi.fn(), defaultSdDataFunc: () => [] }
})
vi.mock('src/ts/util', () => ({
    selectSingleFile: vi.fn(() => {
        h.pickCalls += 1
        return new Promise((resolve) => { h.resolvePick = resolve })
    }),
}))
vi.mock('src/ts/alert', () => ({ alertMd: vi.fn(), alertError: vi.fn(), alertNormal: vi.fn() }))
vi.mock('src/ts/exportNotice', () => ({ downloadNotice: vi.fn() }))
vi.mock('src/ts/parser/parser.svelte', () => ({ assetRegex: {}, risuChatParser: vi.fn() }))
vi.mock('src/ts/process/modules', () => ({ getModuleAssets: vi.fn(() => []), getModuleRegexScripts: vi.fn(() => []), refreshModules: vi.fn() }))
vi.mock('src/ts/process/memory/hypamemory', () => ({ HypaProcesser: class {} }))
vi.mock('src/ts/process/scriptings', () => ({ runLuaEditTrigger: vi.fn() }))
vi.mock('src/ts/plugins/plugins.svelte', () => ({ pluginV2: {} }))
vi.mock('src/ts/process/triggers', () => ({ runTrigger: vi.fn() }))

import { language } from 'src/lang'
import { alertNormal } from 'src/ts/alert'
import { exportRegex } from 'src/ts/process/scripts'
import { DBState } from 'src/ts/stores.svelte'
import { resetPresetAckForTests, setPresetAckLoaderForTests } from '../../ts/studio/edit/presetAck.svelte'
import { createSaveAck, type SaveAckDeps } from '../../ts/studio/edit/saveAck.svelte'
import { presetOwnerKey } from '../../ts/studio/edit/presetTarget'
import { presetNamed, seedPresetDb } from '../../ts/studio/edit/tests/presetFixture.test-helpers'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey, moduleOwnerKey, type OwnerKey } from '../../ts/studio/history/ownerPhase'
import { setStudioHistoryServiceForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { makeCharacter } from '../../ts/studio/history/tests/objService.test-helpers'
import { createClaimDouble, createGate, createMemoryStudioStore, type Gate } from '../../ts/studio/history/tests/studioStoreDoubles'
import { setStudioSelection, studioScreen } from '../../ts/studio/studioScreen.svelte'
import { toastHost } from '../../ts/toast/toastHost.svelte'
import { click, mountInto, part, settle, setupRig, teardownRig, unmountLast } from './StudioLorePane.rig.test-helpers'
import StudioRegexPane from './StudioRegexPane.svelte'

type Entry = Record<string, unknown>
type Host = 'character' | 'module'

const A = characterOwnerKey('A')
const B = characterOwnerKey('B')
const M1 = moduleOwnerKey('M1')
const M2 = moduleOwnerKey('M2')

const addShape = (comment: string): Entry => ({ comment, in: 'find-' + comment, out: 'out-' + comment, type: 'editinput' })
const classicShape = (comment: string): Entry => ({ comment, in: 'find-' + comment, out: 'out-' + comment, type: 'editoutput', flag: 'g', ableFlag: true })

let service: OwnerHistoryService
let claim: ReturnType<typeof createClaimDouble>

function newService(): OwnerHistoryService {
    claim = createClaimDouble()
    service = createOwnerHistoryService({
        store: createMemoryStudioStore({}),
        claim,
        clock: createFakeClock(),
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
        openModuleId: () => 'M1',
    })
    service.setModuleAck('M1', { noteEdit: () => {} })
    service.setModuleAck('M2', { noteEdit: () => {} })
    setStudioHistoryServiceForTests(service)
    return service
}

// Character A and character B each hold the lists given, and the modules M1 and M2 each hold the module list.
async function start(lists: { a?: unknown, b?: unknown, m1?: unknown, m2?: unknown }, options: { ready?: boolean } = {}): Promise<void> {
    DBState.db = {
        characters: [makeCharacter({ customscript: lists.a } as never), makeCharacter({ chaId: 'B', customscript: lists.b } as never)],
        modules: [{ id: 'M1', name: 'M1', assets: [], regex: lists.m1 }, { id: 'M2', name: 'M2', assets: [], regex: lists.m2 }],
    } as unknown as typeof DBState.db
    newService()
    if (options.ready === false) return
    for (const key of [A, B, M1, M2]) await service.whenReady(key)
}

async function mountRegex(host: Host): Promise<HTMLElement> {
    const props: Record<string, unknown> = host === 'character'
        ? { ownerType: 'character', ownerId: 'A', chaId: 'A', moduleId: null, moduleSlotIndex: null }
        : { ownerType: 'module', ownerId: 'M1', chaId: 'A', moduleId: 'M1', moduleSlotIndex: 0 }
    Object.defineProperty(props, 'itemId', { enumerable: true, get: () => studioScreen.selectedItemId })
    studioScreen.selectedOwnerKey = host === 'character' ? 'character:A' : 'module:M1'
    studioScreen.selectedKind = 'regex'
    const mounted = mountInto(StudioRegexPane, props)
    await settle()
    return mounted
}

const characters = (): { customscript?: Entry[] }[] => DBState.db.characters as unknown as { customscript?: Entry[] }[]
const modules = (): { regex: Entry[] }[] => DBState.db.modules as unknown as { regex: Entry[] }[]
const listOf = (host: Host): Entry[] => (host === 'character' ? characters()[0].customscript : modules()[0].regex) as Entry[]
const ownerOf = (host: Host): OwnerKey => (host === 'character' ? A : M1)
const snapshot = (): string => JSON.stringify([characters().map((c) => c.customscript), modules().map((m) => m.regex)])
const button = (name: string): HTMLButtonElement => {
    const found = document.querySelector<HTMLButtonElement>(`[data-testid="${name}"]`)
    if (found === null) throw new Error(`no button ${name}`)
    return found
}
const toastTexts = (): string[] => toastHost.visible.map((toast) => toast.text)

// The bytes the classic Export button writes, from the real `exportRegex`.
async function exportedBytes(rows: unknown[]): Promise<Uint8Array> {
    h.saved = null
    await exportRegex(rows as never)
    if (h.saved === null) throw new Error('exportRegex wrote no file')
    const bytes: Uint8Array = h.saved
    h.downloads = 0
    return bytes
}

async function pickPending(): Promise<void> {
    await vi.waitFor(() => { expect(h.pickCalls).toBeGreaterThan(0) })
}
async function answerPick(bytes: Uint8Array | null): Promise<void> {
    await pickPending()
    if (h.resolvePick === null) throw new Error('no pick is pending')
    h.resolvePick(bytes === null ? null : { name: 'regex.json', data: bytes })
    await settle()
}
const textBytes = (text: string): Uint8Array => new TextEncoder().encode(text)
const fileOf = (data: unknown): Uint8Array => textBytes(JSON.stringify({ type: 'regex', data }))

// The `data` the export button wrote, parsed from the captured bytes.
function exportedData(): unknown {
    if (h.saved === null) throw new Error('nothing was exported')
    const file = JSON.parse(new TextDecoder().decode(h.saved)) as { type: string, data: unknown }
    expect(file.type).toBe('regex')
    return file.data
}

beforeEach(() => {
    setupRig()
    h.pickCalls = 0
    h.resolvePick = null
    h.downloads = 0
    h.saved = null
    h.saveResult = true
    vi.mocked(alertNormal).mockClear()
})
afterEach(async () => {
    await teardownRig()
})

describe('T30: the import button and its pick', () => {
    // A write that lands after the pane is gone would reach the owner the pane was mounted for; the other owner is the one the
    // surface moved to, and it must not be touched either.
    test('(a) a character switch while the pick is pending writes to neither character and posts no toast', async () => {
        await start({ a: [addShape('oldA')], b: [addShape('oldB')], m1: [], m2: [] })
        await mountRegex('character')
        const before = snapshot()
        await click(button('studio-regex-import'))
        await pickPending()
        await unmountLast()
        await service.whenReady(B)
        await answerPick(await exportedBytes([addShape('new'), classicShape('new2')]))
        expect(snapshot()).toBe(before)
        expect(service.view(A).done).toHaveLength(0)
        expect(service.view(B).done).toHaveLength(0)
        expect(toastTexts()).toEqual([])
    })

    test('(a) a module slot removed while the pick is pending writes to no module and posts no toast', async () => {
        await start({ a: [], b: [], m1: [addShape('oldM1')], m2: [addShape('oldM2')] })
        await mountRegex('module')
        await click(button('studio-regex-import'))
        await pickPending()
        await unmountLast()
        const survivor = modules()[1]
        modules().splice(0, 1)
        await service.whenReady(M2)
        const before = JSON.stringify(survivor.regex)
        await answerPick(await exportedBytes([addShape('new')]))
        expect(JSON.stringify(modules()[0].regex)).toBe(before)
        expect(service.view(M1).done).toHaveLength(0)
        expect(service.view(M2).done).toHaveLength(0)
        expect(toastTexts()).toEqual([])
    })

    // A compatibility guard: the list classes the pane cannot edit have no toolbar at all.
    test.each([['a string', 'not a list'], ['an object', { 0: addShape('x') }]])('(b) a list that is %s has no import button and shows the not-editable note', async (_name, list) => {
        await start({ a: list, b: [], m1: [], m2: [] })
        await mountRegex('character')
        expect(document.querySelector('[data-testid="studio-regex-import"]')).toBeNull()
        expect(document.querySelector('[data-testid="studio-regex-export"]')).toBeNull()
        expect(part('studio-regex-not-editable')).not.toBeNull()
    })

    test('(c) while the history is not ready the button is disabled, a tap opens no picker, and it enables once ready', async () => {
        await start({ a: [addShape('old')], b: [], m1: [], m2: [] }, { ready: false })
        const gate: Gate = createGate()
        claim.hook = () => gate.promise
        await mountRegex('character')
        expect(button('studio-regex-import').disabled).toBe(true)
        await click(button('studio-regex-import'))
        expect(h.pickCalls).toBe(0)
        gate.release()
        await service.whenReady(A)
        await settle()
        expect(button('studio-regex-import').disabled).toBe(false)
    })

    test('(d) a module that is gone while the pane stays mounted shows the module-gone refusal and writes nothing', async () => {
        await start({ a: [], b: [], m1: [addShape('old')], m2: [] })
        await mountRegex('module')
        await click(button('studio-regex-import'))
        await pickPending()
        modules().splice(0, 1)
        await answerPick(await exportedBytes([addShape('new')]))
        expect(part('studio-regex-list-refusal')?.textContent).toBe(language.studioRefusalModuleGone)
        expect(toastTexts()).toEqual([])
        expect(service.view(M1).done).toHaveLength(0)
    })

    test('a second tap while the pick is pending opens no second picker, and the button enables again after a cancelled pick', async () => {
        await start({ a: [addShape('old')], b: [], m1: [], m2: [] })
        await mountRegex('character')
        await click(button('studio-regex-import'))
        await pickPending()
        expect(button('studio-regex-import').disabled).toBe(true)
        await click(button('studio-regex-import'))
        expect(h.pickCalls).toBe(1)
        await answerPick(null)
        expect(button('studio-regex-import').disabled).toBe(false)
        expect(listOfCharacter()).toHaveLength(1)
        expect(toastTexts()).toEqual([])
    })
})

const listOfCharacter = (): Entry[] => listOf('character')

describe('the notices of an import', () => {
    test.each([
        ['text that is not JSON', textBytes('not json at all')],
        ['a lorebook file', textBytes(JSON.stringify({ type: 'lore', data: [] }))],
        ['a file with no data', textBytes(JSON.stringify({ type: 'regex' }))],
    ])('%s gives the not-a-regex-file notice and writes nothing', async (_name, bytes) => {
        await start({ a: [addShape('old')], b: [], m1: [], m2: [] })
        await mountRegex('character')
        const before = snapshot()
        await click(button('studio-regex-import'))
        await answerPick(bytes)
        expect(toastTexts()).toEqual([language.studioRegexImportNotRegex])
        expect(snapshot()).toBe(before)
        expect(service.view(A).done).toHaveLength(0)
    })

    test('a file with an empty list gives the empty notice and writes nothing', async () => {
        await start({ a: [addShape('old')], b: [], m1: [], m2: [] })
        await mountRegex('character')
        const before = snapshot()
        await click(button('studio-regex-import'))
        await answerPick(fileOf([]))
        expect(toastTexts()).toEqual([language.studioRegexImportEmpty])
        expect(snapshot()).toBe(before)
        expect(service.view(A).done).toHaveLength(0)
    })

    test('a file with one entry that is not an object names the count and place and writes nothing', async () => {
        await start({ a: [addShape('old')], b: [], m1: [], m2: [] })
        await mountRegex('character')
        const before = snapshot()
        await click(button('studio-regex-import'))
        await answerPick(fileOf([addShape('good'), null, addShape('good2')]))
        expect(toastTexts()).toHaveLength(1)
        expect(toastTexts()[0]).toMatch(/^1 entry is not a regex entry: entry 2, /)
        expect(snapshot()).toBe(before)
        expect(service.view(A).done).toHaveLength(0)
    })

    test.each(['character', 'module'] as const)('a good file appends its entries to the %s as one step and gives the count notice', async (host) => {
        await start({ a: [addShape('old')], b: [], m1: [addShape('old')], m2: [] })
        await mountRegex(host)
        await click(button('studio-regex-import'))
        await answerPick(await exportedBytes([addShape('n1'), classicShape('n2')]))
        expect(listOf(host).map((entry) => entry.comment)).toEqual(['old', 'n1', 'n2'])
        expect(service.view(ownerOf(host)).done).toHaveLength(1)
        expect(toastTexts()).toEqual([language.studioRegexImported(2)])
    })
})

describe('T32: the export button', () => {
    test.each(['character', 'module'] as const)('a %s exports its own list in the classic file shape', async (host) => {
        await start({ a: [addShape('x1'), classicShape('x2')], b: [], m1: [addShape('x1'), classicShape('x2')], m2: [] })
        await mountRegex(host)
        await click(button('studio-regex-export'))
        await vi.waitFor(() => { expect(h.downloads).toBe(1) })
        expect(exportedData()).toEqual(listOf(host))
    })

    test.each([['empty', []], ['absent', undefined]])('an %s list disables Export and makes no download', async (_name, list) => {
        await start({ a: list, b: [], m1: [], m2: [] })
        await mountRegex('character')
        const exportButton = button('studio-regex-export')
        expect(exportButton.disabled).toBe(true)
        await click(exportButton)
        await settle()
        expect(h.downloads).toBe(0)
        expect(toastTexts()).toEqual([])
    })

    test('a save that returns false gives no success dialog and no toast', async () => {
        await start({ a: [addShape('x1')], b: [], m1: [], m2: [] })
        await mountRegex('character')
        h.saveResult = false
        await click(button('studio-regex-export'))
        await vi.waitFor(() => { expect(h.downloads).toBe(1) })
        await settle()
        expect(alertNormal).not.toHaveBeenCalled()
        expect(toastTexts()).toEqual([])
    })

    describe('a preset', () => {
        let ids: string[]
        const slotRegex = (index: number): Entry[] => (DBState.db.botPresets[index] as unknown as { regex: Entry[] }).regex

        // A: active, its working list differs from its slot's. B: inactive with two rows.
        // A fresh ack on its own fake clock for each factory call: the holder disposes the ack it built.
        function freshAck() {
            const deps: SaveAckDeps = {
                getMarkCount: () => 0,
                getCommittedMarkCount: () => 0,
                afterNextCommit: () => {},
                requestSaveNow: () => {},
                getPeerSaveCount: () => 0,
                onStopped: () => () => {},
                isStopped: () => false,
                subscribeFailure: () => () => {},
                currentFailure: () => null,
                frozenKeys: () => new Set<string>(),
                isCharacterUnsavable: () => false,
                onPassStart: () => () => {},
                visible: () => true,
                onVisibilityChange: () => () => {},
                clock: createFakeClock(),
            }
            return createSaveAck(deps, { kind: 'preset', verdict: () => 'saved' })
        }

        beforeEach(() => {
            setPresetAckLoaderForTests(async () => () => freshAck())
        })
        afterEach(() => {
            resetPresetAckForTests()
        })

        async function startPresets(): Promise<void> {
            ids = seedPresetDb([presetNamed('A', 'a=A'), presetNamed('B', 'b=B')], 0, 'a=A')
            Object.assign(DBState.db.botPresets[0], { regex: [addShape('slotA0')] })
            Object.assign(DBState.db.botPresets[1], { regex: [addShape('B0'), addShape('B1')] })
            DBState.db.presetRegex = [addShape('working0'), classicShape('working1')] as unknown as typeof DBState.db.presetRegex
            newService()
            for (const id of ids) await service.whenReady(presetOwnerKey(id))
        }

        async function mountPreset(index: number): Promise<HTMLElement> {
            setStudioSelection(`preset:${index}`, 'regex', null)
            const props: Record<string, unknown> = { ownerType: 'preset', presetId: ids[index], ownerId: String(index), chaId: 'A', moduleId: null, moduleSlotIndex: null }
            Object.defineProperty(props, 'itemId', { enumerable: true, get: () => studioScreen.selectedItemId })
            const mounted = mountInto(StudioRegexPane, props)
            await settle()
            return mounted
        }

        test('the active preset exports the working list, not its slot', async () => {
            await startPresets()
            await mountPreset(0)
            await click(button('studio-regex-export'))
            await vi.waitFor(() => { expect(h.downloads).toBe(1) })
            expect(exportedData()).toEqual(DBState.db.presetRegex)
            expect(exportedData()).not.toEqual(slotRegex(0))
        })

        test('an inactive preset exports its slot', async () => {
            await startPresets()
            await mountPreset(1)
            await click(button('studio-regex-export'))
            await vi.waitFor(() => { expect(h.downloads).toBe(1) })
            expect(exportedData()).toEqual(slotRegex(1))
        })
    })
})
