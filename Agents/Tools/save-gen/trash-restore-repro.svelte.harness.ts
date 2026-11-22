/**
 * Empirical reproduction for the claim: "Restore a character from trash,
 * don't open it, close the app -- it comes back on next load."
 *
 * ALLEGED MECHANISM (verified against source before this harness was
 * written -- all three references below were read and confirmed to say
 * exactly what the claim says, not assumed):
 *
 *   1. src/ts/storage/dbChangeEffects.svelte.ts's effect 6 (the generic
 *      per-key loop, :93-122) deep-reads ONLY
 *      DBState.db.characters[selIdState] -- the SELECTED character -- and
 *      excludes 'characters' from its own generic per-key loop (:96-98).
 *      opts.tracker.character is written only inside the
 *      `if (DBState?.db?.characters?.[selIdState])` branch (:110-112),
 *      gated on that same selected index.
 *
 *   2. src/lib/Others/GridCatalog.svelte:141-147 restores a trashed
 *      character by index-by-id, NOT by selection:
 *
 *          const restoreIdx = findCharacterIndexbyId(char.chaId)
 *          if (restoreIdx !== -1) {
 *              DBState.db.characters[restoreIdx].trashTime = undefined
 *              checkCharOrder()
 *          }
 *
 *      checkCharOrder() (src/ts/globalApi.svelte.ts:1664+) mutates only
 *      DBState.db.characterOrder (pushes the now-untrashed chaId if it is
 *      not already present).
 *
 *   3. db.characterOrder IS one of the generic keys deep-read by effect 6's
 *      per-key loop, so a save cycle fires (tracker gets marked dirty). But
 *      the restored character's chaId was never selected, so it never
 *      enters opts.tracker.character. src/ts/storage/risuSave.ts's
 *      RisuSaveEncoder.set() (:284-308) then hits, for that character,
 *      `else if(!this.blocks[character.chaId])` at :298 -- a block already
 *      exists from init() -- so the STALE cached block (still carrying
 *      trashTime) is reused verbatim rather than being re-encoded from the
 *      live (restored) object.
 *
 * This harness drives the REAL registerDbChangeEffects() and the REAL
 * RisuSaveEncoder end to end -- not reimplementations -- to see whether
 * that chain actually produces a stale on-disk trashTime, or whether some
 * untraced mechanism (e.g. a different effect also covering `characters`,
 * or set()'s directory rebuild) saves the day. Source-tracing has been
 * wrong before in this campaign; this is the empirical check.
 *
 * WHY THIS FILE IS NAMED `*.svelte.harness.ts`, not plain `*.harness.ts`
 * with a `.svelte.ts` sibling (the pattern the other benches in this
 * directory use): this reproduction needs `$state`/`$state.snapshot`
 * (to build the reactive DBState mock and to snapshot it for the encoder)
 * AND a `vi.mock(import('.../stores.svelte'), factory)` whose factory must
 * itself construct that `$state` object. Runes only compile inside files
 * matched by vite-plugin-svelte's `.svelte.` module-infix rule (see
 * node_modules/@sveltejs/vite-plugin-svelte/src/utils/id.js's
 * `buildModuleIdFilter` -- any filename containing the literal substring
 * `.svelte.` before a recognized extension, which is also why
 * src/ts/storage/tests/dbChangeEffects.svelte.test.ts can use `$state`
 * directly despite also being a `.test.ts` file). Splitting the mock
 * factory and the rune-touching helpers into a separate `.svelte.ts`
 * sibling (as module-effect-overhead-bench.harness.ts does) was tried
 * first and produced two unhandled exceptions from REAL, unmocked
 * src/ts/stores.svelte.ts and src/ts/parser/parser.svelte.ts -- both also
 * `.svelte.` infix files -- executing their own top-level `$effect.root`
 * blocks against the deliberately-thin mocks in this file. A same-file,
 * self-contained diagnostic proved this was specifically caused by
 * splitting the `vi.mock` factory across files (with a dynamic
 * `import()` inside it to reach the rune-touching helper), not by
 * anything about the `stores.svelte` mock's content, this file's other
 * mocks, or the risuSave.ts import graph -- all of which were tested
 * independently and ruled out. Keeping the factory and every rune call in
 * this one `.svelte.harness.ts` file (still ending in `.harness.ts`, so
 * `pnpm test`'s default discovery glob still never matches it -- see
 * Agents/Tools/README.md) reproduces cleanly with zero unhandled errors.
 *
 * Run:
 *   npx vitest run --config Agents/Tools/vitest.harness.config.ts Agents/Tools/save-gen/trash-restore-repro.svelte.harness.ts --reporter=verbose
 *
 * Read-only w.r.t. src/ -- this file drives the real modules, it does not
 * modify them.
 */
import { flushSync } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi } from 'vitest'
import type { Database } from '../../../src/ts/storage/database.svelte'
import type { toSaveType } from '../../../src/ts/storage/risuSave'

//#region module mocks

