// @vitest-environment node

/**
 * Auto mode's loop (`runAutoMode` in `../composerActions.svelte`) against
 * ticks that finish at once, ticks that are refused, and the busy button.
 *
 * Drives the REAL composer against the real `$state` database. `sendChat` is
 * replaced by a spy each test configures, so a test decides what a tick
 * reports and when it finishes; a tick that reaches no member's turn is one
 * that returns at once. `doingChat` is a real store the composer reads.
 * Nothing here says how the real `sendChat` behaves (see
 * `sendChatOwnership.svelte.test.ts` and `generationOwnership.svelte.test.ts`
 * for that).
 *
 * A mocked tick returns without awaiting anything, so a loop that never
 * yields to the event loop would never end by itself. Every spy therefore
 * stops auto mode after `RUNAWAY_LIMIT` calls, which bounds a loop that has
 * no stop of its own. A yield to the event loop is detected with a
 * `MessageChannel` message posted before auto mode starts: it is delivered
 * only if the loop hands control back.
 *
 * Tests whose title starts with `guard:` pass before and after the ownership
 * change: they pin behaviour that must be preserved.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database, character, Chat } from 'src/ts/storage/database.svelte'
import type { SendChatArg } from 'src/ts/process/index.svelte'

//#region module mocks

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as any })
    return {
        DBState: state,
        selectedCharID: writable(-1),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/util'), () => ({
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/translator/translator'), () => ({
    isExpTranslator: vi.fn(() => false),
    translate: vi.fn(async () => ''),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/storage/characterSaveMarks'), () => ({
    markCharacterForSave: vi.fn(),
}) as unknown as typeof import('src/ts/storage/characterSaveMarks'))

vi.mock(import('src/ts/process/sendCharacterMessage'), () => ({
    sendCharacterMessage: vi.fn(async () => false),
}) as unknown as typeof import('src/ts/process/sendCharacterMessage'))

vi.mock(import('src/ts/process/prereroll'), () => ({
    Prereroll: vi.fn(() => undefined),
    PreUnreroll: vi.fn(() => undefined),
}) as unknown as typeof import('src/ts/process/prereroll'))

vi.mock(import('src/ts/process/command'), () => ({
    processMultiCommand: vi.fn(async () => false),
}) as unknown as typeof import('src/ts/process/command'))

const sendChatMock = vi.hoisted(() => vi.fn())

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
    sendChat: sendChatMock,
}) as unknown as typeof import('src/ts/process/index.svelte'))

//#endregion

import { runAutoMode, abortChat, isAutoModeActive, isComposerBusy, resetComposerActionsForTests, type ComposerActionsSource } from 'src/ts/process/composerActions.svelte'
import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { doingChat } from 'src/ts/process/index.svelte'
import { noteTurnReached } from 'src/ts/process/generationOwnership.svelte'

//#region fixtures

const RUNAWAY_LIMIT = 200

function installGroupChat(): void {
    const chat = { id: 'chat-0', message: [], note: '', localLore: [], scriptstate: {} } as unknown as Chat
    const group = { chaId: 'group-0', name: 'group-0', type: 'group', chatPage: 0, chats: [chat] } as unknown as character
    DBState.db = { characters: [group] } as unknown as Database
    selectedCharID.set(0)
}

function makeSource(): ComposerActionsSource {
    return { closeMenu: () => {} }
}

/** A message posted to a fresh channel now; `delivered()` is true once the event loop has handed it over. */
function postProbe(onDelivered: () => void = () => {}): { delivered: () => boolean } {
    let delivered = false
    const { port1, port2 } = new MessageChannel()
    port1.onmessage = () => {
        delivered = true
        port1.close()
        onDelivered()
    }
    port2.postMessage(null)
    return { delivered: () => delivered }
}

/**
 * Makes every tick return `outcome(callNumber)`, counting calls, and stops
 * auto mode after `RUNAWAY_LIMIT` calls whatever the outcome says.
 */
function scriptTicks(source: ComposerActionsSource, outcome: (call: number, arg: SendChatArg) => boolean | Promise<boolean>): { calls: () => number } {
    let calls = 0
    sendChatMock.mockImplementation(async (_index: number, arg: SendChatArg) => {
        calls++
        if (calls === RUNAWAY_LIMIT && isAutoModeActive()) {
            void runAutoMode(source)
        }
        return outcome(calls, arg)
    })
    return { calls: () => calls }
}

beforeEach(() => {
    sendChatMock.mockReset()
    installGroupChat()
})

afterEach(() => {
    resetComposerActionsForTests()
    selectedCharID.set(-1)
})

//#endregion

