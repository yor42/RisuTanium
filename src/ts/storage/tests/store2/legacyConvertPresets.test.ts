/**
 * The conversion of an older-format (msgpack) save whose `botPresets` is missing, null or not a list, through the real
 * default decoders and bytes written by the older writer (`encodeRisuSaveLegacy`). A missing or null list becomes the
 * Default preset; a present non-list fails the strict read (so a good backup or "convert without these" follows) and is
 * named as skipped presets on the lenient path before it is replaced by the Default preset.
 *
 * Platform boundaries mocked as in `legacyLenient.test.ts`. Fixture strings stay under 64 characters: for longer
 * strings msgpackr's encoder passes a length past the buffer's end to `Buffer.prototype.utf8Write`, which the Node
 * running the tests rejects (the browser build is unaffected).
 */
import { describe, expect, test, vi } from 'vitest'
import type { ForageLike } from 'src/ts/storage/tests/forageBackedStore'

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) }) },
}))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) },
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { appStoreModuleOver } = await import('src/ts/storage/tests/appStoreMock')
    const { forageStorage } = await import('src/ts/globalApi.svelte')
    return appStoreModuleOver(() => forageStorage as unknown as ForageLike) as unknown as typeof import('src/ts/storage/store/appStore')
})
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/platform'), () => ({ isTauri: false, isNodeServer: true }))
vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 },
}))

import { createMemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import type { Database } from 'src/ts/storage/database.svelte'
import { decodeRisuSave, encodeRisuSaveLegacy } from 'src/ts/storage/risuSave'
import { createMemoryBackend, type MemoryBackend } from 'src/ts/storage/store2/backend'
import { assembleDatabase } from 'src/ts/storage/store2/codec'
import { classifyCommitRead } from 'src/ts/storage/store2/commitKey'
import { firstLifeGrant } from 'src/ts/storage/store2/firstLife'
import { keyOfRef, readUnit, UNIT_TYPE, type LegacyList } from 'src/ts/storage/store2/format'
import {
    convertLegacyProfile, convertLegacyWithout, type ConvertRequest, type ConvertResult, type LegacyDecoders,
} from 'src/ts/storage/store2/legacy/convert'
import type { SkippedLegacyEntry } from 'src/ts/storage/store2/legacy/lenient'
import { freshOwnerId } from 'src/ts/storage/store2/owner'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import { createClock, testEnv } from '../store2SaveKit'
import { buildSmall, fakeLists } from './codecFixtures'

type Obj = Record<string, unknown>
type Compression = 'noCompression' | 'compression'
const ENCODINGS: Compression[] = ['noCompression', 'compression']
const MAIN = 'database/database.bin'

/** A small profile whose long strings are cut so the older writer can encode it. */
function profile(mutate: (tree: Obj) => void = () => {}): Obj {
    const tree = JSON.parse(JSON.stringify(buildSmall(1)), (_key, value) => typeof value === 'string' && value.length > 60 ? value.slice(0, 60) : value) as Obj
    mutate(tree)
    return tree
}

interface Rig {
    request: ConvertRequest
    memory: MemoryBackend
    files: Map<string, Uint8Array>
    before: Map<string, Uint8Array>
}

async function rig(main: Uint8Array, backups: Record<number, Uint8Array> = {}, decoders?: LegacyDecoders): Promise<Rig> {
    const store = createMemoryByteStore()
    store.files.set(MAIN, main)
    for (const [time, bytes] of Object.entries(backups)) {
        store.files.set(`database/dbbackup-${time}.bin`, bytes)
    }
    const memory = createMemoryBackend()
    const granted = firstLifeGrant({ decision: { row: 1, mode: 'first-life', action: 'convert' }, commitRead: await memory.readCommit(), startupClear: null })
    if (granted.status !== 'granted') {
        throw new Error('The first-life grant was not given.')
    }
    return {
        memory,
        files: store.files,
        before: new Map(store.files),
        request: {
            store,
            listBackupTimes: async () => Object.keys(backups).map(Number).sort((a, b) => b - a),
            readColdStorageItem: async () => ({ status: 'missing' }),
            backend: memory,
            entry: { kind: 'first-life', grant: granted.grant },
            owner: freshOwnerId(testEnv(createClock(), 1)),
            lists: fakeLists,
            env: testEnv(createClock(), 4242),
            decoders,
            resolve: { newId: () => 'placeholder-chat', now: () => 1 },
        },
    }
}

interface Asked {
    fromBackup: number[]
    skipped: (readonly SkippedLegacyEntry[])[]
}

function hooks(asked: Asked) {
    return {
        async confirmFromBackup(backup: number) { asked.fromBackup.push(backup); return true },
        async confirmIncomplete() { return true },
        async confirmSkipped(skipped: readonly SkippedLegacyEntry[]) { asked.skipped.push(skipped); return true },
    }
}

/** The boot sequence: the strict conversion, then "convert without these" when nothing decodes strictly. */
async function boot(test: Rig, asked: Asked): Promise<{ strict: ConvertResult, final: ConvertResult }> {
    const strict = await convertLegacyProfile(test.request, hooks(asked))
    if (strict.status !== 'all-failed') {
        return { strict, final: strict }
    }
    return { strict, final: await convertLegacyWithout(test.request, hooks(asked)) }
}

function freshAsked(): Asked {
    return { fromBackup: [], skipped: [] }
}

async function storedTree(memory: MemoryBackend) {
    const read = classifyCommitRead(await memory.readCommit())
    if (read.status !== 'parsed' || read.value.current === null) {
        throw new Error('No manifest is current.')
    }
    const tree = await readTreeBytes(memory, read.value.current.key)
    if (tree.status !== 'ok') {
        throw new Error(`The stored tree reads ${tree.status}.`)
    }
    return tree.tree
}

async function assembled(memory: MemoryBackend): Promise<Obj> {
    const stored = await storedTree(memory)
    return JSON.parse(JSON.stringify(assembleDatabase(stored.manifest, stored.source))) as Obj
}

async function legacyStatuses(memory: MemoryBackend): Promise<Record<string, string>> {
    const keep = (await storedTree(memory)).manifest.fixed.legacyKeep
    if (keep === null) {
        throw new Error('The manifest names no legacy list.')
    }
    const parsed = readUnit(memory.snapshot().get(keyOfRef(keep.unit)) as Uint8Array, UNIT_TYPE.legacyList)
    if (parsed.status !== 'ok') {
        throw new Error('The legacy list does not parse.')
    }
    return Object.fromEntries((parsed.value.body as LegacyList).files.map(file => [file.key, file.status]))
}

function withoutPresets(tree: Obj): Obj {
    const { botPresets: _presets, ...rest } = tree
    return rest
}

function presetNames(tree: Obj): unknown[] {
    return (tree.botPresets as Obj[]).map(preset => preset.name)
}

describe.each(ENCODINGS)('new behaviour: a missing or null botPresets becomes the Default preset (%s)', (encoding) => {
    test.each([
        ['missing', (tree: Obj) => { delete tree.botPresets }],
        ['null', (tree: Obj) => { tree.botPresets = null }],
    ] as const)('reproducer: a %s list converts strictly and installs one Default preset, the other parts unchanged', async (_name, mutate) => {
        const control = await rig(encodeRisuSaveLegacy(profile(), encoding))
        expect((await convertLegacyProfile(control.request, hooks(freshAsked()))).status).toBe('installed')
        const test = await rig(encodeRisuSaveLegacy(profile(mutate), encoding))
        const asked = freshAsked()

        const result = await convertLegacyProfile(test.request, hooks(asked))

        expect(result.status).toBe('installed')
        const stored = await assembled(test.memory)
        expect(presetNames(stored)).toEqual(['Default'])
        expect(withoutPresets(stored)).toEqual(withoutPresets(await assembled(control.memory)))
        expect(asked).toEqual({ fromBackup: [], skipped: [] })
        expect(await legacyStatuses(test.memory)).toEqual({ [MAIN]: 'ok' })
        expect(test.files).toEqual(test.before)
    })

    test('reproducer: a missing list converts the same way on the "convert without these" path, and nothing is named', async () => {
        const test = await rig(encodeRisuSaveLegacy(profile(tree => { delete tree.botPresets }), encoding))
        const asked = freshAsked()

        const result = await convertLegacyWithout(test.request, hooks(asked))

        expect(result.status).toBe('installed')
        expect(asked.skipped).toEqual([[]])
        expect(presetNames(await assembled(test.memory))).toEqual(['Default'])
    })

    test('reproducer: the default is applied to the resolved copy only, the decoded source tree keeps its missing list and the main file is listed ok', async () => {
        let source: Obj | null = null
        const decoders: LegacyDecoders = {
            strict: async (bytes) => {
                const tree = await decodeRisuSave(bytes, { strict: true }) as unknown as Obj
                source ??= tree
                return tree as unknown as Database
            },
            lenient: async () => { throw new Error('unused') },
        }
        const test = await rig(encodeRisuSaveLegacy(profile(tree => { delete tree.botPresets }), encoding), {}, decoders)

        await convertLegacyProfile(test.request, hooks(freshAsked()))

        expect(presetNames(await assembled(test.memory))).toEqual(['Default'])
        expect(source).not.toBeNull()
        expect('botPresets' in (source as unknown as Obj)).toBe(false)
        expect(await legacyStatuses(test.memory)).toEqual({ [MAIN]: 'ok' })
    })
})

describe.each(ENCODINGS)('new behaviour: a present non-list botPresets (%s)', (encoding) => {
    const objectPresets = (tree: Obj) => { tree.botPresets = { a: { name: 'a' } } }

    test('reproducer: the strict read fails, then "convert without these" names the presets and installs one Default preset', async () => {
        const control = await rig(encodeRisuSaveLegacy(profile(), encoding))
        await convertLegacyProfile(control.request, hooks(freshAsked()))
        const test = await rig(encodeRisuSaveLegacy(profile(objectPresets), encoding))
        const asked = freshAsked()

        const { strict, final } = await boot(test, asked)

        expect(strict).toEqual({ status: 'all-failed', backupsTried: [] })
        expect(asked.skipped.map(list => list.map(entry => entry.kind))).toEqual([['presets']])
        expect(final.status).toBe('installed')
        const stored = await assembled(test.memory)
        expect(presetNames(stored)).toEqual(['Default'])
        expect(withoutPresets(stored)).toEqual(withoutPresets(await assembled(control.memory)))
        expect(await legacyStatuses(test.memory)).toEqual({ [MAIN]: 'unreadable' })
        expect(test.files).toEqual(test.before)
    })

    test('reproducer: with a valid backup the backup is asked about and installed from', async () => {
        const test = await rig(encodeRisuSaveLegacy(profile(objectPresets), encoding), { 5: encodeRisuSaveLegacy(profile(), encoding) })
        const asked = freshAsked()

        const result = await convertLegacyProfile(test.request, hooks(asked))

        expect(asked.fromBackup).toEqual([5])
        expect(result).toMatchObject({ status: 'installed', fromBackup: 5 })
        expect(presetNames(await assembled(test.memory))).toContain('Preset 0')
    })

    test('reproducer: a backup holding an object is skipped for the next good backup', async () => {
        const test = await rig(encodeRisuSaveLegacy(profile(objectPresets), encoding), {
            9: encodeRisuSaveLegacy(profile(objectPresets), encoding),
            5: encodeRisuSaveLegacy(profile(), encoding),
        })
        const asked = freshAsked()

        const result = await convertLegacyProfile(test.request, hooks(asked))

        expect(asked.fromBackup).toEqual([5])
        expect(result).toMatchObject({ status: 'installed', fromBackup: 5 })
    })

    test('guard (passes before and after): a valid main installs from the main file and lists a backup holding an object ok', async () => {
        const test = await rig(encodeRisuSaveLegacy(profile(), encoding), { 5: encodeRisuSaveLegacy(profile(objectPresets), encoding) })
        const asked = freshAsked()

        const result = await convertLegacyProfile(test.request, hooks(asked))

        expect(result).toMatchObject({ status: 'installed', fromBackup: null })
        expect(asked.fromBackup).toEqual([])
        expect(await legacyStatuses(test.memory)).toEqual({ [MAIN]: 'ok', 'database/dbbackup-5.bin': 'ok' })
    })
})

describe.each(ENCODINGS)('guard: what stays as it was (%s)', (encoding) => {
    test('guard (passes before and after): a map without a characters list and a bare string through the strict conversion do not install', async () => {
        for (const bytes of [
            encodeRisuSaveLegacy({ x: 1, botPresets: { a: 1 } }, encoding),
            encodeRisuSaveLegacy({ x: 1 }, encoding),
            encodeRisuSaveLegacy('a bare string', encoding),
        ]) {
            const test = await rig(bytes)

            let outcome: string
            try {
                outcome = (await convertLegacyProfile(test.request, hooks(freshAsked()))).status
            } catch {
                outcome = 'threw'
            }

            expect(outcome).not.toBe('installed')
            expect(test.memory.snapshot().size).toBe(0)
        }
    })

    test('guard (passes before and after): a valid list and an empty list are kept', async () => {
        const valid = await rig(encodeRisuSaveLegacy(profile(), encoding))
        const empty = await rig(encodeRisuSaveLegacy(profile(tree => { tree.botPresets = []; tree.botPresetsId = 3 }), encoding))

        expect((await convertLegacyProfile(valid.request, hooks(freshAsked()))).status).toBe('installed')
        expect((await convertLegacyProfile(empty.request, hooks(freshAsked()))).status).toBe('installed')

        const kept = presetNames(await assembled(valid.memory))
        expect(kept.length).toBeGreaterThan(1)
        expect(kept).toContain('Preset 0')
        expect(kept).not.toContain('Default')
        const stored = await assembled(empty.memory)
        expect(stored.botPresets).toEqual([])
        expect(stored.botPresetsId).toBe(3)
    })

    test('reproducer: botPresetsId is left as it was when the Default preset is applied', async () => {
        const test = await rig(encodeRisuSaveLegacy(profile(tree => { delete tree.botPresets; tree.botPresetsId = 3 }), encoding))

        await convertLegacyProfile(test.request, hooks(freshAsked()))

        expect((await assembled(test.memory)).botPresetsId).toBe(3)
    })
})
