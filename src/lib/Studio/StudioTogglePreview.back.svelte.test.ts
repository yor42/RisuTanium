// @vitest-environment jsdom
/**
 * The preview sheet's Back layer and its lifetime flag, on the narrow builder inside the screen's own Back layers.
 * Guards by construction (class G): the layer, the flag and the yields are new, so the evidence is the mutant each
 * row kills. One Back press closes exactly one layer.
 */
import { flushSync, mount, unmount } from 'svelte'
import { get } from 'svelte/store'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({
    getSaveMarkCount: () => h.marks,
    readImage: () => Promise.resolve(undefined),
    getFileSrc: () => Promise.resolve(''),
    aiWatermarkingLawApplies: () => false,
}))

interface LiveCharacter {
    chaId: string
    type: string
    name: string
    customModuleToggle?: string
    chats: { id: string, note: string }[]
    chatPage: number
}

const db = $state({
    db: {
        characters: [] as LiveCharacter[],
        globalChatVariables: undefined as Record<string, string> | undefined,
        botPresets: [] as { name: string }[],
        botPresetsId: 0,
        customPromptTemplateToggle: '',
        modules: [] as unknown[],
    },
})
const selection = $state({ selId: 0 })

vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        get DBState() { return db },
        get selIdState() { return selection },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        frozenSaveKeysStore: writable([]),
        ReloadGUIPointer: writable(0),
        selectedCharID: writable(0),
    }
})
vi.mock('src/ts/storage/database.svelte', () => ({ appVer: '1', getCurrentCharacter: () => undefined, getCurrentChat: () => undefined, getDatabase: () => db.db }))
vi.mock('src/ts/process/modules', () => ({ getModules: () => [], getModuleToggles: () => '', getModuleAssets: () => [] }))
vi.mock('src/ts/alertPrompts', async (importOriginal) => ({ ...(await importOriginal<typeof import('src/ts/alertPrompts')>()), pageCovered: () => false }))
vi.mock('src/lang', async () => {
    const helpers = await import('src/ts/studio/studioFixtures.test-helpers')
    const base = helpers.studioLanguageMock()
    const withArguments = (key: string) => (...args: (string | number)[]) => `${key}(${args.join(',')})`
    const own: Record<string, unknown> = {}
    for (const key of [
        'studioTgDeleted', 'studioTgMoved', 'studioTgOptionN', 'studioTgSummarySelect', 'studioTgSummaryGroup', 'studioTgUnreadableCount', 'studioTgLineN',
        'studioTgCarryAskKey', 'studioTgCarryAskOptions', 'studioTgCarryAskKind', 'studioTgCarryAskDrop', 'studioTgCarryAskUnclear',
        'studioTgCarryAskOptionsLate', 'studioTgCarryAskOptionsLateRenamed', 'studioTgCarryOverwrite', 'studioTgCarryShared', 'studioTgCarryOldStays',
        'studioTgPreviewKeyTip', 'studioTgPreviewGroupCount', 'studioTgPreviewHidden', 'studioTgPreviewSelected',
    ]) own[key] = withArguments(key)
    return { language: new Proxy(base, { get: (target, key) => typeof key === 'string' && key in own ? own[key] : Reflect.get(target, key) }) }
})

import { dispatchBack, resetBackHandlersForTests } from 'src/ts/backHandlers'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { createSaveAck, type SaveAck, type SaveAckDeps } from 'src/ts/studio/edit/saveAck.svelte'
import { installStudioBack } from 'src/ts/studio/studioBack.svelte'
import { studioOpen } from 'src/ts/studio/studioOpen'
import { clearStudioSelection, closeStudio, resetStudioScreenForTests, setStudioLayout, setStudioSelection, showStudioList, studioScreen, studioViaList } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks, type FakeClock } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import { resetToggleCarrySessionForTests } from '../../ts/studio/toggleCarryPending'
import StudioToggleBuilder from './StudioToggleBuilder.svelte'

const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

function makeAck(clock: FakeClock): SaveAck {
    const deps: SaveAckDeps = {
        getMarkCount: () => h.marks,
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
        clock,
    }
    return createSaveAck(deps)
}

function makeRig(): void {
    const clock = createFakeClock()
    setStudioHistoryServiceForTests(createOwnerHistoryService({
        store: createMemoryStudioStore({}),
        claim: createClaimDouble(),
        clock,
        pageSession: 'p1',
        registerLeaveFlush: () => () => {},
    }))
    setStudioVisitAckForTests(makeAck(clock))
}

