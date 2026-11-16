// @vitest-environment jsdom
/**
 * B1: held composition text reaches its owner at every hide, close and switch, before the next state change.
 * The real Studio screen state, the real `studioOpen` flag, the real page-leave rule and the real field registry
 * run over a real history service on the memory doubles; only the stores module, the save request, the shell switch, the prompt cover and the language table are doubles.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({
    getSaveMarkCount: () => h.marks,
    hasUnsavedSaveMarks: () => false,
    requestSaveNow: () => {},
    requestNetSweep: () => {},
}))

const db = $state({ db: { characters: [] as LiveCharacter[] } })
const selection = $state({ selId: 0 })
const quickSettings = $state({ open: true })

// Getters: the statically imported modules are evaluated before these consts are initialised.
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const settingsOpen = writable(false)
    const charConfigSubMenu = writable(0)
    const settingsMenuIndex = writable(-1)
    const botMakerMode = writable(false)
    const sideBarStore = writable(false)
    return {
        get DBState() { return db },
        get selIdState() { return selection },
        get QuickSettings() { return quickSettings },
        MobileGUI: writable(false),
        settingsOpen,
        CharConfigSubMenu: charConfigSubMenu,
        SettingsMenuIndex: settingsMenuIndex,
        botMakerMode,
        sideBarStore,
        frozenSaveKeysStore: writable([]),
    }
})
vi.mock('src/ts/chatShell/shellSwitch.svelte', () => ({ shellEligible: () => false }))
vi.mock('src/ts/alertPrompts', async (importOriginal) => ({ ...(await importOriginal<typeof import('src/ts/alertPrompts')>()), pageCovered: () => false }))
vi.mock('src/lang', async () => {
    const helpers = await import('src/ts/studio/studioFixtures.test-helpers')
    return { language: helpers.studioLanguageMock() }
})

import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { installSaveOnHide } from 'src/ts/process/saveOnHide'
import { createSaveAck, type SaveAck, type SaveAckDeps } from 'src/ts/studio/edit/saveAck.svelte'
import { settingsOpen } from 'src/ts/stores.svelte'
import { openInClassicEditor } from 'src/ts/studio/classicLinks.svelte'
import { leaveStudio } from 'src/ts/studio/studioBack.svelte'
import { studioOpen } from 'src/ts/studio/studioOpen'
import { setStudioEnabled } from 'src/ts/studio/studioSwitch.svelte'
import { closeStudio, openStudio, resetStudioScreenForTests, selectStudioNode, setStudioLayout, setStudioSelection, showStudioList, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from '../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import StudioCharacterForm from './StudioCharacterForm.svelte'

interface LiveCharacter {
    chaId: string
    type: string
    license?: string
    desc: string
    alternateGreetings: string[]
    chats: { id?: string, note: string, fmIndex?: number }[]
    chatPage: number
}

function makeCharacter(chaId: string): LiveCharacter {
    return {
        chaId,
        type: 'character',
        desc: 'd0',
        alternateGreetings: ['g0', 'g1', 'g2'],
        chats: [{ id: 'c1', note: 'n0', fmIndex: 2 }],
        chatPage: 0,
    }
}

const A = characterOwnerKey('A')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

interface Rig {
    service: OwnerHistoryService
    // The page-leave rule's registered flush of the service.
    leaveFlush: () => void
}

function makeAck(clock: ReturnType<typeof createFakeClock>): SaveAck {
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

function makeRig(): Rig {
    const clock = createFakeClock()
    let leaveFlush: () => void = () => {}
    const service = createOwnerHistoryService({
        store: createMemoryStudioStore({}),
        claim: createClaimDouble(),
        clock,
        pageSession: 'p1',
        registerLeaveFlush: (flush) => {
            leaveFlush = flush
            return () => {}
        },
    })
    setStudioHistoryServiceForTests(service)
    setStudioVisitAckForTests(makeAck(clock))
    return { service, leaveFlush: () => leaveFlush() }
}

let mounted: { app: ReturnType<typeof mount>, host: HTMLElement }[] = []
let stopSaveOnHide: (() => void) | null = null

function mountForm(chaId: string): void {
    const host = document.createElement('div')
    document.body.appendChild(host)
    mounted.push({ app: mount(StudioCharacterForm, { target: host, props: { chaId } }), host })
    flushSync()
}

async function settle(): Promise<void> {
    await drainMicrotasks()
    flushSync()
}

const desc = (): HTMLTextAreaElement => document.querySelector<HTMLTextAreaElement>('[data-part="studio-form-desc"]') as HTMLTextAreaElement
const live = (): LiveCharacter => db.db.characters[0]

function compose(field: HTMLTextAreaElement, value: string): void {
    field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    field.value = value
    field.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertCompositionText' }))
    flushSync()
}

function setVisibility(state: 'hidden' | 'visible'): void {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
}

beforeEach(() => {
    h.marks = 0
    tracker.character.length = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    settingsOpen.set(false)
    db.db.characters = [makeCharacter('A'), makeCharacter('B')]
    selection.selId = 0
    setStudioEnabled(true)
})

afterEach(async () => {
    stopSaveOnHide?.()
    stopSaveOnHide = null
    setVisibility('visible')
    for (const entry of mounted.splice(0)) {
        await unmount(entry.app)
        entry.host.remove()
    }
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
    setStudioEnabled(false)
})

describe('B1-G2 the hide flush writes held text before the page-leave rule asks for a save', () => {
    test.each(['visibilitychange', 'pagehide'])('%s', async (eventName) => {
        const rig = makeRig()
        const order: string[] = []
        const original = rig.service.editField
        vi.spyOn(rig.service, 'editField').mockImplementation((owner, path, value) => {
            order.push('write')
            return original.call(rig.service, owner, path, value)
        })
        const mark = vi.fn()
        stopSaveOnHide = installSaveOnHide({
            doc: document,
            win: window,
            kinds: () => [],
            streams: () => [],
            unsaved: () => h.marks > 0,
            mark,
            saveNow: () => { order.push('saveNow') },
            leaveFlush: rig.leaveFlush,
        })
        expect(openStudio({}, null)).toBe(true)
        mountForm('A')
        await settle()
        compose(desc(), 'd0한')
        if (eventName === 'visibilitychange') {
            setVisibility('hidden')
            document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
        } else {
            window.dispatchEvent(new Event('pagehide'))
        }
        expect(order).toEqual(['write', 'saveNow'])
        expect(mark).not.toHaveBeenCalled()
        expect(desc().value).toBe('d0한')
        expect(live().desc).toBe('d0한')
    })
})

describe('B1-G9 every close writes held text before the next step', () => {
    async function openWithHeldText(): Promise<void> {
        makeRig()
        expect(openStudio({}, null)).toBe(true)
        mountForm('A')
        await settle()
        compose(desc(), 'd0한')
    }

    const closes: [string, () => void][] = [
        ['closeStudio', () => closeStudio()],
        ['leaveStudio', () => leaveStudio()],
        ['a nested close through Settings', () => settingsOpen.set(true)],
        ['the link-out to the classic editor', () => { openInClassicEditor('character', null) }],
    ]

    test.each(closes)('%s', async (_name, close) => {
        await openWithHeldText()
        close()
        expect(live().desc).toBe('d0한')
        expect(h.marks).toBe(1)
        expect(studioScreen.open).toBe(false)
    })

    test('a hostile older subscriber that moves the selection on close cannot make the write refused', async () => {
        // Added before `openStudio`, so it runs before the screen's own subscriber; watchers are not installed yet.
        let first = true
        const stop = studioOpen.subscribe((open) => {
            if (first) {
                first = false
                return
            }
            if (!open) selection.selId = -1
        })
        try {
            await openWithHeldText()
            closeStudio()
            expect(live().desc).toBe('d0한')
            expect(h.marks).toBe(1)
        } finally {
            stop()
        }
    })

    test('the eligibility watcher close, owner still selected, writes the held text', async () => {
        await openWithHeldText()
        setStudioEnabled(false)
        flushSync()
        expect(studioScreen.open).toBe(false)
        expect(live().desc).toBe('d0한')
        expect(h.marks).toBe(1)
    })

    test('B1-G9e the eligibility watcher close after the selection moved writes nothing into either character', async () => {
        await openWithHeldText()
        const before = live().desc
        const marks = h.marks
        selection.selId = 1
        flushSync()
        expect(studioScreen.open).toBe(false)
        expect(db.db.characters[1].desc).toBe('d0')
        expect(live().desc).toBe(before)
        expect(h.marks).toBe(marks)
    })
})

describe('B1-G10 a switch writes held text before any state it changes', () => {
    const FIELDS = ['visitId', 'selectedOwnerKey', 'selectedKind', 'selectedItemId', 'detailShown', 'layout', 'open'] as const
    type Snapshot = Pick<typeof studioScreen, typeof FIELDS[number]>

    const snapshot = (): Snapshot => ({
        visitId: studioScreen.visitId,
        selectedOwnerKey: studioScreen.selectedOwnerKey,
        selectedKind: studioScreen.selectedKind,
        selectedItemId: studioScreen.selectedItemId,
        detailShown: studioScreen.detailShown,
        layout: studioScreen.layout,
        open: studioScreen.open,
    })

    const switches: [string, () => void][] = [
        ['selectStudioNode', () => selectStudioNode('o:other', null, null)],
        ['setStudioSelection', () => setStudioSelection('o:other', null, null)],
        ['showStudioList', () => showStudioList()],
        ['setStudioLayout', () => setStudioLayout('stack')],
        ['openStudio again', () => { openStudio({}, null) }],
    ]

    test.each(switches)('%s', async (_name, change) => {
        const rig = makeRig()
        expect(openStudio({}, null)).toBe(true)
        setStudioSelection('o:first', null, null)
        studioScreen.detailShown = true
        studioScreen.layout = 'wide'
        mountForm('A')
        await settle()
        compose(desc(), 'd0한')
        const before = snapshot()
        const seen: Snapshot[] = []
        const original = rig.service.editField
        vi.spyOn(rig.service, 'editField').mockImplementation((owner, path, value) => {
            seen.push(snapshot())
            return original.call(rig.service, owner, path, value)
        })
        change()
        expect(live().desc).toBe('d0한')
        expect(h.marks).toBe(1)
        expect(seen).toEqual([before])
        expect(rig.service.view(A).done).toHaveLength(1)
    })

    test('setStudioLayout to the layout already shown flushes nothing', async () => {
        const rig = makeRig()
        expect(openStudio({}, null)).toBe(true)
        mountForm('A')
        await settle()
        compose(desc(), 'd0한')
        setStudioLayout(studioScreen.layout)
        expect(live().desc).toBe('d0')
        expect(h.marks).toBe(0)
        expect(rig.service.view(A).done).toHaveLength(0)
    })
})
