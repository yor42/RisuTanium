/**
 * The conversion of an older-format save that holds a shape the store2 codec refuses (a part that must be a list and is
 * not, an element that must be an object and is not, a missing characters list), through the real default decoders and
 * bytes written by the older writer (`encodeRisuSaveLegacy`) or composed block by block. The strict read counts such a
 * copy as not decoded, main file and backup alike, so a good backup or "convert without these" follows. The lenient
 * path names each kind once and installs a copy without those parts (the tree handed to the install is captured by a
 * wrapper of `planWholeTreeInstall`). A refusal the detector cannot see (a BigInt inside a message) is caught where the
 * install is planned, before any marker, and moves on to the next copy.
 *
 * Platform boundaries mocked as in `legacyConvertPresets.test.ts`. Fixture strings stay under 64 characters (msgpackr).
 * A cyclic value inside an element is not exercised: the legacy list's string walk has no visited set and spins for
 * seconds before the codec could refuse it.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
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
const { planned } = vi.hoisted(() => ({ planned: [] as unknown[] }))
vi.mock('src/ts/storage/store2/legacy/install', async (importOriginal) => {
    const original = await importOriginal<typeof import('src/ts/storage/store2/legacy/install')>()
    return {
        ...original,
        planWholeTreeInstall: (...args: Parameters<typeof original.planWholeTreeInstall>) => {
            planned.push(args[0])
            return original.planWholeTreeInstall(...args)
        },
    }
})
vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 },
}))

import { coldStorageHeader, formatColdStorageLoadError } from 'src/ts/process/coldstorageData'
import { createMemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import type { Database } from 'src/ts/storage/database.svelte'
import {
    decodeRisuSave, encodeRisuSaveCompressionStream, encodeRisuSaveLegacy, isBlockFormatSave, RisuSaveEncoder, type SalvageOmittedKind,
} from 'src/ts/storage/risuSave'
import { createMemoryBackend, type MemoryBackend } from 'src/ts/storage/store2/backend'
import { classifyCommitRead } from 'src/ts/storage/store2/commitKey'
import { firstLifeGrant } from 'src/ts/storage/store2/firstLife'
import { keyOfRef, readUnit, UNIT_TYPE, type LegacyList } from 'src/ts/storage/store2/format'
import {
    convertLegacyProfile, convertLegacyWithout, hasBlockMagic, type ConvertRequest, type ConvertResult, type LegacyDecoders,
} from 'src/ts/storage/store2/legacy/convert'
import { findLegacyFaults } from 'src/ts/storage/store2/legacy/faults'
import { decodeLegacyLenient, type SkippedLegacyEntry } from 'src/ts/storage/store2/legacy/lenient'
import { freshOwnerId } from 'src/ts/storage/store2/owner'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import { BLOCK, composeSave } from '../manualCleanupHarness'
import { createClock, testEnv } from '../store2SaveKit'
import { buildSmall, fakeLists } from './codecFixtures'
import type { IncompleteItem } from 'src/ts/storage/store2/legacy/resolve'

type Obj = Record<string, unknown>
type Compression = 'noCompression' | 'compression'
const ENCODINGS: Compression[] = ['noCompression', 'compression']
const MAIN = 'database/database.bin'
const UNIT_A = '0b6f6a1e-3c1a-4d7e-9a6b-2f3e4d5c6b71'

function profile(mutate: (tree: Obj) => void = () => {}): Obj {
    const tree = JSON.parse(JSON.stringify(buildSmall(1)), (_key, value) => typeof value === 'string' && value.length > 60 ? value.slice(0, 60) : value) as Obj
    mutate(tree)
    return tree
}

const characterOf = (tree: Obj, index = 0) => (tree.characters as Obj[])[index]
const chatOf = (tree: Obj, index = 0) => (characterOf(tree).chats as Obj[])[index]

interface Rig {
    request: ConvertRequest
    memory: MemoryBackend
    files: Map<string, Uint8Array>
    before: Map<string, Uint8Array>
}

async function rig(
    main: Uint8Array, backups: Record<number, Uint8Array> = {}, decoders?: LegacyDecoders, units: Record<string, unknown> = {},
): Promise<Rig> {
    planned.length = 0
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
            readColdStorageItem: async (key) => (key in units ? { status: 'ok', value: structuredClone(units[key]) } : { status: 'missing' }),
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
    incomplete: (readonly IncompleteItem[])[]
}

function freshAsked(): Asked {
    return { fromBackup: [], skipped: [], incomplete: [] }
}

function hooks(asked: Asked) {
    return {
        async confirmFromBackup(backup: number) { asked.fromBackup.push(backup); return true },
        async confirmIncomplete(items: readonly IncompleteItem[]) { asked.incomplete.push(items); return true },
        async confirmSkipped(skipped: readonly SkippedLegacyEntry[]) { asked.skipped.push(skipped); return true },
    }
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

/** Nothing was written: the old files are as they were and the new store holds nothing. */
function expectUntouched(test: Rig): void {
    expect(test.files).toEqual(test.before)
    expect(test.memory.snapshot().size).toBe(0)
}

