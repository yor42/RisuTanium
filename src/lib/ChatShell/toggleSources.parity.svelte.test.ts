// @vitest-environment jsdom
/**
 * The two readers of "which toggle texts apply to this chat" must agree: the panel's `toggleSourcesOf` (the real
 * TogglesPanel module script over the real `process/modules`) and the engine's `engineToggleTextsOf`. A divergence would
 * make the panel show a default the engine does not read, or the reverse. Compatibility guard: it passes on both bases of
 * the parity rule and fails when either side changes its source order, stub rule or reference rule. One `$state`
 * database, a selection mirrored into the store and `selIdState` as in production.
 */
import { get, writable } from 'svelte/store'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} })
    const selection = $state({ selId: 0 })
    return {
        DBState: state,
        selIdState: selection,
        selectedCharID: writable(0),
        ReloadGUIPointer: writable(0),
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const stores = await import('src/ts/stores.svelte')
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

import { DBState } from 'src/ts/stores.svelte'
import { MODULE_STUB_KEY, MODULE_STUB_VALUE } from 'src/ts/storage/moduleStub'
import type { Database } from 'src/ts/storage/database.svelte'
import { engineToggleTextsOf } from 'src/ts/parser/toggleDefaultsLive.svelte'
import { toggleDefaultsOf } from 'src/ts/parser/toggleDefaults'
import { toggleSourcesOf } from './TogglesPanel.svelte'

function buildDatabase(): Database {
    const stub = Object.assign({ id: 'stub', name: 'Stub', customModuleToggle: 's=Hidden===1' }, { [MODULE_STUB_KEY]: MODULE_STUB_VALUE })
    return {
        customPromptTemplateToggle: 'p=Prompt\nmood=Mood=select=calm,angry=angry',
        botPresets: [{ name: 'Preset' }],
        botPresetsId: 0,
        modules: [
            stub,
            { id: 'empty', name: 'Empty', customModuleToggle: '' },
            { id: 'ma', name: 'Module A', customModuleToggle: 'a=A===1' },
            { id: 'mb', name: 'Module B', customModuleToggle: 'b=B\nmood=Mood again=select=x,y=y' },
            { id: 'ns', name: 'Namespaced', namespace: 'nsx', customModuleToggle: 'n=N===1' },
            { id: 'pm', name: 'Persona module', customModuleToggle: 'pe=Persona===1' },
            { id: 'unused', name: 'Unreferenced', customModuleToggle: 'u=U===1' },
        ],
        enabledModules: ['stub', 'empty', 'ma', 'mb', 'nsx'],
        moduleIntergration: '',
        personas: [{ id: 'persona-1', embeddedModule: { id: 'pm' } }],
        characters: [
            {
                type: 'character',
                chaId: 'cha-a',
                name: 'Ari',
                chatPage: 0,
                modules: [],
                customModuleToggle: 'own=Own===1',
                chats: [{ modules: [], message: [], bindedPersona: 'persona-1' }],
            },
        ],
    } as unknown as Database
}

beforeEach(() => {
    DBState.db = buildDatabase()
})

describe('toggle sources parity (T3.10)', () => {
    test('the panel and the engine list the same texts in the same order, and read the same defaults', () => {
        const owner = DBState.db.characters[0]
        if (owner.type !== 'character') throw new Error('fixture owner is a character')
        const chat = owner.chats[owner.chatPage]

        const panel = toggleSourcesOf(owner).map((input) => input.text)
        const engine = engineToggleTextsOf(owner, chat)

        expect(panel).toEqual(engine)
        expect(panel).toEqual([
            'p=Prompt\nmood=Mood=select=calm,angry=angry',
            'a=A===1',
            'b=B\nmood=Mood again=select=x,y=y',
            'n=N===1',
            'pe=Persona===1',
            'own=Own===1',
        ])
        expect([...toggleDefaultsOf(panel)]).toEqual([...toggleDefaultsOf(engine)])
        expect(Object.fromEntries(toggleDefaultsOf(panel))).toEqual({ toggle_mood: '1', toggle_a: '1', toggle_n: '1', toggle_pe: '1', toggle_own: '1' })
    })

    test('an owner without toggle text and a chat without a bound persona agree too', () => {
        const owner = DBState.db.characters[0]
        if (owner.type !== 'character') throw new Error('fixture owner is a character')
        owner.customModuleToggle = ''
        const chat = owner.chats[owner.chatPage]
        chat.bindedPersona = ''

        expect(toggleSourcesOf(owner).map((input) => input.text)).toEqual(engineToggleTextsOf(owner, chat).map((text) => text))
        expect(engineToggleTextsOf(owner, chat)).not.toContain('pe=Persona===1')
    })
})
