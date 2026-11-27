// @vitest-environment jsdom
/**
 * The portrait section of the Display form on the portrait segment of the Studio detail: where it sits, the empty state,
 * the tiles with their names, Make main and Remove through their menus with the toasts the plan names, and the Add button
 * running the real add flow for this owner (the chooser and the store are mocks; the history service is real on the memory
 * doubles). B-T15 and the rendered half of B-T7.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { makeCharacter, makeChat, makeInput, studioDbOf } from '../../ts/studio/studioFixtures.test-helpers'

const h = vi.hoisted(() => ({
    marks: 0,
    pick: null as null | (() => Promise<unknown>),
    saved: [] as string[],
}))
const db = $state({ db: {} as ReturnType<typeof studioDbOf> })
const selection = $state({ selId: 0 })
const ReloadGUIPointer = writable(0)
const MobileGUI = writable(false)
const settingsOpen = writable(false)
const CharConfigSubMenu = writable(0)
const SettingsMenuIndex = writable(-1)
const botMakerMode = writable(false)
const sideBarStore = writable(false)
const QuickSettings = $state({ open: true })

// Getters: the statically imported modules are evaluated before these consts are initialised.
vi.mock('../../ts/stores.svelte', () => ({
    get DBState() { return db },
    get selIdState() { return selection },
    get ReloadGUIPointer() { return ReloadGUIPointer },
    get MobileGUI() { return MobileGUI },
    get settingsOpen() { return settingsOpen },
    get CharConfigSubMenu() { return CharConfigSubMenu },
    get SettingsMenuIndex() { return SettingsMenuIndex },
    get botMakerMode() { return botMakerMode },
    get sideBarStore() { return sideBarStore },
    get QuickSettings() { return QuickSettings },
    frozenSaveKeysStore: writable([]),
    clearCharEmotionCache: () => {},
}))
vi.mock('../../ts/globalApi.svelte', () => ({
    getSaveMarkCount: () => h.marks,
    getFileSrc: async (path: string, use: string) => `blob:${use}:${path}`,
    saveAsset: async () => {
        const path = 'assets/' + 'n'.repeat(64) + '.png'
        h.saved.push(path)
        return path
    },
}))
vi.mock('../../ts/studio/assets/filePicker', () => ({
    pickFiles: () => (h.pick ? h.pick() : Promise.resolve({ kind: 'cancelled' })),
    beginPickBusy: () => ({ end: () => {} }),
    readPickedFileBytes: async () => new Uint8Array([1, 2, 3]),
}))
vi.mock('../../ts/studio/assets/portraitTextChunks', () => ({ readPortraitTextChunks: async () => ({ Title: 't', Comment: 'c' }) }))
vi.mock('../../ts/chatShell/shellSwitch.svelte', () => ({ shellEligible: () => false }))
vi.mock('../../ts/process/moduleRefList', () => ({ moduleListOf: () => [] }))
vi.mock('../../lang', async () => {
    const helpers = await import('../../ts/studio/studioFixtures.test-helpers')
    const base = helpers.studioLanguageMock()
    const call = (key: string) => (...args: (string | number)[]) => `${key}(${args.join(',')})`
    const table: Record<string, unknown> = { sidebarUi: { notAllowed: 'notAllowed', noAssets: 'noAssets' } }
    for (const key of ['studioAssetEmotionsElsewhere', 'studioAssetRowMenu', 'studioAssetSelectedCount', 'studioAssetFilterEmpty', 'studioAssetDeletedOne', 'studioEmotionFilterEmpty', 'studioDisplaySegPhoto', 'studioDisplaySegAssets']) table[key] = call(key)
    return { language: new Proxy(table, { get: (target, key) => (typeof key === 'symbol' ? undefined : key in target ? target[key] : base[key]) }) }
})

import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from '../../ts/storage/characterSaveMarks'
import type { toSaveType } from '../../ts/storage/risuSave'
import { resetStudioToastsForTests, retireAssetToasts } from '../../ts/studio/edit/studioToasts'
import type { SaveAck } from '../../ts/studio/edit/saveAck.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from '../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import { writeDisplaySegment } from '../../ts/studio/displaySegment'
import { closeStudio, openStudio, resetStudioScreenForTests } from '../../ts/studio/studioScreen.svelte'
import { setStudioEnabled } from '../../ts/studio/studioSwitch.svelte'
import { resetToastHostForTests, toastHost } from '../../ts/toast/toastHost.svelte'
import { setSessionAssetSizeJobForTests } from './assets/StudioAssetList.svelte'
import type { AssetSizeJob, StoredSize } from '../../ts/studio/assets/assetSizes'
import StudioDetail from './StudioDetail.svelte'

const noSizes: AssetSizeJob = { peek: () => undefined, snapshot: () => new Map<string, StoredSize>(), ensure: async () => true }
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
const OWNER = characterOwnerKey('cha-1')
const hash = (letter: string): string => 'assets/' + letter.repeat(64) + '.png'
const M = hash('m')
const P = hash('p')
const Q = hash('q')
const displayTarget = { owner: { type: 'character', id: 'cha-1' }, kind: 'display', item: 'cha-1/display:0', from: 'chat' } as const
const rowOf = (uri: string, name: string) => ({ type: 'icon', uri, name, ext: 'png' })

type Live = Record<string, unknown> & { image?: string; ccAssets?: { uri: string; name: string }[] }

let app: ReturnType<typeof mount> | undefined
let host: HTMLElement | undefined
let service: OwnerHistoryService

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
const parts = (name: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-part="${name}"]`))
const live = (): Live => db.db.characters[0] as unknown as Live
const toastTexts = (): string[] => toastHost.visible.map((toast) => toast.text)
const steps = () => service.view(OWNER).done

async function settle(): Promise<void> {
    await drainMicrotasks()
    flushSync()
    await drainMicrotasks()
}

async function show(overrides: Record<string, unknown>, options: { held?: boolean } = {}): Promise<void> {
    db.db = studioDbOf(makeInput({
        character: { ...makeCharacter({ chats: [makeChat({ id: 'chat-1', name: 'First chat' })] }), name: 'Alice', ...overrides },
    }))
    writeDisplaySegment('cha-1', 'photo')
    openStudio(displayTarget, null)
    const claim = createClaimDouble()
    if (options.held) claim.forced = 'held'
    service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim,
        clock: createFakeClock(),
        pageSession: 'p1',
        registerLeaveFlush: () => () => {},
        onLanded: retireAssetToasts,
    })
    setStudioHistoryServiceForTests(service)
    await service.whenReady(OWNER)
    if (app) await unmount(app)
    host?.remove()
    host = document.createElement('div')
    document.body.appendChild(host)
    app = mount(StudioDetail, { target: host })
    flushSync()
    await settle()
}

async function click(element: HTMLElement | null): Promise<void> {
    if (!element) throw new Error('nothing to click')
    element.click()
    flushSync()
    await settle()
}

const buttonByText = (text: string): HTMLElement | null =>
    Array.from(document.querySelectorAll<HTMLElement>('button, [role="menuitem"]')).find((element) => element.textContent?.trim() === text) ?? null

const stubAck = { display: 'saved', canRetry: () => false, retry: () => false, noteEdit: () => {}, dispose: () => {} } as unknown as SaveAck

beforeEach(() => {
    localStorage.clear()
    h.marks = 0
    h.pick = null
    h.saved.length = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    settingsOpen.set(false)
    MobileGUI.set(false)
    selection.selId = 0
    setStudioEnabled(true)
    setSessionAssetSizeJobForTests(noSizes)
    setStudioVisitAckForTests(stubAck)
})

afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    host?.remove()
    host = undefined
    setSessionAssetSizeJobForTests(undefined)
    resetStudioToastsForTests()
    resetToastHostForTests()
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
    setStudioEnabled(false)
    localStorage.clear()
})

describe('B-T15: where the section sits and what it shows', () => {
    test('the main tile is inside the portrait panel and comes before the hide-icon switch', async () => {
        await show({ image: M, ccAssets: [rowOf(P, 'second')] })
        const main = part('studio-portrait-main')
        const panel = document.querySelector('[data-part="studio-display-panel"][data-seg="photo"]')
        expect(main).not.toBeNull()
        expect(panel?.contains(main)).toBe(true)
        const hide = part('studio-display-hide-icon')
        expect(hide).not.toBeNull()
        expect(main!.compareDocumentPosition(hide!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        // The main tile holds the picture and nothing else the theme could need.
        expect(main!.querySelectorAll('[data-part]')).toHaveLength(0)
        await vi.waitFor(() => {
            flushSync()
            expect(main!.querySelector('img')?.getAttribute('src')).toBe(`blob:whole:${M}`)
        })
    })

    test('with no main photo the empty state offers Add with its note', async () => {
        await show({ image: '', ccAssets: [] })
        expect(part('studio-portrait-main')).toBeNull()
        const empty = part('studio-portrait-empty')
        expect(empty).not.toBeNull()
        expect(empty!.querySelector('button')?.textContent?.trim()).toBe('studioPortraitAdd')
        expect(empty!.textContent).toContain('studioPortraitAddNote')
    })

    test('each other photo shows its name, its picture and its own menu button', async () => {
        await show({ image: M, ccAssets: [rowOf(P, 'second'), rowOf(Q, 'third')] })
        const tiles = parts('studio-portrait-alt')
        expect(tiles.map((tile) => tile.textContent?.trim())).toEqual(['second', 'third'])
        await vi.waitFor(() => {
            flushSync()
            expect(tiles.map((tile) => tile.querySelector('img')?.getAttribute('src'))).toEqual([`blob:whole:${P}`, `blob:whole:${Q}`])
        })
        expect(parts('studio-portrait-alt-more').map((button) => button.getAttribute('aria-label'))).toEqual(['studioAssetRowMenu(second)', 'studioAssetRowMenu(third)'])
    })

    test('the main tile is square, and tall (2:3) once the large portrait switch is on', async () => {
        await show({ image: M, largePortrait: false })
        expect(part('studio-portrait-main')!.className).toContain('aspect-square')
        await show({ image: M, largePortrait: true })
        expect(part('studio-portrait-main')!.className).toContain('aspect-[2/3]')
    })
})

describe('B-T15: Make main and Remove through the menus', () => {
    test('Make main lands one portraitMain step and the tiles show the swap', async () => {
        await show({ image: M, ccAssets: [rowOf(P, 'second')] })
        await click(part('studio-portrait-alt-more'))
        const item = parts('studio-portrait-make-main')[0]
        expect(item.getAttribute('role')).toBe('menuitem')
        expect(item.textContent?.trim()).toBe('studioPortraitMakeMain')
        await click(item)
        expect(steps()).toHaveLength(1)
        expect(steps()[0].label).toEqual({ kind: 'portraitMain' })
        expect(live().image).toBe(P)
        await vi.waitFor(() => {
            flushSync()
            expect(part('studio-portrait-main')!.querySelector('img')?.getAttribute('src')).toBe(`blob:whole:${P}`)
        })
        expect(parts('studio-portrait-alt').map((tile) => tile.textContent?.trim())).toEqual(['iconx'])
        expect(part('studio-portrait-menu')).toBeNull()
    })

    test('removing the main photo with other photos promotes the first one and says so, with an Undo that brings the photo back', async () => {
        await show({ image: M, ccAssets: [rowOf(P, 'second')] })
        await click(part('studio-portrait-more'))
        await click(buttonByText('remove'))
        expect(live().image).toBe(P)
        expect(steps()[0].label).toEqual({ kind: 'portraitRemove' })
        expect(toastTexts()).toEqual(['studioPortraitPromoted'])
        expect(toastHost.visible[0].actionLabel).toBe('studioToastUndo')
        expect(service.undo(OWNER).ok).toBe(true)
        expect(live().image).toBe(M)
    })

    test('removing the main photo with no other says the photo was removed, and the empty state appears', async () => {
        await show({ image: M, ccAssets: [] })
        await click(part('studio-portrait-more'))
        await click(buttonByText('remove'))
        expect(toastTexts()).toEqual(['studioPortraitRemoved'])
        expect(live().image).toBe('')
        expect(part('studio-portrait-empty')).not.toBeNull()
    })

    test('removing another photo says the photo was removed and keeps the main', async () => {
        await show({ image: M, ccAssets: [rowOf(P, 'second'), rowOf(Q, 'third')] })
        await click(parts('studio-portrait-alt-more')[1])
        await click(parts('studio-portrait-alt-remove')[0])
        expect(toastTexts()).toEqual(['studioPortraitRemoved'])
        expect(live().image).toBe(M)
        expect(parts('studio-portrait-alt').map((tile) => tile.textContent?.trim())).toEqual(['second'])
    })

    test('a removal the history cannot keep is refused in the form\'s own line, with nothing changed and no toast', async () => {
        await show({ image: M, ccAssets: [rowOf(P, 'second')] }, { held: true })
        await click(part('studio-portrait-more'))
        await click(buttonByText('remove'))
        expect(part('studio-form-refusal')?.textContent).toBe('studioAssetRefusalOtherTabCharacter')
        expect(live().image).toBe(M)
        expect(toastTexts()).toEqual([])
        expect(steps()).toHaveLength(0)
    })

    test('the menu closes on Escape', async () => {
        await show({ image: M, ccAssets: [] })
        await click(part('studio-portrait-more'))
        const menu = part('studio-portrait-menu')!
        menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        flushSync()
        expect(part('studio-portrait-menu')).toBeNull()
    })
})

describe('E8: the Add button runs the add flow for this owner', () => {
    const file = { name: 'new.png', size: 3 } as File

    test('Add stores the picked picture and lands one portraitAdd step with its text notes, shown under the main photo', async () => {
        await show({ image: '', ccAssets: [] })
        h.pick = async () => ({ kind: 'picked', files: [file], badType: [], tooLarge: [] })
        await click(buttonByText('studioPortraitAdd'))
        await settle()
        expect(h.saved).toEqual([hash('n')])
        expect(steps()).toHaveLength(1)
        expect(steps()[0].label).toEqual({ kind: 'portraitAdd' })
        expect(live().image).toBe(hash('n'))
        expect(part('studio-portrait-main')).not.toBeNull()
        expect(part('studio-portrait-png-note')?.textContent).toBe('studioPngNote(2)')
        expect(toastTexts()).toEqual([])
    })

    test('Replace in the main tile\'s menu runs the same flow and keeps the old main as another photo', async () => {
        await show({ image: M, ccAssets: [] })
        h.pick = async () => ({ kind: 'picked', files: [file], badType: [], tooLarge: [] })
        await click(part('studio-portrait-more'))
        await click(buttonByText('studioPortraitReplace'))
        await settle()
        expect(live().image).toBe(hash('n'))
        expect(live().ccAssets?.map((row) => row.uri)).toEqual([M])
        expect(steps()).toHaveLength(1)
    })

    test('a cancelled chooser changes nothing', async () => {
        await show({ image: '', ccAssets: [] })
        await click(buttonByText('studioPortraitAdd'))
        await settle()
        expect(steps()).toHaveLength(0)
        expect(h.saved).toEqual([])
        expect(toastTexts()).toEqual([])
    })

    test('Studio closing while the chooser is open writes nothing and posts the not-added notice, with the form already gone', async () => {
        await show({ image: '', ccAssets: [] })
        let choose!: (value: unknown) => void
        h.pick = () => new Promise((resolve) => { choose = resolve })
        await click(buttonByText('studioPortraitAdd'))
        closeStudio()
        choose({ kind: 'picked', files: [file], badType: [], tooLarge: [] })
        await settle()
        await settle()
        expect(steps()).toHaveLength(0)
        expect(h.saved).toEqual([])
        expect(live().image).toBe('')
        expect(toastTexts()).toEqual(['studioImportNotAdded(1)'])
    })
})
