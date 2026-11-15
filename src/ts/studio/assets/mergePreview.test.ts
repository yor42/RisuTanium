import { describe, expect, test } from 'vitest'
import { groupDuplicates, type DuplicateGroup, type GroupRow } from './duplicateGroups'
import { ASSET_FOLDER_KEY } from './assetOwnerKeys'
import { applyFolderOps, invertFolderOp, type AssetFolderDoc } from './folderCodec'
import { buildMergePreview, mergePreviewEquals, type MergePreview, type ModuleSource } from './mergePreview'
import { spliceTextEdits } from './referenceRewrite'
import { scanForName } from './referenceScan'
import { enumerateClassifiedTargets, type CharacterTargetFields, type TargetOwner } from './referenceTargets'
import { DEFAULT_SETTINGS, assetRow, characterOwner, groupRow, moduleOwner, v2Trigger } from './assetFixtures.test-helpers'

type Rows = [string, string, string][]

function folders(order: string[], of: [string, string][]): AssetFolderDoc {
    return { v: 1, additional: { order, of } }
}

function ownerOf(rows: Rows, extra: CharacterTargetFields = {}, doc: unknown = folders(['Faces'], [['grin', 'Faces'], ['smile', 'Faces']])): TargetOwner {
    return characterOwner({ additionalAssets: rows, extentions: { [ASSET_FOLDER_KEY]: doc }, ...extra })
}

const SAME_FILE_ROWS: Rows = [assetRow('smile', 'assets/a.png'), assetRow('grin', 'assets/a.png'), assetRow('other', 'assets/o.png')]

function groupOf(rows: readonly (readonly string[])[], names: string[]): DuplicateGroup<GroupRow> {
    const groups = groupDuplicates(rows.map((row, index) => groupRow(row[0], row[1], index)))
    const found = groups.find((group) => group.cls === 'sameFileDifferentNames' && names.every((name) => group.rows.some((row) => row.name === name)))
    if (!found) {
        throw new Error('no candidate group for ' + names.join(','))
    }
    return found
}

function preview(owner: TargetOwner, keptName = 'smile', rows: Rows = SAME_FILE_ROWS, modules: ModuleSource[] = [], settings = DEFAULT_SETTINGS): MergePreview {
    return buildMergePreview(owner, 'asset', groupOf(rows, ['smile', 'grin']), keptName, modules, settings)
}

