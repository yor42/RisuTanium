/**
 * The pure core of preset bundles (`src/ts/storage/presetBundle.ts`): payload build, validation, name planning,
 * answer validation and the commit. Imports no mock-needing module, so it runs without database or util harnesses.
 * The reproducers fail against the named mutant of the finished module (a new capability has no pre-fix producer).
 */
import { describe, expect, test } from 'vitest'
import type { botPreset, Database } from 'src/ts/storage/database.svelte'
import {
    MAX_BUNDLE_FOLDER_NAME,
    MAX_BUNDLE_PRESETS,
    PRESET_BUNDLE_CANCEL,
    PresetBundleError,
    buildPresetBundlePayload,
    commitPresetBundle,
    parsePresetBundleAnswer,
    parsePresetBundlePayload,
    planPresetNames,
    type ParsedBundle,
} from 'src/ts/storage/presetBundle'
import { freshPresetMeta } from 'src/ts/storage/presetMeta'
import { missingSentinels, sentinelObject, sentinelsIn } from './shareStripFixture'

type Db = Pick<Database, 'botPresets' | 'presetFolders'>

function preset(extra: Record<string, unknown>): botPreset {
    return { name: 'P', ...extra } as unknown as botPreset
}

function parsedOf(rows: { name: string, folder?: string | null }[]): ParsedBundle {
    return { rows: rows.map((row) => ({ preset: { name: row.name }, name: row.name, folder: row.folder ?? null, aiModel: '' })) }
}

/** The intake the commit tests use: the fresh-meta step of the real trust rule and nothing else. */
async function fakeIntake(raw: Record<string, unknown>): Promise<botPreset> {
    return freshPresetMeta(raw as unknown as botPreset, { keepFolder: false })
}

describe('planPresetNames', () => {
    // reproducer vs M8 (names taken earlier in the bundle ignored)
    test('T-SUF: two Beta in one bundle become Beta and Beta (2); a taken name takes the first free suffix', () => {
        expect(planPresetNames([], ['Beta', 'Beta'], [true, true])).toEqual(['Beta', 'Beta (2)'])
        expect(planPresetNames(['Alpha', 'Alpha (2)'], ['Alpha'], [true])).toEqual(['Alpha (3)'])
        expect(planPresetNames(['Alpha'], ['Alpha', 'Beta'], [true, true])).toEqual(['Alpha (2)', 'Beta'])
    })

    test('an unticked row is null and takes no name from later rows', () => {
        expect(planPresetNames([], ['Beta', 'Beta'], [false, true])).toEqual([null, 'Beta'])
    })
})

