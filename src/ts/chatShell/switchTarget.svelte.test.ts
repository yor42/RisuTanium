/**
 * `switchCharacter` and the pending-switch state (`switchTarget.svelte.ts`).
 *
 * Invariants exercised here:
 * - A switch while a reply is being written is refused with a notice and
 *   changes nothing; other outcomes of the underlying `changeChar` end the
 *   pending state, except a refused restore, which stays as `failed` for the
 *   frame to show.
 * - The pending state never outlives a foreign selection change, a newer
 *   switch or a non-failed outcome, and a stale outcome never revives it.
 * - The character index is resolved when the switch is requested.
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
import { language } from 'src/lang'
import { resolveSwitchFocus } from './overlayFocus'
import { switchTarget, switchCharacter, retrySwitch, backToPrevious, abandonPendingSwitch, clearPending, refuseSwitchWhileWriting } from './switchTarget.svelte'

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

    test('TA5: a switch while a reply is written is refused with the notice and changes nothing', async () => {
        const [first] = install([warm('a'), warm('b')])
        doingChat.set(true)

        const outcome = await switchCharacter(first)

        expect(outcome).toBe('busy')
        expect(alertNormal).toHaveBeenCalledTimes(1)
        expect(alertNormal).toHaveBeenCalledWith(language.chatShellSwitchRefusedWriting)
        expect(changeCharMock).not.toHaveBeenCalled()
        expect(switchTarget.phase).toBe('idle')
    })

    test('refuseSwitchWhileWriting reports whether it refused, and only notices when it did', () => {
        expect(refuseSwitchWhileWriting()).toBe(false)
        expect(alertNormal).not.toHaveBeenCalled()
        doingChat.set(true)
        expect(refuseSwitchWhileWriting()).toBe(true)
        expect(alertNormal).toHaveBeenCalledTimes(1)
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

    test('TA11: a reply that started during the read ends the pending state with the notice', async () => {
        const [, s] = install([warm('a'), stub('s')])
        const calls = holdChangeChar()

        const pending = switchCharacter(s)
        doingChat.set(true)
        calls[0].resolve('busy')
        await pending

        expect(switchTarget.phase).toBe('idle')
        expect(alertNormal).toHaveBeenCalledTimes(1)
        expect(alertNormal).toHaveBeenCalledWith(language.chatShellSwitchRefusedWriting)
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
