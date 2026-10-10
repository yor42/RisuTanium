/**
 * The idle reload's production binding (`../memory/idleReloadHost`) over the
 * real stores, draft registry, busy registry and restored-bytes counter: when
 * it arms, what keeps it from reloading, and what the reload leaves behind.
 * The save loop (`globalApi.svelte`), Tauri and the browser's reload are
 * stand-ins; a reload here shows the call is made, not that a browser or the
 * native webview comes back.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

const platformState = vi.hoisted(() => ({ isTauri: false }))
const saveState = vi.hoisted(() => ({ clean: true, marks: 0 }))
const outside = vi.hoisted(() => ({ bgmPlaying: false, work: false }))

vi.mock(import('src/ts/observer.svelte'), () => ({
    isBgmPlaying: () => outside.bgmPlaying,
}) as unknown as typeof import('src/ts/observer.svelte'))

vi.mock(import('src/ts/process/chatOrigin'), () => ({
    isWorkInProgress: () => outside.work,
}) as unknown as typeof import('src/ts/process/chatOrigin'))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return platformState.isTauri },
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    isSaveClean: () => saveState.clean,
    getSaveMarkCount: () => saveState.marks,
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: ({ db: {} }),
    selectedCharID: writable(-1),
    loadedStore: writable(false),
    settingsOpen: writable(false),
    alertStore: writable({ type: 'none', msg: '' }),
    OpenRealmStore: writable(false),
    ShowRealmFrameStore: writable(''),
    PlaygroundStore: writable(0),
    CustomGUISettingMenuStore: writable(false),
    bookmarkListOpen: writable(false),
    hypaV3ModalOpen: writable(false),
    hypaV3ProgressStore: writable({ open: false, miniMsg: '', msg: '', subMsg: '' }),
    openPersonaList: writable(false),
    openPresetList: writable(false),
    QuickSettings: ({ open: false, index: 0 }),
    pluginAlertModalStore: ({ open: false, errors: [] }),
    easyPanelStore: ({ open: false }),
    popupStore: ({ children: null, mouseX: 0, mouseY: 0, openId: 0 }),
    popUpEditorStore: ({ open: false, value: '', mode: 'default', language: 'markdown' }),
    loadoutModalStore: ({ open: false }),
    irisStore: ({ open: false }),
    customSideBarConfigDialogStore: ({ open: false }),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppData: 0 },
    exists: vi.fn(async () => false),
    readFile: vi.fn(async () => new Uint8Array()),
    remove: vi.fn(async () => { }),
    writeFile: vi.fn(async () => { }),
    rename: vi.fn(async () => { }),
    readDir: vi.fn(async () => []),
}))

vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn(async () => { }) }))

import { alertStore, DBState, loadedStore, selectedCharID, settingsOpen } from 'src/ts/stores.svelte'
import { isAppInitiatedReload } from 'src/ts/reloadGuard'
import { registerDraft, resetLocalDraftsForTest, unregisterDraft } from 'src/ts/localDrafts'
import { resetComposerDraftsForTests, write } from 'src/ts/process/composerDrafts.svelte'
import { draftContentOrphanGate } from 'src/ts/draftContentOrphanGate'
import { STORAGE_TAB_LOCK_NAME } from 'src/ts/storage/storageTabLocks'
import {
    beginBusy,
    markPluginPanelHidden,
    markPluginPanelShown,
    resetBusyActionsForTest,
    stampPluginActivity,
} from 'src/ts/process/memory/busyActions'
import { noteRestoredBytes, resetRestoredBytesForTest } from 'src/ts/process/memory/restoredBytes'
import { noteBootArchiveSession, resetIdleReloadBootStateForTest } from 'src/ts/process/memory/idleReloadBootState'
import {
    IDLE_RELOAD_DESKTOP_ENABLED,
    idleReloadPlatform,
    startIdleReload,
} from 'src/ts/process/memory/idleReloadHost'
import { baseKeepInline } from 'src/ts/process/memory/keepSet'
import { HOLD_MS, IDLE_MS, MIN_RELOAD_INTERVAL_MS, RESTORED_BYTES_THRESHOLD } from 'src/ts/process/memory/idleGate'
import type { Database } from 'src/ts/storage/database.svelte'

const START = new Date('2026-10-04T10:00:00Z').getTime()
const MB = 1024 * 1024

function installDb(): void {
    DBState.db = {
        formatversion: 6,
        archiveCharacters: true,
        plugins: [],
        characters: [
            { type: 'character', chaId: 'selected', name: 'S', chats: [], chatPage: 0 },
            { type: 'character', chaId: 'other', name: 'O', chats: [], chatPage: 0 },
            { type: 'group', chaId: 'group', name: 'G', characters: ['selected', 'other'], chats: [], chatPage: 0 },
            { type: 'character', chaId: 'far', name: 'F', chats: [], chatPage: 0 },
            { type: 'character', chaId: 'trashed', name: 'T', chats: [], chatPage: 0, trashTime: 1 },
        ],
    } as unknown as Database
}

let reload: ReturnType<typeof vi.fn>
let replaceState: ReturnType<typeof vi.fn>
let listenerTypes: string[]

beforeEach(() => {
    vi.useFakeTimers({ now: START })
    sessionStorage.clear()
    localStorage.clear()
    platformState.isTauri = false
    saveState.clean = true
    saveState.marks = 0
    outside.bgmPlaying = false
    outside.work = false
    resetBusyActionsForTest()
    resetRestoredBytesForTest()
    resetIdleReloadBootStateForTest()
    resetLocalDraftsForTest()
    resetComposerDraftsForTests()
    draftContentOrphanGate.clear()
    installDb()
    selectedCharID.set(0)
    loadedStore.set(true)
    settingsOpen.set(false)
    alertStore.set({ type: 'none', msg: '' })
    noteBootArchiveSession(true)
    reload = vi.fn()
    replaceState = vi.fn()
    vi.spyOn(window.location, 'reload').mockImplementation(reload as unknown as () => void)
    vi.spyOn(window.history, 'replaceState').mockImplementation(replaceState as unknown as History['replaceState'])
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: { query: async () => ({ held: [{ name: STORAGE_TAB_LOCK_NAME }], pending: [] }) },
    })
    listenerTypes = []
    const add = window.addEventListener.bind(window)
    vi.spyOn(window, 'addEventListener').mockImplementation(((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
        listenerTypes.push(type)
        add(type, listener, options)
    }) as typeof window.addEventListener)
})

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

async function advance(ms: number): Promise<void> {
    for (let elapsed = 0; elapsed < ms; elapsed += 1000) {
        await vi.advanceTimersByTimeAsync(1000)
    }
}

/** Starts the idle reload with one other character past the threshold, so it is armed. */
async function armed(): Promise<void> {
    startIdleReload()
    noteRestoredBytes('other', RESTORED_BYTES_THRESHOLD)
    await vi.advanceTimersByTimeAsync(0)
}