describe('commitPresetBundle', () => {
    function db(extra: Partial<Db> = {}): Db {
        return { botPresets: [], presetFolders: [], ...extra } as Db
    }

    // reproducer vs M7 (folder never reused); the file folderId drop is pinned through the real intake by T-BLANK
    test('T-FOLD: an existing folder is reused, a new one is created once, and a folderId the file carries is dropped', async () => {
        const target = db({ presetFolders: [{ id: 'f-rp', name: 'RP' }], botPresets: [{ name: 'Alpha' } as botPreset] })
        const parsed = parsedOf([{ name: 'A', folder: 'RP' }, { name: 'B', folder: 'New' }, { name: 'C', folder: 'New' }, { name: 'D' }])
        parsed.rows[3].preset.folderId = 'foreign-folder'
        parsed.rows[0].preset.folderId = 'foreign-folder'

        const added = await commitPresetBundle(() => target, parsed, [true, true, true, true], fakeIntake)

        expect(added).toBe(4)
        expect(target.presetFolders.map((f) => f.name)).toEqual(['RP', 'New'])
        const [a, b, c, d] = target.botPresets.slice(1)
        expect(a.folderId).toBe('f-rp')
        expect(b.folderId).toBeDefined()
        expect(b.folderId).toBe(c.folderId)
        expect(b.folderId).not.toBe('f-rp')
        expect(Object.hasOwn(d, 'folderId')).toBe(false)
    })

    test('a folder is created only for a ticked row', async () => {
        const target = db()
        await commitPresetBundle(() => target, parsedOf([{ name: 'A', folder: 'Skipped' }, { name: 'B', folder: 'Kept' }]), [false, true], fakeIntake)
        expect(target.presetFolders.map((f) => f.name)).toEqual(['Kept'])
        expect(target.botPresets.map((p) => p.name)).toEqual(['B'])
    })

    test('names get suffixes against the existing list and earlier rows, and nothing existing is replaced', async () => {
        const existing = { name: 'Alpha', id: 'keep' } as botPreset
        const target = db({ botPresets: [existing] })
        await commitPresetBundle(() => target, parsedOf([{ name: 'Alpha' }, { name: 'Beta' }, { name: 'Beta' }]), [true, true, true], fakeIntake)
        expect(target.botPresets[0]).toBe(existing)
        expect(target.botPresets.map((p) => p.name)).toEqual(['Alpha', 'Alpha (2)', 'Beta', 'Beta (2)'])
    })

    test('a failing intake writes no preset and no folder', async () => {
        const target = db()
        let calls = 0
        const failing = async (raw: Record<string, unknown>) => {
            if (++calls === 2) {
                throw new Error('intake failed')
            }
            return fakeIntake(raw)
        }
        await expect(commitPresetBundle(() => target, parsedOf([{ name: 'A', folder: 'F' }, { name: 'B', folder: 'F' }]), [true, true], failing)).rejects.toThrow('intake failed')
        expect(target.botPresets).toEqual([])
        expect(target.presetFolders).toEqual([])
    })

    test('the database is read after the intakes', async () => {
        const first = db()
        const second = db()
        let current = first
        const swapping = async (raw: Record<string, unknown>) => {
            current = second
            return fakeIntake(raw)
        }
        await commitPresetBundle(() => current, parsedOf([{ name: 'A' }]), [true], swapping)
        expect(first.botPresets).toEqual([])
        expect(second.botPresets.map((p) => p.name)).toEqual(['A'])
    })
})

describe('parsePresetBundlePayload', () => {
    const entry = (name: string) => ({ preset: { name, aiModel: 'm' } })

    test('a valid payload yields display rows; an empty folder means none', () => {
        const parsed = parsePresetBundlePayload({ format: 1, presets: [{ ...entry('A'), folder: 'RP' }, { ...entry('B'), folder: '' }, { preset: { aiModel: 3 } }] })
        expect(parsed.rows.map((r) => [r.name, r.folder, r.aiModel])).toEqual([['A', 'RP', 'm'], ['B', null, 'm'], ['Imported', null, '']])
    })

    // reproducer vs M11 (count cap removed) and M12 (folder-name cap removed)
    test('T-CAP: 1001 presets and a 201-character folder name are refused, the limits themselves are accepted', () => {
        const many = (n: number) => ({ format: 1, presets: Array.from({ length: n }, (_, i) => entry(`P${i}`)) })
        expect(parsePresetBundlePayload(many(MAX_BUNDLE_PRESETS)).rows).toHaveLength(MAX_BUNDLE_PRESETS)
        expect(() => parsePresetBundlePayload(many(MAX_BUNDLE_PRESETS + 1))).toThrow(PresetBundleError)
        expect(parsePresetBundlePayload({ format: 1, presets: [{ ...entry('A'), folder: 'x'.repeat(MAX_BUNDLE_FOLDER_NAME) }] }).rows).toHaveLength(1)
        expect(() => parsePresetBundlePayload({ format: 1, presets: [{ ...entry('A'), folder: 'x'.repeat(MAX_BUNDLE_FOLDER_NAME + 1) }] })).toThrow(PresetBundleError)
    })

    test.each([
        ['not an object', 'x'],
        ['null', null],
        ['an array', []],
        ['an unknown format', { format: 2, presets: [entry('A')] }],
        ['no presets array', { format: 1 }],
        ['an empty list', { format: 1, presets: [] }],
        ['a non-object entry', { format: 1, presets: ['x'] }],
        ['an entry without a preset', { format: 1, presets: [{}] }],
        ['an array preset', { format: 1, presets: [{ preset: [] }] }],
        ['a null preset', { format: 1, presets: [{ preset: null }] }],
        ['a numeric folder', { format: 1, presets: [{ ...entry('A'), folder: 4 }] }],
    ])('refuses %s', (_label, inner) => {
        expect(() => parsePresetBundlePayload(inner)).toThrow(PresetBundleError)
    })
})

