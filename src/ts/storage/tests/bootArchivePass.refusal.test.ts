/**
 * The boot archive pass, refusal before writing
 * (`src/ts/storage/bootArchivePass.ts`): a tree whose commit would fail on
 * every boot is detected before any unit is written, so the pass writes
 * nothing, encodes nothing, never touches the main file and posts no notice.
 *
 * Each fixture is handed to the pass directly, as the tree a strict decode
 * would have produced; a tree like these cannot always be built by encoding it
 * with `RisuSaveEncoder` and decoding the result. The real `RisuSaveEncoder`
 * and `decodeRisuSave` are used for the commit and for reading it back; the
 * web units go to an in-memory OPFS directory and the Node server is
 * `FakeNodeServer` (see `bootArchivePassHarness.ts`). These tests exercise the
 * pass against those in-memory models; they say nothing about the Tauri file
 * system, the real Node server, or a browser's OPFS.
 *
 * Tests titled `guard:` assert behaviour the refusal must not take away; they
 * pass with and without the refusal. The others assert behaviour only the
 * refusal has.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    archiveMemoKeysWritten,
    baseTree,
    charactersOf,
    chaIdsOf,
    currentStub,
    directWorld,
    fullCharacter,
    runDirect,
    installedTree,
    type World,
    type RemoteLike,
    type WorldHost,
    type WorldKit,
} from './bootArchivePassHarness'

const h = vi.hoisted(() => ({
    platform: { isTauri: false, isNodeServer: false },
    db: {} as Record<string, unknown>,
    remote: null as RemoteLike | null,
    keyPair: null as CryptoKeyPair | null,
}))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => { }),
            removeItem: vi.fn(async () => { }),
        }),
    },
}))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return h.platform.isTauri },
    get isNodeServer() { return h.platform.isNodeServer },
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => h.db),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: {
        getItem: (key: string) => (h.remote as RemoteLike).getItem(key),
        setItem: (key: string, value: Uint8Array) => (h.remote as RemoteLike).setItem(key, value),
        keys: () => (h.remote as RemoteLike).keys(),
    },
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

vi.mock(import('src/ts/util'), () => ({
    base64url: (source: Uint8Array | ArrayBuffer) => Buffer.from(source as Uint8Array).toString('base64url'),
    getKeypairStore: vi.fn(async () => {
        h.keyPair ??= await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
        return h.keyPair
    }),
    saveKeypairStore: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
    alertInput: vi.fn(),
    waitAlert: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/alert'))

import { RisuSaveEncoder, decodeRisuSave } from 'src/ts/storage/risuSave'
import { NodeStorage } from 'src/ts/storage/nodeStorage'
import { openBootArchiveSession } from 'src/ts/storage/bootArchivePass'

const kit: WorldKit = {
    Encoder: RisuSaveEncoder,
    decodeRisuSave: decodeRisuSave as WorldKit['decodeRisuSave'],
    openBootArchiveSession,
    NodeStorage: NodeStorage as unknown as WorldKit['NodeStorage'],
    setRemote: (remote) => { h.remote = remote },
}

function useHost(host: WorldHost): void {
    h.platform.isNodeServer = host === 'node'
    h.platform.isTauri = host === 'tauri'
}

beforeEach(() => {
    localStorage.clear()
    h.platform.isNodeServer = false
    h.platform.isTauri = false
    h.db = {}
    h.remote = null
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

const UNIT = '11111111-2222-4333-8444-555555555555'

/** A text no log line may repeat: the pass names the reason it refused, never what the character holds. */
const SECRET = 'Secret Marker'

/** A character with an id the type does not allow, as a damaged or hand-edited save can hold. */
function withId(chaId: unknown, extra: Record<string, unknown> = {}) {
    // The chat id differs from every other fixture's, so the id repair has nothing to warn about.
    const chats = [{ id: `bad-chat-${typeof chaId}-${String(chaId)}`, message: [{ time: 1, data: 'hello', role: 'char' }], note: '', name: '', localLore: [] }]
    return fullCharacter(chaId as string, SECRET, { desc: `${SECRET} description`, chats, ...extra })
}

/** How many slots of `tree` are archived stubs. */
function stubCount(tree: ReturnType<typeof baseTree>): number {
    return charactersOf(tree).filter((c) => !!c.coldstorage).length
}

const FIXED_BLOCK_NAMES = ['root', 'preset', 'modules', 'loadouts', 'plugins', 'pluginStorage', 'config']

type Fixture = [label: string, make: () => ReturnType<typeof baseTree>]

const REFUSED: Fixture[] = [
    ...FIXED_BLOCK_NAMES.map((name): Fixture => [`a slot whose chaId is the fixed block name "${name}"`, () => baseTree([fullCharacter('ok', 'Ok'), withId(name)])]),
    ['a slot whose number chaId equals another slot\'s string chaId', () => baseTree([fullCharacter('ok', 'Ok'), withId(5), fullCharacter('5', 'Five')])],
    ['a slot whose number chaId equals the chaId of a stub', () => baseTree([fullCharacter('ok', 'Ok'), withId(7), currentStub('7', 'Seven', UNIT)])],
    ['a slot whose chaId is __proto__', () => baseTree([fullCharacter('ok', 'Ok'), withId('__proto__')])],
    ['a slot whose chaId is 256 bytes in UTF-8', () => baseTree([fullCharacter('ok', 'Ok'), withId('a'.repeat(256))])],
    ['a slot whose chaId is 258 bytes in UTF-8 and 86 characters', () => baseTree([fullCharacter('ok', 'Ok'), withId('一'.repeat(86))])],
    ['a slot whose chaId holds a lone surrogate', () => baseTree([fullCharacter('ok', 'Ok'), withId('ab\ud800cd')])],
    ['a modules container that is not an array', () => baseTree([fullCharacter('ok', 'Ok')], { modules: {} })],
    ['a plugins container that is not an array', () => baseTree([fullCharacter('ok', 'Ok')], { plugins: {} })],
    ['a loadouts container that is not an array', () => baseTree([fullCharacter('ok', 'Ok')], { loadouts: {} })],
]

