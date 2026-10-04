// @vitest-environment happy-dom

/**
 * A module's `AssetList` never becomes a character's own array: converting a
 * module to a character hands over a plain copy, so editing the character's
 * assets afterwards is an ordinary tracked edit and never reaches the module.
 *
 * Titles beginning "guard:" pin behaviour that must be preserved.
 */
import { describe, test, expect, vi } from 'vitest'

vi.mock(import('src/ts/characters'), () => ({
    createBlankChar: vi.fn(() => ({ name: '', chats: [], additionalAssets: [] })),
}) as unknown as typeof import('src/ts/characters'))

import 'src/ts/polyfill'
import { convertModuleToCharacter } from 'src/ts/interchangeability'
import { AssetList, toAssetList, type AssetTuple } from 'src/ts/storage/assetList'
import type { RisuModule } from 'src/ts/process/modules'

function installedModule(): RisuModule {
    const tuples: AssetTuple[] = [['a', 'path-a', 'png'], ['b', 'path-b', 'png']]
    return { name: 'M', description: '', id: 'id-m', assets: toAssetList(tuples) }
}

describe('convertModuleToCharacter with an installed AssetList', () => {
    test('guard: the character holds a plain array, not the module\'s AssetList', () => {
        const mod = installedModule()
        expect(mod.assets instanceof AssetList).toBe(true)

        const char = convertModuleToCharacter(mod)

        expect(Object.getPrototypeOf(char.additionalAssets)).toBe(Array.prototype)
        expect(char.additionalAssets).not.toBe(mod.assets)
    })

    test('guard: editing the character\'s assets leaves the module\'s untouched, and the other way round', () => {
        const mod = installedModule()
        const char = convertModuleToCharacter(mod)

        char.additionalAssets[0][0] = 'renamed-in-character'
        mod.assets![1][0] = 'renamed-in-module'

        expect(mod.assets![0][0]).toBe('a')
        expect(char.additionalAssets[1][0]).toBe('b')
    })
})
