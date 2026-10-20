// @vitest-environment node
/**
 * The plan of the old-data deletion (`oldData/plan.ts`) and the allowlist it lists through (`isOldDataKey`). The kind of
 * a plan comes from what the store holds and from the legacy files this attempt walked, never from the code path that
 * asked. Each test says what it is: reproducer (red under the named in-memory mutant of the planner, kept in the test
 * name) or guard (passes before and after any change that keeps the rule).
 */
import { describe, expect, test } from 'vitest'
import { createMemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { backupNamesOf, observeOldData, planOldDataDeletion, type OldDataObservation, type UnitIdOf, type WalkedLegacy } from 'src/ts/storage/store2/oldData/plan'
import { isOldDataKey, type LegacyList } from 'src/ts/storage/store2/format'

const MAIN = 'database/database.bin'
const UUID_A = '00000000-0000-4000-8000-0000000000a1'
const UUID_B = '00000000-0000-4000-8000-0000000000b2'
const UUID_C = '00000000-0000-4000-8000-0000000000c3'

/** The browser and Node naming: the unit id is the name under `coldstorage/`. */
const plainUnitId: UnitIdOf = key => {
    const name = key.slice('coldstorage/'.length)
    return key.startsWith('coldstorage/') && !name.includes('/') ? name : null
}
/** The desktop naming: the file carries `.json`. */
const desktopUnitId: UnitIdOf = key => {
    const name = key.slice('coldstorage/'.length)
    return key.startsWith('coldstorage/') && name.endsWith('.json') && !name.includes('/') ? name.slice(0, -'.json'.length) : null
}

function observation(over: Omit<Partial<OldDataObservation>, 'listing'> & { listing?: Partial<NonNullable<OldDataObservation['listing']>> | null } = {}): OldDataObservation {
    const { listing, ...rest } = over
    return {
        mainFile: true,
        backups: [],
        listing: listing === null
            ? null
            : { blocks: ['blocks/head', 'blocks/000000000001-aaaaaaaa/root'], database: [MAIN], coldstorage: [], ...listing },
        ...rest,
    }
}

function legacyList(files: LegacyList['files']): LegacyList {
    return { v: 1, iv: 1, files, h: '', l: [], i: { v: 1, u: [], h: '', o: [] } }
}

function walked(files: LegacyList['files'], coldKeys: string[] = []): WalkedLegacy {
    return { list: legacyList(files), coldKeys: new Set(coldKeys) }
}

const MAIN_OK = [{ key: MAIN, status: 'ok' as const }]
const coldOf = (plan: ReturnType<typeof planOldDataDeletion>) => (plan?.keys ?? []).filter(key => key.startsWith('coldstorage/'))

describe('the kind comes from what the store holds', () => {
    test('guard: no upstream main file and no numbered backup is fork-only; every cold key goes except the companions, the order is cold, pre-blocks, blocks, head last', () => {
        const plan = planOldDataDeletion(observation({
            mainFile: false,
            listing: {
                blocks: ['blocks/head', 'blocks/g1/root', 'blocks/g1/c/6162'],
                database: ['database/database.pre-blocks.1', 'database/backupfingerprint'],
                coldstorage: [`coldstorage/${UUID_A}`, `coldstorage/${UUID_B}_accessMeta`, 'coldstorage/not-a-uuid', `coldstorage/${UUID_C}.json`],
            },
        }), null, plainUnitId)
        expect(plan).toEqual({
            v: 1,
            kind: 'fork-only',
            upstream: { main: false, backups: [] },
            keys: [
                `coldstorage/${UUID_A}`, `coldstorage/${UUID_C}.json`, 'coldstorage/not-a-uuid',
                'database/database.pre-blocks.1', 'blocks/g1/c/6162', 'blocks/g1/root', 'blocks/head',
            ],
        })
    })

    test('guard: the desktop companion coldstorage/<uuid>_accessMeta.json is never listed, fork-only included', () => {
        const plan = planOldDataDeletion(observation({
            mainFile: false,
            listing: { coldstorage: [`coldstorage/${UUID_A}.json`, `coldstorage/${UUID_A}_accessMeta.json`, `coldstorage/${UUID_B}_accessMeta`] },
        }), null, desktopUnitId)
        expect(coldOf(plan)).toEqual([`coldstorage/${UUID_A}.json`])
    })

    test('guard: an upstream main file read to its end makes an exclusion plan that lists only uuid units outside the walked references', () => {
        const plan = planOldDataDeletion(observation({
            backups: [5, 3],
            listing: {
                database: [MAIN, 'database/dbbackup-5.bin', 'database/dbbackup-3.bin', 'database/backupfingerprint'],
                coldstorage: [
                    `coldstorage/${UUID_A}`, `coldstorage/${UUID_B}`, `coldstorage/${UUID_C}_accessMeta`, 'coldstorage/chat-unit', 'coldstorage/nested/unit',
                ],
            },
        }), walked([...MAIN_OK, { key: 'database/dbbackup-5.bin', status: 'ok' }, { key: 'database/dbbackup-3.bin', status: 'ok' }], [UUID_A]), plainUnitId)
        expect(plan?.kind).toBe('exclusion')
        expect(coldOf(plan)).toEqual([`coldstorage/${UUID_B}`])
        expect(plan?.upstream).toEqual({ main: true, backups: ['database/dbbackup-3.bin', 'database/dbbackup-5.bin'] })
    })

    test('reproducer (mutant "the exclusion is not applied"): a unit a walked file references is never listed', () => {
        const plan = planOldDataDeletion(observation({
            listing: { coldstorage: [`coldstorage/${UUID_A}`, `coldstorage/${UUID_B}`] },
        }), walked(MAIN_OK, [UUID_A, UUID_B]), plainUnitId)
        expect(plan?.kind).toBe('exclusion')
        expect(coldOf(plan)).toEqual([])
    })

    test('reproducer (mutant "the kind is taken from the call path": a seed is fork-only): a seed over a store that holds the upstream main file lists no cold unit', () => {
        const plan = planOldDataDeletion(observation({
            mainFile: true,
            listing: { coldstorage: [`coldstorage/${UUID_A}`] },
        }), null, plainUnitId)
        expect(plan?.kind).toBe('fork-format-only')
        expect(coldOf(plan)).toEqual([])
        expect(plan?.keys).toContain('blocks/head')
    })

    test('reproducer (same mutant): a recovery fresh start over a store that holds numbered backups but no main file lists no cold unit', () => {
        const plan = planOldDataDeletion(observation({
            mainFile: false,
            backups: [7],
            listing: { database: ['database/dbbackup-7.bin'], coldstorage: [`coldstorage/${UUID_A}`] },
        }), null, plainUnitId)
        expect(plan?.kind).toBe('fork-format-only')
        expect(coldOf(plan)).toEqual([])
    })

    test.each([
        ['the main file probe failed', observation({ mainFile: 'unknown', listing: { coldstorage: [`coldstorage/${UUID_A}`] } }), walked(MAIN_OK)],
        ['the backup listing failed', observation({ backups: 'unknown', listing: { coldstorage: [`coldstorage/${UUID_A}`] } }), walked(MAIN_OK)],
        ['a fork-only store whose main probe failed', observation({ mainFile: 'unknown', listing: { coldstorage: [`coldstorage/${UUID_A}`] } }), null],
        ['a fork-only store whose backup listing failed', observation({ mainFile: false, backups: 'unknown', listing: { coldstorage: [`coldstorage/${UUID_A}`] } }), null],
    ])('reproducer (mutant "an unknown probe counts as absent"): %s lists no cold unit', (_name, seen, walk) => {
        const plan = planOldDataDeletion(seen, walk, plainUnitId)
        expect(plan?.kind).toBe('fork-format-only')
        expect(coldOf(plan)).toEqual([])
        expect(plan?.keys).toContain('blocks/head')
    })

    test('reproducer (mutant "a walked file that did not read to its end still counts"): one unreadable file leaves no cold unit listed', () => {
        const plan = planOldDataDeletion(observation({
            backups: [5],
            listing: { database: [MAIN, 'database/dbbackup-5.bin'], coldstorage: [`coldstorage/${UUID_A}`] },
        }), walked([...MAIN_OK, { key: 'database/dbbackup-5.bin', status: 'unreadable' }]), plainUnitId)
        expect(plan?.kind).toBe('fork-format-only')
        expect(coldOf(plan)).toEqual([])
    })

    test('reproducer (mutant "the main file counts when it came from a backup or the lenient decode"): a main file listed unreadable leaves no cold unit listed', () => {
        const plan = planOldDataDeletion(observation({
            listing: { coldstorage: [`coldstorage/${UUID_A}`] },
        }), walked([{ key: MAIN, status: 'unreadable' }]), plainUnitId)
        expect(plan?.kind).toBe('fork-format-only')
        expect(coldOf(plan)).toEqual([])
    })

    test('reproducer (mutant "only the files that were walked are checked"): a numbered backup that exists but was never walked leaves no cold unit listed', () => {
        const plan = planOldDataDeletion(observation({
            backups: [9],
            listing: { database: [MAIN, 'database/dbbackup-9.bin'], coldstorage: [`coldstorage/${UUID_A}`] },
        }), walked(MAIN_OK), plainUnitId)
        expect(plan?.kind).toBe('fork-format-only')
        expect(coldOf(plan)).toEqual([])
    })

    test('reproducer (mutant "only the observed files are checked"): a walked file listed unreadable that the store no longer shows still leaves no cold unit listed', () => {
        const plan = planOldDataDeletion(observation({
            backups: [],
            listing: { coldstorage: [`coldstorage/${UUID_A}`] },
        }), walked([...MAIN_OK, { key: 'database/dbbackup-2.bin', status: 'unreadable' }]), plainUnitId)
        expect(plan?.kind).toBe('fork-format-only')
        expect(coldOf(plan)).toEqual([])
    })

    test('reproducer (mutant "the main file is assumed walked"): an observed main file the list never mentions leaves no cold unit listed', () => {
        const plan = planOldDataDeletion(observation({
            listing: { coldstorage: [`coldstorage/${UUID_A}`] },
        }), walked([]), plainUnitId)
        expect(plan?.kind).toBe('fork-format-only')
        expect(coldOf(plan)).toEqual([])
    })

    test.each([
        ['an unnamed .bin', 'database/other.bin'],
        ['a main file with a suffix', 'database/database.bin.bak'],
        ['a numbered backup that does not round trip', 'database/dbbackup-007.bin'],
        ['an upper-case extension', 'database/Old.BIN'],
        ['a backup-like name without the extension', 'database/dbbackup-9'],
    ])('reproducer (C-a3, mutant "the database/ listing is not checked"): %s makes the exclusion incomplete', (_name, extra) => {
        const plan = planOldDataDeletion(observation({
            listing: { database: [MAIN, extra], coldstorage: [`coldstorage/${UUID_A}`] },
        }), walked(MAIN_OK), plainUnitId)
        expect(plan?.kind).toBe('fork-format-only')
        expect(coldOf(plan)).toEqual([])
    })

    test('guard: files in database/ that are not saves do not make the exclusion incomplete, and a pre-blocks file is listed', () => {
        const plan = planOldDataDeletion(observation({
            listing: {
                database: [MAIN, 'database/backupfingerprint', 'database/risu-write-abc.tmp', 'database/database.pre-blocks'],
                coldstorage: [`coldstorage/${UUID_A}`],
            },
        }), walked(MAIN_OK), plainUnitId)
        expect(plan?.kind).toBe('exclusion')
        expect(plan?.keys).toEqual([`coldstorage/${UUID_A}`, 'database/database.pre-blocks', 'blocks/000000000001-aaaaaaaa/root', 'blocks/head'])
    })
})

describe('when there is no plan', () => {
    test('guard: no blocks/ key means no snapshot, whatever else is listed', () => {
        expect(planOldDataDeletion(observation({
            mainFile: false,
            listing: { blocks: [], database: ['database/database.pre-blocks'], coldstorage: [`coldstorage/${UUID_A}`] },
        }), null, plainUnitId)).toBeNull()
    })

    test('guard: a listing that failed means no snapshot', () => {
        expect(planOldDataDeletion(observation({ listing: null }), walked(MAIN_OK), plainUnitId)).toBeNull()
    })

    test('guard: a key the stores cannot address is dropped from the list and the rest stands; nothing left means no snapshot', () => {
        const plan = planOldDataDeletion(observation({
            listing: { blocks: ['blocks/head', 'blocks/a:b', 'blocks/ok', 'blocks/bad\u0000name'] },
        }), null, plainUnitId)
        expect(plan?.keys).toEqual(['blocks/ok', 'blocks/head'])
        expect(planOldDataDeletion(observation({ listing: { blocks: ['blocks/a:b'] } }), null, plainUnitId)).toBeNull()
    })

    test('guard: keys outside the allowlist in a listing are never listed', () => {
        const plan = planOldDataDeletion(observation({
            mainFile: false,
            listing: { blocks: ['blocks/head', 'blocks/../assets/x', 'blocks//x'], coldstorage: ['coldstorage/../database/database.bin', 'coldstorage/ok'] },
        }), null, plainUnitId)
        expect(plan?.keys).toEqual(['coldstorage/ok', 'blocks/head'])
    })

    test('reproducer (mutant "the planner trusts the listing\'s prefix"): a listing that returns a key outside the allowlist never gets it into the plan', () => {
        const plan = planOldDataDeletion(observation({
            mainFile: false,
            listing: { blocks: ['blocks/head', 'assets/x', 'store2-commit', 'inlays/b-x.0123456789abcdef'], coldstorage: ['remotes/x', MAIN] },
        }), null, plainUnitId)
        expect(plan?.keys).toEqual(['blocks/head'])
    })
})

describe('the numbered backups are recorded as names', () => {
    test('guard: sorted, without repeats, the same form a later listing produces', () => {
        expect(backupNamesOf([3, 30, 5, 3])).toEqual(['database/dbbackup-3.bin', 'database/dbbackup-30.bin', 'database/dbbackup-5.bin'])
        expect(backupNamesOf([5, 3])).toEqual(backupNamesOf([3, 5]))
    })
})

describe('observing the store', () => {
    test('guard: the probes and the three listings are read from the store', async () => {
        const store = createMemoryByteStore()
        store.files.set(MAIN, new Uint8Array([1]))
        store.files.set('blocks/head', new Uint8Array([1]))
        store.files.set('coldstorage/x', new Uint8Array([1]))
        store.files.set('assets/keep', new Uint8Array([1]))
        const seen = await observeOldData({ store, listBackupTimes: async () => [4] })
        expect(seen).toEqual({
            mainFile: true,
            backups: [4],
            listing: { blocks: ['blocks/head'], database: [MAIN], coldstorage: ['coldstorage/x'] },
        })
        expect(store.writes).toEqual([])
        expect(store.deletes).toEqual([])
    })

    test('guard: a failing probe is unknown and a failing listing is no listing, never absence', async () => {
        const store = createMemoryByteStore()
        store.has = async () => { throw new Error('has failed') }
        store.list = async () => { throw new Error('list failed') }
        const seen = await observeOldData({ store, listBackupTimes: async () => { throw new Error('backups failed') } })
        expect(seen).toEqual({ mainFile: 'unknown', backups: 'unknown', listing: null })
    })
})

describe('the allowlist', () => {
    test.each([
        'blocks/head',
        'blocks/000000000001-aaaaaaaa/f/preset',
        'coldstorage/x',
        `coldstorage/${UUID_A}.json`,
        'database/database.pre-blocks',
        'database/database.pre-blocks-12',
    ])('guard: %s may be listed', (key) => {
        expect(isOldDataKey(key)).toBe(true)
    })

    test.each([
        ['the upstream main file', 'database/database.bin'],
        ['a numbered backup', 'database/dbbackup-1.bin'],
        ['an asset', 'assets/x'],
        ['an inlay', 'inlays/b-x.0123456789abcdef'],
        ['a remote file', 'remotes/x'],
        ['the commit key', 'store2-commit'],
        ['the fence', 'store2-fence'],
        ['the sweep record', 'store2-sweep'],
        ['a store2 unit key', 'store2/u-0123456789abcdefghijklmnop'],
        ['a traversal out of blocks/', 'blocks/../assets/x'],
        ['a traversal into the main file', 'database/database.pre-blocks/../database.bin'],
        ['a leading traversal', '../blocks/x'],
        ['a dot segment', 'blocks/./x'],
        ['a backslash', 'blocks\\x'],
        ['a backslash traversal inside the prefix', 'blocks/a\\..\\..\\assets\\x'],
        ['a backslash traversal into the main file', 'coldstorage/..\\database\\database.bin'],
        ['an empty segment', 'blocks//x'],
        ['the bare prefix', 'blocks/'],
        ['the bare cold prefix', 'coldstorage/'],
        ['a control character', 'blocks/a\u0000b'],
        ['a lone surrogate', 'blocks/a\ud800'],
        ['the empty key', ''],
        ['a name that only starts like blocks/', 'blocksx/head'],
        ['a name that only starts like the pre-blocks files', 'database/database.pre'],
    ])('reproducer (mutant "the allowlist admits it"): %s is refused', (_name, key) => {
        expect(isOldDataKey(key)).toBe(false)
    })
})