describe('auto mode with ticks that reach no turn', () => {
    test('stops after 50 such ticks, and hands control back to the event loop before it ends', async () => {
        const source = makeSource()
        const ticks = scriptTicks(source, () => true)
        const probe = postProbe()

        await runAutoMode(source)
        const probeDeliveredWhenItEnded = probe.delivered()

        expect.soft(probeDeliveredWhenItEnded).toBe(true)
        expect.soft(ticks.calls()).toBe(50)
    })
})

describe('auto mode and the count of quiet ticks', () => {
    test('the count starts again after a tick that reaches a turn: 49 quiet ticks, a turn, then 50 quiet ticks end the loop after 100 ticks', async () => {
        const source = makeSource()
        const ticks = scriptTicks(source, (call) => {
            if (call === 50) {
                noteTurnReached()
            }
            return true
        })

        await runAutoMode(source)

        expect(ticks.calls()).toBe(100)
    })
})

describe('auto mode between two ticks', () => {
    test('a switch to another chat that lands while the loop has handed control back runs no further tick', async () => {
        const source = makeSource()
        DBState.db.characters.push({ chaId: 'other-0', name: 'other-0', type: 'character', chatPage: 0, chats: [{ id: 'other-chat', message: [] }] } as unknown as character)
        let callsAtSwitch: number | undefined
        const ticks = scriptTicks(source, () => {
            noteTurnReached()
            return true
        })
        postProbe(() => {
            callsAtSwitch = ticks.calls()
            selectedCharID.set(1)
        })

        await runAutoMode(source)

        expect.soft(callsAtSwitch).toBe(1)
        expect.soft(ticks.calls()).toBe(callsAtSwitch)
    })

    test('a send that takes the flag while the loop has handed control back stops it before another tick is handed over', async () => {
        const source = makeSource()
        const ticks = scriptTicks(source, () => {
            noteTurnReached()
            return true
        })
        postProbe(() => { doingChat.set(true) })

        await runAutoMode(source)
        doingChat.set(false)

        expect(ticks.calls()).toBe(1)
    })

    test('the loop hands control back between every two ticks', async () => {
        const source = makeSource()
        let deliveries = 0
        let chainEnded = false
        const chain = (): void => {
            postProbe(() => {
                deliveries++
                if (!chainEnded) {
                    chain()
                }
            })
        }
        const ticks = scriptTicks(source, (call) => {
            noteTurnReached()
            if (call === 10 && isAutoModeActive()) {
                void runAutoMode(source)
            }
            return true
        })
        chain()

        await runAutoMode(source)
        chainEnded = true

        expect(ticks.calls()).toBe(10)
        expect(deliveries).toBeGreaterThanOrEqual(ticks.calls() - 1)
    })
})

describe('auto mode and a tick that does not complete', () => {
    test('a tick that is refused ends the loop', async () => {
        const source = makeSource()
        const ticks = scriptTicks(source, (call) => call !== 2)

        await runAutoMode(source)

        expect(ticks.calls()).toBe(2)
        expect(isAutoModeActive()).toBe(false)
        expect(isComposerBusy()).toBe(false)
    })
})

describe('auto mode and the busy button', () => {
    test('a press during a tick ends the loop, even when the tick it interrupts reports completion', async () => {
        const source = makeSource()
        let release: () => void = () => {}
        const held = new Promise<void>((res) => { release = res })
        let reached: () => void = () => {}
        const tickReached = new Promise<void>((res) => { reached = res })
        const ticks = scriptTicks(source, async (call) => {
            if (call === 2) {
                reached()
                await held
            }
            return true
        })

        const auto = runAutoMode(source)
        await tickReached
        abortChat()
        release()
        await auto

        expect(ticks.calls()).toBe(2)
        expect(isAutoModeActive()).toBe(false)
    })

    test('a press that lands while the loop has handed control back runs no further tick', async () => {
        const source = makeSource()
        const ticks = scriptTicks(source, () => true)
        let callsAtPress: number | undefined
        postProbe(() => {
            callsAtPress = ticks.calls()
            abortChat()
        })

        await runAutoMode(source)

        expect.soft(callsAtPress).toBeDefined()
        expect.soft(ticks.calls()).toBe(callsAtPress)
    })

    test('guard: toggling auto mode off from its own menu entry ends the loop', async () => {
        const source = makeSource()
        const ticks = scriptTicks(source, (call) => {
            if (call === 3) {
                void runAutoMode(source)
            }
            return true
        })

        await runAutoMode(source)

        expect(ticks.calls()).toBe(3)
        expect(isAutoModeActive()).toBe(false)
    })
})
