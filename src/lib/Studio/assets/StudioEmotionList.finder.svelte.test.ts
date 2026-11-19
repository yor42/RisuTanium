// @vitest-environment jsdom
/**
 * The duplicate panel of the Studio emotion-image list over the real history service on the memory doubles: the one
 * array it offers, Remove extras and Merge on stored rows, the emotion reference rewrite, and the checks that refuse
 * another array or a stale preview before anything is written.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    // The props the real finder was mounted with, and the calls of its two actions: when `forward` is off the list is not called.
    finderProps: undefined as undefined | Record<string, unknown>,
    forward: true,
    removeCall: undefined as undefined | unknown[],
    mergeCall: undefined as undefined | unknown[],
}))

vi.mock('src/ts/globalApi.svelte', () => ({
    getSaveMarkCount: () => 0,
    getFileSrc: async (path: string) => `blob:${path}`,
}))

// The real finder, mounted with its two action props wrapped so a test can record the arguments and call them again.
vi.mock('./StudioAssetFinder.svelte', async (importOriginal) => {
    const real = await importOriginal<typeof import('./StudioAssetFinder.svelte')>()
    const Wrapped = (anchor: unknown, props: Record<string, unknown>) => {
        h.finderProps = props
        const wrapped = new Proxy(props, {
            get(target, key) {
                if (key === 'onremoveextras') {
                    return (...args: unknown[]) => {
                        h.removeCall = args
                        if (h.forward) (target.onremoveextras as (...a: unknown[]) => void)(...args)
                    }
                }
                if (key === 'onmerge') {
                    return (...args: unknown[]) => {
                        h.mergeCall = args
                        if (h.forward) (target.onmerge as (...a: unknown[]) => void)(...args)
                    }
                }
                return target[key as string]
            },
        })
        return (real.default as unknown as (a: unknown, p: unknown) => unknown)(anchor, wrapped)
    }
    return { ...real, default: Wrapped }
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
    const table: Record<string, unknown> = { sidebarUi: { noAssets: 'noAssets' }, uiCommon: { close: 'close' } }
    for (const key of [
        'studioAssetRowMenu', 'studioAssetDeletedOne', 'studioEmotionFilterEmpty', 'studioAssetRemovedExtras', 'studioAssetFileGone', 'studioAssetFileUnchecked',
        'studioAssetDupUnreadableCount', 'studioAssetCheckProgress', 'studioAssetSurvivorFolder', 'studioAssetMergeTitle', 'studioAssetMergeAlreadyShows',
        'studioAssetMergeModuleExact', 'studioAssetMergeChats', 'studioAssetMergeArchivedChats', 'studioAssetMergeCharacters', 'studioAssetMergeArchivedCharacters',
        'studioAssetMergeFolder', 'studioAssetMergeAtLeast', 'studioAssetMergePartialName', 'studioAssetMergeConfirmHit', 'studioAssetMergeConfirmUnfinished',
        'studioStepAssetMerge', 'studioAssetNotRestored', 'studioAssetPlaceNumbered', 'studioAssetPlaceAltFirstMessage', 'studioAssetPlaceTriggerEffect',
        'studioAssetPlaceTriggerCondition',
    ]) table[key] = call(key)
    return { language: new Proxy(table, { get: (target, key) => (typeof key === 'symbol' ? undefined : key in target ? target[key] : base[key]) }) }
})

import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import type { AssetSizeJob, StoredSize } from 'src/ts/studio/assets/assetSizes'
import { resetStudioToastsForTests, retireAssetToasts } from 'src/ts/studio/edit/studioToasts'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createToastHost, resetToastHostForTests, type ToastHost } from 'src/ts/toast/toastHost.svelte'
import { assetRow, hashPath } from '../../../ts/studio/assets/assetFixtures.test-helpers'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from '../../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks } from '../../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore, type ClaimDouble } from '../../../ts/studio/history/tests/studioStoreDoubles'
import type { FinderPort } from './StudioAssetFinder.svelte'
import { setMergeStaleForcedFreshForTests } from './StudioAssetMergePreview.svelte'
import { setSessionAssetSizeJobForTests } from './StudioAssetList.svelte'
import StudioEmotionList from './StudioEmotionList.svelte'

// No size is ever read, and no byte is ever hashed: every group here is decided by the stored path alone.
const noSizes: AssetSizeJob = { peek: () => undefined, snapshot: () => new Map<string, StoredSize>(), ensure: async () => true }
const finderPort = async (): Promise<FinderPort> => ({
    sizes: noSizes,
    hashCache: { get: () => undefined },
    async checkBytes() { return { status: 'done', hashes: new Map(), unreadable: [] } },
})

interface LiveCharacter {
    chaId: string
    type: string
    desc: string
    firstMessage: string
    alternateGreetings: string[]
    chats: { id: string, note: string, fmIndex?: number, message?: { data: string }[], localLore?: unknown[] }[]
    chatPage: number
    customscript: { in: string, out: string, type: string }[]
    additionalAssets: string[][]
    emotionImages: string[][]
    [key: string]: unknown
}

const A = characterOwnerKey('A')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
const pA = hashPath('a', 'png')
const pB = hashPath('b', 'png')
const pD = hashPath('d', 'png')

const ASSET_ROWS = (): string[][] => [assetRow('a0', hashPath('x', 'png')), assetRow('a1', hashPath('y', 'png')), assetRow('a2', hashPath('z', 'png'))]
const FIRST = 'Hi {{emotion::calm}} and {{image::calm}}'
const SCRIPT = (out: string) => [{ in: 'x', out, type: 'editdisplay' }]
const MENTION = { id: 'c1', note: '', message: [{ data: 'she is {{emotion::calm}}' }], localLore: [] }

function makeCharacter(emotionImages: string[][]): LiveCharacter {
    return {
        chaId: 'A',
        type: 'character',
        desc: 'd0',
        firstMessage: FIRST,
        alternateGreetings: ['g0'],
        chats: [MENTION],
        chatPage: 0,
        customscript: SCRIPT('@@emo calm'),
        additionalAssets: ASSET_ROWS(),
        emotionImages,
    }
}

let rig: { claim: ClaimDouble, service: OwnerHistoryService }
let toastHost: ToastHost
let mounted: { app: ReturnType<typeof mount>, host: HTMLElement }[] = []
let pageCount = 0

async function settle(): Promise<void> {
    await drainMicrotasks()
    flushSync()
    await drainMicrotasks()
}

async function install(emotions: string[][], configure?: (claim: ClaimDouble) => void): Promise<void> {
    db.db.characters = [makeCharacter(emotions)]
    const claim = createClaimDouble()
    configure?.(claim)
    const service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim,
        clock: createFakeClock(),
        pageSession: `p${++pageCount}`,
        registerLeaveFlush: () => () => {},
        onLanded: retireAssetToasts,
    })
    setStudioHistoryServiceForTests(service)
    rig = { claim, service }
    await service.whenReady(A)
}

async function show(props: Record<string, unknown> = {}): Promise<void> {
    const host = document.createElement('div')
    document.body.appendChild(host)
    mounted.push({ app: mount(StudioEmotionList, { target: host, props: { chaId: 'A', host: toastHost, finderPort, ...props } }), host })
    flushSync()
    await settle()
}

const parts = (name: string, from: ParentNode = document) => Array.from(from.querySelectorAll<HTMLElement>(`[data-part="${name}"]`))
const part = (name: string): HTMLElement | null => parts(name)[0] ?? null
const live = () => db.db.characters[0]
const emotions = (): string[][] => JSON.parse(JSON.stringify(live().emotionImages))
const assets = (): string[][] => JSON.parse(JSON.stringify(live().additionalAssets))
const doneOf = () => rig.service.view(A).done
const keptName = () => (part('studio-asset-merge-keep') as HTMLSelectElement).value

async function click(element: HTMLElement): Promise<void> {
    element.click()
    await settle()
}

async function openPanel(): Promise<void> {
    await click(part('studio-asset-find-duplicates') as HTMLElement)
}

function typeFilter(text: string): void {
    const field = part('studio-emotion-filter') as HTMLInputElement
    field.value = text
    field.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

beforeEach(() => {
    h.finderProps = undefined
    h.forward = true
    h.removeCall = undefined
    h.mergeCall = undefined
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => {} })
    resetStudioScreenForTests()
    setSessionAssetSizeJobForTests(noSizes)
    selection.selId = 0
    studioScreen.chaId = 'A'
    toastHost = createToastHost({ clock: { now: () => 0, after: () => () => {} } })
    setStudioVisitAckForTests({ noteEdit: () => {}, dispose: () => {} } as never)
})

afterEach(async () => {
    for (const entry of mounted.splice(0)) {
        await unmount(entry.app)
        entry.host.remove()
    }
    setSessionAssetSizeJobForTests(undefined)
    setMergeStaleForcedFreshForTests(false)
    resetStudioToastsForTests()
    resetToastHostForTests()
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

describe('U15: the panel offers the emotion images only', () => {
    test('one array, no scope switch, no report-only label, and Merge and Remove extras on the right groups', async () => {
        await install([['calm', pA], ['neutral', pA], ['smile', pB], ['smile', pB]])
        await show()
        expect(parts('studio-asset-dup-panel')).toHaveLength(0)
        await openPanel()
        expect(part('studio-asset-find-duplicates')?.getAttribute('aria-expanded')).toBe('true')
        expect(parts('studio-asset-dup-array').map((array) => array.dataset.array)).toEqual(['emotionImages'])
        expect(parts('studio-asset-dup-modules')).toHaveLength(0)
        expect(part('studio-asset-dup-panel')?.textContent).not.toContain('studioAssetDupReportOnly')
        expect(parts('studio-asset-dup-group').map((group) => group.dataset.class).sort()).toEqual(['sameFile', 'sameFileDifferentNames'])
        expect(parts('studio-asset-dup-merge')).toHaveLength(1)
        expect(parts('studio-asset-remove-extras')).toHaveLength(1)
        await click(part('studio-asset-dup-close') as HTMLElement)
        expect(parts('studio-asset-dup-panel')).toHaveLength(0)
    })

    test('an action for another array, or for a report-only one, is ignored; the emotion array lands', async () => {
        await install([['calm', pA], ['neutral', pA], ['smile', pB], ['smile', pB]])
        await show()
        await openPanel()
        h.forward = false
        await click(part('studio-asset-remove-extras') as HTMLElement)
        await click(part('studio-asset-dup-merge') as HTMLElement)
        const [removeArray, removeGroup, removeDeps] = h.removeCall as [{ id: string, title: null, reportOnly: boolean, rows: unknown[] }, unknown, unknown]
        const [mergeArray, mergeGroup, mergeDeps] = h.mergeCall as [{ id: string, title: null, reportOnly: boolean, rows: unknown[] }, unknown, unknown]
        const onRemove = h.finderProps?.onremoveextras as (...args: unknown[]) => void
        const onMerge = h.finderProps?.onmerge as (...args: unknown[]) => void
        const before = emotions()
        for (const other of [{ ...removeArray, id: 'additionalAssets' }, { ...removeArray, reportOnly: true }]) onRemove(other, removeGroup, removeDeps)
        for (const other of [{ ...mergeArray, id: 'additionalAssets' }, { ...mergeArray, reportOnly: true }]) onMerge(other, mergeGroup, mergeDeps)
        await settle()
        expect(emotions()).toEqual(before)
        expect(doneOf()).toHaveLength(0)
        expect(parts('studio-asset-merge-preview')).toHaveLength(0)
        onMerge(mergeArray, mergeGroup, mergeDeps)
        await settle()
        expect(parts('studio-asset-merge-preview')).toHaveLength(1)
        onRemove(removeArray, removeGroup, removeDeps)
        await settle()
        expect(emotions()).toEqual([['calm', pA], ['neutral', pA], ['smile', pB]])
    })
})

describe('Remove extras', () => {
    test('U16: removes the extra copy in one step, keeps the first, and leaves the asset rows alone', async () => {
        await install([['smile', pA], ['smile', pA], ['sad', pB]])
        await show()
        await openPanel()
        await click(part('studio-asset-remove-extras') as HTMLElement)
        expect(emotions()).toEqual([['smile', pA], ['sad', pB]])
        expect(assets()).toEqual(ASSET_ROWS())
        expect(doneOf()).toHaveLength(1)
        expect(toastHost.visible.map((toast) => [toast.text, toast.sub])).toEqual([['studioAssetRemovedExtras(1,smile)', 'studioAssetSurvivorFirst']])
    })

    test('U16: another file under the name adds the pool warning to the toast line', async () => {
        await install([['smile', pA], ['smile', pA], ['Smile', pB]])
        await show()
        await openPanel()
        await click(part('studio-asset-remove-extras') as HTMLElement)
        expect(emotions()).toEqual([['smile', pA], ['Smile', pB]])
        expect(toastHost.visible[0].sub).toBe('studioAssetSurvivorFirst studioAssetPoolWarning')
    })

    test('U16b: under a filter that hides a row between the copies, exactly the extra copy goes, and Undo restores all', async () => {
        await install([['smile', pA], ['calm', pA], ['smile', pA]])
        await show()
        typeFilter('smi')
        expect(parts('studio-asset-row')).toHaveLength(2)
        await openPanel()
        await click(part('studio-asset-remove-extras') as HTMLElement)
        expect(emotions()).toEqual([['smile', pA], ['calm', pA]])
        await toastHost.activate(toastHost.visible[0].id)
        await settle()
        expect(emotions()).toEqual([['smile', pA], ['calm', pA], ['smile', pA]])
    })

    test('U13: refused as a whole because history cannot be kept while another tab holds the character, with the refusal shown and nothing removed', async () => {
        await install([['smile', pA], ['smile', pA]], (claim) => { claim.unsupported = true })
        await show()
        await openPanel()
        await click(part('studio-asset-remove-extras') as HTMLElement)
        expect(part('studio-emotion-refusal')?.textContent).toBe('studioAssetRefusalNoUndo')
        expect(emotions()).toEqual([['smile', pA], ['smile', pA]])
        expect(doneOf()).toHaveLength(0)
        expect(toastHost.visible).toHaveLength(0)
    })
})

describe('Merge', () => {
    async function openMerge(rows: string[][]): Promise<void> {
        await install(rows)
        await show()
        await openPanel()
        await click(part('studio-asset-dup-merge') as HTMLElement)
    }

    test('U17: of calm into neutral keeps neutral, rewrites the emotion references only, leaves chats and asset rows, and undoes whole', async () => {
        await openMerge([['calm', pA], ['neutral', pA], ['other', pD]])
        expect(parts('studio-asset-merge-preview')).toHaveLength(1)
        expect(keptName()).toBe('neutral')
        await click(part('studio-asset-merge-do') as HTMLElement)
        expect(emotions()).toEqual([['neutral', pA], ['other', pD]])
        expect(live().firstMessage).toBe('Hi {{emotion::neutral}} and {{image::calm}}')
        expect(live().customscript[0].out).toBe('@@emo neutral')
        expect(live().chats).toEqual([MENTION])
        expect(assets()).toEqual(ASSET_ROWS())
        expect(doneOf()).toHaveLength(1)
        expect(parts('studio-asset-merge-preview')).toHaveLength(0)
        expect(toastHost.visible.map((toast) => toast.text)).toEqual(['studioStepAssetMerge(calm,neutral)'])
        expect(rig.service.undo(A)).toEqual({ ok: true })
        await settle()
        expect(emotions()).toEqual([['calm', pA], ['neutral', pA], ['other', pD]])
        expect(live().firstMessage).toBe(FIRST)
        expect(live().customscript[0].out).toBe('@@emo calm')
    })

    test('U17: Cancel closes the preview, changes nothing, and returns focus to the button that opened it', async () => {
        await install([['calm', pA], ['neutral', pA]])
        await show()
        await openPanel()
        const mergeButton = part('studio-asset-dup-merge') as HTMLElement
        mergeButton.focus()
        await click(mergeButton)
        await click(part('studio-asset-merge-cancel') as HTMLElement)
        expect(parts('studio-asset-merge-preview')).toHaveLength(0)
        expect(emotions()).toEqual([['calm', pA], ['neutral', pA]])
        expect(doneOf()).toHaveLength(0)
        expect(document.activeElement).toBe(part('studio-asset-dup-merge'))
    })

    test('U19: of Neutral and neutral preselects the exact neutral, wherever each stands', async () => {
        await openMerge([['Neutral', pA], ['neutral', pA]])
        expect(keptName()).toBe('neutral')
    })

    test('U18: a row renamed after the preview was built is not merged over: nothing is written and the preview is out of date', async () => {
        await install([['calm', pA], ['neutral', pA]])
        await show()
        await openPanel()
        await click(part('studio-asset-dup-merge') as HTMLElement)
        // The click-time rebuild decides here, not the early check.
        setMergeStaleForcedFreshForTests(true)
        live().emotionImages[0][0] = 'serene'
        const before = emotions()
        ;(part('studio-asset-merge-do') as HTMLElement).click()
        flushSync()
        expect(emotions()).toEqual(before)
        expect(doneOf()).toHaveLength(0)
        expect(parts('studio-asset-merge-stale')).toHaveLength(1)
        expect(live().firstMessage).toBe(FIRST)
    })
})