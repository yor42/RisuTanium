// @vitest-environment happy-dom

/**
 * A search created without `stats` shares one module-level text cache, so a later Home visit (a new
 * instance over the same character slots) does not normalise every name again. Edits are still seen: a
 * hit is valid only while the slot's name, notes, tags and creator equal what was normalised. An
 * instance that passes `stats` keeps its own isolated cache.
 *
 * MOCKED: `src/ts/stores.svelte` (only `DBState`, a real `$state` object). `String.prototype.normalize`
 * is wrapped to count NFKC passes.
 */
import { flushSync } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../storage/database.svelte'

vi.mock(import('../../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return { DBState: state } as unknown as typeof import('../../stores.svelte')
})

import { DBState } from '../../stores.svelte'
import { createCharacterSearch, type CharacterSearch } from '../characterSearch.svelte'
import type { SearchStats } from '../characterSearch'

type CharacterFixture = Database['characters'][number]

function makeCharacter(chaId: string, name: string): CharacterFixture {
    return {
        chaId,
        name,
        type: 'character',
        image: '',
        creatorNotes: '',
        chatPage: 0,
        lastInteraction: 0,
        chats: [],
    } as unknown as CharacterFixture
}

let cleanups: (() => void)[] = []

function within<T>(body: () => T): T {
    let value!: T
    cleanups.push(
        $effect.root(() => {
            value = body()
        }),
    )
    flushSync()
    return value
}

/** Counts NFKC passes made while `body` runs. */
function normalizeCalls(body: () => void): number {
    const native = String.prototype.normalize
    let calls = 0
    const spy = vi.spyOn(String.prototype, 'normalize').mockImplementation(function (this: string, form?: string) {
        calls++
        return native.call(this, form)
    })
    try {
        body()
    } finally {
        spy.mockRestore()
    }
    return calls
}

function visit(text = ''): CharacterSearch {
    return within(() => createCharacterSearch(() => text))
}

/** The passes the query alone costs, so a slot's own passes can be told apart. */
function queryOnlyCalls(text: string): number {
    const keep = DBState.db
    DBState.db = { characters: [] } as unknown as Database
    const calls = normalizeCalls(() => {
        visit(text).live
    })
    DBState.db = keep
    return calls
}

afterEach(() => {
    for (const stop of cleanups) {
        stop()
    }
    cleanups = []
})

describe('shared search text cache', () => {
    test('a second search without stats reuses the first one\'s normalisation', () => {
        DBState.db = { characters: Array.from({ length: 50 }, (_, i) => makeCharacter(`shared-${i}`, `Shared ${i}`)) } as unknown as Database
        const baseline = queryOnlyCalls('')
        const first = normalizeCalls(() => {
            expect(visit().live.length).toBe(50)
        })
        expect(first - baseline).toBeGreaterThanOrEqual(50)
        const second = normalizeCalls(() => {
            expect(visit().live.length).toBe(50)
        })
        expect(second).toBe(baseline)
    })

    test('a renamed character is normalised again, the others are not', () => {
        DBState.db = { characters: Array.from({ length: 50 }, (_, i) => makeCharacter(`rename-${i}`, `Rename ${i}`)) } as unknown as Database
        const baseline = queryOnlyCalls('changed')
        visit().live
        DBState.db.characters[7].name = 'Changed Name'
        const calls = normalizeCalls(() => {
            const search = visit('changed')
            expect(search.live.map((hit) => hit.index)).toEqual([7])
        })
        // Only the renamed slot is normalised again: its name text and nothing for the 49 others.
        expect(calls - baseline).toBeGreaterThan(0)
        expect(calls - baseline).toBeLessThan(10)
        const untouched = normalizeCalls(() => {
            expect(visit('changed').live.map((hit) => hit.index)).toEqual([7])
        })
        expect(untouched).toBe(baseline)
    })

    test('an instance that passes stats keeps its own cache and counts every slot', () => {
        DBState.db = { characters: Array.from({ length: 20 }, (_, i) => makeCharacter(`own-${i}`, `Own ${i}`)) } as unknown as Database
        visit().live
        const stats: SearchStats = { entriesNormalised: 0 }
        const search = within(() => createCharacterSearch(() => '', { stats }))
        expect(search.live.length).toBe(20)
        expect(stats.entriesNormalised).toBe(20)
    })
})
