/**
 * CHORE-01:
 *
 * Table-driven over every MUTATING risuaccess character tool, driven through
 * the REAL `RisuAccessClient.callTool` (`client.ts`), the REAL
 * `CharacterHandler` (`characters.ts`), the REAL `getCharacterForWrite`
 * (`utils.ts`), and the REAL `characterSaveMarks.ts` / `RisuSaveEncoder`
 * (encode -> decode round trip, since the table says "persisted"). The user's
 * approval is asked by the gate (`authorizeToolCall`, run by `callMCPTool`
 * before the client), never by a handler -- these tests resolve that approval
 * AFTER a "save" (tracker trim) has already run, proving the mark (made in
 * `callTool`'s `finally`, after the handler settles) survives into the NEXT
 * save rather than being silently dropped by a save that raced the pending
 * approval. A save that runs while the approval is pending is the invariant.
 *
 * The last test enumerates `CharacterHandler.getTools()` (the real registry)
 * and spies on the real, unmodified `getCharacterForWrite` to CLASSIFY, by
 * actual runtime behaviour (not by name-guessing), which registered tools
 * are mutating -- then asserts that set equals exactly the ones exercised
 * above, so a new mutating tool added later without updating this table
 * fails this test (plan rule 3).
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'

//#region module mocks -- matches the working mock set already proven for
// this exact import graph in modules.test.ts (katex/lite suppression,
// alert, stores.svelte), plus the storage-side mocks needed to also drive a
// real RisuSaveEncoder round trip.

vi.mock(import('katex'), () => ({}))
vi.mock(import('src/ts/lite'), () => ({}))

const alertConfirmMock = vi.hoisted(() => vi.fn(async () => true))

vi.mock(import('src/ts/alert'), () => ({
    alertConfirm: alertConfirmMock,
}))

// Matches modules.test.ts's own (already-proven) minimal mock set for this
// exact import graph (CharacterHandler/ChatHandler/ModuleHandler all reach
// src/ts/util.ts -> src/ts/characters.ts -> src/ts/globalApi.svelte ->
// src/ts/storage/database.svelte for real) -- deliberately NOT mocking
// globalApi.svelte or storage/database.svelte here, since a PARTIAL mock of
// either breaks other real modules in that chain that expect either the
// full real thing or nothing (verified: a partial globalApi.svelte mock
// broke src/ts/media/avatarThumb.ts's top-level `readImage` reference).
// `selIdState` (missing from a first draft of this mock) is required by
// src/ts/parser/parser.svelte.ts's own module-level `$effect.root`, reached
// transitively through the same chain.
vi.mock(import('src/ts/stores.svelte'), () => {
    return {
        DBState: {
            db: {
                characters: [],
            },
        },
        selIdState: {
            selId: 0,
        },
    } as unknown as typeof import('src/ts/stores.svelte')
})

const memStore = new Map<string, unknown>()

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async (key: string) => memStore.get(key) ?? null),
            setItem: vi.fn(async (key: string, value: unknown) => {
                memStore.set(key, value)
            }),
            removeItem: vi.fn(async (key: string) => {
                memStore.delete(key)
            }),
        }),
    },
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

//#endregion

import { DBState } from 'src/ts/stores.svelte'
import { RisuAccessClient } from '../client'
import { CharacterHandler } from '../characters'
import { RisuSaveEncoder, decodeRisuSave } from 'src/ts/storage/risuSave'
import type { Database } from 'src/ts/storage/database.svelte'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import { authorizeToolCall } from '../../toolAuthorize'

//#region fixtures

type CharacterFixture = Database['characters'][number]

function makeCharacter(chaId: string, name: string): CharacterFixture {
    return {
        chaId,
        name,
        type: 'character',
        chatPage: 0,
        chats: [{ id: `${chaId}-chat-0`, message: [], note: '', name: '', localLore: [] }],
        globalLore: [],
        customscript: [],
        additionalAssets: [],
        triggerscript: [{ comment: '', type: 'manual', conditions: [], effect: [{ type: 'triggerlua', code: '' }] }],
    } as unknown as CharacterFixture
}

function installDb(): Database {
    const db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: ['char-0', 'char-1'],
        characters: [
            makeCharacter('char-0', 'Character Zero (selected)'),
            makeCharacter('char-1', 'Character One (target, not selected)'),
        ],
    } as unknown as Database
    DBState.db = db
    return db
}

function makeTracker(): toSaveType {
    return {
        character: [],
        chat: [],
        botPreset: false,
        modules: false,
        loadouts: false,
        plugins: false,
        pluginCustomStorage: false,
    }
}

function deferred<T>() {
    let resolve!: (v: T) => void
    const promise = new Promise<T>((res) => { resolve = res })
    return { promise, resolve }
}

/** Runs a tool call the way `callMCPTool` does: the gate decides first, then the client runs the tool. */
async function callGated(client: RisuAccessClient, name: string, args: Record<string, unknown>) {
    const refusal = await authorizeToolCall(name, args, { mcpURL: 'internal:risuai' })
    return refusal ?? await client.callTool(name, args)
}