let mounted: { app: ReturnType<typeof mount>, host: HTMLElement }[] = []

function mountBuilder(): void {
    const host = document.createElement('div')
    document.body.appendChild(host)
    mounted.push({ app: mount(StudioToggleBuilder, { target: host, props: { target: { kind: 'character', chaId: 'A' } } }), host })
    flushSync()
}

async function unmountAll(): Promise<void> {
    for (const entry of mounted.splice(0)) {
        await unmount(entry.app)
        entry.host.remove()
    }
}

async function settle(): Promise<void> {
    await drainMicrotasks()
    flushSync()
}

async function settleFocus(): Promise<void> {
    await settle()
    await settle()
    await settle()
}

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
const rowsOf = () => Array.from(document.querySelectorAll<HTMLElement>('[data-part="studio-toggle-row"]'))

function setText(value: string): void {
    db.db.characters = [{ chaId: 'A', type: 'character', name: 'Alice', customModuleToggle: value, chats: [], chatPage: 0 }]
}

let fakeWidth = 0
class FakeResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element): void { this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver) }
    unobserve(): void {}
    disconnect(): void {}
}

async function openSheet(): Promise<void> {
    part('studio-toggle-preview-eye')?.click()
    flushSync()
    await vi.waitFor(() => expect(part('studio-toggle-preview')).not.toBeNull())
    await settle()
}

function back(): boolean {
    const handled = dispatchBack()
    flushSync()
    return handled
}

// The phone: the detail was reached from the list, under the screen's own Back layers.
let stopLayers: (() => void) | null = null
function phoneVisit(): void {
    studioScreen.layout = 'stack'
    studioScreen.pickedInVisit = true
    studioScreen.detailShown = true
    stopLayers = $effect.root(() => { installStudioBack() })
}

beforeAll(async () => {
    await import('./StudioTogglePreview.svelte')
}, 120_000)

beforeEach(() => {
    fakeWidth = 400
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => fakeWidth })
    h.marks = 0
    tracker.character.length = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    selection.selId = 0
    studioScreen.chaId = 'A'
    studioScreen.visitId = 'v1'
    studioScreen.open = true
})

afterEach(async () => {
    stopLayers?.()
    stopLayers = null
    vi.unstubAllGlobals()
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth
    await unmountAll()
    localStorage.clear()
    resetToggleCarrySessionForTests()
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
    resetBackHandlersForTests()
})

