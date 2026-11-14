// Regenerates the fixtures of this directory from the code at commit 1cfa819ee, the last build that knew nothing of the
// retained-paths field. The tests that read them (assetRetained.legacy1cfa.test.ts and the module import tests) compare
// the current build against what that build produced.
//
// Usage, from any directory:
//   node generate.mjs <root of a clean export of 1cfa819ee, with node_modules linked in> <output directory>
//
// The script writes two temporary vitest files into the export (so the real encoder and the real `.risum` writer run
// under the repository's own aliases and mocks), runs them, removes them, and leaves only the fixtures in the output
// directory. All data is synthetic. Nothing here reads a profile.
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [rootArg, outArg] = process.argv.slice(2)
if (!rootArg || !outArg) {
    console.error('usage: node generate.mjs <1cfa819ee export root> <output directory>')
    process.exit(2)
}
const root = resolve(rootArg)
const out = resolve(outArg)
mkdirSync(out, { recursive: true })

// The shared synthetic owners, as JSON text spliced into both temporary tests.
const OWNERS = `
const hex = (digit: string) => digit.repeat(64)
const character = {
    chaId: 'laned-char-1', type: 'character', name: 'Profile character',
    image: 'assets/' + hex('a') + '.png',
    emotionImages: [['happy', 'assets/' + hex('b') + '.webp'], ['sad', 'assets/Sad_Face.PNG']],
    additionalAssets: [['Smile', 'assets/' + hex('c') + '.png', 'png'], ['Voice', 'assets/VoiceFile.WAV', 'wav']],
    vits: { files: { a: 'assets/vits-one.onnx' } },
    gptSoVitsConfig: { ref_audio_data: { fileName: 'ref.wav', assetId: 'assets/' + hex('d') + '.wav' } },
    ccAssets: [{ type: 'icon', uri: 'assets/' + hex('e') + '.png', name: 'main', ext: 'png' }],
}
const profileModule = {
    id: 'laned-module-1', name: 'Profile module', description: 'synthetic',
    lorebook: [{ key: 'k', comment: 'c', content: 'text', mode: 'normal', insertorder: 1, alwaysActive: false, secondkey: '', selective: false }],
    assets: [['Face', 'assets/' + hex('1') + '.png', 'png'], ['Theme', 'assets/theme_song.mp3', 'mp3']],
    icon: 'assets/' + hex('2') + '.png',
}
const config = {
    customBackground: 'assets/' + hex('3') + '.png', userIcon: 'assets/' + hex('4') + '.png',
    NAIImgConfig: { image: 'assets/nai-image.png', character_image: 'assets/' + hex('5') + '.png' },
    wavespeedImage: { reference_image: 'assets/wave-ref.png' },
    personas: [
        { name: 'P1', icon: 'assets/' + hex('6') + '.png', embeddedModule: { id: 'laned-embedded-1', name: 'Embedded', description: '', assets: [['Pic', 'assets/' + hex('7') + '.png', 'png']], icon: 'assets/embedded-icon.png' } },
        { name: 'P2', icon: 'assets/persona-two.png' },
    ],
    loadouts: [{ icons: ['assets/' + hex('8') + '.png', 'assets/loadout-icon.png'] }],
    characterOrder: ['laned-char-1', { imgFile: 'assets/' + hex('9') + '.png' }],
}
const legacyFiles = [
    {
        key: 'database/database.bin', status: 'ok',
        database: { ...config, characters: [character], modules: [profileModule] },
        coldCharacters: [{ chaId: 'laned-cold-1', type: 'character', image: 'assets/cold-image.png', additionalAssets: [['Cold', 'assets/' + hex('f') + '.png', 'png']] }],
    },
    { key: 'coldstorage/unreadable', status: 'unreadable' },
]
`