beforeEach(() => {
    resetCharacterSaveMarksForTest()
    alertConfirmMock.mockReset()
})

//#endregion

// Each row: [toolName, args-builder(targeting char-1), assertion on the
// decoded char-1 after the round trip].
const mutatingToolCases: {
    name: string
    args: Record<string, unknown>
    assertMutated: (char: CharacterFixture) => void
}[] = [
    {
        name: 'risu-set-character-info',
        args: { id: 'char-1', data: { name: 'Renamed by tool' } },
        assertMutated: (char) => expect(char.name).toBe('Renamed by tool'),
    },
    {
        name: 'risu-set-character-lorebook',
        args: { id: 'char-1', name: 'entry1', content: 'lore content', keys: ['k'] },
        assertMutated: (char) => expect((char as any).globalLore?.[0]?.content).toBe('lore content'),
    },
    {
        name: 'risu-delete-character-lorebook',
        args: { id: 'char-1', name: 'entry1' },
        assertMutated: (char) => expect((char as any).globalLore ?? []).toHaveLength(0),
    },
    {
        name: 'risu-set-character-regex-scripts',
        args: { id: 'char-1', name: 'script1', in: 'foo', out: 'bar' },
        assertMutated: (char) => expect((char as any).customscript?.[0]?.out).toBe('bar'),
    },
    {
        name: 'risu-delete-character-regex-scripts',
        args: { id: 'char-1', name: 'script1' },
        assertMutated: (char) => expect((char as any).customscript ?? []).toHaveLength(0),
    },
    {
        name: 'risu-set-character-lua-script',
        args: { id: 'char-1', code: 'print("new")' },
        assertMutated: (char) => expect((char as any).triggerscript?.[0]?.effect?.[0]?.code).toBe('print("new")'),
    },
    {
        name: 'risu-delete-character-additional-assets',
        args: { id: 'char-1', assetName: 'asset1' },
        assertMutated: (char) => expect((char as any).additionalAssets ?? []).toHaveLength(0),
    },
]

