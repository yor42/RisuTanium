import { beforeEach, describe, expect, test, vi } from 'vitest'

// The parser module graph is not under test: the JSON extraction and the model catalog are replaced.
vi.mock('src/ts/model/modellist', () => ({ LLMFlags: { deepSeekThinkingOutput: 7 } }))
vi.mock('src/ts/process/templates/jsonSchema', () => ({ extractJSON: (data: unknown) => String(data) }))
vi.mock('src/ts/stores.svelte', () => ({ DBState: { db: { characters: [] } } }))

import { DBState } from 'src/ts/stores.svelte'
import { COLD_POINTER_HEADER } from 'src/ts/storage/store2/codec/stub'
import { encodeReplyBlob, type ReplyBlobBase } from '../blob'
import {
    configurePageState, heldReply, holdInflight, noteBodySource, noteBound, noteInvoked, noteReplyPushed, resetPageStateForTests, settleNativeReplyInflight,
} from '../pageState'
import { createReconciler, recoveredText, type ApplyOutcome, type ReconcileDeps } from '../reconcile'
import type { ReplyListing } from '../store'

/**
 * T12 (guard, new rule): every row of the reconcile table over a real DBState and a fake store. T13: one pass at a time
 * and the target read again after every await. T19: the gates. T22: notes come once per launch. Mutants M17 (cold read
 * as gone), M18 (trash not parked), M19 (unreadable consumed), M20 (no-text reply parked), M21 (present re-applied),
 * M22 (held keys not skipped), M23 (no recheck), M31 (reconcile on a read-only page).
 */

const K1 = '0b9c1a7e-0000-4000-8000-000000000001'
const K2 = '0b9c1a7e-0000-4000-8000-000000000002'
const base: ReplyBlobBase = {
    target: { chaId: 'cha', chatId: 'chat' }, targetName: 'Alice', saying: 'cha',
    generationInfo: { generationId: K1 }, promptInfo: {}, escape: false, requestedMs: 1,
}
const parseRule = { kind: 'openai-chat' as const, deepSeekThinkingOutput: false, extractJson: null, jsonSchema: false, multiGen: false }
const blobText = encodeReplyBlob(base, parseRule)

function listing(key: string, extra: Partial<ReplyListing> = {}): ReplyListing {
    return { key, state: 'terminal', parked: false, createdMs: 10, pageVersion: 1, blob: blobText, outcome: 'done', status: 200, bodyBytes: 20, ...extra }
}

type Chat = { id: string, message: Array<{ chatId?: string, data: string }> }
function character(extra: Record<string, unknown> = {}, chats: Chat[] = [{ id: 'chat', message: [{ data: 'hi' }] }]) {
    return { chaId: 'cha', name: 'Alice', type: 'character', chats, ...extra }
}
function setCharacters(characters: unknown[]): void {
    ;(DBState as unknown as { db: { characters: unknown[] } }).db = { characters }
}

interface Rig {
    deps: ReconcileDeps
    notices: string[]
    apply: ReturnType<typeof vi.fn>
    consume: ReturnType<typeof vi.fn>
    park: ReturnType<typeof vi.fn>
    discard: ReturnType<typeof vi.fn>
    list: ReturnType<typeof vi.fn>
    readBody: ReturnType<typeof vi.fn>
    restore: ReturnType<typeof vi.fn>
    preLoad: ReturnType<typeof vi.fn>
    showParked: ReturnType<typeof vi.fn>
    gate: { value: boolean }
    listings: ReplyListing[]
}

function rig(listings: ReplyListing[], options: { text?: string | null, apply?: ApplyOutcome } = {}): Rig {
    resetPageStateForTests()
    const notices: string[] = []
    const consume = vi.fn(async (_key: string) => ({ result: 'removed' as const, flushed: true }))
    configurePageState({
        store: { consume },
        waiter: { committedMarkCount: () => 0, markCount: () => 0, verdict: () => 'absent', afterNextCommit: () => {}, markCharacter: () => {}, requestSaveNow: () => {} },
        onUnreadable: () => {},
    })
    const gate = { value: true }
    const park = vi.fn(async (_key: string) => {})
    const discard = vi.fn(async (_key: string) => ({ result: 'removed' as const, flushed: true }))
    const list = vi.fn(async () => rigListings.current)
    const rigListings = { current: listings }
    const readBody = vi.fn(async (_key: string) => '{}')
    const apply = vi.fn(async (): Promise<ApplyOutcome> => options.apply ?? 'applied')
    const restore = vi.fn(async (_chaId: string) => false)
    const preLoad = vi.fn(async (_c: number, _h: number) => undefined)
    const showParked = vi.fn(async () => {})
    const deps: ReconcileDeps = {
        store: { list, readBody, park, discard },
        gate: () => gate.value,
        notice: (text) => notices.push(text),
        notes: {
            failedElsewhere: (name) => `failed:${name}`,
            stoppedElsewhere: (name) => `stopped:${name}`,
            interrupted: (name) => `interrupted:${name}`,
            unreadable: (key, problem) => `unreadable:${key}:${problem}`,
        },
        recoverText: async () => options.text === undefined ? 'a reply' : options.text,
        apply,
        restoreCharacter: restore,
        preLoadChat: preLoad,
        showParked,
    }
    return { deps, notices, apply, consume, park, discard, list, readBody, restore, preLoad, showParked, gate, listings }
}

beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    setCharacters([character()])
})

async function pass(r: Rig, times = 1) {
    const reconciler = createReconciler(r.deps)
    for (let i = 0; i < times; i++) {
        await reconciler.request()
    }
    return reconciler
}

describe('reconcile table', () => {
    test('an unreadable record is kept and reported once per launch, over two wakes', async () => {
        const r = rig([{ key: K1, state: 'unreadable', parked: false, problem: 'end.json is not JSON' }, listing(K2, { blob: 'not json' })])
        await pass(r, 2)
        expect(r.notices).toEqual([`unreadable:${K1}:end.json is not JSON`, expect.stringContaining(`unreadable:${K2}:`)])
        expect(r.consume).not.toHaveBeenCalled()
        expect(r.discard).not.toHaveBeenCalled()
    })

    test('an unknown page version is unreadable, not consumed', async () => {
        const r = rig([listing(K1, { pageVersion: 2 })])
        await pass(r)
        expect(r.notices).toHaveLength(1)
        expect(r.consume).not.toHaveBeenCalled()
    })

    test.each([['incomplete'], ['dead']] as const)('%s: an interrupted note, once, then consume', async (state) => {
        const r = rig([listing(K1, { state, outcome: undefined })])
        await pass(r, 2)
        expect(r.notices).toEqual(['interrupted:Alice'])
        expect(r.consume).toHaveBeenCalledWith(K1)
    })

    test('failed and stopped records get their note, once, then consume', async () => {
        const r = rig([listing(K1, { outcome: 'failed' }), listing(K2, { outcome: 'stopped' })])
        await pass(r, 2)
        expect(r.notices).toEqual(['failed:Alice', 'stopped:Alice'])
        expect(r.consume).toHaveBeenCalledWith(K1)
        expect(r.consume).toHaveBeenCalledWith(K2)
    })

    test('a done record with no text is a failed note then consume, and is never parked', async () => {
        setCharacters([])
        const r = rig([listing(K1)], { text: null })
        await pass(r)
        expect(r.notices).toEqual(['failed:Alice'])
        expect(r.consume).toHaveBeenCalledWith(K1)
        expect(r.park).not.toHaveBeenCalled()
        expect(r.showParked).not.toHaveBeenCalled()
    })

    test('a reply read error keeps the record', async () => {
        const r = rig([listing(K1)])
        r.readBody.mockRejectedValueOnce(new Error('io'))
        await pass(r)
        expect(r.consume).not.toHaveBeenCalled()
        expect(r.apply).not.toHaveBeenCalled()
        expect(r.notices).toEqual([])
    })

    test('an absent reply is applied once and not consumed by the pass', async () => {
        const r = rig([listing(K1)])
        await pass(r)
        expect(r.apply).toHaveBeenCalledTimes(1)
        expect(r.apply).toHaveBeenCalledWith(expect.objectContaining({ key: K1, text: 'a reply' }))
        expect(r.consume).not.toHaveBeenCalled()
    })

    test('a reply already in the chat is consumed and not applied again', async () => {
        setCharacters([character({}, [{ id: 'chat', message: [{ data: 'hi' }, { data: 'a reply', chatId: K1 }] }])])
        const r = rig([listing(K1)])
        await pass(r)
        expect(r.consume).toHaveBeenCalledWith(K1)
        expect(r.apply).not.toHaveBeenCalled()
    })

    test('a character or chat that is gone is parked and shown', async () => {
        setCharacters([])
        const r = rig([listing(K1, { createdMs: 5 })])
        await pass(r)
        expect(r.park).toHaveBeenCalledWith(K1)
        expect(r.showParked).toHaveBeenCalledWith([{ key: K1, name: 'Alice', text: 'a reply', createdMs: 5 }])
        expect(r.apply).not.toHaveBeenCalled()
        setCharacters([character({}, [{ id: 'other', message: [{ data: 'x' }] }])])
        const second = rig([listing(K2)])
        await pass(second)
        expect(second.park).toHaveBeenCalledWith(K2)
    })

    test('a trashed character is parked', async () => {
        setCharacters([character({ trashTime: 5 })])
        const r = rig([listing(K1)])
        await pass(r)
        expect(r.park).toHaveBeenCalledWith(K1)
        expect(r.apply).not.toHaveBeenCalled()
    })

    test('two holders of the chaId keep the record', async () => {
        setCharacters([character(), character()])
        const r = rig([listing(K1)])
        await pass(r)
        expect(r.park).not.toHaveBeenCalled()
        expect(r.apply).not.toHaveBeenCalled()
        expect(r.consume).not.toHaveBeenCalled()
    })

    test('a cold character is restored once per launch and never read as gone', async () => {
        setCharacters([character({ coldstorage: 'unit' })])
        const r = rig([listing(K1)])
        const reconciler = createReconciler(r.deps)
        await reconciler.request()
        await reconciler.request()
        expect(r.restore).toHaveBeenCalledTimes(1)
        expect(r.park).not.toHaveBeenCalled()
        expect(r.apply).not.toHaveBeenCalled()
    })

    test('a cold character that restores is applied in the same pass', async () => {
        setCharacters([character({ coldstorage: 'unit' })])
        const r = rig([listing(K1)])
        r.restore.mockImplementationOnce(async () => { setCharacters([character()]); return true })
        await pass(r)
        expect(r.apply).toHaveBeenCalledTimes(1)
    })

    test('a cold chat is loaded once; one that stays cold is kept', async () => {
        setCharacters([character({}, [{ id: 'chat', message: [{ data: `${COLD_POINTER_HEADER}key` }] }])])
        const r = rig([listing(K1)])
        const reconciler = createReconciler(r.deps)
        await reconciler.request()
        await reconciler.request()
        expect(r.preLoad).toHaveBeenCalledTimes(1)
        expect(r.preLoad).toHaveBeenCalledWith(0, 0)
        expect(r.apply).not.toHaveBeenCalled()
        expect(r.park).not.toHaveBeenCalled()
    })

    test('a cold chat that the load warms is applied in the same pass', async () => {
        setCharacters([character({}, [{ id: 'chat', message: [{ data: `${COLD_POINTER_HEADER}key` }] }])])
        const r = rig([listing(K1)])
        r.preLoad.mockImplementationOnce(async () => { setCharacters([character()]) })
        await pass(r)
        expect(r.preLoad).toHaveBeenCalledTimes(1)
        expect(r.apply).toHaveBeenCalledTimes(1)
    })

    test('held keys: inflight and awaiting-save are skipped, release is consumed with no note', async () => {
        const r = rig([listing(K1), listing(K2, { outcome: 'failed' })])
        holdInflight(K1)
        noteBound(K1)
        noteInvoked(K1)
        holdInflight(K2)
        noteReplyPushed(K2, 'cha', 1)
        await pass(r)
        expect(r.apply).not.toHaveBeenCalled()
        expect(r.consume).not.toHaveBeenCalled()
        expect(r.notices).toEqual([])

        // A key whose consume found Rust still writing is `release`: the next pass consumes it, with no note.
        const again = rig([listing(K1, { outcome: 'failed' })])
        holdInflight(K1)
        noteBodySource(K1, 'record')
        noteBound(K1)
        noteInvoked(K1)
        again.consume.mockRejectedValueOnce(new Error('live: reply is still being received'))
        await settleNativeReplyInflight(K1)
        expect(heldReply(K1)?.state).toBe('release')
        await pass(again)
        expect(again.consume).toHaveBeenCalledTimes(2)
        expect(again.notices).toEqual([])
        expect(heldReply(K1)).toBeUndefined()
    })

    test('a live record is skipped', async () => {
        const r = rig([{ key: K1, state: 'live', parked: false }])
        await pass(r)
        expect(r.readBody).not.toHaveBeenCalled()
    })

    test('a parked record is shown once per launch and never consumed by the pass', async () => {
        const r = rig([listing(K1, { parked: true })])
        const reconciler = createReconciler(r.deps)
        await reconciler.request()
        await reconciler.request()
        expect(r.showParked).toHaveBeenCalledTimes(1)
        expect(r.consume).not.toHaveBeenCalled()
        expect(r.park).not.toHaveBeenCalled()
    })

    test('a parked record whose body no longer reads as text stays parked and is reported once per launch', async () => {
        const r = rig([listing(K1, { parked: true })], { text: null })
        await pass(r, 2)
        expect(r.discard).not.toHaveBeenCalled()
        expect(r.consume).not.toHaveBeenCalled()
        expect(r.park).not.toHaveBeenCalled()
        expect(r.showParked).not.toHaveBeenCalled()
        expect(r.notices).toEqual([expect.stringContaining(`unreadable:${K1}:`)])
    })

    test('an apply that fails is told once and the record is kept', async () => {
        const r = rig([listing(K1)], { apply: 'failed' })
        await pass(r, 2)
        expect(r.notices).toEqual(['failed:Alice'])
        expect(r.consume).not.toHaveBeenCalled()
    })
})

