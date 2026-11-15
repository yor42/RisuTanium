/**
 * How a blocking alert (a prompt) behaves when another alert covers it, when
 * code closes the store, and when a second prompt is asked for.
 *
 * Drives the REAL `alert.ts` (and `upstreamAgreement.ts`'s answer constant) over
 * a real `writable` standing in for `alertStore` from `stores.svelte`, as
 * `alert.blockingAnswer.test.ts` does. A user's answer is written to the raw
 * store the way `AlertComp.svelte` and `hotkey.ts` write it: `{ type: 'none',
 * msg: <answer> }`. Code that closes an alert goes through `alert.ts`:
 * `alertClear()` or the `alertStore` wrapper's `set`.
 *
 * Invariants pinned here:
 *  - a prompt's caller receives only the answer given while that prompt is the
 *    value on screen; never a cover's close, a code close, or another prompt's
 *    answer;
 *  - a cover shows at once, and the prompt it covered comes back when the cover
 *    closes;
 *  - prompts are shown in the order they were asked, and a prompt that a cover
 *    the user cannot close hides is put back on screen when another prompt is
 *    queued;
 *  - for 400 ms after a prompt appears on screen, however it got there (asked
 *    fresh, back from under a cover, or its turn arrived), an answer to it is
 *    discarded.
 *
 * Fake timers are on for every test, so the 400 ms guard is a clock the test
 * moves. Every outcome is read from a flag, never awaited, so a prompt that
 * wrongly stays pending fails an assertion instead of hanging the run.
 *
 * Tests whose title starts with `guard:` pass with or without the fix: they pin
 * behaviour that must be preserved.
 */
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { alertData } from './alert'

//#region module mocks

vi.mock(import('./stores.svelte'), () => ({
    alertStore: writable({ type: 'none', msg: '' }),
}) as unknown as typeof import('./stores.svelte'))

vi.mock(import('./storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
}) as unknown as typeof import('./storage/database.svelte'))

vi.mock(import('./platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('./platform'))

//#endregion

import {
    alertAddCharacter,
    alertCardExport,
    alertChatOptions,
    alertClear,
    alertConfirm,
    alertError,
    alertInput,
    alertModuleSelect,
    alertNormal,
    alertNormalWait,
    alertSelect,
    alertSelectChar,
    alertStaleAccountNotice,
    alertToast,
    alertWait,
    alertStore as alertStoreWrapper,
    STALE_ACCOUNT_NOTICE_ACK,
    waitAlert,
} from './alert'
import { alertStore } from './stores.svelte'
import { resetAlertPromptsForTests } from './alertPrompts'
import { UPSTREAM_AGREEMENT_ACCEPT } from './upstreamAgreement'

//#region helpers

const NONE: alertData = { type: 'none', msg: '' }

/** Just past the 400 ms during which an answer to a returning or next-in-turn prompt is discarded. */
const GUARD_MS = 401

function shown(): alertData {
    return get(alertStore) as alertData
}

/** What a user's answer writes: the alert ends and its `msg` is the answer. */
function answer(msg: string): void {
    alertStore.set({ type: 'none', msg })
}

/** What a caller has received so far from a promise. */
interface Outcome<T> {
    settled: boolean
    value?: T
    rejected?: unknown
}

function track<T>(promise: Promise<T>): Outcome<T> {
    const outcome: Outcome<T> = { settled: false }
    promise.then(
        (value) => { outcome.settled = true; outcome.value = value },
        (error: unknown) => { outcome.settled = true; outcome.rejected = error },
    )
    return outcome
}

/** Lets every promise continuation that is ready run. */
async function settle(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0)
}

async function passGuard(): Promise<void> {
    await vi.advanceTimersByTimeAsync(GUARD_MS)
}

interface PromptSpec {
    name: string
    ask: () => Promise<unknown>
    type: alertData['type']
    answer: string
    expected: unknown
}

/** Every prompt `alert.ts` can put up, with an answer for it and what its caller gets for that answer. */
const PROMPTS: PromptSpec[] = [
    { name: 'confirm', ask: () => alertConfirm('Proceed?'), type: 'ask', answer: 'no', expected: false },
    { name: 'select', ask: () => alertSelect(['first', 'second']), type: 'select', answer: '1', expected: '1' },
    { name: 'input', ask: () => alertInput('Name?'), type: 'input', answer: 'Ann', expected: 'Ann' },
    { name: 'character picker', ask: () => alertSelectChar(), type: 'selectChar', answer: 'char-1', expected: 'char-1' },
    { name: 'add character', ask: () => alertAddCharacter(), type: 'addchar', answer: 'import', expected: 'import' },
    { name: 'chat options', ask: () => alertChatOptions(), type: 'chatOptions', answer: '2', expected: 2 },
    { name: 'card export', ask: () => alertCardExport(), type: 'cardexport', answer: JSON.stringify({ type: 'a', type2: 'b' }), expected: { type: 'a', type2: 'b' } },
    { name: 'module picker', ask: () => alertModuleSelect(), type: 'selectModule', answer: '["module-a"]', expected: '["module-a"]' },
]

interface CoverSpec {
    name: string
    type: alertData['type']
    put: () => void
    /** How the cover ends: what its own close writes. */
    close: () => void
}

const COVERS: CoverSpec[] = [
    {
        name: 'a toast whose animation ends',
        type: 'toast',
        put: () => { alertToast('Saved') },
        close: () => { alertStore.set(NONE) },
    },
    {
        name: 'an error closed with Enter',
        type: 'error',
        put: () => { alertError('Something failed') },
        close: () => { answer('yes') },
    },
    {
        name: 'a wait notice cleared by code',
        type: 'wait',
        put: () => { alertWait('Loading...') },
        close: () => { alertClear() },
    },
    {
        name: 'a progress notice closed through the store wrapper',
        type: 'progress',
        put: () => { alertStoreWrapper.set({ type: 'progress', msg: 'Saving', submsg: '40' }) },
        close: () => { alertStoreWrapper.set({ type: 'none', msg: '' }) },
    },
]

beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    resetAlertPromptsForTests()
    alertStore.set(NONE)
    vi.useRealTimers()
    vi.restoreAllMocks()
})