describe('risuaccess mutating character tools', () => {
    for (const toolCase of mutatingToolCases) {
        test(`${toolCase.name}: a mark made AFTER a pending approval resolves survives a save that raced it, and is persisted`, async () => {
            const db = installDb()
            // Pre-seed state so "delete" tools have something to delete.
            if (toolCase.name === 'risu-delete-character-lorebook') {
                (db.characters[1] as any).globalLore = [{ comment: 'entry1', content: 'x', key: '', alwaysActive: false, secondkey: '', selective: false, insertorder: 100, mode: 'normal' }]
            }
            if (toolCase.name === 'risu-delete-character-regex-scripts') {
                (db.characters[1] as any).customscript = [{ comment: 'script1', in: 'x', out: 'y', type: 'editdisplay', flag: '', ableFlag: true }]
            }
            if (toolCase.name === 'risu-delete-character-additional-assets') {
                (db.characters[1] as any).additionalAssets = [['asset1', 'path', 'ext']]
            }

            const tracker = makeTracker()
            installCharacterSaveMarks({ tracker, schedule: () => {} })

            const encoder = new RisuSaveEncoder()
            await encoder.init(structuredClone(db) as Database, { compression: false })
            // Mirrors saveDb()'s post-init trim -- nothing marked yet.
            tracker.character = []

            const client = new RisuAccessClient()
            const gate = deferred<boolean>()
            alertConfirmMock.mockImplementationOnce(() => gate.promise)

            const callPromise = callGated(client, toolCase.name, toolCase.args)

            // A save runs WHILE the approval is still pending -- the mutation
            // (and the mark) haven't happened yet. This is the race the F4
            // fix specifically guards: marking only BEFORE the mutation would
            // not survive this trim.
            const raceToSave = structuredClone(tracker) as toSaveType
            tracker.character = tracker.character.length === 0 ? [] : [tracker.character[0]]
            expect(raceToSave.character).not.toContain('char-1') // nothing to mark yet -- handler hasn't run

            gate.resolve(true)
            await callPromise
            expect(alertConfirmMock).toHaveBeenCalledTimes(1)

            // THE MARK -- made in callTool's finally, AFTER the handler (and
            // its mutation) settled, so it lands in the tracker AFTER the
            // race-window trim above, not lost by it.
            expect(tracker.character).toContain('char-1')

            const toSave = structuredClone(tracker) as toSaveType
            await encoder.set(structuredClone(DBState.db) as Database, toSave)
            const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
            const decodedChar1 = decoded.characters?.find((c: CharacterFixture) => c.chaId === 'char-1')
            expect(decodedChar1).toBeTruthy()
            toolCase.assertMutated(decodedChar1!)
        })
    }

    test('two overlapping calls on different characters both persist (per-call context, no cross-clobbering, F4)', async () => {
        const db = installDb()
        const tracker = makeTracker()
        installCharacterSaveMarks({ tracker, schedule: () => {} })

        const encoder = new RisuSaveEncoder()
        await encoder.init(structuredClone(db) as Database, { compression: false })
        tracker.character = []

        const client = new RisuAccessClient()
        const gateA = deferred<boolean>()
        const gateB = deferred<boolean>()
        alertConfirmMock.mockImplementationOnce(() => gateA.promise)
        alertConfirmMock.mockImplementationOnce(() => gateB.promise)

        const callA = callGated(client, 'risu-set-character-info', { id: 'char-0', data: { name: 'A edited' } })
        const callB = callGated(client, 'risu-set-character-info', { id: 'char-1', data: { name: 'B edited' } })

        // Resolve B first, then A -- overlapping, out of order.
        gateB.resolve(true)
        await callB
        expect(tracker.character).toContain('char-1')
        expect(tracker.character).not.toContain('char-0') // A hasn't settled yet

        gateA.resolve(true)
        await callA
        expect(tracker.character).toContain('char-0')
        expect(tracker.character).toContain('char-1') // still present -- B's mark wasn't clobbered by A's call

        const toSave = structuredClone(tracker) as toSaveType
        await encoder.set(structuredClone(DBState.db) as Database, toSave)
        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        expect(decoded.characters?.find((c: CharacterFixture) => c.chaId === 'char-0')?.name).toBe('A edited')
        expect(decoded.characters?.find((c: CharacterFixture) => c.chaId === 'char-1')?.name).toBe('B edited')
    })

    /**
     * Classifies "mutating" by actually DIFFING char-1's data before/after
     * each registered tool call, independent of which internal helper the
     * tool happens to use -- a tool that writes to a character through some
     * other path than `getCharacterForWrite` (a bug, or a future helper)
     * must still be caught here. Every tool that DOES mutate must also leave
     * a save mark; an unmarked mutation is exactly the data-loss bug this
     * whole file exists to catch.
     */
    test('every registered tool that actually mutates a non-selected character\'s data (detected by diffing state, not by which internal helper it calls) is in the table above and marks the character it wrote', async () => {
        alertConfirmMock.mockImplementation(async () => true)

        const client = new RisuAccessClient()
        const registeredTools = new CharacterHandler().getTools()

        const actuallyWriting = new Set<string>()
        const wroteWithoutMarking: string[] = []

        for (const tool of registeredTools) {
            // Fresh db for every tool -- one tool's mutation (or a thrown
            // error on bad probe args) can never bleed into the next tool's
            // before/after diff.
            const freshDb = installDb()
            const knownCase = mutatingToolCases.find((c) => c.name === tool.name)

            // Recreate each ALREADY-COVERED tool's own pre-seed from the
            // table-driven tests above -- delete/rename tools need something
            // real to delete/rename before they can register a genuine
            // change; without this they'd no-op on empty data and be
            // (wrongly) classified as non-mutating.
            if (tool.name === 'risu-delete-character-lorebook') {
                (freshDb.characters[1] as any).globalLore = [{ comment: 'entry1', content: 'x', key: '', alwaysActive: false, secondkey: '', selective: false, insertorder: 100, mode: 'normal' }]
            }
            if (tool.name === 'risu-delete-character-regex-scripts') {
                (freshDb.characters[1] as any).customscript = [{ comment: 'script1', in: 'x', out: 'y', type: 'editdisplay', flag: '', ableFlag: true }]
            }
            if (tool.name === 'risu-delete-character-additional-assets') {
                (freshDb.characters[1] as any).additionalAssets = [['asset1', 'path', 'ext']]
            }

            const before = structuredClone(freshDb.characters[1])

            const tracker = makeTracker()
            installCharacterSaveMarks({ tracker, schedule: () => {} })

            // A tool already covered by the table above gets its OWN
            // known-good args (so it reliably registers a real change); an
            // uncovered tool (e.g. a new one added later, which this test
            // doesn't know the shape of) gets generic minimal args as a
            // best-effort probe -- matching every covered handler's actual
            // first-required-field set (id/name/code/assetName/data).
            const args = knownCase ? knownCase.args : { id: 'char-1', name: 'probe', code: 'x', assetName: 'probe', data: {} }

            try {
                await client.callTool(tool.name, args)
            } catch (error) {
                // A tool that throws on this probe's args never reaches a
                // write -- treated as non-mutating for this probe.
            }

            const after = DBState.db.characters.find((c: CharacterFixture) => c.chaId === 'char-1')
            const changed = JSON.stringify(before) !== JSON.stringify(after)

            if (changed) {
                actuallyWriting.add(tool.name)
                if (!tracker.character.includes('char-1')) {
                    wroteWithoutMarking.push(tool.name)
                }
            }

            resetCharacterSaveMarksForTest()
        }

        // Every tool that actually mutated char-1's data must also have
        // marked it -- an unmarked write is real data loss, independent of
        // whether the table above already knew about this tool.
        expect(wroteWithoutMarking).toEqual([])
        // The client alone asks nothing: approval belongs to the gate.
        expect(alertConfirmMock).not.toHaveBeenCalled()

        const expectedWriting = new Set(mutatingToolCases.map((c) => c.name))
        expect(actuallyWriting).toEqual(expectedWriting)
    })
})