const LISTS_TEST = `// @vitest-environment node
import { test } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
    deriveCharacterAssets, deriveConfigAssets, deriveModuleAssets, deriveLegacyList,
} from 'src/ts/storage/store2/lists'
import { createListDerivation } from 'src/ts/storage/store2/lists'
import { canonicalJson, encodeUnit, newUnitKey, refOfFrame, UNIT_TYPE } from 'src/ts/storage/store2/format'
import { encodeDatabase, previousFrom, isWrittenUnit } from 'src/ts/storage/store2/codec'
import { buildSmall, seededEnv } from 'src/ts/storage/tests/store2/codecFixtures'

${OWNERS}

const OUT = process.env.LANED_OUT as string
const write = (name: string, value: unknown) => writeFileSync(join(OUT, name), JSON.stringify(value, null, 2) + '\\n')

test('write the list fixtures', () => {
    write('character.json', character)
    write('module.json', profileModule)
    write('config.json', config)
    write('legacy.json', { files: legacyFiles })
    write('expected-lists.json', {
        character: deriveCharacterAssets(character),
        module: deriveModuleAssets(profileModule),
        config: deriveConfigAssets(config, config.characterOrder),
        legacy: deriveLegacyList(legacyFiles as never),
    })
})

test('write the converted tree', () => {
    const NOW = 1_700_000_000_000
    const db = buildSmall(3) as unknown as Record<string, unknown> & { characters: Record<string, unknown>[] }
    Object.assign(db.characters[0], character, { chaId: db.characters[0].chaId })
    db.modules = [profileModule]
    const lists = createListDerivation()
    const first = encodeDatabase(db as never, { env: seededEnv(1), lists, seq: 1, createdAt: NOW })

    // The keep list of a converted tree: one legacy list unit, named by the manifest of the later commit.
    const keepKey = newUnitKey(seededEnv(31))
    const keepBytes = encodeUnit(UNIT_TYPE.legacyList, {
        v: 1, iv: 1, files: [{ key: 'coldstorage/a', status: 'ok' }], h: '', l: ['legacy-kept.png'], i: { v: 1, u: [], h: '', o: [] },
    })
    const keep = { unit: refOfFrame(keepKey, keepBytes), v: 1, files: [{ key: 'coldstorage/a', status: 'ok' as const }] }
    const previous = previousFrom(first)
    const manifest = structuredClone(first.manifest)
    manifest.fixed.legacyKeep = keep
    // A later commit that changes only the config, so every character unit is reused as it was.
    const next = { ...db, statics: { messages: 777 } }
    const second = encodeDatabase(next as never, {
        env: seededEnv(2), lists, seq: 2, createdAt: NOW,
        previous: { ...previous, objects: { ...previous.objects, manifest } },
    })

    const units = new Map<string, { key: string, type: number, base64: string }>()
    const keep1 = (tree: typeof first) => {
        for (const unit of tree.units) {
            if (isWrittenUnit(unit)) {
                units.set(unit.key, { key: unit.key, type: unit.type, base64: Buffer.from(unit.bytes).toString('base64') })
            }
        }
    }
    keep1(first)
    keep1(second)
    units.set(keepKey, { key: keepKey, type: UNIT_TYPE.legacyList, base64: Buffer.from(keepBytes).toString('base64') })
    const manifestKeyOf = (tree: typeof first) => tree.units[tree.units.length - 1].key
    write('closure-tree.json', {
        units: [...units.values()],
        currentManifest: manifestKeyOf(second),
        retainedManifest: manifestKeyOf(first),
        characterCount: 3,
        legacyKeptName: 'legacy-kept.png',
        manifestJson: canonicalJson(second.manifest),
    })
})
`

