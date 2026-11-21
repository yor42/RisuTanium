/**
 * The first `ltmEngine` and `ltmSettings` key additions on a profile that lacks them mark the page dirty, and so does a
 * nested change of the settings, under the async scheduler the build runs with (`experimental.async`, applied by the vitest
 * config). Two paths mark a top-level write, and each is run alone here so a silent one is seen:
 * - the generic top-level change effect of `registerDbChangeEffects` (the "6a" loop over the keys of `DBState.db`), over a
 *   `$state` stand-in that has no write hook; and
 * - the explicit write hook (`installDbWriteHook`) over the patched state proxy, with a sink that records the marks.
 *
 * Every row is a guard: it passes with or without any ChroMemory code, because no ChroMemory code is involved; the rows pin
 * the premise that both keys persist with no explicit mark of their own and no default write.
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
    test('P3 guard: adding ltmEngine to a profile that lacks the key marks the page dirty, and so does turning it off', () => {
        const markChanged = startEffects()

        dbFields().ltmEngine = true
        flushSync()
        expect(markChanged).toHaveBeenCalledWith(true)
        markChanged.mockClear()

        dbFields().ltmEngine = false
        flushSync()
        expect(markChanged).toHaveBeenCalledWith(true)
    })

    test('P3 guard: adding ltmSettings marks the page dirty, and so does a nested change of a field', () => {
        const markChanged = startEffects()

        dbFields().ltmSettings = { budgetTokens: 1800, future: { deep: [1] } }
        flushSync()
        expect(markChanged).toHaveBeenCalledWith(true)
        markChanged.mockClear()

        ;(dbFields().ltmSettings as { budgetTokens: number }).budgetTokens = 900
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

    test('P3 guard: the first ltmEngine assignment reaches the sink as a setting mark of that key', async () => {
        const { state, marks } = await hookedState()

        state.db.ltmEngine = true

        expect(marks).toContainEqual({ kind: 'setting', key: 'ltmEngine' })
    })

    test('P3 guard: the first ltmSettings assignment reaches the sink as a setting mark of that key', async () => {
        const { state, marks } = await hookedState()

        state.db.ltmSettings = { budgetTokens: 1800 }

        expect(marks).toContainEqual({ kind: 'setting', key: 'ltmSettings' })
    })
})
