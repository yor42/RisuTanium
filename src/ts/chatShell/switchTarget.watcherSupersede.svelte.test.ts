/**
 * The selection watcher of `switchCharacter` (`switchTarget.svelte.ts`).
 *
 * Invariants exercised here:
 * - A selection move to another character, or to none, while a switch is
 *   pending ends it and supersedes the restore still running, so the restore
 *   cannot select the target after the user has left. This holds for a loading
 *   and for a failed switch.
 * - A re-index of the character that was selected when the switch started
 *   (same entry, new slot) keeps the switch and does not supersede.
 *
 * `changeChar` is mocked with deferred results; the real one is covered by
 * `characters.watcherSupersede.svelte.test.ts`.
 */
import { writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { Database } from '../storage/database.svelte'
import type { ChangeCharOutcome } from '../characters'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    const selectedCharID = writable(-1)
    const selIdState = $state({ selId: -1 })
    selectedCharID.subscribe((v) => { selIdState.selId = v })
    return {
        DBState: state,
        selectedCharID,
        selIdState,
    } as unknown as typeof import('src/ts/stores.svelte')
})

const changeCharMock = vi.hoisted(() => vi.fn())
const supersedeMock = vi.hoisted(() => vi.fn())

vi.mock(import('src/ts/characters'), () => ({
    changeChar: changeCharMock,
    supersedeChangeChar: supersedeMock,
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/alert'), () => ({
    alertNormal: vi.fn(),
    alertError: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { doingChat } from 'src/ts/process/index.svelte'
import { switchTarget, switchCharacter, clearPending } from './switchTarget.svelte'

type Entry = Database['characters'][number]

function warm(chaId: string, extra: Record<string, unknown> = {}): Entry {
    return { type: 'character', chaId, name: chaId, chats: [], chatPage: 0, ...extra } as unknown as Entry
}

/** A placeholder as this fork's stub builder marks it. */
function stub(chaId: string, key = `unit-${chaId}`): Entry {
    return warm(chaId, { coldstorage: key })
}

function install(characters: Entry[]): Entry[] {
    DBState.db = { characters } as unknown as Database
    return DBState.db.characters
}

interface Deferred {
    resolve: (outcome: ChangeCharOutcome) => void
}

/** Every `changeChar` call stays pending until the test settles it. */
function holdChangeChar(): Deferred[] {
    const calls: Deferred[] = []
    changeCharMock.mockImplementation(() => new Promise<ChangeCharOutcome>((resolve) => {
        calls.push({ resolve })
    }))
    return calls
}

beforeEach(() => {
    changeCharMock.mockReset()
    supersedeMock.mockReset()
    doingChat.set(false)
    selectedCharID.set(-1)
    clearPending()
})

describe('the selection watcher of a pending switch', () => {
    test('ST1: a move to another character while loading supersedes the restore and idles the switch', async () => {
        const [, s] = install([warm('a'), stub('s'), warm('c')])
        selectedCharID.set(0)
        const calls = holdChangeChar()

        const pending = switchCharacter(s)
        expect(switchTarget.phase).toBe('loading')
        selectedCharID.set(2)

        expect(supersedeMock).toHaveBeenCalledTimes(1)
        expect(switchTarget.phase).toBe('idle')
        calls[0].resolve('superseded')
        await pending
    })

    test('ST1b: a move to none while loading supersedes the restore', async () => {
        const [, s] = install([warm('a'), stub('s')])
        selectedCharID.set(0)
        const calls = holdChangeChar()

        const pending = switchCharacter(s)
        selectedCharID.set(-1)

        expect(supersedeMock).toHaveBeenCalledTimes(1)
        expect(switchTarget.phase).toBe('idle')
        calls[0].resolve('superseded')
        await pending
    })

    test('ST2: a move to another character clears a failed switch and supersedes', async () => {
        const [, s] = install([warm('a'), stub('s'), warm('c')])
        selectedCharID.set(0)
        const calls = holdChangeChar()

        const pending = switchCharacter(s)
        calls[0].resolve({ failed: 'missing' })
        await pending
        expect(switchTarget.phase).toBe('failed')
        expect(supersedeMock).not.toHaveBeenCalled()

        selectedCharID.set(2)

        expect(supersedeMock).toHaveBeenCalledTimes(1)
        expect(switchTarget.phase).toBe('idle')
    })

    test('ST3: a re-index of the character selected at the start keeps the switch and does not supersede', async () => {
        const characters = install([warm('x'), warm('a'), stub('s')])
        const target = characters[2]
        selectedCharID.set(1)
        const calls = holdChangeChar()

        const pending = switchCharacter(target)
        characters.splice(0, 1)
        selectedCharID.set(0)

        expect(supersedeMock).not.toHaveBeenCalled()
        expect(switchTarget.phase).toBe('loading')
        expect(switchTarget.target).toBe(target)

        calls[0].resolve('selected')
        await pending
        expect(switchTarget.phase).toBe('idle')
    })

    test('ST4: a switch started from home is superseded by a move to a character', async () => {
        const [, s] = install([warm('a'), stub('s'), warm('c')])
        const calls = holdChangeChar()

        const pending = switchCharacter(s)
        selectedCharID.set(2)

        expect(supersedeMock).toHaveBeenCalledTimes(1)
        expect(switchTarget.phase).toBe('idle')
        calls[0].resolve('superseded')
        await pending
    })

    test('ST5: a selection index past the end at the start counts as no character', async () => {
        const [, s] = install([warm('a'), stub('s')])
        selectedCharID.set(5)
        const calls = holdChangeChar()

        const pending = switchCharacter(s)
        selectedCharID.set(-1)

        expect(supersedeMock).toHaveBeenCalledTimes(1)
        expect(switchTarget.phase).toBe('idle')
        calls[0].resolve('superseded')
        await pending
    })

    test('ST6: the restore landing on its target is not kept as a re-index and idles the switch', async () => {
        const [, s] = install([warm('a'), stub('s')])
        selectedCharID.set(0)
        const calls = holdChangeChar()

        const pending = switchCharacter(s)
        selectedCharID.set(1)
        calls[0].resolve('selected')
        await pending

        expect(switchTarget.phase).toBe('idle')
    })
})
