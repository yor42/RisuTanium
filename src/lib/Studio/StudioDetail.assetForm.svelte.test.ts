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
    for (const key of ['studioAssetEmotionsElsewhere', 'studioAssetRowMenu', 'studioAssetSelectedCount', 'studioAssetFilterEmpty']) table[key] = call(key)
    return { language: new Proxy(table, { get: (target, key) => (typeof key === 'symbol' ? undefined : key in target ? target[key] : base[key]) }) }
})

import type { SaveAck } from '../../ts/studio/edit/saveAck.svelte'
import type { OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { openStudio, resetStudioScreenForTests, setStudioSelection, studioScreen } from '../../ts/studio/studioScreen.svelte'
import { setStudioEnabled } from '../../ts/studio/studioSwitch.svelte'
import { ASSET_FOLDER_KEY } from '../../ts/studio/assets/assetOwnerKeys'
import type { AssetSizeJob, StoredSize } from '../../ts/studio/assets/assetSizes'
import { setSessionAssetSizeJobForTests, setSessionFinderPortForTests } from './assets/StudioAssetList.svelte'
import type { FinderPort } from './assets/StudioAssetFinder.svelte'
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
    setSessionFinderPortForTests(undefined)
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

describe('the asset list across rebuilds of the owner model and across owner and kind changes', () => {
    const folders = { v: 1, additional: { order: ['F1', 'F2'], of: [['a1', 'F1'], ['a2', 'F1'], ['b1', 'F2'], ['b2', 'F2']] } }
    const rows = [['a1', 'assets/a1.png', 'png'], ['a2', 'assets/a2.png', 'png'], ['b1', 'assets/b1.png', 'png'], ['b2', 'assets/b2.png', 'png'], ['c1', 'assets/c1.png', 'png']]
    // What the person sees: a hidden row or folder stays in the page, so an element that is itself hidden, or inside a hidden one, is left out.
    const all = <T extends HTMLElement>(name: string) => Array.from(document.querySelectorAll<T>(`[data-part="${name}"]`)).filter((element) => element.closest('[hidden]') === null)

    // A rebuild of the model that changes nothing the list shows: what the GUI reload pointer does after any module write.
    function rebuild(): void {
        ReloadGUIPointer.update((value) => value + 1)
        flushSync()
    }

    function click(element: HTMLElement): void {
        element.click()
        flushSync()
    }

    function typeFilter(text: string): void {
        const field = part('studio-asset-filter') as HTMLInputElement
        field.value = text
        field.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
    }

    test('keeps the filter, the selection and the folded folders, on the same list', () => {
        setCharacter({ additionalAssets: rows, extentions: { [ASSET_FOLDER_KEY]: folders } })
        openStudio(displayTarget, null)
        show()
        const list = part('studio-asset-list')
        click(part('studio-asset-select-toggle') as HTMLElement)
        typeFilter('1')
        // "1" matches the folder F1 too, so its two rows show beside b1 and c1: a1 and c1 are ticked, b1 is not.
        click(all('studio-asset-select')[0])
        click(all('studio-asset-select')[3])
        expect(part('studio-asset-selected-count')?.textContent).toBe('studioAssetSelectedCount(2)')
        // F2 holds a row that is shown and not ticked.
        click(all('studio-asset-folder-header')[1])
        expect(all('studio-asset-folder-header')[1].getAttribute('aria-expanded')).toBe('false')
        expect(part('studio-asset-selected-count')?.textContent).toBe('studioAssetSelectedCount(2)')
        rebuild()
        rebuild()
        expect(part('studio-asset-list')).toBe(list)
        expect((part('studio-asset-filter') as HTMLInputElement).value).toBe('1')
        expect(part('studio-asset-selected-count')?.textContent).toBe('studioAssetSelectedCount(2)')
        expect(all('studio-asset-folder-header')[1].getAttribute('aria-expanded')).toBe('false')
    })

    test('builds the list again with nothing carried over when the kind changes and comes back', () => {
        setCharacter({ additionalAssets: rows, extentions: { [ASSET_FOLDER_KEY]: folders } })
        openStudio(displayTarget, null)
        show()
        click(part('studio-asset-select-toggle') as HTMLElement)
        typeFilter('1')
        click(all('studio-asset-select')[0])
        const ownerKey = studioScreen.selectedOwnerKey as string
        setStudioSelection(ownerKey, 'basic', null)
        flushSync()
        expect(part('studio-asset-list')).toBeNull()
        setStudioSelection(ownerKey, 'display', null)
        flushSync()
        expect((part('studio-asset-filter') as HTMLInputElement).value).toBe('')
        expect(part('studio-asset-bulkbar')).toBeNull()
        expect(all('studio-asset-row')).toHaveLength(5)
    })

    test('lets a pass of Check bytes finish across a rebuild: it is not aborted and its result is applied', async () => {
        setCharacter({ additionalAssets: [['x', 'assets/a.png', 'png'], ['x', 'assets/b.png', 'png']] })
        const sizes = new Map<string, number | null>()
        const signals: AbortSignal[] = []
        let release: () => void = () => {}
        const held = new Promise<void>((resolve) => { release = resolve })
        const port: FinderPort = {
            sizes: { peek: (path) => sizes.get(path), snapshot: (paths) => new Map<string, StoredSize>(paths.map((path) => [path, sizes.get(path)])), ensure: async () => true },
            hashCache: { get: () => undefined },
            async checkBytes(pass, signal, hooks) {
                signals.push(signal)
                hooks.onPhase('hashing')
                for (const row of pass) sizes.set(row.path, 10)
                await held
                return { status: signal.aborted ? 'aborted' : 'done', hashes: new Map(pass.map((row) => [row.path, 'same'])), unreadable: [] }
            },
        }
        setSessionFinderPortForTests(port)
        openStudio(displayTarget, null)
        show()
        click(part('studio-asset-find-duplicates') as HTMLElement)
        click(part('studio-asset-check-bytes') as HTMLElement)
        await Promise.resolve()
        await Promise.resolve()
        expect(signals).toHaveLength(1)
        rebuild()
        rebuild()
        release()
        for (let turn = 0; turn < 5; turn++) await Promise.resolve()
        flushSync()
        expect(signals[0].aborted).toBe(false)
        expect(all('studio-asset-dup-group').map((group) => group.dataset.class)).toEqual(['sameFile'])
        expect(part('studio-asset-remove-extras')).not.toBeNull()
    })
})