interface FaultCase {
    label: string
    mutate(tree: Obj): void
    /** The one kind "convert without these" names for it. */
    kind: SalvageOmittedKind
    /** How many characters the converted copy holds; one unless the fault is a character slot. */
    characters?: number
}

const FAULTS: FaultCase[] = [
    ...(['modules', 'loadouts', 'plugins', 'pluginV2'] as const).flatMap((part): FaultCase[] => [
        { label: `${part} a string`, kind: part === 'pluginV2' ? 'plugins' : part, mutate: tree => { tree[part] = 'x' } },
        { label: `${part} an object`, kind: part === 'pluginV2' ? 'plugins' : part, mutate: tree => { tree[part] = { a: 1 } } },
    ]),
    ...(['modules', 'plugins', 'pluginV2'] as const).map((part): FaultCase => ({
        label: `${part} [5]`, kind: part === 'pluginV2' ? 'plugins' : part, mutate: tree => { tree[part] = [5] },
    })),
    { label: 'pluginCustomStorage a string', kind: 'pluginStorage', mutate: tree => { tree.pluginCustomStorage = 'x' } },
    { label: 'pluginCustomStorage an array', kind: 'pluginStorage', mutate: tree => { tree.pluginCustomStorage = [] } },
    { label: 'botPresets [5, ok]', kind: 'presets', mutate: tree => { tree.botPresets = [5, { name: 'ok' }] } },
    { label: 'botPresets [null]', kind: 'presets', mutate: tree => { tree.botPresets = [null] } },
    { label: 'botPresets [Date]', kind: 'presets', mutate: tree => { tree.botPresets = [new Date(0)] } },
    { label: 'characters[0] is 5', kind: 'character', characters: 0, mutate: tree => { (tree.characters as unknown[])[0] = 5 } },
    { label: 'characters[0] is null', kind: 'character', characters: 0, mutate: tree => { (tree.characters as unknown[])[0] = null } },
    { label: 'characters[0] is an array', kind: 'character', characters: 0, mutate: tree => { (tree.characters as unknown[])[0] = [] } },
    // The resolve used to rewrite a Date slot to an empty object, which the conversion then installed as a junk character.
    { label: 'characters[0] is a Date', kind: 'character', characters: 0, mutate: tree => { (tree.characters as unknown[])[0] = new Date(0) } },
    { label: 'chats a string', kind: 'chats', mutate: tree => { characterOf(tree).chats = 'x' } },
    { label: 'chats an object', kind: 'chats', mutate: tree => { characterOf(tree).chats = { a: 1 } } },
    { label: 'chats [5]', kind: 'chats', mutate: tree => { characterOf(tree).chats = [5] } },
    { label: 'chats [null]', kind: 'chats', mutate: tree => { characterOf(tree).chats = [null] } },
    { label: 'chats [Date]', kind: 'chats', mutate: tree => { characterOf(tree).chats = [new Date(0)] } },
    { label: 'message a string', kind: 'chats', mutate: tree => { chatOf(tree).message = 'x' } },
    { label: 'message [5]', kind: 'chats', mutate: tree => { chatOf(tree).message = [5] } },
    { label: 'message [ok, 5]', kind: 'chats', mutate: tree => { chatOf(tree).message = [{ role: 'user', data: 'ok', time: 1 }, 5] } },
    { label: 'message [null]', kind: 'chats', mutate: tree => { chatOf(tree).message = [null] } },
]

