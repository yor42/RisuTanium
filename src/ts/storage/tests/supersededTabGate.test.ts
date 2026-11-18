/**
 * The tab rule of the superseded-unit deletion (`tabsAllowSupersededDelete` in `storage/soleTab.ts`) over plain inputs:
 * the lock query is a function returning the real snapshot shape, no page or module state is involved.
 *
 * Labels: each "guard" pins one branch of the rule; the seam is new, so no case runs on the base and none is a reproducer.
 */
import { describe, expect, test } from 'vitest'
import { tabsAllowSupersededDelete } from 'src/ts/storage/soleTab'
import { STORAGE_TAB_LOCK_NAME } from 'src/ts/storage/storageTabLocks'

type Held = Array<{ name: string, mode: string }>

const presence = (count: number): Held => Array.from({ length: count }, () => ({ name: STORAGE_TAB_LOCK_NAME, mode: 'shared' }))
const queryOf = (held: Held, pending: Held = []) => async () => ({ held, pending }) as LockManagerSnapshot

describe('the tab rule of the superseded-unit deletion', () => {
    test('guard: without a lock query the app allows it; catches the no-query branch answering false or asking the proof first', async () => {
        expect(await tabsAllowSupersededDelete({ query: undefined, holdsOwnPresence: () => false, tauri: true })).toBe(true)
    })

    test('guard: without a lock query the web withholds it; catches the no-query branch answering true', async () => {
        expect(await tabsAllowSupersededDelete({ query: undefined, holdsOwnPresence: () => true, tauri: false })).toBe(false)
    })

    test('guard: the app with a lock query, its own claim and one holder allows it', async () => {
        expect(await tabsAllowSupersededDelete({ query: queryOf(presence(1)), holdsOwnPresence: () => true, tauri: true })).toBe(true)
    })

    test('guard: the app whose own claim is false withholds it though one holder shows; catches skipping the proof on the app', async () => {
        expect(await tabsAllowSupersededDelete({ query: queryOf(presence(1)), holdsOwnPresence: () => false, tauri: true })).toBe(false)
    })

    test('guard: the web with two holders withholds it', async () => {
        expect(await tabsAllowSupersededDelete({ query: queryOf(presence(2)), holdsOwnPresence: () => true, tauri: false })).toBe(false)
    })

    test('guard: the web with its own claim and one holder allows it', async () => {
        expect(await tabsAllowSupersededDelete({ query: queryOf(presence(1)), holdsOwnPresence: () => true, tauri: false })).toBe(true)
    })

    test('guard: a pending exclusive request withholds it', async () => {
        const pending: Held = [{ name: STORAGE_TAB_LOCK_NAME, mode: 'exclusive' }]
        expect(await tabsAllowSupersededDelete({ query: queryOf(presence(1), pending), holdsOwnPresence: () => true, tauri: false })).toBe(false)
    })

    test('guard: a failed lock query withholds it', async () => {
        const query = async (): Promise<LockManagerSnapshot> => { throw new Error('lock query failed') }
        expect(await tabsAllowSupersededDelete({ query, holdsOwnPresence: () => true, tauri: true })).toBe(false)
    })
})
