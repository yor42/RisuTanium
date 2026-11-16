// @vitest-environment jsdom
/**
 * The URLs a Studio asset row asks the store for. The URL gate module is mocked with its real functions wrapped, so
 * every decision and every request is recorded: a thumbnail asks for a whole read in the run's budget, a player asks
 * for a media URL only after Preview, a tile asks for nothing, and a URL that arrives for a row that now names
 * another file is dropped.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    marks: 0,
    requests: [] as { path: string; use: string; budget: unknown }[],
    // A path listed here answers when its promise settles, so a test can make a URL arrive late.
    held: new Map<string, Promise<string>>(),
}))

vi.mock('src/ts/globalApi.svelte', () => ({
    getSaveMarkCount: () => h.marks,
    getFileSrc: vi.fn(async (path: string, use: string, budget?: unknown) => {
        h.requests.push({ path, use, budget })
        return (await h.held.get(path)) ?? `blob:${use}:${path}`
    }),
    releaseAssetObjectUrl: vi.fn(),
}))
vi.mock('src/ts/storage/assetUrlGate', async (importActual) => {
    const actual = await importActual<typeof import('src/ts/storage/assetUrlGate')>()
    return {
        ...actual,
        assetListUse: vi.fn(actual.assetListUse),
        assetListElement: vi.fn(actual.assetListElement),
        createWholeReadBudget: vi.fn(actual.createWholeReadBudget),
        forgetStoredAssetSizes: vi.fn(actual.forgetStoredAssetSizes),
    }
})

const db = $state({ db: { characters: [] as LiveCharacter[], useAdditionalAssetsPreview: false, modules: [] as unknown[] } })
const selection = $state({ selId: 0 })

// Getters: the statically imported modules are evaluated before these consts are initialised.
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        get DBState() { return db },
        get selIdState() { return selection },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        frozenSaveKeysStore: writable([]),
        clearCharEmotionCache: () => {},
    }
})
vi.mock('src/lang', async () => {
    const helpers = await import('src/ts/studio/studioFixtures.test-helpers')
    const base = helpers.studioLanguageMock()
    const call = (key: string) => (...args: (string | number)[]) => `${key}(${args.join(',')})`
    const table: Record<string, unknown> = { sidebarUi: { noAssets: 'noAssets' } }
    for (const key of ['studioAssetEmotionsElsewhere', 'studioAssetRowMenu', 'studioAssetDeletedOne']) table[key] = call(key)
    return { language: new Proxy(table, { get: (target, key) => (typeof key === 'symbol' ? undefined : key in target ? target[key] : base[key]) }) }
})

import { releaseAssetObjectUrl } from 'src/ts/globalApi.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { assetListElement, assetListUse, createWholeReadBudget, forgetStoredAssetSizes } from 'src/ts/storage/assetUrlGate'
import type { AssetSizeJob, StoredSize } from 'src/ts/studio/assets/assetSizes'
import { resetStudioToastsForTests, retireAssetToasts } from 'src/ts/studio/edit/studioToasts'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from '../../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks } from '../../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../../ts/studio/history/tests/studioStoreDoubles'
import { assetRow } from '../../../ts/studio/assets/assetFixtures.test-helpers'
import StudioAssetList, { setSessionAssetSizeJobForTests } from './StudioAssetList.svelte'

// No size is ever read: the production size job is not loaded.
const noSizes: AssetSizeJob = { peek: () => undefined, snapshot: () => new Map<string, StoredSize>(), ensure: async () => true }

interface LiveCharacter {
    chaId: string
    type: string
    desc: string
    alternateGreetings: string[]
    chats: { id: string; note: string; fmIndex?: number }[]
    chatPage: number
    additionalAssets: string[][]
    emotionImages: string[][]
}

const A = characterOwnerKey('A')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

// The element the gate's own decision names for each extension.
const ELEMENT_OF: Record<string, string> = {
    png: 'image', webp: 'image', jpeg: 'image', jpg: 'image', gif: 'image', svg: 'image', avif: 'image',
    mp3: 'audio', mp4: 'video', webm: 'video', ttf: 'none', css: 'none', xyz: 'none',
}
const EXTENSIONS = Object.keys(ELEMENT_OF)
const pathOf = (ext: string) => `assets/f-${ext}.${ext}`
const rowsOfEveryExtension = () => EXTENSIONS.map((ext) => assetRow(`n-${ext}`, pathOf(ext), ext))

function makeCharacter(additionalAssets: string[][]): LiveCharacter {
    return { chaId: 'A', type: 'character', desc: 'd0', alternateGreetings: [], chats: [{ id: 'c1', note: '', fmIndex: 2 }], chatPage: 0, additionalAssets, emotionImages: [] }
}

let service: OwnerHistoryService
let mounted: { app: ReturnType<typeof mount>; host: HTMLElement }[] = []

// The URLs are asked for through a dynamic import, so timer turns run until neither the requests nor the page change
// for a few turns in a row.
async function settle(): Promise<void> {
    let last = ''
    for (let round = 0, calm = 0; calm < 4 && round < 200; round++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 5))
        await drainMicrotasks()
        flushSync()
        const now = `${h.requests.length}:${document.body.innerHTML}`
        calm = now === last ? calm + 1 : 0
        last = now
    }
}

async function show(): Promise<void> {
    const host = document.createElement('div')
    document.body.appendChild(host)
    mounted.push({ app: mount(StudioAssetList, { target: host, props: { chaId: 'A' } }), host })
    flushSync()
    await settle()
}

const parts = (name: string, from: ParentNode = document) => Array.from(from.querySelectorAll<HTMLElement>(`[data-part="${name}"]`))
const rowOf = (name: string): HTMLElement => parts('studio-asset-row').find((row) => (row.querySelector('[data-part="studio-asset-name"]') as HTMLInputElement).value === name) as HTMLElement
const requestsFor = (ext: string) => h.requests.filter((request) => request.path === pathOf(ext))

async function pressPreview(name: string): Promise<void> {
    ;(rowOf(name).querySelector('[data-part="studio-asset-row-more"]') as HTMLElement).click()
    await settle()
    ;(rowOf(name).querySelector('[data-part="studio-asset-menu-preview"]') as HTMLElement).click()
    await settle()
}

beforeEach(async () => {
    h.marks = 0
    h.requests.length = 0
    h.held.clear()
    vi.mocked(assetListUse).mockClear()
    vi.mocked(assetListElement).mockClear()
    vi.mocked(createWholeReadBudget).mockClear()
    vi.mocked(forgetStoredAssetSizes).mockClear()
    vi.mocked(releaseAssetObjectUrl).mockClear()
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    setSessionAssetSizeJobForTests(noSizes)
    // The preview setting is off: it must not gate a thumbnail.
    db.db.useAdditionalAssetsPreview = false
    db.db.characters = [makeCharacter(rowsOfEveryExtension())]
    selection.selId = 0
    studioScreen.chaId = 'A'
    service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock: createFakeClock(),
        pageSession: 'p1',
        registerLeaveFlush: () => () => {},
        onLanded: retireAssetToasts,
    })
    setStudioHistoryServiceForTests(service)
    setStudioVisitAckForTests({ noteEdit: () => {}, dispose: () => {} } as never)
    await service.whenReady(A)
})

afterEach(async () => {
    for (const entry of mounted.splice(0)) {
        await unmount(entry.app)
        entry.host.remove()
    }
    setSessionAssetSizeJobForTests(undefined)
    resetStudioToastsForTests()
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

describe('the URL a row asks for at render', () => {
    test('every image extension asks for a whole read, whatever the preview setting says', async () => {
        await show()
        for (const ext of ['png', 'webp', 'jpeg', 'jpg', 'gif', 'svg', 'avif']) {
            expect(requestsFor(ext).map((request) => request.use), ext).toEqual(['whole'])
        }
    })

    test('audio and video ask for nothing before Preview and show a tile with no player', async () => {
        await show()
        for (const ext of ['mp3', 'mp4', 'webm']) {
            expect(requestsFor(ext), ext).toEqual([])
            expect(rowOf(`n-${ext}`).querySelector('[data-part="studio-asset-tile"]'), ext).not.toBeNull()
            expect(rowOf(`n-${ext}`).querySelector('audio, video'), ext).toBeNull()
        }
    })

    test('fonts, styles and unknown files never ask for a URL, even after their menu is opened', async () => {
        await show()
        for (const ext of ['ttf', 'css', 'xyz']) {
            ;(rowOf(`n-${ext}`).querySelector('[data-part="studio-asset-row-more"]') as HTMLElement).click()
            await settle()
            expect(rowOf(`n-${ext}`).querySelector('[data-part="studio-asset-menu-preview"]'), ext).toBeNull()
            expect(requestsFor(ext), ext).toEqual([])
        }
    })
})

describe('Preview', () => {
    test('asks for a media URL and mounts a player with controls that neither plays by itself nor repeats', async () => {
        await show()
        for (const ext of ['mp3', 'mp4', 'webm']) {
            await pressPreview(`n-${ext}`)
            expect(requestsFor(ext).map((request) => request.use), ext).toEqual(['media'])
            const media = rowOf(`n-${ext}`).querySelector<HTMLMediaElement>('[data-part="studio-asset-media"]')
            expect(media, ext).not.toBeNull()
            expect(media?.tagName, ext).toBe(ext === 'mp3' ? 'AUDIO' : 'VIDEO')
            expect(media?.hasAttribute('controls'), ext).toBe(true)
            expect(media?.hasAttribute('autoplay'), ext).toBe(false)
            expect(media?.hasAttribute('loop'), ext).toBe(false)
            expect(media?.getAttribute('src'), ext).toBe(`blob:media:${pathOf(ext)}`)
        }
    })

    test('a media request carries no whole-read budget, and the other rows are not asked again', async () => {
        await show()
        const before = h.requests.length
        await pressPreview('n-mp3')
        const added = h.requests.slice(before)
        expect(added).toHaveLength(1)
        expect(added[0]).toMatchObject({ path: pathOf('mp3'), use: 'media', budget: undefined })
    })
})

describe('Preview after a delete over a shared file', () => {
    test('the row that takes the key of a deleted, previewed row does not show a player', async () => {
        db.db.characters = [makeCharacter([assetRow('a', 'assets/x.mp3', 'mp3'), assetRow('b', 'assets/x.mp3', 'mp3'), assetRow('c', 'assets/c.png')])]
        await show()
        await pressPreview('a')
        expect(rowOf('a').querySelector('[data-part="studio-asset-media"]')).not.toBeNull()
        expect(rowOf('b').querySelector('[data-part="studio-asset-media"]')).toBeNull()
        ;(rowOf('a').querySelector('[data-part="studio-asset-row-more"]') as HTMLElement).click()
        await settle()
        ;(rowOf('a').querySelector('[data-part="studio-asset-menu-delete"]') as HTMLElement).click()
        await settle()
        expect(db.db.characters[0].additionalAssets.map((row) => row[0])).toEqual(['b', 'c'])
        expect(rowOf('b').querySelector('[data-part="studio-asset-media"]')).toBeNull()
        expect(parts('studio-asset-media')).toEqual([])
    })

    test('a player that stays on a row stays when the row before it, over the same file, is deleted', async () => {
        db.db.characters = [makeCharacter([assetRow('a', 'assets/x.mp3', 'mp3'), assetRow('b', 'assets/x.mp3', 'mp3')])]
        await show()
        await pressPreview('b')
        ;(rowOf('a').querySelector('[data-part="studio-asset-row-more"]') as HTMLElement).click()
        await settle()
        ;(rowOf('a').querySelector('[data-part="studio-asset-menu-delete"]') as HTMLElement).click()
        await settle()
        expect(db.db.characters[0].additionalAssets.map((row) => row[0])).toEqual(['b'])
        expect(rowOf('b').querySelector('[data-part="studio-asset-media"]')).not.toBeNull()
    })
})

describe('the gate decides the use', () => {
    test('every request equals the gate\'s answer for the row\'s element, and the list never asks for the element itself', async () => {
        await show()
        await pressPreview('n-mp3')
        await pressPreview('n-mp4')
        await pressPreview('n-webm')
        const answers = vi.mocked(assetListUse).mock.calls.map((call, i) => ({ element: call[0], use: vi.mocked(assetListUse).mock.results[i].value as string | null }))
        for (const element of ['image', 'audio', 'video', 'none']) {
            expect(answers.some((answer) => answer.element === element), element).toBe(true)
        }
        for (const request of h.requests) {
            const ext = EXTENSIONS.find((candidate) => pathOf(candidate) === request.path) as string
            const answered = answers.filter((answer) => answer.element === ELEMENT_OF[ext]).map((answer) => answer.use)
            expect(answered.length, ext).toBeGreaterThan(0)
            expect(new Set(answered), ext).toEqual(new Set([request.use]))
        }
        expect(assetListElement).not.toHaveBeenCalled()
    })
})

describe('the whole-read budget', () => {
    test('the thumbnails of one run share one budget, and a later run makes another', async () => {
        db.db.characters = [makeCharacter([assetRow('a', 'assets/a.png'), assetRow('b', 'assets/b.png'), assetRow('c', 'assets/c.png')])]
        await show()
        const wholes = h.requests.filter((request) => request.use === 'whole')
        expect(wholes).toHaveLength(3)
        expect(wholes[0].budget).toBeDefined()
        expect(wholes[1].budget).toBe(wholes[0].budget)
        expect(wholes[2].budget).toBe(wholes[0].budget)
        expect(createWholeReadBudget).toHaveBeenCalledTimes(1)

        db.db.characters[0].additionalAssets.push(assetRow('d', 'assets/d.png'))
        await settle()
        const added = h.requests.filter((request) => request.path === 'assets/d.png')
        expect(added).toHaveLength(1)
        expect(added[0].budget).toBeDefined()
        expect(added[0].budget).not.toBe(wholes[0].budget)
    })
})

describe('a row never shows the URL made for another file', () => {
    test('a URL that arrives late for the row\'s previous occupant is dropped', async () => {
        let arrive: (url: string) => void = () => {}
        h.held.set('assets/a.png', new Promise<string>((resolve) => { arrive = resolve }))
        db.db.characters = [makeCharacter([assetRow('a', 'assets/a.png'), assetRow('b', 'assets/b.png')])]
        await show()
        expect(parts('studio-thumb')).toHaveLength(1)
        expect(parts('studio-thumb')[0].getAttribute('src')).toBe('blob:whole:assets/b.png')

        // Row 0 now names b.png; a.png's URL was made for the row that used to be there.
        const removed = service.assetDelete(A, 'additionalAssets', [0])
        expect(removed.ok).toBe(true)
        await settle()
        arrive('blob:whole:assets/a.png')
        await settle()
        const thumbs = parts('studio-thumb')
        expect(thumbs).toHaveLength(1)
        expect(thumbs[0].getAttribute('src')).toBe('blob:whole:assets/b.png')
        expect(document.body.innerHTML).not.toContain('blob:whole:assets/a.png')
    })

    test('a row that moves up keeps the URL made for its file and asks again for nothing', async () => {
        db.db.characters = [makeCharacter([assetRow('a', 'assets/a.png'), assetRow('b', 'assets/b.png'), assetRow('c', 'assets/c.png')])]
        await show()
        const before = h.requests.length
        expect(service.assetDelete(A, 'additionalAssets', [0]).ok).toBe(true)
        await settle()
        expect(h.requests.length).toBe(before)
        expect(parts('studio-thumb').map((thumb) => thumb.getAttribute('src'))).toEqual(['blob:whole:assets/b.png', 'blob:whole:assets/c.png'])
    })
})

describe('a Studio delete reads and releases nothing', () => {
    test('deleting a row neither releases an object URL nor forgets a stored size', async () => {
        db.db.characters = [makeCharacter([assetRow('a', 'assets/a.png'), assetRow('b', 'assets/b.png')])]
        await show()
        ;(rowOf('a').querySelector('[data-part="studio-asset-row-more"]') as HTMLElement).click()
        await settle()
        ;(rowOf('a').querySelector('[data-part="studio-asset-menu-delete"]') as HTMLElement).click()
        await settle()
        expect(db.db.characters[0].additionalAssets.map((row) => row[0])).toEqual(['b'])
        expect(releaseAssetObjectUrl).not.toHaveBeenCalled()
        expect(forgetStoredAssetSizes).not.toHaveBeenCalled()
    })
})
