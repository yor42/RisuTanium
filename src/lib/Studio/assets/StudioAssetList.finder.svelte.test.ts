// @vitest-environment jsdom
/**
 * The duplicate panel of the Studio asset list over the real history service on the memory doubles and a double of
 * the byte layer: when anything is read, what each group is called and offered, how Remove extras names its survivor,
 * and what a pass that is cancelled, closed, or overtaken by edits leaves. Feature guards: none of this exists at the
 * stage's base.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({
    getSaveMarkCount: () => h.marks,
    getFileSrc: async (path: string, use: string) => `blob:${use}:${path}`,
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
    const table: Record<string, unknown> = { sidebarUi: { noAssets: 'noAssets' }, uiCommon: { close: 'close' } }
    for (const key of [
        'studioAssetEmotionsElsewhere', 'studioAssetRowMenu', 'studioAssetDeletedOne', 'studioAssetFileGone', 'studioAssetFileUnchecked',
        'studioAssetDupUnreadableCount', 'studioAssetCheckProgress', 'studioAssetRemovedExtras', 'studioAssetSurvivorFolder',
    ]) table[key] = call(key)
    return { language: new Proxy(table, { get: (target, key) => (typeof key === 'symbol' ? undefined : key in target ? target[key] : base[key]) }) }
})

import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import type { AssetSizeJob, StoredSize } from 'src/ts/studio/assets/assetSizes'
import { resetStudioToastsForTests, retireAssetToasts } from 'src/ts/studio/edit/studioToasts'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createToastHost, resetToastHostForTests, type ToastClock, type ToastHost } from 'src/ts/toast/toastHost.svelte'
import { ASSET_FOLDER_KEY } from '../../../ts/studio/assets/assetOwnerKeys'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from '../../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks } from '../../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../../ts/studio/history/tests/studioStoreDoubles'
import { assetRow } from '../../../ts/studio/assets/assetFixtures.test-helpers'
import type { FinderPort } from './StudioAssetFinder.svelte'
import StudioAssetList, { setSessionAssetSizeJobForTests, type EnabledModuleAssets } from './StudioAssetList.svelte'

interface LiveCharacter {
    chaId: string
    type: string
    desc: string
    alternateGreetings: string[]
    chats: { id: string; note: string; fmIndex?: number }[]
    chatPage: number
    additionalAssets: string[][]
    emotionImages: string[][]
    extentions: Record<string, unknown>
}

const A = characterOwnerKey('A')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

function makeCharacter(additionalAssets: string[][], extentions: Record<string, unknown> = {}): LiveCharacter {
    return { chaId: 'A', type: 'character', desc: 'd0', alternateGreetings: [], chats: [{ id: 'c1', note: '' }], chatPage: 0, additionalAssets, emotionImages: [], extentions }
}

// The list's own size job: the sizes it shows rows with, and the signals it was asked with.
function listJob(sizes: Record<string, number | null>, signals: AbortSignal[] = []): AssetSizeJob {
    const cache = new Map<string, number | null>()
    return {
        peek: (path) => cache.get(path),
        snapshot: (paths) => new Map<string, StoredSize>(paths.map((path) => [path, cache.get(path)])),
        ensure: async (paths, signal, onSettled) => {
            signals.push(signal)
            await Promise.resolve()
            for (const path of paths) {
                cache.set(path, sizes[path] ?? null)
                onSettled?.(path, cache.get(path) ?? null)
            }
            return true
        },
    }
}

interface Pass {
    rows: { name: string, path: string }[]
    signal: AbortSignal
}

interface PortRig {
    port: FinderPort
    passes: Pass[]
    loads: number
    release(): void
}

// The byte layer double: it reads each row's size from `sizes`, then waits at the gate while `hold` is set, then answers
// with the hash `bytes` gives each path (a path that is in `unreadable` fails instead). It keeps what it had finished
// when its signal aborts, as the real hash job does.
function makePort(config: { sizes: Record<string, number | null>, bytes: Record<string, string>, unreadable?: string[], hold?: boolean }): PortRig {
    const known = new Map<string, number | null>()
    const cache = new Map<string, string>()
    const passes: Pass[] = []
    let open: () => void = () => {}
    const gate = new Promise<void>((resolve) => { open = resolve })
    const rig: PortRig = {
        passes,
        loads: 0,
        release: () => open(),
        port: {
            sizes: {
                peek: (path) => known.get(path),
                snapshot: (paths) => new Map<string, StoredSize>(paths.map((path) => [path, known.get(path)])),
                ensure: async () => true,
            },
            hashCache: { get: (path) => cache.get(path) },
            async checkBytes(rows, signal, hooks) {
                passes.push({ rows: [...rows], signal })
                hooks.onPhase('sizes')
                for (const row of rows) known.set(row.path, config.sizes[row.path] ?? null)
                hooks.onPhase('hashing')
                hooks.onProgress('1.0', '2.0')
                if (config.hold === true) await gate
                const hashes = new Map<string, string>()
                const unreadable: string[] = []
                for (const row of rows) {
                    if (config.unreadable?.includes(row.path)) unreadable.push(row.path)
                    else if (config.bytes[row.path] !== undefined) {
                        hashes.set(row.path, config.bytes[row.path])
                        cache.set(row.path, config.bytes[row.path])
                    }
                }
                return { status: signal.aborted ? 'aborted' : 'done', hashes, unreadable }
            },
        },
    }
    return rig
}

let service: OwnerHistoryService
let toastHost: ToastHost
let mounted: { app: ReturnType<typeof mount>; host: HTMLElement }[] = []

async function settle(): Promise<void> {
    await drainMicrotasks()
    flushSync()
    await drainMicrotasks()
}

async function show(rig: PortRig, props: Record<string, unknown> = {}): Promise<void> {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const finderPort = async () => { rig.loads += 1; return rig.port }
    mounted.push({ app: mount(StudioAssetList, { target: host, props: { chaId: 'A', host: toastHost, finderPort, ...props } }), host })
    flushSync()
    await settle()
}

const parts = (name: string, from: ParentNode = document) => Array.from(from.querySelectorAll<HTMLElement>(`[data-part="${name}"]`))
const part = (name: string, from: ParentNode = document) => parts(name, from)[0]
const groupClasses = (from: ParentNode = document) => parts('studio-asset-dup-group', from).map((group) => group.dataset.class)
const rowNames = () => db.db.characters[0].additionalAssets.map((row) => `${row[0]}@${row[1]}`)

async function click(element: HTMLElement): Promise<void> {
    element.click()
    await settle()
}

async function openPanel(): Promise<void> {
    await click(part('studio-asset-find-duplicates'))
}

async function checkBytes(): Promise<void> {
    await click(part('studio-asset-check-bytes'))
}

beforeEach(async () => {
    h.marks = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    setSessionAssetSizeJobForTests(listJob({}))
    db.db.useAdditionalAssetsPreview = false
    db.db.characters = [makeCharacter([])]
    selection.selId = 0
    studioScreen.chaId = 'A'
    toastHost = createToastHost({ clock: { now: () => 0, after: () => () => {} } satisfies ToastClock })
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
    vi.restoreAllMocks()
    setSessionAssetSizeJobForTests(undefined)
    resetStudioToastsForTests()
    resetToastHostForTests()
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

describe('the panel', () => {
    test('is closed at first, opens on the button, and reads nothing until Check bytes is pressed', async () => {
        db.db.characters = [makeCharacter([assetRow('x', 'assets/a.png'), assetRow('x', 'assets/b.png')])]
        const rig = makePort({ sizes: {}, bytes: {} })
        await show(rig)
        expect(parts('studio-asset-dup-panel')).toHaveLength(0)
        expect(rig.loads).toBe(0)
        await openPanel()
        expect(parts('studio-asset-dup-panel')).toHaveLength(1)
        expect(rig.loads).toBe(0)
        await checkBytes()
        expect(rig.loads).toBe(1)
        expect(rig.passes).toHaveLength(1)
    })

    test('closes with its button and shows its progress and Cancel only while a pass runs', async () => {
        db.db.characters = [makeCharacter([assetRow('x', 'assets/a.png'), assetRow('x', 'assets/b.png')])]
        const rig = makePort({ sizes: { 'assets/a.png': 5, 'assets/b.png': 5 }, bytes: {}, hold: true })
        await show(rig)
        await openPanel()
        expect(parts('studio-asset-check-cancel')).toHaveLength(0)
        await checkBytes()
        expect(part('studio-asset-check-status').textContent).toBe('studioAssetCheckProgress(1.0,2.0)')
        expect(parts('studio-asset-check-bytes')).toHaveLength(0)
        expect(part('studio-asset-check-cancel')).toBeDefined()
        rig.release()
        await settle()
        expect(parts('studio-asset-check-cancel')).toHaveLength(0)
        expect(part('studio-asset-check-bytes')).toBeDefined()
        await click(part('studio-asset-dup-close'))
        expect(parts('studio-asset-dup-panel')).toHaveLength(0)
    })
})

describe('the groups', () => {
    test('one name over one stored path is the same file, and Remove extras is offered at once', async () => {
        db.db.characters = [makeCharacter([assetRow('x', 'assets/a.png'), assetRow('x', 'assets/a.png'), assetRow('y', 'assets/y.png')])]
        await show(makePort({ sizes: {}, bytes: {} }))
        await openPanel()
        expect(groupClasses()).toEqual(['sameFile'])
        expect(part('studio-asset-remove-extras')).toBeDefined()
    })

    test('one name and one known size over two paths is a possible duplicate and cannot be removed', async () => {
        db.db.characters = [makeCharacter([assetRow('x', 'assets/a.png'), assetRow('x', 'assets/b.png')])]
        setSessionAssetSizeJobForTests(listJob({ 'assets/a.png': 10, 'assets/b.png': 10 }))
        await show(makePort({ sizes: {}, bytes: {} }))
        await openPanel()
        expect(groupClasses()).toEqual(['possibleDuplicate'])
        expect(parts('studio-asset-remove-extras')).toHaveLength(0)
    })

    test('an unknown size says to use Check bytes', async () => {
        db.db.characters = [makeCharacter([assetRow('x', 'assets/a.png'), assetRow('x', 'assets/b.png')])]
        await show(makePort({ sizes: {}, bytes: {} }))
        await openPanel()
        expect(groupClasses()).toEqual(['sizeUnknown'])
        expect(part('studio-asset-dup-group').textContent).toContain('studioAssetDupSizeUnknown')
        expect(parts('studio-asset-remove-extras')).toHaveLength(0)
    })

    test('Check bytes turns equal bytes into the same file and different bytes into a note', async () => {
        db.db.characters = [makeCharacter([assetRow('x', 'assets/a.png'), assetRow('x', 'assets/b.png')])]
        setSessionAssetSizeJobForTests(listJob({ 'assets/a.png': 10, 'assets/b.png': 10 }))
        await show(makePort({ sizes: { 'assets/a.png': 10, 'assets/b.png': 10 }, bytes: { 'assets/a.png': 'h1', 'assets/b.png': 'h1' } }))
        await openPanel()
        await checkBytes()
        expect(groupClasses()).toEqual(['sameFile'])
        expect(part('studio-asset-remove-extras')).toBeDefined()
    })

    test('Check bytes with different bytes leaves the pair as two files of one name', async () => {
        db.db.characters = [makeCharacter([assetRow('x', 'assets/a.png'), assetRow('x', 'assets/b.png')])]
        setSessionAssetSizeJobForTests(listJob({ 'assets/a.png': 10, 'assets/b.png': 10 }))
        await show(makePort({ sizes: { 'assets/a.png': 10, 'assets/b.png': 10 }, bytes: { 'assets/a.png': 'h1', 'assets/b.png': 'h2' } }))
        await openPanel()
        await checkBytes()
        expect(groupClasses()).toEqual(['sameNameDifferentFile'])
        expect(parts('studio-asset-remove-extras')).toHaveLength(0)
    })

    test('different names over one stored path are a merge candidate, with a Merge button only when the merge stage gives one', async () => {
        db.db.characters = [makeCharacter([assetRow('x', 'assets/a.png'), assetRow('y', 'assets/a.png')])]
        await show(makePort({ sizes: {}, bytes: {} }))
        await openPanel()
        expect(groupClasses()).toEqual(['sameFileDifferentNames'])
        expect(parts('studio-asset-dup-merge')).toHaveLength(0)
        for (const entry of mounted.splice(0)) {
            await unmount(entry.app)
            entry.host.remove()
        }
        const merged: string[] = []
        await show(makePort({ sizes: {}, bytes: {} }), { onmerge: (group: { rows: { name: string }[] }) => merged.push(group.rows.map((row) => row.name).join('+')) })
        await openPanel()
        await click(part('studio-asset-dup-merge'))
        expect(merged).toEqual(['x+y'])
    })

    test('a file that cannot be read is marked, left out of the other groups and counted', async () => {
        db.db.characters = [makeCharacter([assetRow('x', 'assets/a.png'), assetRow('x', 'assets/b.png'), assetRow('x', 'assets/c.png')])]
        await show(makePort({ sizes: {}, bytes: { 'assets/a.png': 'h1', 'assets/b.png': 'h1' }, unreadable: ['assets/c.png'] }))
        await openPanel()
        await checkBytes()
        expect(groupClasses()).toContain('unreadable')
        expect(groupClasses()).toContain('sameFile')
        expect(part('studio-asset-dup-unreadable').textContent).toBe('studioAssetDupUnreadableCount(1)')
        const sameFile = parts('studio-asset-dup-group').find((group) => group.dataset.class === 'sameFile') as HTMLElement
        expect(sameFile.textContent).not.toContain('assets/c.png')
    })
})

describe('Remove extras', () => {
    async function removeFrom(rows: string[][], options: { extentions?: Record<string, unknown>, references?: (name: string, path: string) => number, bytes?: Record<string, string>, sizes?: Record<string, number> } = {}): Promise<void> {
        db.db.characters = [makeCharacter(rows, options.extentions)]
        const sizes = options.sizes ?? {}
        setSessionAssetSizeJobForTests(listJob(sizes))
        await show(makePort({ sizes, bytes: options.bytes ?? {} }), options.references ? { references: options.references } : {})
        await openPanel()
        if (options.bytes) await checkBytes()
        await click(part('studio-asset-remove-extras'))
    }

    test('keeps the first copy when nothing else decides, and is one step with a toast bound to it', async () => {
        const replay = vi.spyOn(service, 'replay')
        await removeFrom([assetRow('x', 'assets/a.png'), assetRow('x', 'assets/a.png'), assetRow('y', 'assets/y.png')])
        expect(rowNames()).toEqual(['x@assets/a.png', 'y@assets/y.png'])
        expect(service.view(A).done.map((step) => step.label)).toEqual([{ kind: 'assetRemoveExtras', count: 1, name: 'x' }])
        expect(toastHost.visible.map((toast) => [toast.text, toast.sub])).toEqual([['studioAssetRemovedExtras(1,x)', 'studioAssetSurvivorFirst']])
        await toastHost.activate(toastHost.visible[0].id)
        await settle()
        expect(replay.mock.calls[0][1]).toEqual({ kind: 'undo', expectTop: service.view(A).done[0]?.id ?? service.view(A).undone[0].id })
        expect(rowNames()).toHaveLength(3)
    })

    test('keeps the copy in a folder, and says which folder', async () => {
        const doc = { v: 1, additional: { order: ['Poses'], of: [['x', 'Poses']] } }
        await removeFrom([assetRow('x', 'assets/a.png'), assetRow('x', 'assets/a.png')], { extentions: { [ASSET_FOLDER_KEY]: doc } })
        expect(toastHost.visible[0].sub).toBe('studioAssetSurvivorFolder(Poses)')
        expect(rowNames()).toEqual(['x@assets/a.png'])
    })

    test('keeps the most-used copy when no folder decides, and removes the other', async () => {
        await removeFrom([assetRow('x', 'assets/a.png'), assetRow('x', 'assets/b.png')], {
            bytes: { 'assets/a.png': 'h1', 'assets/b.png': 'h1' },
            sizes: { 'assets/a.png': 10, 'assets/b.png': 10 },
            references: (_name, path) => (path === 'assets/b.png' ? 3 : 1),
        })
        expect(rowNames()).toEqual(['x@assets/b.png'])
        expect(toastHost.visible[0].sub).toBe('studioAssetSurvivorMostUsed')
    })

    test('lets a folder win over the most-used copy', async () => {
        const doc = { v: 1, additional: { order: ['Poses'], of: [['x', 'Poses']] } }
        await removeFrom([assetRow('x', 'assets/a.png'), assetRow('x', 'assets/b.png')], {
            extentions: { [ASSET_FOLDER_KEY]: doc },
            bytes: { 'assets/a.png': 'h1', 'assets/b.png': 'h1' },
            sizes: { 'assets/a.png': 10, 'assets/b.png': 10 },
            references: (_name, path) => (path === 'assets/b.png' ? 3 : 1),
        })
        expect(rowNames()).toEqual(['x@assets/a.png'])
        expect(toastHost.visible[0].sub).toBe('studioAssetSurvivorFolder(Poses)')
    })

    test('warns that older messages may show another picture when the name still has another file', async () => {
        await removeFrom([assetRow('x', 'assets/a.png'), assetRow('x', 'assets/a.png'), assetRow('x', 'assets/other.png')])
        expect(toastHost.visible[0].sub).toBe('studioAssetSurvivorFirst studioAssetPoolWarning')
        expect(rowNames()).toEqual(['x@assets/a.png', 'x@assets/other.png'])
    })

    test('is refused as a whole with the refusal shown and no row removed, while another tab holds the character', async () => {
        const claim = createClaimDouble()
        claim.forced = 'held'
        service = createOwnerHistoryService({ store: createMemoryStudioStore(), claim, clock: createFakeClock(), pageSession: 'p2', registerLeaveFlush: () => () => {}, onLanded: retireAssetToasts })
        setStudioHistoryServiceForTests(service)
        await service.whenReady(A)
        await removeFrom([assetRow('x', 'assets/a.png'), assetRow('x', 'assets/a.png')])
        expect(part('studio-asset-refusal').textContent).toBe('studioAssetRefusalOtherTabCharacter')
        expect(rowNames()).toHaveLength(2)
        expect(toastHost.visible).toHaveLength(0)
    })
})

describe('a pass in flight', () => {
    test('that is cancelled stops only Check bytes\' own work and keeps what it finished', async () => {
        db.db.characters = [makeCharacter([assetRow('x', 'assets/a.png'), assetRow('x', 'assets/b.png')])]
        const listSignals: AbortSignal[] = []
        setSessionAssetSizeJobForTests(listJob({ 'assets/a.png': 10, 'assets/b.png': 10 }, listSignals))
        const rig = makePort({ sizes: { 'assets/a.png': 10, 'assets/b.png': 10 }, bytes: { 'assets/a.png': 'h1', 'assets/b.png': 'h1' }, hold: true })
        await show(rig)
        await openPanel()
        await checkBytes()
        await click(part('studio-asset-check-cancel'))
        expect(rig.passes[0].signal.aborted).toBe(true)
        expect(listSignals.length).toBeGreaterThan(0)
        expect(listSignals.every((signal) => !signal.aborted)).toBe(true)
        rig.release()
        await settle()
        // The double finished both files before it saw the abort: those hashes are kept.
        expect(groupClasses()).toEqual(['sameFile'])
        expect(parts('studio-asset-check-cancel')).toHaveLength(0)
    })

    test('that is closed is aborted, and its late answer shows nowhere', async () => {
        db.db.characters = [makeCharacter([assetRow('x', 'assets/a.png'), assetRow('x', 'assets/b.png')])]
        const rig = makePort({ sizes: { 'assets/a.png': 10, 'assets/b.png': 10 }, bytes: { 'assets/a.png': 'h1', 'assets/b.png': 'h1' }, hold: true })
        await show(rig)
        await openPanel()
        await checkBytes()
        await click(part('studio-asset-dup-close'))
        expect(rig.passes[0].signal.aborted).toBe(true)
        rig.release()
        await settle()
        expect(parts('studio-asset-dup-panel')).toHaveLength(0)
        await openPanel()
        expect(groupClasses()).toEqual(['sizeUnknown'])
    })

    test('that outlives its list, as when the owner changes, is aborted and applies nothing', async () => {
        db.db.characters = [makeCharacter([assetRow('x', 'assets/a.png'), assetRow('x', 'assets/b.png')])]
        const rig = makePort({ sizes: { 'assets/a.png': 10, 'assets/b.png': 10 }, bytes: { 'assets/a.png': 'h1', 'assets/b.png': 'h1' }, hold: true })
        await show(rig)
        await openPanel()
        await checkBytes()
        const errors: unknown[] = []
        const onError = (event: ErrorEvent) => errors.push(event.error)
        window.addEventListener('error', onError)
        for (const entry of mounted.splice(0)) {
            await unmount(entry.app)
            entry.host.remove()
        }
        expect(rig.passes[0].signal.aborted).toBe(true)
        rig.release()
        await settle()
        window.removeEventListener('error', onError)
        expect(errors).toEqual([])
        // A list built again for the next owner starts with no result from the old pass.
        await show(rig)
        await openPanel()
        expect(groupClasses()).toEqual(['sizeUnknown'])
    })

    test('that meets rows that changed makes nothing removable that no longer is one', async () => {
        db.db.characters = [makeCharacter([assetRow('x', 'assets/a.png'), assetRow('x', 'assets/b.png'), assetRow('x', 'assets/c.png')])]
        const sizes = { 'assets/a.png': 10, 'assets/b.png': 10, 'assets/c.png': 10 }
        setSessionAssetSizeJobForTests(listJob(sizes))
        const rig = makePort({ sizes, bytes: { 'assets/a.png': 'h1', 'assets/b.png': 'h1', 'assets/c.png': 'h2' }, hold: true })
        await show(rig)
        await openPanel()
        await checkBytes()
        // While the pass reads: the row that held the second file goes, and the first row takes a name of its own.
        expect(service.assetDelete(A, 'additionalAssets', [1]).ok).toBe(true)
        expect(service.assetRename(A, 'additionalAssets', 0, 'z').ok).toBe(true)
        await settle()
        rig.release()
        await settle()
        expect(parts('studio-asset-remove-extras')).toHaveLength(0)
        expect(groupClasses()).not.toContain('sameFile')
    })

    test('that meets the loss of a row leaves the remaining pair removable only if its own bytes match', async () => {
        db.db.characters = [makeCharacter([assetRow('x', 'assets/a.png'), assetRow('x', 'assets/b.png'), assetRow('x', 'assets/c.png')])]
        const sizes = { 'assets/a.png': 10, 'assets/b.png': 10, 'assets/c.png': 10 }
        setSessionAssetSizeJobForTests(listJob(sizes))
        const rig = makePort({ sizes, bytes: { 'assets/a.png': 'h1', 'assets/b.png': 'h1', 'assets/c.png': 'h2' }, hold: true })
        await show(rig)
        await openPanel()
        await checkBytes()
        expect(service.assetDelete(A, 'additionalAssets', [1]).ok).toBe(true)
        await settle()
        rig.release()
        await settle()
        // a and c remain and their bytes differ: the pair is two files of one name, and nothing is offered for removal.
        expect(groupClasses()).toEqual(['sameNameDifferentFile'])
        expect(parts('studio-asset-remove-extras')).toHaveLength(0)
    })
})

describe('the enabled modules', () => {
    const modules = (): EnabledModuleAssets[] => [
        { id: 'm1', name: 'First pack', assets: [['p', 'assets/p.png', 'png'], ['p', 'assets/p.png', 'png']] },
        { id: 'm2', name: 'Second pack', assets: [['q', 'assets/q.png', 'png']] },
    ]

    test('are left out until the switch is on, then follow the owner in module order, report only', async () => {
        db.db.characters = [makeCharacter([assetRow('x', 'assets/a.png'), assetRow('x', 'assets/a.png')])]
        await show(makePort({ sizes: {}, bytes: {} }), { enabledModules: modules })
        await openPanel()
        expect(parts('studio-asset-dup-array').map((array) => array.dataset.array)).toEqual(['additionalAssets'])
        await click(part('studio-asset-dup-modules'))
        expect(parts('studio-asset-dup-array').map((array) => array.dataset.array)).toEqual(['additionalAssets', 'module:m1', 'module:m2'])
        const first = parts('studio-asset-dup-array')[1]
        expect(first.textContent).toContain('First pack')
        expect(first.textContent).toContain('studioAssetDupReportOnly')
        expect(groupClasses(first)).toEqual(['sameFile'])
        // The module's identical rows show, and the only Remove extras button is the owner's own.
        expect(parts('studio-asset-remove-extras')).toHaveLength(1)
        expect(parts('studio-asset-remove-extras', parts('studio-asset-dup-array')[0])).toHaveLength(1)
    })

    test('have no switch while the list is given no module port', async () => {
        db.db.characters = [makeCharacter([assetRow('x', 'assets/a.png')])]
        await show(makePort({ sizes: {}, bytes: {} }))
        await openPanel()
        expect(parts('studio-asset-dup-modules')).toHaveLength(0)
    })
})
