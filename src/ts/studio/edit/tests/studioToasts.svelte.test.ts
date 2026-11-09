// @vitest-environment jsdom
// studioToasts.ts against a real toast host on a fake clock: one Undo toast per delete, its action
// through the history service's marked write path (also after Studio closed), refusals that never read
// as success and remove the action, and the dismissal when the delete is undone another way.
import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { createToastHost, resetToastHostForTests, toastHost, type ToastClock, type ToastHost } from 'src/ts/toast/toastHost.svelte'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService, type OwnerHistoryService, type OwnerView, type StudioRefusal, type StudioResult } from '../../history/ownerHistory.svelte'
import { characterOwnerKey, SAVE_DEBOUNCE_MS } from '../../history/ownerPhase'
import { createFakeClock } from '../../history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../history/tests/studioStoreDoubles'
import { createStudioToasts, refusalText, runDismissingConsumed } from '../studioToasts'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: { characters: [] } },
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
    }
})
vi.mock('src/lang', async () => {
    const helpers = await import('src/ts/studio/studioFixtures.test-helpers')
    return { language: helpers.studioLanguageMock() }
})

interface FakeToastClock extends ToastClock {
    advance(ms: number): void
}

function fakeToastClock(): FakeToastClock {
    let time = 0
    let nextKey = 1
    const timers = new Map<number, { at: number; run: () => void }>()
    return {
        now: () => time,
        after(ms, run) {
            const key = nextKey++
            timers.set(key, { at: time + ms, run })
            return () => {
                timers.delete(key)
            }
        },
        advance(ms) {
            const target = time + ms
            for (;;) {
                let next: [number, { at: number; run: () => void }] | null = null
                for (const entry of timers) {
                    if (entry[1].at <= target && (next === null || entry[1].at < next[1].at)) {
                        next = entry
                    }
                }
                if (next === null) {
                    break
                }
                timers.delete(next[0])
                time = next[1].at
                next[1].run()
            }
            time = target
        },
    }
}

const A = characterOwnerKey('A')
let clock: FakeToastClock
let host: ToastHost

function serviceReturning(result: StudioResult): { service: Pick<OwnerHistoryService, 'restoreDeleted'>; calls: [string, string][] } {
    const calls: [string, string][] = []
    return {
        calls,
        service: {
            restoreDeleted(owner, deletedId) {
                calls.push([owner, deletedId])
                return result
            },
        },
    }
}

beforeEach(() => {
    clock = fakeToastClock()
    host = createToastHost({ clock })
})

afterEach(() => {
    resetToastHostForTests()
})

describe('T-UI4 the toast half: one Undo toast per delete', () => {
    test('each delete posts its own toast with the Undo label', () => {
        const { service } = serviceReturning({ ok: true })
        const toasts = createStudioToasts({ service: () => service, host })
        toasts.postDeleted(A, 'd1')
        toasts.postDeleted(A, 'd2')
        expect(host.visible.map((toast) => [toast.kind, toast.text, toast.actionLabel])).toEqual([
            ['undo', 'studioToastGreetingDeleted', 'studioToastUndo'],
            ['undo', 'studioToastGreetingDeleted', 'studioToastUndo'],
        ])
    })

    test('dismissing a delete ends only the toast with that action id (M56)', () => {
        const { service } = serviceReturning({ ok: true })
        const toasts = createStudioToasts({ service: () => service, host })
        toasts.postDeleted(A, 'd1')
        toasts.postDeleted(A, 'd2')
        toasts.dismissDeleted('d1')
        expect(host.visible).toHaveLength(1)
        expect(host.visible[0].kind).toBe('undo')
        toasts.dismissDeleted('d2')
        expect(host.visible).toHaveLength(0)
    })

    test('with no host given the toast goes to the app singleton', () => {
        const { service } = serviceReturning({ ok: true })
        const toasts = createStudioToasts({ service: () => service })
        toasts.postDeleted(A, 'd1')
        expect(toastHost.visible.map((toast) => toast.kind)).toEqual(['undo'])
        toasts.dismissDeleted('d1')
        expect(toastHost.visible).toHaveLength(0)
    })
})

