// @vitest-environment jsdom

/**
 * `App.svelte` mounts the one task host after the first alert, outside both inert scopes. While a task is shown the page
 * content is inert; a covering legacy alert makes the card step aside and it returns with its state when the alert is
 * gone; the toast stack stays visible and its timers pause under the card; focus returns to the opener when the card
 * closes.
 *
 * MOCKED: every child component of the app, as in `App.toastHost.svelte.test.ts` (AlertComp is a stand-in, so a legacy
 * alert is driven by writing the store). The task slot, the task host and the toast host are real.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const stub = vi.hoisted(() => () => ({ default: () => { } }))
const countingStub = (kind: string) => async () => {
    const { default: Counting } = await import('./App.keepChatCountingStub.svelte')
    return { default: (anchor: Parameters<typeof Counting>[0], props: object) => Counting(anchor, { ...props, kind }) }
}

vi.mock('@lucide/svelte', () => {
    const icon = () => { }
    return { ArrowUpIcon: icon, GlobeIcon: icon, PlusIcon: icon }
})
vi.mock('./lib/SideBars/Sidebar.svelte', () => countingStub('sidebar')())
vi.mock('./lib/ChatScreens/ChatScreen.svelte', () => countingStub('chat')())
vi.mock('./lib/Setting/Settings.svelte', () => countingStub('settings')())
vi.mock('./lib/SettingsShell/SettingsShell.svelte', stub)
vi.mock('./lib/Others/GridCatalog.svelte', () => countingStub('grid')())
vi.mock('./lib/Studio/StudioScreen.svelte', () => countingStub('studio')())
vi.mock('./ts/alert', () => ({ alertError: vi.fn() }))
vi.mock('./lib/Others/AlertComp.svelte', stub)
vi.mock('./lib/UI/Realm/RealmPopUp.svelte', stub)
vi.mock('./lib/Others/WelcomeRisu.svelte', stub)
vi.mock('./lib/Others/BookmarkList.svelte', stub)
vi.mock('./lib/UI/Realm/RealmFrame.svelte', stub)
vi.mock('./lib/Others/SavePopupIcon.svelte', stub)
vi.mock('./lib/Setting/botpreset.svelte', stub)
vi.mock('./lib/Setting/listedPersona.svelte', stub)
vi.mock('./lib/Setting/Pages/CustomGUISettingMenu.svelte', stub)
vi.mock('./lib/Others/HypaV3Modal.svelte', stub)
vi.mock('./lib/Others/HypaV3Progress.svelte', stub)
vi.mock('./lib/UI/PopupList.svelte', stub)
vi.mock('./lib/Others/ProTools/EasyPanel.svelte', stub)
vi.mock('./lib/Others/PopupEditor.svelte', stub)
vi.mock('./lib/Others/LoadoutModal.svelte', stub)
vi.mock('./lib/Others/IrisModal.svelte', stub)
vi.mock('./lib/Others/Legal.svelte', stub)
vi.mock('./lib/Others/CustomSidebarConfig.svelte', stub)

vi.mock('./ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DynamicGUI: writable(false),
        settingsOpen: writable(false),
        selectedCharID: writable(-1),
        SettingsMenuIndex: writable(-1),
        selIdState: { selId: -1 },
        sideBarStore: writable(false),
        ShowRealmFrameStore: writable(false),
        openPresetList: writable(false),
        openPersonaList: writable(false),
        MobileGUI: writable(false),
        ReloadGUIPointer: writable(0),
        ReloadChatPointer: writable({}),
        CustomGUISettingMenuStore: writable(false),
        loadedStore: writable(true),
        alertStore: writable({ type: 'none', msg: '' }),
        LoadingStatusState: { text: '' },
        bookmarkListOpen: writable(false),
        popupStore: { children: null },
        easyPanelStore: { open: false },
        popUpEditorStore: { open: false },
        loadoutModalStore: { open: false },
        irisStore: { open: false },
        customSideBarConfigDialogStore: { open: false },
        hypaV3ModalOpen: writable(false),
        hypaV3ProgressStore: writable({ open: false }),
        DBState: { db: { didFirstSetup: true } },
    }
})
vi.mock('./ts/characterCards', async () => {
    const { writable } = await import('svelte/store')
    return { showRealmInfoStore: writable(null) }
})
vi.mock('./ts/storage/database.svelte', () => ({ getDatabase: () => ({}), setDatabase: () => { } }))
vi.mock('./ts/dropImport', () => ({ importDroppedFile: async () => { } }))
vi.mock('./ts/keepAliveAudio', () => ({ createKeepAliveAudio: () => ({}) }))
vi.mock('./ts/storage/tauriByteTransport', () => ({ isAndroidTransport: () => false }))

import { alertStore, settingsOpen } from './ts/stores.svelte'
import { studioOpen } from './ts/studio/studioOpen'
import { resetBootScreenForTests } from './ts/storage/store2/ui/bootScreen.svelte'
import { resetChatSurfaceForTests } from './lib/ChatScreens/chatSurface.svelte'
import { resetStubCounts } from './App.keepChatCountingStub.svelte'
import { changeLanguage } from './lang'
import { resetTopLevelChangesForTests } from './ts/storage/topLevelChanges'
import { postToast, resetToastHostForTests, toastHost } from './ts/toast/toastHost.svelte'
import { alertTask, resetTaskHostForTests } from './ts/alertTask.svelte'
import type { TaskDef } from './lib/Nexus/pattern/taskProgress'

type Writable<T> = { set(value: T): void }

let mountedApp: Record<string, unknown> | null = null
let target: HTMLElement | null = null
const pageButtons: HTMLElement[] = []

const def: TaskDef = {
    title: 'Import',
    steps: [{ label: 'Read file' }, { label: 'Add items' }],
    onCancel: () => { },
}

beforeEach(() => {
    vi.stubEnv('VITE_RISU_LEGAL_CONFIGURED', 'TRUE')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 5, 15))
    resetStubCounts()
    resetToastHostForTests()
    resetTaskHostForTests()
})

afterEach(async () => {
    if (mountedApp !== null && target !== null) {
        await unmount(mountedApp as never)
        target.remove()
    }
    mountedApp = null
    target = null
    for (const button of pageButtons.splice(0)) button.remove()
    resetTaskHostForTests()
    resetToastHostForTests()
    resetChatSurfaceForTests()
    resetTopLevelChangesForTests()
    changeLanguage('en')
    resetBootScreenForTests()
    ;(settingsOpen as unknown as Writable<boolean>).set(false)
    ;(alertStore as unknown as Writable<{ type: string, msg: string }>).set({ type: 'none', msg: '' })
    studioOpen.set(false)
    vi.useRealTimers()
    vi.unstubAllEnvs()
})

async function showApp() {
    const { default: App } = await import('./App.svelte')
    target = document.createElement('div')
    document.body.appendChild(target)
    mountedApp = mount(App, { target, props: {} }) as unknown as Record<string, unknown>
    flushSync()
    return target
}

/** Svelte sets `inert` as a property; jsdom keeps it as a plain property rather than an attribute. */
function insideInertScope(element: HTMLElement): boolean {
    for (let node: HTMLElement | null = element; node !== null; node = node.parentElement) {
        if ((node as HTMLElement & { inert?: boolean }).inert === true) {
            return true
        }
    }
    return false
}