describe('parsePresetBundleAnswer', () => {
    test('the cancel literal is the string the Back row answers', () => {
        expect(PRESET_BUNDLE_CANCEL).toBe('cancel')
    })

    // reproducer vs M16 (out-of-range or duplicate indices accepted)
    test('T-ANS: only a non-empty list of distinct in-range integers is an import', () => {
        expect(parsePresetBundleAnswer('[0,2]', 3)).toEqual([0, 2])
        for (const bad of ['[0,99]', '[0,0]', '[]', '[-1]', '[1.5]', '["0"]', '{"0":1}', 'nope', PRESET_BUNDLE_CANCEL, '']) {
            expect(parsePresetBundleAnswer(bad, 3), bad).toBeNull()
        }
    })
})

describe('buildPresetBundlePayload', () => {
    const { object, leaves } = sentinelObject('botPreset')

    function sources(): botPreset[] {
        return [
            preset({ ...structuredClone(object), id: 'id-1', folderId: 'f1', slot: 2, name: 'One', proxyConnectionId: 'conn-1', koboldURL: 'https://sentinel-kobold.invalid', forceReplaceUrl: 'https://sentinel-proxy.invalid/v1' }),
            preset({ id: 'id-2', folderId: 'f1', name: 'Two' }),
            preset({ id: 'id-3', name: 'Three' }),
        ]
    }
    const folders = { presetFolders: [{ id: 'f1', name: 'RP' }] }

    test('the fixture holds every credential sentinel (non-vacuity)', () => {
        expect(missingSentinels(sources()[0], leaves)).toEqual([])
        expect(leaves.length).toBeGreaterThan(0)
    })

    // reproducer vs M1 (shareSafePreset skipped)
    test('T-STRIP: no credential sentinel, endpoint URL or connection id remains in the payload', () => {
        const payload = buildPresetBundlePayload(folders, sources())
        const text = JSON.stringify(payload)
        expect(sentinelsIn(payload, leaves)).toEqual([])
        expect(text).not.toContain('sentinel-kobold')
        expect(text).not.toContain('sentinel-proxy')
        expect(text).not.toContain('conn-1')
    })

    // reproducer vs M2 (withoutPresetMeta skipped)
    test('T-META: id, folderId and slot never travel, and the folder travels as a name in list order', () => {
        const payload = buildPresetBundlePayload(folders, sources())
        for (const entry of payload.presets) {
            for (const key of ['id', 'folderId', 'slot']) {
                expect(Object.hasOwn(entry.preset, key), key).toBe(false)
            }
        }
        expect(payload.presets.map((e) => [e.preset.name, e.folder])).toEqual([['One', 'RP'], ['Two', 'RP'], ['Three', undefined]])
        expect(Object.hasOwn(payload.presets[2], 'folder')).toBe(false)
    })

    test('the source presets are not changed', () => {
        const before = JSON.stringify(sources())
        const list = sources()
        buildPresetBundlePayload(folders, list)
        expect(JSON.stringify(list)).toBe(before)
    })

    test('every built payload passes the parser', () => {
        expect(parsePresetBundlePayload(buildPresetBundlePayload(folders, sources())).rows).toHaveLength(3)
    })

    test('a folder name over the cap is cut on a code point, so no lone surrogate is written', () => {
        const name = 'x'.repeat(MAX_BUNDLE_FOLDER_NAME - 1) + '\u{1F600}'
        const payload = buildPresetBundlePayload({ presetFolders: [{ id: 'f1', name }] }, [preset({ folderId: 'f1' })])
        const folder = payload.presets[0].folder ?? ''
        expect(folder).toBe('x'.repeat(MAX_BUNDLE_FOLDER_NAME - 1))
        expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(folder)).toBe(false)
        expect(() => parsePresetBundlePayload(payload)).not.toThrow()
    })

    test('more presets than the cap is refused', () => {
        const many = Array.from({ length: MAX_BUNDLE_PRESETS + 1 }, () => preset({}))
        expect(() => buildPresetBundlePayload({ presetFolders: [] }, many)).toThrow(PresetBundleError)
    })
})
