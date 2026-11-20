// @vitest-environment jsdom
/**
 * The hide-empty checkbox of the Studio tree is named through aria-label equal to its visible text. REAL: StudioTree,
 * the owner source, the owner model and the screen store over a synthetic owner model. MOCKED: the stores, the module
 * lister and the locale, as the sibling StudioTree test does.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
    listerOver, loreEntries, makeCharacter, makeChat, makeInput, makePlugin, makePreset, regexEntries, residentModule, stubModule, studioDbOf, v2Scripts,
} from '../../ts/studio/studioFixtures.test-helpers'

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
vi.mock('../../ts/chatShell/shellSwitch.svelte', () => ({ shellEligible: () => false }))
vi.mock('../../ts/alert', () => ({ alertError: vi.fn() }))
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

import { language } from '../../lang'
import { resetBackHandlersForTests } from '../../ts/backHandlers'
import { openStudio, resetStudioScreenForTests } from '../../ts/studio/studioScreen.svelte'
import { setStudioEnabled } from '../../ts/studio/studioSwitch.svelte'
import { controlName } from '../a11yNames.test-helpers'
import StudioTree from './StudioTree.svelte'

class ResizeObserverStub {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(): void {}
    disconnect(): void {}
}

const ownerTarget = { owner: { type: 'character', id: 'cha-1' }, from: 'chat' } as const

let apps: ReturnType<typeof mount>[] = []
let hosts: HTMLElement[] = []

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    localStorage.clear()
    resetBackHandlersForTests()
    resetStudioScreenForTests()
    db.db = studioDbOf(makeInput({
        character: makeCharacter({
            globalLore: loreEntries(5),
            customscript: regexEntries(3),
            triggerscript: v2Scripts,
            modules: ['res'],
            chats: [makeChat({ id: 'chat-1', name: 'First chat', localLore: loreEntries(2, 'chatlore') })],
        }),
        presets: [makePreset('P0', { regex: regexEntries(1) }), makePreset('P1')],
        activePreset: 0,
        plugins: [makePlugin('legacy', 1)],
        modules: [residentModule('res', { customModuleToggle: '' }), stubModule('stub')],
    }))
    selection.selId = 0
    setStudioEnabled(true)
})

afterEach(async () => {
    for (const app of apps) await unmount(app)
    apps = []
    for (const host of hosts) host.remove()
    hosts = []
    resetStudioScreenForTests()
    resetBackHandlersForTests()
    setStudioEnabled(false)
    localStorage.clear()
    vi.unstubAllGlobals()
})

describe('StudioTree form control names', () => {
    test('the hide-empty checkbox carries aria-label equal to its visible text and no aria-labelledby', () => {
        openStudio(ownerTarget, null)
        const host = document.createElement('div')
        document.body.appendChild(host)
        hosts.push(host)
        apps.push(mount(StudioTree, { target: host }))
        flushSync()
        const box = host.querySelector<HTMLInputElement>('[data-part="studio-hide-empty"]')!
        expect(box.getAttribute('aria-label')).toBe(language.studioHideEmpty)
        expect(box.hasAttribute('aria-labelledby')).toBe(false)
        expect(controlName(box)).toBe(box.closest('label')!.textContent!.trim())
    })
})