describe('T-UI5 the Undo action', () => {
    test('Undo restores through the service with the toast owner and id, once, and reports success', async () => {
        const { service, calls } = serviceReturning({ ok: true })
        const toasts = createStudioToasts({ service: () => service, host })
        const id = toasts.postDeleted(A, 'd1')
        await host.activate(id)
        expect(calls).toEqual([[A, 'd1']])
        expect(host.visible.map((toast) => [toast.kind, toast.text, toast.actionLabel])).toEqual([['success', 'studioToastRestored', undefined]])
    })

    test('a restored greeting on a chat without an id says the default first message shows again', async () => {
        const { service } = serviceReturning({ ok: true, fmNotRestored: true })
        const toasts = createStudioToasts({ service: () => service, host })
        await host.activate(toasts.postDeleted(A, 'd1'))
        expect(host.visible[0].text).toBe('studioToastRestoredFmNotice')
        expect(host.visible[0].kind).toBe('success')
    })

    const reasons: StudioRefusal[] = ['loading', 'not-selected', 'duplicate-id', 'group', 'restricted', 'gone', 'no-unique-chat', 'precondition', 'empty', 'unknown']

    test.each(reasons)('a refusal (%s) shows its own text, never success, and removes the action (M36)', async (reason) => {
        const { service } = serviceReturning({ ok: false, reason })
        const toasts = createStudioToasts({ service: () => service, host })
        await host.activate(toasts.postDeleted(A, 'd1'))
        const [toast] = host.visible
        expect(toast.kind).not.toBe('success')
        expect(toast.kind).toBe('info')
        expect(toast.text).toBe(refusalText(reason))
        // `after` is absent, so the toast does not keep offering Undo.
        expect(toast.actionLabel).toBeUndefined()
    })

    test('the refusal texts differ where the user needs to act differently', () => {
        const texts = new Set(reasons.map(refusalText))
        expect(texts.size).toBe(8)
    })

    test('with no service built, Undo reports that history is still loading', async () => {
        const toasts = createStudioToasts({ service: () => null, host })
        await host.activate(toasts.postDeleted(A, 'd1'))
        expect(host.visible[0].text).toBe(refusalText('loading'))
        expect(host.visible[0].kind).toBe('info')
    })

    test('a throwing service takes the host failure path with the failed text, not success', async () => {
        const toasts = createStudioToasts({
            service: () => ({
                restoreDeleted() {
                    throw new Error('boom')
                },
            }),
            host,
        })
        await host.activate(toasts.postDeleted(A, 'd1'))
        expect(host.visible[0].text).toBe('studioToastRestoreFailed')
        expect(host.visible[0].kind).toBe('info')
    })
})

describe('suspension', () => {
    test('suspendWhileMounted holds the stack until its owner is destroyed', () => {
        const toasts = createStudioToasts({ service: () => null, host })
        expect(host.suspended).toBe(false)
        const stop = $effect.root(() => {
            toasts.suspendWhileMounted()
        })
        flushSync()
        expect(host.suspended).toBe(true)
        stop()
        flushSync()
        expect(host.suspended).toBe(false)
    })
})

describe('runDismissingConsumed ends the toast of every deleted item an action consumed (M56)', () => {
    function viewOf(ids: readonly string[]): OwnerView {
        return {
            ownerKey: A,
            phase: 'ready',
            banner: null,
            restricted: false,
            editable: true,
            persisted: true,
            done: [],
            undone: [],
            deleted: ids.map((id, index) => ({ id, at: index, index, value: id, sideChat: null })),
            restore: null,
        }
    }

    // A service whose deleted list is what the test last set; an action changes it the way a replay would.
    function listOf(initial: readonly string[]): { service: Pick<OwnerHistoryService, 'view'>; set: (ids: readonly string[]) => void } {
        let ids = initial
        return { service: { view: () => viewOf(ids) }, set: (next) => { ids = next } }
    }

    test('a landed action dismisses exactly the toasts whose item left the deleted list', () => {
        const { service, set } = listOf(['d1', 'd2', 'd3'])
        const toasts = createStudioToasts({ service: () => null, host })
        toasts.postDeleted(A, 'd1')
        toasts.postDeleted(A, 'd2')
        toasts.postDeleted(A, 'd3')
        const result = runDismissingConsumed(service, toasts, A, () => {
            set(['d1', 'd3'])
            return { ok: true }
        })
        expect(result).toEqual({ ok: true })
        expect(host.visible).toHaveLength(2)
        toasts.dismissDeleted('d1')
        toasts.dismissDeleted('d3')
        expect(host.visible).toHaveLength(0)
    })

    test('a refused action dismisses nothing, even if the list changed', () => {
        const { service, set } = listOf(['d1'])
        const toasts = createStudioToasts({ service: () => null, host })
        toasts.postDeleted(A, 'd1')
        const result = runDismissingConsumed(service, toasts, A, () => {
            set([])
            return { ok: false, reason: 'precondition' }
        })
        expect(result).toEqual({ ok: false, reason: 'precondition' })
        expect(host.visible).toHaveLength(1)
    })

    test('an action that consumes nothing dismisses nothing', () => {
        const { service } = listOf(['d1'])
        const toasts = createStudioToasts({ service: () => null, host })
        toasts.postDeleted(A, 'd1')
        runDismissingConsumed(service, toasts, A, () => ({ ok: true }))
        expect(host.visible).toHaveLength(1)
    })
})

