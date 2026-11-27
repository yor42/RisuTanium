// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { writable } from 'svelte/store'

// The message actions' module graph and the reconcile's are replaced as in their own suites; the delete, the running map,
// the retire and the reconciler are real.
vi.mock('../../stores.svelte', () => ({ DBState: { db: { characters: [], askRemoval: false, instantRemove: false } }, selectedCharID: writable(0), selIdState: { selId: 0 }, ReloadChatPointer: writable({} as Record<number, number>), CurrentTriggerIdStore: writable(null) }))
vi.mock('../../storage/database.svelte', () => ({ getCurrentCharacter: vi.fn(), getCurrentChat: vi.fn() }))
vi.mock('../../alert', () => ({ alertConfirm: vi.fn(), alertSelect: vi.fn(), alertInput: vi.fn() }))
vi.mock('../../../lang', () => ({ language: {} }))
vi.mock('../../process/scriptings', () => ({ runLuaButtonTrigger: vi.fn(), runLuaInteractionTrigger: vi.fn() }))
vi.mock('../../process/triggers', () => ({ runTrigger: vi.fn() }))
vi.mock('../../process/moduleEnsure', () => ({ ensureModulesOrAlert: vi.fn() }))
vi.mock('../../process/moduleRefList', () => ({ hasModuleStubs: vi.fn(() => false) }))
vi.mock('../../util', () => ({ getUserName: vi.fn(() => 'User'), getUserIcon: vi.fn(() => ''), capitalize: vi.fn((value: string) => value), sleep: vi.fn(async () => {}) }))
vi.mock('../../chatCopy', () => ({ copyPlainText: vi.fn(), stripThoughtsForCopy: vi.fn((text: string) => text) }))
vi.mock('../../chatCard', () => ({ captureCardTheme: vi.fn(), noteNewerPlainCopy: vi.fn(), startCardCopy: vi.fn() }))
vi.mock('../../process/tts', () => ({ sayTTS: vi.fn(), stopTTS: vi.fn() }))
vi.mock('../../process/ttsSpeechText', () => ({ speakerSpeechText: vi.fn() }))
vi.mock('../../model/modellist', () => ({ getModelInfo: vi.fn(), LLMFlags: { deepSeekThinkingOutput: 7 } }))
vi.mock('../../globalApi.svelte', () => ({ getFileSrc: vi.fn() }))
vi.mock('../../parser/parser.svelte', () => ({ ParseMarkdown: vi.fn() }))
vi.mock('../../process/templates/jsonSchema', () => ({ extractJSON: (data: unknown) => String(data) }))

import { DBState } from '../../stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from '../../storage/characterSaveMarks'
import type { toSaveType } from '../../storage/risuSave'
import { deleteAtSettle, deleteNow, freezeDeleteIds } from '../../process/messageActions.svelte'
import { createUsageMeter } from '../../usage/usageMeter'
import { encodeReplyBlob, type ReplyBlobBase } from '../blob'
import { configurePageState, resetPageStateForTests, setReconcileTrigger } from '../pageState'
import { createReconciler, type ApplyOutcome, type ReconcileDeps } from '../reconcile'
import { installReplyCanceller, retireDeletedReplies } from '../retireOnDelete'
import { addRunningReplies, isNativeReplyRunning, resetRunningRepliesForTests, runningReplyInChat } from '../runningReplies.svelte'
import type { CancelOutcome, ReplyListing } from '../store'

/**
 * #616: a message deleted while its reply still runs natively. The delete retires the key, the reconciler discards its
 * record without a note and never places it, and the native stop is asked once per running key.
 */

