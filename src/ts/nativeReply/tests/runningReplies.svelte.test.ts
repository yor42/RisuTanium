import { beforeEach, describe, expect, test, vi } from 'vitest'

// The parser module graph is not under test: the JSON extraction and the model catalog are replaced.
vi.mock('src/ts/model/modellist', () => ({ LLMFlags: { deepSeekThinkingOutput: 7 } }))
vi.mock('src/ts/process/templates/jsonSchema', () => ({ extractJSON: (data: unknown) => String(data) }))
vi.mock('src/ts/stores.svelte', () => ({ DBState: { db: { characters: [] } } }))

import { flushSync } from 'svelte'
import { DBState } from 'src/ts/stores.svelte'
import { createUsageMeter } from 'src/ts/usage/usageMeter'
import { encodeReplyBlob, type ReplyBlobBase } from '../blob'
import { configurePageState, holdInflight, resetPageStateForTests } from '../pageState'
import { createReconciler, type ApplyOutcome, type ReconcileDeps } from '../reconcile'
import {
    addRunningReplies, isNativeReplyRunning, noteWaitingForUnit, resetRunningRepliesForTests, runningReplyInChat, setRunningReplies,
} from '../runningReplies.svelte'
import type { ReplyListing } from '../store'

/**
 * The running map the reconcile pass publishes (MC-3612, Q8): which keys are still being received elsewhere, and which chat
 * each belongs to. Mutants: M20/M34 (map published after the parked dialog), M21 (unit deferral dropped), M22 (a failed list
 * clears the map), M23 (held keys counted), M29 (message presence ignored), M30 (a null target matches a chat), M32 (key
 * removed at list time), M33 (publish only on membership change), M35 (every deferral keeps the key).
 */

const K1 = '0b9c1a7e-0000-4000-8000-000000000001'
const K2 = '0b9c1a7e-0000-4000-8000-000000000002'
const base: ReplyBlobBase = {
    target: { chaId: 'cha', chatId: 'chat' }, targetName: 'Alice', saying: 'cha',
    generationInfo: { generationId: K1 }, promptInfo: {}, escape: false, requestedMs: 1,
}
const blobText = encodeReplyBlob(base, { kind: 'openai-chat', deepSeekThinkingOutput: false, extractJson: null, jsonSchema: false, multiGen: false })
const streamBlobText = JSON.stringify({
    format: 'risu-native-reply-blob', target: { chaId: 'cha', chatId: 'chat' }, targetName: 'Alice', saying: 'cha',
    generationInfo: base.generationInfo, promptInfo: base.promptInfo,
    parse: { kind: 'openai-chat-stream', deepSeekThinkingOutput: false, extractJson: null, jsonSchema: false, multiGen: false },
    usage: { modelKey: 'gpt-4o', inputEstimate: 120 }, escape: false, requestedMs: 1,
})

function listing(key: string, extra: Partial<ReplyListing> = {}): ReplyListing {
    return { key, state: 'terminal', parked: false, createdMs: 10, pageVersion: 1, blob: blobText, outcome: 'done', status: 200, bodyBytes: 20, ...extra }
}
const live = (key: string, extra: Partial<ReplyListing> = {}) => listing(key, { state: 'live', outcome: undefined, status: undefined, bodyBytes: undefined, ...extra })

type Message = { chatId?: string, data: string, interrupted?: true }
function setChat(message: Message[]): void {
    ;(DBState as unknown as { db: { characters: unknown[] } }).db = {
        characters: [{ chaId: 'cha', name: 'Alice', type: 'character', chats: [{ id: 'chat', message }] }],
    }
}

interface Rig {
    deps: ReconcileDeps
    current: { listings: ReplyListing[] }
    gate: { value: boolean }
    list: ReturnType<typeof vi.fn>
    apply: ReturnType<typeof vi.fn>
    applyStream: ReturnType<typeof vi.fn>
    showParked: ReturnType<typeof vi.fn>
}

