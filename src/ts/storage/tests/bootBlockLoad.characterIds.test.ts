// @vitest-environment node
/**
 * The backup the boot offers when the saved data is damaged
 * (`src/ts/storage/bootBlockLoad.ts`) is made one the save can hold before it
 * is written: an id that cannot key a block is replaced with the lists that
 * named it following, an archived character takes back the id its unit records
 * (the unit is read through the context, never by this module), and a backup
 * that cannot be saved is refused with the text the boot stop screen shows,
 * with nothing written.
 *
 * The harness is the one `bootBlockLoad.test.ts` documents. A passing test says
 * nothing about a real browser, disk or server.
 *
 * Title labels: (R) marks a reproducer that fails against a boot that writes
 * the chosen backup as it is; (G) marks a guard that passes with or without it.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => { }),
            removeItem: vi.fn(async () => { }),
        }),
    },
}))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => { }),
        removeItem: vi.fn(async () => { }),
    },
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: async () => ({
        capabilities: { conditionalWrites: false },
        read: async () => ({ bytes: null, version: null }),
        write: async () => ({ version: null }),
        delete: async () => { },
        deleteMany: async () => { },
        list: async () => [],
        has: async () => false,
    }),
}) as unknown as typeof import('src/ts/storage/store/appStore'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

import { changeLanguage, language } from 'src/lang'
import { BLOCK_TYPE_CHARACTER_WITH_CHAT, frameBlock } from 'src/ts/storage/blockFrame'
import { HEAD_KEY, keptKey, ownBlockKey, rootKey } from 'src/ts/storage/blockKeys'
import { inspectGenerations, type BlockStoreOwner } from 'src/ts/storage/blockStore'
import {
    finishBlockBoot,
    layoutFileBytes,
    loadBlockProfile,
    olderMainFileCopyExists,
    seedEmptyBlockProfile,
    type BootBackupSource,
    type BootLoadContext,
    type BootLoadUi,
} from 'src/ts/storage/bootBlockLoad'
import type { BootArchiveSession, ReplaceHold } from 'src/ts/storage/bootArchivePass'
import type { Database } from 'src/ts/storage/database.svelte'
import { fingerprintMainFile, preBlocksKey } from 'src/ts/storage/mainFileFingerprint'
import { isAssetSweepHeld, resetPageStorageModeForTests } from 'src/ts/storage/pageStorageMode'
import { encodeRisuSaveLegacy } from 'src/ts/storage/risuSave'
import { treeToBlockSet } from 'src/ts/storage/treeToBlockSet'
import { BLOCK, composeSave } from 'src/ts/storage/tests/manualCleanupHarness'
import { RisuSaveEncoder } from 'src/ts/storage/risuSave'
import { createFakeStore, makeOwner, type FakeStore } from './blockStoreHarness'

// -- fixtures -------------------------------------------------------------------

type Character = Database['characters'][number]

function character(chaId: string, extra: Record<string, unknown> = {}): Character {
    return { chaId, type: 'character', name: `Name of ${chaId}`, chats: [{ message: [{ role: 'user', data: `hello ${chaId}` }] }], ...extra } as unknown as Character
}

function tree(characters: Character[], extra: Record<string, unknown> = {}): Database {
    return {
        formatversion: 5,
        botPresets: [{ name: 'p' }],
        botPresetsId: 0,
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        mainPrompt: 'prompt',
        characters,
        ...extra,
    } as unknown as Database
}

function chaIdsOf(value: Database): string[] {
    return (value.characters as Character[]).map((c) => c.chaId as string)
}

async function seed(store: FakeStore, value: Database): Promise<string> {
    const { owner } = makeOwner(store)
    const result = await owner.replaceWholeState(await treeToBlockSet(value), { requireAbsentHead: true })
    if (result.kind !== 'won') {
        throw new Error(`seeding failed: ${result.kind}`)
    }
    return result.generation
}

/** Replaces a character's own block with a block whose frame and checksum are valid but whose content is not JSON. */
function breakContent(store: FakeStore, generation: string, chaId: string): void {
    store.plant(ownBlockKey(generation, chaId), frameBlock(BLOCK_TYPE_CHARACTER_WITH_CHAT, chaId, new TextEncoder().encode('{not json')))
}

const GARBAGE = new TextEncoder().encode('this is not a head')

const SECOND = '000000000099-00000099'