describe('what a merge writes', () => {
    test('the removed row, the dropped folder entry and the text edits are all in the model', () => {
        const owner = ownerOf(SAME_FILE_ROWS, { desc: 'a {{image::grin}} b', backgroundHTML: '{{bg::grin}}' })
        const result = preview(owner)
        expect(result.removedNames).toEqual(['grin'])
        expect(result.array).toBe('additionalAssets')
        expect(result.rowOps).toEqual([{ kind: 'assetRowRemove', array: 'additionalAssets', index: 1, tuple: ['grin', 'assets/a.png', 'png'], count: 1 }])
        expect(result.keptRows).toEqual([['smile', 'assets/a.png', 'png']])
        expect(result.folderOps).toEqual([{
            kind: 'assetFolderSet',
            name: 'grin',
            before: { had: true, value: 'Faces' },
            after: { had: false },
        }])
        expect(result.folderOutcome).toEqual({ state: 'ok', kept: 'Faces', from: 'kept', dropped: ['grin'] })
        expect(result.partialNames).toEqual([])
        expect(result.textEdits.map((edit) => [edit.target, edit.from, edit.to])).toEqual([['desc', 'grin', 'smile'], ['backgroundHTML', 'grin', 'smile']])
    })

    test('the model is a plain JSON-like value', () => {
        const result = preview(ownerOf(SAME_FILE_ROWS, { desc: '{{image::grin}} <img src=grin>' }))
        expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result)
    })

    test('identical removed tuples are removed highest index first, each count read as the earlier removals leave it', () => {
        const rows: Rows = [assetRow('smile', 'assets/a.png'), assetRow('grin', 'assets/a.png'), assetRow('grin', 'assets/a.png')]
        const result = preview(ownerOf(rows), 'smile', rows)
        expect(result.rowOps.map((op) => [op.index, op.count])).toEqual([[2, 2], [1, 1]])
        expect(result.folderOps).toHaveLength(1)
    })

    test('a case-only merge keeps the folder entry of the shared key and drops nothing', () => {
        const rows: Rows = [assetRow('Smile', 'assets/a.png'), assetRow('smile', 'assets/a.png')]
        const result = buildMergePreview(ownerOf(rows), 'asset', groupOf(rows, ['Smile', 'smile']), 'smile', [], DEFAULT_SETTINGS)
        expect(result.removedNames).toEqual(['Smile'])
        expect(result.folderOps).toEqual([])
        expect(result.folderOutcome).toEqual({ state: 'ok', kept: 'Faces', from: 'kept', dropped: [] })
    })

    test('an unreadable folder document gets no op and is reported; the rows are still removed', () => {
        const result = preview(ownerOf(SAME_FILE_ROWS, {}, { v: 9, additional: {} }))
        expect(result.folderOps).toEqual([])
        expect(result.folderOutcome).toEqual({ state: 'unreadable', kept: null, from: 'none', dropped: [] })
        expect(result.rowOps).toHaveLength(1)
    })

    test('a group row that no longer matches the owner at its index is named and gets no op', () => {
        const owner = ownerOf([assetRow('smile', 'assets/a.png'), assetRow('changed', 'assets/a.png')])
        const result = preview(owner)
        expect(result.missingRows).toEqual([1])
        expect(result.rowOps).toEqual([])
    })

    test('emotions have no folders: no folder op, and the array is emotionImages', () => {
        const rows = [['happy', 'e/1.png'], ['glad', 'e/1.png']]
        const group = groupOf(rows, ['happy', 'glad'])
        const owner = characterOwner({ emotionImages: [['happy', 'e/1.png'], ['glad', 'e/1.png']], customscript: [{ out: '@@emo glad' }], desc: '{{emotion::glad}} {{image::glad}}' })
        const result = buildMergePreview(owner, 'emotion', group, 'happy', [], DEFAULT_SETTINGS)
        expect(result.array).toBe('emotionImages')
        expect(result.folderOps).toEqual([])
        expect(result.folderOutcome.state).toBe('notApplicable')
        expect(result.textEdits.map((edit) => edit.target)).toEqual(['desc', 'regex/0/out'])
        expect(result.closeNames).toEqual([])
    })

    test('a module owner merges into its own array and folder document and matches exactly', () => {
        const rows: Rows = [assetRow('smile', 'assets/a.png'), assetRow('grin', 'assets/a.png')]
        const owner = moduleOwner({ assets: rows, [ASSET_FOLDER_KEY]: folders(['F'], [['grin', 'F']]), lorebook: [{ content: '{{image::grin}}' }] })
        const result = buildMergePreview(owner, 'asset', groupOf(rows, ['smile', 'grin']), 'smile', [], DEFAULT_SETTINGS)
        expect(result.array).toBe('assets')
        expect(result.matchedExactly).toBe(true)
        expect(result.folderOps).toHaveLength(2)
        expect(result.folderOutcome).toEqual({ state: 'ok', kept: 'F', from: 'removed', dropped: ['grin'] })
        expect(result.textEdits).toEqual([{ target: 'lore/0/content', offset: 9, from: 'grin', to: 'smile' }])
        expect(result.modulesHolding).toEqual([])
    })

    test('enabled modules holding the removed name are listed', () => {
        const modules: ModuleSource[] = [
            { id: 'm1', name: 'Faces pack', assets: [['GRIN', 'x']] },
            { id: 'm2', name: 'Other', assets: [['else', 'y']] },
            { id: 'm3', name: 'Bare' },
        ]
        expect(preview(ownerOf(SAME_FILE_ROWS), 'smile', SAME_FILE_ROWS, modules).modulesHolding).toEqual([{ id: 'm1', name: 'Faces pack' }])
    })

    test('flagged places and name lists are listed in their sections and never edited', () => {
        const owner = ownerOf(SAME_FILE_ROWS, { desc: '<img src=grin> {{ele::grin::x}}', triggerscript: [v2Trigger([{ type: 'triggerlua', code: 'say("grin")' }])] })
        const result = preview(owner)
        expect(result.textEdits).toEqual([])
        expect(result.notRewritten.map((hit) => hit.reason).sort()).toEqual(['flagOnlyTarget', 'unquotedSrc'])
        expect(result.nameLists).toHaveLength(1)
    })
})