//#endregion

describe('a prompt that another alert covers', () => {
    test('a confirm covered by a notice is not answered when the notice is closed with yes, and answering it after the guard resolves it', async () => {
        const confirm = track(alertConfirm('Allow the plugin?'))
        const asked = shown()
        await passGuard()
        alertNormal('A notice')
        expect.soft(shown(), 'the notice shows at once').toMatchObject({ type: 'normal', msg: 'A notice' })

        answer('yes')
        await settle()

        expect.soft(confirm.settled, 'the confirm settled when the notice closed').toBe(false)
        expect.soft(shown(), 'the store after the notice closed').toEqual(asked)
        await passGuard()
        answer('no')
        await settle()
        expect.soft(confirm, 'the confirm after its own answer').toMatchObject({ settled: true, value: false })
    })

    describe.each(COVERS)('$name', (cover) => {
        test.each(PROMPTS)('a covered $name prompt is not answered by the cover closing, comes back, and takes only its own answer', async (prompt) => {
            const outcome = track(prompt.ask())
            const asked = shown()
            expect(asked.type).toBe(prompt.type)

            await passGuard()
            cover.put()
            expect.soft(shown().type, 'the cover shows at once').toBe(cover.type)
            cover.close()
            await settle()

            expect.soft(outcome.settled, 'the prompt settled when the cover closed').toBe(false)
            expect.soft(shown(), 'the store after the cover closed').toEqual(asked)
            await passGuard()
            answer(prompt.answer)
            await settle()
            expect.soft(outcome, 'the prompt after its own answer').toMatchObject({ settled: true, value: prompt.expected })
        })
    })

    test('a prompt covered twice in a row comes back once, after the last cover closes', async () => {
        const confirm = track(alertConfirm('Proceed?'))
        const asked = shown()

        alertNormal('First notice')
        alertToast('A toast over the notice')
        expect.soft(shown().type, 'the second cover replaces the first').toBe('toast')
        alertStore.set(NONE)
        await settle()

        expect.soft(confirm.settled, 'the confirm settled when the last cover closed').toBe(false)
        expect.soft(shown(), 'the store after the last cover closed').toEqual(asked)
    })
})

