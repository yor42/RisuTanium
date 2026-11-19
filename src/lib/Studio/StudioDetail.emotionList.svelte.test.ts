// @vitest-environment jsdom
/**
 * What the Studio detail mounts for the display kind of a character besides the asset list: the emotion-image list,
 * after it, over the character's own emotion rows and nothing of the additional assets. The history service is real, on
 * the memory doubles, so a delete through the mounted list is a real step.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { makeCharacter, makeChat, makeInput, studioDbOf } from '../../ts/studio/studioFixtures.test-helpers'

const h = vi.hoisted(() => ({ marks: 0, cleared: [] as string[] }))
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
    frozenSaveKeysStore: writable([]),
    clearCharEmotionCache: (chaId: string) => { h.cleared.push(chaId) },
}))
vi.mock('../../ts/globalApi.svelte', () => ({
    getSaveMarkCount: () => h.marks,
    getFileSrc: async (path: string, use: string) => `blob:${use}:${path}`,
}))
vi.mock('../../ts/chatShell/shellSwitch.svelte', () => ({ shellEligible: () => false }))
vi.mock('../../ts/process/moduleRefList', () => ({ moduleListOf: () => [] }))
vi.mock('../../lang', async () => {
    const helpers = await import('../../ts/studio/studioFixtures.test-helpers')
    const base = helpers.studioLanguageMock()
    const call = (key: string) => (...args: (string | number)[]) => `${key}(${args.join(',')})`
    const table: Record<string, unknown> = { sidebarUi: { notAllowed: 'notAllowed', noAssets: 'noAssets' } }
    for (const key of ['studioAssetEmotionsElsewhere', 'studioAssetRowMenu', 'studioAssetSelectedCount', 'studioAssetFilterEmpty', 'studioAssetDeletedOne', 'studioEmotionFilterEmpty']) table[key] = call(key)
    return { language: new Proxy(table, { get: (target, key) => (typeof key === 'symbol' ? undefined : key in target ? target[key] : base[key]) }) }
})

import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from '../../ts/storage/characterSaveMarks'
import type { toSaveType } from '../../ts/storage/risuSave'
import type { SaveAck } from '../../ts/studio/edit/saveAck.svelte'
import { resetStudioToastsForTests, retireAssetToasts } from '../../ts/studio/edit/studioToasts'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from '../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import { openStudio, resetStudioScreenForTests } from '../../ts/studio/studioScreen.svelte'
import { setStudioEnabled } from '../../ts/studio/studioSwitch.svelte'
import { resetToastHostForTests } from '../../ts/toast/toastHost.svelte'
import { setSessionAssetSizeJobForTests } from './assets/StudioAssetList.svelte'
import type { AssetSizeJob, StoredSize } from '../../ts/studio/assets/assetSizes'
import StudioDetail from './StudioDetail.svelte'

// No size is ever read: the production size job is not loaded.
const noSizes: AssetSizeJob = { peek: () => undefined, snapshot: () => new Map<string, StoredSize>(), ensure: async () => true }

const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
const OWNER = characterOwnerKey('cha-1')
const pA = 'assets/' + 'a'.repeat(64) + '.png'
const pB = 'assets/' + 'b'.repeat(64) + '.png'
const pC = 'assets/' + 'c'.repeat(64) + '.png'
const displayTarget = { owner: { type: 'character', id: 'cha-1' }, kind: 'display', item: 'cha-1/display:0', from: 'chat' } as const

let app: ReturnType<typeof mount> | undefined
let host: HTMLElement | undefined
let service: OwnerHistoryService

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
const rowNamesIn = (listPart: string): string[] => Array.from(document.querySelectorAll<HTMLInputElement>(`[data-part="${listPart}"] [data-part="studio-asset-name"]`)).map((field) => field.value)
const emotionsOf = (): string[][] => JSON.parse(JSON.stringify(db.db.characters[0].emotionImages))

async function settle(): Promise<void> {
    await drainMicrotasks()
    flushSync()
    await drainMicrotasks()
}

async function show(overrides: Record<string, unknown>): Promise<void> {
    db.db = studioDbOf(makeInput({
        character: { ...makeCharacter({ chats: [makeChat({ id: 'chat-1', name: 'First chat' })] }), ...overrides },
    }))
    openStudio(displayTarget, null)
    service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock: createFakeClock(),
        pageSession: 'p1',
        registerLeaveFlush: () => () => {},
        onLanded: retireAssetToasts,
    })
    setStudioHistoryServiceForTests(service)
    await service.whenReady(OWNER)
    host = document.createElement('div')
    document.body.appendChild(host)
    app = mount(StudioDetail, { target: host })
    flushSync()
    await settle()
}

const stubAck = { display: 'saved', canRetry: () => false, retry: () => false, noteEdit: () => {}, dispose: () => {} } as unknown as SaveAck

beforeEach(() => {
    localStorage.clear()
    h.marks = 0
    h.cleared.length = 0
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

describe('the display kind of a character with emotion images', () => {
    const emotions = [['happy', pA], ['sad', pB], ['hat', pC]]

    test('R2: the emotion list follows the asset list and shows the emotion rows', async () => {
        await show({ emotionImages: emotions, additionalAssets: [['smile', 'assets/smile.png', 'png']] })
        const assets = part('studio-asset-list') as HTMLElement
        const emotionList = part('studio-emotion-list') as HTMLElement
        expect(assets).not.toBeNull()
        expect(emotionList).not.toBeNull()
        expect(assets.compareDocumentPosition(emotionList) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        expect(rowNamesIn('studio-emotion-list')).toEqual(['happy', 'sad', 'hat'])
    })

    test('R3: Delete in the mounted list removes the stored emotion row in one step', async () => {
        await show({ emotionImages: emotions, additionalAssets: [['smile', 'assets/smile.png', 'png']] })
        ;(document.querySelector('[data-part="studio-emotion-list"] [data-part="studio-asset-row-more"]') as HTMLElement).click()
        await settle()
        ;(document.querySelector('[data-part="studio-emotion-list"] [data-part="studio-asset-menu-delete"]') as HTMLElement).click()
        await settle()
        expect(emotionsOf()).toEqual([['sad', pB], ['hat', pC]])
        expect(service.view(OWNER).done).toHaveLength(1)
        expect(h.cleared).toEqual(['cha-1'])
        expect(db.db.characters[0].additionalAssets).toEqual([['smile', 'assets/smile.png', 'png']])
    })

    test('C1a: the asset list holds the additional assets only and still names the emotion images as listed elsewhere', async () => {
        await show({ emotionImages: emotions, additionalAssets: [['smile', 'assets/smile.png', 'png'], ['theme', 'assets/theme.mp3', 'mp3']] })
        expect(rowNamesIn('studio-asset-list')).toEqual(['smile', 'theme'])
        expect(part('studio-asset-emotions')?.textContent).toBe('studioAssetEmotionsElsewhere(3)')
    })

    test('C1b: the emotion list holds the emotion images only', async () => {
        await show({ emotionImages: emotions, additionalAssets: [['smile', 'assets/smile.png', 'png']] })
        expect(rowNamesIn('studio-emotion-list')).toEqual(['happy', 'sad', 'hat'])
        expect(rowNamesIn('studio-emotion-list')).not.toContain('smile')
    })

    test('a private character shows no emotion list', async () => {
        await show({ license: 'private', emotionImages: emotions })
        expect(part('studio-emotion-list')).toBeNull()
    })
})