const K1 = '0b9c1a7e-0000-4000-8000-000000000001'
const K2 = '0b9c1a7e-0000-4000-8000-000000000002'
const K3 = '0b9c1a7e-0000-4000-8000-000000000003'
const TARGET = { chaId: 'cha', chatId: 'chat', name: 'Alice' }
const base: ReplyBlobBase = {
    target: { chaId: 'cha', chatId: 'chat' }, targetName: 'Alice', saying: 'cha',
    generationInfo: { generationId: K1 }, promptInfo: {}, escape: false, requestedMs: 1,
}
const rule = { deepSeekThinkingOutput: false, extractJson: null, jsonSchema: false, multiGen: false }
const streamBlobText = JSON.stringify({
    format: 'risu-native-reply-blob', target: { chaId: base.target.chaId, chatId: base.target.chatId },
    targetName: base.targetName, saying: base.saying, generationInfo: base.generationInfo, promptInfo: base.promptInfo,
    parse: { kind: 'openai-chat-stream', ...rule }, usage: { modelKey: 'gpt-4o', inputEstimate: 120 },
    escape: base.escape, requestedMs: base.requestedMs,
})
const chatBlobText = encodeReplyBlob(base, { kind: 'openai-chat', ...rule })
const BYTES = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hello, world."}}]}\n\ndata: [DONE]\n\n')

type Msg = { role: 'user' | 'char', data: string, chatId?: string, interrupted?: true }
const user = (data: string): Msg => ({ role: 'user', data })
const reply = (chatId: string): Msg => ({ role: 'char', data: 'Hel', chatId, interrupted: true })

function setup(messages: Msg[]) {
    const chat = { id: 'chat', name: '', note: '', localLore: [], message: messages }
    const owner = { chaId: 'cha', name: 'Alice', type: 'character', chats: [chat], chatPage: 0 }
    Object.assign(DBState.db, { characters: [owner], askRemoval: false, instantRemove: false })
    return { owner: DBState.db.characters[0], chat: DBState.db.characters[0].chats[0] }
}

const stopped = (key: string): ReplyListing => ({ key, state: 'terminal', outcome: 'stopped', parked: false, createdMs: 10, pageVersion: 1, blob: streamBlobText, partialBytes: 30 })
const finished = (key: string): ReplyListing => ({ key, state: 'terminal', outcome: 'done', parked: false, createdMs: 10, pageVersion: 1, blob: streamBlobText, status: 200, bodyBytes: 20 })
const livePass = (key: string): ReplyListing => ({ key, state: 'live', parked: false, createdMs: 10, pageVersion: 1, blob: streamBlobText })

interface Rig {
    deps: ReconcileDeps
    notices: string[]
    discard: ReturnType<typeof vi.fn>
    consume: ReturnType<typeof vi.fn>
    applyStream: ReturnType<typeof vi.fn>
    apply: ReturnType<typeof vi.fn>
    settleUsage: ReturnType<typeof vi.fn>
}

function rig(list: () => Promise<ReplyListing[]>, options: {
    text?: string
    applyStream?: ApplyOutcome
    apply?: ApplyOutcome
    readPartialBytes?: () => Promise<Uint8Array>
} = {}): Rig {
    const notices: string[] = []
    const consume = vi.fn(async (_key: string) => ({ result: 'removed' as const, flushed: true }))
    configurePageState({
        store: { consume },
        waiter: { committedMarkCount: () => 0, markCount: () => 0, verdict: () => 'absent', afterNextCommit: () => {}, markCharacter: () => {}, requestSaveNow: () => {} },
        onUnreadable: () => {},
    })
    const discard = vi.fn(async (_key: string) => ({ result: 'removed' as const, flushed: true }))
    const meter = createUsageMeter()
    const applyStream = vi.fn(async (): Promise<ApplyOutcome> => options.applyStream ?? 'applied')
    const apply = vi.fn(async (): Promise<ApplyOutcome> => options.apply ?? 'applied')
    const settleUsage = vi.fn()
    const deps: ReconcileDeps = {
        store: {
            list,
            readBody: async () => '',
            readBodyBytes: async () => BYTES,
            readPartialBytes: options.readPartialBytes ?? (async () => BYTES),
            park: async () => {},
            discard,
        },
        gate: () => true,
        notice: (text) => notices.push(text),
        notes: {
            failedElsewhere: (name) => `failed:${name}`,
            stoppedElsewhere: (name) => `stopped:${name}`,
            interrupted: (name) => `interrupted:${name}`,
            unreadable: (key, problem) => `unreadable:${key}:${problem}`,
        },
        recoverText: async () => 'Hi',
        apply,
        replayStream: async () => ({ modelText: options.text ?? 'Hello, world.', meter, signatures: [] }),
        applyStream,
        settleUsage,
        restoreCharacter: async () => false,
        preLoadChat: async () => undefined,
        showParked: async () => {},
    }
    return { deps, notices, discard, consume, applyStream, apply, settleUsage }
}

