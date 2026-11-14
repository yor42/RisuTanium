/**
 * The persona converters clone the whole module, so they must drop the retained-paths field themselves: the field
 * belongs to the owner and device it was recorded on, and a new persona or module that carried it would become an
 * exportable, Replace-able holder of paths it never owned. The folder document is user data and stays.
 *
 * Feature guards: the drop did not exist before; each test fails against a converter that keeps the field.
 */
import { describe, expect, test, vi } from 'vitest'
import { safeStructuredClone as realSafeStructuredClone } from 'src/ts/polyfill'

// The setup file stubs the global with a JSON copy; the converters must be proven against the real helper.
vi.stubGlobal('safeStructuredClone', realSafeStructuredClone)

vi.mock('uuid', () => ({ v4: () => 'uuid-1' }))

vi.mock(import('src/ts/characters'), () => ({
    createBlankChar: vi.fn(() => ({
        name: '',
        firstMessage: '',
        desc: '',
        emotionImages: [],
        bias: [],
        viewScreen: 'none',
        globalLore: [],
        utilityBot: false,
        customscript: [],
        exampleMessage: '',
        creatorNotes: '',
        systemPrompt: '',
        alternateGreetings: [],
        tags: [],
    })),
}) as unknown as typeof import('src/ts/characters'))

import { convertModuleToPersona, convertPersonaToModule } from 'src/ts/interchangeability'
import type { RisuModule } from 'src/ts/process/modules'
import type { RisuPersona } from 'src/ts/storage/database.svelte'
import { ASSET_FOLDER_KEY, ASSET_RETAINED_KEY } from 'src/ts/studio/assets/assetOwnerKeys'

const v1Document = {
    v: 1,
    additional: { order: ['Faces'], of: [['webp one', 'Faces'], ['Smile', 'Faces']] },
}

const retained = [['old.png', 'assets/old.png']]

function moduleWithFields(): RisuModule {
    return {
        name: 'Synthetic Module',
        description: 'notes',
        id: 'm1',
        [ASSET_FOLDER_KEY]: v1Document,
        [ASSET_RETAINED_KEY]: retained,
    }
}

function personaWithFields(): RisuPersona {
    return {
        name: 'Synthetic Persona',
        icon: '',
        personaPrompt: 'prompt',
        embeddedModule: moduleWithFields(),
    }
}

describe('convertModuleToPersona', () => {
    test('the embedded module has no retained field and keeps the folder document as a copy', () => {
        const source = moduleWithFields()
        const persona = convertModuleToPersona(source)
        expect(Object.hasOwn(persona.embeddedModule ?? {}, ASSET_RETAINED_KEY)).toBe(false)
        expect(persona.embeddedModule?.[ASSET_FOLDER_KEY]).toEqual(v1Document)
        expect(persona.embeddedModule?.[ASSET_FOLDER_KEY]).not.toBe(source[ASSET_FOLDER_KEY])
    })

    test('the source module is not changed', () => {
        const source = moduleWithFields()
        convertModuleToPersona(source)
        expect(source[ASSET_RETAINED_KEY]).toBe(retained)
        expect(source[ASSET_FOLDER_KEY]).toBe(v1Document)
    })
})

describe('convertPersonaToModule', () => {
    test('the new module has no retained field and keeps the folder document as a copy', () => {
        const source = personaWithFields()
        const result = convertPersonaToModule(source)
        expect(Object.hasOwn(result, ASSET_RETAINED_KEY)).toBe(false)
        expect(result[ASSET_FOLDER_KEY]).toEqual(v1Document)
        expect(result[ASSET_FOLDER_KEY]).not.toBe(source.embeddedModule?.[ASSET_FOLDER_KEY])
    })

    test('the source persona and its embedded module are not changed', () => {
        const source = personaWithFields()
        convertPersonaToModule(source)
        expect(source.embeddedModule?.[ASSET_RETAINED_KEY]).toBe(retained)
        expect(source.embeddedModule?.name).toBe('Synthetic Module')
    })

    test('a persona without an embedded module converts to a module with no retained field', () => {
        const result = convertPersonaToModule({ name: 'Bare', icon: '', personaPrompt: 'p' })
        expect(Object.hasOwn(result, ASSET_RETAINED_KEY)).toBe(false)
    })
})