describe('the model changes with everything the merge writes', () => {
    const rowsAfterFolder = SAME_FILE_ROWS
    const base = () => ownerOf(rowsAfterFolder, { desc: 'a {{image::grin}} b', globalLore: [{ content: 'plain' }] })

    test('two builds over an unchanged owner are equal, and the owner is not touched', () => {
        const owner = base()
        const snapshot = JSON.stringify(owner)
        expect(mergePreviewEquals(preview(owner), preview(owner))).toBe(true)
        expect(mergePreviewEquals(preview(base()), preview(base()))).toBe(true)
        expect(JSON.stringify(owner)).toBe(snapshot)
    })

    test('a folder change that alters the merge ops or the folder outcome makes the models differ', () => {
        const before = preview(base())
        const withDoc = (doc: AssetFolderDoc) => ownerOf(rowsAfterFolder, { desc: 'a {{image::grin}} b', globalLore: [{ content: 'plain' }] }, doc)
        const droppedMoved = withDoc(folders(['Faces', 'Poses'], [['grin', 'Poses'], ['smile', 'Faces']]))
        expect(mergePreviewEquals(before, preview(droppedMoved))).toBe(false)
        const keptMoved = withDoc(folders(['Faces', 'Poses'], [['grin', 'Faces'], ['smile', 'Poses']]))
        expect(mergePreviewEquals(before, preview(keptMoved))).toBe(false)
        const keptRemoved = withDoc(folders(['Faces'], [['grin', 'Faces']]))
        expect(mergePreviewEquals(before, preview(keptRemoved))).toBe(false)
    })

    test('a folder change on an unrelated name gives an equal model: no document is part of it', () => {
        const before = preview(base())
        const withDoc = (doc: AssetFolderDoc) => ownerOf(rowsAfterFolder, { desc: 'a {{image::grin}} b', globalLore: [{ content: 'plain' }] }, doc)
        expect(mergePreviewEquals(before, preview(withDoc(folders(['Faces', 'Poses'], [['grin', 'Faces'], ['smile', 'Faces'], ['other', 'Poses']]))))).toBe(true)
        expect(mergePreviewEquals(before, preview(withDoc(folders(['Poses', 'Faces'], [['smile', 'Faces'], ['grin', 'Faces']]))))).toBe(true)
    })

    test('a row change makes the models differ: an inserted row shifts the removed row away from its index', () => {
        const before = preview(base())
        const inserted: Rows = [assetRow('new', 'assets/n.png'), ...SAME_FILE_ROWS]
        const owner = ownerOf(inserted, { desc: 'a {{image::grin}} b' })
        const after = buildMergePreview(owner, 'asset', groupOf(SAME_FILE_ROWS, ['smile', 'grin']), 'smile', [], DEFAULT_SETTINGS)
        expect(mergePreviewEquals(before, after)).toBe(false)
    })

    test('an appended kept-name row makes the models differ', () => {
        const before = preview(base())
        const appended: Rows = [...SAME_FILE_ROWS, assetRow('smile', 'assets/z.png')]
        const after = buildMergePreview(ownerOf(appended, { desc: 'a {{image::grin}} b' }), 'asset', groupOf(SAME_FILE_ROWS, ['smile', 'grin']), 'smile', [], DEFAULT_SETTINGS)
        expect(mergePreviewEquals(before, after)).toBe(false)
    })

    test('an appended entry holding the old name makes the models differ; one without it does not', () => {
        const before = preview(base())
        const withOld = ownerOf(rowsAfterFolder, { desc: 'a {{image::grin}} b', globalLore: [{ content: 'plain' }, { content: '{{image::grin}}' }] })
        const without = ownerOf(rowsAfterFolder, { desc: 'a {{image::grin}} b', globalLore: [{ content: 'plain' }, { content: 'nothing here' }] })
        expect(mergePreviewEquals(before, preview(withOld))).toBe(false)
        expect(mergePreviewEquals(before, preview(without))).toBe(true)
    })

    test('a text edit moves the offsets: editing text before the reference makes the models differ', () => {
        const before = preview(base())
        const moved = ownerOf(rowsAfterFolder, { desc: 'aa {{image::grin}} b', globalLore: [{ content: 'plain' }] })
        expect(mergePreviewEquals(before, preview(moved))).toBe(false)
    })

    test('a new flagged reference makes the models differ', () => {
        const before = preview(base())
        const flagged = ownerOf(rowsAfterFolder, { desc: 'a {{image::grin}} b <img src=grin>', globalLore: [{ content: 'plain' }] })
        expect(mergePreviewEquals(before, preview(flagged))).toBe(false)
    })

    test('a trigger class switch with unchanged text makes the models differ', () => {
        const withMode = (type2: string) => ownerOf(rowsAfterFolder, { triggerscript: [v2Trigger([], [{ type: 'exists', value: '{{image::grin}}', type2, depth: 3 }])] })
        const loose = preview(withMode('loose'))
        const regex = preview(withMode('regex'))
        expect(loose.textEdits).toHaveLength(1)
        expect(regex.textEdits).toEqual([])
        expect(mergePreviewEquals(loose, regex)).toBe(false)
    })

    test('equality compares arrays in order and strings exactly', () => {
        const owner = ownerOf(SAME_FILE_ROWS, { desc: '{{img::grin}}', firstMessage: '{{img::grin}}' })
        const a = preview(owner)
        const swapped: MergePreview = { ...a, textEdits: [...a.textEdits].reverse() }
        expect(mergePreviewEquals(a, swapped)).toBe(false)
        expect(mergePreviewEquals(a, { ...a, keptName: 'Smile' })).toBe(false)
        expect(mergePreviewEquals(a, { ...a, rowOps: [] })).toBe(false)
    })
})