describe('code that closes the alert store while a prompt is showing', () => {
    describe.each([
        { name: 'alertClear', close: () => { alertClear() } },
        { name: 'the store wrapper', close: () => { alertStoreWrapper.set({ type: 'none', msg: '' }) } },
    ])('$name', (closer) => {
        test.each(PROMPTS)('a showing $name prompt stays showing and pending, and still takes its own answer', async (prompt) => {
            const outcome = track(prompt.ask())
            const asked = shown()

            await passGuard()
            closer.close()
            await settle()

            expect.soft(shown(), 'the store after the code close').toEqual(asked)
            expect.soft(outcome.settled, 'the prompt settled at the code close').toBe(false)
            answer(prompt.answer)
            await settle()
            expect.soft(outcome, 'the prompt after its own answer').toMatchObject({ settled: true, value: prompt.expected })
        })
    })

    test('a code close while a cover is showing closes the cover', async () => {
        const confirm = track(alertConfirm('Proceed?'))
        const asked = shown()
        alertNormal('A notice')

        alertClear()
        await settle()

        expect.soft(shown().type, 'the cover after the code close').not.toBe('normal')
        expect.soft(confirm.settled, 'the confirm settled').toBe(false)
        expect.soft(shown(), 'the prompt is back').toEqual(asked)
    })
})

describe('a second prompt asked for while a prompt is waiting', () => {
    test('the second confirm waits until the first is answered, and each takes only its own answer', async () => {
        const first = track(alertConfirm('First?'))
        const firstAsked = shown()
        const second = track(alertConfirm('Second?'))
        expect.soft(shown(), 'the store while both are asked').toEqual(firstAsked)

        await passGuard()
        answer('yes')
        await settle()

        expect.soft(first, 'the first confirm after its answer').toMatchObject({ settled: true, value: true })
        expect.soft(second.settled, 'the second confirm settled with the first one\'s answer').toBe(false)
        expect.soft(shown(), 'the store after the first was answered').toMatchObject({ type: 'ask', msg: 'Second?' })
        await passGuard()
        answer('')
        await settle()
        expect.soft(second, 'the second confirm after its own answer').toMatchObject({ settled: true, value: false })
    })

    test('three prompts asked in a row are shown in the order they were asked', async () => {
        const first = track(alertConfirm('First?'))
        const second = track(alertSelect(['a', 'b']))
        const third = track(alertInput('Third?'))
        const order: string[] = []

        order.push(`${shown().type}`)
        await passGuard()
        answer('yes')
        await settle()
        order.push(`${shown().type}`)
        await passGuard()
        answer('1')
        await settle()
        order.push(`${shown().type}`)
        await passGuard()
        answer('typed')
        await settle()

        expect.soft(order, 'the type on screen at each step').toEqual(['ask', 'select', 'input'])
        expect.soft([first, second, third].map((outcome) => outcome.value), 'the answers each caller received').toEqual([true, '1', 'typed'])
    })
})

describe('a consent prompt goes ahead of a waiting prompt', () => {
    interface ConsentSpec {
        name: string
        type: alertData['type']
        post: () => void
        answer: () => void
    }
    const CONSENTS: ConsentSpec[] = [
        {
            name: 'the terms prompt',
            type: 'tos',
            post: () => { alertStore.set({ type: 'tos', msg: 'tos' }) },
            answer: () => { answer(UPSTREAM_AGREEMENT_ACCEPT) },
        },
        {
            name: 'the stale-account notice',
            type: 'staleAccountNotice',
            post: () => { track(alertStaleAccountNotice()) },
            answer: () => { answer(STALE_ACCOUNT_NOTICE_ACK) },
        },
    ]

    test.each(CONSENTS)('a confirm waiting when $name is put up and answered is not answered by it, and comes back', async (consent) => {
        const confirm = track(alertConfirm('Proceed?'))
        const asked = shown()

        await passGuard()
        consent.post()
        expect.soft(shown().type, 'the consent shows at once').toBe(consent.type)
        consent.answer()
        await settle()

        expect.soft(confirm.settled, 'the confirm settled with the consent\'s answer').toBe(false)
        expect.soft(shown(), 'the store after the consent was answered').toEqual(asked)
        await passGuard()
        answer('yes')
        await settle()
        expect.soft(confirm, 'the confirm after its own answer').toMatchObject({ settled: true, value: true })
    })

    test('a prompt asked for while the terms prompt is up waits, and shows after the terms prompt is answered', async () => {
        alertStore.set({ type: 'tos', msg: 'tos' })

        const confirm = track(alertConfirm('Proceed?'))

        expect.soft(shown().type, 'the alert on screen while the terms prompt is up').toBe('tos')
        answer(UPSTREAM_AGREEMENT_ACCEPT)
        await settle()
        expect.soft(confirm.settled, 'the confirm settled with the terms answer').toBe(false)
        expect.soft(shown(), 'the store after the terms prompt was answered').toMatchObject({ type: 'ask', msg: 'Proceed?' })
    })
})

