// @vitest-environment jsdom
/**
 * The Studio long-task fixes mounted over a synthetic database: one owner model serves every pane of a screen and
 * survives a phone pane swap, and the lists read only the entries they show. The stores, the module lister and the
 * locale are replaced; the owner source, the owner model and the screen store are real, and the model builder is
 * wrapped to count builds.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
    listerOver,
    loreEntries,
    makeCharacter,
    makeChat,
    makeInput,
    regexEntries,
    residentModule,
    studioDbOf,
} from '../../ts/studio/studioFixtures.test-helpers'
import type { LoreLike } from '../../ts/studio/ownerModel'

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
vi.mock('../../ts/studio/ownerModel', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../ts/studio/ownerModel')>()
    return { ...actual, buildOwnerModel: vi.fn(actual.buildOwnerModel) }
})

import { resetBackHandlersForTests } from '../../ts/backHandlers'
import { buildOwnerModel } from '../../ts/studio/ownerModel'
import { openStudio, resetStudioScreenForTests, selectStudioNode, studioScreen } from '../../ts/studio/studioScreen.svelte'
import { setStudioEnabled } from '../../ts/studio/studioSwitch.svelte'
import StudioScreen from './StudioScreen.svelte'
import StudioTree from './StudioTree.svelte'

class ResizeObserverStub {
    static instances: ResizeObserverStub[] = []
    constructor(private readonly callback: ResizeObserverCallback) {
        ResizeObserverStub.instances.push(this)
    }
    observe(): void {}
    disconnect(): void {
        ResizeObserverStub.instances = ResizeObserverStub.instances.filter((entry) => entry !== this)
    }
    emit(width: number): void {
        this.callback([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver)
    }
}

const OWNER = 'character:cha-1'
const ownerTarget = { owner: { type: 'character', id: 'cha-1' }, from: 'chat' } as const

function fixtureInput(globalLore: LoreLike[] = loreEntries(250)) {
    return makeInput({
        character: makeCharacter({
            globalLore,
            customscript: regexEntries(0),
            chats: [makeChat({ id: 'chat-1', name: 'First chat' })],
        }),
        modules: [1, 2, 3, 4, 5].map((index) => residentModule(`mod-${index}`)),
    })
}

/** Lore entries whose name is read through a counting accessor; the screen's reactive proxy calls it untracked. */
function countingLore(count: number, reads: number[]): LoreLike[] {
    return Array.from({ length: count }, (_, index): LoreLike => ({
        get comment() {
            reads.push(index)
            return `lore ${index}`
        },
        key: `lore-key-${index}`,
        mode: 'normal',
    }))
}

let apps: ReturnType<typeof mount>[] = []
let hosts: HTMLElement[] = []

function show(component: typeof StudioTree | typeof StudioScreen): HTMLElement {
    const host = document.createElement('div')
    document.body.appendChild(host)
    hosts.push(host)
    apps.push(mount(component, { target: host }))
    flushSync()
    return host
}

function resize(width: number): void {
    for (const observer of ResizeObserverStub.instances) observer.emit(width)
    flushSync()
}

const builds = () => vi.mocked(buildOwnerModel).mock.calls.length
const row = (id: string) => document.querySelector<HTMLElement>(`[data-row-id="${id}"]`)
const rowsOfKind = (kind: string) => document.querySelectorAll(`[data-row-kind="${kind}"]`)
const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)

function click(element: Element | null): void {
    ;(element as HTMLElement | null)?.click()
    flushSync()
}

async function settle(): Promise<void> {
    await tick()
    flushSync()
}

function useLore(globalLore: LoreLike[]): void {
    db.db = studioDbOf(fixtureInput(globalLore))
}

/** Appends to the live list the model reads, as an edit of the character would. */
function appendLore(entry: LoreLike): void {
    Array.prototype.push.call(db.db.characters[0].globalLore, entry)
}

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    ResizeObserverStub.instances = []
    localStorage.clear()
    resetBackHandlersForTests()
    resetStudioScreenForTests()
    settingsOpen.set(false)
    MobileGUI.set(false)
    CharConfigSubMenu.set(0)
    ReloadGUIPointer.set(0)
    db.db = studioDbOf(fixtureInput())
    selection.selId = 0
    setStudioEnabled(true)
    vi.mocked(buildOwnerModel).mockClear()
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