const listOf = (...items: ReplyListing[]) => async () => items
const pass = (r: Rig) => createReconciler(r.deps).request()
const flush = async () => { for (let i = 0; i < 5; i++) { await Promise.resolve() } }

let tracker: toSaveType

beforeEach(() => {
    resetCharacterSaveMarksForTest()
    tracker = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    installCharacterSaveMarks({ tracker, schedule: vi.fn() })
    resetPageStateForTests()
    resetRunningRepliesForTests()
    installReplyCanceller(null)
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
    installReplyCanceller(null)
    vi.restoreAllMocks()
})

describe('a delete of a running reply (reproducers: their bodies exercise only base entry points)', () => {
    // P1, regression reproducer.
    it('P1: a stopped partial of a deleted message is discarded, never applied, with no note and no usage', async () => {
        const { owner, chat } = setup([user('hi'), reply(K1)])
        addRunningReplies([{ key: K1, target: TARGET }])
        expect(deleteNow(owner, chat, chat.message[1], 'one')).toBe(true)
        const r = rig(listOf(stopped(K1)))

        await pass(r)

        expect(r.applyStream).not.toHaveBeenCalled()
        expect(r.discard.mock.calls).toEqual([[K1]])
        expect(r.notices).toEqual([])
        expect(r.settleUsage).not.toHaveBeenCalled()
        expect(r.consume).not.toHaveBeenCalled()
    })

    // P1b, regression reproducer: a finished record of a stale map, a range delete, and a key outside the range.
    it('P1b: a "this and following" delete retires both keys of the range and spares a running key outside it', async () => {
        const { owner, chat } = setup([reply(K3), user('hi'), reply(K1), reply(K2)])
        addRunningReplies([{ key: K1, target: TARGET }, { key: K2, target: TARGET }, { key: K3, target: TARGET }])
        expect(deleteNow(owner, chat, chat.message[2], 'from')).toBe(true)
        const r = rig(listOf(finished(K1), finished(K2), livePass(K3)))

        await pass(r)

        expect(r.applyStream).not.toHaveBeenCalled()
        expect(r.discard.mock.calls).toEqual([[K1], [K2]])
        expect(r.notices).toEqual([])
        expect(isNativeReplyRunning(K3)).toBe(true)
        expect(isNativeReplyRunning(K1) || isNativeReplyRunning(K2)).toBe(false)
        expect(chat.message.map((item) => item.chatId)).toEqual([K3, undefined])
    })

    // P1c, regression reproducer: the delete a stopped send settles.
    it('P1c: a delete at settle retires the running key the same way', async () => {
        const { owner, chat } = setup([user('hi'), reply(K1)])
        addRunningReplies([{ key: K1, target: TARGET }])
        const ids = freezeDeleteIds(chat, chat.message[1], 'one')!
        expect(deleteAtSettle({ chaId: owner.chaId, chatId: chat.id }, ids, 'one')).toBe(true)
        const r = rig(listOf(stopped(K1)))

        await pass(r)

        expect(r.applyStream).not.toHaveBeenCalled()
        expect(r.discard.mock.calls).toEqual([[K1]])
        expect(r.notices).toEqual([])
    })

    // P1d, regression reproducer: a record with no partial bytes ends in a note and a consume, unless its key is retired.
    it('P1d: an interrupted record without partial bytes of a deleted message posts no note and is discarded', async () => {
        const { owner, chat } = setup([user('hi'), reply(K1)])
        addRunningReplies([{ key: K1, target: TARGET }])
        deleteNow(owner, chat, chat.message[1], 'one')
        const r = rig(listOf({ key: K1, state: 'dead', parked: false, createdMs: 10, pageVersion: 1, blob: streamBlobText }))

        await pass(r)

        expect(r.notices).toEqual([])
        expect(r.consume).not.toHaveBeenCalled()
        expect(r.discard.mock.calls).toEqual([[K1]])
    })

    it('P1d: an interrupted non-stream record of a deleted message posts no note and is discarded', async () => {
        const { owner, chat } = setup([user('hi'), reply(K1)])
        addRunningReplies([{ key: K1, target: TARGET }])
        deleteNow(owner, chat, chat.message[1], 'one')
        const r = rig(listOf({ key: K1, state: 'dead', parked: false, createdMs: 10, pageVersion: 1, blob: chatBlobText }))

        await pass(r)

        expect(r.notices).toEqual([])
        expect(r.consume).not.toHaveBeenCalled()
        expect(r.discard.mock.calls).toEqual([[K1]])
    })
    // P2, regression reproducer: the note and the status go in the same stretch as the splice.
    it('P2: the running note and the chat status are gone right after the delete', () => {
        const { owner, chat } = setup([user('hi'), reply(K1)])
        addRunningReplies([{ key: K1, target: TARGET }])
        expect(isNativeReplyRunning(K1)).toBe(true)

        deleteNow(owner, chat, chat.message[1], 'one')

        expect(isNativeReplyRunning(K1)).toBe(false)
        expect(runningReplyInChat('cha', 'chat', chat.message)).toBeNull()
    })

    // P3, regression reproducer: a pass that listed the key as live finishes after the delete.
    it('P3: a pass in flight that listed the key live does not bring it back', async () => {
        const { owner, chat } = setup([user('hi'), reply(K1)])
        addRunningReplies([{ key: K1, target: TARGET }])
        let answer!: (items: ReplyListing[]) => void
        const r = rig(() => new Promise<ReplyListing[]>((resolve) => { answer = resolve }))
        const running = pass(r)

        deleteNow(owner, chat, chat.message[1], 'one')
        answer([livePass(K1)])
        await running

        expect(isNativeReplyRunning(K1)).toBe(false)
        expect(runningReplyInChat('cha', 'chat', chat.message)).toBeNull()
    })

    // P4, regression reproducer: the delete lands inside the partial read.
    it('P4: a delete during the partial read applies nothing and discards the record', async () => {
        const { owner, chat } = setup([user('hi'), reply(K1)])
        addRunningReplies([{ key: K1, target: TARGET }])
        let release!: () => void
        const read = new Promise<Uint8Array>((resolve) => { release = () => resolve(BYTES) })
        const r = rig(listOf(stopped(K1)), { readPartialBytes: () => read })
        const running = pass(r)
        await flush()

        deleteNow(owner, chat, chat.message[1], 'one')
        release()
        await running

        expect(r.applyStream).not.toHaveBeenCalled()
        expect(r.discard.mock.calls).toEqual([[K1]])
        expect(r.notices).toEqual([])
    })

    // P4e, regression reproducer: an empty replay must not post the interrupted note or consume.
    it('P4e: a delete during the read of a record that replays to nothing posts no note', async () => {
        const { owner, chat } = setup([user('hi'), reply(K1)])
        addRunningReplies([{ key: K1, target: TARGET }])
        let release!: () => void
        const read = new Promise<Uint8Array>((resolve) => { release = () => resolve(BYTES) })
        const r = rig(listOf({ ...stopped(K1), state: 'dead', outcome: undefined }), { text: '  ', readPartialBytes: () => read })
        const running = pass(r)
        await flush()

        deleteNow(owner, chat, chat.message[1], 'one')
        release()
        await running

        expect(r.notices).toEqual([])
        expect(r.consume).not.toHaveBeenCalled()
        expect(r.discard.mock.calls).toEqual([[K1]])
    })
})