/** Nothing was written, encoded or read, and the tree is installed as the boot decoded it, without the key and with no new stub. */
function expectRefused(world: World, outcome: Awaited<ReturnType<typeof runDirect>>, stubsBefore: number) {
    expect(world.units.attempts, 'unit writes attempted').toBe(0)
    expect(world.units.writes.length).toBe(0)
    expect(world.mainLog.filter((e) => e === 'reread'), 'main-file re-reads').toEqual([])
    expect(world.mainLog.filter((e) => e === 'write'), 'main-file writes').toEqual([])
    expect(world.mainWrites.length).toBe(0)
    expect(world.encoderCalls, 'encoders created').toBe(0)
    expect(outcome.kind).toBe('install')
    if (outcome.kind === 'install') {
        expect(outcome.notices).toEqual([])
        expect(outcome.noteBytes).toBeNull()
        expect(outcome.tree).not.toHaveProperty('archiveCharacters')
        expect(charactersOf(outcome.tree).filter((c) => !!c.coldstorage).length, 'archived slots in the installed tree').toBe(stubsBefore)
    }
    expect(archiveMemoKeysWritten()).toEqual([])
}

describe('boot archive pass: a tree whose commit would fail is refused before any unit is written', () => {
    test.each(REFUSED)('refuses %s', async (_label, make) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { })
        useHost('opfs')
        const world = await directWorld(kit, 'opfs')

        const tree = make()
        const stubsBefore = stubCount(tree)

        const outcome = await runDirect(world, tree)

        expectRefused(world, outcome, stubsBefore)
        expect(warn).toHaveBeenCalledTimes(1)
        expect(JSON.stringify(warn.mock.calls)).not.toContain(SECRET)
    })

    test('refuses a fixed block name on the Node server the same way, with no unit written and no request to re-read or write the main file', async () => {
        useHost('node')
        const world = await directWorld(kit, 'node')
        vi.spyOn(console, 'warn').mockImplementation(() => { })

        const outcome = await runDirect(world, baseTree([fullCharacter('ok', 'Ok'), withId('root')]))

        expectRefused(world, outcome, 0)
        expect(world.server?.keysWithPrefix('coldstorage/')).toEqual([])
    })

    test.each([
        ['a trashed slot whose chaId is the fixed block name "root"', () => baseTree([fullCharacter('ok', 'Ok'), withId('root', { trashTime: 1 })])],
        ['an archived slot whose chaId is the fixed block name "config"', () => baseTree([fullCharacter('ok', 'Ok'), currentStub('config', 'Archived Config', UNIT)])],
        ['a trashed slot whose number chaId equals a live slot\'s string chaId', () => baseTree([fullCharacter('ok', 'Ok'), fullCharacter('9', 'Nine'), withId(9, { trashTime: 1 })])],
    ] as [string, () => ReturnType<typeof baseTree>][])('refuses %s although another character could be archived', async (_label, make) => {
        vi.spyOn(console, 'warn').mockImplementation(() => { })
        useHost('opfs')
        const world = await directWorld(kit, 'opfs')

        const tree = make()
        const stubsBefore = stubCount(tree)

        const outcome = await runDirect(world, tree)

        expectRefused(world, outcome, stubsBefore)
    })
})

describe('boot archive pass: ids the refusal leaves alone', () => {
    test('guard: duplicate string chaIds are repaired and both holders are archived, not refused', async () => {
        useHost('opfs')
        const world = await directWorld(kit, 'opfs')
        vi.spyOn(console, 'warn').mockImplementation(() => { })

        const outcome = await runDirect(world, baseTree([fullCharacter('dup', 'First'), fullCharacter('dup', 'Second')]))

        const slots = charactersOf(installedTree(outcome))
        expect(slots.every((c) => !!c.coldstorage)).toBe(true)
        expect(new Set(slots.map((c) => c.chaId)).size).toBe(2)
        expect(world.units.attempts).toBe(2)
        expect(world.mainWrites.length).toBe(1)
    })

    test('guard: a chaId that is an Object.prototype name other than __proto__ is archived and committed', async () => {
        useHost('opfs')
        const world = await directWorld(kit, 'opfs')

        const outcome = await runDirect(world, baseTree([fullCharacter('ok', 'Ok'), fullCharacter('constructor', 'Constructor')]))

        expect(charactersOf(installedTree(outcome)).map((c) => !!c.coldstorage)).toEqual([true, true])
        expect(world.units.attempts).toBe(2)
        expect(world.mainWrites.length).toBe(1)
        const committed = await decodeRisuSave(world.mainWrites[0], { strict: true })
        expect(chaIdsOf(committed).sort()).toEqual(['constructor', 'ok'])
    })

    test('guard: a chaId of exactly 255 UTF-8 bytes is archived and committed', async () => {
        useHost('opfs')
        const world = await directWorld(kit, 'opfs')
        const longId = 'a'.repeat(255)

        const outcome = await runDirect(world, baseTree([fullCharacter('ok', 'Ok'), fullCharacter(longId, 'Long')]))

        expect(charactersOf(installedTree(outcome)).map((c) => !!c.coldstorage)).toEqual([true, true])
        expect(world.mainWrites.length).toBe(1)
        const committed = await decodeRisuSave(world.mainWrites[0], { strict: true })
        expect(chaIdsOf(committed).sort()).toEqual(['a'.repeat(255), 'ok'].sort())
    })
})
