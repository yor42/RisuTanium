// @vitest-environment happy-dom

/**
 * Visiting the Other Bots page must not rewrite `wavespeedImage.loras` when nothing was edited: a fresh array
 * notifies every deep reader of `wavespeedImage` (the save tracker reads it by snapshot), and the page seeds its
 * slots from the stored list so saved LoRAs survive the visit.
 *
 * Mounts the REAL component over a real `$state` database. Titles beginning "guard:" pass before and after the
 * change; the others fail on the base.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, afterEach } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = {
        alertConfirm: vi.fn(async () => true),
        alertStore: writable({ type: 'none', msg: '' }),
    }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    saveAsset: vi.fn(),
    pickedAssetLimitBytes: vi.fn(),
    downloadFile: vi.fn(),
    globalFetch: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/util'), () => ({
    selectSingleFile: vi.fn(),
    selectSingleFileObject: vi.fn(),
    readPickedFileBytes: vi.fn(),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/characters'), () => ({
    getCharImage: vi.fn(async () => ''),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/process/prompt'), () => ({
    tokenizePreset: vi.fn(async () => 0),
}) as unknown as typeof import('src/ts/process/prompt'))

vi.mock(import('src/ts/tokenizer'), () => ({
    getCharToken: vi.fn(async () => ({ persistant: 0, dynamic: 0 })),
}) as unknown as typeof import('src/ts/tokenizer'))

vi.mock(import('src/ts/process/memory/hypav3'), () => ({
    createHypaV3Preset: vi.fn((name: string) => ({ name })),
}) as unknown as typeof import('src/ts/process/memory/hypav3'))

vi.mock('src/lib/UI/GUI/TextAreaInput.svelte', () => ({ default: () => {} }))

//#endregion

import { DBState } from 'src/ts/stores.svelte'
import OtherBotSettings from './OtherBotSettings.svelte'

//#region helpers

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

type Wavespeed = Database['wavespeedImage']

function installDb(wavespeedImage: Partial<Wavespeed>): void {
    DBState.db = {
        hypaV3: false,
        hypav2: false,
        hanuraiEnable: false,
        supaModelType: 'none',
        useLegacyGUI: false,
        wavespeedImage,
        hypaV3Presets: [{ name: 'A' }],
        hypaV3PresetId: 0,
        characters: [{ chaId: 'c0', chats: [], chatPage: 0 }],
    } as unknown as Database
}

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []
let stopWatchers: Array<() => void> = []

/** Counts re-runs of a deep snapshot reader of `wavespeedImage`, as the save tracker's read does. */
function watchWavespeedSnapshot(): { runs: () => number } {
    let runs = 0
    stopWatchers.push($effect.root(() => {
        $effect(() => {
            $state.snapshot(DBState.db.wavespeedImage)
            runs += 1
        })
    }))
    flushSync()
    return { runs: () => runs }
}

async function visit(): Promise<void> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(OtherBotSettings, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    await sleep(20)
    flushSync()
}

afterEach(async () => {
    for (const stop of stopWatchers) stop()
    stopWatchers = []
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

//#endregion

describe('the Other Bots page and wavespeedImage.loras', () => {
    test('an idle visit with stored loras [] re-runs a deep reader 0 times and keeps the array identity', async () => {
        const stored: Wavespeed['loras'] = []
        installDb({ loras: stored })
        const before = DBState.db.wavespeedImage.loras
        const watch = watchWavespeedSnapshot()
        const base = watch.runs()

        await visit()

        expect(watch.runs() - base, 'deep reader re-runs').toBe(0)
        expect(DBState.db.wavespeedImage.loras).toBe(before)
    })

    test('guard: stored wavespeedImage without loras ends with loras []', async () => {
        installDb({})

        await visit()

        expect(DBState.db.wavespeedImage.loras).toEqual([])
    })

    test('stored loras survive a visit and a deep reader does not re-run', async () => {
        installDb({ loras: [{ path: 'p', scale: 2 }] })
        const watch = watchWavespeedSnapshot()
        const base = watch.runs()

        await visit()

        expect(DBState.db.wavespeedImage.loras).toEqual([{ path: 'p', scale: 2 }])
        expect(watch.runs() - base, 'deep reader re-runs').toBe(0)
    })

    test('guard: a clear of loras made while the page is open (a model change) is not written back', async () => {
        installDb({ loras: [{ path: 'p', scale: 2 }] })
        await visit()

        DBState.db.wavespeedImage.loras = undefined as unknown as Wavespeed['loras']
        flushSync()
        await sleep(20)
        flushSync()

        expect(DBState.db.wavespeedImage.loras).toBeUndefined()
    })

    test('a stored list longer than the minimum slots is kept whole', async () => {
        const four = [1, 2, 3, 4].map((n) => ({ path: 'p' + n, scale: n }))
        installDb({ loras: four })

        await visit()

        expect(DBState.db.wavespeedImage.loras).toEqual(four)
    })
})
