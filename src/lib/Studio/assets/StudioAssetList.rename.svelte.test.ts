// @vitest-environment jsdom
/**
 * Renaming a row in the Studio asset list: the name field commits on blur or Enter as one history step, Esc and an
 * unchanged value commit nothing, an IME's Enter belongs to the IME, the folder follows the name, and no text of the
 * owner is rewritten. The history service is real, on the memory doubles.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({
    getSaveMarkCount: () => h.marks,
    getFileSrc: async (path: string, use: string) => `blob:${use}:${path}`,
}))

const db = $state({ db: { characters: [] as LiveCharacter[], useAdditionalAssetsPreview: false, modules: [] as unknown[] } })
const selection = $state({ selId: 0 })

// Getters: the statically imported modules are evaluated before these consts are initialised.
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        get DBState() { return db },
        get selIdState() { return selection },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        frozenSaveKeysStore: writable([]),
        clearCharEmotionCache: () => {},
    }
})
vi.mock('src/lang', async () => {
    const helpers = await import('src/ts/studio/studioFixtures.test-helpers')
    const base = helpers.studioLanguageMock()
    const call = (key: string) => (...args: (string | number)[]) => `${key}(${args.join(',')})`
    const table: Record<string, unknown> = { sidebarUi: { noAssets: 'noAssets' } }
    for (const key of ['studioAssetEmotionsElsewhere', 'studioAssetRowMenu', 'studioAssetDeletedOne']) table[key] = call(key)
    return { language: new Proxy(table, { get: (target, key) => (typeof key === 'symbol' ? undefined : key in target ? target[key] : base[key]) }) }
})

import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import type { AssetSizeJob, StoredSize } from 'src/ts/studio/assets/assetSizes'
import { resetStudioToastsForTests, retireAssetToasts } from 'src/ts/studio/edit/studioToasts'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createToastHost, resetToastHostForTests, type ToastHost } from 'src/ts/toast/toastHost.svelte'
import { applyFolderOps, createFolder, folderOf, moveManyToFolder, readFolderDoc } from '../../../ts/studio/assets/folderCodec'
import { ASSET_FOLDER_KEY } from '../../../ts/studio/assets/assetOwnerKeys'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from '../../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryLoaderForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks } from '../../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../../ts/studio/history/tests/studioStoreDoubles'
import { assetRow } from '../../../ts/studio/assets/assetFixtures.test-helpers'
import type { UsedInPort } from '../../../ts/studio/assets/assetPresentation'
import StudioAssetList, { setSessionAssetSizeJobForTests } from './StudioAssetList.svelte'

// No size is ever read: the production size job is not loaded.
const noSizes: AssetSizeJob = { peek: () => undefined, snapshot: () => new Map<string, StoredSize>(), ensure: async () => true }

interface LiveCharacter {
    chaId: string
    type: string
    desc: string
    alternateGreetings: string[]
    chats: { id: string; note: string; fmIndex?: number }[]
    chatPage: number
    additionalAssets: string[][]
    emotionImages: string[][]
    extentions?: Record<string, unknown>
}

const A = characterOwnerKey('A')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

// A folder document written by the codec itself: the folder `Faces` holding `smile`.
function folderDocWithSmile(): unknown {
    const created = createFolder(undefined, 'Faces')
    if (!created.ok) throw new Error('the folder was not created')
    const withFolder = applyFolderOps(undefined, created.ops)
    if (!withFolder.ok) throw new Error('the folder was not applied')
    const moved = moveManyToFolder(withFolder.doc, ['smile'], 'Faces')
    if (!moved.ok) throw new Error('the entry was not moved')
    const placed = applyFolderOps(withFolder.doc, moved.ops)
    if (!placed.ok) throw new Error('the entry was not applied')
    return placed.doc
}

function makeCharacter(): LiveCharacter {
    return {
        chaId: 'A',
        type: 'character',
        desc: 'd0',
        alternateGreetings: ['g0', 'g1'],
        chats: [{ id: 'c1', note: 'n0', fmIndex: 2 }],
        chatPage: 0,
        additionalAssets: [assetRow('smile', 'assets/smile.png'), assetRow('grin', 'assets/grin.png')],
        emotionImages: [],
        extentions: { [ASSET_FOLDER_KEY]: folderDocWithSmile() },
    }
}

let service: OwnerHistoryService
let toastHost: ToastHost
let mounted: { app: ReturnType<typeof mount>; host: HTMLElement }[] = []

async function settle(): Promise<void> {
    await drainMicrotasks()
    flushSync()
    await drainMicrotasks()
}

async function show(usedIn?: UsedInPort): Promise<void> {
    const host = document.createElement('div')
    document.body.appendChild(host)
    mounted.push({ app: mount(StudioAssetList, { target: host, props: { chaId: 'A', host: toastHost, ...(usedIn ? { usedIn } : {}) } }), host })
    flushSync()
    await settle()
}

const parts = (name: string, from: ParentNode = document) => Array.from(from.querySelectorAll<HTMLElement>(`[data-part="${name}"]`))
const nameField = (index: number): HTMLInputElement => parts('studio-asset-name')[index] as HTMLInputElement
const live = () => db.db.characters[0]
const textsOf = () => JSON.stringify({ desc: live().desc, greetings: live().alternateGreetings, note: live().chats[0].note, fm: live().chats[0].fmIndex })

function type(field: HTMLInputElement, value: string): void {
    field.focus()
    field.value = value
}

function key(field: HTMLInputElement, init: KeyboardEventInit): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    field.dispatchEvent(event)
    return event
}

beforeEach(async () => {
    h.marks = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    setSessionAssetSizeJobForTests(noSizes)
    db.db.useAdditionalAssetsPreview = false
    db.db.characters = [makeCharacter()]
    selection.selId = 0
    studioScreen.chaId = 'A'
    toastHost = createToastHost({ clock: { now: () => 0, after: () => () => {} } })
    service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock: createFakeClock(),
        pageSession: 'p1',
        registerLeaveFlush: () => () => {},
        onLanded: retireAssetToasts,
    })
    setStudioHistoryServiceForTests(service)
    setStudioVisitAckForTests({ noteEdit: () => {}, dispose: () => {} } as never)
    await service.whenReady(A)
})

afterEach(async () => {
    for (const entry of mounted.splice(0)) {
        await unmount(entry.app)
        entry.host.remove()
    }
    vi.restoreAllMocks()
    setSessionAssetSizeJobForTests(undefined)
    resetStudioToastsForTests()
    resetToastHostForTests()
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

describe('committing a name', () => {
    test('blur commits one rename step in one write, and no text of the owner changes', async () => {
        await show()
        const texts = textsOf()
        const marks = h.marks
        type(nameField(0), 'happy')
        nameField(0).blur()
        await settle()
        const done = service.view(A).done
        expect(done).toHaveLength(1)
        expect(done[0].label).toEqual({ kind: 'assetRename', from: 'smile', to: 'happy' })
        expect(done[0].ops.map((op) => op.op)).not.toContain('textEdit')
        expect(done[0].ops.map((op) => op.op)).toContain('assetRowSet')
        expect(h.marks).toBe(marks + 1)
        expect(live().additionalAssets.map((row) => row[0])).toEqual(['happy', 'grin'])
        expect(textsOf()).toBe(texts)
        expect(nameField(0).value).toBe('happy')
    })

    test('Enter commits and keeps focus in the field', async () => {
        await show()
        type(nameField(1), 'smirk')
        const event = key(nameField(1), { key: 'Enter' })
        await settle()
        expect(event.defaultPrevented).toBe(true)
        expect(live().additionalAssets.map((row) => row[0])).toEqual(['smile', 'smirk'])
        expect(service.view(A).done).toHaveLength(1)
        expect(document.activeElement).toBe(nameField(1))
    })

    test('the folder entry follows the name inside the same step', async () => {
        await show()
        expect(folderOf(readFolderDoc(live().extentions?.[ASSET_FOLDER_KEY]).doc, 'smile')).toBe('Faces')
        type(nameField(0), 'happy')
        nameField(0).blur()
        await settle()
        const doc = readFolderDoc(live().extentions?.[ASSET_FOLDER_KEY]).doc
        expect(folderOf(doc, 'happy')).toBe('Faces')
        expect(folderOf(doc, 'smile')).toBeNull()
        const done = service.view(A).done
        expect(done).toHaveLength(1)
        expect(done[0].ops.map((op) => op.op)).toContain('assetFolderSet')
    })

    test('Esc puts the previous name back, and the blur after it commits nothing', async () => {
        await show()
        type(nameField(0), 'zzz')
        key(nameField(0), { key: 'Escape' })
        expect(nameField(0).value).toBe('smile')
        nameField(0).blur()
        await settle()
        expect(service.view(A).done).toHaveLength(0)
        expect(live().additionalAssets[0][0]).toBe('smile')
    })

    test('an unchanged value commits nothing and does not ask the service', async () => {
        await show()
        const rename = vi.spyOn(service, 'assetRename')
        nameField(0).focus()
        nameField(0).blur()
        type(nameField(0), 'smile')
        key(nameField(0), { key: 'Enter' })
        await settle()
        expect(rename).not.toHaveBeenCalled()
        expect(service.view(A).done).toHaveLength(0)
        expect(h.marks).toBe(0)
    })

    test('an Enter that confirms an IME composition commits nothing', async () => {
        await show()
        const rename = vi.spyOn(service, 'assetRename')
        type(nameField(0), 'ㅎㅐ')
        const composing = key(nameField(0), { key: 'Enter', isComposing: true })
        expect(composing.defaultPrevented).toBe(false)
        expect(rename).not.toHaveBeenCalled()
        key(nameField(0), { key: 'Enter', keyCode: 229 })
        expect(rename).not.toHaveBeenCalled()
        // The same key after the composition ended commits.
        key(nameField(0), { key: 'Enter' })
        await settle()
        expect(rename).toHaveBeenCalledTimes(1)
        expect(live().additionalAssets[0][0]).toBe('ㅎㅐ')
    })

    test('an emptied field goes back to the row\'s name, says why, and does not ask the service', async () => {
        await show()
        const rename = vi.spyOn(service, 'assetRename')
        for (const blank of ['', '   ']) {
            type(nameField(0), blank)
            nameField(0).blur()
            await settle()
            expect(rename).not.toHaveBeenCalled()
            expect(nameField(0).value).toBe('smile')
            expect(parts('studio-asset-refusal')).toHaveLength(1)
            expect(parts('studio-asset-refusal')[0].textContent).toBe('studioEmotionNameBlank')
        }
        expect(service.view(A).done).toHaveLength(0)
    })

    test('a valid rename after a blank one clears the message', async () => {
        await show()
        type(nameField(0), ' ')
        nameField(0).blur()
        await settle()
        expect(parts('studio-asset-refusal')).toHaveLength(1)
        type(nameField(0), 'happy')
        nameField(0).blur()
        await settle()
        expect(parts('studio-asset-refusal')).toHaveLength(0)
        expect(live().additionalAssets[0][0]).toBe('happy')
    })

    test('a delete after a blank rename clears the message', async () => {
        await show()
        type(nameField(0), '')
        nameField(0).blur()
        await settle()
        expect(parts('studio-asset-refusal')).toHaveLength(1)
        parts('studio-asset-row-more')[1].click()
        await settle()
        parts('studio-asset-menu-delete')[0].click()
        await settle()
        expect(live().additionalAssets.map((row) => row[0])).toEqual(['smile'])
        expect(parts('studio-asset-refusal')).toHaveLength(0)
    })

    test('an emptied field says nothing while no history service exists', async () => {
        // The loader never settles: the list stays without a service for the whole test.
        setStudioHistoryServiceForTests(null)
        setStudioHistoryLoaderForTests(() => new Promise(() => {}))
        await show()
        type(nameField(0), '')
        nameField(0).blur()
        await settle()
        expect(parts('studio-asset-refusal')).toHaveLength(0)
        expect(nameField(0).value).toBe('smile')
    })

    test('the blur of a removed row\'s emptied field shows no message', async () => {
        await show()
        type(nameField(0), '')
        db.db.characters[0].additionalAssets = [assetRow('grin', 'assets/grin.png')]
        // A handler that throws on the removed row's blur reaches the window as an error event.
        const thrown: unknown[] = []
        const onError = (event: ErrorEvent) => { thrown.push(event.error); event.preventDefault() }
        window.addEventListener('error', onError)
        try {
            nameField(0).blur()
            await settle()
        } finally {
            window.removeEventListener('error', onError)
        }
        expect(thrown).toEqual([])
        expect(parts('studio-asset-refusal')).toHaveLength(0)
    })

    test('a refused rename shows its refusal and puts the name back', async () => {
        await show()
        // The selected character moved on: the service refuses the write.
        studioScreen.chaId = 'B'
        type(nameField(0), 'happy')
        nameField(0).blur()
        await settle()
        expect(nameField(0).value).toBe('smile')
        expect(parts('studio-asset-refusal')[0].textContent).toBe('studioRefusalNotSelected')
        expect(live().additionalAssets[0][0]).toBe('smile')
        expect(service.view(A).done).toHaveLength(0)
    })

    test('a result that landed nothing posts no toast and leaves focus in the field', async () => {
        await show()
        vi.spyOn(service, 'assetRename').mockReturnValue({ ok: true, unchanged: true })
        type(nameField(0), 'happy')
        key(nameField(0), { key: 'Enter' })
        await settle()
        expect(toastHost.visible).toHaveLength(0)
        expect(document.activeElement).toBe(nameField(0))
        expect(nameField(0).value).toBe('smile')
    })
})

describe('the used-in port', () => {
    const port = (note: { text: string; action: string } | null): UsedInPort => ({
        usedText: (name) => `${name} used 2`,
        showUsed: vi.fn(),
        renamedNote: vi.fn(() => note),
        showRenamed: vi.fn(),
    })

    test('with a port each row shows its button and a renamed field shows the port\'s note under it', async () => {
        const usedIn = port({ text: '2 places still use the old name', action: 'Show' })
        await show(usedIn)
        expect(parts('studio-asset-used').map((button) => button.textContent)).toEqual(['smile used 2', 'grin used 2'])
        expect(parts('studio-asset-renamed-note')).toHaveLength(0)
        type(nameField(0), 'happy')
        nameField(0).blur()
        await settle()
        const note = parts('studio-asset-renamed-note')
        expect(note).toHaveLength(1)
        expect(note[0].textContent).toContain('2 places still use the old name')
        expect(usedIn.renamedNote).toHaveBeenCalledWith('smile')
        parts('studio-asset-renamed-show')[0].click()
        expect(usedIn.showRenamed).toHaveBeenCalledWith('smile')
    })

    test('the renamed note of a deleted row does not pass to the next row over the same file', async () => {
        db.db.characters[0].additionalAssets = [assetRow('smile', 'assets/smile.png'), assetRow('smile2', 'assets/smile.png'), assetRow('grin', 'assets/grin.png')]
        await show(port({ text: 'still used under the old name', action: 'Show' }))
        type(nameField(0), 'happy')
        nameField(0).blur()
        await settle()
        expect(parts('studio-asset-renamed-note')).toHaveLength(1)
        ;(parts('studio-asset-row-more')[0]).click()
        await settle()
        parts('studio-asset-menu-delete')[0].click()
        await settle()
        expect(live().additionalAssets.map((row) => row[0])).toEqual(['smile2', 'grin'])
        expect(parts('studio-asset-renamed-note')).toHaveLength(0)
    })

    test('a port with no note leaves the renamed field bare', async () => {
        await show(port(null))
        type(nameField(0), 'happy')
        nameField(0).blur()
        await settle()
        expect(parts('studio-asset-renamed-note')).toHaveLength(0)
    })

    test('without a port neither the button nor the note renders after a rename', async () => {
        await show()
        type(nameField(0), 'happy')
        nameField(0).blur()
        await settle()
        expect(parts('studio-asset-used')).toHaveLength(0)
        expect(parts('studio-asset-renamed-note')).toHaveLength(0)
    })
})