describe('a prompt whose cover the user cannot close', () => {
    const CLOSELESS: Array<{ name: string, type: alertData['type'], put: () => void }> = [
        { name: 'a wait notice without a cancel action', type: 'wait', put: () => { alertWait('Loading...') } },
        { name: 'a progress notice', type: 'progress', put: () => { alertStoreWrapper.set({ type: 'progress', msg: 'Saving', submsg: '40' }) } },
        { name: 'a wait notice set through the store wrapper', type: 'wait', put: () => { alertStoreWrapper.set({ type: 'wait', msg: 'Working' }) } },
    ]

    describe.each(CLOSELESS)('under $name', (cover) => {
        test('the covered prompt is put back on screen when a second prompt is asked for, and the second shows once the first is answered', async () => {
            const first = track(alertConfirm('P'))
            const firstAsked = shown()
            cover.put()
            expect.soft(shown().type, 'the cover shows at once').toBe(cover.type)
            const seen: string[] = []
            const stop = alertStore.subscribe((value) => { seen.push((value as alertData).type) })
            seen.length = 0

            const second = track(alertConfirm('Q'))

            expect.soft(shown(), 'the store once the second was asked for').toEqual(firstAsked)
            expect.soft(seen, 'the types the store held on the way').not.toContain('none')
            stop()
            await passGuard()
            answer('yes')
            await settle()
            expect.soft(first, 'the first confirm after its own answer').toMatchObject({ settled: true, value: true })
            expect.soft(second.settled, 'the second confirm settled with the first one\'s answer').toBe(false)
            expect.soft(shown(), 'the store after the first was answered').toMatchObject({ type: 'ask', msg: 'Q' })
        })
    })

    test('a progress notice written after the second prompt was queued covers the first prompt again, and its close brings the prompt back', async () => {
        const first = track(alertConfirm('P'))
        const firstAsked = shown()
        alertWait('Loading...')
        track(alertConfirm('Q'))
        expect.soft(shown(), 'the store once the second was asked for').toEqual(firstAsked)

        alertStoreWrapper.set({ type: 'progress', msg: 'Saving', submsg: '80' })
        expect.soft(shown().type, 'the progress notice shows at once').toBe('progress')
        alertClear()
        await settle()

        expect.soft(first.settled, 'the first confirm settled').toBe(false)
        expect.soft(shown(), 'the store after the progress notice closed').toEqual(firstAsked)
    })

    test('a notice the user can close stays in front of the first prompt when a second is asked for, and the first returns when the notice closes', async () => {
        const first = track(alertConfirm('P'))
        const firstAsked = shown()
        alertNormal('A notice')
        track(alertConfirm('Q'))

        expect.soft(shown(), 'the store once the second was asked for').toMatchObject({ type: 'normal', msg: 'A notice' })
        answer('')
        await settle()

        expect.soft(first.settled, 'the first confirm settled').toBe(false)
        expect.soft(shown(), 'the store after the notice closed').toEqual(firstAsked)
    })

    test('a wait notice with a cancel action stays in front of the first prompt when a second is asked for, and the first returns when the wait closes', async () => {
        const first = track(alertConfirm('P'))
        const firstAsked = shown()
        const wait = alertWait('Loading...', () => {})
        track(alertConfirm('Q'))

        expect.soft(shown(), 'the store once the second was asked for').toBe(wait)
        answer('')
        await settle()

        expect.soft(first.settled, 'the first confirm settled').toBe(false)
        expect.soft(shown(), 'the store after the wait closed').toEqual(firstAsked)
    })
})