describe('the native stop of a deleted running reply', () => {
    const cancelled: CancelOutcome = { cancelled: true, result: 'removed', flushed: true }

    // P5, new-contract guard.
    it('P5: each running key in range is cancelled once, other keys and ordinary deletes never', async () => {
        const cancel = vi.fn(async (_key: string) => cancelled)
        installReplyCanceller({ cancel })
        addRunningReplies([{ key: K1, target: TARGET }, { key: K2, target: TARGET }])

        retireDeletedReplies([{ chatId: K1 }, { chatId: 'not-running' }, {}])
        retireDeletedReplies([{ chatId: K1 }])
        retireDeletedReplies([{ chatId: 'not-running' }])

        expect(cancel.mock.calls).toEqual([[K1]])
        expect(isNativeReplyRunning(K2)).toBe(true)
    })

    it('P5: a delete with no canceller installed still retires the key', () => {
        addRunningReplies([{ key: K1, target: TARGET }])

        retireDeletedReplies([{ chatId: K1 }])

        expect(isNativeReplyRunning(K1)).toBe(false)
    })

    it('P5: a rejected cancel is logged and asks for one reconcile pass', async () => {
        const trigger = vi.fn()
        setReconcileTrigger(trigger)
        installReplyCanceller({ cancel: vi.fn(async () => { throw new Error('ipc') }) })
        addRunningReplies([{ key: K1, target: TARGET }])

        retireDeletedReplies([{ chatId: K1 }])
        await flush()

        expect(trigger).toHaveBeenCalledTimes(1)
        expect(console.error).toHaveBeenCalled()
    })

    // P6, new-contract guard: the delete stands when the cancel fails, and a later pass discards the non-live record.
    it('P6: after a failed cancel a later pass discards the record with no note', async () => {
        const { owner, chat } = setup([user('hi'), reply(K1)])
        installReplyCanceller({ cancel: vi.fn(async () => { throw new Error('ipc') }) })
        addRunningReplies([{ key: K1, target: TARGET }])
        deleteNow(owner, chat, chat.message[1], 'one')
        await flush()
        const r = rig(listOf(stopped(K1)))

        await pass(r)

        expect(r.discard.mock.calls).toEqual([[K1]])
        expect(r.notices).toEqual([])
        expect(r.applyStream).not.toHaveBeenCalled()
    })
})