function rig(listings: ReplyListing[]): Rig {
    resetPageStateForTests()
    resetRunningRepliesForTests()
    configurePageState({
        store: { consume: vi.fn(async (_key: string) => ({ result: 'removed' as const, flushed: true })) },
        waiter: { committedMarkCount: () => 0, markCount: () => 0, verdict: () => 'absent', afterNextCommit: () => {}, markCharacter: () => {}, requestSaveNow: () => {} },
        onUnreadable: () => {},
    })
    const current = { listings }
    const gate = { value: true }
    const list = vi.fn(async () => current.listings)
    const apply = vi.fn(async (): Promise<ApplyOutcome> => 'applied')
    const applyStream = vi.fn(async (): Promise<ApplyOutcome> => 'applied')
    const showParked = vi.fn(async () => {})
    const deps: ReconcileDeps = {
        store: {
            list, readBody: vi.fn(async () => '{}'), readBodyBytes: vi.fn(async () => new Uint8Array()),
            readPartialBytes: vi.fn(async () => new Uint8Array()), park: vi.fn(async () => {}),
            discard: vi.fn(async () => ({ result: 'removed' as const, flushed: true })),
        },
        gate: () => gate.value,
        notice: () => {},
        notes: { failedElsewhere: (n) => `failed:${n}`, stoppedElsewhere: (n) => `stopped:${n}`, interrupted: (n) => `interrupted:${n}`, unreadable: (k, p) => `unreadable:${k}:${p}` },
        recoverText: async () => 'a reply',
        apply,
        replayStream: async () => ({ modelText: 'text', meter: createUsageMeter(), signatures: [] }),
        applyStream,
        settleUsage: () => {},
        restoreCharacter: async () => false,
        preLoadChat: async () => undefined,
        showParked,
    }
    return { deps, current, gate, list, apply, applyStream, showParked }
}

async function pass(r: Rig): Promise<void> {
    await createReconciler(r.deps).request()
}

beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    setChat([{ data: 'hi' }])
})

describe('the pass publishes the running map', () => {
    test('T20: a live listing the page does not hold is running; a held key is not', async () => {
        const r = rig([live(K1), live(K2)])
        holdInflight(K2)
        await pass(r)
        expect(isNativeReplyRunning(K1)).toBe(true)
        expect(isNativeReplyRunning(K2)).toBe(false)
    })

    test('T21: a key that turns terminal stays running while its apply awaits and is gone when the pass ends', async () => {
        const r = rig([live(K1)])
        await pass(r)
        r.current.listings = [listing(K1)]
        let during: boolean | null = null
        r.apply.mockImplementation(async () => {
            during = isNativeReplyRunning(K1)
            return 'applied'
        })
        await pass(r)
        expect(during).toBe(true)
        expect(isNativeReplyRunning(K1)).toBe(false)
    })

    test('T21: the map is published before the parked dialog', async () => {
        const r = rig([live(K1), live(K2)])
        await pass(r)
        // K1 now ends and is parked (its chat is gone); K2 keeps running.
        ;(DBState as unknown as { db: { characters: unknown[] } }).db = { characters: [] }
        r.current.listings = [listing(K1), live(K2)]
        const seen: Array<[boolean, boolean]> = []
        r.showParked.mockImplementation(async () => {
            seen.push([isNativeReplyRunning(K1), isNativeReplyRunning(K2)])
        })
        await pass(r)
        expect(r.showParked).toHaveBeenCalledTimes(1)
        expect(seen).toEqual([[false, true]])
    })

    test('T22: a unit deferral keeps the key running until the next pass places it', async () => {
        const r = rig([live(K1)])
        await pass(r)
        r.current.listings = [listing(K1)]
        r.apply.mockImplementation(async () => {
            noteWaitingForUnit(K1)
            return 'deferred'
        })
        await pass(r)
        expect(isNativeReplyRunning(K1)).toBe(true)
        r.apply.mockImplementation(async () => 'applied')
        await pass(r)
        expect(isNativeReplyRunning(K1)).toBe(false)
    })

    test('T33: a deferral that waits for no unit, and every other result, end the key with the pass', async () => {
        for (const outcome of ['applied', 'deferred', 'failed'] as const) {
            const r = rig([live(K1)])
            await pass(r)
            r.current.listings = [listing(K1)]
            r.apply.mockImplementation(async () => outcome)
            await pass(r)
            expect(isNativeReplyRunning(K1), outcome).toBe(false)
        }
        // A stream apply is handled the same way.
        const r = rig([live(K1, { blob: streamBlobText })])
        await pass(r)
        r.current.listings = [listing(K1, { blob: streamBlobText })]
        await pass(r)
        expect(r.applyStream).toHaveBeenCalledTimes(1)
        expect(isNativeReplyRunning(K1)).toBe(false)
        // A failed or stopped record with no body ends it too.
        const s = rig([live(K1)])
        await pass(s)
        s.current.listings = [listing(K1, { outcome: 'failed' })]
        await pass(s)
        expect(isNativeReplyRunning(K1)).toBe(false)
    })

    test('T33: a list error keeps the map', async () => {
        const r = rig([live(K1)])
        await pass(r)
        r.list.mockRejectedValueOnce(new Error('io'))
        await pass(r)
        expect(isNativeReplyRunning(K1)).toBe(true)
    })

    test('T23: a closed gate before or after the list leaves the map, and a dead listing is never running', async () => {
        const r = rig([live(K1)])
        await pass(r)
        r.current.listings = [listing(K1, { state: 'dead', outcome: undefined, partialBytes: 5 })]
        r.gate.value = false
        await pass(r)
        expect(isNativeReplyRunning(K1)).toBe(true)
        r.gate.value = true
        r.list.mockImplementationOnce(async () => {
            r.gate.value = false
            return r.current.listings
        })
        await pass(r)
        expect(isNativeReplyRunning(K1)).toBe(true)
        r.gate.value = true
        await pass(r)
        expect(isNativeReplyRunning(K1)).toBe(false)
        const d = rig([listing(K2, { state: 'dead', outcome: undefined })])
        await pass(d)
        expect(isNativeReplyRunning(K2)).toBe(false)
    })
})

