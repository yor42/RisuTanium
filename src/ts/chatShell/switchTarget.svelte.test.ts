/**
 * `switchCharacter` and the pending-switch state (`switchTarget.svelte.ts`).
 *
 * Invariants exercised here:
 * - A reply being written never refuses a switch; outcomes of the underlying
 *   `changeChar` end the pending state, except a refused restore, which stays
 *   as `failed` for the frame to show.
 * - The pending state never outlives a foreign selection change, a newer
 *   switch or a non-failed outcome, and a stale outcome never revives it.
 * - The character index is resolved when the switch is requested.
 * - A `changeChar` that throws never makes the switch reject or stay loading: while the switch is
 *   still current it ends `failed`/`unreadable` with its selection watcher kept and no alert; a
 *   switch ended meanwhile, or whose selection moved before the throw, resolves `superseded`.
 * - A Retry keeps the frame shown: the phase goes `failed -> loading -> failed | idle`, never
 *   through `idle`, also when the target is resident by then.
 *
 * `changeChar` is mocked with deferred results so each ordering is driven by
 * the test; the real one is covered by `characters.quietSwitch.svelte.test.ts`.
 */
import { get, writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
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

import { DBState, selectedCharID, selIdState } from 'src/ts/stores.svelte'
import { alertNormal, alertError } from 'src/ts/alert'
import { doingChat } from 'src/ts/process/index.svelte'
import { registerWork } from 'src/ts/process/chatOrigin'
import { resolveSwitchFocus } from './overlayFocus'
import { switchTarget, switchCharacter, retrySwitch, backToPrevious, abandonPendingSwitch, clearPending } from './switchTarget.svelte'

type Entry = Database['characters'][number]

function warm(chaId: string, extra: Record<string, unknown> = {}): Entry {
    return { type: 'character', chaId, name: chaId, chats: [], chatPage: 0, ...extra } as unknown as Entry
}

/** A placeholder as this fork's stub builder marks it. */
function stub(chaId: string, key = `unit-${chaId}`): Entry {
    return warm(chaId, { coldstorage: key })
}

function group(chaId: string): Entry {
    return { type: 'group', chaId, name: chaId, chats: [], chatPage: 0 } as unknown as Entry
}

function install(characters: Entry[]): Entry[] {
    DBState.db = { characters } as unknown as Database
    return DBState.db.characters
}

interface Deferred {
    resolve: (outcome: ChangeCharOutcome) => void
    reject: (error: Error) => void
}

/** Every `changeChar` call stays pending until the test settles it. */
function holdChangeChar(): Deferred[] {
    const calls: Deferred[] = []
    changeCharMock.mockImplementation(() => new Promise<ChangeCharOutcome>((resolve, reject) => {
        calls.push({ resolve, reject })
    }))
    return calls
}

beforeEach(() => {
    changeCharMock.mockReset()
    supersedeMock.mockReset()
    vi.mocked(alertNormal).mockClear()
    vi.mocked(alertError).mockClear()
    doingChat.set(false)
    selectedCharID.set(-1)
    clearPending()
})

describe('pending switch state', () => {
    test('diagnostic: the selection mirror follows the store', () => {
        selectedCharID.set(1)
        expect(selIdState.selId).toBe(1)
    })

    test('starts idle', () => {
        expect(switchTarget.phase).toBe('idle')
        expect(switchTarget.target).toBeNull()
        expect(switchTarget.reason).toBeNull()
    })

    test('TA5 (T4): a switch while a reply is written reaches changeChar and shows no notice', async () => {
        const [first] = install([warm('a'), warm('b')])
        changeCharMock.mockResolvedValue('selected')
        doingChat.set(true)
        const reply = registerWork({ chaId: 'b', chatId: 'b-chat' }, undefined, 'reply')

        const outcome = await switchCharacter(first)
        reply.end()

        expect(outcome).toBe('selected')
        expect(alertNormal).not.toHaveBeenCalled()
        expect(changeCharMock).toHaveBeenCalledTimes(1)
        expect(switchTarget.phase).toBe('idle')
    })

    test('TA5b (T4): a cold switch while a reply is written is pending as usual and lands without a notice', async () => {
        const [, s] = install([warm('a'), stub('s')])
        const calls = holdChangeChar()
        doingChat.set(true)
        const reply = registerWork({ chaId: 'a', chatId: 'a-chat' }, undefined, 'reply')

        const pending = switchCharacter(s)
        expect(switchTarget.phase).toBe('loading')
        calls[0].resolve('selected')
        await pending
        reply.end()

        expect(switchTarget.phase).toBe('idle')
        expect(alertNormal).not.toHaveBeenCalled()
    })

    test('a warm character switches quietly and leaves nothing pending', async () => {
        const [, second] = install([warm('a'), warm('b')])
        changeCharMock.mockResolvedValue('selected')

        const outcome = await switchCharacter(second)

        expect(outcome).toBe('selected')
        expect(changeCharMock).toHaveBeenCalledWith(1, { quiet: true })
        expect(switchTarget.phase).toBe('idle')
    })

    test('a group switches with the plain call and leaves nothing pending', async () => {
        const [, g] = install([warm('a'), group('g')])
        changeCharMock.mockResolvedValue('selected')

        await switchCharacter(g)

        expect(changeCharMock).toHaveBeenCalledWith(1)
        expect(switchTarget.phase).toBe('idle')
    })

    test('a stub is loading while the restore runs and idle once it is selected', async () => {
        const [, s] = install([warm('a'), stub('s')])
        const calls = holdChangeChar()

        const pending = switchCharacter(s)

        expect(switchTarget.phase).toBe('loading')
        expect(switchTarget.target).toBe(s)
        expect(changeCharMock).toHaveBeenCalledWith(1, { quiet: true })
        selectedCharID.set(1)
        calls[0].resolve('selected')
        await pending
        expect(switchTarget.phase).toBe('idle')
        expect(switchTarget.target).toBeNull()
    })

    test('TA7: a refused restore ends failed with its reason and no alert; retry runs again; back clears without moving the selection', async () => {
        const [, s] = install([warm('a'), stub('s')])
        selectedCharID.set(0)
        const calls = holdChangeChar()

        const first = switchCharacter(s)
        calls[0].resolve({ failed: 'missing' })
        await first
        expect(switchTarget.phase).toBe('failed')
        expect(switchTarget.reason).toBe('missing')
        expect(switchTarget.target).toBe(s)
        expect(alertNormal).not.toHaveBeenCalled()
        expect(alertError).not.toHaveBeenCalled()

        const retry = retrySwitch()
        expect(switchTarget.phase).toBe('loading')
        expect(changeCharMock).toHaveBeenCalledTimes(2)
        selectedCharID.set(1)
        calls[1].resolve('selected')
        await retry
        expect(switchTarget.phase).toBe('idle')
        expect(selIdState.selId).toBe(1)
    })

    test('TA7: back from a failed switch clears it and leaves the selection where it was', async () => {
        const [, s] = install([warm('a'), stub('s'), warm('c')])
        selectedCharID.set(2)
        const calls = holdChangeChar()

        const pending = switchCharacter(s)
        calls[0].resolve({ failed: 'unreadable' })
        await pending
        expect(switchTarget.phase).toBe('failed')

        backToPrevious()

        expect(switchTarget.phase).toBe('idle')
        expect(switchTarget.reason).toBeNull()
        expect(selIdState.selId).toBe(2)
        expect(get(selectedCharID)).toBe(2)
    })

    test.each(['loading', 'failed'] as const)('abandonPendingSwitch ends a %s switch, supersedes the running restore and keeps the selection', async (phase) => {
        const [, s] = install([warm('a'), stub('s')])
        selectedCharID.set(0)
        const calls = holdChangeChar()

        const run = switchCharacter(s)
        if (phase === 'failed') {
            calls[0].resolve({ failed: 'missing' })
            await run
        }
        expect(switchTarget.phase).toBe(phase)

        abandonPendingSwitch()

        expect(supersedeMock).toHaveBeenCalledTimes(1)
        expect(switchTarget.phase).toBe('idle')
        expect(switchTarget.target).toBeNull()
        expect(switchTarget.reason).toBeNull()
        expect(get(selectedCharID)).toBe(0)

        // The outcome of the abandoned switch never revives it.
        calls[0].resolve({ failed: 'missing' })
        await run
        expect(switchTarget.phase).toBe('idle')
    })

    test('abandonPendingSwitch does nothing while idle', () => {
        install([warm('a')])
        abandonPendingSwitch()
        expect(supersedeMock).not.toHaveBeenCalled()
        expect(switchTarget.phase).toBe('idle')
    })

    test('TA7: a newer switch clears the older one, and the older outcome never revives it', async () => {
        const [, s, w] = install([warm('a'), stub('s'), warm('w')])
        const calls = holdChangeChar()

        const older = switchCharacter(s)
        expect(switchTarget.phase).toBe('loading')
        const newer = switchCharacter(w)
        expect(switchTarget.phase).toBe('idle')
        calls[1].resolve('selected')
        await newer

        calls[0].resolve({ failed: 'missing' })
        await older

        expect(switchTarget.phase).toBe('idle')
        expect(switchTarget.target).toBeNull()
        expect(alertNormal).not.toHaveBeenCalled()
    })

    test('TA9: a foreign selection change while loading clears the pending switch', async () => {
        const [, s] = install([warm('a'), stub('s'), warm('c')])
        const calls = holdChangeChar()

        const pending = switchCharacter(s)
        expect(switchTarget.phase).toBe('loading')
        selectedCharID.set(2)

        expect(switchTarget.phase).toBe('idle')
        calls[0].resolve('superseded')
        await pending
        expect(switchTarget.phase).toBe('idle')
    })

    test('TA9: a foreign selection change clears a failed switch', async () => {
        const [, s] = install([warm('a'), stub('s'), warm('c')])
        const calls = holdChangeChar()

        const pending = switchCharacter(s)
        calls[0].resolve({ failed: 'missing' })
        await pending
        expect(switchTarget.phase).toBe('failed')

        selectedCharID.set(2)

        expect(switchTarget.phase).toBe('idle')
    })

    test('TA10: superseded ends the pending state', async () => {
        const [, s] = install([warm('a'), stub('s')])
        const calls = holdChangeChar()

        const pending = switchCharacter(s)
        calls[0].resolve('superseded')
        await pending

        expect(switchTarget.phase).toBe('idle')
        expect(alertNormal).not.toHaveBeenCalled()
    })

    test('TA11: a reply that started during the read does not keep the switch pending', async () => {
        const [, s] = install([warm('a'), stub('s')])
        const calls = holdChangeChar()

        const pending = switchCharacter(s)
        doingChat.set(true)
        calls[0].resolve('selected')
        await pending

        expect(switchTarget.phase).toBe('idle')
        expect(alertNormal).not.toHaveBeenCalled()
    })

    test('gone ends the pending state without a notice', async () => {
        const [, s] = install([warm('a'), stub('s')])
        const calls = holdChangeChar()

        const pending = switchCharacter(s)
        calls[0].resolve('gone')
        await pending

        expect(switchTarget.phase).toBe('idle')
        expect(alertNormal).not.toHaveBeenCalled()
    })

    test('TA12: the index is resolved when the switch is requested, not when the entry was rendered', async () => {
        const characters = install([warm('a'), warm('b')])
        const rendered = characters[1]
        characters.unshift(warm('new'))
        changeCharMock.mockResolvedValue('selected')

        await switchCharacter(rendered)

        expect(changeCharMock).toHaveBeenCalledWith(2, { quiet: true })
    })

    test('TA12: an entry no longer in the list is found by its sole chaId holder', async () => {
        install([warm('a'), warm('b')])
        changeCharMock.mockResolvedValue('selected')

        await switchCharacter(warm('b'))

        expect(changeCharMock).toHaveBeenCalledWith(1, { quiet: true })
    })

    test('TA12: an entry in the list wins over another slot that shares its chaId', async () => {
        const characters = install([warm('x'), warm('b'), warm('x')])
        changeCharMock.mockResolvedValue('selected')

        expect(await switchCharacter(characters[2])).toBe('selected')

        expect(changeCharMock).toHaveBeenCalledWith(2, { quiet: true })
    })

    test('TA12: a request after the list changed resolves the slot again', async () => {
        const characters = install([warm('a'), warm('b')])
        const rendered = characters[1]
        changeCharMock.mockResolvedValue('selected')

        await switchCharacter(rendered)
        characters.unshift(warm('new'))
        await switchCharacter(rendered)

        expect(changeCharMock).toHaveBeenNthCalledWith(1, 1, { quiet: true })
        expect(changeCharMock).toHaveBeenNthCalledWith(2, 2, { quiet: true })
    })

    test('TA12: an entry that is gone, or whose chaId is shared, is not switched to', async () => {
        install([warm('a'), warm('b'), warm('b')])

        expect(await switchCharacter(warm('missing'))).toBe('gone')
        expect(await switchCharacter(warm('b'))).toBe('gone')

        expect(changeCharMock).not.toHaveBeenCalled()
        expect(switchTarget.phase).toBe('idle')
        expect(alertNormal).not.toHaveBeenCalled()
    })

    test('TA13: a warm switch clears a failed one', async () => {
        const [, s, w] = install([warm('a'), stub('s'), warm('w')])
        const calls = holdChangeChar()

        const failed = switchCharacter(s)
        calls[0].resolve({ failed: 'missing' })
        await failed
        expect(switchTarget.phase).toBe('failed')

        const warmSwitch = switchCharacter(w)
        expect(switchTarget.phase).toBe('idle')
        calls[1].resolve('selected')
        await warmSwitch
    })
})

describe('a changeChar that throws (S1 to S9)', () => {
    const boom = new Error('boom')
    // Resolves to 'rejected' when the switch rejects, so a defect is an assertion failure and not an unhandled rejection.
    const settled = (run: Promise<ChangeCharOutcome>) => run.then((outcome) => outcome, () => 'rejected' as const)

    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        // A failed state left behind would otherwise supersede from the next test's selection reset.
        clearPending()
        vi.mocked(console.error).mockRestore()
    })

    test('S1: a cold switch that throws while current ends failed/unreadable, resolves, and shows no alert', async () => {
        const [, s] = install([warm('a'), stub('s')])
        selectedCharID.set(0)
        const calls = holdChangeChar()

        const run = switchCharacter(s)
        expect(switchTarget.phase).toBe('loading')
        calls[0].reject(boom)

        expect(await settled(run)).toEqual({ failed: 'unreadable' })
        expect(switchTarget.phase).toBe('failed')
        expect(switchTarget.reason).toBe('unreadable')
        expect(switchTarget.target).toBe(s)
        expect(alertError).not.toHaveBeenCalled()
        expect(alertNormal).not.toHaveBeenCalled()
    })

    test('S2: a thrown cold switch keeps its watcher: a foreign selection move clears it and supersedes', async () => {
        const [, s] = install([warm('a'), stub('s'), warm('c')])
        selectedCharID.set(0)
        const calls = holdChangeChar()

        const run = switchCharacter(s)
        calls[0].reject(boom)
        expect(await settled(run)).toEqual({ failed: 'unreadable' })
        expect(switchTarget.phase).toBe('failed')

        selectedCharID.set(2)

        expect(switchTarget.phase).toBe('idle')
        expect(supersedeMock).toHaveBeenCalledTimes(1)
    })

    test.each(['back', 'abandon', 'move'] as const)('S3: a cold switch that throws after %s resolves superseded and leaves the state idle', async (how) => {
        const [, s] = install([warm('a'), stub('s'), warm('c')])
        selectedCharID.set(0)
        const calls = holdChangeChar()

        const run = switchCharacter(s)
        if (how === 'back') {
            backToPrevious()
        } else if (how === 'abandon') {
            abandonPendingSwitch()
        } else {
            selectedCharID.set(2)
        }
        expect(switchTarget.phase).toBe('idle')
        calls[0].reject(boom)

        expect(await settled(run)).toBe('superseded')
        expect(switchTarget.phase).toBe('idle')
        expect(switchTarget.target).toBeNull()
        expect(switchTarget.reason).toBeNull()
        expect(alertError).not.toHaveBeenCalled()
    })

    test('S4: an older cold switch that throws after a newer one started leaves the newer state alone', async () => {
        const [, s, t] = install([warm('a'), stub('s'), stub('t')])
        selectedCharID.set(0)
        const calls = holdChangeChar()

        const older = switchCharacter(s)
        const newer = switchCharacter(t)
        calls[0].reject(boom)

        expect(await settled(older)).toBe('superseded')
        expect(switchTarget.phase).toBe('loading')
        expect(switchTarget.target).toBe(t)

        selectedCharID.set(2)
        calls[1].resolve('selected')
        expect(await newer).toBe('selected')
        expect(switchTarget.phase).toBe('idle')
    })

    test('S8a: a Retry of a target that is now resident is loading at once, and a throw ends failed with the watcher kept', async () => {
        const [, s] = install([warm('a'), stub('s'), warm('c')])
        selectedCharID.set(0)
        const calls = holdChangeChar()

        const first = switchCharacter(s)
        calls[0].resolve({ failed: 'missing' })
        await first
        expect(switchTarget.phase).toBe('failed')
        // The refused restore left the character resident, as `restoreColdCharacter` does.
        DBState.db.characters[1] = warm('s')

        const retry = retrySwitch()
        expect(switchTarget.phase).toBe('loading')
        expect(switchTarget.target).toBe(s)
        expect(changeCharMock).toHaveBeenLastCalledWith(1, { quiet: true })
        calls[1].reject(boom)

        expect(await settled(retry!)).toEqual({ failed: 'unreadable' })
        expect(switchTarget.phase).toBe('failed')
        expect(switchTarget.reason).toBe('unreadable')
        expect(alertError).not.toHaveBeenCalled()

        selectedCharID.set(2)
        expect(switchTarget.phase).toBe('idle')
        expect(supersedeMock).toHaveBeenCalledTimes(1)
    })

    test('S8b: a cold throw, then a Retry that succeeds, ends idle with the target selected', async () => {
        const [, s] = install([warm('a'), stub('s')])
        selectedCharID.set(0)
        const calls = holdChangeChar()

        const first = switchCharacter(s)
        calls[0].reject(boom)
        expect(await settled(first)).toEqual({ failed: 'unreadable' })
        expect(switchTarget.phase).toBe('failed')
        DBState.db.characters[1] = warm('s')

        const retry = retrySwitch()
        expect(switchTarget.phase).toBe('loading')
        selectedCharID.set(1)
        calls[1].resolve('selected')

        expect(await settled(retry!)).toBe('selected')
        expect(switchTarget.phase).toBe('idle')
        expect(selIdState.selId).toBe(1)
    })

    test('S8c: a Retry of a target that became a group is loading at once and calls changeChar with the index only', async () => {
        const [, s] = install([warm('a'), stub('s'), warm('c')])
        selectedCharID.set(0)
        const calls = holdChangeChar()

        const first = switchCharacter(s)
        calls[0].resolve({ failed: 'missing' })
        await first
        DBState.db.characters[1] = group('s')

        const retry = retrySwitch()
        expect(switchTarget.phase).toBe('loading')
        expect(changeCharMock).toHaveBeenLastCalledWith(1)
        calls[1].reject(boom)

        expect(await settled(retry!)).toEqual({ failed: 'unreadable' })
        expect(switchTarget.phase).toBe('failed')
        expect(switchTarget.reason).toBe('unreadable')
    })

    test.each(['warm', 'group'] as const)('S9a: a %s switch from idle that throws ends failed/unreadable, quietly, and a foreign move clears it', async (kind) => {
        // Three slots, so a foreign move lands on a real entry other than the one selected at the start.
        const [, w, g] = install([warm('a'), warm('w'), group('g')])
        selectedCharID.set(0)
        changeCharMock.mockRejectedValueOnce(boom)
        const target = kind === 'warm' ? w : g

        expect(await settled(switchCharacter(target))).toEqual({ failed: 'unreadable' })
        expect(switchTarget.phase).toBe('failed')
        expect(switchTarget.reason).toBe('unreadable')
        expect(switchTarget.target).toBe(target)
        expect(alertError).not.toHaveBeenCalled()
        expect(alertNormal).not.toHaveBeenCalled()

        selectedCharID.set(kind === 'warm' ? 2 : 1)

        expect(switchTarget.phase).toBe('idle')
        expect(supersedeMock).toHaveBeenCalledTimes(1)
    })

    test('S9b: a group switch that throws after the selection moved resolves superseded and installs no watcher', async () => {
        // Slot 2 is a real entry that is not the character selected at the start; with fewer slots a missing
        // slot reads as null and could equal a null start entry, hiding the move.
        const [, g] = install([warm('a'), group('g'), warm('c')])
        selectedCharID.set(0)
        const calls = holdChangeChar()

        const run = switchCharacter(g)
        selectedCharID.set(2)
        calls[0].reject(boom)

        expect(await settled(run)).toBe('superseded')
        expect(switchTarget.phase).toBe('idle')
        selectedCharID.set(1)
        expect(supersedeMock).not.toHaveBeenCalled()
    })

    test('S9c: a warm switch that throws after a newer cold switch started leaves the newer state alone', async () => {
        const [, w, s] = install([warm('a'), warm('w'), stub('s')])
        selectedCharID.set(0)
        const calls = holdChangeChar()

        const older = switchCharacter(w)
        const newer = switchCharacter(s)
        calls[0].reject(boom)

        expect(await settled(older)).toBe('superseded')
        expect(switchTarget.phase).toBe('loading')
        expect(switchTarget.target).toBe(s)

        selectedCharID.set(2)
        calls[1].resolve('selected')
        expect(await newer).toBe('selected')
        expect(switchTarget.phase).toBe('idle')
    })
})

describe('where a keyboard switch ends focus (resolveSwitchFocus)', () => {
    afterEach(() => {
        document.body.innerHTML = ''
    })

    function mountParts(): { transcript: HTMLElement, frame: HTMLElement, retry: HTMLElement } {
        document.body.innerHTML = ''
        const make = (part: string) => {
            const element = document.createElement('div')
            element.setAttribute('data-part', part)
            document.body.appendChild(element)
            return element
        }
        return { transcript: make('chat-transcript'), frame: make('chat-switch-frame'), retry: make('chat-switch-retry') }
    }

    test('a failed switch lands on Retry, a loading one on the frame, an idle one on the transcript', () => {
        const parts = mountParts()

        expect(resolveSwitchFocus('failed')).toBe(parts.retry)
        expect(resolveSwitchFocus('loading')).toBe(parts.frame)
        expect(resolveSwitchFocus('idle')).toBe(parts.transcript)
    })

    test('the element is looked up when asked, and nothing found is null rather than the body', () => {
        expect(resolveSwitchFocus('idle')).toBeNull()
        expect(resolveSwitchFocus('failed')).toBeNull()
        expect(resolveSwitchFocus('loading')).toBeNull()
    })
})