const QUIET_MS = IDLE_MS + HOLD_MS + 2000

describe('the platform', () => {
    test('is the web path off the desktop', () => {
        expect(idleReloadPlatform()).toBe('web')
    })

    test('has no desktop path while the desktop switch is off, and nothing arms there', async () => {
        expect(IDLE_RELOAD_DESKTOP_ENABLED).toBe(false)
        platformState.isTauri = true
        expect(idleReloadPlatform()).toBeNull()
        await armed()
        await advance(QUIET_MS)
        expect(listenerTypes).not.toContain('keydown')
        expect(reload).not.toHaveBeenCalled()
    })
})

describe('arming', () => {
    test('installs no listener and no timer for a session that restored nothing', async () => {
        startIdleReload()
        await advance(QUIET_MS)
        expect(listenerTypes).toEqual([])
        expect(vi.getTimerCount()).toBe(0)
    })

    test('stays unarmed below the restored-bytes threshold', async () => {
        startIdleReload()
        noteRestoredBytes('other', RESTORED_BYTES_THRESHOLD - 1)
        expect(listenerTypes).toEqual([])
    })

    test('does not count the bytes of the selected character', async () => {
        startIdleReload()
        noteRestoredBytes('selected', 10 * RESTORED_BYTES_THRESHOLD)
        expect(listenerTypes).toEqual([])
        expect(vi.getTimerCount()).toBe(0)
    })

    test('does not count the members of a selected group', async () => {
        selectedCharID.set(2)
        startIdleReload()
        noteRestoredBytes('other', 10 * RESTORED_BYTES_THRESHOLD)
        expect(baseKeepInline()).toEqual(new Set(['group', 'selected', 'other']))
        expect(listenerTypes).toEqual([])
    })

    test('does not count the bytes of a trashed character, which the pass never archives', async () => {
        startIdleReload()
        noteRestoredBytes('trashed', 10 * RESTORED_BYTES_THRESHOLD)
        expect(listenerTypes).toEqual([])
    })

    test('arms when the character that was left behind is the one that holds the bytes', async () => {
        startIdleReload()
        noteRestoredBytes('selected', RESTORED_BYTES_THRESHOLD)
        expect(listenerTypes).toEqual([])
        selectedCharID.set(1)
        expect(listenerTypes).toContain('keydown')
    })

    test('arms once the threshold is crossed and listens for the user\'s activity', async () => {
        await armed()
        for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'compositionstart', 'input', 'beforeinput', 'paste', 'drop', 'dragover', 'focus', 'blur', 'change']) {
            expect(listenerTypes).toContain(type)
        }
    })

    test('is never armed on a boot whose archive session could not archive', async () => {
        noteBootArchiveSession(false)
        await armed()
        expect(listenerTypes).toEqual([])
    })
})