describe('an answer given just after a prompt returns or its turn comes', () => {
    test('a confirm that comes back after a cover closes discards an answer within 400 ms and stays up, and takes one after that', async () => {
        const confirm = track(alertConfirm('Proceed?'))
        const asked = shown()
        await passGuard()
        alertNormal('A notice')
        answer('')
        await settle()
        expect.soft(shown(), 'the store once the notice closed').toEqual(asked)

        await vi.advanceTimersByTimeAsync(100)
        answer('yes')
        await settle()

        expect.soft(confirm.settled, 'the confirm settled on an answer inside the guard').toBe(false)
        expect.soft(shown(), 'the store after the discarded answer').toEqual(asked)
        await passGuard()
        answer('yes')
        await settle()
        expect.soft(confirm, 'the confirm after an answer outside the guard').toMatchObject({ settled: true, value: true })
    })

    test('a second prompt whose turn has come discards an answer within 400 ms and stays up, and takes one after that', async () => {
        const first = track(alertConfirm('First?'))
        const second = track(alertConfirm('Second?'))
        await passGuard()
        answer('yes')
        await settle()
        expect.soft(first, 'the first confirm after its answer').toMatchObject({ settled: true, value: true })
        const secondAsked = shown()
        expect.soft(secondAsked, 'the store once the second one\'s turn came').toMatchObject({ type: 'ask', msg: 'Second?' })

        await vi.advanceTimersByTimeAsync(100)
        answer('yes')
        await settle()

        expect.soft(second.settled, 'the second confirm settled on an answer inside the guard').toBe(false)
        expect.soft(shown(), 'the store after the discarded answer').toEqual(secondAsked)
        await passGuard()
        answer('')
        await settle()
        expect.soft(second, 'the second confirm after an answer outside the guard').toMatchObject({ settled: true, value: false })
    })

    test('a prompt that opens fresh discards an answer within 400 ms and stays up, and takes one after that', async () => {
        const confirm = track(alertConfirm('Proceed?'))
        const asked = shown()

        answer('yes')
        await settle()
        expect.soft(confirm.settled, 'the confirm settled on an answer at the moment it opened').toBe(false)
        expect.soft(shown(), 'the store after the discarded answer').toEqual(asked)

        await vi.advanceTimersByTimeAsync(100)
        answer('yes')
        await settle()
        expect.soft(confirm.settled, 'the confirm settled on an answer 100 ms after it opened').toBe(false)

        await passGuard()
        answer('yes')
        await settle()
        expect.soft(confirm, 'the confirm after an answer outside the guard').toMatchObject({ settled: true, value: true })
    })

    test('a follow-up confirm asked for right after the earlier one was answered discards an answer within 400 ms and stays up, and takes one after that', async () => {
        const first = track(alertConfirm('First?'))
        await passGuard()
        answer('yes')
        await settle()
        expect.soft(first, 'the first confirm after its answer').toMatchObject({ settled: true, value: true })

        const followUp = track(alertConfirm('Second?'))
        const followUpAsked = shown()
        answer('no')
        await settle()

        expect.soft(followUp.settled, 'the follow-up settled on an answer at the moment it opened').toBe(false)
        expect.soft(shown(), 'the store after the discarded answer').toEqual(followUpAsked)
        await vi.advanceTimersByTimeAsync(100)
        answer('no')
        await settle()
        expect.soft(followUp.settled, 'the follow-up settled on an answer 100 ms after it opened').toBe(false)
        expect.soft(shown(), 'the store after the second discarded answer').toEqual(followUpAsked)
        await passGuard()
        answer('no')
        await settle()
        expect.soft(followUp, 'the follow-up after an answer outside the guard').toMatchObject({ settled: true, value: false })
    })

    test('a follow-up select asked for right after a confirm was answered discards an answer within 400 ms and stays up, and takes one after that', async () => {
        const first = track(alertConfirm('First?'))
        await passGuard()
        answer('yes')
        await settle()
        expect.soft(first, 'the first confirm after its answer').toMatchObject({ settled: true, value: true })

        const followUp = track(alertSelect(['one', 'cancel', 'all'], 'Which?'))
        const followUpAsked = shown()
        answer('2')
        await settle()

        expect.soft(followUp.settled, 'the follow-up select settled on an answer at the moment it opened').toBe(false)
        expect.soft(shown(), 'the store after the discarded answer').toEqual(followUpAsked)
        await passGuard()
        answer('1')
        await settle()
        expect.soft(followUp, 'the follow-up select after an answer outside the guard').toMatchObject({ settled: true, value: '1' })
    })

    test('a prompt asked for long after the earlier one was answered still discards an answer within 400 ms of opening', async () => {
        const first = track(alertConfirm('First?'))
        await passGuard()
        answer('yes')
        await settle()
        expect.soft(first, 'the first confirm after its answer').toMatchObject({ settled: true, value: true })
        await vi.advanceTimersByTimeAsync(5000)

        const later = track(alertConfirm('Second?'))
        const laterAsked = shown()
        answer('no')
        await settle()

        expect.soft(later.settled, 'the later confirm settled on an answer at the moment it opened').toBe(false)
        expect.soft(shown(), 'the store after the discarded answer').toEqual(laterAsked)
        await passGuard()
        answer('no')
        await settle()
        expect.soft(later, 'the later confirm after an answer outside the guard').toMatchObject({ settled: true, value: false })
    })
})