describe('T-UI5b the Undo outlives Studio and goes through the marked write path', () => {
    interface LiveCharacter {
        chaId: string
        type: string
        desc: string
        alternateGreetings: string[]
        chats: { id: string; note: string; fmIndex?: number }[]
        chatPage: number
    }

    const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

    beforeEach(() => {
        h.marks = 0
        tracker.character.length = 0
        resetCharacterSaveMarksForTest()
        installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
        resetStudioScreenForTests()
        const character: LiveCharacter = {
            chaId: 'A',
            type: 'character',
            desc: 'd0',
            alternateGreetings: ['g0', 'g1', 'g2'],
            chats: [{ id: 'c1', note: '', fmIndex: 2 }],
            chatPage: 0,
        }
        DBState.db.characters = [character] as unknown as typeof DBState.db.characters
        selIdState.selId = 0
        studioScreen.chaId = 'A'
    })

    afterEach(() => {
        resetCharacterSaveMarksForTest()
        resetStudioScreenForTests()
    })

    test('after Studio closed, Undo restores the greeting, marks the character and enqueues a save, with no ack', async () => {
        const historyClock = createFakeClock()
        const store = createMemoryStudioStore()
        const service = createOwnerHistoryService({
            store,
            claim: createClaimDouble(),
            clock: historyClock,
            pageSession: 'p1',
            getVisitId: () => 'v1',
            registerLeaveFlush: () => () => {},
        })
        await service.whenReady(A)
        expect(service.greetingDelete(A, 1).ok).toBe(true)
        const op = service.view(A).done.at(-1)?.ops.find((candidate) => candidate.op === 'listRemove')
        expect(op?.op).toBe('listRemove')
        const deletedId = op?.op === 'listRemove' ? op.deletedId : ''
        const live = DBState.db.characters[0] as unknown as LiveCharacter
        expect(live.alternateGreetings).toEqual(['g0', 'g2'])

        const toasts = createStudioToasts({ service: () => service, host })
        const id = toasts.postDeleted(A, deletedId)
        // Studio closes; the toast and the selection of the character outlive it.
        studioScreen.open = false
        const marksBefore = h.marks
        const savesBefore = store.counts.save
        await host.activate(id)

        expect(live.alternateGreetings).toEqual(['g0', 'g1', 'g2'])
        expect(host.visible[0].kind).toBe('success')
        expect(h.marks).toBeGreaterThan(marksBefore)
        await historyClock.advance(SAVE_DEBOUNCE_MS)
        expect(store.counts.save).toBeGreaterThan(savesBefore)
    })

    test('restoring the item from History ends its toast, over the real service', async () => {
        const service = createOwnerHistoryService({
            store: createMemoryStudioStore(),
            claim: createClaimDouble(),
            clock: createFakeClock(),
            pageSession: 'p1',
            getVisitId: () => 'v1',
            registerLeaveFlush: () => () => {},
        })
        await service.whenReady(A)
        expect(service.greetingDelete(A, 1).ok).toBe(true)
        const op = service.view(A).done.at(-1)?.ops.find((candidate) => candidate.op === 'listRemove')
        const deletedId = op?.op === 'listRemove' && op.deletedId !== null ? op.deletedId : ''
        expect(deletedId).not.toBe('')
        const toasts = createStudioToasts({ service: () => service, host })
        toasts.postDeleted(A, deletedId)
        expect(host.visible).toHaveLength(1)
        const result = runDismissingConsumed(service, toasts, A, () => service.restoreDeleted(A, deletedId))
        expect(result.ok).toBe(true)
        expect((DBState.db.characters[0] as unknown as LiveCharacter).alternateGreetings).toEqual(['g0', 'g1', 'g2'])
        expect(host.visible).toHaveLength(0)
    })

    test('Undo after the selection moved refuses and writes nothing', async () => {
        const historyClock = createFakeClock()
        const service = createOwnerHistoryService({
            store: createMemoryStudioStore(),
            claim: createClaimDouble(),
            clock: historyClock,
            pageSession: 'p1',
            getVisitId: () => 'v1',
            registerLeaveFlush: () => () => {},
        })
        await service.whenReady(A)
        expect(service.greetingDelete(A, 1).ok).toBe(true)
        const op = service.view(A).done.at(-1)?.ops.find((candidate) => candidate.op === 'listRemove')
        const deletedId = op?.op === 'listRemove' ? op.deletedId : ''
        const toasts = createStudioToasts({ service: () => service, host })
        const id = toasts.postDeleted(A, deletedId)
        studioScreen.chaId = 'B'
        const marksBefore = h.marks
        await host.activate(id)
        const live = DBState.db.characters[0] as unknown as LiveCharacter
        expect(live.alternateGreetings).toEqual(['g0', 'g2'])
        expect(h.marks).toBe(marksBefore)
        expect(host.visible[0].kind).toBe('info')
        expect(host.visible[0].text).toBe(refusalText('not-selected'))
    })
})