describe('the reload', () => {
    test('happens once after the idle time and the hold, strips the address and leaves the record and the history', async () => {
        await armed()
        await advance(IDLE_MS)
        expect(reload).not.toHaveBeenCalled()
        await advance(HOLD_MS + 2000)
        expect(reload).toHaveBeenCalledTimes(1)
        expect(replaceState).toHaveBeenCalledWith(null, '', location.pathname)
        expect(isAppInitiatedReload()).toBe(true)
        expect(JSON.parse(sessionStorage.getItem('risu-idle-handoff:selection') ?? '{}')).toMatchObject({ chaId: 'selected', keepInline: ['selected'] })
        expect(sessionStorage.getItem('risu-idle-handoff:drafts')).not.toBeNull()
        expect(JSON.parse(sessionStorage.getItem('risu-idle-reload-history') ?? '{}').lastAt).toBeGreaterThan(START)
    })

    test('does not repeat inside the interval when the page is still there', async () => {
        await armed()
        await advance(QUIET_MS)
        expect(reload).toHaveBeenCalledTimes(1)
        await advance(MIN_RELOAD_INTERVAL_MS - 60_000)
        expect(reload).toHaveBeenCalledTimes(1)
    })

    test('does not happen inside the interval of an earlier reload recorded for this tab', async () => {
        sessionStorage.setItem('risu-idle-reload-history', JSON.stringify({ lastAt: START }))
        await armed()
        await advance(MIN_RELOAD_INTERVAL_MS - 5_000)
        expect(reload).not.toHaveBeenCalled()
        await advance(IDLE_MS)
        expect(reload).toHaveBeenCalledTimes(1)
    })

    test('does not happen when the history cannot be read', async () => {
        sessionStorage.setItem('risu-idle-reload-history', 'garbage')
        await armed()
        await advance(QUIET_MS)
        expect(reload).not.toHaveBeenCalled()
    })

    test('keeps a selected group and its members inline in the record', async () => {
        selectedCharID.set(2)
        startIdleReload()
        noteRestoredBytes('far', RESTORED_BYTES_THRESHOLD)
        await advance(QUIET_MS)
        expect(reload).toHaveBeenCalledTimes(1)
        expect(JSON.parse(sessionStorage.getItem('risu-idle-handoff:selection') ?? '{}')).toMatchObject({
            chaId: 'group',
            keepInline: ['group', 'selected', 'other'],
        })
    })

    test('carries an off-screen composer draft in the record', async () => {
        await armed()
        write({ chaId: 'elsewhere', chatId: 'chat' }, (record) => { record.messageInput = 'typed in another chat' })
        await advance(QUIET_MS)
        expect(reload).toHaveBeenCalledTimes(1)
        const drafts = JSON.parse(sessionStorage.getItem('risu-idle-handoff:drafts') ?? '{}')
        expect(drafts.composer).toEqual([{ key: 'elsewhere::chat', messageInput: 'typed in another chat', messageInputTranslate: '', fileInput: [] }])
    })
})