const store = new Map<string, unknown>()

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async (key: string) => store.get(key) ?? null),
            setItem: vi.fn(async (key: string, value: unknown) => {
                store.set(key, value)
            }),
            removeItem: vi.fn(async (key: string) => {
                store.delete(key)
            }),
        }),
    },
}))

vi.mock(
    import('src/ts/globalApi.svelte'),
    () =>
        ({
            forageStorage: {
                keys: vi.fn(async () => []),
                getItem: vi.fn(async () => null),
                setItem: vi.fn(async () => {}),
            },
        }) as unknown as typeof import('src/ts/globalApi.svelte'),
)

vi.mock(
    import('src/ts/storage/database.svelte'),
    () =>
        ({
            getDatabase: vi.fn(() => {
                throw new Error('no live database in tests')
            }),
            presetTemplate: { name: 'test-preset' },
        }) as unknown as typeof import('src/ts/storage/database.svelte'),
)

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

// dbChangeEffects.svelte.ts reaches into DBState/selectedCharID from
// stores.svelte, which transitively re-exports (via process/modules and
// globalApi.svelte) the app's whole dependency graph -- Tauri plugins, AI
// providers, drive sync, etc. Replace it with a minimal stand-in that is
// still genuinely reactive ($state-backed), identical in shape to
// dbChangeEffects.svelte.test.ts's own mock. The factory constructs the
// `$state` object directly (no cross-file dynamic import) -- see the
// file-header note above for why that matters here.
vi.mock(import('../../../src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
    } as typeof import('../../../src/ts/stores.svelte')
})

//#endregion

import { DBState, selectedCharID } from '../../../src/ts/stores.svelte'
import { registerDbChangeEffects } from '../../../src/ts/storage/dbChangeEffects.svelte'
import { decodeRisuSave } from '../../../src/ts/storage/risuSave'
import { RisuSaveEncoder } from '../../../src/ts/storage/tests/risuSaveEncoder'

//#region fixture helpers

type CharacterFixture = Database['characters'][number]

function makeCharacter(chaId: string, name: string, trashTime?: number): CharacterFixture {
    return {
        chaId,
        name,
        type: 'character',
        chatPage: 0,
        chats: [{ id: `${chaId}-chat-0`, message: [], note: '', name: '', localLore: [] }],
        trashTime,
    } as unknown as CharacterFixture
}

function installDb(): void {
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: ['char-A', 'char-B'],
        characters: [
            makeCharacter('char-A', 'Character A'),
            makeCharacter('char-B', 'Character B (starts trashed)', 1_700_000_000_000),
        ],
    } as unknown as Database
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

/**
 * Mirrors checkCharOrder()'s only externally-visible effect for this
 * scenario (src/ts/globalApi.svelte.ts:1664+): it mutates
 * DBState.db.characterOrder. char-B is already present in characterOrder
 * from installDb() (mirroring the common real-world case where a
 * since-trashed character was never removed from characterOrder), so the
 * real function's own push-if-absent logic would be a no-op on the ARRAY
 * CONTENTS here -- but checkCharOrder() still touches
 * DBState.db.characterOrder itself while doing so (reading and
 * potentially reassigning it), which is what actually flips the generic
 * per-key effect (dbChangeEffects.svelte.ts:96-101): it deep-reads
 * `characterOrder` via `$state.snapshot`, and a NEW array reference is
 * what that effect observes as a change. Reassigning to a fresh array with
 * identical contents reproduces exactly that half of the mechanism without
 * re-implementing checkCharOrder() line for line.
 */
function simulateCheckCharOrderTouch(): void {
    DBState.db.characterOrder = [...DBState.db.characterOrder]
}

function findCharacterIndexbyId(chaId: string): number {
    return DBState.db.characters.findIndex((c) => c.chaId === chaId)
}

function flush(): void {
    flushSync()
}

function snapshotDb(db: Database): Database {
    return $state.snapshot(db) as Database
}

//#endregion