describe.each(ENCODINGS)('a save the codec refuses (%s)', (encoding) => {
    test('guard (passes before and after): the unmodified profile converts, so the cases below fail for their fault alone', async () => {
        const control = await rig(encodeRisuSaveLegacy(profile(), encoding))

        const result = await convertLegacyProfile(control.request, hooks(freshAsked()))

        expect(result).toMatchObject({ status: 'installed', fromBackup: null })
    })

    describe.each(FAULTS.map(entry => [entry.label, entry] as const))('%s', (_label, entry) => {
        test('reproducer: the strict read fails, nothing is written', async () => {
            const test = await rig(encodeRisuSaveLegacy(profile(entry.mutate), encoding))
            const asked = freshAsked()

            const result = await convertLegacyProfile(test.request, hooks(asked))

            expect(result).toEqual({ status: 'all-failed', backupsTried: [] })
            expect(asked).toEqual(freshAsked())
            expectUntouched(test)
        })

        test('reproducer: a good backup is asked about and installed from, and the main file is listed unreadable', async () => {
            const test = await rig(encodeRisuSaveLegacy(profile(entry.mutate), encoding), { 5: encodeRisuSaveLegacy(profile(), encoding) })
            const asked = freshAsked()

            const result = await convertLegacyProfile(test.request, hooks(asked))

            expect(asked.fromBackup).toEqual([5])
            expect(result).toMatchObject({ status: 'installed', fromBackup: 5 })
            expect(await legacyStatuses(test.memory)).toEqual({ [MAIN]: 'unreadable', 'database/dbbackup-5.bin': 'ok' })
            expect(test.files).toEqual(test.before)
        })

        test('reproducer: a faulty backup is passed over for the next good one', async () => {
            const test = await rig(encodeRisuSaveLegacy(profile(entry.mutate), encoding), {
                9: encodeRisuSaveLegacy(profile(entry.mutate), encoding),
                5: encodeRisuSaveLegacy(profile(), encoding),
            })
            const asked = freshAsked()

            const result = await convertLegacyProfile(test.request, hooks(asked))

            expect(asked.fromBackup).toEqual([5])
            expect(result).toMatchObject({ status: 'installed', fromBackup: 5 })
        })

        test('reproducer: when every copy is faulty the strict read fails after trying each backup', async () => {
            const test = await rig(encodeRisuSaveLegacy(profile(entry.mutate), encoding), { 9: encodeRisuSaveLegacy(profile(entry.mutate), encoding) })

            const result = await convertLegacyProfile(test.request, hooks(freshAsked()))

            expect(result).toEqual({ status: 'all-failed', backupsTried: [9] })
            expectUntouched(test)
        })

        test('reproducer: "convert without these" names the part once, installs a copy without it, and leaves the old file alone', async () => {
            const test = await rig(encodeRisuSaveLegacy(profile(entry.mutate), encoding))
            const asked = freshAsked()

            const result = await convertLegacyWithout(test.request, hooks(asked))

            expect(result).toMatchObject({ status: 'installed', fromBackup: null })
            expect(asked.skipped.map(list => list.map(skipped => skipped.kind))).toEqual([[entry.kind]])
            const converted = planned.at(-1) as Obj
            expect(findLegacyFaults(converted)).toEqual([])
            expect(converted.characters).toHaveLength(entry.characters ?? 1)
            expect(test.files).toEqual(test.before)
            expect(await legacyStatuses(test.memory)).toEqual({ [MAIN]: 'unreadable' })
        })
    })

    test('guard (passes before and after): a valid main installs from the main file and lists a faulty backup ok', async () => {
        const test = await rig(encodeRisuSaveLegacy(profile(), encoding), { 5: encodeRisuSaveLegacy(profile(tree => { tree.modules = 'x' }), encoding) })
        const asked = freshAsked()

        const result = await convertLegacyProfile(test.request, hooks(asked))

        expect(result).toMatchObject({ status: 'installed', fromBackup: null })
        expect(asked.fromBackup).toEqual([])
        expect(await legacyStatuses(test.memory)).toEqual({ [MAIN]: 'ok', 'database/dbbackup-5.bin': 'ok' })
    })

    test.each([
        ['modules missing', (tree: Obj) => { delete tree.modules }],
        ['modules null', (tree: Obj) => { tree.modules = null }],
        ['modules empty', (tree: Obj) => { tree.modules = [] }],
        ['loadouts missing', (tree: Obj) => { delete tree.loadouts }],
        ['loadouts null', (tree: Obj) => { tree.loadouts = null }],
        ['loadouts [5]', (tree: Obj) => { tree.loadouts = [5] }],
        ['plugins missing', (tree: Obj) => { delete tree.plugins }],
        ['plugins null', (tree: Obj) => { tree.plugins = null }],
        ['pluginV2 missing', (tree: Obj) => { delete tree.pluginV2 }],
        ['pluginV2 null', (tree: Obj) => { tree.pluginV2 = null }],
        ['pluginCustomStorage null', (tree: Obj) => { tree.pluginCustomStorage = null }],
        ['botPresets empty', (tree: Obj) => { tree.botPresets = [] }],
        ['characterOrder a string', (tree: Obj) => { tree.characterOrder = 'x' }],
        ['chats null', (tree: Obj) => { characterOf(tree).chats = null }],
        ['chats missing', (tree: Obj) => { delete characterOf(tree).chats }],
        ['chats empty', (tree: Obj) => { characterOf(tree).chats = [] }],
        ['message null', (tree: Obj) => { chatOf(tree).message = null }],
        ['message missing', (tree: Obj) => { delete chatOf(tree).message }],
    ] as [string, (tree: Obj) => void][])('guard (passes before and after): %s still converts', async (_label, mutate) => {
        const test = await rig(encodeRisuSaveLegacy(profile(mutate), encoding))

        const result = await convertLegacyProfile(test.request, hooks(freshAsked()))

        expect(result).toMatchObject({ status: 'installed', fromBackup: null })
    })

    test('guard (passes before and after): a stub with its own chats a string and a valid unit installs, its unit\'s chats kept, nothing asked', async () => {
        let unit: Obj = {}
        const tree = profile(t => {
            unit = structuredClone(characterOf(t))
            t.characters = [{ type: 'character', name: characterOf(t).name, chaId: characterOf(t).chaId, coldstorage: UNIT_A, chats: 'x' }]
        })
        const test = await rig(encodeRisuSaveLegacy(tree, encoding), {}, undefined, { [UNIT_A]: { character: unit } })
        const asked = freshAsked()

        const result = await convertLegacyProfile(test.request, hooks(asked))

        expect(result).toMatchObject({ status: 'installed', fromBackup: null })
        expect(asked.incomplete).toEqual([])
    })

    describe('what "convert without these" leaves in the converted copy', () => {
        async function convertedWithout(tree: Obj, units: Record<string, unknown> = {}) {
            const test = await rig(encodeRisuSaveLegacy(tree, encoding), {}, undefined, units)
            const asked = freshAsked()
            const result = await convertLegacyWithout(test.request, hooks(asked))
            return { test, asked, result, converted: planned.at(-1) as Obj }
        }
        const kinds = (asked: Asked) => asked.skipped.map(list => list.map(skipped => skipped.kind))
        const names = (list: unknown) => (list as Obj[]).map(element => element.name)
        const chatsOfConverted = (converted: Obj) => (converted.characters as Obj[])[0].chats as Obj[]

        test.each([
            ['the selected preset stays and moves up', 2, 1],
            ['the selected preset was dropped, so the id points one past the kept ones', 1, 2],
            ['the first preset stays where it is', 0, 0],
            ['an id that is not a position is left alone', 7, 7],
            ['an id of -1 is left alone', -1, -1],
        ])('reproducer: botPresets [p0, 5, p2], %s', async (_label, before, after) => {
            const { result, converted, asked } = await convertedWithout(profile(tree => {
                tree.botPresets = [{ name: 'p0' }, 5, { name: 'p2' }]
                tree.botPresetsId = before
            }))

            expect(result).toMatchObject({ status: 'installed' })
            expect(kinds(asked)).toEqual([['presets']])
            expect(names(converted.botPresets)).toEqual(['p0', 'p2'])
            expect(converted.botPresetsId).toBe(after)
        })

        test('reproducer: every preset dropped gives the Default preset, and botPresetsId is left as it was', async () => {
            const { converted, asked } = await convertedWithout(profile(tree => { tree.botPresets = [5, null]; tree.botPresetsId = 1 }))

            expect(kinds(asked)).toEqual([['presets']])
            expect(converted.botPresets).toHaveLength(1)
            expect(names(converted.botPresets)).not.toContain(undefined)
            expect(converted.botPresetsId).toBe(1)
        })

        test('reproducer: an element that is not an object is left out of modules and plugins, the order of the others kept', async () => {
            const { converted, asked } = await convertedWithout(profile(tree => {
                const modules = tree.modules as Obj[]
                const plugins = tree.plugins as Obj[]
                tree.modules = [5, modules[0], 7, modules[1]]
                tree.plugins = [null, plugins[0], plugins[1]]
            }))
            const original = profile()

            expect(kinds(asked)).toEqual([['modules', 'plugins']])
            expect(names(converted.modules)).toEqual(names((original.modules as Obj[]).slice(0, 2)))
            expect(names(converted.plugins)).toEqual(names((original.plugins as Obj[]).slice(0, 2)))
        })

        test.each([
            ['the kept chat after a dropped one moves up', 2, 1],
            ['the selected chat was dropped, so the last kept chat is selected', 4, 2],
            ['the first chat stays', 0, 0],
            ['a page past the end is left alone', 9, 9],
        ])('reproducer: chats [c0, 5, c1, c2, 5], %s', async (_label, before, after) => {
            const { converted, asked } = await convertedWithout(profile(tree => {
                const chats = characterOf(tree).chats as Obj[]
                characterOf(tree).chats = [chats[0], 5, chats[1], { ...chats[0], id: 'c2' }, 5]
                characterOf(tree).chatPage = before
            }))

            expect(kinds(asked)).toEqual([['chats']])
            expect(chatsOfConverted(converted)).toHaveLength(3)
            expect(((converted.characters as Obj[])[0]).chatPage).toBe(after)
        })

        test.each([['a string', 'x'], ['an object', { a: 1 }], ['only elements that are not objects', [5, null]]])(
            'reproducer: chats %s gives the character one new empty chat, selected, with the id from the resolve options',
            async (_label, chats) => {
                const { converted, asked } = await convertedWithout(profile(tree => { characterOf(tree).chats = chats; characterOf(tree).chatPage = 3 }))

                expect(kinds(asked)).toEqual([['chats']])
                expect(chatsOfConverted(converted)).toEqual([{ id: 'placeholder-chat', message: [], note: '', name: 'Chat 1', localLore: [] }])
                expect(((converted.characters as Obj[])[0]).chatPage).toBe(0)
            },
        )

        test('reproducer: a message that is not an object is left out and the chat keeps its fmIndex exactly', async () => {
            const { converted, asked } = await convertedWithout(profile(tree => {
                const chat = chatOf(tree)
                chat.fmIndex = 3
                chat.message = [{ role: 'user', data: 'first', time: 1 }, 5, { role: 'char', data: 'second', time: 2 }]
            }))

            expect(kinds(asked)).toEqual([['chats']])
            const chat = chatsOfConverted(converted)[0]
            expect((chat.message as Obj[]).map(message => message.data)).toEqual(['first', 'second'])
            expect(chat.fmIndex).toBe(3)
            expect(chatsOfConverted(converted)).toHaveLength(2)
        })

        test('reproducer: a message list that is not a list becomes empty and the chat stays', async () => {
            const { converted } = await convertedWithout(profile(tree => { chatOf(tree).message = 'x' }))

            expect(chatsOfConverted(converted)).toHaveLength(2)
            expect(chatsOfConverted(converted)[0].message).toEqual([])
        })

        test('reproducer: faults in many characters are one chats entry, and each skipped slot is its own character entry', async () => {
            const { converted, asked } = await convertedWithout(profile(tree => {
                const second = { ...structuredClone(characterOf(tree)), chaId: 'second', chats: 'x' }
                characterOf(tree).chats = [5]
                tree.characters = [5, characterOf(tree), second, null, new Date(0)]
            }))

            expect([...kinds(asked)[0]].sort()).toEqual(['character', 'character', 'character', 'chats'])
            expect((converted.characters as Obj[]).map(character => character.chaId)).toEqual([characterOf(profile()).chaId, 'second'])
        })

        describe.each(['strict', 'lenient'] as const)('a cold unit the codec would refuse (%s)', (origin) => {
            async function convert(tree: Obj, units: Record<string, unknown>) {
                const test = await rig(encodeRisuSaveLegacy(tree, encoding), {}, undefined, units)
                const asked = freshAsked()
                const result = origin === 'strict' ? await convertLegacyProfile(test.request, hooks(asked)) : await convertLegacyWithout(test.request, hooks(asked))
                return { test, asked, result, converted: planned.at(-1) as Obj }
            }
            const pointer = { role: 'char', data: coldStorageHeader + UNIT_A, time: 1 }
            const stubTree = (unitChats: unknown): { tree: Obj, units: Record<string, unknown> } => {
                let unit: Obj = {}
                const tree = profile(t => {
                    unit = { ...structuredClone(characterOf(t)), chats: unitChats }
                    t.characters = [{ type: 'character', name: characterOf(t).name, chaId: characterOf(t).chaId, coldstorage: UNIT_A, chats: [] }]
                })
                return { tree, units: { [UNIT_A]: { character: unit } } }
            }

            test.each([['chats [5]', [5]], ['a message that is not an object', [{ id: 'c', name: '', note: '', localLore: [], message: [5] }]]])(
                'reproducer: a stub whose unit holds %s is unusable: a placeholder, and the incomplete question names it',
                async (_label, unitChats) => {
                    const { tree, units } = stubTree(unitChats)

                    const { result, asked, converted } = await convert(tree, units)

                    expect(result).toMatchObject({ status: 'installed' })
                    expect(asked.incomplete).toHaveLength(1)
                    expect(asked.incomplete[0]).toEqual([expect.objectContaining({ kind: 'character', reason: 'shape', key: UNIT_A })])
                    const chats = chatsOfConverted(converted)
                    expect(chats).toHaveLength(1)
                    expect(JSON.stringify(chats[0].message)).toContain(UNIT_A)
                },
            )

            test('reproducer: a pointer chat whose unit is [5] keeps the load-error text and the chat is named invalid', async () => {
                const { converted, asked, result } = await convert(profile(tree => { chatOf(tree).message = [pointer] }), { [UNIT_A]: [5] })

                expect(result).toMatchObject({ status: 'installed' })
                expect(asked.incomplete).toEqual([[expect.objectContaining({ kind: 'chat', reason: 'invalid', key: UNIT_A, chatIndex: 0 })]])
                expect((chatsOfConverted(converted)[0].message as Obj[])[0].data).toBe(formatColdStorageLoadError(UNIT_A))
            })

            test('guard (passes before and after): a valid unit is used, nothing is asked', async () => {
                const { converted, asked } = await convert(profile(tree => { chatOf(tree).message = [pointer] }), { [UNIT_A]: [{ role: 'user', data: 'from unit', time: 1 }] })

                expect(asked.incomplete).toEqual([])
                expect((chatsOfConverted(converted)[0].message as Obj[]).map(message => message.data)).toEqual(['from unit'])
            })
        })

        test('reproducer: a pointer chat with a good and a bad message after it, the bad one dropped by the lenient read and refused by the strict read', async () => {
            const tree = () => profile(t => { chatOf(t).message = [{ role: 'char', data: coldStorageHeader + UNIT_A, time: 1 }, { role: 'user', data: 'tail-ok', time: 2 }, 5] })
            const units = { [UNIT_A]: [{ role: 'user', data: 'u1', time: 0 }, { role: 'char', data: 'u2', time: 0 }] }
            const strict = await rig(encodeRisuSaveLegacy(tree(), encoding), {}, undefined, units)

            expect(await convertLegacyProfile(strict.request, hooks(freshAsked()))).toEqual({ status: 'all-failed', backupsTried: [] })
            const { converted, asked } = await convertedWithout(tree(), units)

            expect(kinds(asked)).toEqual([['chats']])
            expect((chatsOfConverted(converted)[0].message as Obj[]).map(message => message.data)).toEqual(['u1', 'u2', 'tail-ok'])
        })
    })

    describe('the decoded tree is never changed by the conversion (snapshot at every depth)', () => {
        function watching(snapshots: { tree: Obj, copy: Obj }[]): LegacyDecoders {
            const keep = (tree: unknown) => { snapshots.push({ tree: tree as Obj, copy: structuredClone(tree) as Obj }) }
            return {
                strict: async (bytes) => { const tree = await decodeRisuSave(bytes, { strict: true }) as Database; keep(tree); return tree },
                lenient: async (bytes) => { const decoded = await decodeLegacyLenient(bytes); keep(decoded.tree); return decoded },
                defaultPreset: async () => ({ name: 'Default' }) as never,
            }
        }

        test('reproducer: the lenient read drops a message, a chat, a preset, a module, a plugin and a character slot without touching the tree it decoded', async () => {
            const snapshots: { tree: Obj, copy: Obj }[] = []
            const units = { [UNIT_A]: [{ role: 'user', data: 'u1', time: 0 }] }
            const tree = profile(t => {
                const chats = characterOf(t).chats as Obj[]
                chats[0].message = [{ role: 'char', data: coldStorageHeader + UNIT_A, time: 1 }, { role: 'user', data: 'tail', time: 2 }, 5]
                // The second chat is the decoded tree's own, with a message array the drop must replace, not splice.
                characterOf(t).chats = [chats[0], 5, { ...chats[1], message: [{ role: 'user', data: 'plain', time: 3 }, 5] }]
                t.botPresets = [{ name: 'p0' }, 5]
                t.modules = [5, ...(t.modules as unknown[])]
                t.plugins = [null, ...(t.plugins as unknown[])]
                t.pluginV2 = 'x'
                t.characters = [new Date(0), ...(t.characters as unknown[]), 7]
            })
            const test = await rig(encodeRisuSaveLegacy(tree, encoding), {}, watching(snapshots), units)

            const result = await convertLegacyWithout(test.request, hooks(freshAsked()))

            expect(result).toMatchObject({ status: 'installed' })
            expect(snapshots).toHaveLength(1)
            expect(snapshots[0].tree).toEqual(snapshots[0].copy)
        })

        test('guard (passes before and after): a strict conversion leaves the decoded tree as it was', async () => {
            const snapshots: { tree: Obj, copy: Obj }[] = []
            const test = await rig(encodeRisuSaveLegacy(profile(), encoding), {}, watching(snapshots))

            await convertLegacyProfile(test.request, hooks(freshAsked()))

            expect(snapshots[0].tree).toEqual(snapshots[0].copy)
        })
    })

    describe.each([
        ['missing', (tree: Obj) => { delete tree.characters }],
        ['null', (tree: Obj) => { tree.characters = null }],
        ['a string', (tree: Obj) => { tree.characters = 'x' }],
        ['an object', (tree: Obj) => { tree.characters = { a: 1 } }],
    ] as [string, (tree: Obj) => void][])('characters %s in the older format', (_label, mutate) => {
        test('reproducer: the strict read fails instead of installing an empty profile, a good backup is offered', async () => {
            const alone = await rig(encodeRisuSaveLegacy(profile(mutate), encoding))
            const withBackup = await rig(encodeRisuSaveLegacy(profile(mutate), encoding), { 5: encodeRisuSaveLegacy(profile(), encoding) })
            const asked = freshAsked()

            expect(await convertLegacyProfile(alone.request, hooks(freshAsked()))).toEqual({ status: 'all-failed', backupsTried: [] })
            expectUntouched(alone)
            expect(await convertLegacyProfile(withBackup.request, hooks(asked))).toMatchObject({ status: 'installed', fromBackup: 5 })
            expect(asked.fromBackup).toEqual([5])
        })

        test('guard (passes before and after): "convert without these" installs nothing', async () => {
            const test = await rig(encodeRisuSaveLegacy(profile(mutate), encoding))

            const result = await convertLegacyWithout(test.request, hooks(freshAsked()))

            expect(result).toMatchObject({ status: 'blocked', reason: 'convert-lenient-failed' })
            expectUntouched(test)
        })
    })

    test.each([
        ['a map without a characters list', { x: 1 }],
        ['a bare string', 'a bare string'],
    ] as [string, unknown][])('reproducer: %s as the whole save fails the strict read', async (_label, value) => {
        const test = await rig(encodeRisuSaveLegacy(value, encoding), { 5: encodeRisuSaveLegacy(profile(), encoding) })
        const asked = freshAsked()

        const result = await convertLegacyProfile(test.request, hooks(asked))

        expect(asked.fromBackup).toEqual([5])
        expect(result).toMatchObject({ status: 'installed', fromBackup: 5 })
        expect(test.files).toEqual(test.before)
    })
})

