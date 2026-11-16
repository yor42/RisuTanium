// @vitest-environment jsdom
/**
 * What the Studio detail mounts for the display kind of a character: the asset list, in place of the chat note form
 * that every other live owner gets, and without the "nothing here yet" note over the list's own empty state. The
 * history service is a stand-in here; the list has its own suites over the real one.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { makeCharacter, makeChat, makeInput, studioDbOf } from '../../ts/studio/studioFixtures.test-helpers'

const db = $state({ db: {} as ReturnType<typeof studioDbOf> & { useAdditionalAssetsPreview?: boolean } })
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
vi.mock('../../ts/globalApi.svelte', () => ({ getFileSrc: async (path: string, use: string) => `blob:${use}:${path}` }))
vi.mock('../../ts/chatShell/shellSwitch.svelte', () => ({ shellEligible: () => false }))
vi.mock('../../ts/process/moduleRefList', () => ({ moduleListOf: () => [] }))
vi.mock('../../lang', async () => {
    const helpers = await import('../../ts/studio/studioFixtures.test-helpers')
    const base = helpers.studioLanguageMock()
    const call = (key: string) => (...args: (string | number)[]) => `${key}(${args.join(',')})`
    const table: Record<string, unknown> = { sidebarUi: { notAllowed: 'notAllowed', noAssets: 'noAssets' } }
    for (const key of ['studioAssetEmotionsElsewhere', 'studioAssetRowMenu']) table[key] = call(key)
    return { language: new Proxy(table, { get: (target, key) => (typeof key === 'symbol' ? undefined : key in target ? target[key] : base[key]) }) }
})

import type { SaveAck } from '../../ts/studio/edit/saveAck.svelte'
import type { OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { openStudio, resetStudioScreenForTests } from '../../ts/studio/studioScreen.svelte'
import { setStudioEnabled } from '../../ts/studio/studioSwitch.svelte'
import type { AssetSizeJob, StoredSize } from '../../ts/studio/assets/assetSizes'
import { setSessionAssetSizeJobForTests } from './assets/StudioAssetList.svelte'
import StudioDetail from './StudioDetail.svelte'

// No size is ever read: the production size job is not loaded.
const noSizes: AssetSizeJob = { peek: () => undefined, snapshot: () => new Map<string, StoredSize>(), ensure: async () => true }

let app: ReturnType<typeof mount> | undefined
let host: HTMLElement | undefined

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
const displayTarget = { owner: { type: 'character', id: 'cha-1' }, kind: 'display', item: 'cha-1/display:0', from: 'chat' } as const

function setCharacter(overrides: Record<string, unknown> = {}): void {
    db.db = studioDbOf(makeInput({
        character: { ...makeCharacter({ chats: [makeChat({ id: 'chat-1', name: 'First chat' })] }), ...overrides },
    }))
}

function show(): void {
    host = document.createElement('div')
    document.body.appendChild(host)
    app = mount(StudioDetail, { target: host })
    flushSync()
}

const stubAck = { display: 'saved', canRetry: () => false, retry: () => false, noteEdit: () => {}, dispose: () => {} } as unknown as SaveAck

beforeEach(() => {
    localStorage.clear()
    resetStudioScreenForTests()
    settingsOpen.set(false)
    MobileGUI.set(false)
    selection.selId = 0
    setStudioEnabled(true)
    setSessionAssetSizeJobForTests(noSizes)
    setStudioHistoryServiceForTests({
        useOwner: () => {},
        setAck: () => {},
        closeOpenStep: () => {},
        view: (owner: string) => ({
            ownerKey: owner, phase: 'ready', banner: null, restricted: false, editable: true, persisted: true,
            done: [], undone: [], deleted: [], restore: null,
        }),
    } as unknown as OwnerHistoryService)
    setStudioVisitAckForTests(stubAck)
})

afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    host?.remove()
    host = undefined
    setSessionAssetSizeJobForTests(undefined)
    resetStudioHistoryAccessorForTests()
    resetStudioScreenForTests()
    setStudioEnabled(false)
    localStorage.clear()
})

describe('the display kind of a character', () => {
    test('renders the asset list with its rows, and neither the chat note form nor the read-only note', () => {
        setCharacter({ additionalAssets: [['smile', 'assets/smile.png', 'png'], ['theme', 'assets/theme.mp3', 'mp3']] })
        openStudio(displayTarget, null)
        show()
        expect(part('studio-asset-list')).not.toBeNull()
        expect(document.querySelectorAll('[data-part="studio-asset-row"]')).toHaveLength(2)
        expect(part('studio-chat-note-form')).toBeNull()
        expect(part('studio-character-form')).toBeNull()
        expect(part('studio-detail-readonly')).toBeNull()
    })

    test('a character with only emotion images shows the list\'s empty state and the emotions line, not the empty-kind note', () => {
        setCharacter({ emotionImages: [['happy', 'assets/happy.png'], ['sad', 'assets/sad.png']] })
        openStudio(displayTarget, null)
        show()
        expect(part('studio-asset-empty')?.textContent).toBe('noAssets')
        expect(part('studio-asset-emotions')?.textContent).toBe('studioAssetEmotionsElsewhere(2)')
        expect(document.body.textContent).not.toContain('studioEmptyKind')
    })

    test('a character with no assets at all shows the list\'s empty state in place of the empty-kind note', () => {
        setCharacter()
        openStudio(displayTarget, null)
        show()
        expect(part('studio-asset-empty')?.textContent).toBe('noAssets')
        expect(document.body.textContent).not.toContain('studioEmptyKind')
    })

    test('a private character shows no list', () => {
        setCharacter({ license: 'private', additionalAssets: [['smile', 'assets/smile.png', 'png']] })
        openStudio(displayTarget, null)
        show()
        expect(part('studio-asset-list')).toBeNull()
        expect(part('studio-detail-private')).not.toBeNull()
    })

    test('the basic kind still shows the character form and no list', () => {
        setCharacter({ additionalAssets: [['smile', 'assets/smile.png', 'png']] })
        openStudio({ owner: { type: 'character', id: 'cha-1' }, kind: 'basic', item: 'cha-1/basic:0', from: 'chat' }, null)
        show()
        expect(part('studio-character-form')).not.toBeNull()
        expect(part('studio-asset-list')).toBeNull()
    })
})