describe('alerts that follow one another with no prompt waiting', () => {
    test('guard: a notice after a wait notice replaces it', () => {
        alertWait('Loading...')

        alertNormal('Done')

        expect(shown()).toMatchObject({ type: 'normal', msg: 'Done' })
    })

    test('guard: a confirm after a wait notice replaces it, and takes its answer', async () => {
        alertWait('Loading...')

        const confirm = track(alertConfirm('Proceed?'))

        expect.soft(shown()).toMatchObject({ type: 'ask', msg: 'Proceed?' })
        await passGuard()
        answer('yes')
        await settle()
        expect.soft(confirm).toMatchObject({ settled: true, value: true })
    })

    test('guard: clearing a wait notice with no prompt waiting leaves the store empty', () => {
        alertWait('Loading...')

        alertClear()

        expect(shown()).toEqual(NONE)
    })

    test('guard: clearing and then posting an error in the same tick leaves the error showing', () => {
        alertWait('Loading...')

        alertClear()
        alertError('Something failed')

        expect(shown()).toMatchObject({ type: 'error', msg: 'Something failed' })
    })

    test('guard: a progress loop that ends in none ends with an empty store and releases its waiter', async () => {
        alertStoreWrapper.set({ type: 'progress', msg: 'Saving', submsg: '0' })
        const waiter = track(waitAlert())

        alertStoreWrapper.set({ type: 'progress', msg: 'Saving', submsg: '50' })
        alertStoreWrapper.set({ type: 'progress', msg: 'Saving', submsg: '100' })
        await settle()
        expect.soft(waiter.settled, 'the waiter settled while progress was showing').toBe(false)
        alertClear()
        await settle()

        expect.soft(shown()).toEqual(NONE)
        expect.soft(waiter.settled, 'the waiter settled when progress ended').toBe(true)
    })
})

describe('a notice that waits for its own close, over a waiting prompt', () => {
    test('guard: alertNormalWait resolves when its notice closes, and not before', async () => {
        track(alertConfirm('Proceed?'))
        const notice = track(alertNormalWait('A notice'))

        expect.soft(shown(), 'the notice on screen').toMatchObject({ type: 'normal', msg: 'A notice' })
        await settle()
        expect.soft(notice.settled, 'the notice waiter settled while the notice was up').toBe(false)
        answer('yes')
        await settle()

        expect(notice.settled, 'the notice waiter after the notice closed').toBe(true)
    })
})