describe('the merge never reaches past the owner and kind', () => {
    test('the text of another owner or an emotion kind is not read', () => {
        const owner = characterOwner({ additionalAssets: SAME_FILE_ROWS, emotionImages: [['grin', 'e.png']], customscript: [{ out: '@@emo grin' }], desc: '{{emotion::grin}}' })
        const result = preview(owner)
        expect(result.textEdits).toEqual([])
    })
})

describe('background HTML and creator comments', () => {
    test('{{bg::Smile}} and {{audio::Smile}} are planned at backgroundHTML and counted in the used-in scan', () => {
        const rows: Rows = [assetRow('Smile', 'assets/a.png'), assetRow('smile_bg', 'assets/a.png')]
        const fields: CharacterTargetFields = { additionalAssets: rows, backgroundHTML: '{{bg::Smile}}<hr>{{audio::Smile}}' }
        const owner = characterOwner(fields)
        const result = buildMergePreview(owner, 'asset', groupOf(rows, ['Smile', 'smile_bg']), 'smile_bg', [], DEFAULT_SETTINGS)
        expect(result.textEdits.map((edit) => [edit.target, edit.from])).toEqual([['backgroundHTML', 'Smile'], ['backgroundHTML', 'Smile']])
        expect(scanForName(enumerateClassifiedTargets(owner), 'asset', 'Smile').matches.map((hit) => hit.path)).toEqual(['backgroundHTML', 'backgroundHTML'])
    })

    test('creator comments are rewritten with their languages and removedQuotes is not part of the model', () => {
        const rows: Rows = [assetRow('Smile', 'assets/a.png'), assetRow('grin', 'assets/a.png')]
        const text = '{{image::Smile}}\n# `ko`\n{{image::Smile}}'
        const owner = characterOwner({ additionalAssets: rows, creatorNotes: text })
        const result = buildMergePreview(owner, 'asset', groupOf(rows, ['Smile', 'grin']), 'grin', [], DEFAULT_SETTINGS)
        expect(result.textEdits.map((edit) => edit.target)).toEqual(['creatorNotes', 'creatorNotes'])
        expect(scanForName(enumerateClassifiedTargets(owner), 'asset', 'Smile').matches.map((hit) => hit.lang)).toEqual(['xx', 'ko'])
        expect(Object.keys(result)).not.toContain('removedQuotes')
    })
})

