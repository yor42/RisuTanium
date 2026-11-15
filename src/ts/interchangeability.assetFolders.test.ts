/**
 * The module/character converters carry the asset folder document verbatim and never carry the retained field.
 *
 * Regression reproducers fail on a converter without the carry rule (the assertion fails, not the setup).
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

import {
    convertCharacterToModule,
    convertCharacterToPersona,
    convertModuleToCharacter,
    convertModuleToPersona,
    convertPersonaToCharacter,
    convertPersonaToModule,
} from 'src/ts/interchangeability'
import type { RisuModule } from 'src/ts/process/modules'
import { ASSET_FOLDER_KEY, ASSET_RETAINED_KEY } from 'src/ts/studio/assets/assetOwnerKeys'

const v1Document = {
    v: 1,
    additional: { order: ['Faces'], of: [['webp one', 'Faces'], ['Smile', 'Faces']] },
}

// An unknown version and a bad shape: neither is normalised or dropped.
const unknownVersionDocument = { v: 9, mystery: [1, 2, { deep: true }], folders: 'not a list' }

function moduleWith(doc: unknown): RisuModule {
    return { name: 'Synthetic Module', description: 'notes', id: 'm1', [ASSET_FOLDER_KEY]: doc }
}

describe('convertModuleToCharacter and convertCharacterToModule carry the folder document', () => {
    test('regression reproducer: a v1 document survives module to character to module as a deep copy', () => {
        const source = moduleWith(v1Document)
        const char = convertModuleToCharacter(source)
        expect(char.extentions?.[ASSET_FOLDER_KEY]).toEqual(v1Document)
        expect(char.extentions?.[ASSET_FOLDER_KEY]).not.toBe(source[ASSET_FOLDER_KEY])
        const back = convertCharacterToModule(char)
        expect(back[ASSET_FOLDER_KEY]).toEqual(v1Document)
        expect(back[ASSET_FOLDER_KEY]).not.toBe(char.extentions?.[ASSET_FOLDER_KEY])
    })

    test('regression reproducer: an unknown-version document is copied verbatim, not normalised or dropped', () => {
        const back = convertCharacterToModule(convertModuleToCharacter(moduleWith(unknownVersionDocument)))
        expect(back[ASSET_FOLDER_KEY]).toEqual(unknownVersionDocument)
    })

    test('regression reproducer: a module whose document is a proxy (a live Svelte state object) converts both ways', () => {
        // structuredClone throws a DataCloneError on any Proxy, as it does on a $state proxy.
        const live = new Proxy(structuredClone(v1Document), {})
        expect(() => structuredClone(live)).toThrow()
        const char = convertModuleToCharacter(moduleWith(live))
        expect(char.extentions?.[ASSET_FOLDER_KEY]).toEqual(v1Document)
        const liveChar = { ...char, extentions: { [ASSET_FOLDER_KEY]: new Proxy(structuredClone(v1Document), {}) } } as typeof char
        expect(convertCharacterToModule(liveChar)[ASSET_FOLDER_KEY]).toEqual(v1Document)
    })

    test('feature guard: a non-object value, including a falsy one, is copied as it is', () => {
        for (const value of ['garbage', 0]) {
            const back = convertCharacterToModule(convertModuleToCharacter(moduleWith(value)))
            expect(back[ASSET_FOLDER_KEY]).toBe(value)
        }
    })

    test('compatibility guard: a module without the field adds no extension key and no field comes back', () => {
        const char = convertModuleToCharacter({ name: 'Synthetic Module', description: '', id: 'm2' })
        expect(char.extentions === undefined || !(ASSET_FOLDER_KEY in char.extentions)).toBe(true)
        const back = convertCharacterToModule(char)
        expect('assetFolders' in back).toBe(false)
        expect(ASSET_FOLDER_KEY in back).toBe(false)
    })

    test('regression reproducer: with a document present the unprefixed name is never written and the prefixed key holds the value', () => {
        const withDoc = convertCharacterToModule(convertModuleToCharacter(moduleWith(v1Document)))
        expect('assetFolders' in withDoc).toBe(false)
        expect(withDoc[ASSET_FOLDER_KEY]).toEqual(v1Document)
    })

    test('the retained field never travels through either converter', () => {
        const source = { ...moduleWith(v1Document), [ASSET_RETAINED_KEY]: { 'old.png': ['a', 'b'] } } as RisuModule
        const char = convertModuleToCharacter(source)
        expect(JSON.stringify(char)).not.toContain(ASSET_RETAINED_KEY)
        const charWithField = { ...char, [ASSET_RETAINED_KEY]: { x: 1 } } as typeof char
        expect(ASSET_RETAINED_KEY in convertCharacterToModule(charWithField)).toBe(false)
    })

    test('the carry adds no other field to the converted character or module', () => {
        const withDoc = convertModuleToCharacter(moduleWith(v1Document))
        const without = convertModuleToCharacter({ name: 'Synthetic Module', description: 'notes', id: 'm1' })
        const strip = (c: typeof withDoc) => ({ ...c, extentions: undefined })
        expect(strip(withDoc)).toEqual(strip(without))
        const modWith = convertCharacterToModule(withDoc)
        const modWithout = convertCharacterToModule(without)
        expect({ ...modWith, [ASSET_FOLDER_KEY]: undefined }).toEqual({ ...modWithout, [ASSET_FOLDER_KEY]: undefined })
    })
})

describe('the persona converters carry the folder document in the same field', () => {
    test('persona to character and character to persona keep the document', () => {
        const persona = convertCharacterToPersona(convertModuleToCharacter(moduleWith(v1Document)))
        expect(persona.embeddedModule?.[ASSET_FOLDER_KEY]).toEqual(v1Document)
        const char = convertPersonaToCharacter(persona)
        expect(char.extentions?.[ASSET_FOLDER_KEY]).toEqual(v1Document)
    })

    test('module to persona and persona to module keep the document', () => {
        const persona = convertModuleToPersona(moduleWith(v1Document))
        expect(persona.embeddedModule?.[ASSET_FOLDER_KEY]).toEqual(v1Document)
        expect(convertPersonaToModule(persona)[ASSET_FOLDER_KEY]).toEqual(v1Document)
    })
})