describe('single flight and recheck', () => {
    test('requests during a pass run one more pass, not a second at once', async () => {
        const r = rig([])
        const reconciler = createReconciler(r.deps)
        const first = reconciler.request()
        const second = reconciler.request()
        const third = reconciler.request()
        await Promise.all([first, second, third])
        expect(r.list).toHaveBeenCalledTimes(2)
    })

    test('a message that appears while a cold character is restored is consumed, not applied', async () => {
        setCharacters([character({ coldstorage: 'unit' })])
        const r = rig([listing(K1)])
        r.restore.mockImplementationOnce(async () => {
            setCharacters([character({}, [{ id: 'chat', message: [{ data: 'a reply', chatId: K1 }] }])])
            return true
        })
        await pass(r)
        expect(r.apply).not.toHaveBeenCalled()
        expect(r.consume).toHaveBeenCalledWith(K1)
    })
})

describe('gates', () => {
    test('a closed gate lists nothing, before and after the list', async () => {
        const r = rig([listing(K1)])
        r.gate.value = false
        await pass(r)
        expect(r.list).not.toHaveBeenCalled()
        const hidden = rig([listing(K1)])
        hidden.list.mockImplementationOnce(async () => { hidden.gate.value = false; return hidden.listings })
        await pass(hidden)
        expect(hidden.readBody).not.toHaveBeenCalled()
        expect(hidden.apply).not.toHaveBeenCalled()
    })
})