describe('close names', () => {
    const extensionRows: Rows = [assetRow('smile.png', 'assets/a.png'), assetRow('smile', 'assets/a.png')]
    const previewOf = (text: string, settings: Partial<typeof DEFAULT_SETTINGS> = {}, modules: ModuleSource[] = []) => buildMergePreview(
        characterOwner({ additionalAssets: extensionRows, desc: text }),
        'asset',
        groupOf(extensionRows, ['smile.png', 'smile']),
        'smile',
        modules,
        { ...DEFAULT_SETTINGS, ...settings },
    )

    test('a leftover that the engine resolves to a near row is listed with what it resolves to now and after', () => {
        const result = previewOf('{{image::smile.png}} {{image::smile.jpg}}')
        expect(result.textEdits).toHaveLength(1)
        expect(result.closeNames).toEqual([{ path: 'desc', offset: 30, length: 9, name: 'smile.jpg', via: 'macro', before: 'smile.png', after: 'smile' }])
    })

    test('with legacyMediaFindings on the near lookup does not run, so nothing is listed', () => {
        expect(previewOf('{{image::smile.jpg}}', { legacyMediaFindings: true }).closeNames).toEqual([])
    })

    test('a name further than assetMaxDifference from every row is not listed', () => {
        expect(previewOf('{{image::zzzzzzzzzzzz}}').closeNames).toEqual([])
        expect(previewOf('{{image::zzzzzzzzzzzz}}', { assetMaxDifference: 20 }).closeNames).toHaveLength(1)
    })

    test('a reference with an exact row after the merge, or already showing, is not a close name', () => {
        expect(previewOf('{{image::smile}} {{image::SMILE}}').closeNames).toEqual([])
    })

    test('an img src near a module asset reports it; a macro with the same name does not; with the setting off neither does', () => {
        const modules: ModuleSource[] = [{ id: 'm', name: 'pack', assets: [['smile_m', 'p']] }]
        const text = '<img src="smile_n"> {{img::smile_n}} <img src="sm">'
        const rows: Rows = [assetRow('a', 'assets/a.png'), assetRow('b', 'assets/a.png')]
        const run = (settings: Partial<typeof DEFAULT_SETTINGS>) => buildMergePreview(
            characterOwner({ additionalAssets: rows, desc: text }), 'asset', groupOf(rows, ['a', 'b']), 'a', modules, { ...DEFAULT_SETTINGS, ...settings })
        expect(run({}).closeNames.map((entry) => [entry.name, entry.via, entry.before, entry.after])).toEqual([['smile_n', 'imgSrc', 'smile_m', 'smile_m']])
        expect(run({ newImageHandlingBeta: false }).closeNames).toEqual([])
    })

    test('a module owner lists near names through img src only, over its own rows', () => {
        const rows: Rows = [assetRow('smile', 'assets/a.png'), assetRow('grin', 'assets/a.png')]
        const owner = moduleOwner({ assets: rows, lorebook: [{ content: '<img src="smile2"> {{img::smile2}}' }] })
        const result = buildMergePreview(owner, 'asset', groupOf(rows, ['smile', 'grin']), 'grin', [], DEFAULT_SETTINGS)
        expect(result.closeNames.map((entry) => [entry.via, entry.before, entry.after])).toEqual([['imgSrc', 'smile', null]])
        expect(result.matchedExactly).toBe(true)
    })
})