describe('block format', () => {
    const root = (directory: string[]) => ({ name: 'root', type: BLOCK.ROOT, data: JSON.stringify({ formatversion: 5, __directory: directory }) })
    const preset = { name: 'preset', type: BLOCK.BOTPRESET, data: '[{"name":"p"}]' }
    async function blockSave(parts: { name: string, type: number, data: string }[]): Promise<Uint8Array> {
        return (await composeSave(new RisuSaveEncoder(), parts)).bytes
    }

    test.each([
        ['a string', '"x"'],
        ['an object holding a character', '{"0":{"type":"character","chaId":"lost","name":"Lost","chats":[]}}'],
    ])('reproducer: a root block whose characters is %s fails the strict read, and "convert without these" ends blocked instead of installing an empty profile', async (_label, charactersJson) => {
        const badRoot = { name: 'root', type: BLOCK.ROOT, data: `{"formatversion":5,"characters":${charactersJson},"__directory":["preset"]}` }
        const test = await rig(await blockSave([badRoot, preset]))

        expect(await convertLegacyProfile(test.request, hooks(freshAsked()))).toEqual({ status: 'all-failed', backupsTried: [] })
        expectUntouched(test)
        const lenient = await convertLegacyWithout(test.request, hooks(freshAsked()))

        expect(lenient).toMatchObject({ status: 'blocked', reason: 'convert-lenient-failed' })
        expectUntouched(test)
    })

    test('guard (passes before and after): a save with no characters list installs, the missing list is not a refusal here', async () => {
        const test = await rig(await blockSave([root(['preset', 'modules']), preset, { name: 'modules', type: BLOCK.MODULES, data: '[]' }]))

        const result = await convertLegacyProfile(test.request, hooks(freshAsked()))

        expect(result).toMatchObject({ status: 'installed', fromBackup: null })
    })

    test('reproducer: a modules block holding an object fails the strict read, a good backup is offered', async () => {
        const bad = await blockSave([root(['preset', 'modules']), preset, { name: 'modules', type: BLOCK.MODULES, data: '{"a":1}' }])
        const alone = await rig(bad)
        const withBackup = await rig(bad, { 5: encodeRisuSaveLegacy(profile(), 'noCompression') })
        const asked = freshAsked()

        expect(await convertLegacyProfile(alone.request, hooks(freshAsked()))).toEqual({ status: 'all-failed', backupsTried: [] })
        expectUntouched(alone)
        expect(await convertLegacyProfile(withBackup.request, hooks(asked))).toMatchObject({ status: 'installed', fromBackup: 5 })
        expect(asked.fromBackup).toEqual([5])
    })

    test('reproducer: a character block whose chats is a string fails the strict read, and the lenient read names the chats and gives the character one new empty chat', async () => {
        const character = { type: 'character', chaId: 'cha1', name: 'n', chats: 'x', chatPage: 0 }
        const bad = await blockSave([root(['preset', 'cha1']), preset, { name: 'cha1', type: BLOCK.CHARACTER_WITH_CHAT, data: JSON.stringify(character) }])
        const test = await rig(bad)
        const asked = freshAsked()

        expect(await convertLegacyProfile(test.request, hooks(freshAsked()))).toEqual({ status: 'all-failed', backupsTried: [] })
        expectUntouched(test)
        const lenient = await convertLegacyWithout(test.request, hooks(asked))

        expect(lenient).toMatchObject({ status: 'installed' })
        expect(asked.skipped.map(list => list.map(skipped => skipped.kind))).toEqual([['chats']])
        const converted = (planned.at(-1) as Obj).characters as Obj[]
        expect(converted).toHaveLength(1)
        expect(converted[0].chats).toEqual([{ id: 'placeholder-chat', message: [], note: '', name: 'Chat 1', localLore: [] }])
    })

    test('reproducer: a modules block holding an object is named and left out by the lenient read', async () => {
        const bad = await blockSave([root(['preset', 'modules']), preset, { name: 'modules', type: BLOCK.MODULES, data: '{"a":1}' }])
        const test = await rig(bad)
        const asked = freshAsked()

        const lenient = await convertLegacyWithout(test.request, hooks(asked))

        expect(lenient).toMatchObject({ status: 'installed' })
        expect(asked.skipped.map(list => list.map(skipped => skipped.kind))).toEqual([['modules']])
        expect((planned.at(-1) as Obj).modules).toEqual([])
    })
})