describe('the target of a running key', () => {
    test('T31: a live listing maps the key to its chat; no blob or an undecodable one matches no chat', async () => {
        setChat([])
        const r = rig([live(K1), live(K2, { blob: undefined })])
        r.current.listings.push(live('0b9c1a7e-0000-4000-8000-000000000003', { blob: 'not json' }))
        await pass(r)
        expect(runningReplyInChat('cha', 'chat', [])).toEqual({ name: 'Alice' })
        expect(isNativeReplyRunning(K2)).toBe(true)
        expect(runningReplyInChat('other', 'chat', [])).toBeNull()
        r.current.listings = [live(K2, { blob: undefined })]
        await pass(r)
        expect(runningReplyInChat('cha', 'chat', [])).toBeNull()
        expect(isNativeReplyRunning(K2)).toBe(true)
    })

    test('T31: a key first listed with a null target and then with a real one publishes', async () => {
        const r = rig([live(K1, { blob: undefined })])
        await pass(r)
        const seen: Array<string | null> = []
        const stop = $effect.root(() => {
            $effect(() => {
                seen.push(runningReplyInChat('cha', 'chat', [])?.name ?? null)
            })
        })
        flushSync()
        expect(seen).toEqual([null])
        r.current.listings = [live(K1)]
        await pass(r)
        flushSync()
        expect(seen).toEqual([null, 'Alice'])
        stop()
    })

    test('T32: one key shows on the chat or on its message, never both', () => {
        resetRunningRepliesForTests()
        setRunningReplies([{ key: K1, target: { chaId: 'cha', chatId: 'chat', name: 'Alice' } }])
        expect(runningReplyInChat('cha', 'chat', [{ chatId: undefined }])).toEqual({ name: 'Alice' })
        expect(runningReplyInChat('cha', 'chat', [{ chatId: K1 }])).toBeNull()
        expect(isNativeReplyRunning(K1)).toBe(true)
        setRunningReplies([])
        expect(isNativeReplyRunning(K1)).toBe(false)
        expect(runningReplyInChat('cha', 'chat', [])).toBeNull()
    })

    test('T31: setRunningReplies publishes a changed target of a key that stays', () => {
        resetRunningRepliesForTests()
        setRunningReplies([{ key: K1, target: null }])
        const seen: boolean[] = []
        const stop = $effect.root(() => {
            $effect(() => {
                seen.push(runningReplyInChat('cha', 'chat', []) !== null)
            })
        })
        flushSync()
        setRunningReplies([{ key: K1, target: { chaId: 'cha', chatId: 'chat', name: 'Alice' } }])
        flushSync()
        expect(seen).toEqual([false, true])
        stop()
    })

    test('T31: a changed target and a changed membership both publish', () => {
        resetRunningRepliesForTests()
        const seen: boolean[] = []
        const stop = $effect.root(() => {
            $effect(() => {
                seen.push(isNativeReplyRunning(K1) && runningReplyInChat('cha', 'chat', []) !== null)
            })
        })
        flushSync()
        addRunningReplies([{ key: K1, target: null }])
        flushSync()
        addRunningReplies([{ key: K1, target: { chaId: 'cha', chatId: 'chat', name: 'Alice' } }])
        flushSync()
        expect(seen).toEqual([false, false, true])
        stop()
    })
})