describe('what keeps it from reloading', () => {
    test('text in the composer on screen, until it is gone', async () => {
        await armed()
        registerDraft('composer-on-screen', 'composer')
        await advance(QUIET_MS)
        expect(reload).not.toHaveBeenCalled()
        unregisterDraft('composer-on-screen')
        await advance(HOLD_MS + 2000)
        expect(reload).toHaveBeenCalledTimes(1)
    })

    test('an open message editor', async () => {
        await armed()
        registerDraft('open-editor')
        await advance(QUIET_MS)
        expect(reload).not.toHaveBeenCalled()
    })

    test('a draft of the orphan kind alone does not', async () => {
        await armed()
        registerDraft('closed-editor-leftover', 'other')
        await advance(QUIET_MS)
        expect(reload).toHaveBeenCalledTimes(1)
    })

    test('an unfinished action, until it ends', async () => {
        await armed()
        const busy = beginBusy('import')
        await advance(QUIET_MS)
        expect(reload).not.toHaveBeenCalled()
        busy.end()
        await advance(HOLD_MS + 2000)
        expect(reload).toHaveBeenCalledTimes(1)
    })

    test('an unsaved change', async () => {
        await armed()
        saveState.clean = false
        await advance(QUIET_MS)
        expect(reload).not.toHaveBeenCalled()
    })

    test('a save requested and finished between two looks restarts the hold', async () => {
        await armed()
        await advance(IDLE_MS + HOLD_MS - 2000)
        saveState.marks += 1
        await advance(HOLD_MS - 2000)
        expect(reload).not.toHaveBeenCalled()
        await advance(HOLD_MS + 2000)
        expect(reload).toHaveBeenCalledTimes(1)
    })

    test('an open plugin panel, until it is hidden', async () => {
        await armed()
        const panel = document.createElement('iframe')
        document.body.appendChild(panel)
        markPluginPanelShown(panel)
        await advance(QUIET_MS)
        expect(reload).not.toHaveBeenCalled()
        markPluginPanelHidden(panel)
        await advance(HOLD_MS + 2000)
        expect(reload).toHaveBeenCalledTimes(1)
        panel.remove()
    })

    test('a plugin that calls into the host counts as the user being active', async () => {
        await armed()
        await advance(IDLE_MS - 3000)
        stampPluginActivity()
        await advance(IDLE_MS - 3000)
        expect(reload).not.toHaveBeenCalled()
        await advance(HOLD_MS + 6000)
        expect(reload).toHaveBeenCalledTimes(1)
    })

    test('an input event, which starts the idle time over', async () => {
        await armed()
        await advance(IDLE_MS - 3000)
        window.dispatchEvent(new Event('keydown'))
        await advance(IDLE_MS - 3000)
        expect(reload).not.toHaveBeenCalled()
        await advance(HOLD_MS + 6000)
        expect(reload).toHaveBeenCalledTimes(1)
    })

    test('an open settings window and an alert', async () => {
        await armed()
        settingsOpen.set(true)
        await advance(QUIET_MS)
        expect(reload).not.toHaveBeenCalled()
        settingsOpen.set(false)
        alertStore.set({ type: 'normal', msg: 'hello' })
        await advance(QUIET_MS)
        expect(reload).not.toHaveBeenCalled()
    })

    test('a window that is not focused', async () => {
        await armed()
        vi.spyOn(document, 'hasFocus').mockReturnValue(false)
        await advance(QUIET_MS)
        expect(reload).not.toHaveBeenCalled()
    })

    test('a page that is not visible, until it is', async () => {
        await armed()
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
        try {
            await advance(QUIET_MS)
            expect(reload).not.toHaveBeenCalled()
        } finally {
            Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
        }
        await advance(IDLE_MS + HOLD_MS + 2000)
        expect(reload).toHaveBeenCalledTimes(1)
    })

    test('the chat background music, which is not an element of the page, until it stops', async () => {
        await armed()
        outside.bgmPlaying = true
        await advance(QUIET_MS)
        expect(reload).not.toHaveBeenCalled()
        outside.bgmPlaying = false
        await advance(HOLD_MS + 2000)
        expect(reload).toHaveBeenCalledTimes(1)
    })

    test('work in progress, until it ends', async () => {
        await armed()
        outside.work = true
        await advance(QUIET_MS)
        expect(reload).not.toHaveBeenCalled()
        outside.work = false
        await advance(HOLD_MS + 2000)
        expect(reload).toHaveBeenCalledTimes(1)
    })

    test('selecting the character that holds the restored bytes, after arming, leaves nothing to release', async () => {
        await armed()
        selectedCharID.set(1)
        await advance(QUIET_MS)
        expect(reload).not.toHaveBeenCalled()
    })

    test('a media element that is playing', async () => {
        await armed()
        const video = document.createElement('video')
        Object.defineProperty(video, 'paused', { value: false })
        document.body.appendChild(video)
        await advance(QUIET_MS)
        expect(reload).not.toHaveBeenCalled()
        video.remove()
    })

    test('another open tab', async () => {
        Object.defineProperty(navigator, 'locks', {
            configurable: true,
            value: { query: async () => ({ held: [{ name: STORAGE_TAB_LOCK_NAME }, { name: STORAGE_TAB_LOCK_NAME }], pending: [] }) },
        })
        await armed()
        await advance(QUIET_MS)
        expect(reload).not.toHaveBeenCalled()
    })

    test('a tab count that cannot be read', async () => {
        Object.defineProperty(navigator, 'locks', { configurable: true, value: { query: async () => { throw new Error('no') } } })
        await armed()
        await advance(QUIET_MS)
        expect(reload).not.toHaveBeenCalled()
    })

    test('archiving turned off, and an unsettled strike count', async () => {
        await armed()
        ;(DBState.db as unknown as { archiveCharacters: boolean }).archiveCharacters = false
        await advance(QUIET_MS)
        expect(reload).not.toHaveBeenCalled()
        ;(DBState.db as unknown as { archiveCharacters: boolean }).archiveCharacters = true
        localStorage.setItem('archivePassStrikes', '1')
        await advance(QUIET_MS)
        expect(reload).not.toHaveBeenCalled()
    })
})