describe('the folder outcome of a merge', () => {
    function mergeWith(doc: unknown, rows: Rows = SAME_FILE_ROWS, names: string[] = ['smile', 'grin'], keptName = 'smile'): MergePreview {
        return buildMergePreview(ownerOf(rows, {}, doc), 'asset', groupOf(rows, names), keptName, [], DEFAULT_SETTINGS)
    }

    test('a kept name with no folder takes the removed name folder, and the removed entry is dropped', () => {
        const stored = folders(['F'], [['grin', 'F']])
        const result = mergeWith(stored)
        expect(result.folderOps).toEqual([
            { kind: 'assetFolderSet', name: 'smile', before: { had: false }, after: { had: true, value: 'F' } },
            { kind: 'assetFolderSet', name: 'grin', before: { had: true, value: 'F' }, after: { had: false } },
        ])
        expect(result.folderOutcome).toEqual({ state: 'ok', kept: 'F', from: 'removed', dropped: ['grin'] })
        expect(applyFolderOps(stored, result.folderOps)).toEqual({ ok: true, doc: folders(['F'], [['smile', 'F']]) })
    })

    test('a kept name that already has a folder keeps it and takes nothing', () => {
        const result = mergeWith(folders(['F', 'G'], [['grin', 'F'], ['smile', 'G']]))
        expect(result.folderOps).toEqual([{ kind: 'assetFolderSet', name: 'grin', before: { had: true, value: 'F' }, after: { had: false } }])
        expect(result.folderOutcome).toEqual({ state: 'ok', kept: 'G', from: 'kept', dropped: ['grin'] })
    })

    test('of several removed names with a folder, the first in group order gives its folder', () => {
        const rows: Rows = [assetRow('smile', 'assets/a.png'), assetRow('grin', 'assets/a.png'), assetRow('grim', 'assets/a.png')]
        const result = mergeWith(folders(['F', 'G'], [['grin', 'G'], ['grim', 'F']]), rows, ['smile', 'grin', 'grim'])
        expect(result.removedNames).toEqual(['grin', 'grim'])
        expect(result.folderOutcome).toEqual({ state: 'ok', kept: 'G', from: 'removed', dropped: ['grin', 'grim'] })
        expect(result.folderOps[0]).toEqual({ kind: 'assetFolderSet', name: 'smile', before: { had: false }, after: { had: true, value: 'G' } })
    })

    test('a case-only merge makes no folder op and lists no partial name', () => {
        const rows: Rows = [assetRow('Smile', 'assets/a.png'), assetRow('smile', 'assets/a.png')]
        const result = mergeWith(folders(['F'], [['Smile', 'F']]), rows, ['Smile', 'smile'])
        expect(result.folderOps).toEqual([])
        expect(result.folderOutcome).toEqual({ state: 'ok', kept: 'F', from: 'kept', dropped: [] })
        expect(result.partialNames).toEqual([])
    })

    test('an unreadable document gets no folder op and no outcome folder, and is kept byte for byte', () => {
        const stored = { v: 9, x: 1 }
        const result = mergeWith(stored)
        expect(result.folderOps).toEqual([])
        expect(result.folderOutcome).toEqual({ state: 'unreadable', kept: null, from: 'none', dropped: [] })
        expect(stored).toEqual({ v: 9, x: 1 })
    })

    test('no document gives no folder op and a none outcome', () => {
        const result = mergeWith(null)
        expect(result.folderOps).toEqual([])
        expect(result.folderOutcome).toEqual({ state: 'absent', kept: null, from: 'none', dropped: [] })
    })

    test('renaming the folder between two builds makes the models differ', () => {
        const first = mergeWith(folders(['F'], [['grin', 'F']]))
        const second = mergeWith(folders(['F2'], [['grin', 'F2']]))
        expect(mergePreviewEquals(first, second)).toBe(false)
    })

    test('names that fold alike make one carry and one drop, and the ops apply and undo', () => {
        const rows: Rows = [assetRow('Grin', 'assets/a.png'), assetRow('GRIN', 'assets/a.png'), assetRow('smile', 'assets/a.png')]
        const stored = folders(['F'], [['Grin', 'F']])
        const result = mergeWith(stored, rows, ['smile', 'Grin', 'GRIN'])
        expect(result.folderOps).toEqual([
            { kind: 'assetFolderSet', name: 'smile', before: { had: false }, after: { had: true, value: 'F' } },
            { kind: 'assetFolderSet', name: 'Grin', before: { had: true, value: 'F' }, after: { had: false } },
        ])
        const applied = applyFolderOps(stored, result.folderOps)
        expect(applied).toEqual({ ok: true, doc: folders(['F'], [['smile', 'F']]) })
        const undone = applied.ok ? applyFolderOps(applied.doc, result.folderOps.map(invertFolderOp).reverse()) : applied
        expect(undone).toEqual({ ok: true, doc: stored })
    })

    test('a removed name that keeps rows still gives its folder to the kept name and keeps its own entry', () => {
        const rows: Rows = [assetRow('smile', 'assets/a.png'), assetRow('grin', 'assets/a.png'), assetRow('grin', 'assets/b.png')]
        const stored = folders(['F'], [['grin', 'F']])
        const result = mergeWith(stored, rows)
        expect(result.partialNames).toEqual([{ name: 'grin', rowsLeft: 1 }])
        expect(result.folderOps).toEqual([{ kind: 'assetFolderSet', name: 'smile', before: { had: false }, after: { had: true, value: 'F' } }])
        expect(result.folderOutcome).toEqual({ state: 'ok', kept: 'F', from: 'removed', dropped: [] })
        expect(applyFolderOps(stored, result.folderOps)).toEqual({ ok: true, doc: folders(['F'], [['grin', 'F'], ['smile', 'F']]) })
    })

    test('the dropped names are the stored names of the drop ops, not the row names', () => {
        const rows: Rows = [assetRow('smile', 'assets/a.png'), assetRow('grin', 'assets/a.png')]
        const result = mergeWith(folders(['F'], [['GRIN', 'F']]), rows)
        expect(result.folderOutcome).toEqual({ state: 'ok', kept: 'F', from: 'removed', dropped: ['GRIN'] })
    })

    test('a removed name with no folder entry is not reported as dropped', () => {
        const rows: Rows = [assetRow('smile', 'assets/a.png'), assetRow('grin', 'assets/a.png'), assetRow('grim', 'assets/a.png')]
        const result = mergeWith(folders(['F'], [['grin', 'F']]), rows, ['smile', 'grin', 'grim'])
        expect(result.folderOutcome.dropped).toEqual(['grin'])
    })
})