describe('recoveredText', () => {
    const blob = { ...base, parse: parseRule }
    const tools = { escape: (text: string) => `esc(${text})`, replacers: async (text: string) => `${text}!` }
    const body = (content: string) => JSON.stringify({ choices: [{ message: { content } }] })

    test('reads through the parser, escapes when the blob says so, replaces, and trims', async () => {
        expect(await recoveredText(200, body('  hello  '), blob, tools)).toBe('hello  !'.trim())
        expect(await recoveredText(200, body('x'), { ...blob, escape: true }, tools)).toBe('esc(x)!')
    })

    test('no text: not JSON, a failed status, an error field, no choice, an empty reply', async () => {
        expect(await recoveredText(200, '<html>', blob, tools)).toBeNull()
        expect(await recoveredText(502, body('x'), blob, tools)).toBeNull()
        expect(await recoveredText(200, JSON.stringify({ error: { message: 'e' }, choices: [] }), blob, tools)).toBeNull()
        expect(await recoveredText(200, '{}', blob, tools)).toBeNull()
        expect(await recoveredText(200, body(''), blob, { ...tools, replacers: async (t) => t })).toBeNull()
    })

    test('the first candidate of a multiline answer', async () => {
        const multi = JSON.stringify({ choices: [{ message: { content: 'one' } }, { message: { content: 'two' } }] })
        expect(await recoveredText(200, multi, { ...blob, parse: { ...parseRule, multiGen: true } }, { ...tools, replacers: async (t) => t })).toBe('one')
    })

    test('a multiline first candidate is pushed raw: no escape and no replacers', async () => {
        const multi = JSON.stringify({ choices: [{ message: { content: 'one' } }, { message: { content: 'two' } }] })
        const escape = vi.fn((text: string) => `esc(${text})`)
        const replacers = vi.fn(async (text: string) => `${text}!`)
        expect(await recoveredText(200, multi, { ...blob, escape: true, parse: { ...parseRule, multiGen: true } }, { escape, replacers })).toBe('one')
        expect(escape).not.toHaveBeenCalled()
        expect(replacers).not.toHaveBeenCalled()
    })
})
