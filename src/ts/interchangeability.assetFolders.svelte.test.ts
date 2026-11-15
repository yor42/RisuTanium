/**
 * The module/character converters on live Svelte state: an asset folder document held in a `$state` object is a Proxy,
 * which `structuredClone` cannot copy.
 *
 * The regression reproducer fails on a converter that clones with the bare `structuredClone` (a DataCloneError).
 */
import { describe, expect, test, vi } from 'vitest'
import { safeStructuredClone as realSafeStructuredClone } from 'src/ts/polyfill'

// The setup file stubs the global with a JSON copy, which never throws on a Proxy; the converters must be proven
// against the real helper.
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

import { convertCharacterToModule, convertModuleToCharacter } from 'src/ts/interchangeability'
import type { RisuModule } from 'src/ts/process/modules'
import { ASSET_FOLDER_KEY } from 'src/ts/studio/assets/assetOwnerKeys'

const document = { v: 1, additional: { order: ['Faces'], of: [['smile', 'Faces']] } }

describe('the converters clone a document held in live Svelte state', () => {
    test('regression reproducer: a $state module and a $state character convert both ways without throwing', () => {
        const module: RisuModule = $state({
            name: 'Synthetic Module',
            description: 'notes',
            id: 'm1',
            [ASSET_FOLDER_KEY]: structuredClone(document),
        })
        // The reproducer is only meaningful when the bare clone really refuses this state object.
        expect(() => structuredClone(module[ASSET_FOLDER_KEY])).toThrow()

        const char = $state(convertModuleToCharacter(module))
        expect(char.extentions?.[ASSET_FOLDER_KEY]).toEqual(document)

        const back = convertCharacterToModule(char)
        expect(back[ASSET_FOLDER_KEY]).toEqual(document)
    })
})
