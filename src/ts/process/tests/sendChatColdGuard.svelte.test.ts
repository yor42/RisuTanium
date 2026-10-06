/**
 * CHORE-07 -- `sendChat` must refuse to run on a chat
 * whose first message is still a live cold-storage pointer (`isColdChat`),
 * reporting through `alertError` and returning `false` before it ever
 * flips `doingChat` to `true` or touches `chat.message`.
 *
 * This file drives the REAL `sendChat`/`doingChat` from
 * `src/ts/process/index.svelte.ts` and the REAL, dependency-free
 * `isColdChat` from `src/ts/process/coldstorageData.ts` (through
 * `sendChat`'s own import, not imported directly here). Every other module
 * `index.svelte.ts` imports is mocked below purely so the module can be
 * loaded at all -- none of them is expected to be called, because the new
 * guard must return before `sendChat` reaches any of them. `src/lang` is
 * deliberately left REAL (unmocked): it is a small, side-effect-free object
 * literal (`src/lang/index.ts` just merges plain data files), and leaving
 * it real lets this test assert the guard's alert uses the actual language
 * string rather than a mocked stand-in.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writable, get } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'

//#region module mocks -- every static import of `index.svelte.ts` other
// than `svelte/store`, `uuid`, `src/lang`, and the module under test itself.

const alertErrorMock = vi.hoisted(() => vi.fn())

vi.mock(import('../../storage/database.svelte'), () => ({
    changeToPreset: vi.fn(),
    setCurrentChat: vi.fn(),
}) as unknown as typeof import('../../storage/database.svelte'))

vi.mock(import('../../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        CharEmotion: writable({}),
        selectedCharID: writable(-1),
    } as unknown as typeof import('../../stores.svelte')
})

vi.mock(import('../../tokenizer'), () => ({
    ChatTokenizer: class {},
    tokenize: vi.fn(),
    tokenizeNum: vi.fn(),
}) as unknown as typeof import('../../tokenizer'))

vi.mock(import('../../alert'), () => ({
    alertError: alertErrorMock,
    alertToast: vi.fn(),
}) as unknown as typeof import('../../alert'))

vi.mock(import('../../parser/chatML'), () => ({
    parseChatML: vi.fn(),
}) as unknown as typeof import('../../parser/chatML'))

vi.mock(import('../lorebook.svelte'), () => ({
    loadLoreBookV3Prompt: vi.fn(),
}) as unknown as typeof import('../lorebook.svelte'))

vi.mock(import('../../util'), () => ({
    findCharacterbyId: vi.fn(),
    getAuthorNoteDefaultText: vi.fn(),
    getPersonaPrompt: vi.fn(),
    getUserName: vi.fn(),
    isLastCharPunctuation: vi.fn(),
    trimUntilPunctuation: vi.fn(),
    parseToggleSyntax: vi.fn(),
    prebuiltAssetCommand: vi.fn(),
}) as unknown as typeof import('../../util'))

vi.mock(import('../request/request'), () => ({
    requestChatData: vi.fn(),
}) as unknown as typeof import('../request/request'))

vi.mock(import('../stableDiff'), () => ({
    stableDiff: vi.fn(),
}) as unknown as typeof import('../stableDiff'))

vi.mock(import('../scripts'), () => ({
    processScript: vi.fn(),
    processScriptFull: vi.fn(),
    risuChatParser: vi.fn(),
}) as unknown as typeof import('../scripts'))

vi.mock(import('../exampleMessages'), () => ({
    exampleMessage: vi.fn(),
}) as unknown as typeof import('../exampleMessages'))

vi.mock(import('../tts'), () => ({
    sayTTS: vi.fn(),
}) as unknown as typeof import('../tts'))

vi.mock(import('../memory/supaMemory'), () => ({
    supaMemory: vi.fn(),
}) as unknown as typeof import('../memory/supaMemory'))

vi.mock(import('../group'), () => ({
    groupOrder: vi.fn(),
}) as unknown as typeof import('../group'))

vi.mock(import('../triggers'), () => ({
    runTrigger: vi.fn(),
}) as unknown as typeof import('../triggers'))

vi.mock(import('../memory/hypamemory'), () => ({
    HypaProcesser: class {},
}) as unknown as typeof import('../memory/hypamemory'))

vi.mock(import('../embedding/addinfo'), () => ({
    additionalInformations: vi.fn(),
}) as unknown as typeof import('../embedding/addinfo'))

vi.mock(import('../files/inlays'), () => ({
    getInlayAsset: vi.fn(),
}) as unknown as typeof import('../files/inlays'))

vi.mock(import('../models/modelString'), () => ({
    getGenerationModelString: vi.fn(),
}) as unknown as typeof import('../models/modelString'))

vi.mock(import('../inlayScreen'), () => ({
    runInlayScreen: vi.fn(),
}) as unknown as typeof import('../inlayScreen'))

vi.mock(import('../prereroll'), () => ({
    addRerolls: vi.fn(),
}) as unknown as typeof import('../prereroll'))

vi.mock(import('../transformers'), () => ({
    runImageEmbedding: vi.fn(),
}) as unknown as typeof import('../transformers'))

vi.mock(import('../memory/hanuraiMemory'), () => ({
    hanuraiMemory: vi.fn(),
}) as unknown as typeof import('../memory/hanuraiMemory'))

vi.mock(import('../memory/hypav2'), () => ({
    hypaMemoryV2: vi.fn(),
}) as unknown as typeof import('../memory/hypav2'))

vi.mock(import('../scriptings'), () => ({
    runLuaEditTrigger: vi.fn(),
}) as unknown as typeof import('../scriptings'))

vi.mock(import('../../model/modellist'), () => ({
    getModelInfo: vi.fn(),
    LLMFlags: {},
}) as unknown as typeof import('../../model/modellist'))

vi.mock(import('../memory/hypav3'), () => ({
    hypaMemoryV3: vi.fn(),
}) as unknown as typeof import('../memory/hypav3'))

vi.mock(import('../modules'), () => ({
    getModuleAssets: vi.fn(),
    getModuleToggles: vi.fn(),
}) as unknown as typeof import('../modules'))

vi.mock(import('../../globalApi.svelte'), () => ({
    readImage: vi.fn(),
    // AV-3: getFileSrcCached calls this predicate.
}) as unknown as typeof import('../../globalApi.svelte'))

vi.mock(import('../../plugins/plugins.svelte'), () => ({
    pluginV2: { chatOutput: new Set() },
}) as unknown as typeof import('../../plugins/plugins.svelte'))

//#endregion

import { sendChat, doingChat } from '../index.svelte'
import { DBState, selectedCharID } from '../../stores.svelte'
import { coldStorageHeader } from '../coldstorageData'

function makePointerChatDb(coldKey: string): Database {
    return {
        characters: [{
            chaId: 'r6-char',
            name: 'R6 Character',
            type: 'character',
            chatPage: 0,
            chats: [{
                message: [{ time: 1, data: coldStorageHeader + coldKey, role: 'char' }],
                note: '',
                name: '',
                localLore: [],
            }],
        }],
    } as unknown as Database
}

describe('CHORE-07: sendChat refuses to run on a still-cold-storage-pointer chat', () => {
    beforeEach(() => {
        alertErrorMock.mockClear()
        doingChat.set(false)
    })

    test('sendChat returns false, leaves doingChat false, and does not touch messages', async () => {
        const db = makePointerChatDb('r6-cold-key')
        DBState.db = db
        selectedCharID.set(0)

        const messageBefore = JSON.parse(JSON.stringify(db.characters[0].chats[0].message))

        const result = await sendChat()

        expect(result).toBe(false)
        expect(get(doingChat)).toBe(false)
        expect(DBState.db.characters[0].chats[0].message).toEqual(messageBefore)
        expect(alertErrorMock).toHaveBeenCalledTimes(1)
    })
})
