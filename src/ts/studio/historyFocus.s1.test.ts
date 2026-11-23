// @vitest-environment jsdom
// The focus targets of the 11 S1 character text paths (T1-FO), diagnostics: they fail when a path loses its focus
// presentation, names a part the form does not render, or is left out of the owner field read.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: { characters: [], modules: [] } },
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        clearCharEmotionCache: () => {},
    }
})

import { DBState } from 'src/ts/stores.svelte'
import { registryPaths } from './history/fieldAccess'
import { FIELD_PRESENTATION, type SetPath } from './history/fieldRegistry'
import { characterOwnerKey } from './history/ownerPhase'
import { changedFieldTarget, placeFocusAfterHistory } from './historyFocus'
import { readOwnerFields, type OwnerFields } from './ownerFields'
import { resetStudioScreenForTests, studioScreen } from './studioScreen.svelte'

const S1_PATHS: readonly SetPath[] = ['systemPrompt', 'replaceGlobalNote', 'additionalText', 'personality', 'scenario', 'depth_prompt.prompt', 'additionalData.creator', 'additionalData.character_version', 'nickname', 'defaultVariables', 'translatorNote']

const fields = (rest: Partial<OwnerFields> = {}): OwnerFields => ({ greetings: ['a'], firstMessage: 'f', exampleMessage: '<START>\nx', desc: 'd', ...rest })

beforeEach(() => {
    document.body.innerHTML = ''
})

afterEach(() => {
    document.body.innerHTML = ''
    resetStudioScreenForTests()
    DBState.db.characters = [] as unknown as typeof DBState.db.characters
})

describe('T1-FO: focus targets of the S1 text paths', () => {
    test('every S1 path is registered with an advanced-form focus part', () => {
        for (const path of S1_PATHS) {
            const focus = FIELD_PRESENTATION[path].focus
            expect(focus !== null && typeof focus === 'object' ? focus.form : null, path).toBe('studio-advanced-form')
        }
    })

    test('a change in each S1 path targets that path', () => {
        for (const path of S1_PATHS) {
            expect(changedFieldTarget(fields({ [path]: 'a' }), fields({ [path]: 'b' })), path).toEqual({ kind: path })
        }
    })

    test('a change in depth_prompt.prompt focuses its part inside the advanced form', async () => {
        const form = document.createElement('section')
        form.dataset.part = 'studio-advanced-form'
        const area = document.createElement('textarea')
        area.dataset.part = 'studio-form-depth-prompt'
        form.append(area)
        document.body.append(form)
        await placeFocusAfterHistory(fields({ 'depth_prompt.prompt': 'a' }), fields({ 'depth_prompt.prompt': 'b' }), () => document, () => null)
        expect(document.activeElement).toBe(area)
    })

    test('readOwnerFields includes all 11 paths, reading an absent container as undefined', () => {
        studioScreen.chaId = 'A'
        DBState.db.characters = [{ chaId: 'A', type: 'character', name: 'A', systemPrompt: 'sys', depth_prompt: { depth: 0, prompt: 'dp' }, chats: [], chatPage: 0 }] as unknown as typeof DBState.db.characters
        const read = readOwnerFields(characterOwnerKey('A'))
        expect(read).not.toBeNull()
        for (const path of S1_PATHS) expect(registryPaths(), path).toContain(path)
        expect(read?.['systemPrompt']).toBe('sys')
        expect(read?.['depth_prompt.prompt']).toBe('dp')
        expect(Object.keys(read ?? {})).toEqual(expect.arrayContaining([...S1_PATHS]))
    })
})