describe('hasBlockMagic agrees with isBlockFormatSave', () => {
    const text = (value: string) => new TextEncoder().encode(value)
    const fixtures = async (): Promise<[string, Uint8Array][]> => [
        ['block format', (await composeSave(new RisuSaveEncoder(), [{ name: 'root', type: BLOCK.ROOT, data: '{"formatversion":5,"__directory":[]}' }])).bytes],
        ['older raw', encodeRisuSaveLegacy(profile(), 'noCompression')],
        ['older compressed', encodeRisuSaveLegacy(profile(), 'compression')],
        ['older stream', new Uint8Array(await encodeRisuSaveCompressionStream(profile()))],
        ['empty', new Uint8Array(0)],
        ['7 bytes', text('RISUSAV')],
        ['8 bytes', text('RISUSAVE')],
        ['9 bytes', text('RISUSAVE\x01')],
        ['10 bytes', text('RISUSAVE\x01\x00')],
        ['11 bytes', text('RISUSAVE\x01\x00\x00')],
        ['11 bytes with a wrong prefix', text('RISUSAVX\x01\x00\x00')],
        ['unrelated bytes', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])],
    ]

    test('unit: every encoding and every short buffer', async () => {
        for (const [label, bytes] of await fixtures()) {
            expect({ label, magic: hasBlockMagic(bytes) }).toEqual({ label, magic: isBlockFormatSave(bytes) })
        }
    })

    test('the block format and the 11-byte buffer are recognised, the 8- and 10-byte ones are not', async () => {
        const byLabel = new Map(await fixtures())

        expect(hasBlockMagic(byLabel.get('block format') as Uint8Array)).toBe(true)
        expect(hasBlockMagic(byLabel.get('11 bytes') as Uint8Array)).toBe(true)
        expect(hasBlockMagic(byLabel.get('8 bytes') as Uint8Array)).toBe(false)
        expect(hasBlockMagic(byLabel.get('10 bytes') as Uint8Array)).toBe(false)
        expect(hasBlockMagic(byLabel.get('older raw') as Uint8Array)).toBe(false)
    })
})

