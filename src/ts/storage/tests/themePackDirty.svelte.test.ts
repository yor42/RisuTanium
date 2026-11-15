/**
 * The first `themePacks` key addition on a profile that lacks the key marks the page dirty, under the async scheduler the
 * build runs with (`experimental.async`, applied by the vitest config). Two paths mark a top-level write, and each is run
 * alone here so a silent one is seen:
 * - the generic top-level change effect of `registerDbChangeEffects` (the "6a" loop over the keys of `DBState.db`), over a
 *   `$state` stand-in that has no write hook; and
 * - the explicit write hook (`installDbWriteHook`) over the patched state proxy, with a sink that records the marks.
 *
 * Both are guards: they pass with or without any pack code, because no pack code is involved; they pin the premise the
 * install relies on (a first `themePacks` assignment needs no explicit mark of its own). The end-to-end row that decides
 * whether the config unit is rewritten is `globalApi.saveStore2.themePacks.svelte.test.ts`.
 *
 * The hook rows run after the effect rows and unregister the hook at the end of the file, so the effect rows never see a
 * hook that an earlier row installed.
 */
import { flushSync } from 'svelte'
import { writable } from 'svelte/store'
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../database.svelte'
import type { DbWriteMark } from '../characterSaveMarks'
import type { toSaveType } from '../risuSave'
import { registerDbChangeEffects } from '../dbChangeEffects.svelte'
import { installDbWriteHook } from '../dbWriteHook'
import { setStateWriteHook } from '../svelteStatePatch'

// The stand-in of `stores.svelte.ts` the change effects read: a reactive state without the write hook.
vi.mock(import('../../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
    } as unknown as typeof import('../../stores.svelte')
})

import { DBState } from '../../stores.svelte'

function makeTracker(): toSaveType {
    return { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
}

/** A stored record v1, the shape `installThemePack` emits. */
function record(id: string): Record<string, unknown> {
    return {
        v: 1, id, packId: 'origin-navy', name: 'Origin Navy', version: '1.0.0', license: 'MIT', attribution: 'A. Author',
        modes: ['light', 'dark'], fonts: [], archive: `assets/tp-${'ab'.repeat(32)}.risutheme`, bytes: 4096, installedAt: 1_700_000_000_000,
    }
}

function profile(): Database {
    return { botPresetsId: 0, botPresets: [], modules: [], loadouts: [], plugins: [], pluginCustomStorage: {}, characters: [], theme: '' } as unknown as Database
}

const dbFields = (): Record<string, unknown> => DBState.db as unknown as Record<string, unknown>

let cleanup: (() => void) | undefined

afterEach(() => {
    cleanup?.()
    cleanup = undefined
})

function startEffects(): ReturnType<typeof vi.fn> {
    DBState.db = profile()
    const markChanged = vi.fn()
    cleanup = $effect.root(() => {
        registerDbChangeEffects({ tracker: makeTracker(), markChanged })
    })
    flushSync()
    markChanged.mockClear()
    return markChanged
}

describe('the generic top-level change effect alone (no write hook)', () => {
    test('T2-10a: adding themePacks to a profile that lacks the key marks the page dirty; a later push does too', () => {
        const markChanged = startEffects()

        dbFields().themePacks = [record('one')]
        flushSync()
        expect(markChanged).toHaveBeenCalledWith(true)
        markChanged.mockClear()

        ;(dbFields().themePacks as unknown[]).push(record('two'))
        flushSync()
        expect(markChanged).toHaveBeenCalledWith(true)
    })

    test('T2-10a: setting activeThemePack on a profile that lacks the key marks the page dirty, and deleting it does too', () => {
        const markChanged = startEffects()

        dbFields().activeThemePack = 'one'
        flushSync()
        expect(markChanged).toHaveBeenCalledWith(true)
        markChanged.mockClear()

        delete dbFields().activeThemePack
        flushSync()
        expect(markChanged).toHaveBeenCalledWith(true)
    })
})

describe('the explicit write hook alone', () => {
    afterAll(() => {
        setStateWriteHook(null)
    })

    /** A state proxy of the patched runtime with the hook installed over it and a sink that records every mark. */
    async function hookedState(): Promise<{ state: { db: Record<string, unknown> }, marks: { kind: string, key?: string }[] }> {
        const { proxy } = await import('svelte/internal/client')
        const state = proxy({ db: {} as Record<string, unknown> })
        const marks: { kind: string, key?: string }[] = []
        installDbWriteHook(state, {
            selectedChaId: () => undefined,
            sink: (mark: DbWriteMark) => { marks.push(mark as { kind: string, key?: string }) },
        })
        state.db = profile() as unknown as Record<string, unknown>
        marks.length = 0
        return { state, marks }
    }

    test('T2-10b: the first themePacks assignment and a later push reach the sink as a setting mark of that key', async () => {
        const { state, marks } = await hookedState()

        state.db.themePacks = [record('one')]
        expect(marks).toContainEqual({ kind: 'setting', key: 'themePacks' })
        marks.length = 0

        ;(state.db.themePacks as unknown[]).push(record('two'))
        expect(marks).toContainEqual({ kind: 'setting', key: 'themePacks' })
    })

    test('T2-10b: the first activeThemePack assignment reaches the sink as a setting mark of that key', async () => {
        const { state, marks } = await hookedState()

        state.db.activeThemePack = 'one'

        expect(marks).toContainEqual({ kind: 'setting', key: 'activeThemePack' })
    })
})
