// @vitest-environment jsdom
/**
 * 3l. A whole Studio visit writes nothing: open, expand every row, open every item, search, link out on each route
 * (shell and classic, and the Settings pages), close. The database is a `$state` object whose own keys, with their
 * values, are walked before and after; the write paths of the database, the save marks, the live writers and the
 * module load path are doubles that must never be called. The fixture holds the optional fields a defaulting
 * reader would create (a chat without `localLore`, a character without `customscript` or `triggerscript`) and
 * module stubs shaped like the encoder's.
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
    listerOver,
    loreBody,
    makeCharacter,
    makeChat,
    makeInput,
    makePlugin,
    makePreset,
    regexBody,
    residentModule,
    stubModule,
    studioDbOf,
    v2Scripts,
} from '../../ts/studio/studioFixtures.test-helpers'

// Any call into a write path of the database, the save marks, the live writers or the module load path is a failure.
const writes = vi.hoisted(() => ({
    setDatabase: vi.fn(),
    markCharacterForSave: vi.fn(),
    writeLiveCharacter: vi.fn(),
    writeLiveChat: vi.fn(),
    acquireModule: vi.fn(),
    useModuleRow: vi.fn(),
    useModuleById: vi.fn(),
    realmModuleJson: vi.fn(),
}))
const route = vi.hoisted(() => ({ shell: false }))

vi.mock('../../ts/storage/database.svelte', () => ({ setDatabase: writes.setDatabase }))
vi.mock('../../ts/storage/characterSaveMarks', () => ({ markCharacterForSave: writes.markCharacterForSave }))
vi.mock('../../ts/liveCharacterWrite', () => ({ writeLiveCharacter: writes.writeLiveCharacter, writeLiveChat: writes.writeLiveChat }))
vi.mock('../../ts/storage/store2/moduleAcquire', () => ({ acquireModule: writes.acquireModule }))
// The live forms build the history service on first use, which reads the save loop's counters. Nothing here saves.
vi.mock('../../ts/globalApi.svelte', () => ({
    getSaveMarkCount: () => 0,
    getCommittedSaveMarkCount: () => 0,
    afterNextSaveCommit: () => {},
    requestSaveNow: vi.fn(),
    requestNetSweep: vi.fn(),
    hasUnsavedSaveMarks: () => false,
    getPeerSaveCount: () => 0,
    onSavingStopped: () => () => {},
    isSavingStopped: () => false,
    isCharacterUnsavable: () => false,
    saving: { state: false },
}))
vi.mock('../../ts/process/moduleUse', () => ({
    useModuleRow: writes.useModuleRow,
    useModuleById: writes.useModuleById,
    realmModuleJson: writes.realmModuleJson,
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
}))
vi.mock('../../ts/chatShell/shellSwitch.svelte', () => ({ shellEligible: () => route.shell }))
vi.mock('../../ts/process/moduleRefList', () => ({
    moduleListOf: (ids: string[]) => listerOver(db.db.modules)(ids),
}))
vi.mock('../../ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('../../ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('../../lang', async () => {
    const helpers = await import('../../ts/studio/studioFixtures.test-helpers')
    return { language: helpers.studioLanguageMock() }
})

import { resetBackHandlersForTests } from '../../ts/backHandlers'
import { classicLinks } from '../../ts/studio/classicLinks.svelte'
import { resetStudioHistoryAccessorForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { openStudio, resetStudioScreenForTests, selectStudioNode, setStudioRestoreSheetOpen } from '../../ts/studio/studioScreen.svelte'
import { setStudioEnabled } from '../../ts/studio/studioSwitch.svelte'
import { studioOpen } from '../../ts/studio/studioOpen'
import StudioScreen from './StudioScreen.svelte'

class ResizeObserverStub {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(): void {
        this.callback([{ contentRect: { width: 1200 } } as ResizeObserverEntry], this as unknown as ResizeObserver)
    }
    disconnect(): void {}
}

let app: ReturnType<typeof mount> | undefined
let host: HTMLElement | undefined

/** Every own key of every object reachable from `value`, with the primitive values, keyed by path. */
function walkOwnKeys(value: object, path: string, out: Map<string, string>, seen: WeakSet<object>): void {
    seen.add(value)
    const keys = Reflect.ownKeys(value)
    out.set(`${path}#keys`, keys.map(String).join('|'))
    for (const key of keys) {
        const child = (value as Record<PropertyKey, unknown>)[key]
        const childPath = `${path}.${String(key)}`
        if (typeof child === 'object' && child !== null) {
            if (seen.has(child)) out.set(childPath, 'seen')
            else walkOwnKeys(child, childPath, out, seen)
        } else {
            out.set(childPath, `${typeof child}:${String(child)}`)
        }
    }
}