describe('the retired outcome of an apply', () => {
    // P11, new-contract guard (the apply's own check is tested with the apply).
    it('P11: a retired stream apply discards the record once and posts no note', async () => {
        setup([user('hi')])
        const r = rig(listOf(stopped(K1)), { applyStream: 'retired' })

        await pass(r)

        expect(r.applyStream).toHaveBeenCalledTimes(1)
        expect(r.discard.mock.calls).toEqual([[K1]])
        expect(r.notices).toEqual([])
        expect(r.consume).not.toHaveBeenCalled()
        expect(r.settleUsage).not.toHaveBeenCalled()
    })

    it('P11: a retired non-stream apply discards the record once and posts no note', async () => {
        setup([user('hi')])
        const done: ReplyListing = { key: K1, state: 'terminal', outcome: 'done', parked: false, createdMs: 10, pageVersion: 1, blob: chatBlobText, status: 200, bodyBytes: 20 }
        const r = rig(listOf(done), { apply: 'retired' })

        await pass(r)

        expect(r.apply).toHaveBeenCalledTimes(1)
        expect(r.discard.mock.calls).toEqual([[K1]])
        expect(r.notices).toEqual([])
        expect(r.consume).not.toHaveBeenCalled()
    })

    it('a discard that fails keeps the key retired and posts nothing', async () => {
        const { owner, chat } = setup([user('hi'), reply(K1)])
        addRunningReplies([{ key: K1, target: TARGET }])
        deleteNow(owner, chat, chat.message[1], 'one')
        const r = rig(listOf(finished(K1)))
        r.discard.mockRejectedValue(new Error('unreadable'))

        await pass(r)
        await pass(r)

        expect(r.applyStream).not.toHaveBeenCalled()
        expect(r.notices).toEqual([])
        expect(isNativeReplyRunning(K1)).toBe(false)
    })
})
