// @vitest-environment jsdom
/**
 * The save chip over a real save ack with injected dependencies and a clock that moves only when the test says
 * so. "Saved" appears only after a commit that covers the edit; "Saving" only after the pending delay; a failure
 * or an unconfirmed save stays with a Retry until it is used; changed elsewhere takes precedence and offers none.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/globalApi.svelte', () => ({}))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return { frozenSaveKeysStore: writable([]), DBState: { db: { characters: [] } }, selIdState: { selId: 0 } }
})
vi.mock('src/lang', async () => {
    const helpers = await import('src/ts/studio/studioFixtures.test-helpers')
    return { language: helpers.studioLanguageMock() }
})

import {
    ACK_BOUND_MS,
    ACK_CEILING_MS,
    PENDING_DELAY_MS,
    createSaveAck,
    type SaveAck,
    type SaveAckDeps,
} from 'src/ts/studio/edit/saveAck.svelte'
import { createFakeClock, type FakeClock } from 'src/ts/studio/history/tests/historyTestKit.test-helpers'
import StudioStatusChip from './StudioStatusChip.svelte'

interface Controls {
    deps: SaveAckDeps
    clock: FakeClock
    requestSaveNow: ReturnType<typeof vi.fn>
    // Marks counted so far; an edit raises it by one, as the real mark counter does.
    mark(): void
    commit(): void
    passStart(): void
    peerSave(): void
}

function makeDeps(): Controls {
    const clock = createFakeClock()
    let marks = 0
    let committed = 0
    let peers = 0
    const commitCallbacks = new Set<() => void>()
    const passCallbacks: (() => void)[] = []
    const requestSaveNow = vi.fn()
    const deps: SaveAckDeps = {
        getMarkCount: () => marks,
        getCommittedMarkCount: () => committed,
        afterNextCommit: (callback) => {
            commitCallbacks.add(callback)
        },
        requestSaveNow,
        getPeerSaveCount: () => peers,
        onStopped: () => () => {},
        isStopped: () => false,
        subscribeFailure: () => () => {},
        currentFailure: () => null,
        frozenKeys: () => new Set<string>(),
        isCharacterUnsavable: () => false,
        onPassStart: (callback) => {
            passCallbacks.push(callback)
            return () => {}
        },
        visible: () => true,
        onVisibilityChange: () => () => {},
        clock,
    }
    return {
        deps,
        clock,
        requestSaveNow,
        mark: () => {
            marks += 1
        },
        commit: () => {
            committed = marks
            const callbacks = [...commitCallbacks]
            commitCallbacks.clear()
            for (const callback of callbacks) callback()
        },
        passStart: () => {
            for (const callback of passCallbacks) callback()
        },
        peerSave: () => {
            peers += 1
        },
    }
}

let app: ReturnType<typeof mount> | undefined
let host: HTMLElement | undefined
let ack: SaveAck | undefined

function show(chipAck: SaveAck | null): void {
    host = document.createElement('div')
    document.body.appendChild(host)
    app = mount(StudioStatusChip, { target: host, props: { ack: chipAck } })
    flushSync()
}

function edit(c: Controls, chaId = 'A'): void {
    const before = c.deps.getMarkCount()
    c.mark()
    ack?.noteEdit(chaId, before)
    flushSync()
}

const chip = () => document.querySelector<HTMLElement>('[data-part="studio-chip"]')
const retry = () => document.querySelector<HTMLButtonElement>('[data-part="studio-chip-retry"]')
const text = () => document.querySelector('[data-part="studio-chip-text"]')?.textContent ?? ''

beforeEach(() => {
    ack = undefined
})

afterEach(async () => {
    ack?.dispose()
    if (app) await unmount(app)
    app = undefined
    host?.remove()
    host = undefined
})

describe('T-UI2 the chip follows the ack', () => {
    test('without an ack, or before any edit, the live region exists and says nothing', () => {
        show(null)
        expect(chip()?.getAttribute('role')).toBe('status')
        expect(chip()?.getAttribute('data-state')).toBe('idle')
        expect(text()).toBe('')
        expect(retry()).toBeNull()
    })

    test('an edit is pending but silent for the pending delay, then "Saving"; a covering commit gives "Saved"', () => {
        const c = makeDeps()
        ack = createSaveAck(c.deps)
        show(ack)
        edit(c)
        expect(text()).toBe('')
        c.clock.tick(PENDING_DELAY_MS - 1)
        flushSync()
        expect(text()).toBe('')
        c.clock.tick(1)
        flushSync()
        expect(chip()?.getAttribute('data-state')).toBe('pending')
        expect(text()).toBe('studioChipSaving')
        expect(retry()).toBeNull()
        c.commit()
        flushSync()
        expect(chip()?.getAttribute('data-state')).toBe('saved')
        expect(text()).toBe('studioChipSaved')
    })

    test('a commit that does not cover the latest edit is not "Saved" (M12)', () => {
        const c = makeDeps()
        ack = createSaveAck(c.deps)
        show(ack)
        edit(c)
        c.commit()
        edit(c)
        c.clock.tick(PENDING_DELAY_MS)
        flushSync()
        expect(chip()?.getAttribute('data-state')).toBe('pending')
        expect(text()).toBe('studioChipSaving')
    })

    test('an edit whose mark was not counted shows "Not saved" with Retry', () => {
        const c = makeDeps()
        ack = createSaveAck(c.deps)
        show(ack)
        // The mark counter did not move: nothing will save this edit.
        ack.noteEdit('A', c.deps.getMarkCount())
        flushSync()
        expect(chip()?.getAttribute('data-state')).toBe('failed')
        expect(text()).toBe('studioChipFailed')
        expect(retry()?.textContent).toBe('studioChipRetry')
    })
})

describe('decisions 19 and 21: not confirmed after 30 s, and the 120 s ceiling', () => {
    test('no commit for 30 s shows "Save not confirmed" with Retry, which stays until Retry is used', () => {
        const c = makeDeps()
        ack = createSaveAck(c.deps)
        show(ack)
        edit(c)
        c.clock.tick(ACK_BOUND_MS - 1)
        flushSync()
        expect(chip()?.getAttribute('data-state')).toBe('pending')
        expect(retry()).toBeNull()
        c.clock.tick(1)
        flushSync()
        expect(chip()?.getAttribute('data-state')).toBe('unconfirmed')
        expect(text()).toBe('studioChipUnconfirmed')
        expect(retry()).not.toBeNull()
        // A covering commit later does not turn the sticky state into "Saved": only Retry moves it.
        c.commit()
        flushSync()
        expect(chip()?.getAttribute('data-state')).toBe('unconfirmed')
    })

    test('passes that start but never commit still end in "not confirmed" at the 120 s ceiling', () => {
        const c = makeDeps()
        ack = createSaveAck(c.deps)
        show(ack)
        edit(c)
        // A pass every 20 s keeps restarting the 30 s bound, so only the ceiling can end the wait.
        for (let elapsed = 20_000; elapsed < ACK_CEILING_MS; elapsed += 20_000) {
            c.clock.tick(20_000)
            c.passStart()
            flushSync()
            expect(chip()?.getAttribute('data-state')).toBe('pending')
        }
        c.clock.tick(ACK_CEILING_MS - 100_000 - 1)
        flushSync()
        expect(chip()?.getAttribute('data-state')).toBe('pending')
        c.clock.tick(1)
        flushSync()
        expect(chip()?.getAttribute('data-state')).toBe('unconfirmed')
        expect(retry()).not.toBeNull()
    })

    test('Retry asks for a save now and goes back to pending; a covering commit then gives "Saved"', () => {
        const c = makeDeps()
        ack = createSaveAck(c.deps)
        show(ack)
        edit(c)
        c.clock.tick(ACK_BOUND_MS)
        flushSync()
        retry()?.click()
        flushSync()
        expect(c.requestSaveNow).toHaveBeenCalledTimes(1)
        // Retry is gone at once; "Saving" follows after the pending delay like for any edit.
        expect(retry()).toBeNull()
        c.clock.tick(PENDING_DELAY_MS)
        flushSync()
        expect(chip()?.getAttribute('data-state')).toBe('pending')
        expect(text()).toBe('studioChipSaving')
        c.commit()
        flushSync()
        expect(chip()?.getAttribute('data-state')).toBe('saved')
    })
})

describe('changed elsewhere', () => {
    test('a peer save shows the degraded chip with no Retry, even over an unconfirmed save (M44)', () => {
        const c = makeDeps()
        ack = createSaveAck(c.deps)
        show(ack)
        edit(c)
        c.clock.tick(ACK_BOUND_MS)
        flushSync()
        expect(retry()).not.toBeNull()
        c.peerSave()
        c.clock.tick(2000)
        flushSync()
        expect(chip()?.getAttribute('data-state')).toBe('changedElsewhere')
        expect(text()).toBe('studioChipChangedElsewhere')
        expect(retry()).toBeNull()
    })
})
