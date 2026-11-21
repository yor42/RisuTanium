import { get, writable } from 'svelte/store'
import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// The selection is a `$state` mirror of the selected character id and the database a `$state` object, like production:
// a plain object would give the engine's deriveds no dependencies, so they would never recompute.
vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} })
    const selection = $state({ selId: 0 })
    return {
        DBState: state,
        selIdState: selection,
        selectedCharID: writable(0),
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const stores = await import('src/ts/stores.svelte')
    // Like production, the getters follow the selectedCharID store, which is not a signal.
    const characterAt = () => stores.DBState.db.characters?.[get(stores.selectedCharID)]
    return {
        appVer: '1234.5.67',
        getDatabase: () => stores.DBState.db,
        getCurrentCharacter: () => characterAt(),
        getCurrentChat: () => {
            const owner = characterAt()
            return owner?.chats?.[owner.chatPage]
        },
    } as unknown as typeof import('src/ts/storage/database.svelte')
})
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    aiWatermarkingLawApplies: () => false,
    getFileSrc: () => Promise.resolve(''),
    readImage: () => Promise.resolve(undefined),
}))

import * as util from 'src/ts/util'
import * as moduleRefList from 'src/ts/process/moduleRefList'
import type { RunSubject } from 'src/ts/process/chatOrigin'
import type { Database } from 'src/ts/storage/database.svelte'
import { MODULE_STUB_KEY, MODULE_STUB_VALUE } from 'src/ts/storage/moduleStub'
import { DBState, selIdState, selectedCharID } from 'src/ts/stores.svelte'
import { getGlobalChatVar } from '../chatVar.svelte'
import { risuChatParser } from '../parser.svelte'

const listSpy = vi.spyOn(moduleRefList, 'moduleListOf')
const parseSpy = vi.spyOn(util, 'parseToggleSyntax')

const PROMPT = 'nsfw=NSFW===1\nmood=Mood=select=calm,angry=angry\nplain=Plain\nsel0=Sel0=select=a,b=a'

function buildDatabase(): Database {
    return {
        customPromptTemplateToggle: PROMPT,
        modules: [
            { id: 'modA', name: 'Module A', customModuleToggle: 'ma=MA===1\nmood=Mood=select=calm,angry=calm' },
            { id: 'modB', name: 'Module B', customModuleToggle: '' },
        ],
        enabledModules: [],
        moduleIntergration: '',
        personas: [],
        globalChatVariables: {},
        templateDefaultVariables: '',
        characters: [
            {
                type: 'character',
                chaId: 'cha-a',
                chatPage: 0,
                modules: ['modA'],
                customModuleToggle: 'ownA=OwnA===1',
                defaultVariables: '',
                chats: [
                    { modules: [], message: [], scriptstate: {}, GLGlobalVariables: {} },
                    { modules: ['modB'], message: [], scriptstate: {}, GLGlobalVariables: {} },
                ],
            },
            {
                type: 'character',
                chaId: 'cha-b',
                chatPage: 0,
                modules: [],
                customModuleToggle: 'own=Own===1',
                defaultVariables: '',
                chats: [{ modules: [], message: [], scriptstate: {}, GLGlobalVariables: {} }],
            },
        ],
    } as unknown as Database
}

function subjectFor(characterIndex: number, chatIndex: number): RunSubject {
    // Resolves the live slot on every call, like a real subject, so a held proxy never goes stale.
    return {
        resolve: () => {
            const owner = DBState.db.characters[characterIndex]
            return { owner, chat: owner.chats[chatIndex] }
        },
    } as unknown as RunSubject
}

function selectCharacter(index: number): void {
    selectedCharID.set(index)
    selIdState.selId = index
}

beforeEach(async () => {
    selectCharacter(0)
    DBState.db = buildDatabase()
    await Promise.resolve()
    listSpy.mockClear()
    parseSpy.mockClear()
})

afterEach(async () => {
    await Promise.resolve()
})