describe('PU-1 the sheet on a phone', () => {
    test('the eye opens a titled dialog that is not modal, Escape closes it and focus goes back to the eye', async () => {
        setText('a=A\n')
        makeRig()
        phoneVisit()
        mountBuilder()
        await settle()
        expect(studioViaList()).toBe(true)
        await openSheet()
        const dialog = part('studio-toggle-preview')!
        expect(dialog.getAttribute('role')).toBe('dialog')
        expect(dialog.hasAttribute('aria-modal')).toBe(false)
        expect(dialog.getAttribute('aria-labelledby')).toBe('studio-tg-preview-title')
        expect(document.getElementById('studio-tg-preview-title')?.textContent).toBe('studioTgPreview')
        expect(part('studio-toggle-preview-eye')!.getAttribute('aria-expanded')).toBe('true')
        dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        flushSync()
        await settleFocus()
        expect(part('studio-toggle-preview')).toBeNull()
        expect(studioScreen.togglePreviewOpen).toBe(false)
        expect(document.activeElement).toBe(part('studio-toggle-preview-eye'))
    })

    test('one Back closes only the sheet, and the next Back goes to the list', async () => {
        setText('a=A\n')
        makeRig()
        phoneVisit()
        mountBuilder()
        await settle()
        expect(studioViaList()).toBe(true)
        await openSheet()
        expect(back()).toBe(true)
        await settle()
        expect(part('studio-toggle-preview')).toBeNull()
        expect(studioScreen.detailShown).toBe(true)
        expect(studioScreen.open).toBe(true)
        expect(back()).toBe(true)
        expect(studioScreen.detailShown).toBe(false)
    })

    test('History opened and closed over the sheet leaves the sheet the next layer, not the list', async () => {
        setText('a=A\n')
        makeRig()
        phoneVisit()
        mountBuilder()
        await settle()
        expect(studioViaList()).toBe(true)
        await openSheet()
        studioScreen.historyOpen = true
        flushSync()
        studioScreen.historyOpen = false
        flushSync()
        expect(back()).toBe(true)
        await settle()
        expect(part('studio-toggle-preview')).toBeNull()
        expect(part('studio-toggle-builder')).not.toBeNull()
        expect(studioScreen.detailShown).toBe(true)
        expect(back()).toBe(true)
        expect(studioScreen.detailShown).toBe(false)
    })

    test('a layer opened after the sheet closes first, then the sheet', async () => {
        setText('a=A\n')
        makeRig()
        phoneVisit()
        mountBuilder()
        await settle()
        expect(studioViaList()).toBe(true)
        await openSheet()
        studioScreen.historyOpen = true
        flushSync()
        expect(back()).toBe(true)
        expect(studioScreen.historyOpen).toBe(false)
        expect(studioScreen.togglePreviewOpen).toBe(true)
        expect(back()).toBe(true)
        await settle()
        expect(studioScreen.togglePreviewOpen).toBe(false)
        expect(studioScreen.detailShown).toBe(true)
    })

    test('with the editor page open under the sheet, History opened and closed and Back: the sheet closes first and the editor page is still shown', async () => {
        setText('a=A\nb=B\n')
        makeRig()
        phoneVisit()
        mountBuilder()
        await settle()
        expect(studioViaList()).toBe(true)
        rowsOf()[0].click()
        flushSync()
        expect(part('studio-toggle-editor')).not.toBeNull()
        await openSheet()
        studioScreen.historyOpen = true
        flushSync()
        studioScreen.historyOpen = false
        flushSync()
        expect(back()).toBe(true)
        await settle()
        expect(part('studio-toggle-preview')).toBeNull()
        expect(part('studio-toggle-editor')).not.toBeNull()
        expect(studioScreen.detailShown).toBe(true)
        // The editor page closes before the phone leaves for the list, whatever order the layers re-registered in.
        expect(back()).toBe(true)
        await settle()
        expect(part('studio-toggle-editor')).toBeNull()
        expect(studioScreen.detailShown).toBe(true)
        expect(back()).toBe(true)
        expect(studioScreen.detailShown).toBe(false)
    })

    test('with the editor page open and no sheet, History opened and closed and Back: the editor page closes first, then the list', async () => {
        setText('a=A\nb=B\n')
        makeRig()
        phoneVisit()
        mountBuilder()
        await settle()
        expect(studioViaList()).toBe(true)
        rowsOf()[0].click()
        flushSync()
        expect(part('studio-toggle-editor')).not.toBeNull()
        studioScreen.historyOpen = true
        flushSync()
        studioScreen.historyOpen = false
        flushSync()
        expect(back()).toBe(true)
        await settle()
        expect(part('studio-toggle-editor')).toBeNull()
        expect(studioScreen.detailShown).toBe(true)
        expect(back()).toBe(true)
        expect(studioScreen.detailShown).toBe(false)
    })

    test('the builder publishes its editor page for the screen: set while the page is open, cleared by a visit end, republished by a new visit, cleared when the builder goes', async () => {
        setText('a=A\nb=B\n')
        makeRig()
        phoneVisit()
        mountBuilder()
        await settle()
        expect(studioScreen.toggleEditorPageOpen).toBe(false)
        rowsOf()[0].click()
        flushSync()
        expect(part('studio-toggle-editor')).not.toBeNull()
        expect(studioScreen.toggleEditorPageOpen).toBe(true)
        closeStudio()
        flushSync()
        expect(studioScreen.toggleEditorPageOpen).toBe(false)
        studioScreen.visitId = 'v2'
        flushSync()
        expect(studioScreen.toggleEditorPageOpen).toBe(true)
        await unmountAll()
        expect(studioScreen.toggleEditorPageOpen).toBe(false)
    })

    test('the editor page is not published on a wide layout, where detail to list never registers', async () => {
        fakeWidth = 1200
        setText('a=A\n')
        makeRig()
        mountBuilder()
        await settle()
        rowsOf()[0].click()
        flushSync()
        expect(part('studio-toggle-editor')).not.toBeNull()
        expect(studioScreen.toggleEditorPageOpen).toBe(false)
    })

    test('on a phone a selection from the preview opens the editor page and leaves focus on the preview row', async () => {
        setText('a=A\nb=B\n')
        makeRig()
        phoneVisit()
        mountBuilder()
        await settle()
        expect(studioViaList()).toBe(true)
        await openSheet()
        expect(part('studio-toggle-editor')).toBeNull()
        const control = document.querySelector<HTMLInputElement>('[data-part="studio-tg-preview-row"][data-key="a"] [role="switch"]')!
        control.focus()
        control.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
        flushSync()
        await settleFocus()
        expect(part('studio-toggle-editor')).not.toBeNull()
        expect(studioScreen.toggleEditorPageOpen).toBe(true)
        expect(document.activeElement).toBe(control)
        expect(part('studio-toggle-preview')).not.toBeNull()
    })

    test('a sheet that fails to load closes the flag again, logs the error and raises no unhandled rejection', async () => {
        const failure = new Error('chunk failed')
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
        vi.doMock('./StudioTogglePreview.svelte', () => { throw failure })
        try {
            setText('a=A\n')
            makeRig()
            phoneVisit()
            mountBuilder()
            await settle()
            part('studio-toggle-preview-eye')?.click()
            flushSync()
            await vi.waitFor(() => expect(logged).toHaveBeenCalled())
            await settle()
            expect(studioScreen.togglePreviewOpen).toBe(false)
            expect(part('studio-toggle-preview')).toBeNull()
            expect(part('studio-toggle-preview-eye')!.getAttribute('aria-expanded')).toBe('false')
            expect(dispatchBack()).toBe(true)
            expect(studioScreen.detailShown).toBe(false)
        } finally {
            vi.doUnmock('./StudioTogglePreview.svelte')
            logged.mockRestore()
        }
    })

    test('a selection that closes the sheet returns no focus to the eye: focus stays on the control that was picked', async () => {
        fakeWidth = 1200
        setText('a=A\n')
        makeRig()
        mountBuilder()
        await settle()
        await openSheet()
        const tree = document.createElement('button')
        document.body.appendChild(tree)
        tree.focus()
        setStudioSelection('module:other', 'toggles', null)
        flushSync()
        expect(studioScreen.togglePreviewOpen).toBe(false)
        await settleFocus()
        expect(document.activeElement).toBe(tree)
        tree.remove()
    })
})