describe('one owner model per screen', () => {
    test('T1 a phone pane swap builds no model after the first mount settled', async () => {
        openStudio(ownerTarget, null)
        show(StudioScreen)
        resize(400)
        await settle()
        expect(studioScreen.layout).toBe('stack')
        expect(part('studio-detail')).not.toBeNull()
        // Builds are counted from here: the mount and the layout switch are not the swap under test.
        vi.mocked(buildOwnerModel).mockClear()

        click(part('studio-title'))
        await settle()
        expect(part('studio-tree')).not.toBeNull()
        selectStudioNode(OWNER, 'regex', null)
        await settle()
        expect(part('studio-detail')).not.toBeNull()
        expect(builds()).toBe(0)
    })

    test('T2 three panes share one build, and a pointer move rebuilds once', async () => {
        openStudio(ownerTarget, null)
        studioScreen.searchOpen = true
        show(StudioScreen)
        await settle()
        expect(studioScreen.layout).toBe('wide')
        expect(part('studio-search')).not.toBeNull()
        expect(builds()).toBe(1)

        vi.mocked(buildOwnerModel).mockClear()
        ReloadGUIPointer.update((value) => value + 1)
        await settle()
        expect(builds()).toBe(1)
    })

    test('T3 after a name change and a pointer move, the tree and the detail show the new name', async () => {
        openStudio(ownerTarget, null)
        show(StudioScreen)
        await settle()
        db.db.characters[0].name = 'Bob'
        ReloadGUIPointer.update((value) => value + 1)
        await settle()
        expect(row(`o:${OWNER}`)?.textContent).toContain('Bob')
        expect(part('studio-detail-title')?.textContent).toContain('Bob')
    })
})

describe('lists read only the entries they show', () => {
    test('T4 expanding a long lorebook reads the shown page only, and show more reads one page further', async () => {
        const reads: number[] = []
        useLore(countingLore(2000, reads))
        openStudio(ownerTarget, null)
        show(StudioTree)
        await settle()
        reads.length = 0

        click(row(`k:${OWNER}/lore`))
        expect(rowsOfKind('item').length).toBe(100)
        expect(reads.filter((index) => index >= 100)).toHaveLength(0)

        click(document.querySelector('[data-row-kind="more"]'))
        expect(rowsOfKind('item').length).toBe(200)
        expect(reads.filter((index) => index >= 200)).toHaveLength(0)
    })

    test('T5 the detail of lore entry 1500 reads that entry only', async () => {
        const reads: number[] = []
        useLore(countingLore(2000, reads))
        openStudio(ownerTarget, null)
        show(StudioScreen)
        resize(400)
        await settle()
        reads.length = 0

        selectStudioNode(OWNER, 'lore', 'cha-1/lore:1500')
        await settle()
        expect(part('studio-detail-item')?.textContent).toContain('lore 1500')
        expect(reads.filter((index) => index !== 1500)).toHaveLength(0)
    })

    test('T5b the detail of a lore kind with no entry chosen reads no entry', async () => {
        const reads: number[] = []
        useLore(countingLore(2000, reads))
        openStudio(ownerTarget, null)
        show(StudioScreen)
        resize(400)
        await settle()
        reads.length = 0

        selectStudioNode(OWNER, 'lore', null)
        await settle()
        expect(part('studio-detail')).not.toBeNull()
        expect(reads).toHaveLength(0)
    })
})

describe('the shown rows stay live', () => {
    test('T6 a new name on a shown entry updates its row with no pointer move', async () => {
        openStudio(ownerTarget, null)
        show(StudioTree)
        await settle()
        click(row(`k:${OWNER}/lore`))
        expect(row('i:cha-1/lore:5')?.textContent).toContain('lore 5')

        db.db.characters[0].globalLore![5].comment = 'renamed five'
        flushSync()
        expect(row('i:cha-1/lore:5')?.textContent).toContain('renamed five')
    })

    test('T7 an appended entry appears in a short list', async () => {
        useLore(loreEntries(3))
        openStudio(ownerTarget, null)
        show(StudioTree)
        await settle()
        click(row(`k:${OWNER}/lore`))
        expect(rowsOfKind('item').length).toBe(3)
        appendLore({ comment: 'fourth', key: 'fourth-key', mode: 'normal' })
        flushSync()
        expect(rowsOfKind('item').length).toBe(4)
    })

    test('T7 an appended entry moves the show more count of a long list', async () => {
        useLore(loreEntries(150))
        openStudio(ownerTarget, null)
        show(StudioTree)
        await settle()
        click(row(`k:${OWNER}/lore`))
        expect(rowsOfKind('item').length).toBe(100)
        expect(document.querySelector('[data-row-kind="more"]')?.textContent).toContain('studioShowMore(50)')
        appendLore({ comment: 'extra', key: 'extra-key', mode: 'normal' })
        flushSync()
        expect(document.querySelector('[data-row-kind="more"]')?.textContent).toContain('studioShowMore(51)')
    })
})
