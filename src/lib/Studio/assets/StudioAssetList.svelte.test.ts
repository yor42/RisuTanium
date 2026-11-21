// @vitest-environment jsdom
/**
 * The character asset list over the real history service on the memory doubles: what each kind of file shows, the
 * names and parts a row carries, the sizes line, the empty states, the exclude item and the optional ports. The URL
 * gate, the focus rule, rename, delete and the size job have their own suites beside this one.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ marks: 0, withheld: new Set<string>(), gate: null as Promise<void> | null }))

vi.mock('src/ts/globalApi.svelte', () => ({
    getSaveMarkCount: () => h.marks,
    getFileSrc: async (path: string, use: string) => {
        await h.gate
        return h.withheld.has(path) ? '' : `blob:${use}:${path}`
    },
}))

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
    for (const key of ['studioAssetEmotionsElsewhere', 'studioAssetRowMenu', 'studioAssetDeletedOne', 'studioAssetFileGone', 'studioAssetFileUnchecked']) table[key] = call(key)
    return { language: new Proxy(table, { get: (target, key) => (typeof key === 'symbol' ? undefined : key in target ? target[key] : base[key]) }) }
})

import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import type { AssetSizeJob } from 'src/ts/studio/assets/assetSizes'
import { resetStudioToastsForTests, retireAssetToasts } from 'src/ts/studio/edit/studioToasts'
import { resetStudioScreenForTests } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from '../../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks } from '../../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../../ts/studio/history/tests/studioStoreDoubles'
import { assetRow } from '../../../ts/studio/assets/assetFixtures.test-helpers'
import { ASSET_FOLDER_KEY } from '../../../ts/studio/assets/assetOwnerKeys'
import type { AssetPickerPort, UsedInPort } from '../../../ts/studio/assets/assetPresentation'
import { allRowsGeometry, setWindowGeometryForTests } from '../../../ts/windowing/windowHost.svelte'
import StudioAssetList, { setSessionAssetSizeJobForTests } from './StudioAssetList.svelte'

interface LiveCharacter {
    chaId: string
    type: string
    license?: string
    desc: string
    alternateGreetings: string[]
    chats: { id: string; note: string; fmIndex?: number }[]
    chatPage: number
    additionalAssets: string[][]
    emotionImages: string[][]
    prebuiltAssetExclude?: string[]
    extentions?: Record<string, unknown>
}

const A = characterOwnerKey('A')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

// One of each extension the list tells apart, as the importer stores them: `[name, path, ext]`.
const EXTENSIONS = ['png', 'webp', 'jpeg', 'jpg', 'gif', 'svg', 'avif', 'mp3', 'mp4', 'webm', 'ttf', 'css', 'xyz']
const THUMBS = ['png', 'webp', 'jpeg', 'jpg', 'gif', 'svg', 'avif']
const rowsOfEveryExtension = () => EXTENSIONS.map((ext) => assetRow(`n-${ext}`, `assets/f-${ext}.${ext}`, ext))

function makeCharacter(additionalAssets: string[][], overrides: Partial<LiveCharacter> = {}): LiveCharacter {
    return {
        chaId: 'A',
        type: 'character',
        desc: 'd0',
        alternateGreetings: [],
        chats: [{ id: 'c1', note: '', fmIndex: 2 }],
        chatPage: 0,
        additionalAssets,
        emotionImages: [],
        ...overrides,
    }
}

let service: OwnerHistoryService
let mounted: { app: ReturnType<typeof mount>; host: HTMLElement }[] = []

// The URLs are asked for through a dynamic import, so timer turns run until the page stops changing for a few turns.
async function settle(): Promise<void> {
    let last = ''
    for (let round = 0, calm = 0; calm < 4 && round < 200; round++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 5))
        await drainMicrotasks()
        flushSync()
        const now = document.body.innerHTML
        calm = now === last ? calm + 1 : 0
        last = now
    }
}

async function show(props: { sizeJob?: () => Promise<AssetSizeJob>; usedIn?: UsedInPort; picker?: AssetPickerPort } = {}): Promise<HTMLElement> {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const app = mount(StudioAssetList, { target: host, props: { chaId: 'A', ...props } })
    mounted.push({ app, host })
    flushSync()
    await settle()
    return host
}

const parts = (name: string, from: ParentNode = document) => Array.from(from.querySelectorAll<HTMLElement>(`[data-part="${name}"]`))
const rowOf = (name: string): HTMLElement => parts('studio-asset-row').find((row) => (row.querySelector('[data-part="studio-asset-name"]') as HTMLInputElement).value === name) as HTMLElement

function fakeJob(sizes: Record<string, number | null>): AssetSizeJob {
    const cache = new Map<string, number | null>()
    return {
        peek: (path) => cache.get(path),
        snapshot: (paths) => new Map(paths.map((path) => [path, cache.get(path)])),
        ensure: async (paths, signal, onSettled) => {
            await Promise.resolve()
            for (const path of paths) {
                if (signal.aborted) return false
                cache.set(path, sizes[path] ?? null)
                onSettled?.(path, cache.get(path) ?? null)
            }
            return true
        },
    }
}

beforeEach(async () => {
    h.marks = 0
    h.withheld.clear()
    h.gate = null
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    // Every row falls in the window: these tests are about what a row shows, not about which rows are in the page.
    setWindowGeometryForTests(allRowsGeometry())
    // The job a list asks when a test passes none: a fresh one that knows no size, so the production job is never loaded.
    setSessionAssetSizeJobForTests(fakeJob({}))
    db.db.useAdditionalAssetsPreview = false
    db.db.characters = [makeCharacter(rowsOfEveryExtension())]
    selection.selId = 0
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
    setWindowGeometryForTests(undefined)
    setSessionAssetSizeJobForTests(undefined)
    resetStudioToastsForTests()
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

describe('what each kind of file shows', () => {
    test('images are thumbnails whose alt is the file name and which decode lazily', async () => {
        await show()
        for (const ext of THUMBS) {
            const row = rowOf(`n-${ext}`)
            const thumb = row.querySelector<HTMLImageElement>('[data-part="studio-thumb"]')
            expect(thumb, ext).not.toBeNull()
            expect(thumb?.getAttribute('alt'), ext).toBe(`n-${ext}`)
            expect(thumb?.getAttribute('loading'), ext).toBe('lazy')
            expect(thumb?.dataset.image, ext).toBe('ok')
            expect(row.querySelector('[data-part="studio-asset-tile"]'), ext).toBeNull()
        }
    })

    test('audio, video and every other file are decorative type tiles with the extension and no player', async () => {
        await show()
        for (const ext of ['mp3', 'mp4', 'webm', 'ttf', 'css', 'xyz']) {
            const row = rowOf(`n-${ext}`)
            const tile = row.querySelector<HTMLElement>('[data-part="studio-asset-tile"]')
            expect(tile, ext).not.toBeNull()
            expect(tile?.textContent, ext).toContain(ext)
            // The name is in the field beside the tile, so the tile says nothing of its own.
            expect(tile?.getAttribute('aria-hidden'), ext).toBe('true')
            expect(tile?.getAttribute('alt'), ext).toBeNull()
            expect(tile?.getAttribute('aria-label'), ext).toBeNull()
            expect(tile?.getAttribute('role'), ext).toBeNull()
            expect(row.querySelector('img, video, audio'), ext).toBeNull()
        }
    })

    test('a thumbnail whose URL is withheld shows a decorative placeholder and the name stays in the field', async () => {
        h.withheld.add('assets/f-png.png')
        await show()
        const row = rowOf('n-png')
        const placeholder = row.querySelector<HTMLElement>('[data-part="studio-thumb-placeholder"]')
        expect(placeholder?.dataset.image).toBe('placeholder')
        expect(placeholder?.getAttribute('aria-hidden')).toBe('true')
        expect(placeholder?.getAttribute('alt')).toBeNull()
        expect(row.querySelector('img')).toBeNull()
        expect((row.querySelector('[data-part="studio-asset-name"]') as HTMLInputElement).value).toBe('n-png')
    })

    test('a thumbnail whose URL has not arrived yet is a placeholder in its loading state', async () => {
        await show()
        // The mounted DOM is read before the URL promises settle in a fresh mount.
        for (const entry of mounted.splice(0)) {
            await unmount(entry.app)
            entry.host.remove()
        }
        // The URL lookups are held until the assertion, so the loading state does not depend on timing.
        let release: () => void = () => {}
        h.gate = new Promise<void>((resolve) => { release = resolve })
        const host = document.createElement('div')
        document.body.appendChild(host)
        mounted.push({ app: mount(StudioAssetList, { target: host, props: { chaId: 'A' } }), host })
        flushSync()
        // The window mounts rows once the queued first read has run.
        await Promise.resolve()
        flushSync()
        expect(parts('studio-thumb-placeholder', host).map((el) => el.dataset.image)).toEqual(THUMBS.map(() => 'loading'))
        release()
        await settle()
        expect(parts('studio-thumb', host).map((el) => el.dataset.image)).toEqual(THUMBS.map(() => 'ok'))
    })

    test('a row line is the extension alone until the size job answers, then the extension and the size', async () => {
        let release: () => void = () => {}
        const answered = new Promise<void>((resolve) => { release = resolve })
        const job = fakeJob({ 'assets/f-png.png': 2048, 'assets/f-mp3.mp3': 5 * 1024 * 1024, 'assets/f-css.css': null })
        const ensure = job.ensure
        job.ensure = async (...args) => { await answered; return ensure(...args) }
        await show({ sizeJob: async () => job })
        const meta = (name: string) => rowOf(name).querySelector('[data-part="studio-asset-meta"]')?.textContent
        expect(meta('n-png')).toBe('png')
        expect(meta('n-mp3')).toBe('mp3')
        release()
        await settle()
        expect(meta('n-png')).toBe('png · 2.0 KB')
        expect(meta('n-mp3')).toBe('mp3 · 5.0 MB')
        // A size the store could not give leaves the extension alone.
        expect(meta('n-css')).toBe('css')
    })

    test('rows carry the form row height token, falling back to the touch size, and the named parts', async () => {
        await show()
        const rows = parts('studio-asset-row')
        expect(rows).toHaveLength(EXTENSIONS.length)
        for (const row of rows) {
            expect(row.className).toContain('min-h-[var(--studio-form-row-height,var(--studio-size-touch))]')
            expect(row.querySelector('[data-part="studio-asset-name"]')).not.toBeNull()
            expect(row.querySelector('[data-part="studio-asset-row-more"]')?.textContent).toBe('⋯')
        }
    })

    test('the help line is above the rows', async () => {
        await show()
        const help = parts('studio-asset-help')[0]
        expect(help.textContent).toBe('studioAssetHelp')
        expect(help.compareDocumentPosition(parts('studio-asset-rows')[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })
})

describe('an empty list', () => {
    test('shows the empty state and no rows', async () => {
        db.db.characters = [makeCharacter([])]
        await show()
        expect(parts('studio-asset-empty')[0].textContent).toBe('noAssets')
        expect(parts('studio-asset-row')).toHaveLength(0)
        expect(parts('studio-asset-emotions')).toHaveLength(0)
    })

    test('a character with only emotion images shows the empty state and says the emotions are listed separately', async () => {
        db.db.characters = [makeCharacter([], { emotionImages: [['happy', 'assets/happy.png'], ['sad', 'assets/sad.png']] })]
        await show()
        expect(parts('studio-asset-empty')[0].textContent).toBe('noAssets')
        expect(parts('studio-asset-emotions')[0].textContent).toBe('studioAssetEmotionsElsewhere(2)')
    })

    test('emotion images are not rows: with rows as well the line still names them', async () => {
        db.db.characters = [makeCharacter([assetRow('a', 'assets/a.png')], { emotionImages: [['happy', 'assets/happy.png']] })]
        await show()
        expect(parts('studio-asset-row')).toHaveLength(1)
        expect(parts('studio-asset-emotions')[0].textContent).toBe('studioAssetEmotionsElsewhere(1)')
    })
})

describe('the exclude item', () => {
    const open = async (name: string): Promise<void> => {
        ;(rowOf(name).querySelector('[data-part="studio-asset-row-more"]') as HTMLElement).click()
        await settle()
    }
    const excludeItem = (): HTMLElement | undefined => parts('studio-asset-menu-exclude')[0]

    test('with the preview setting off there is no exclude item, only Delete', async () => {
        db.db.characters = [makeCharacter([assetRow('a', 'assets/a.png')])]
        await show()
        await open('a')
        expect(parts('studio-asset-menu-delete')).toHaveLength(1)
        expect(excludeItem()).toBeUndefined()
    })

    test('with it on, the item adds the path to a created array and a second press removes it, as the classic list does', async () => {
        db.db.useAdditionalAssetsPreview = true
        db.db.characters = [makeCharacter([assetRow('a', 'assets/a.png'), assetRow('b', 'assets/b.png')])]
        await show()
        await open('a')
        expect(excludeItem()?.textContent).toBe('studioAssetHideFromPreview')
        const marks = h.marks
        excludeItem()?.click()
        await settle()
        expect(db.db.characters[0].prebuiltAssetExclude).toEqual(['assets/a.png'])
        expect(h.marks).toBe(marks + 1)
        expect(service.view(A).done).toHaveLength(0)
        await open('a')
        expect(excludeItem()?.textContent).toBe('studioAssetShowInPreview')
        excludeItem()?.click()
        await settle()
        expect(db.db.characters[0].prebuiltAssetExclude).toEqual([])
        expect(service.view(A).done).toHaveLength(0)
    })

    test('the exclude toggle still works when history is in memory only, because it removes no row', async () => {
        db.db.useAdditionalAssetsPreview = true
        db.db.characters = [makeCharacter([assetRow('a', 'assets/a.png')], { prebuiltAssetExclude: ['assets/other.png'] })]
        // Another tab holds the character: this page's history is memory only.
        const claim = createClaimDouble()
        claim.forced = 'held'
        service = createOwnerHistoryService({ store: createMemoryStudioStore(), claim, clock: createFakeClock(), pageSession: 'p2', registerLeaveFlush: () => () => {} })
        setStudioHistoryServiceForTests(service)
        await service.whenReady(A)
        expect(service.view(A).phase).toBe('memoryOnly')
        await show()
        await open('a')
        excludeItem()?.click()
        await settle()
        expect(db.db.characters[0].prebuiltAssetExclude).toEqual(['assets/other.png', 'assets/a.png'])
    })

    test('a character that is gone changes nothing', async () => {
        db.db.useAdditionalAssetsPreview = true
        db.db.characters = [makeCharacter([assetRow('a', 'assets/a.png')])]
        await show()
        await open('a')
        const marks = h.marks
        const item = excludeItem()
        db.db.characters = []
        flushSync()
        item?.click()
        await settle()
        expect(h.marks).toBe(marks)
    })
})

describe('a row that is not displayed holds no player', () => {
    const rawPlayers = () => document.querySelectorAll('[data-part="studio-asset-media"]').length

    async function previewMp3(): Promise<void> {
        ;(rowOf('n-mp3').querySelector('[data-part="studio-asset-row-more"]') as HTMLElement).click()
        await settle()
        ;(rowOf('n-mp3').querySelector('[data-part="studio-asset-menu-preview"]') as HTMLElement).click()
        await settle()
    }

    async function typeFilter(text: string): Promise<void> {
        const field = parts('studio-asset-filter')[0] as HTMLInputElement
        field.value = text
        field.dispatchEvent(new Event('input', { bubbles: true }))
        await settle()
    }

    test('filtering the previewing row out removes its player, and clearing the filter brings it back', async () => {
        await show()
        await previewMp3()
        expect(rawPlayers()).toBe(1)
        await typeFilter('n-mp4')
        expect(rawPlayers()).toBe(0)
        await typeFilter('')
        expect(rawPlayers()).toBe(1)
    })

    test('collapsing the previewing row\'s folder removes its player, and opening the folder again brings it back', async () => {
        db.db.characters = [makeCharacter(rowsOfEveryExtension(), { extentions: { [ASSET_FOLDER_KEY]: { v: 1, additional: { order: ['Music'], of: [['n-mp3', 'Music']] } } } })]
        await show()
        await previewMp3()
        expect(rawPlayers()).toBe(1)
        const header = parts('studio-asset-folder-header').find((candidate) => candidate.textContent?.includes('Music')) as HTMLElement
        header.click()
        await settle()
        expect(header.getAttribute('aria-expanded')).toBe('false')
        expect(rawPlayers()).toBe(0)
        header.click()
        await settle()
        expect(rawPlayers()).toBe(1)
    })
})

describe('the optional ports', () => {
    test('without an AssetPickerPort there is no Add control, and with one it is called once per press', async () => {
        await show()
        expect(parts('studio-asset-add')).toHaveLength(0)
        for (const entry of mounted.splice(0)) {
            await unmount(entry.app)
            entry.host.remove()
        }
        const picker = { open: vi.fn() }
        await show({ picker })
        expect(parts('studio-asset-add')).toHaveLength(1)
        parts('studio-asset-add')[0].click()
        expect(picker.open).toHaveBeenCalledTimes(1)
    })

    test('without a UsedInPort no used-in button and no count is shown', async () => {
        await show()
        expect(parts('studio-asset-used')).toHaveLength(0)
        expect(parts('studio-asset-renamed-note')).toHaveLength(0)
    })

    test('a UsedInPort supplies each row\'s used-in button and its text', async () => {
        db.db.characters = [makeCharacter([assetRow('a', 'assets/a.png'), assetRow('b', 'assets/b.png')])]
        const usedIn: UsedInPort = {
            usedText: (name) => (name === 'a' ? '3 places' : null),
            showUsed: vi.fn(),
            renamedNote: () => null,
            showRenamed: vi.fn(),
        }
        await show({ usedIn })
        const buttons = parts('studio-asset-used')
        expect(buttons.map((button) => button.textContent)).toEqual(['3 places'])
        buttons[0].click()
        expect(usedIn.showUsed).toHaveBeenCalledWith('a')
    })
})