/** Writes a complete, rooted generation of `value` under `generation` without naming it in the head. */
async function plantRootedGeneration(store: FakeStore, generation: string, value: Database): Promise<void> {
    const scratch = createFakeStore({ versioned: false })
    await seed(scratch, value)
    for (const key of scratch.keys('blocks/')) {
        if (key !== HEAD_KEY) {
            store.plant(key.replace(/^blocks\/[^/]+\//, `blocks/${generation}/`), scratch.peek(key) as Uint8Array)
        }
    }
}

/** A backup file for `value`, as a numbered backup holds it. */
async function backupBytes(value: Database): Promise<Uint8Array> {
    return layoutFileBytes((await treeToBlockSet(value)).layout)
}

/** A backup that decodes only in part: the file of `value` with one character block's checksum broken. */
async function partialBackupBytes(value: Database, damagedChaId: string): Promise<Uint8Array> {
    const set = await treeToBlockSet(value)
    const blocks = set.layout.blocks.map((block, i) => {
        if (set.layout.keys[i] !== damagedChaId) {
            return block
        }
        const copy = block.slice()
        copy[copy.length - 1] ^= 0xff
        return copy
    })
    return layoutFileBytes({ keys: set.layout.keys, blocks })
}

interface Harness {
    store: FakeStore
    owner: BlockStoreOwner
    ctx: BootLoadContext
    notices: string[]
    chosen: string[][]
    confirms: string[]
    holds: ReplaceHold[]
    released: number
    ui: BootLoadUi
}

interface HarnessOptions {
    store?: FakeStore
    backups?: Array<[number, Uint8Array]>
    /** Index chosen at each `choose` call, in order; the last answer repeats. */
    choices?: number[]
    confirm?: boolean
    holds?: ReplaceHold[]
    nodeBodyLimit?: number
    waitForReload?: () => Promise<never>
    readUnitCharacter?: BootLoadContext['readUnitCharacter']
}

function harness(options: HarnessOptions = {}): Harness {
    const store = options.store ?? createFakeStore({ versioned: options.nodeBodyLimit !== undefined })
    const { owner } = makeOwner(store, options.nodeBodyLimit === undefined ? {} : { nodeBodyLimit: options.nodeBodyLimit })
    const state: Harness = {
        store,
        owner,
        notices: [],
        chosen: [],
        confirms: [],
        holds: [],
        released: 0,
        ui: undefined as unknown as BootLoadUi,
        ctx: undefined as unknown as BootLoadContext,
    }
    const choices = options.choices ?? [0]
    let choiceIndex = 0
    state.ui = {
        notify: async (text) => { state.notices.push(text) },
        choose: async (_title, offered) => {
            state.chosen.push([...offered])
            const answer = choices[Math.min(choiceIndex, choices.length - 1)]
            choiceIndex++
            return answer
        },
        confirm: async (text) => {
            state.confirms.push(text)
            return options.confirm ?? true
        },
    }
    const holdQueue = [...(options.holds ?? [])]
    const session: BootArchiveSession = {
        canArchive: true,
        run: async (input) => ({ kind: 'install', tree: input.tree, noteBytes: null, notices: [] }),
        release: async () => { state.released++ },
        acquireReplaceHold: async () => {
            const next = holdQueue.shift() ?? { kind: 'held', release: async () => { state.released++ } } as ReplaceHold
            state.holds.push(next)
            return next
        },
    }
    const backups: BootBackupSource = {
        list: async () => (options.backups ?? []).map(([time]) => time).sort((a, b) => b - a),
        read: async (time) => {
            const found = (options.backups ?? []).find(([candidate]) => candidate === time)
            if (found === undefined) {
                throw new Error(`no backup ${time}`)
            }
            return found[1]
        },
    }
    state.ctx = {
        owner,
        store,
        session,
        ui: state.ui,
        backups,
        waitForReload: options.waitForReload ?? (() => new Promise<never>(() => { })),
        readUnitCharacter: options.readUnitCharacter,
    }
    return state
}

beforeEach(() => {
    resetPageStorageModeForTests()
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'log').mockImplementation(() => { })
})

afterEach(() => {
    vi.restoreAllMocks()
    changeLanguage('en')
})

async function stopText(run: Promise<unknown>): Promise<string> {
    try {
        await run
    } catch (error) {
        return String(error)
    }
    throw new Error('expected the boot to stop')
}

/**
 * A numbered backup file whose character blocks are named `blockName` but hold
 * the characters given, so a character's own id can be one no block could carry.
 */
async function backupHolding(characters: Array<{ blockName: string, value: object }>): Promise<Uint8Array> {
    const parts = [
        { name: 'root', type: BLOCK.ROOT, data: JSON.stringify({ formatversion: 5, mainPrompt: 'p', __directory: ['preset', 'modules', 'loadouts', 'plugins', ...characters.map((c) => c.blockName), 'config'] }) },
        { name: 'preset', type: BLOCK.BOTPRESET, data: JSON.stringify([{ name: 'p' }]) },
        { name: 'modules', type: BLOCK.MODULES, data: '[]' },
        { name: 'loadouts', type: BLOCK.LOADOUTS, data: '[]' },
        { name: 'plugins', type: BLOCK.PLUGINS, data: '[]' },
        ...characters.map((c) => ({ name: c.blockName, type: BLOCK.CHARACTER_WITH_CHAT, data: JSON.stringify(c.value) })),
        { name: 'config', type: BLOCK.CONFIG, data: '{"version":1}' },
    ]
    return (await composeSave(new RisuSaveEncoder(), parts)).bytes
}

async function damagedStore(): Promise<FakeStore> {
    const store = createFakeStore({ versioned: false })
    const generation = await seed(store, tree([character('a'), character('b')]))
    breakContent(store, generation, 'b')
    return store
}

describe('the backup the damage prompt offers (S9)', () => {
    test('(R) a character whose id cannot key a block is installed with a new id', async () => {
        const store = await damagedStore()
        const bytes = await backupHolding([{ blockName: 'x', value: character('preset', { chats: [] }) }, { blockName: 'y', value: character('y', { chats: [] }) }])
        const h = harness({ store, backups: [[100, bytes]] })

        const result = await loadBlockProfile(h.ctx)

        const ids = result.kind === 'loaded' ? chaIdsOf(result.tree) : []
        expect(ids).toHaveLength(2)
        expect(ids).not.toContain('preset')
        expect(ids).toContain('y')
    })

    test('(R) an archived character with an id that cannot be saved takes back the id its unit records', async () => {
        const store = await damagedStore()
        const bytes = await backupHolding([{ blockName: 'stub', value: character('config', { coldstorage: 'unit-1', chats: [] }) }])
        const h = harness({ store, backups: [[100, bytes]], readUnitCharacter: async () => ({ chaId: 'recovered' }) })

        const result = await loadBlockProfile(h.ctx)

        expect(result.kind === 'loaded' && chaIdsOf(result.tree)).toEqual(['recovered'])
    })

    test('(R) when the unit cannot name an id the boot stops with the character\'s name and writes nothing', async () => {
        const store = await damagedStore()
        const bytes = await backupHolding([{ blockName: 'stub', value: character('config', { coldstorage: 'unit-1', chats: [] }) }])
        const h = harness({ store, backups: [[100, bytes]], readUnitCharacter: async () => null })
        const writes = store.mutating().length

        const stopped = await stopText(loadBlockProfile(h.ctx))

        expect(stopped).toBe(language.restoreRefusedArchivedId('Name of config'))
        expect(store.mutating().length).toBe(writes)
    })

    test('(R) without a way to read units, an archived character with an id that cannot be saved is stopped on as well', async () => {
        const store = await damagedStore()
        const bytes = await backupHolding([{ blockName: 'stub', value: character('config', { coldstorage: 'unit-1', chats: [] }) }])
        const h = harness({ store, backups: [[100, bytes]] })

        expect(await stopText(loadBlockProfile(h.ctx))).toBe(language.restoreRefusedArchivedId('Name of config'))
    })

    test('(R) a backup that was repaired is announced once the replace has won, after the damage prompt', async () => {
        const store = await damagedStore()
        const bytes = await backupHolding([{ blockName: 'x', value: character('preset', { chats: [] }) }, { blockName: 'stub', value: character('config', { coldstorage: 'unit-1', chats: [] }) }])
        const h = harness({ store, backups: [[100, bytes]], readUnitCharacter: async () => ({ chaId: 'recovered' }) })

        await loadBlockProfile(h.ctx)

        expect(h.notices).toHaveLength(2)
        expect(h.notices[1]).toBe(language.restoreRepairedNotice(0, 1, 1))
    })

    test('(G) a refused backup shows only the stop text, with no repair notice', async () => {
        const store = await damagedStore()
        const bytes = await backupHolding([{ blockName: 'x', value: character('preset', { chats: [] }) }, { blockName: 'stub', value: character('config', { coldstorage: 'unit-1', chats: [] }) }])
        const h = harness({ store, backups: [[100, bytes]], readUnitCharacter: async () => null })

        await stopText(loadBlockProfile(h.ctx))

        expect(h.notices.some((text) => text.includes('repaired its character list'))).toBe(false)
    })

    test('(G) a well-formed backup loads as before', async () => {
        const store = await damagedStore()
        const h = harness({ store, backups: [[100, await backupBytes(tree([character('from-backup')]))]] })

        const result = await loadBlockProfile(h.ctx)

        expect(result.kind === 'loaded' && chaIdsOf(result.tree)).toEqual(['from-backup'])
        expect(h.notices).toHaveLength(1)
    })
})