describe('getGlobalChatVar with author defaults', () => {
    // regression reproducer: the base answers 'null' for an unset toggle
    test('T2.1 an unset check reads as on and an unset select as its default index', () => {
        expect(getGlobalChatVar('toggle_nsfw')).toBe('1')
        expect(getGlobalChatVar('toggle_mood')).toBe('1')
        const subject = subjectFor(0, 0)
        expect(getGlobalChatVar('toggle_nsfw', subject)).toBe('1')
        expect(getGlobalChatVar('toggle_mood', subject)).toBe('1')
    })

    // regression reproducer: the base gives '' and 'null' back
    test('T2.2 an empty or null stored value is unset, shared and chat-local', () => {
        DBState.db.globalChatVariables.toggle_nsfw = ''
        expect(getGlobalChatVar('toggle_nsfw')).toBe('1')
        DBState.db.globalChatVariables.toggle_nsfw = 'null'
        expect(getGlobalChatVar('toggle_nsfw')).toBe('1')
        delete DBState.db.globalChatVariables.toggle_nsfw

        const chat = DBState.db.characters[0].chats[0]
        chat.useLocallySetGlobalVariables = true
        chat.GLGlobalVariables = { toggle_nsfw: '' }
        expect(getGlobalChatVar('toggle_nsfw')).toBe('1')
        chat.GLGlobalVariables = { toggle_nsfw: 'null' }
        expect(getGlobalChatVar('toggle_nsfw')).toBe('1')
    })

    // compatibility guard: passes before and after
    test('T2.3 a stored 0 wins over the default, shared and chat-local, and so does index 0', () => {
        DBState.db.globalChatVariables.toggle_nsfw = '0'
        DBState.db.globalChatVariables.toggle_mood = '0'
        expect(getGlobalChatVar('toggle_nsfw')).toBe('0')
        expect(getGlobalChatVar('toggle_mood')).toBe('0')
        expect(getGlobalChatVar('toggle_nsfw', subjectFor(0, 0))).toBe('0')

        delete DBState.db.globalChatVariables.toggle_nsfw
        const chat = DBState.db.characters[0].chats[0]
        chat.useLocallySetGlobalVariables = true
        chat.GLGlobalVariables = { toggle_nsfw: '0' }
        expect(getGlobalChatVar('toggle_nsfw')).toBe('0')
        expect(getGlobalChatVar('toggle_nsfw', subjectFor(0, 0))).toBe('0')
    })

    // compatibility guard: passes before and after
    test('T2.3 a chat-local value wins over a shared value and over the default', () => {
        DBState.db.globalChatVariables.toggle_nsfw = '1'
        const chat = DBState.db.characters[0].chats[0]
        chat.GLGlobalVariables = { toggle_nsfw: '0' }
        expect(getGlobalChatVar('toggle_nsfw')).toBe('0')
        chat.GLGlobalVariables = {}
        expect(getGlobalChatVar('toggle_nsfw')).toBe('1')
    })

    // compatibility guard: passes before and after
    test('T2.4 without a default, absent reads null, shared empty reads empty, non-toggle keys are untouched', () => {
        expect(getGlobalChatVar('toggle_plain')).toBe('null')
        expect(getGlobalChatVar('toggle_nothing')).toBe('null')
        DBState.db.globalChatVariables.toggle_plain = ''
        expect(getGlobalChatVar('toggle_plain')).toBe('')
        // A non-toggle key named like a toggle never reaches the default lookup.
        expect(getGlobalChatVar('nsfw')).toBe('null')
        expect(getGlobalChatVar('other')).toBe('null')
        DBState.db.globalChatVariables.other = 'x'
        expect(getGlobalChatVar('other')).toBe('x')
        DBState.db.globalChatVariables.other = ''
        expect(getGlobalChatVar('other')).toBe('')
    })

    // compatibility guard: passes before and after (kills a removed prefix test or an eager default)
    test('T2.5 non-toggle keys and set toggle keys cause no gather and no parse', () => {
        DBState.db.globalChatVariables.toggle_nsfw = '0'
        for (let i = 0; i < 1000; i++) {
            getGlobalChatVar('other')
            getGlobalChatVar('toggle_nsfw')
            getGlobalChatVar('nsfw', subjectFor(1, 0))
        }
        expect(listSpy.mock.calls.length).toBe(0)
        expect(parseSpy.mock.calls.length).toBe(0)
    })

    // regression reproducer: the base answers 'null' on the first assertion
    test('T2.6 reads follow edits of the definitions, the selection and the chat', async () => {
        expect(getGlobalChatVar('toggle_late')).toBe('null')
        DBState.db.customPromptTemplateToggle += '\nlate=Late===1'
        expect(getGlobalChatVar('toggle_late')).toBe('1')

        // A module enabled through the id list.
        expect(getGlobalChatVar('toggle_modB1')).toBe('null')
        DBState.db.modules[1].customModuleToggle = 'modB1=ModB1===1'
        DBState.db.enabledModules.push('modB')
        expect(getGlobalChatVar('toggle_modB1')).toBe('1')

        // A stub replaced by the loaded module in its slot.
        DBState.db.modules.push({ [MODULE_STUB_KEY]: MODULE_STUB_VALUE, id: 'modS' } as unknown as Database['modules'][number])
        DBState.db.enabledModules.push('modS')
        expect(getGlobalChatVar('toggle_slot')).toBe('null')
        DBState.db.modules[DBState.db.modules.length - 1] = {
            id: 'modS', name: 'Loaded', customModuleToggle: 'slot=Slot===1',
        } as unknown as Database['modules'][number]
        expect(getGlobalChatVar('toggle_slot')).toBe('1')

        // The selection switch changes the owner whose text applies, in the store and in its `$state` mirror.
        expect(getGlobalChatVar('toggle_own')).toBe('null')
        expect(getGlobalChatVar('toggle_ownA')).toBe('1')
        selectCharacter(1)
        expect(getGlobalChatVar('toggle_own')).toBe('1')
        expect(getGlobalChatVar('toggle_ownA')).toBe('null')
        selectCharacter(0)
        expect(getGlobalChatVar('toggle_ownA')).toBe('1')

        // A chat switch changes the chat modules.
        DBState.db.modules[1].customModuleToggle = 'chatMod=ChatMod===1'
        DBState.db.enabledModules = []
        expect(getGlobalChatVar('toggle_chatMod')).toBe('null')
        DBState.db.characters[0].chatPage = 1
        expect(getGlobalChatVar('toggle_chatMod')).toBe('1')
        DBState.db.characters[0].chatPage = 0
        expect(getGlobalChatVar('toggle_chatMod')).toBe('null')
    })

    // regression reproducer: the base answers 'null'
    test('T2.7 a subject for another owner takes that owner\'s text while the selection owner has none', () => {
        expect(getGlobalChatVar('toggle_own', subjectFor(1, 0))).toBe('1')
        expect(getGlobalChatVar('toggle_own')).toBe('null')
        expect(getGlobalChatVar('toggle_ownA', subjectFor(1, 0))).toBe('null')
    })

    // regression reproducer: the base answers 'null'
    test('T2.8 the prompt decides before a module, and a module before the owner', () => {
        // Prompt `mood` default angry (index 1) beats module A's calm (index 0).
        expect(getGlobalChatVar('toggle_mood')).toBe('1')

        DBState.db.customPromptTemplateToggle = 'x=X'
        // Without the prompt text, the referenced module decides.
        expect(getGlobalChatVar('toggle_mood')).toBe('0')

        // A module row without the key lets the owner's own row decide.
        DBState.db.characters[0].modules = []
        const owner = DBState.db.characters[0]
        if (owner.type === 'character') {
            owner.customModuleToggle = 'mood=Mood=select=calm,angry=angry'
        }
        expect(getGlobalChatVar('toggle_mood')).toBe('1')
    })

    // reproducer: the base never reads the default; the 2b parser path reads it through this resolver
    test('T2.12(e) non-toggle reads add no dependency to the effects that read toggles', () => {
        let toggleRuns = 0
        let otherRuns = 0
        const dispose = $effect.root(() => {
            for (let i = 0; i < 20; i++) {
                $effect.pre(() => {
                    toggleRuns++
                    expect(getGlobalChatVar('toggle_nsfw')).toBe('1')
                })
                $effect.pre(() => {
                    otherRuns++
                    getGlobalChatVar('other')
                })
            }
        })
        try {
            flushSync()
            expect(toggleRuns).toBe(20)
            expect(otherRuns).toBe(20)
            DBState.db.globalChatVariables.other = 'v'
            flushSync()
            expect(otherRuns).toBe(40)
            expect(toggleRuns).toBe(20)
        } finally {
            dispose()
        }
    })

    // regression reproducer: effects on an unset toggle see the default and follow its edit
    test('T2.12(e) an effect reading an unset toggle shows the default and follows a stored value', () => {
        const seen: string[] = []
        const dispose = $effect.root(() => {
            $effect.pre(() => { seen.push(getGlobalChatVar('toggle_nsfw')) })
        })
        try {
            flushSync()
            DBState.db.globalChatVariables.toggle_nsfw = '0'
            flushSync()
            delete DBState.db.globalChatVariables.toggle_nsfw
            flushSync()
            expect(seen).toEqual(['1', '0', '1'])
        } finally {
            dispose()
        }
    })
})

describe('T2.9 parse-path budget', () => {
    const TEXT = '{{getglobalvar::toggle_nsfw}}{{#when::toggle::nsfw}}Y{{/when}}{{#when::mood::tis::1}}A{{/when}}{{? @toggle_nsfw + 1}}{{getglobalvar::toggle_plain}}'

    // compatibility guard (passes before with 0 gathers; kills a per-read gather and a read-first stabilised derived)
    test('100 parses of five unset toggle tags after an equal-defaults edit gather at most once', async () => {
        expect(risuChatParser(TEXT)).toBe('1YA2null')
        await Promise.resolve()
        DBState.db.customPromptTemplateToggle += '\nextra=Extra'
        listSpy.mockClear()
        for (let i = 0; i < 100; i++) {
            risuChatParser(TEXT)
        }
        expect(listSpy.mock.calls.length).toBeLessThanOrEqual(1)
        expect(risuChatParser(TEXT)).toBe('1YA2null')
    })
})