describe('the names a merge leaves rows of', () => {
    const rows = (third: string, thirdPath: string): Rows => [assetRow('smile', 'assets/a.png'), assetRow('grin', 'assets/a.png'), assetRow(third, thirdPath)]
    const mergeOf = (liveRows: Rows) => buildMergePreview(
        characterOwner({ additionalAssets: liveRows, desc: 'a {{img::grin}} b' }),
        'asset',
        groupOf(rows('grin', 'assets/b.png'), ['smile', 'grin']),
        'smile',
        [],
        DEFAULT_SETTINGS,
    )

    test('a removed name that keeps a row elsewhere is listed with its remaining rows, and its reference is still rewritten', () => {
        const result = mergeOf(rows('grin', 'assets/b.png'))
        expect(result.partialNames).toEqual([{ name: 'grin', rowsLeft: 1 }])
        expect(result.textEdits.map((edit) => [edit.from, edit.to])).toEqual([['grin', 'smile']])
    })

    test('the remaining rows are counted by fold key', () => {
        expect(mergeOf(rows('GRIN', 'assets/b.png')).partialNames).toEqual([{ name: 'grin', rowsLeft: 1 }])
    })

    test('a change to a row outside the group changes the model and only the partial names', () => {
        const before = mergeOf(rows('grin', 'assets/b.png'))
        const after = mergeOf(rows('other', 'assets/b.png'))
        expect(after.partialNames).toEqual([])
        expect(mergePreviewEquals(before, after)).toBe(false)
        expect(mergePreviewEquals({ ...before, partialNames: after.partialNames }, after)).toBe(true)
    })
})