function setAlert(value: { type: string, msg: string }) {
    ;(alertStore as unknown as Writable<{ type: string, msg: string }>).set(value)
    flushSync()
}

function pageButton(): HTMLElement {
    const button = document.createElement('button')
    document.body.appendChild(button)
    pageButtons.push(button)
    button.focus()
    return button
}

const card = () => document.querySelector<HTMLElement>('[data-part="pattern-task-root"]')
const shell = () => document.querySelector<HTMLElement>('[data-part="pattern-dialog"]')
const okButton = () => document.querySelector<HTMLButtonElement>('[data-part="pattern-task-result-ok"]')

describe('App mounts the task host', () => {
    test('R6 a shown task makes the page inert; a covering alert hides the card and its return restores state and focus', async () => {
        const root = await showApp()
        const handle = alertTask(def)
        flushSync()
        expect(card()).not.toBeNull()
        expect(insideInertScope(root.querySelector<HTMLElement>('[data-stub="sidebar"]')!)).toBe(true)

        handle.setStep(1)
        handle.setCount(1, 2)
        handle.lockCancel()
        flushSync()
        setAlert({ type: 'ask', msg: 'Sure?' })
        expect(card()).toBeNull()
        expect(shell()).toBeNull()
        setAlert({ type: 'none', msg: '' })
        await tick()
        expect(card()).not.toBeNull()
        expect(document.querySelector('[data-part="pattern-task-status"]')!.textContent).toBe('Add items')
        expect(document.activeElement).toBe(document.querySelector('[data-part="pattern-task-title"]'))

        void handle.finish({ headline: 'Imported' })
        flushSync()
        setAlert({ type: 'ask', msg: 'Sure?' })
        expect(card()).toBeNull()
        setAlert({ type: 'none', msg: '' })
        await tick()
        expect(document.activeElement).toBe(document.querySelector('[data-part="pattern-task-result-headline"]'))
    })

    test('R7 the toast stack stays visible, inert and paused under the card, and resumes after it closes', async () => {
        await showApp()
        const handle = alertTask(def)
        flushSync()
        postToast({ kind: 'info', text: 'Saved' })
        flushSync()
        const host = document.querySelector<HTMLElement>('[data-part="toast-host"]')!
        expect(host.hasAttribute('data-suspended')).toBe(false)
        expect(host.style.visibility).not.toBe('hidden')
        expect(insideInertScope(host)).toBe(true)
        expect(toastHost.paused).toBe(true)
        handle.close()
        flushSync()
        expect(insideInertScope(host)).toBe(false)
        expect(toastHost.paused).toBe(false)
    })

    test('R8 focus returns to the opener after OK, after close, and after a replacement opened from inside the card', async () => {
        await showApp()
        const opener = pageButton()
        const first = alertTask(def)
        flushSync()
        void first.finish({ headline: 'Imported' })
        flushSync()
        okButton()!.click()
        flushSync()
        await tick()
        expect(document.activeElement).toBe(opener)

        const second = alertTask(def)
        flushSync()
        expect(document.activeElement).not.toBe(opener)
        second.close()
        flushSync()
        await tick()
        expect(document.activeElement).toBe(opener)

        opener.focus()
        alertTask(def)
        flushSync()
        const replacement = alertTask(def)
        flushSync()
        void replacement.finish({ headline: 'Imported' })
        flushSync()
        okButton()!.click()
        flushSync()
        await tick()
        expect(document.activeElement).toBe(opener)
    })

    test('R8 a task closed while a covering alert has the card yielded gives the opener no focus', async () => {
        await showApp()
        const opener = pageButton()
        const handle = alertTask(def)
        flushSync()
        setAlert({ type: 'ask', msg: 'Sure?' })
        opener.blur()
        handle.close()
        flushSync()
        await tick()
        expect(document.activeElement).not.toBe(opener)
    })
})
