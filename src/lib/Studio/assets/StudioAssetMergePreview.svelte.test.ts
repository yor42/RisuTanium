// @vitest-environment jsdom
/**
 * The merge preview over the real history service on the memory doubles: what it lists, what Merge writes, and the
 * guarantee at the click. Models come from `buildMergePreview` over the live character (the producer); the counts are
 * held doubles so a test decides when they end. Feature guards: none of this exists at the stage's base.
 *
 * Labels: G = guard. The early "Out of date" check (T48) and the click-time rebuild (T48c) are separate rows: T48c
 * forces the early check to "fresh", so only the rebuild and compare can refuse.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))

const db = $state({ db: { characters: [] as LiveCharacter[], modules: [] as unknown[], useAdditionalAssetsPreview: false } })
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
    const table: Record<string, unknown> = {}
    for (const key of [
        'studioAssetMergeTitle', 'studioAssetMergeAlreadyShows', 'studioAssetMergeModuleExact', 'studioAssetMergeChats',
        'studioAssetMergeArchivedChats', 'studioAssetMergeCharacters', 'studioAssetMergeArchivedCharacters', 'studioAssetMergeFolder',
        'studioAssetMergeAtLeast', 'studioAssetMergePartialName', 'studioAssetMergeConfirmHit', 'studioAssetMergeConfirmUnfinished',
        'studioStepAssetMerge', 'studioAssetPlaceNumbered', 'studioAssetPlaceAltFirstMessage', 'studioAssetPlaceTriggerEffect',
        'studioAssetPlaceTriggerCondition', 'studioAssetNotRestored',
    ]) table[key] = call(key)
    return { language: new Proxy(table, { get: (target, key) => (typeof key === 'symbol' ? undefined : key in target ? target[key] : base[key]) }) }
})

import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { ASSET_FOLDER_KEY } from 'src/ts/studio/assets/assetOwnerKeys'
import { assetRow, DEFAULT_SETTINGS } from 'src/ts/studio/assets/assetFixtures.test-helpers'
import { groupDuplicates, type DuplicateGroup } from 'src/ts/studio/assets/duplicateGroups'
import type { MergeSource } from 'src/ts/studio/assets/mergeCommit'
import type { ChatCountResult, EnablingCountResult } from 'src/ts/studio/assets/mergeCounts'
import { buildMergePreview, type MergePreview } from 'src/ts/studio/assets/mergePreview'
import type { SurvivorDeps } from 'src/ts/studio/edit/assetSetters'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService, type OwnerHistoryService, type StudioResult } from '../../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey, moduleOwnerKey } from '../../../ts/studio/history/ownerPhase'
import { createFakeClock, drainMicrotasks } from '../../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../../ts/studio/history/tests/studioStoreDoubles'
import type { FinderRow } from './StudioAssetFinder.svelte'
import StudioAssetMergePreview, { setMergeStaleForcedFreshForTests } from './StudioAssetMergePreview.svelte'

type Row = [string, string, string]

interface LiveCharacter {
    chaId: string
    type: string
    desc: string
    exampleMessage: string
    alternateGreetings: string[]
    globalLore: { key: string, content: string }[]
    chats: { id: string, note: string, message?: { data: string }[] }[]
    chatPage: number
    additionalAssets: Row[]
    emotionImages: Row[]
    extentions: Record<string, unknown>
}

interface LiveModule {
    id: string
    name: string
    namespace?: string
    assets: Row[]
    lorebook: { key: string, content: string }[]
}

const A = characterOwnerKey('A')
const M = moduleOwnerKey('m1')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
const byPathOnly: SurvivorDeps = { hashOf: () => undefined }

// The same file under `smile` and `grin`, and a file of its own.
const rowsOf = (): Row[] => [assetRow('smile', 'assets/a.png'), assetRow('grin', 'assets/a.png'), assetRow('other', 'assets/o.png')]

function makeCharacter(over: Partial<LiveCharacter> = {}): LiveCharacter {
    return {
        chaId: 'A', type: 'character', desc: 'a {{image::grin}} b', exampleMessage: 'ex', alternateGreetings: [],
        globalLore: [], chats: [{ id: 'c1', note: '' }], chatPage: 0, additionalAssets: rowsOf(), emotionImages: [], extentions: {},
        ...over,
    }
}

function makeModule(over: Partial<LiveModule> = {}): LiveModule {
    return { id: 'm1', name: 'Mod', namespace: 'ns', assets: rowsOf(), lorebook: [{ key: 'k', content: 'x {{image::grin}}' }], ...over }
}

const live = (): LiveCharacter => db.db.characters[0]
const liveModule = (): LiveModule => db.db.modules[0] as LiveModule

function groupOf(rows: readonly (readonly string[])[]): DuplicateGroup<FinderRow> {
    const group = groupDuplicates(rows.map((row, index): FinderRow => ({ name: row[0], path: row[1], index, folder: null })))
        .find((candidate) => candidate.cls === 'sameFileDifferentNames')
    if (!group) throw new Error('no candidate group')
    return group
}

interface Held<T> {
    promise: Promise<T>
    resolve(value: T): void
}

function held<T>(): Held<T> {
    let resolve: (value: T) => void = () => {}
    const promise = new Promise<T>((done) => { resolve = done })
    return { promise, resolve }
}

const doneChats = (over: Partial<ChatCountResult> = {}): ChatCountResult => ({ state: 'done', chats: 0, archivedChats: 0, ...over })
const doneCharacters = (over: Partial<EnablingCountResult> = {}): EnablingCountResult => ({ state: 'done', characters: [], archivedCharacters: 0, ...over })

interface Rig {
    service: OwnerHistoryService
    posted: unknown[][]
    closed: number
    signals: AbortSignal[]
    chatCounts: Held<ChatCountResult>[]
    characterCounts: Held<EnablingCountResult>[]
    // The progress callback each count job was started with, in start order.
    chatProgress: ((partial: ChatCountResult) => void)[]
    characterProgress: ((partial: EnablingCountResult) => void)[]
    source: MergeSource
}

let rig: Rig
let mounted: { app: ReturnType<typeof mount>, host: HTMLElement }[] = []

function characterSource(): MergeSource {
    return {
        targetOwner: () => ({ kind: 'character', source: live() }),
        modules: () => [],
        settings: () => DEFAULT_SETTINGS,
        // Held until the test resolves it; the signal is kept so an abort can be seen.
        countChats: (_query, signal, onProgress) => {
            rig.signals.push(signal)
            if (onProgress) rig.chatProgress.push(onProgress)
            const next = held<ChatCountResult>()
            rig.chatCounts.push(next)
            return next.promise
        },
        countCharacters: async () => doneCharacters(),
        enabledEverywhere: () => false,
        characterName: (id) => id,
    }
}

function moduleSource(): MergeSource {
    return {
        targetOwner: () => ({ kind: 'module', source: liveModule() }),
        modules: () => [],
        settings: () => DEFAULT_SETTINGS,
        countChats: async () => doneChats(),
        countCharacters: (_query, signal, onProgress) => {
            rig.signals.push(signal)
            if (onProgress) rig.characterProgress.push(onProgress)
            const next = held<EnablingCountResult>()
            rig.characterCounts.push(next)
            return next.promise
        },
        enabledEverywhere: () => false,
        characterName: (id) => `name-${id}`,
    }
}

async function settle(): Promise<void> {
    await drainMicrotasks()
    flushSync()
    await drainMicrotasks()
}

const parts = (name: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-part="${name}"]`))
const part = (name: string) => parts(name)[0]
const textOf = (name: string) => part(name)?.textContent?.trim() ?? null
const mergeButton = () => part('studio-asset-merge-do') as HTMLButtonElement

async function click(element: HTMLElement): Promise<void> {
    element.click()
    await settle()
}

interface ShowOptions {
    owner?: ReturnType<typeof characterOwnerKey>
    ownerKind?: 'character' | 'module'
    ownerId?: string
    group?: DuplicateGroup<FinderRow>
    service?: Pick<OwnerHistoryService, 'assetMerge'>
    source?: MergeSource
    references?: (name: string, path: string) => number
}

async function show(options: ShowOptions = {}): Promise<void> {
    const host = document.createElement('div')
    document.body.appendChild(host)
    mounted.push({
        host,
        app: mount(StudioAssetMergePreview, {
            target: host,
            props: {
                owner: options.owner ?? A,
                ownerKind: options.ownerKind ?? 'character',
                ownerId: options.ownerId ?? 'A',
                kind: 'asset',
                group: options.group ?? groupOf(rowsOf()),
                deps: byPathOnly,
                service: options.service ?? rig.service,
                toasts: { postAssetAction: (...args: unknown[]) => { rig.posted.push(args); return 1 } },
                source: options.source ?? rig.source,
                // Most rows decide the kept name through a host count that keeps `smile`; a row that passes
                // `references: undefined` opens the preview as production does, counting the owner's own texts.
                references: 'references' in options ? options.references : (name: string) => (name === 'smile' ? 1 : 0),
                onclose: () => { rig.closed += 1 },
            },
        }),
    })
    flushSync()
    await settle()
}

beforeEach(async () => {
    h.marks = 0
    tracker.character.length = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    db.db.characters = [makeCharacter()]
    db.db.modules = [makeModule()]
    selection.selId = 0
    studioScreen.chaId = 'A'
    const service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock: createFakeClock(),
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
        openModuleId: () => null,
    })
    rig = { service, posted: [], closed: 0, signals: [], chatCounts: [], characterCounts: [], chatProgress: [], characterProgress: [], source: undefined as never }
    rig.source = characterSource()
    await service.whenReady(A)
})

afterEach(async () => {
    setMergeStaleForcedFreshForTests(false)
    for (const entry of mounted.splice(0)) {
        await unmount(entry.app)
        entry.host.remove()
    }
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

// What the live character holds, as plain data, for "nothing was written" checks.
const liveSnapshot = () => $state.snapshot(live())
const stepCount = () => rig.service.view(A).done.length

describe('what the preview shows', () => {
    test('opens with Cancel focused and the title naming the removed and the kept name', async () => {
        await show()
        expect(textOf('studio-asset-merge-do')).toBe('studioAssetMerge')
        expect(document.activeElement).toBe(part('studio-asset-merge-cancel'))
        expect(part('studio-asset-merge-preview').querySelector('h3')?.textContent).toBe('studioAssetMergeTitle(grin,smile)')
    })

    test('keeps the most-referenced name by default, and a kept-name choice rebuilds the model and restarts the counts', async () => {
        await show({ references: (name) => (name === 'grin' ? 5 : 1) })
        expect(part('studio-asset-merge-preview').querySelector('h3')?.textContent).toBe('studioAssetMergeTitle(smile,grin)')
        const first = rig.signals[0]
        const select = part('studio-asset-merge-keep') as HTMLSelectElement
        select.value = 'smile'
        select.dispatchEvent(new Event('change', { bubbles: true }))
        await settle()
        expect(part('studio-asset-merge-preview').querySelector('h3')?.textContent).toBe('studioAssetMergeTitle(grin,smile)')
        expect(first.aborted).toBe(true)
        expect(rig.signals).toHaveLength(2)
        expect(rig.signals[1].aborted).toBe(false)
    })

    test('lists the rewrites grouped by place with their counts, the partial-name line and the folder outcome', async () => {
        db.db.characters = [makeCharacter({
            desc: 'a {{image::grin}} b {{image::grin}}',
            globalLore: [{ key: 'k', content: 'x {{img::grin}}' }],
            additionalAssets: [...rowsOf(), assetRow('grin', 'assets/b.png')],
            extentions: { [ASSET_FOLDER_KEY]: { v: 1, additional: { order: ['Faces'], of: [['smile', 'Faces']] } } },
        })]
        await show({ group: groupOf(live().additionalAssets) })
        const rewritten = part('studio-asset-merge-section')
        expect(rewritten.dataset.section).toBe('rewritten')
        const places = parts('studio-asset-merge-place').map((place) => [place.dataset.path, place.textContent])
        expect(places[0][0]).toBe('desc')
        expect(places[0][1]).toContain('description · 2')
        expect(places[1][0]).toBe('lore/0/content')
        expect(places[1][1]).toContain('studioAssetPlaceNumbered(loreBook,1) · 1')
        expect(parts('studio-asset-merge-hit').map((hit) => hit.textContent)).toEqual(['grin → smile', 'grin → smile', 'grin → smile'])
        expect(textOf('studio-asset-merge-partial')).toBe('studioAssetMergePartialName(grin,1,smile)')
        expect(textOf('studio-asset-merge-folder')).toBe('studioAssetMergeFolder(Faces)')
    })

    test('the chat count fills in: "at least" while it runs, the number when it ends, and the archived chats', async () => {
        await show()
        expect(textOf('studio-asset-merge-chats')).toBe('studioAssetMergeChats(studioAssetMergeAtLeast(0),grin)')
        rig.chatCounts[0].resolve(doneChats({ chats: 3, archivedChats: 2 }))
        await settle()
        expect(textOf('studio-asset-merge-chats')).toBe('studioAssetMergeChats(3,grin)')
        expect(textOf('studio-asset-merge-archived')).toBe('studioAssetMergeArchivedChats(2)')
    })

    test('a count that did not finish stays "at least"', async () => {
        await show()
        rig.chatCounts[0].resolve({ state: 'failed', chats: 1, archivedChats: 0 })
        await settle()
        expect(textOf('studio-asset-merge-chats')).toBe('studioAssetMergeChats(studioAssetMergeAtLeast(1),grin)')
    })

    test('a count that ends with no chat and none archived says nothing', async () => {
        await show()
        rig.chatCounts[0].resolve(doneChats())
        await settle()
        expect(parts('studio-asset-merge-chats')).toHaveLength(0)
        expect(parts('studio-asset-merge-archived')).toHaveLength(0)
    })
})

describe('Merge', () => {
    test('lands one step with the rows, the text and one mark, posts the toast with the chat line and closes', async () => {
        await show()
        rig.chatCounts[0].resolve(doneChats({ chats: 2, archivedChats: 1 }))
        await settle()
        const marksBefore = h.marks
        await click(mergeButton())
        expect(live().additionalAssets).toEqual([assetRow('smile', 'assets/a.png'), assetRow('other', 'assets/o.png')])
        expect(live().desc).toBe('a {{image::smile}} b')
        expect(h.marks).toBe(marksBefore + 1)
        expect(stepCount()).toBe(1)
        const step = rig.service.view(A).done[0]
        expect(rig.posted).toEqual([[A, step.id, 'studioStepAssetMerge(grin,smile)', 'studioAssetMergeChats(2,grin) studioAssetMergeArchivedChats(1)']])
        expect(rig.closed).toBe(1)
        expect(rig.signals[0].aborted).toBe(true)
    })

    test('before the count ends the toast says "at least n", and the count is cancelled', async () => {
        await show()
        await click(mergeButton())
        expect(rig.posted[0][3]).toBe('studioAssetMergeChats(studioAssetMergeAtLeast(0),grin)')
        expect(rig.signals[0].aborted).toBe(true)
    })

    test('a refusal shows its text and keeps the preview open and the owner as it was', async () => {
        const before = liveSnapshot()
        const refusing = { assetMerge: (): StudioResult => ({ ok: false, reason: 'precondition' }) }
        await show({ service: refusing })
        await click(mergeButton())
        expect(textOf('studio-asset-merge-refusal')).toBe('studioRefusalPrecondition')
        expect(rig.closed).toBe(0)
        expect(rig.posted).toEqual([])
        expect(liveSnapshot()).toEqual(before)
    })

    test('Cancel closes and cancels the counts, and changes nothing', async () => {
        const before = liveSnapshot()
        await show()
        await click(part('studio-asset-merge-cancel'))
        expect(rig.closed).toBe(1)
        expect(rig.signals[0].aborted).toBe(true)
        expect(liveSnapshot()).toEqual(before)
        expect(stepCount()).toBe(0)
    })
})

describe('T48: the early check disables Merge when what Merge would do has changed, until Refresh', () => {
    // Each change is made to the owner after the preview opened. `outside` rows write the live owner as another tab or the
    // history does; `service` rows go through the service.
    const changes: [string, () => void][] = [
        ['an edit of another field', () => { live().exampleMessage = 'changed' }],
        ['a row change', () => { live().additionalAssets.push(assetRow('x', 'assets/x.png')) }],
        ['another tab replacing the character', () => { db.db.characters[0] = makeCharacter({ desc: 'other {{image::grin}}' }) }],
        ['a lore entry appended with every scanned string unchanged', () => { live().globalLore.push({ key: 'k', content: '' }) }],
        ['a lore entry removed', () => { live().globalLore.pop() }],
        ['two lore entries swapped', () => { live().globalLore.reverse() }],
        ['a folder-document-only change', () => { live().extentions[ASSET_FOLDER_KEY] = { v: 1, additional: { order: ['F'], of: [] } } }],
    ]

    test.each(changes)('%s', async (_name, change) => {
        db.db.characters = [makeCharacter({ globalLore: [{ key: 'a', content: 'one' }, { key: 'b', content: 'two' }] })]
        await show()
        expect(parts('studio-asset-merge-stale')).toHaveLength(0)
        expect(mergeButton().disabled).toBe(false)
        change()
        await settle()
        expect(textOf('studio-asset-merge-stale')).toBe('studioAssetMergeStale')
        expect(mergeButton().disabled).toBe(true)
        await click(part('studio-asset-merge-refresh'))
        expect(parts('studio-asset-merge-stale')).toHaveLength(0)
        expect(mergeButton().disabled).toBe(false)
    })

    test('an undo of a row rename and the undo of a folder move each disable it', async () => {
        expect(rig.service.assetRename(A, 'additionalAssets', 2, 'other2').ok).toBe(true)
        await show()
        expect(rig.service.undo(A).ok).toBe(true)
        await settle()
        expect(textOf('studio-asset-merge-stale')).toBe('studioAssetMergeStale')
        expect(mergeButton().disabled).toBe(true)
        await click(part('studio-asset-merge-refresh'))
        expect(mergeButton().disabled).toBe(false)

        expect(rig.service.assetFolder(A, { kind: 'create', name: 'Faces' }).ok).toBe(true)
        expect(rig.service.assetFolder(A, { kind: 'move', names: ['smile'], folder: 'Faces' }).ok).toBe(true)
        await settle()
        expect(textOf('studio-asset-merge-stale')).toBe('studioAssetMergeStale')
        await click(part('studio-asset-merge-refresh'))
        expect(rig.service.undo(A).ok).toBe(true)
        await settle()
        expect(textOf('studio-asset-merge-stale')).toBe('studioAssetMergeStale')
        expect(mergeButton().disabled).toBe(true)
    })

    test('Refresh rebuilds the model from the owner as it is and restarts the counts', async () => {
        await show()
        live().desc = 'x {{image::grin}} y {{image::grin}}'
        await settle()
        const signal = rig.signals[0]
        await click(part('studio-asset-merge-refresh'))
        expect(signal.aborted).toBe(true)
        expect(rig.signals).toHaveLength(2)
        await click(mergeButton())
        expect(live().desc).toBe('x {{image::smile}} y {{image::smile}}')
    })
})

describe('T48c: the click-time rebuild decides, with the early check forced to fresh', () => {
    beforeEach(() => { setMergeStaleForcedFreshForTests(true) })

    // Each change is made synchronously, then the click runs before any flush.
    const changes: [string, () => void][] = [
        ['a folder move', () => { live().extentions[ASSET_FOLDER_KEY] = { v: 1, additional: { order: ['F'], of: [['smile', 'F']] } } }],
        ['an appended entry with the old name', () => { live().globalLore.push({ key: 'k', content: '{{image::grin}}' }) }],
        ['a row change', () => { live().additionalAssets.push(assetRow('grin', 'assets/b.png')) }],
        ['a new flagged reference', () => { (live() as LiveCharacter & { defaultVariables?: string }).defaultVariables = 'mood=grin' }],
    ]

    test.each(changes)('%s: nothing is written, no step, no mark, and "Out of date" is shown', async (_name, change) => {
        await show()
        expect(parts('studio-asset-merge-stale')).toHaveLength(0)
        change()
        const before = liveSnapshot()
        const marks = h.marks
        mergeButton().click()
        flushSync()
        expect(liveSnapshot()).toEqual(before)
        expect(stepCount()).toBe(0)
        expect(h.marks).toBe(marks)
        expect(rig.posted).toEqual([])
        expect(rig.closed).toBe(0)
        await settle()
        expect(textOf('studio-asset-merge-stale')).toBe('studioAssetMergeStale')
        expect(mergeButton().disabled).toBe(true)
    })

    test('Refresh after a refused click shows the model as it is and lets Merge write it', async () => {
        await show()
        live().globalLore.push({ key: 'k', content: '{{image::grin}}' })
        mergeButton().click()
        flushSync()
        await settle()
        expect(mergeButton().disabled).toBe(true)
        await click(part('studio-asset-merge-refresh'))
        expect(parts('studio-asset-merge-stale')).toHaveLength(0)
        expect(mergeButton().disabled).toBe(false)
        await click(mergeButton())
        expect(live().globalLore[0].content).toBe('{{image::smile}}')
        expect(live().desc).toBe('a {{image::smile}} b')
        expect(stepCount()).toBe(1)
    })

    test('no change: the applied step holds exactly the ops the preview showed', async () => {
        await show()
        await click(mergeButton())
        const step = rig.service.view(A).done[0]
        expect(step.ops).toEqual([
            { op: 'assetRowRemove', array: 'additionalAssets', index: 1, tuple: ['grin', 'assets/a.png', 'png'], count: 1 },
            { op: 'textEdit', target: 'desc', offset: 11, from: 'grin', to: 'smile' },
        ])
        expect(rig.closed).toBe(1)
    })

    test('a refusal of the setter after a successful compare is shown, with nothing written', async () => {
        const refusing = { assetMerge: vi.fn((): StudioResult => ({ ok: false, reason: 'precondition' })) }
        await show({ service: refusing })
        await click(mergeButton())
        expect(refusing.assetMerge).toHaveBeenCalledTimes(1)
        expect(textOf('studio-asset-merge-refusal')).toBe('studioRefusalPrecondition')
    })
})

describe('T57c: the preview belongs to the owner and kind it was opened for', () => {
    async function showReactive(): Promise<{ props: { owner: string, kind: string } }> {
        const host = document.createElement('div')
        document.body.appendChild(host)
        const props = $state({
            owner: A as string,
            ownerKind: 'character' as const,
            ownerId: 'A',
            kind: 'asset' as string,
            group: groupOf(rowsOf()),
            deps: byPathOnly,
            service: rig.service,
            toasts: { postAssetAction: (...args: unknown[]) => { rig.posted.push(args); return 1 } },
            source: rig.source,
            onclose: () => { rig.closed += 1 },
        })
        mounted.push({ host, app: mount(StudioAssetMergePreview, { target: host, props: props as never }) })
        flushSync()
        await settle()
        return { props }
    }

    test('an owner switch closes it and cancels the counts', async () => {
        const { props } = await showReactive()
        expect(rig.closed).toBe(0)
        props.owner = characterOwnerKey('B')
        flushSync()
        expect(rig.closed).toBe(1)
        expect(rig.signals[0].aborted).toBe(true)
    })

    test('a kind switch closes it and cancels the counts', async () => {
        const { props } = await showReactive()
        props.kind = 'emotion'
        flushSync()
        expect(rig.closed).toBe(1)
        expect(rig.signals[0].aborted).toBe(true)
    })

    test('while it stays on its owner and kind it does not close', async () => {
        const { props } = await showReactive()
        props.owner = A
        flushSync()
        expect(rig.closed).toBe(0)
    })
})

describe('T47: the first 50 hits of a section show, the rest behind Show more, each place with a jump', () => {
    function lore(count: number): { key: string, content: string }[] {
        return Array.from({ length: count }, (_, i) => ({ key: 'k' + i, content: `{{image::grin}} ${i}` }))
    }

    test('51 hits: 50 shown, then "Show more" shows the last one', async () => {
        db.db.characters = [makeCharacter({ desc: 'plain', globalLore: lore(51) })]
        await show()
        expect(parts('studio-asset-merge-hit')).toHaveLength(50)
        expect(textOf('studio-asset-merge-more')).toBe('studioShowMore(1)')
        await click(part('studio-asset-merge-more'))
        expect(parts('studio-asset-merge-hit')).toHaveLength(51)
        expect(parts('studio-asset-merge-more')).toHaveLength(0)
    })

    test('50 hits show no Show more', async () => {
        db.db.characters = [makeCharacter({ desc: 'plain', globalLore: lore(50) })]
        await show()
        expect(parts('studio-asset-merge-hit')).toHaveLength(50)
        expect(parts('studio-asset-merge-more')).toHaveLength(0)
    })

    test('the jump selects the target in the Studio tree and closes the preview', async () => {
        db.db.characters = [makeCharacter({ desc: 'plain', globalLore: lore(3) })]
        await show()
        const second = parts('studio-asset-merge-place')[1]
        await click(second.querySelector<HTMLElement>('[data-part="studio-asset-merge-goto"]') as HTMLElement)
        expect(studioScreen.selectedOwnerKey).toBe('character:A')
        expect(studioScreen.selectedKind).toBe('lore')
        expect(studioScreen.selectedItemId).toBe('A/lore:1')
        expect(rig.closed).toBe(1)
        expect(rig.signals[0].aborted).toBe(true)
    })

    test('a place in the description jumps to the basic item', async () => {
        await show()
        await click(parts('studio-asset-merge-goto')[0])
        expect(studioScreen.selectedKind).toBe('basic')
        expect(studioScreen.selectedItemId).toBe('A/basic:0')
    })
})

describe('the chat count is progressive, and only the running job lands', () => {
    const atLeast = (n: number) => `studioAssetMergeChats(studioAssetMergeAtLeast(${n}),grin)`
    const running = (chats: number): ChatCountResult => ({ state: 'running', chats, archivedChats: 0 })

    test('R-E1: partial figures replace "at least 0" and rise with each report, and the end replaces them', async () => {
        await show()
        expect(textOf('studio-asset-merge-chats')).toBe(atLeast(0))
        rig.chatProgress[0](running(2))
        await settle()
        expect(textOf('studio-asset-merge-chats')).toBe(atLeast(2))
        rig.chatProgress[0](running(4))
        await settle()
        expect(textOf('studio-asset-merge-chats')).toBe(atLeast(4))
        rig.chatCounts[0].resolve(doneChats({ chats: 5 }))
        await settle()
        expect(textOf('studio-asset-merge-chats')).toBe('studioAssetMergeChats(5,grin)')
    })

    test('R-E1b: the toast pressed while the count runs says "at least" the figure reached', async () => {
        await show()
        rig.chatProgress[0](running(3))
        await settle()
        await click(mergeButton())
        expect(rig.posted[0][3]).toBe(atLeast(3))
    })

    test('R-E1c: a partial of a job that Refresh replaced, or that was aborted, lands nothing', async () => {
        await show()
        rig.chatProgress[0](running(1))
        await settle()
        expect(textOf('studio-asset-merge-chats')).toBe(atLeast(1))
        live().desc = 'x {{image::grin}} y {{image::grin}}'
        await settle()
        await click(part('studio-asset-merge-refresh'))
        expect(rig.signals[0].aborted).toBe(true)
        expect(textOf('studio-asset-merge-chats')).toBe(atLeast(0))

        rig.chatProgress[0](running(99))
        rig.chatCounts[0].resolve(doneChats({ chats: 98 }))
        await settle()
        expect(textOf('studio-asset-merge-chats')).toBe(atLeast(0))

        rig.chatProgress[1](running(2))
        await settle()
        expect(textOf('studio-asset-merge-chats')).toBe(atLeast(2))
    })

    test('R-E1d: nothing lands after the preview closed', async () => {
        await show()
        await click(part('studio-asset-merge-cancel'))
        expect(rig.signals[0].aborted).toBe(true)
        rig.chatProgress[0](running(7))
        await settle()
        expect(rig.closed).toBe(1)
        expect(parts('studio-asset-merge-chats').every((line) => !line.textContent?.includes('7'))).toBe(true)
    })

    test('R-E2: opened as production opens it, without host counts, the name more places use is kept', async () => {
        db.db.characters = [makeCharacter({ desc: 'a {{image::grin}} b {{image::smile}}', globalLore: [{ key: 'k', content: '{{image::grin}} {{img::grin}}' }] })]
        await show({ references: undefined })
        expect(part('studio-asset-merge-preview').querySelector('h3')?.textContent).toBe('studioAssetMergeTitle(smile,grin)')
        const select = part('studio-asset-merge-keep') as HTMLSelectElement
        expect(select.value).toBe('grin')
    })

    test('R-E2b: with the first name used more, it is kept; with no use at all the first name stays', async () => {
        db.db.characters = [makeCharacter({ desc: '{{image::smile}} {{image::smile}} {{image::grin}}' })]
        await show({ references: undefined })
        expect(part('studio-asset-merge-preview').querySelector('h3')?.textContent).toBe('studioAssetMergeTitle(grin,smile)')
        for (const entry of mounted.splice(0)) {
            await unmount(entry.app)
            entry.host.remove()
        }
        db.db.characters = [makeCharacter({ desc: 'plain' })]
        await show({ references: undefined })
        expect(part('studio-asset-merge-preview').querySelector('h3')?.textContent).toBe('studioAssetMergeTitle(grin,smile)')
    })
})

describe('a module owner: the confirm (T41) and the click-time rebuild of Merge anyway', () => {
    function moduleService(): { service: Pick<OwnerHistoryService, 'assetMerge'>, merged: MergePreview[] } {
        const merged: MergePreview[] = []
        return { merged, service: { assetMerge: (_owner, model): StudioResult => { merged.push(model); return { ok: true, stepId: 's1' } } } }
    }

    async function showModule(over: ShowOptions = {}): Promise<ReturnType<typeof moduleService>> {
        const rigged = moduleService()
        rig.source = moduleSource()
        await show({ owner: M, ownerKind: 'module', ownerId: 'm1', service: rigged.service, ...over })
        return rigged
    }

    const hit = { chaId: 'c1', textHits: 1, chatHits: 1, archivedChats: 0 }

    test('a character whose text uses the old name opens the confirm, naming it with its count and the lookalike warning', async () => {
        const { merged } = await showModule()
        rig.characterCounts[0].resolve(doneCharacters({ characters: [hit] }))
        await settle()
        await click(mergeButton())
        expect(parts('studio-asset-merge-confirm')).toHaveLength(1)
        expect(parts('studio-asset-merge-confirm-hit').map((line) => line.textContent)).toEqual(['studioAssetMergeConfirmHit(name-c1,2)'])
        expect(textOf('studio-asset-merge-confirm-warning')).toBe('studioAssetMergeConfirmWarning')
        expect(document.activeElement).toBe(part('studio-asset-merge-confirm-cancel'))
        expect(merged).toEqual([])
    })

    test('archived characters open it', async () => {
        const { merged } = await showModule()
        rig.characterCounts[0].resolve(doneCharacters({ archivedCharacters: 2 }))
        await settle()
        await click(mergeButton())
        expect(textOf('studio-asset-merge-confirm-archived')).toBe('studioAssetMergeArchivedCharacters(2)')
        expect(merged).toEqual([])
    })

    test('a scan that has not finished opens it with "not finished"', async () => {
        const { merged } = await showModule()
        await click(mergeButton())
        expect(textOf('studio-asset-merge-confirm-unfinished')).toBe('studioAssetMergeConfirmUnfinished(0)')
        expect(merged).toEqual([])
    })

    test('a scan that failed opens it, as an unfinished one', async () => {
        await showModule()
        rig.characterCounts[0].resolve({ state: 'failed', characters: [], archivedCharacters: 0 })
        await settle()
        await click(mergeButton())
        expect(parts('studio-asset-merge-confirm')).toHaveLength(1)
    })

    test('a scan that finished with no hit and no archived character opens no confirm: Merge lands at once', async () => {
        const { merged } = await showModule()
        rig.characterCounts[0].resolve(doneCharacters({ characters: [{ chaId: 'c1', textHits: 0, chatHits: 0, archivedChats: 4 }] }))
        await settle()
        await click(mergeButton())
        expect(parts('studio-asset-merge-confirm')).toHaveLength(0)
        expect(merged).toHaveLength(1)
        expect(rig.closed).toBe(1)
    })

    test('Cancel in the confirm leaves the module and the history as they were', async () => {
        const before = $state.snapshot(liveModule())
        const { merged } = await showModule()
        await click(mergeButton())
        await click(part('studio-asset-merge-confirm-cancel'))
        expect(parts('studio-asset-merge-confirm')).toHaveLength(0)
        expect($state.snapshot(liveModule())).toEqual(before)
        expect(merged).toEqual([])
        expect(rig.closed).toBe(0)
        expect(parts('studio-asset-merge-preview')).toHaveLength(1)
    })

    test('Merge anyway merges the model it was shown', async () => {
        const { merged } = await showModule()
        rig.characterCounts[0].resolve(doneCharacters({ characters: [hit] }))
        await settle()
        await click(mergeButton())
        await click(part('studio-asset-merge-confirm-merge'))
        const expected = buildMergePreview({ kind: 'module', source: liveModule() }, 'asset', groupOf(rowsOf()), 'smile', [], DEFAULT_SETTINGS)
        expect(merged).toEqual([expected])
        expect(rig.closed).toBe(1)
        expect(rig.posted[0].slice(2)).toEqual(['studioStepAssetMerge(grin,smile)', undefined])
    })

    test('the module list says what a character that uses the name holds, and that it is enabled for every character', async () => {
        await showModule({ source: { ...moduleSource(), enabledEverywhere: () => true } })
        rig.characterCounts[0].resolve(doneCharacters({ characters: [hit] }))
        await settle()
        expect(part('studio-asset-merge-characters').textContent).toContain('studioAssetMergeCharacters(1)')
        expect(textOf('studio-asset-merge-enabled-all')).toBe('studioAssetMergeEnabledAll')
        expect(textOf('studio-asset-merge-character')).toBe('studioAssetMergeConfirmHit(name-c1,2)')
    })

    test('a module owner is told that names are matched exactly', async () => {
        await showModule()
        expect(parts('studio-asset-merge-section').some((section) => section.dataset.section === 'closeNames' && section.textContent?.includes('studioAssetMergeModuleExact(grin)'))).toBe(true)
    })

    describe('T48c on the confirm path', () => {
        beforeEach(() => { setMergeStaleForcedFreshForTests(true) })

        test('a change made after the confirm opened: Merge anyway writes nothing and shows "Out of date"', async () => {
            const { merged } = await showModule()
            rig.characterCounts[0].resolve(doneCharacters({ characters: [hit] }))
            await settle()
            await click(mergeButton())
            expect(parts('studio-asset-merge-confirm')).toHaveLength(1)
            const before = $state.snapshot(liveModule())
            liveModule().lorebook.push({ key: 'k2', content: '{{image::grin}}' })
            const changed = $state.snapshot(liveModule())
            ;(part('studio-asset-merge-confirm-merge') as HTMLElement).click()
            flushSync()
            expect($state.snapshot(liveModule())).toEqual(changed)
            expect(changed).not.toEqual(before)
            expect(merged).toEqual([])
            expect(rig.closed).toBe(0)
            await settle()
            expect(textOf('studio-asset-merge-stale')).toBe('studioAssetMergeStale')
            expect(parts('studio-asset-merge-confirm')).toHaveLength(0)
        })
    })

    test('R-E1e: the confirm lists the characters found so far while the scan runs, still marked not finished, and grows', async () => {
        const { merged } = await showModule()
        rig.characterProgress[0]({ state: 'running', characters: [hit], archivedCharacters: 0 })
        await settle()
        expect(textOf('studio-asset-merge-character')).toBe('studioAssetMergeConfirmHit(name-c1,2)')
        expect(textOf('studio-asset-merge-characters')).toContain('studioAssetMergeCharacters(studioAssetMergeAtLeast(1))')
        await click(mergeButton())
        expect(parts('studio-asset-merge-confirm-hit').map((line) => line.textContent)).toEqual(['studioAssetMergeConfirmHit(name-c1,2)'])
        expect(textOf('studio-asset-merge-confirm-unfinished')).toBe('studioAssetMergeConfirmUnfinished(1)')

        rig.characterProgress[0]({ state: 'running', characters: [hit, { chaId: 'c2', textHits: 1, chatHits: 0, archivedChats: 0 }], archivedCharacters: 0 })
        await settle()
        expect(parts('studio-asset-merge-confirm-hit').map((line) => line.textContent)).toEqual(['studioAssetMergeConfirmHit(name-c1,2)', 'studioAssetMergeConfirmHit(name-c2,1)'])
        expect(textOf('studio-asset-merge-confirm-unfinished')).toBe('studioAssetMergeConfirmUnfinished(2)')
        expect(merged).toEqual([])
    })

    test('R-E1f: a partial of a replaced module scan lands nothing', async () => {
        await showModule()
        rig.characterProgress[0]({ state: 'running', characters: [hit], archivedCharacters: 0 })
        await settle()
        expect(parts('studio-asset-merge-character')).toHaveLength(1)
        const select = parts('studio-asset-merge-keep')[0] as HTMLSelectElement
        select.value = 'grin'
        select.dispatchEvent(new Event('change', { bubbles: true }))
        await settle()
        expect(rig.signals[0].aborted).toBe(true)
        expect(parts('studio-asset-merge-character')).toHaveLength(0)
        rig.characterProgress[0]({ state: 'running', characters: [hit, { ...hit, chaId: 'c9' }], archivedCharacters: 0 })
        await settle()
        expect(parts('studio-asset-merge-character')).toHaveLength(0)
    })

    test('R-E3: Cancel in the confirm puts focus on the preview Merge button', async () => {
        await showModule()
        await click(mergeButton())
        expect(document.activeElement).toBe(part('studio-asset-merge-confirm-cancel'))
        await click(part('studio-asset-merge-confirm-cancel'))
        expect(parts('studio-asset-merge-confirm')).toHaveLength(0)
        expect(document.activeElement).toBe(mergeButton())
    })

    test('R-E3b: the confirm hidden because the model went stale puts focus on Cancel, as Merge is disabled', async () => {
        await showModule()
        await click(mergeButton())
        expect(parts('studio-asset-merge-confirm')).toHaveLength(1)
        liveModule().lorebook.push({ key: 'k2', content: '{{image::grin}}' })
        await settle()
        expect(parts('studio-asset-merge-confirm')).toHaveLength(0)
        expect(mergeButton().disabled).toBe(true)
        expect(document.activeElement).toBe(part('studio-asset-merge-cancel'))
    })

    test('E5: Merge anyway through the real history service rewrites the module, lands one step and undoes', async () => {
        const moduleHistory = createOwnerHistoryService({
            store: createMemoryStudioStore(),
            claim: createClaimDouble(),
            clock: createFakeClock(),
            pageSession: 'p1',
            getVisitId: () => 'v1',
            registerLeaveFlush: () => () => {},
            openModuleId: () => 'm1',
        })
        await moduleHistory.whenReady(M)
        rig.source = moduleSource()
        await show({ owner: M, ownerKind: 'module', ownerId: 'm1', service: moduleHistory })
        rig.characterCounts[0].resolve(doneCharacters({ characters: [hit] }))
        await settle()
        await click(mergeButton())
        expect(parts('studio-asset-merge-confirm')).toHaveLength(1)
        expect(liveModule().assets.map((row) => row[0])).toEqual(['smile', 'grin', 'other'])

        await click(part('studio-asset-merge-confirm-merge'))

        expect(liveModule().assets.map((row) => row[0])).toEqual(['smile', 'other'])
        expect(liveModule().lorebook[0].content).toBe('x {{image::smile}}')
        expect(moduleHistory.view(M).done).toHaveLength(1)
        expect(moduleHistory.view(M).done[0].label).toEqual({ kind: 'assetMerge', from: 'grin', to: 'smile' })
        expect(rig.closed).toBe(1)
        expect(moduleHistory.undo(M)).toEqual({ ok: true })
        expect(liveModule().assets.map((row) => row[0])).toEqual(['smile', 'grin', 'other'])
        expect(liveModule().lorebook[0].content).toBe('x {{image::grin}}')
    })
})