describe('what the setter applies is ordered, single and live', () => {
    test('the edits of one target are in strictly descending offset, and splicing them in list order is right', () => {
        const rows: Rows = [assetRow('Smile', 'assets/a.png'), assetRow('smile_bg', 'assets/a.png')]
        const text = '{{bg::Smile}}<hr>{{audio::Smile}}'
        const result = buildMergePreview(characterOwner({ additionalAssets: rows, backgroundHTML: text }), 'asset', groupOf(rows, ['Smile', 'smile_bg']), 'smile_bg', [], DEFAULT_SETTINGS)
        const offsets = result.textEdits.map((edit) => edit.offset)
        expect(offsets).toHaveLength(2)
        expect(offsets[0]).toBeGreaterThan(offsets[1])
        expect(spliceTextEdits(text, result.textEdits)).toBe('{{bg::smile_bg}}<hr>{{audio::smile_bg}}')
    })

    test('removed names that fold alike give one edit for one reference', () => {
        const rows: Rows = [assetRow('Grin', 'assets/a.png'), assetRow('GRIN', 'assets/a.png'), assetRow('smile', 'assets/a.png')]
        const text = 'x {{img::grin}} y'
        const result = buildMergePreview(characterOwner({ additionalAssets: rows, desc: text }), 'asset', groupOf(rows, ['smile', 'Grin', 'GRIN']), 'smile', [], DEFAULT_SETTINGS)
        expect(result.textEdits).toHaveLength(1)
        expect(spliceTextEdits(text, result.textEdits)).toBe('x {{img::smile}} y')
    })

    test('a group row whose path changed at the same index and name is missing, not removed', () => {
        const group = groupOf(SAME_FILE_ROWS, ['smile', 'grin'])
        const live: Rows = [assetRow('smile', 'assets/a.png'), assetRow('grin', 'assets/changed.png'), assetRow('other', 'assets/o.png')]
        const result = buildMergePreview(ownerOf(live), 'asset', group, 'smile', [], DEFAULT_SETTINGS)
        expect(result.rowOps).toEqual([])
        expect(result.missingRows).toEqual([1])
    })

    test('the live text of each edited restore-tracked target is in the model, and a change to it makes the models differ', () => {
        const build = (desc: string) => buildMergePreview(
            characterOwner({ additionalAssets: SAME_FILE_ROWS, desc, alternateGreetings: ['plain', '{{image::grin}} hi'], backgroundHTML: '{{bg::grin}}' }),
            'asset',
            groupOf(SAME_FILE_ROWS, ['smile', 'grin']),
            'smile',
            [],
            DEFAULT_SETTINGS,
        )
        const first = build('a {{image::grin}} b')
        expect(first.preWrite).toEqual([
            { target: 'desc', text: 'a {{image::grin}} b' },
            { target: 'alternateGreetings/1', text: '{{image::grin}} hi' },
        ])
        const second = build('a {{image::grin}} bb')
        expect(second.textEdits).toEqual(first.textEdits)
        expect(mergePreviewEquals(first, second)).toBe(false)
        expect(mergePreviewEquals({ ...first, preWrite: second.preWrite }, second)).toBe(true)
    })
})

describe('a group is not an owner', () => {
    test('a character owner of type group makes the preview throw a TypeError', () => {
        const group: TargetOwner = { kind: 'character', source: { type: 'group', additionalAssets: SAME_FILE_ROWS, desc: '{{image::grin}}' } }
        expect(() => buildMergePreview(group, 'asset', groupOf(SAME_FILE_ROWS, ['smile', 'grin']), 'smile', [], DEFAULT_SETTINGS)).toThrow(TypeError)
    })
})