describe('PU-11 the flag follows the visit', () => {
    function raise(): void {
        studioScreen.togglePreviewOpen = true
    }

    test('an owner change and a kind change clear it, a line selection inside the builder keeps it', () => {
        setStudioSelection('character:A', 'toggles', null)
        raise()
        setStudioSelection('character:A', 'toggles', 'A/toggles:0')
        expect(studioScreen.togglePreviewOpen).toBe(true)
        setStudioSelection('character:A', 'regex', null)
        expect(studioScreen.togglePreviewOpen).toBe(false)
        setStudioSelection('character:A', 'toggles', null)
        raise()
        setStudioSelection('module:M', 'toggles', null)
        expect(studioScreen.togglePreviewOpen).toBe(false)
    })

    test('a cleared selection, the phone list and the end of the visit clear it', () => {
        raise()
        clearStudioSelection('gone')
        expect(studioScreen.togglePreviewOpen).toBe(false)
        raise()
        showStudioList()
        expect(studioScreen.togglePreviewOpen).toBe(false)
        raise()
        closeStudio()
        expect(studioScreen.togglePreviewOpen).toBe(false)
    })

    test('a layout change clears it, so a wide owner-less detail does not leave a Back layer that swallows a press', () => {
        const stop = $effect.root(() => { installStudioBack() })
        try {
            studioOpen.set(true)
            studioScreen.layout = 'wide'
            raise()
            flushSync()
            setStudioLayout('stack')
            flushSync()
            expect(studioScreen.togglePreviewOpen).toBe(false)
            // The press reaches the layer below the sheet: it leaves Studio.
            back()
            expect(get(studioOpen)).toBe(false)
        } finally {
            stop()
        }
    })

    test('the host that renders the sheet clears the flag when it is destroyed, with no focus moved', async () => {
        setText('a=A\n')
        makeRig()
        phoneVisit()
        mountBuilder()
        await settle()
        await openSheet()
        const bystander = document.createElement('button')
        document.body.appendChild(bystander)
        bystander.focus()
        await unmountAll()
        flushSync()
        expect(studioScreen.togglePreviewOpen).toBe(false)
        await settleFocus()
        expect(document.activeElement).toBe(bystander)
        bystander.remove()
    })
})