function snapshotOf(value: object): Map<string, string> {
    const out = new Map<string, string>()
    walkOwnKeys(value, 'db', out, new WeakSet())
    return out
}

function buildFixture(): ReturnType<typeof studioDbOf> {
    const bare = makeChat({ id: 'chat-1', name: 'First chat' })
    delete bare.localLore
    const character = makeCharacter({
        globalLore: [loreBody('Castle', 'the king lives here'), { comment: 'Folder', key: 'folder', mode: 'folder' }, loreBody('Forest', 'tall trees')],
        triggerscript: v2Scripts,
        modules: ['res', 'stub'],
        customModuleToggle: 'combat=Combat',
        backgroundHTML: '<div></div>',
        chats: [bare, makeChat({ id: 'chat-2', name: 'Second chat', localLore: [loreBody('Chat note', 'chat secret')] })],
    })
    delete character.customscript
    const input = makeInput({
        character,
        modules: [
            residentModule('res', {
                lorebook: [{ key: 'k', secondkey: '', insertorder: 1, comment: 'Module lore', content: 'module body', mode: 'normal', alwaysActive: false, selective: false }],
                regex: [{ comment: 'Module regex', in: 'a', out: 'b', type: 'editinput' }],
            }),
            stubModule('stub'),
            stubModule('stub-other'),
            residentModule('spare'),
        ],
        enabledModules: ['res'],
        presets: [makePreset('Main', { regex: [regexBody('Main regex', 'x', 'y')], toggles: 't=T' }), makePreset('Spare')],
        activePreset: 0,
        plugins: [makePlugin('legacy', 1), makePlugin('current', 3)],
    })
    return studioDbOf(input)
}

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
const rowsWhere = (selector: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-part="studio-row"]${selector}`))

function show(): void {
    host = document.createElement('div')
    document.body.appendChild(host)
    app = mount(StudioScreen, { target: host })
    flushSync()
}

function expandEveryRow(): void {
    // Opening a row can reveal more closed rows; a bounded loop reaches the fixed point.
    for (let round = 0; round < 12; round++) {
        const closed = rowsWhere('[aria-expanded="false"]')
        if (closed.length === 0) return
        for (const row of closed) {
            row.click()
            flushSync()
        }
    }
}

function openEveryLeaf(): number {
    let opened = 0
    for (const row of rowsWhere(':not([aria-expanded])')) {
        row.click()
        flushSync()
        opened += 1
    }
    return opened
}

async function settled(check: () => void): Promise<void> {
    await vi.waitFor(() => {
        flushSync()
        check()
    })
}

const ownerTarget = { owner: { type: 'character', id: 'cha-1' }, from: 'chat' } as const

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    for (const spy of Object.values(writes)) spy.mockClear()
    route.shell = false
    localStorage.clear()
    resetBackHandlersForTests()
    resetStudioScreenForTests()
    settingsOpen.set(false)
    MobileGUI.set(false)
    botMakerMode.set(false)
    sideBarStore.set(false)
    SettingsMenuIndex.set(-1)
    classicLinks.request = null
    selection.selId = 0
    db.db = buildFixture()
    setStudioEnabled(true)
})

afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    host?.remove()
    host = undefined
    resetStudioHistoryAccessorForTests()
    resetStudioScreenForTests()
    resetBackHandlersForTests()
    setStudioEnabled(false)
    localStorage.clear()
    vi.unstubAllGlobals()
})

describe('3l a whole visit writes nothing', () => {
    test('open, expand all, open items, search, link out on each route, close', async () => {
        const before = snapshotOf(db.db)
        // The fixture really holds what a defaulting reader would fill in.
        expect(before.get('db.characters.0.chats.0.localLore')).toBeUndefined()
        expect(before.get('db.characters.0.customscript')).toBeUndefined()

        openStudio(ownerTarget, null)
        show()
        expandEveryRow()
        expect(rowsWhere('[aria-expanded="false"]')).toHaveLength(0)
        // The visit really reached items of every owner kind that has rows.
        expect(rowsWhere('[data-row-kind="item"]').length).toBeGreaterThan(0)
        expect(openEveryLeaf()).toBeGreaterThan(10)

        // Search: a name query, a text query and a chip.
        part('studio-search-toggle')?.click()
        flushSync()
        const field = part('studio-search-input') as HTMLInputElement
        for (const query of ['castle', 'king', 'module', 'spare']) {
            field.value = query
            field.dispatchEvent(new Event('input', { bubbles: true }))
            flushSync()
            await settled(() => expect(part('studio-search-running')).toBeNull())
        }
        // With no words the chip lists every item of its kind.
        field.value = ''
        field.dispatchEvent(new Event('input', { bubbles: true }))
        document.querySelector<HTMLElement>('[data-part="studio-search-chip"][data-chip="lore"]')?.click()
        flushSync()
        await settled(() => expect(part('studio-search-running')).toBeNull())
        const firstResult = document.querySelector<HTMLElement>('[data-part="studio-search-result"]')
        expect(firstResult).not.toBeNull()
        firstResult?.click()
        flushSync()

        // Link out on the classic route (the classic layouts).
        part('studio-detail-classic')?.click()
        flushSync()
        expect(get(studioOpen)).toBe(false)
        expect(get(botMakerMode)).toBe(true)
        expect(classicLinks.request).toBeNull()

        // Link out on the shell route.
        route.shell = true
        botMakerMode.set(false)
        openStudio(ownerTarget, null)
        flushSync()
        part('studio-detail-classic')?.click()
        flushSync()
        expect(get(studioOpen)).toBe(false)
        expect(classicLinks.request).toEqual({ view: 'characterSettings' })
        expect(get(botMakerMode)).toBe(false)

        // Link out to a Settings page from a module item (both routes land on the same page).
        for (const shell of [false, true]) {
            route.shell = shell
            settingsOpen.set(false)
            openStudio({ owner: { type: 'module', id: 'res' }, kind: 'lore', item: 'res/lore:0', from: 'chat' }, null)
            flushSync()
            expect(get(studioOpen)).toBe(true)
            part('studio-detail-classic')?.click()
            flushSync()
            expect(get(settingsOpen)).toBe(true)
            expect(get(SettingsMenuIndex)).toBe(14)
        }

        // Close what is left open.
        settingsOpen.set(false)
        openStudio(ownerTarget, null)
        flushSync()
        part('studio-back')?.click()
        flushSync()
        expect(get(studioOpen)).toBe(false)

        await unmount(app as ReturnType<typeof mount>)
        app = undefined

        expect(snapshotOf(db.db)).toEqual(before)
        expect(writes.setDatabase).not.toHaveBeenCalled()
        expect(writes.markCharacterForSave).not.toHaveBeenCalled()
        expect(writes.writeLiveCharacter).not.toHaveBeenCalled()
        expect(writes.writeLiveChat).not.toHaveBeenCalled()
        expect(writes.acquireModule).not.toHaveBeenCalled()
        expect(writes.useModuleRow).not.toHaveBeenCalled()
        expect(writes.useModuleById).not.toHaveBeenCalled()
    })

    test('T-UI1: the live forms, fully loaded, write nothing while their fields are only focused and left', async () => {
        const before = snapshotOf(db.db)
        openStudio(ownerTarget, null)
        show()

        // The basic info of the character: description, hide-icon and every first message.
        selectStudioNode('character:cha-1', 'basic', null)
        flushSync()
        await vi.waitFor(() => expect(part('studio-character-form')?.getAttribute('data-phase')).toBe('memoryOnly'), { timeout: 20000 })
        const characterFields = Array.from(document.querySelectorAll<HTMLElement>('[data-part="studio-character-form"] textarea, [data-part="studio-character-form"] input'))
        expect(characterFields.length).toBeGreaterThanOrEqual(2)
        for (const field of characterFields) {
            field.focus()
            field.blur()
            flushSync()
        }

        // The note of this chat.
        selectStudioNode('chat:chat-1', null, null)
        flushSync()
        await vi.waitFor(() => expect(part('studio-chat-note-form')?.getAttribute('data-phase')).toBe('memoryOnly'), { timeout: 20000 })
        const note = part('studio-form-note') as HTMLTextAreaElement
        note.focus()
        note.blur()
        flushSync()

        expect(snapshotOf(db.db)).toEqual(before)
        expect(writes.setDatabase).not.toHaveBeenCalled()
        expect(writes.markCharacterForSave).not.toHaveBeenCalled()
        expect(writes.writeLiveCharacter).not.toHaveBeenCalled()
        expect(writes.writeLiveChat).not.toHaveBeenCalled()
    })

    test('T-UI1: the History panel and the restore sheet write nothing when opened, read and left', async () => {
        const before = snapshotOf(db.db)
        openStudio(ownerTarget, null)
        show()
        selectStudioNode('character:cha-1', 'basic', null)
        flushSync()
        await vi.waitFor(() => expect(part('studio-character-form')?.getAttribute('data-phase')).toBe('memoryOnly'), { timeout: 20000 })

        part('studio-history-toggle')?.click()
        flushSync()
        await vi.waitFor(() => expect(part('studio-history-banner')).not.toBeNull(), { timeout: 20000 })
        expect(part('studio-history-device-note')).not.toBeNull()
        // Nothing to undo, redo or restore yet: pressing the keys writes nothing either.
        for (const init of [{ key: 'z', ctrlKey: true }, { key: 'z', ctrlKey: true, shiftKey: true }, { key: 'y', ctrlKey: true }]) {
            part('studio')?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
            flushSync()
        }

        // The sheet itself, opened over the panel and cancelled.
        setStudioRestoreSheetOpen(true)
        flushSync()
        expect(part('studio-restore-sheet')).not.toBeNull()
        part('studio-restore-cancel')?.click()
        flushSync()
        expect(part('studio-restore-sheet')).toBeNull()
        part('studio-history-close')?.click()
        flushSync()
        expect(part('studio-history')).toBeNull()

        expect(snapshotOf(db.db)).toEqual(before)
        expect(writes.setDatabase).not.toHaveBeenCalled()
        expect(writes.markCharacterForSave).not.toHaveBeenCalled()
        expect(writes.writeLiveCharacter).not.toHaveBeenCalled()
        expect(writes.writeLiveChat).not.toHaveBeenCalled()
    })

    test('the walk sees a key that a reader adds', () => {
        const before = snapshotOf(db.db)
        const chat = db.db.characters[0].chats?.[0]
        expect(chat).toBeDefined()
        if (chat) Object.assign(chat, { localLore: [] })
        expect(snapshotOf(db.db)).not.toEqual(before)
    })
})
