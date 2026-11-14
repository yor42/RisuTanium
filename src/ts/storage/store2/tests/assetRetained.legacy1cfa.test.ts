// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import type { JsonObject } from '../../blockFrame'
import { createMemoryBackend } from '../../store2/backend'
import { encodeDatabase, isWrittenUnit } from '../../store2/codec'
import { createListDerivation, deriveCharacterAssets, deriveConfigAssets, deriveLegacyList, deriveModuleAssets } from '../../store2/lists'
import { createBackendClosureReader } from '../../store2/sweep/backendReader'
import { buildClosureAssetKeepSet } from '../../store2/sweep'
import { buildSmall, seededEnv } from '../../tests/store2/codecFixtures'
import { commitKeyOf } from '../../tests/store2/sweepFixtures'
import { ASSET_RETAINED_KEY } from '../../../studio/assets/assetOwnerKeys'

/**
 * Compatibility guards over data written by the build at commit 1cfa819ee, the last build that knew nothing of the
 * retained-paths field (the generator is `generate.mjs` beside the fixtures; the data is synthetic):
 * - the lists that build derived for a profile-shaped character, module, config and legacy file are byte-equal to what
 *   this build derives for the same owners, because the new field is absent from all of them (the list version stays 1);
 * - the tree that build's encoder wrote, with a legacy keep list, an untouched character and a retained manifest, reads
 *   as a complete keep-set in this build, and once this build saves a character that holds the field, the keep-set
 *   holds the retained path.
 */

const DIR = fileURLToPath(new URL('../../tests/store2/fixtures/laneD-1cfa819ee/', import.meta.url))
const fixture = <T>(name: string): T => JSON.parse(readFileSync(DIR + name, 'utf8')) as T

interface ListFixture { h: string, l: string[], v: number }
interface Expected {
    character: ListFixture
    module: ListFixture
    config: ListFixture
    legacy: { v: number, iv: number, files: { key: string, status: string }[], h: string, l: string[], i: unknown }
}
interface TreeFixture {
    units: { key: string, type: number, base64: string }[]
    currentManifest: string
    retainedManifest: string
    legacyKeptName: string
}
type Owner = JsonObject

const character = fixture<Owner>('character.json')
const profileModule = fixture<Owner>('module.json')
const config = fixture<Owner & { characterOrder: unknown }>('config.json')
const legacy = fixture<{ files: Parameters<typeof deriveLegacyList>[0] }>('legacy.json')
const expected = fixture<Expected>('expected-lists.json')

const HASH_IMAGE = `assets/${'a'.repeat(64)}.png`

describe('guard: lists derived at 1cfa819ee equal this build\'s derivation for owners without the field', () => {
    test('the character list', () => {
        expect(JSON.stringify(deriveCharacterAssets(character))).toBe(JSON.stringify(expected.character))
    })

    test('the module list', () => {
        expect(JSON.stringify(deriveModuleAssets(profileModule))).toBe(JSON.stringify(expected.module))
    })

    test('the config list, which reads a persona embedded module', () => {
        expect(JSON.stringify(deriveConfigAssets(config, config.characterOrder))).toBe(JSON.stringify(expected.config))
    })

    test('the legacy list, which reads characters, modules, embedded modules and a cold character', () => {
        expect(JSON.stringify(deriveLegacyList(legacy.files))).toBe(JSON.stringify(expected.legacy))
    })

    test('the real derivation handed to the codec derives the same character and module lists', () => {
        const lists = createListDerivation()
        expect(JSON.stringify(lists.characterAssets(character))).toBe(JSON.stringify(expected.character))
        expect(JSON.stringify(lists.moduleAssets(profileModule))).toBe(JSON.stringify(expected.module))
    })

    test('the fixtures name files, so an equal result is not an equal emptiness', () => {
        expect(expected.character.l.length + expected.module.l.length + expected.config.l.length + expected.legacy.l.length).toBeGreaterThan(8)
        expect(expected.character.h.length).toBeGreaterThan(0)
    })
})

describe('guard: the tree 1cfa819ee wrote is a complete keep-set here, and keeps what this build then saves', () => {
    const tree = fixture<TreeFixture>('closure-tree.json')

    function backendOf() {
        const backend = createMemoryBackend()
        for (const unit of tree.units) {
            backend.poke(unit.key, Uint8Array.from(Buffer.from(unit.base64, 'base64')))
        }
        return backend
    }

    const fixtureKey = () => commitKeyOf({ current: tree.currentManifest, retained: [{ key: tree.retainedManifest, at: 0 }] })

    test('the converted tree with its legacy keep list, untouched characters and retained manifest is complete', async () => {
        const result = await buildClosureAssetKeepSet({ commitKey: fixtureKey(), reader: createBackendClosureReader(backendOf()) })

        expect(result.status).toBe('complete')
        if (result.status !== 'complete') {
            return
        }
        expect(result.keep.holds(HASH_IMAGE)).toBe(true)
        expect(result.keep.holds(tree.legacyKeptName)).toBe(true)
        expect(result.keep.holds('assets/K.png')).toBe(false)
    })

    test('after this build saves a character that holds the field, the keep-set holds the retained path', async () => {
        const backend = backendOf()
        const db = buildSmall(3) as unknown as { characters: Owner[], modules: Owner[] }
        Object.assign(db.characters[0], character, { chaId: db.characters[0].chaId, [ASSET_RETAINED_KEY]: [['x', 'assets/K.png']] })
        db.modules = [profileModule]
        const saved = encodeDatabase(db as never, { env: seededEnv(5), lists: createListDerivation(), seq: 3, createdAt: 1_700_000_000_000 })
        for (const unit of saved.units) {
            if (isWrittenUnit(unit)) {
                backend.poke(unit.key, unit.bytes)
            }
        }
        const manifestKey = saved.units[saved.units.length - 1].key

        const result = await buildClosureAssetKeepSet({
            commitKey: commitKeyOf({ current: manifestKey, retained: [{ key: tree.currentManifest, at: 0 }] }),
            reader: createBackendClosureReader(backend),
        })

        expect(result.status).toBe('complete')
        if (result.status !== 'complete') {
            return
        }
        expect(result.keep.holds('assets/K.png')).toBe(true)
        expect(result.keep.holds(tree.legacyKeptName)).toBe(true)
    })
})
