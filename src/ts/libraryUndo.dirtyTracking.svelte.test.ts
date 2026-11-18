// @vitest-environment happy-dom

/**
 * Save marks of an order undo, through the real database change effects.
 *
 * Invariant: the write an order undo makes (assign `characterOrder`, then `checkCharOrder`) is seen by the
 * dirty-tracking effects like the user's own drag or group, so an undone order reaches the save.
 *
 * Compatibility guard (passes before and after any reassignment-versus-in-place choice): it pins "order undo marks
 * dirty", not the way the array is written.
 *
 * MOCKED: the stores module (a `$state` database), `globalApi.svelte` (`checkCharOrder` is a spy) and `characters`
 * (the trash restore is not used here). The effects, the marks and the undo are real.
 */
import { flushSync } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import type { Database, folder } from './storage/database.svelte'
import type { toSaveType } from './storage/risuSave'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    const selectedCharID = writable(-1)
    const selIdState = $state({ selId: -1 })
    selectedCharID.subscribe((v) => { selIdState.selId = v })
    return { DBState: state, selectedCharID, selIdState } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({ checkCharOrder: vi.fn(), changeChatTo: vi.fn() }) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/characters'), () => ({ restoreCharacterFromTrash: vi.fn() }) as unknown as typeof import('src/ts/characters'))
vi.mock(import('src/ts/alert'), () => ({ alertError: vi.fn() }) as unknown as typeof import('src/ts/alert'))

import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from './storage/characterSaveMarks'
import { registerDbChangeEffects } from './storage/dbChangeEffects.svelte'
import { copyOrder, orderUndoAction } from './libraryUndo'

const SENTINEL = 'sentinel'
const scheduled = vi.fn()
let tracker: toSaveType
let markChanged: Mock<(markDirty: boolean) => void>
let cleanup: (() => void) | undefined

const F = (id: string, ...data: string[]): folder => ({ id, name: id, color: '', data })

beforeEach(() => {
    resetCharacterSaveMarksForTest()
    scheduled.mockReset()
    tracker = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false } as unknown as toSaveType
    markChanged = vi.fn<(markDirty: boolean) => void>()
    installCharacterSaveMarks({ tracker, schedule: scheduled })
    DBState.db = { characters: [], characterOrder: [F('new', 'A', 'B'), 'C'], botPresets: [], modules: [], loadouts: [], plugins: [], pluginCustomStorage: {} } as unknown as Database
    selectedCharID.set(-1)
    cleanup = $effect.root(() => {
        registerDbChangeEffects({ tracker, markChanged })
    })
    flushSync()
    tracker.character = [SENTINEL]
    markChanged.mockClear()
    scheduled.mockClear()
})

afterEach(() => {
    cleanup?.()
    cleanup = undefined
    selectedCharID.set(-1)
})

describe('an order undo', () => {
    test('guard O9: the undo run marks the database dirty', async () => {
        const before = copyOrder(['A', 'B', 'C'])
        const after = copyOrder(DBState.db.characterOrder)
        const outcome = await orderUndoAction('grouped', before, after).run()
        expect(outcome.ok).toBe(true)
        flushSync()
        expect(markChanged).toHaveBeenCalledWith(true)
        expect($state.snapshot(DBState.db.characterOrder)).toEqual(['A', 'B', 'C'])
    })

    test('guard: a refused undo writes nothing and marks nothing', async () => {
        const after = copyOrder([F('other', 'A')])
        const outcome = await orderUndoAction('grouped', copyOrder(['A', 'B', 'C']), after).run()
        expect(outcome.ok).toBe(false)
        flushSync()
        expect(markChanged).not.toHaveBeenCalled()
    })
})
