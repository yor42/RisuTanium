/**
 * The display trigger of an editdisplay pass reads the current chat. A pass bound to a subject whose chat is not the
 * current chat skips it, so the current chat's trigger output never lands in another chat's display text.
 *
 * - A subject resolving to another chat (or to nothing): runTrigger is not called.
 * - A subject resolving to the current chat, and a call with no subject: runTrigger is called once with the current
 *   character and chat.
 * - A subject whose resolution carries no owner does not throw.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Chat } from '../../storage/database.svelte'
import type { OriginContext, RunSubject } from '../chatOrigin'
import type { character, customscript } from '../../storage/database.svelte'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
    currentChar: {} as Record<string, unknown>,
    currentChat: {} as Record<string, unknown>,
    triggerCalls: [] as unknown[][],
}))

vi.mock('../memory/measureFlag', () => ({ MEASURE: false }))
vi.mock('../../stores.svelte', () => ({
    CharEmotion: writable({}),
    selectedCharID: writable(0),
}))
vi.mock('../../storage/database.svelte', () => ({
    getDatabase: () => h.db,
    getCurrentCharacter: () => h.currentChar,
    getCurrentChat: () => h.currentChat,
}))
vi.mock('../../globalApi.svelte', () => ({ downloadFile: vi.fn() }))
vi.mock('../../alert', () => ({ alertError: vi.fn(), alertNormal: vi.fn() }))
vi.mock('src/lang', () => ({ language: {} }))
vi.mock('../../util', () => ({ selectSingleFile: vi.fn() }))
vi.mock('../../parser/parser.svelte', () => ({
    assetRegex: /{{(raw|path|img|image|video|audio|bgm|bgmloop|emotion|asset|video-img|source)::(.+?)}}/g,
    risuChatParser: (data: string) => data,
}))
vi.mock('../modules', () => ({
    getModuleAssets: () => [],
    getModuleRegexScripts: () => [],
}))
vi.mock('../memory/hypamemory', () => ({ HypaProcesser: class {} }))
vi.mock('../scriptings', () => ({
    runLuaEditTrigger: async (_char: unknown, _mode: string, data: string) => data,
}))
vi.mock('../../plugins/plugins.svelte', () => ({
    pluginV2: {
        editdisplay: new Set(),
        editoutput: new Set(),
        editprocess: new Set(),
        editinput: new Set(),
        chatOutput: new Set(),
    },
}))
vi.mock('../triggers', () => ({
    runTrigger: async (...args: unknown[]) => {
        h.triggerCalls.push(args)
        return undefined
    },
}))
vi.mock('../chatOrigin', () => ({ createRunSubject: vi.fn() }))

import { processScriptFull, resetScriptCache } from '../scripts'

const exportedChat = { id: 'b1', message: [] } as unknown as Chat

const currentOwner = { type: 'character', chaId: 'a', customscript: [] as customscript[] } as unknown as character

function subjectResolving(ctx: Pick<OriginContext, 'chat'> | null): RunSubject {
    return { resolve: () => ctx as OriginContext | null, mark: () => {} } as unknown as RunSubject
}

const run = (subject?: RunSubject) =>
    processScriptFull(currentOwner, 'text', 'editdisplay', -1, {}, undefined, subject)

beforeEach(() => {
    resetScriptCache()
    h.db = { presetRegex: [], dynamicAssets: false, characters: [] }
    h.currentChar = currentOwner as unknown as Record<string, unknown>
    h.currentChat = { id: 'a1', message: [] }
    h.triggerCalls = []
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('editdisplay display trigger and the pass subject', () => {
    // Regression reproducer: fails before the fix because the trigger runs for any subject.
    test('S-1 a subject resolving to another chat skips the trigger', async () => {
        await run(subjectResolving({ chat: exportedChat }))
        expect(h.triggerCalls).toHaveLength(0)
    })

    // Regression reproducer: fails before the fix because the trigger runs for any subject.
    test('S-1b a subject resolving to nothing skips the trigger', async () => {
        await run(subjectResolving(null))
        expect(h.triggerCalls).toHaveLength(0)
    })

    // Compatibility guard: passes before and after the fix.
    test('S-2 a subject resolving to the current chat runs the trigger once with the current character and chat', async () => {
        await run(subjectResolving({ chat: h.currentChat as unknown as Chat }))
        expect(h.triggerCalls).toHaveLength(1)
        expect(h.triggerCalls[0][0]).toBe(currentOwner)
        expect((h.triggerCalls[0][2] as { chat: unknown }).chat).toBe(h.currentChat)
    })

    // Compatibility guard: passes before and after the fix.
    test('S-3 a call with no subject runs the trigger once', async () => {
        await run()
        expect(h.triggerCalls).toHaveLength(1)
        expect(h.triggerCalls[0][0]).toBe(currentOwner)
    })

    // Compatibility guard: passes before and after the fix.
    test('S-4 a subject whose resolution has no owner does not throw', async () => {
        await expect(run(subjectResolving({ chat: h.currentChat as unknown as Chat }))).resolves.toMatchObject({ data: 'text' })
    })
})