const RISUM_TEST = `// @vitest-environment node
import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('uuid', () => ({ v4: () => 'uuid' }))
vi.mock(import('src/ts/platform'), () => ({ isTauri: false, isNodeServer: false }) as never)
vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(), alertConfirm: vi.fn(async () => false), alertError: vi.fn(), alertModuleSelect: vi.fn(),
    alertNormal: vi.fn(), alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() }, alertWait: vi.fn(),
}) as never)
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(), getCurrentChat: vi.fn(), getDatabase: vi.fn(() => ({ modules: [] })),
    setCurrentCharacter: vi.fn(), setDatabase: vi.fn(),
}) as never)
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    AppendableBuffer: class {
        parts: Uint8Array[] = []
        append(b: Uint8Array) { this.parts.push(b) }
        get buffer() { return Buffer.concat(this.parts) }
    },
    AssetSourceChangedError: class AssetSourceChangedError extends Error {},
    saveAssetFromPieces: vi.fn(async () => 'piece.png'), LocalWriter: class {}, VirtualWriter: class {},
    downloadFile: vi.fn(), forageStorage: {}, readImage: vi.fn(async () => undefined), saveAsset: vi.fn(async () => 'saved.png'),
}) as never)
vi.mock(import('src/ts/util'), () => ({
    checkPersonaBinded: vi.fn(), selectFileByDom: vi.fn(async () => []), sleep: vi.fn(async () => undefined),
}) as never)
vi.mock(import('src/ts/process/lorebook.svelte'), () => ({ convertExternalLorebook: vi.fn() }) as never)
vi.mock(import('src/ts/media'), () => ({ compressImage: vi.fn(async (d: Uint8Array) => d) }) as never)
vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: { modules: [] } }, HideIconStore: { set: vi.fn() }, moduleBackgroundEmbedding: { set: vi.fn() },
    ReloadGUIPointer: { set: vi.fn() },
}) as never)
vi.mock(import('src/ts/interchangeability'), () => ({
    convertCharacterToModule: vi.fn(), convertModuleToCharacter: vi.fn(),
}) as never)
vi.mock(import('src/ts/characterCards'), () => ({
    exportCharacterCard: vi.fn(), importCharacterFile: vi.fn(async () => ({ kind: 'declined' })),
}) as never)
// The real RPack permutation, read from the map file the app ships, so the container bytes are the real ones.
vi.mock(import('src/ts/rpack/rpack_js'), async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const map = new Uint8Array(readFileSync(join(process.cwd(), 'src/ts/rpack/rpack_map.bin')))
    const apply = (table: Uint8Array, data: Uint8Array) => Uint8Array.from(data, (byte) => table[byte])
    return {
        encodeRPack: vi.fn(async (data: Uint8Array) => apply(map.subarray(0, 256), data)),
        decodeRPack: vi.fn(async (data: Uint8Array) => apply(map.subarray(256, 512), data)),
    } as never
})

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { exportModuleLegacy } from 'src/ts/process/modules'

${OWNERS}

test('write the .risum bytes of a module that holds the retained field', async () => {
    const withField = {
        id: 'laned-risum-1', name: 'Risum module', description: 'synthetic', lorebook: [], assets: [],
        icon: '', risutanium_asset_retained: [['gone', 'assets/' + hex('a') + '.png']],
    }
    const buffer = await exportModuleLegacy(withField as never, { alertEnd: false, saveData: false })
    expect(buffer).not.toBeNull()
    writeFileSync(join(process.env.LANED_OUT as string, 'risum-main-block.json'), JSON.stringify({
        module: withField,
        risumBase64: Buffer.from(buffer as Uint8Array).toString('base64'),
    }, null, 2) + '\\n')
})
`

const tempLists = join(root, 'src/ts/storage/tests/store2/laneDGenerateLists.tmp.test.ts')
const tempRisum = join(root, 'src/ts/process/laneDGenerateRisum.tmp.test.ts')
writeFileSync(tempLists, LISTS_TEST)
writeFileSync(tempRisum, RISUM_TEST)
let status = 1
try {
    const run = spawnSync(
        process.execPath,
        [join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--maxWorkers=2', tempLists, tempRisum],
        { cwd: root, env: { ...process.env, LANED_OUT: out }, stdio: 'inherit' },
    )
    status = run.status ?? 1
} finally {
    for (const file of [tempLists, tempRisum]) {
        if (existsSync(file)) {
            rmSync(file)
        }
    }
}
process.exit(status)
