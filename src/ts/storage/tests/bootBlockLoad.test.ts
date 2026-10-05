// @vitest-environment node
/**
 * The boot side of the block store (`src/ts/storage/bootBlockLoad.ts`): loading
 * the profile through the owner with the strict decode inside `load()`, the
 * prompt that offers a numbered backup when the saved data is damaged, the seed
 * of an empty profile and the steps after an install.
 *
 * The real owner runs over the in-memory store of `blockStoreHarness.ts`, with
 * the real encoder and decoder; the session, the prompts and the backup list
 * are stand-ins that record what they were asked. A passing test says nothing
 * about a real browser, disk or server. Module mocks as in treeToBlockSet.test.ts.
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
    isPlainHttpFileSrc: vi.fn(() => false),
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

// -- loading ----------------------------------------------------------------------

describe('loading a block profile', () => {
    test('a clean load decodes the profile inside load() and writes nothing', async () => {
        const store = createFakeStore({ versioned: false })
        await seed(store, tree([character('a'), character('b')]))
        const writes = store.mutating().length
        const h = harness({ store })

        const result = await loadBlockProfile(h.ctx)

        expect(result.kind).toBe('loaded')
        expect(result.kind === 'loaded' && result.how).toBe('store')
        expect(result.kind === 'loaded' && chaIdsOf(result.tree)).toEqual(['a', 'b'])
        expect(h.owner.isLive()).toBe(true)
        expect(store.mutating().length, 'a boot load writes nothing').toBe(writes)
        expect(h.notices).toEqual([])
    })

    test('a store with no head answers no-head and leaves the owner unloaded', async () => {
        const h = harness()

        expect(await loadBlockProfile(h.ctx)).toEqual({ kind: 'no-head' })
        expect(h.owner.isLive()).toBe(false)
    })

    test('a read that keeps failing stops the boot with the translated error: nothing is installed or written', async () => {
        const store = createFakeStore({ versioned: false })
        await seed(store, tree([character('a')]))
        const writes = store.mutating().length
        store.faults.push({ match: (op) => op.kind === 'read' && op.key === HEAD_KEY, mode: 'before', times: 99 })
        const h = harness({ store })

        expect(await stopText(loadBlockProfile(h.ctx))).toBe(language.saveReadFailed)
        expect(h.owner.isLive()).toBe(false)
        expect(store.mutating().length).toBe(writes)
    })
})

// -- damage: a clean load that fails the strict decode (1c-2, 1c-16) ----------------------------------------

describe('a block whose frame holds but whose content does not decode', () => {
    test('is damage, never a partial install: the prompt names the block and the owner stays loadable', async () => {
        const store = createFakeStore({ versioned: false })
        const generation = await seed(store, tree([character('a'), character('b')]))
        breakContent(store, generation, 'b')
        const writes = store.mutating().length
        const h = harness({ store, choices: [1] })

        const stopped = await stopText(loadBlockProfile(h.ctx))

        expect(h.notices.join('\n')).toContain(language.saveDamageItem('character', 'b', 'unreadable-content'))
        expect(stopped).toContain(language.saveDamageItem('character', 'b', 'unreadable-content'))
        expect(h.owner.isLive(), 'nothing was installed').toBe(false)
        expect(store.mutating().length, 'the prompt wrote nothing').toBe(writes)
        // The owner stayed loadable: a later load, once the block is whole, succeeds.
        const whole = await treeToBlockSet(tree([character('a'), character('b')]))
        store.plant(ownBlockKey(generation, 'b'), whole.layout.blocks[whole.layout.keys.indexOf('b')])
        expect((await h.owner.load()).kind).toBe('loaded')
    })

    test('choosing the backup completes after one prompt: the backup loads, the damaged generation is kept and the sweep is held off', async () => {
        const store = createFakeStore({ versioned: false })
        const generation = await seed(store, tree([character('a'), character('b')]))
        breakContent(store, generation, 'b')
        const h = harness({ store, backups: [[100, await backupBytes(tree([character('from-backup')]))]] })

        const result = await loadBlockProfile(h.ctx)

        expect(result.kind === 'loaded' && result.how).toBe('backup')
        expect(result.kind === 'loaded' && chaIdsOf(result.tree)).toEqual(['from-backup'])
        expect(h.notices.length, 'one prompt').toBe(1)
        expect(h.chosen.length).toBe(1)
        expect(h.owner.isLive()).toBe(true)
        expect(store.peek(keptKey(generation)), 'the damaged generation stays on disk, marked kept').not.toBeNull()
        expect(store.peek(rootKey(generation))).not.toBeNull()
        expect(isAssetSweepHeld(), 'the same boot must not sweep what the kept generation references').toBe(true)
        const inventory = await h.owner.inventory()
        expect(inventory.kept).toEqual([generation])
    })

    test('with the damage changed by a peer while the prompt was up, the choice did not happen: the person is told and asked once more', async () => {
        const store = createFakeStore({ versioned: false })
        const generation = await seed(store, tree([character('a'), character('b'), character('c')]))
        breakContent(store, generation, 'b')
        let peerActs = true
        const h = harness({ store, choices: [0, 0], backups: [[100, await backupBytes(tree([character('from-backup')]))]] })
        const originalChoose = h.ui.choose
        h.ui.choose = async (title, options) => {
            if (peerActs) {
                peerActs = false
                breakContent(store, generation, 'c')
            }
            return originalChoose(title, options)
        }

        const result = await loadBlockProfile(h.ctx)

        expect(h.notices.length, 'two prompts').toBe(3)
        expect(h.notices[1], 'the first choice did not happen').toBe(language.saveDamagedChanged)
        expect(h.notices[2]).toContain(language.saveDamageItem('character', 'c', 'unreadable-content'))
        expect(result.kind === 'loaded' && result.how).toBe('backup')
        expect(store.peek(keptKey(generation))).not.toBeNull()
    })
})

describe('two tabs that both choose the backup', () => {
    test('the loser finds the winner\'s profile loaded: its choice is silently dropped and its load succeeds on the winner\'s state', async () => {
        const store = createFakeStore({ versioned: false })
        const generation = await seed(store, tree([character('a'), character('b')]))
        breakContent(store, generation, 'b')
        const backup = await backupBytes(tree([character('from-backup')]))
        const winner = harness({ store, backups: [[100, backup]] })
        let release!: () => void
        const loserDeciding = new Promise<void>((resolve) => { release = resolve })
        const loser = harness({ store, backups: [[100, backup]] })
        const loserChoose = loser.ui.choose
        loser.ui.choose = async (title, options) => {
            await loserDeciding
            return loserChoose(title, options)
        }

        const loserRun = loadBlockProfile(loser.ctx)
        // The loser is at its prompt; the winner chooses and wins.
        await vi.waitFor(() => expect(loser.notices.length).toBe(1))
        expect((await loadBlockProfile(winner.ctx)).kind).toBe('loaded')
        release()
        const result = await loserRun

        expect(result.kind === 'loaded' && result.how).toBe('store')
        expect(result.kind === 'loaded' && chaIdsOf(result.tree)).toEqual(['from-backup'])
        expect(loser.notices.length, 'the loser was told nothing more').toBe(1)
        expect(loser.owner.isLive()).toBe(true)
    })
})

// -- the damage kinds and the language ---------------------------------------------------

describe('the prompt', () => {
    test('stop writes nothing and the screen names the damage', async () => {
        const store = createFakeStore({ versioned: false })
        const generation = await seed(store, tree([character('a')]))
        store.unplant(ownBlockKey(generation, 'a'))
        const writes = store.mutating().length
        const h = harness({ store, choices: [1], backups: [[100, await backupBytes(tree([character('old')]))]] })

        const stopped = await stopText(loadBlockProfile(h.ctx))

        expect(stopped).toContain(language.saveDamageItem('character', 'a', 'absent'))
        expect(store.mutating().length).toBe(writes)
        expect(h.owner.isLive()).toBe(false)
    })

    test('the boot hold is released before the prompt is shown', async () => {
        const store = createFakeStore({ versioned: false })
        const generation = await seed(store, tree([character('a')]))
        breakContent(store, generation, 'a')
        const h = harness({ store, choices: [1], backups: [[100, await backupBytes(tree([character('old')]))]] })
        let releasedAtPrompt = -1
        const notify = h.ui.notify
        h.ui.notify = async (text) => { releasedAtPrompt = h.released; await notify(text) }

        await stopText(loadBlockProfile(h.ctx))

        expect(releasedAtPrompt).toBeGreaterThanOrEqual(1)
    })

    test('the wording follows the language the readable root names, and English when the root is unreadable', async () => {
        const store = createFakeStore({ versioned: false })
        const generation = await seed(store, tree([character('a')], { language: 'ko' }))
        breakContent(store, generation, 'a')
        const h = harness({ store, choices: [1] })
        const english = language.settings

        await stopText(loadBlockProfile(h.ctx))
        expect(language.settings, 'a readable root names Korean').not.toBe(english)

        changeLanguage('ko')
        store.unplant(rootKey(generation))
        const second = harness({ store, choices: [1] })
        await stopText(loadBlockProfile(second.ctx))
        expect(language.settings, 'an unreadable root leaves English').toBe(english)
    })

    test('no backup that can be read: only stop is possible, and nothing is written', async () => {
        const store = createFakeStore({ versioned: false })
        const generation = await seed(store, tree([character('a')]))
        breakContent(store, generation, 'a')
        const writes = store.mutating().length
        const h = harness({ store, backups: [[100, new Uint8Array([1, 2, 3])]] })

        const stopped = await stopText(loadBlockProfile(h.ctx))

        expect(h.notices.join('\n')).toContain(language.saveDamagedNoBackup)
        expect(h.chosen, 'no choice was offered').toEqual([])
        expect(stopped).toContain(language.saveDamageItem('character', 'a', 'unreadable-content'))
        expect(store.mutating().length).toBe(writes)
    })
})

// -- the backup choice (D2) ----------------------------------------------------------------------

describe('the backup the prompt offers is the newest complete one', () => {
    test('a newer backup missing a block is passed over for an older complete one, with no confirm', async () => {
        const store = createFakeStore({ versioned: false })
        const generation = await seed(store, tree([character('a')]))
        breakContent(store, generation, 'a')
        const h = harness({
            store,
            backups: [
                [200, await partialBackupBytes(tree([character('newer-1'), character('newer-2')]), 'newer-2')],
                [100, await backupBytes(tree([character('older-complete')]))],
            ],
        })

        const result = await loadBlockProfile(h.ctx)

        expect(result.kind === 'loaded' && chaIdsOf(result.tree)).toEqual(['older-complete'])
        expect(h.confirms, 'a complete backup needs no confirm').toEqual([])
        expect(h.chosen[0][0]).toBe(language.saveDamagedLoadBackup(new Date(100 * 100).toLocaleString()))
    })

    test('only partial backups: the newest readable one is offered after a confirm that lists what is missing', async () => {
        const store = createFakeStore({ versioned: false })
        const generation = await seed(store, tree([character('a')]))
        breakContent(store, generation, 'a')
        const h = harness({
            store,
            backups: [
                [200, await partialBackupBytes(tree([character('keep'), character('lost-in-newest')]), 'lost-in-newest')],
                [100, await partialBackupBytes(tree([character('older-keep'), character('lost-in-older')]), 'lost-in-older')],
            ],
        })

        const result = await loadBlockProfile(h.ctx)

        expect(h.confirms.length).toBe(1)
        expect(h.confirms[0]).toContain('lost-in-newest')
        expect(h.confirms[0]).not.toContain('lost-in-older')
        expect(result.kind === 'loaded' && chaIdsOf(result.tree)).toEqual(['keep'])
    })

    test('declining the partial backup stops the boot and writes nothing', async () => {
        const store = createFakeStore({ versioned: false })
        const generation = await seed(store, tree([character('a')]))
        breakContent(store, generation, 'a')
        const writes = store.mutating().length
        const h = harness({ store, confirm: false, backups: [[200, await partialBackupBytes(tree([character('keep'), character('lost')]), 'lost')]] })

        await stopText(loadBlockProfile(h.ctx))

        expect(h.confirms.length).toBe(1)
        expect(store.mutating().length).toBe(writes)
        expect(h.owner.isLive()).toBe(false)
    })
})

// -- a chosen backup that lacks a list leaves a profile the next start loads (1c-16) ----------------

describe('a chosen backup whose list block cannot be read', () => {
    test.each(['modules', 'loadouts', 'plugins'])('damage path, %s: the next start loads the profile with no damage prompt', async (list) => {
        const store = createFakeStore({ versioned: false })
        const generation = await seed(store, tree([character('a'), character('b')]))
        breakContent(store, generation, 'b')
        const first = harness({ store, backups: [[100, await partialBackupBytes(tree([character('from-backup')]), list)]] })

        const chosen = await loadBlockProfile(first.ctx)

        expect(chosen.kind === 'loaded' && chosen.how).toBe('backup')
        expect(first.confirms.length, 'the partial backup was confirmed once').toBe(1)
        const second = harness({ store })
        const reloaded = await loadBlockProfile(second.ctx)
        expect(second.notices, 'the next start shows no damage prompt').toEqual([])
        expect(reloaded.kind === 'loaded' && reloaded.how).toBe('store')
        expect(reloaded.kind === 'loaded' && chaIdsOf(reloaded.tree)).toEqual(['from-backup'])
    })

    test.each(['modules', 'loadouts', 'plugins'])('blocked seed, %s: the backup the seed offers loads on the next start with no damage prompt', async (list) => {
        const store = createFakeStore({ versioned: false })
        store.plant('database/dbbackup-100.bin', new Uint8Array([1]))
        const first = harness({ store, backups: [[100, await partialBackupBytes(tree([character('from-backup')]), list)]] })

        const seeded = await seedEmptyBlockProfile(first.ctx)

        expect(seeded.kind).toBe('backup')
        const second = harness({ store })
        const reloaded = await loadBlockProfile(second.ctx)
        expect(second.notices, 'the next start shows no damage prompt').toEqual([])
        expect(reloaded.kind === 'loaded' && reloaded.how).toBe('store')
        expect(reloaded.kind === 'loaded' && chaIdsOf(reloaded.tree)).toEqual(['from-backup'])
    })
})

// -- an unreadable head keeps every older generation (D1) --------------------------------------------

describe('an unreadable head', () => {
    test('choosing the backup keeps every older rooted generation and never the live one, and holds the sweep off', async () => {
        const store = createFakeStore({ versioned: false })
        const older = await seed(store, tree([character('a')]))
        // A second rooted generation, as an interrupted or racing replace leaves one.
        await plantRootedGeneration(store, SECOND, tree([character('b')]))
        store.plant(HEAD_KEY, GARBAGE)
        const h = harness({ store, backups: [[100, await backupBytes(tree([character('from-backup')]))]] })

        const result = await loadBlockProfile(h.ctx)

        expect(result.kind === 'loaded' && result.how).toBe('backup')
        const head = store.peek(HEAD_KEY) as Uint8Array
        const live = JSON.parse(new TextDecoder().decode(head)).current as string
        expect(store.peek(keptKey(older))).not.toBeNull()
        expect(store.peek(keptKey(SECOND))).not.toBeNull()
        expect(store.peek(keptKey(live)), 'the live generation is never marked').toBeNull()
        const inventory = await inspectGenerations(store, live)
        expect([...inventory.kept].sort()).toEqual([older, SECOND].sort())
        expect(isAssetSweepHeld()).toBe(true)
    })
})

// -- the hold and the replace ---------------------------------------------------------------------

describe('the exclusive hold for the replace', () => {
    async function damagedStore(): Promise<FakeStore> {
        const store = createFakeStore({ versioned: false })
        const generation = await seed(store, tree([character('a')]))
        breakContent(store, generation, 'a')
        return store
    }

    test('another tab being open refuses the replace: the person retries once it is closed', async () => {
        const store = await damagedStore()
        const backup = await backupBytes(tree([character('from-backup')]))
        const h = harness({
            store,
            choices: [0, 0],
            holds: [{ kind: 'refused', reloading: false }, { kind: 'held', release: async () => { } }],
            backups: [[100, backup]],
        })

        const result = await loadBlockProfile(h.ctx)

        expect(h.chosen[1], 'the retry prompt').toEqual([language.saveDamagedRetry, language.saveDamagedStop])
        expect(h.holds.length).toBe(2)
        expect(result.kind === 'loaded' && result.how).toBe('backup')
    })

    test('stopping at the other-tab prompt writes nothing', async () => {
        const store = await damagedStore()
        const writes = store.mutating().length
        const h = harness({ store, choices: [0, 1], holds: [{ kind: 'refused', reloading: false }], backups: [[100, await backupBytes(tree([character('x')]))]] })

        await stopText(loadBlockProfile(h.ctx))

        expect(store.mutating().length).toBe(writes)
    })

    test('a page that is reloading goes no further', async () => {
        const store = await damagedStore()
        const writes = store.mutating().length
        const reload = new Error('reloading')
        const h = harness({
            store,
            holds: [{ kind: 'refused', reloading: true }],
            backups: [[100, await backupBytes(tree([character('x')]))]],
            waitForReload: async () => { throw reload },
        })

        await expect(loadBlockProfile(h.ctx)).rejects.toBe(reload)
        expect(store.mutating().length).toBe(writes)
    })

    test('without Web Locks the replace is behind a confirm, and a "no" writes nothing', async () => {
        const store = await damagedStore()
        const writes = store.mutating().length
        const h = harness({ store, confirm: false, holds: [{ kind: 'unlocked', reason: 'no-web-locks' }], backups: [[100, await backupBytes(tree([character('x')]))]] })

        await stopText(loadBlockProfile(h.ctx))

        expect(h.confirms).toEqual([language.restoreNoLockWarningConfirm])
        expect(store.mutating().length).toBe(writes)
    })

    test('a single-instance page needs neither a hold nor a confirm', async () => {
        const store = await damagedStore()
        const h = harness({ store, holds: [{ kind: 'unlocked', reason: 'single-instance' }], backups: [[100, await backupBytes(tree([character('x')]))]] })

        const result = await loadBlockProfile(h.ctx)

        expect(result.kind === 'loaded' && result.how).toBe('backup')
        expect(h.confirms).toEqual([])
    })

    test('a won replace releases the fresh hold fully, with no argument', async () => {
        const store = await damagedStore()
        const releases: Array<unknown[]> = []
        const h = harness({
            store,
            holds: [{ kind: 'held', release: async (...args: unknown[]) => { releases.push(args) } } as ReplaceHold],
            backups: [[100, await backupBytes(tree([character('x')]))]],
        })

        await loadBlockProfile(h.ctx)

        expect(releases).toEqual([[]])
    })

    test('an unconfirmed replace keeps the write lock closed and asks for a reload', async () => {
        const store = await damagedStore()
        const releases: number[] = []
        const h = harness({
            store,
            holds: [{ kind: 'held', release: async () => { releases.push(1) } }],
            backups: [[100, await backupBytes(tree([character('x')]))]],
        })
        store.faults.push({ match: (op) => op.kind === 'write' && op.key === HEAD_KEY, mode: 'before' })

        const stopped = await stopText(loadBlockProfile(h.ctx))

        expect(stopped).toBe(language.saveDamagedUnconfirmed)
        expect(releases, 'the fresh hold is not given back').toEqual([])
        expect(h.owner.isClosed()).toBe(true)
    })

    test('a backup over the Node limit is refused with the limit message, the hold is released and nothing is written', async () => {
        const store = createFakeStore({ versioned: true })
        const generation = await seed(store, tree([character('a')]))
        breakContent(store, generation, 'a')
        const writes = store.mutating().length
        const releases: number[] = []
        const h = harness({
            store,
            nodeBodyLimit: 300,
            holds: [{ kind: 'held', release: async () => { releases.push(1) } }],
            backups: [[100, await backupBytes(tree([character('big', { desc: 'x'.repeat(2000) })]))]],
        })

        const stopped = await stopText(loadBlockProfile(h.ctx))

        expect(stopped).toBe(language.saveDamagedTooLarge)
        expect(releases).toEqual([1])
        expect(store.mutating().length).toBe(writes)
    })

    test('a replace that loses to a rival says so and loads again', async () => {
        const store = await damagedStore()
        const h = harness({ store, backups: [[100, await backupBytes(tree([character('mine')]))]] })
        const originalChoose = h.ui.choose
        h.ui.choose = async (title, options) => {
            const answer = await originalChoose(title, options)
            // A rival's replace flips the head while the person was choosing.
            const rival = harness({ store, backups: [[100, await backupBytes(tree([character('rival')]))]] })
            await loadBlockProfile(rival.ctx)
            return answer
        }

        const result = await loadBlockProfile(h.ctx)

        expect(result.kind === 'loaded' && chaIdsOf(result.tree)).toEqual(['rival'])
    })
})

// -- seeding an empty profile ----------------------------------------------------------------------

describe('seeding an empty profile', () => {
    test('a store with nothing in it is seeded once: the profile decodes and the owner is live', async () => {
        const h = harness()

        const seeded = await seedEmptyBlockProfile(h.ctx)

        expect(seeded.kind).toBe('installed')
        expect(h.owner.isLive()).toBe(true)
        expect(h.store.peek(HEAD_KEY)).not.toBeNull()
        expect(seeded.kind === 'installed' && seeded.leftover).toEqual([])
    })

    test('an interrupted earlier seed (keys and no head) is reported as leftover and the seed still wins', async () => {
        const store = createFakeStore({ versioned: false })
        store.plant('blocks/000000000001-00000001/f/config', new Uint8Array([1]))
        const h = harness({ store })

        const seeded = await seedEmptyBlockProfile(h.ctx)

        expect(seeded.kind === 'installed' && seeded.leftover).toEqual(['000000000001-00000001'])
        const notices = await finishBlockBoot(h.owner, store)
        expect(notices).toEqual([{ kind: 'leftover-generations', count: 1 }])
    })

    test('numbered backups with no head: the seed is blocked, and the newest backup is offered instead of an empty profile', async () => {
        const store = createFakeStore({ versioned: false })
        store.plant('database/dbbackup-100.bin', new Uint8Array([1]))
        const h = harness({ store, backups: [[100, await backupBytes(tree([character('from-backup')]))]] })

        const seeded = await seedEmptyBlockProfile(h.ctx)

        expect(seeded.kind).toBe('backup')
        expect(seeded.kind === 'backup' && chaIdsOf(seeded.tree)).toEqual(['from-backup'])
        expect(h.notices.join('\n')).toContain(language.saveSeedBlocked(['numbered-backup']))
        expect(h.owner.isLive()).toBe(true)
    })

    test('stopping at the blocked seed writes nothing', async () => {
        const store = createFakeStore({ versioned: false })
        store.plant('database/dbbackup-100.bin', new Uint8Array([1]))
        const writes = store.mutating().length
        const h = harness({ store, choices: [1], backups: [[100, await backupBytes(tree([character('x')]))]] })

        const stopped = await stopText(seedEmptyBlockProfile(h.ctx))

        expect(stopped).toBe(language.saveSeedBlocked(['numbered-backup']))
        expect(store.mutating().length).toBe(writes)
    })

    test.each([
        ['a main file', 'database/database.bin', 'main-file'],
        ['a copy of an old main file', preBlocksKey(0), 'pre-blocks'],
    ])('%s with no backup stops the boot naming what was found, and writes nothing', async (_label, key, kind) => {
        const store = createFakeStore({ versioned: false })
        store.plant(key, new Uint8Array([1]))
        const writes = store.mutating().length
        const h = harness({ store })

        const stopped = await stopText(seedEmptyBlockProfile(h.ctx))

        expect(stopped).toBe(language.saveSeedBlocked([kind]))
        expect(store.mutating().length).toBe(writes)
        expect(h.owner.isLive()).toBe(false)
    })

    test.each([
        ['no backup', false],
        ['a numbered backup', true],
    ])('a head that appeared after the boot looked (%s) means load again: no "no current save" stop, no backup prompt, no write', async (_label, withBackup) => {
        const store = createFakeStore({ versioned: false })
        const scratch = createFakeStore({ versioned: false })
        await seed(scratch, tree([character('peer')]))
        for (const peerKey of scratch.keys('blocks/')) {
            store.plant(peerKey, scratch.peek(peerKey) as Uint8Array)
        }
        if (withBackup) {
            store.plant('database/dbbackup-100.bin', new Uint8Array([1]))
        }
        const writes = store.mutating().length
        const h = harness({ store, backups: withBackup ? [[100, await backupBytes(tree([character('x')]))]] : [] })

        const seeded = await seedEmptyBlockProfile(h.ctx)

        expect(seeded.kind).toBe('load-again')
        expect(h.notices).toEqual([])
        expect(store.mutating().length).toBe(writes)
        const loaded = await loadBlockProfile(h.ctx)
        expect(loaded.kind === 'loaded' && chaIdsOf(loaded.tree)).toEqual(['peer'])
    })

    test('a seed that loses to another page loads that page\'s state', async () => {
        const store = createFakeStore({ versioned: false })
        const h = harness({ store })
        const scratch = createFakeStore({ versioned: false })
        await seed(scratch, tree([character('peer')]))
        const original = store.write
        let landed = false
        store.write = async (key, bytes, condition) => {
            // The peer's head lands after this seed's generation is written and before its flip.
            if (key.endsWith('/root') && !landed) {
                landed = true
                for (const peerKey of scratch.keys('blocks/')) {
                    store.plant(peerKey, scratch.peek(peerKey) as Uint8Array)
                }
            }
            return await original(key, bytes, condition)
        }

        const seeded = await seedEmptyBlockProfile(h.ctx)
        expect(seeded.kind).toBe('load-again')
        const loaded = await loadBlockProfile(h.ctx)

        expect(loaded.kind === 'loaded' && chaIdsOf(loaded.tree)).toEqual(['peer'])
    })

    test('a root that does not read back is tried once more and then stops the boot: never an unbounded reseed', async () => {
        const store = createFakeStore({ versioned: false })
        const h = harness({ store })
        const original = store.write
        let seededRoots = 0
        store.write = async (key, bytes, condition) => {
            const result = await original(key, bytes, condition)
            if (key.endsWith('/root')) {
                seededRoots++
                store.unplant(key)
            }
            return result
        }

        const stopped = await stopText(seedEmptyBlockProfile(h.ctx))

        expect(stopped).toBe(language.saveSeedFailed)
        expect(seededRoots).toBe(2)
        expect(store.peek(HEAD_KEY)).toBeNull()
    })

    test('an unconfirmed seed asks for a reload and writes nothing else', async () => {
        const store = createFakeStore({ versioned: false })
        const h = harness({ store })
        store.faults.push({ match: (op) => op.kind === 'write' && op.key === HEAD_KEY, mode: 'before' })

        expect(await stopText(seedEmptyBlockProfile(h.ctx))).toBe(language.saveDamagedUnconfirmed)
        expect(h.owner.isClosed()).toBe(true)
    })
})

// -- after the install -----------------------------------------------------------------------------

describe('what boot does after a block profile is installed', () => {
    test('a kept generation holds the startup asset sweep off, and is not reported as leftover', async () => {
        const store = createFakeStore({ versioned: false })
        const live = await seed(store, tree([character('a')]))
        store.plant('blocks/000000000001-00000001/root', new Uint8Array([1]))
        store.plant(keptKey('000000000001-00000001'), new TextEncoder().encode('{"kept":true}'))
        const { owner } = makeOwner(store)
        await owner.load()

        const notices = await finishBlockBoot(owner, store)

        expect(isAssetSweepHeld()).toBe(true)
        expect(notices).toEqual([])
        expect(store.peek(rootKey(live))).not.toBeNull()
    })

    test('a profile with no kept generation leaves the sweep alone', async () => {
        const store = createFakeStore({ versioned: false })
        await seed(store, tree([character('a')]))
        const { owner } = makeOwner(store)
        await owner.load()

        expect(await finishBlockBoot(owner, store)).toEqual([])
        expect(isAssetSweepHeld()).toBe(false)
    })

    test('a generation inventory that cannot be read holds the sweep off', async () => {
        const store = createFakeStore({ versioned: false })
        await seed(store, tree([character('a')]))
        const { owner } = makeOwner(store)
        await owner.load()
        store.faults.push({ match: (op) => op.kind === 'list' && op.key === 'blocks/', mode: 'before', times: 9 })

        await finishBlockBoot(owner, store)

        expect(isAssetSweepHeld()).toBe(true)
    })

    test('keeps the asset sweep held when the copy listing fails', async () => {
        const store = createFakeStore({ versioned: false })

        store.faults.push({ match: (op) => op.kind === 'list' && op.key.startsWith('database/database.pre-blocks'), mode: 'before', times: 9 })

        expect(await olderMainFileCopyExists(store)).toBe(true)
    })

    test('keeps the asset sweep held when the presence check of the main file fails', async () => {
        const store = createFakeStore({ versioned: false })
        await seed(store, tree([character('a')]))
        store.faults.push({ match: (op) => op.kind === 'has' && op.key === 'database/database.bin', mode: 'before', times: 9 })

        expect(await olderMainFileCopyExists(store)).toBe(true)
    })

    test('holds the asset sweep while a block profile still has its legacy main file, and releases it once the file is gone', async () => {
        const store = createFakeStore({ versioned: false })
        await seed(store, tree([character('a')]))
        store.plant('database/database.bin', new Uint8Array([9, 9, 9]))

        expect(await olderMainFileCopyExists(store)).toBe(true)

        await store.delete('database/database.bin', 'unconditional')

        expect(await olderMainFileCopyExists(store)).toBe(false)
    })

    test('guard: a legacy profile with no block head is not held by its own main file', async () => {
        const store = createFakeStore({ versioned: false })
        store.plant('database/database.bin', new Uint8Array([9, 9, 9]))

        expect(await olderMainFileCopyExists(store)).toBe(false)
    })

    test('the converted main file is moved aside as the head names it, and left alone when it is not the converted one', async () => {
        const store = createFakeStore({ versioned: false })
        const main = encodeRisuSaveLegacy({ characters: [] }, 'noCompression')
        store.plant('database/database.bin', main)
        const { owner } = makeOwner(store)
        const won = await owner.replaceWholeState(await treeToBlockSet(tree([character('a')])), { requireAbsentHead: true, convertedFrom: fingerprintMainFile(main) })
        expect(won.kind).toBe('won')

        await finishBlockBoot(owner, store)

        expect(store.peek('database/database.bin')).toBeNull()
        expect(store.peek(preBlocksKey(0))).not.toBeNull()

        const newer = new Uint8Array([9, 9, 9])
        store.plant('database/database.bin', newer)
        await finishBlockBoot(owner, store)
        expect(Array.from(store.peek('database/database.bin') ?? [])).toEqual([9, 9, 9])
    })
})

describe('layoutFileBytes', () => {
    test('is the file a legacy decoder reads: the header and every block in order', async () => {
        const set = await treeToBlockSet(tree([character('a')]))
        const file = layoutFileBytes(set.layout)
        expect(file.length).toBe(9 + set.layout.blocks.reduce((sum, block) => sum + block.length, 0))
        expect(new TextDecoder().decode(file.subarray(0, 8))).toBe('RISUSAVE')
    })
})