describe('the safety net: a refusal only the codec sees (a BigInt inside a message)', () => {
    // A regression of the continuation loop would decode forever on microtasks and starve the test timeout: past the limit the decoder throws, so the loop ends and the check below fails the test instead.
    const STRICT_CALL_LIMIT = 12
    const strictCalls: number[] = []
    afterEach(() => {
        vi.restoreAllMocks()
        expect(strictCalls.length).toBeLessThanOrEqual(STRICT_CALL_LIMIT)
    })

    function treeWith(bad: boolean): Database {
        return profile(tree => { chatOf(tree).message = [bad ? { role: 'user', data: 'x', time: 1, big: 10n } : { role: 'user', data: 'x', time: 1 }] }) as unknown as Database
    }

    /** Bytes whose first byte names the tree: 1 main, 9 and 5 backups; `bad` lists the ones holding a BigInt. */
    function decodersFor(bad: number[], calls: number[] = strictCalls): LegacyDecoders {
        strictCalls.length = 0
        return {
            strict: async (bytes) => {
                calls.push(bytes[0])
                if (calls.length > STRICT_CALL_LIMIT) {
                    throw new Error('The strict decoder was called past its limit.')
                }
                return treeWith(bad.includes(bytes[0]))
            },
            lenient: async (bytes) => ({ tree: treeWith(bad.includes(bytes[0])), skipped: [] }),
            defaultPreset: async () => ({ name: 'Default' }) as never,
        }
    }

    const bytesOf = (marker: number) => new Uint8Array([marker, 0, 0])

    test('reproducer: with no backup the strict read ends all-failed instead of throwing, and nothing is written', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const test = await rig(bytesOf(1), {}, decodersFor([1]))

        const result = await convertLegacyProfile(test.request, hooks(freshAsked()))

        expect(result).toEqual({ status: 'all-failed', backupsTried: [] })
        expectUntouched(test)
        expect(warn).toHaveBeenCalledTimes(1)
        expect(String(warn.mock.calls[0][0])).toContain('main file')
        expect(String(warn.mock.calls[0][0])).toContain('bigint')
    })

    test('reproducer: with a good backup it is asked about and installed from, the faulty main decoded once', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const calls: number[] = []
        const test = await rig(bytesOf(1), { 5: bytesOf(5) }, decodersFor([1], calls))
        const asked = freshAsked()

        const result = await convertLegacyProfile(test.request, hooks(asked))

        expect(asked.fromBackup).toEqual([5])
        expect(result).toMatchObject({ status: 'installed', fromBackup: 5 })
        expect(calls.filter(call => call === 1)).toHaveLength(1)
        expect(await legacyStatuses(test.memory)).toEqual({ [MAIN]: 'unreadable', 'database/dbbackup-5.bin': 'ok' })
        expect(test.files).toEqual(test.before)
    })

    test('reproducer: a faulty backup is logged and passed over for the next, each backup asked about only when it is used', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const test = await rig(bytesOf(1), { 9: bytesOf(9), 5: bytesOf(5) }, decodersFor([1, 9]))
        const asked = freshAsked()

        const result = await convertLegacyProfile(test.request, hooks(asked))

        expect(asked.fromBackup).toEqual([9, 5])
        expect(result).toMatchObject({ status: 'installed', fromBackup: 5 })
        expect(warn.mock.calls.map(call => String(call[0]))).toEqual([
            expect.stringContaining('main file'),
            expect.stringContaining('numbered backup 9'),
        ])
    })

    test('reproducer: when every copy is refused by the codec all-failed names every backup tried', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const test = await rig(bytesOf(1), { 9: bytesOf(9), 5: bytesOf(5) }, decodersFor([1, 9, 5]))

        const result = await convertLegacyProfile(test.request, hooks(freshAsked()))

        expect(result).toEqual({ status: 'all-failed', backupsTried: [9, 5] })
        expectUntouched(test)
    })

    test('reproducer: "convert without these" ends at the blocked result with the codec\'s message', async () => {
        const test = await rig(bytesOf(1), {}, decodersFor([1]))

        const result = await convertLegacyWithout(test.request, hooks(freshAsked()))

        expect(result).toMatchObject({ status: 'blocked', reason: 'convert-lenient-failed' })
        expect((result as { detail: string }).detail).toContain('bigint')
        expectUntouched(test)
    })

    test('guard (passes before and after): an error that is not a codec refusal is not swallowed', async () => {
        const test = await rig(bytesOf(1), {}, decodersFor([]))
        test.request.lists = { ...fakeLists, characterAssets: () => { throw new TypeError('the list derivation broke') } }

        await expect(convertLegacyProfile(test.request, hooks(freshAsked()))).rejects.toThrow('the list derivation broke')
        expectUntouched(test)
    })

    test('guard (passes before and after): a good tree through the same decoders installs', async () => {
        const test = await rig(bytesOf(1), {}, decodersFor([]))

        const result: ConvertResult = await convertLegacyProfile(test.request, hooks(freshAsked()))

        expect(result).toMatchObject({ status: 'installed', fromBackup: null })
    })
})
