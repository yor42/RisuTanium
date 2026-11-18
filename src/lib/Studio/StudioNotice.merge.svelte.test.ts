// @vitest-environment jsdom
/**
 * The Studio notice that carries the places a merge undo left as they were (MC-2105): Show lists them by their labels; a
 * newer notice replaces an older one whole; and the Undo toast's outcome reaches the notice only while the visit and the
 * owner it was posted for are still on screen. The toast rows run the real toast host on a fake clock over the real history
 * service, with a merge built by `buildMergePreview` and an outside write that makes the undo partial.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: { characters: [], modules: [] } },
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        clearCharEmotionCache: () => {},
    }
})
vi.mock('src/lang', () => {
    const call = (key: string) => (...args: (string | number)[]) => `${key}(${args.join(',')})`
    const table: Record<string, unknown> = {}
    for (const key of ['studioAssetNotRestored', 'studioAssetPlaceNumbered', 'studioAssetPlaceAltFirstMessage', 'studioAssetFileGone']) table[key] = call(key)
    return { language: new Proxy(table, { get: (target, key) => (typeof key === 'symbol' ? undefined : key in target ? target[key] : key) }) }
})

import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { assetRow, DEFAULT_SETTINGS } from 'src/ts/studio/assets/assetFixtures.test-helpers'
import { groupDuplicates } from 'src/ts/studio/assets/duplicateGroups'
import { buildMergePreview } from 'src/ts/studio/assets/mergePreview'
import { createStudioToasts, resetStudioToastsForTests, retireAssetToasts } from 'src/ts/studio/edit/studioToasts'
import { createOwnerHistoryService, type OwnerHistoryService } from 'src/ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey, moduleOwnerKey } from 'src/ts/studio/history/ownerPhase'
import { createFakeClock } from 'src/ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from 'src/ts/studio/history/tests/studioStoreDoubles'
import {
    clearStudioSelection, pickStudioItem, resetStudioScreenForTests, setStudioNotice, setStudioNotRestoredNotice, setStudioNotRestoredNoticeFromToast,
    showStudioList, studioScreen,
} from 'src/ts/studio/studioScreen.svelte'
import { createToastHost, resetToastHostForTests, type ToastClock, type ToastHost } from 'src/ts/toast/toastHost.svelte'
import StudioNotice from './StudioNotice.svelte'

const A = characterOwnerKey('A')
const parts = (name: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-part="${name}"]`))
const part = (name: string) => parts(name)[0]
const places = () => parts('studio-notice-place').map((entry) => entry.textContent)

let mounted: { app: ReturnType<typeof mount>, host: HTMLElement }[] = []

afterEach(async () => {
    for (const entry of mounted.splice(0)) {
        await unmount(entry.app)
        entry.host.remove()
    }
    resetStudioScreenForTests()
})

function showNotice(props: { message: string | null, places?: readonly string[] | null, ownerKind?: 'character' | 'module' }) {
    const state = $state({ ondismiss: () => {}, ...props })
    const host = document.createElement('div')
    document.body.appendChild(host)
    mounted.push({ host, app: mount(StudioNotice, { target: host, props: state }) })
    flushSync()
    return state
}

describe('the notice: Show lists the places a merge undo left', () => {
    test('with no places there is no Show and no list', () => {
        showNotice({ message: 'plain' })
        expect(parts('studio-notice-show')).toHaveLength(0)
        expect(parts('studio-notice-places')).toHaveLength(0)
    })

    test('the list is behind Show, which lists the places by their labels and closes again', () => {
        showNotice({ message: 'm', places: ['desc', 'lore/0/content', 'alternateGreetings/1'] })
        expect(parts('studio-notice-places')).toHaveLength(0)
        expect(part('studio-notice-show').textContent).toBe('studioAssetShow')
        part('studio-notice-show').click()
        flushSync()
        expect(places()).toEqual(['description', 'studioAssetPlaceNumbered(loreBook,1)', 'studioAssetPlaceAltFirstMessage(2)'])
        expect(part('studio-notice-show').getAttribute('aria-expanded')).toBe('true')
        part('studio-notice-show').click()
        flushSync()
        expect(parts('studio-notice-places')).toHaveLength(0)
    })

    test('a module owner\'s places are named as a module names them', () => {
        showNotice({ message: 'm', places: ['backgroundEmbedding'], ownerKind: 'module' })
        part('studio-notice-show').click()
        flushSync()
        expect(places()).toEqual(['backgroundHTML'])
    })

    test('a newer list is closed until its own Show is pressed, and no message hides the line and the list', () => {
        const state = showNotice({ message: 'm', places: ['desc'] })
        part('studio-notice-show').click()
        flushSync()
        expect(places()).toEqual(['description'])
        state.places = ['firstMessage']
        flushSync()
        expect(parts('studio-notice-places')).toHaveLength(0)
        part('studio-notice-show').click()
        flushSync()
        expect(places()).toEqual(['firstMessage'])
        state.message = null
        flushSync()
        expect(parts('studio-notice-show')).toHaveLength(0)
        expect(parts('studio-notice-places')).toHaveLength(0)
    })

    test('Dismiss is still there beside Show', () => {
        let dismissed = 0
        const state = showNotice({ message: 'm', places: ['desc'] })
        state.ondismiss = () => { dismissed += 1 }
        flushSync()
        part('studio-notice-dismiss').click()
        expect(dismissed).toBe(1)
    })
})

describe('the shared setter: a newer notice replaces an older one whole', () => {
    test('the not-restored notice sets the message and the list, with the kind of owner whose labels name them', () => {
        setStudioNotRestoredNotice(A, 'm', ['desc'])
        expect(studioScreen.notice).toBe('m')
        expect(studioScreen.noticePlaces).toEqual({ ownerKind: 'character', places: ['desc'] })
        setStudioNotRestoredNotice(moduleOwnerKey('m1'), 'n', ['cjs'])
        expect(studioScreen.noticePlaces?.ownerKind).toBe('module')
    })

    test('a string notice after it takes the list away, and so does every other write of the notice', () => {
        setStudioNotRestoredNotice(A, 'm', ['desc'])
        setStudioNotice('refusal')
        expect(studioScreen.notice).toBe('refusal')
        expect(studioScreen.noticePlaces).toBeNull()
        setStudioNotRestoredNotice(A, 'm', ['desc'])
        pickStudioItem()
        expect(studioScreen.noticePlaces).toBeNull()
        setStudioNotRestoredNotice(A, 'm', ['desc'])
        showStudioList()
        expect(studioScreen.noticePlaces).toBeNull()
        setStudioNotRestoredNotice(A, 'm', ['desc'])
        clearStudioSelection('gone')
        expect(studioScreen.noticePlaces).toBeNull()
        expect(studioScreen.notice).toBe('gone')
        setStudioNotRestoredNotice(A, 'm', ['desc'])
        setStudioNotice(null)
        expect(studioScreen.notice).toBeNull()
        expect(studioScreen.noticePlaces).toBeNull()
    })

    test('a string notice keeps working for its existing callers', () => {
        setStudioNotice('hello')
        expect(studioScreen.notice).toBe('hello')
        expect(studioScreen.noticePlaces).toBeNull()
    })
})

// ---------------------------------------------------------------- the Undo toast route

interface FakeToastClock extends ToastClock {
    advance(ms: number): void
}

function fakeToastClock(): FakeToastClock {
    let time = 0
    return { now: () => time, after: () => () => {}, advance: (ms) => { time += ms } }
}

interface LiveCharacter {
    chaId: string
    desc: string
    alternateGreetings: string[]
    chats: { id: string, note: string }[]
    chatPage: number
    additionalAssets: string[][]
    emotionImages: string[][]
}

const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
const live = (): LiveCharacter => DBState.db.characters[0] as unknown as LiveCharacter

let service: OwnerHistoryService
let host: ToastHost
let stepId: string

// A merge of `grin` into `smile` over the real service, its toast posted as the list posts it, and then an outside edit of
// the description, so the toast's Undo restores the row and leaves the description: one place not restored.
async function mergedWithToast(visit: string): Promise<void> {
    DBState.db.characters = [{
        chaId: 'A', desc: 'a {{image::grin}} b', alternateGreetings: [], chats: [{ id: 'c1', note: '' }], chatPage: 0,
        additionalAssets: [assetRow('smile', 'assets/a.png'), assetRow('grin', 'assets/a.png')], emotionImages: [],
    }] as unknown as typeof DBState.db.characters
    selIdState.selId = 0
    studioScreen.chaId = 'A'
    studioScreen.open = true
    studioScreen.visitId = visit
    studioScreen.selectedOwnerKey = 'character:A'
    const rows = live().additionalAssets
    const group = groupDuplicates(rows.map((row, index) => ({ name: row[0], path: row[1], index, folder: null }))).find((candidate) => candidate.cls === 'sameFileDifferentNames')
    if (!group) throw new Error('no candidate group')
    const model = buildMergePreview({ kind: 'character', source: { desc: live().desc, additionalAssets: [assetRow('smile', 'assets/a.png'), assetRow('grin', 'assets/a.png')] } }, 'asset', group, 'smile', [], DEFAULT_SETTINGS)
    const result = service.assetMerge(A, model, { hashOf: () => undefined })
    if (result.ok === false || result.stepId === undefined) throw new Error('the merge did not land')
    stepId = result.stepId
    const toasts = createStudioToasts({
        service: () => service,
        host,
        notRestored: {
            visit: () => studioScreen.visitId,
            show: (posted, owner, list) => setStudioNotRestoredNoticeFromToast(posted, owner, `studioAssetNotRestored(${list.length})`, list),
        },
    })
    toasts.postAssetAction(A, stepId, 'Merged grin into smile')
    live().desc = 'changed outside'
}

beforeEach(async () => {
    h.marks = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    host = createToastHost({ clock: fakeToastClock() })
    service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock: createFakeClock(),
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
        onLanded: retireAssetToasts,
        openModuleId: () => null,
    })
    DBState.db.characters = [{ chaId: 'A', desc: '', alternateGreetings: [], chats: [{ id: 'c1', note: '' }], chatPage: 0, additionalAssets: [], emotionImages: [] }] as unknown as typeof DBState.db.characters
    await service.whenReady(A)
})

afterEach(() => {
    resetStudioToastsForTests()
    resetToastHostForTests()
    resetCharacterSaveMarksForTest()
})

describe('the Undo toast of a merge whose undo leaves a place', () => {
    test('says how many places were not restored, and puts the same list in the notice while that visit and owner are on screen', async () => {
        await mergedWithToast('v1')
        await host.activate(host.visible[0].id)
        expect(host.visible[0].text).toBe('studioAssetNotRestored(1)')
        expect(live().additionalAssets.map((row) => row[0])).toEqual(['smile', 'grin'])
        expect(studioScreen.notice).toBe('studioAssetNotRestored(1)')
        expect(studioScreen.noticePlaces).toEqual({ ownerKind: 'character', places: ['desc'] })
    })

    test('after Studio was closed the toast still says it and the notice stays empty', async () => {
        await mergedWithToast('v1')
        studioScreen.open = false
        await host.activate(host.visible[0].id)
        expect(host.visible[0].text).toBe('studioAssetNotRestored(1)')
        expect(studioScreen.notice).toBeNull()
        expect(studioScreen.noticePlaces).toBeNull()
    })

    test('after another visit began the notice stays empty', async () => {
        await mergedWithToast('v1')
        studioScreen.visitId = 'v2'
        await host.activate(host.visible[0].id)
        expect(host.visible[0].text).toBe('studioAssetNotRestored(1)')
        expect(studioScreen.notice).toBeNull()
    })

    test('after another owner was selected the notice stays empty', async () => {
        await mergedWithToast('v1')
        studioScreen.selectedOwnerKey = 'module:other'
        await host.activate(host.visible[0].id)
        expect(host.visible[0].text).toBe('studioAssetNotRestored(1)')
        expect(studioScreen.notice).toBeNull()
    })

    test('a toast without the notice wiring still says how many places', async () => {
        await mergedWithToast('v1')
        const real = createToastHost({ clock: fakeToastClock() })
        createStudioToasts({ service: () => service, host: real }).postAssetAction(A, stepId, 'Merged')
        await real.activate(real.visible[0].id)
        expect(real.visible[0].text).toBe('studioAssetNotRestored(1)')
        expect(studioScreen.notice).toBeNull()
    })

    test('an Undo that restores everything says "Undone" and leaves the notice alone', async () => {
        await mergedWithToast('v1')
        live().desc = 'a {{image::smile}} b'
        await host.activate(host.visible[0].id)
        expect(host.visible[0].text).toBe('studioAssetUndone')
        expect(live().desc).toBe('a {{image::grin}} b')
        expect(studioScreen.notice).toBeNull()
    })
})