describe('Trash-restore data-loss claim: end-to-end reproduction', () => {
    test('restoring a non-selected character from trash, then saving, does or does not persist the restore', async () => {
        const lines: string[] = []
        const log = (line: string) => lines.push(line)

        // --- Step 1: build a DB with 2 characters, B starts trashed. ---
        installDb()
        const indexA = findCharacterIndexbyId('char-A')
        const indexB = findCharacterIndexbyId('char-B')
        log(`step1: char-A index=${indexA} trashTime=${DBState.db.characters[indexA].trashTime}`)
        log(`step1: char-B index=${indexB} trashTime=${DBState.db.characters[indexB].trashTime}`)
        expect(DBState.db.characters[indexB].trashTime).toBe(1_700_000_000_000)

        // --- Step 2: register real change effects, select A, flush. ---
        const tracker = makeTracker()
        const markChanged = vi.fn()
        selectedCharID.set(indexA)
        const cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flush()
        log(`step2: selected=A(index ${indexA}); tracker.character after first flush=${JSON.stringify(tracker.character)}`)
        expect(tracker.character[0]).toBe('char-A') // sanity: effect 6 IS wired to the real, live DBState/selectedCharID

        // --- Step 3: encode once, so blocks exist on disk for BOTH characters. ---
        const encoder = new RisuSaveEncoder()
        await encoder.init(snapshotDb(DBState.db), { compression: false })
        const firstEncoded = encoder.encode()
        expect(firstEncoded).not.toBeNull()
        const firstDecoded = await decodeRisuSave(new Uint8Array(firstEncoded!))
        const firstDecodedB = firstDecoded.characters?.find((c: CharacterFixture) => c.chaId === 'char-B')
        log(
            `step3: initial encode -> decoded char-B present=${!!firstDecodedB}, trashTime=${firstDecodedB?.trashTime}`,
        )
        expect(firstDecodedB).toBeTruthy()
        expect(firstDecodedB!.trashTime).toBe(1_700_000_000_000)

        // --- Step 4: simulate the GridCatalog.svelte restore path exactly. ---
        // A is still selected. Restore is by id-lookup, not by selection.
        tracker.character = tracker.character.length === 0 ? [] : [tracker.character[0]] // mirrors saveDb()'s post-snapshot trim (globalApi.svelte.ts)
        markChanged.mockClear()
        const restoreIdx = findCharacterIndexbyId('char-B')
        expect(restoreIdx).not.toBe(-1)
        DBState.db.characters[restoreIdx].trashTime = undefined
        simulateCheckCharOrderTouch()
        flush()
        log(`step4: restored char-B (index ${restoreIdx}).trashTime live value = ${DBState.db.characters[restoreIdx].trashTime}`)
        log(`step4: markChanged called after restore: ${markChanged.mock.calls.length > 0} (calls=${JSON.stringify(markChanged.mock.calls)})`)

        // --- Step 5: capture the tracker. THE CRUX: is char-B's chaId in tracker.character? ---
        const toSave = structuredClone(tracker) as toSaveType
        const bInTrackerCharacter = toSave.character.includes('char-B')
        log(`step5: tracker.character = ${JSON.stringify(toSave.character)}`)
        log(`step5: 'char-B' in tracker.character (toSave)? ${bInTrackerCharacter}`)

        // --- Step 6/7: encode again with that tracker snapshot, decode, inspect char-B's trashTime. ---
        await encoder.set(snapshotDb(DBState.db), toSave)
        const secondEncoded = encoder.encode()
        expect(secondEncoded).not.toBeNull()
        const secondDecoded = await decodeRisuSave(new Uint8Array(secondEncoded!))
        const secondDecodedB = secondDecoded.characters?.find((c: CharacterFixture) => c.chaId === 'char-B')
        log(
            `step7: post-restore-save decoded char-B present=${!!secondDecodedB}, trashTime=${JSON.stringify(secondDecodedB?.trashTime)}`,
        )

        const bugReproduced = secondDecodedB !== undefined && secondDecodedB.trashTime !== undefined
        log(`>>> BUG REPRODUCED (decoded char-B still has trashTime set after restore+save, without ever selecting B)? ${bugReproduced}`)

        // --- Step 8/9: claimed mitigation -- select B afterward, flush, encode, decode. ---
        selectedCharID.set(restoreIdx)
        flush()
        const toSaveAfterSelect = structuredClone(tracker) as toSaveType
        log(`step8: after selecting char-B and flushing, tracker.character = ${JSON.stringify(toSaveAfterSelect.character)}`)
        await encoder.set(snapshotDb(DBState.db), toSaveAfterSelect)
        const thirdEncoded = encoder.encode()
        expect(thirdEncoded).not.toBeNull()
        const thirdDecoded = await decodeRisuSave(new Uint8Array(thirdEncoded!))
        const thirdDecodedB = thirdDecoded.characters?.find((c: CharacterFixture) => c.chaId === 'char-B')
        log(
            `step9: after selecting char-B + re-saving, decoded char-B trashTime = ${JSON.stringify(thirdDecodedB?.trashTime)}`,
        )
        const mitigationWorks = thirdDecodedB !== undefined && thirdDecodedB.trashTime === undefined
        log(`>>> MITIGATION (selecting B afterward re-captures the restore and clears trashTime on next save)? ${mitigationWorks}`)

        cleanup()

        console.log(
            [
                '',
                '=== trash-restore-repro: full report ===',
                ...lines,
                '=========================================',
                '',
            ].join('\n'),
        )

        // Pins the actually-observed outcome of this run (see the printed
        // report above for the real values) so a future accidental change to
        // this harness's own plumbing that silently altered the scenario
        // would fail loudly. Not written to force a particular verdict --
        // whichever way steps 5/7/9 actually come out, these assert that the
        // SAME values are what get reported, and additionally pin the two
        // observed booleans to their CONCRETE values from the run this
        // harness was authored against.
        expect(bInTrackerCharacter).toBe(false) // char-B's chaId never entered tracker.character
        expect(bugReproduced).toBe(true) // stale trashTime survives a restore + save cycle
        expect(mitigationWorks).toBe(true) // selecting B afterward does clear it on the next save
    })
})
