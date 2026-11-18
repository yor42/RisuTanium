// @vitest-environment jsdom
// The ops `buildAssetMerge` emits for a merge model built by the real preview: the first message and each touched
// alternate first message are one whole-value op each, placed at the position of their first edit; every other target
// keeps one `textEdit` per occurrence. A model that no longer fits the live text, an absent first message or an
// unreadable list refuses before an op is built.
import { describe, expect, test, vi } from 'vitest'
import { groupDuplicates } from '../assets/duplicateGroups'
import { assetRow, DEFAULT_SETTINGS, groupRow } from '../assets/assetFixtures.test-helpers'
import { buildMergePreview, type MergePreview } from '../assets/mergePreview'
import type { LiveReader, Op } from '../history/historyModel'
import type { character } from 'src/ts/storage/database.svelte'
import { buildAssetMerge, orderAssetWrites, type SurvivorDeps } from './assetSetters'
import { createLiveReader } from './studioSetters'

vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: { characters: [], modules: [] } },
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        clearCharEmotionCache: () => {},
    }
})

type Row = [string, string, string]

interface Subject {
    chaId: string
    desc: string
    firstMessage?: string
    alternateGreetings: string[] | undefined
    globalLore: { key: string; content: string }[]
    additionalAssets: Row[]
}

const byPathOnly: SurvivorDeps = { hashOf: () => undefined }

const FIRST = 'Hi {{image::smile2}} + {{image::smile2}}'
const FIRST_AFTER = 'Hi {{image::smile}} + {{image::smile}}'
const ALT0 = 'a {{image::smile2}} b {{image::smile2}}'
const ALT0_AFTER = 'a {{image::smile}} b {{image::smile}}'

function subject(over: Partial<Subject> = {}): Subject {
    return {
        chaId: 'A',
        desc: 'D {{image::smile2}}',
        firstMessage: FIRST,
        alternateGreetings: [ALT0, 'g1'],
        globalLore: [{ key: 'k', content: 'lore {{image::smile2}}' }],
        additionalAssets: [assetRow('smile', 'assets/a.png'), assetRow('wave', 'assets/w.png'), assetRow('smile2', 'assets/a.png')],
        ...over,
    }
}

function modelOf(source: Subject): MergePreview {
    const group = groupDuplicates(source.additionalAssets.map((row, index) => groupRow(row[0], row[1], index)))
        .find((candidate) => candidate.cls === 'sameFileDifferentNames')
    if (!group) {
        throw new Error('no candidate group')
    }
    return buildMergePreview({ kind: 'character', source: { ...source, alternateGreetings: source.alternateGreetings } }, 'asset', group, 'smile', [], DEFAULT_SETTINGS)
}

function readerOf(source: Subject): LiveReader {
    return createLiveReader({ character: source as unknown as character, chat: null })
}

function opsOf(source: Subject, model: MergePreview = modelOf(source)): Op[] {
    const built = buildAssetMerge(model, readerOf(source), byPathOnly)
    if (built.ok === false) {
        throw new Error('refused: ' + built.reason)
    }
    return built.ops
}

describe('the first message and each touched alternate are one whole-value op', () => {
    test('R2: two occurrences in the first message and two in alternate 0 give one set and one listSet, in registry order, beside the other edits', () => {
        const source = subject()
        const model = modelOf(source)
        // The model itself carries one edit per occurrence.
        expect(model.textEdits.map((edit) => [edit.target, edit.offset])).toEqual([
            ['desc', 11],
            ['firstMessage', 32],
            ['firstMessage', 12],
            ['alternateGreetings/0', 31],
            ['alternateGreetings/0', 11],
            ['lore/0/content', 14],
        ])

        expect(opsOf(source, model)).toEqual([
            { op: 'assetRowRemove', array: 'additionalAssets', index: 2, tuple: ['smile2', 'assets/a.png', 'png'], count: 1 },
            { op: 'textEdit', target: 'desc', offset: 11, from: 'smile2', to: 'smile' },
            { op: 'set', path: 'firstMessage', before: { had: true, value: FIRST }, after: { had: true, value: FIRST_AFTER } },
            { op: 'listSet', index: 0, before: ALT0, after: ALT0_AFTER },
            { op: 'textEdit', target: 'lore/0/content', offset: 14, from: 'smile2', to: 'smile' },
        ])
    })

    test('the name shortens by one character, so an edit at a lower offset is checked against the text the higher one left', () => {
        const source = subject({ firstMessage: 'x {{image::smile2}}{{image::smile2}}{{image::smile2}}' })
        const op = opsOf(source).find((candidate) => candidate.op === 'set')
        expect(op).toEqual({
            op: 'set',
            path: 'firstMessage',
            before: { had: true, value: 'x {{image::smile2}}{{image::smile2}}{{image::smile2}}' },
            after: { had: true, value: 'x {{image::smile}}{{image::smile}}{{image::smile}}' },
        })
    })

    test('an alternate entry that holds no name gets no op, and a merge with no text edit has only row ops', () => {
        const source = subject({ desc: 'plain', firstMessage: 'plain', alternateGreetings: ['plain', 'plain'], globalLore: [] })
        expect(opsOf(source).map((op) => op.op)).toEqual(['assetRowRemove'])
    })

    test('a character without a first message key gets no first message op', () => {
        const source = subject()
        delete source.firstMessage
        const ops = opsOf(source)
        expect(ops.some((op) => op.op === 'set')).toBe(false)
        expect(ops.map((op) => op.op)).toEqual(['assetRowRemove', 'textEdit', 'listSet', 'textEdit'])
    })
})

describe('the writes of a merge land rows first, then folder entries, then text and fields', () => {
    test('M12: a first message set and an alternate listSet follow the row and folder writes whatever order they were built in', () => {
        const ordered = orderAssetWrites([
            { op: 'set', path: 'firstMessage', value: { had: true, value: 'x' } },
            { op: 'listSet', index: 0, value: 'y' },
            { op: 'assetFolderSet', name: 'grin', before: { had: false }, after: { had: true, value: 'F' } },
            { op: 'assetRowRemove', array: 'additionalAssets', index: 2, tuple: ['grin', 'assets/a.png', 'png'], count: 1 },
            { op: 'textSet', target: 'lore/0/content', value: 'z' },
        ])
        expect(ordered.map((write) => write.op)).toEqual(['assetRowRemove', 'assetFolderSet', 'set', 'listSet', 'textSet'])
    })
})

describe('a model that no longer fits the live owner is refused before an op is built', () => {
    function refusal(source: Subject, model: MergePreview): string {
        const built = buildAssetMerge(model, readerOf(source), byPathOnly)
        return built.ok === false ? built.reason : 'built'
    }

    test('E2: a first message edit whose text moved', () => {
        const source = subject()
        const model = modelOf(source)
        source.firstMessage = 'Yo {{image::wave}} + {{image::wave}} and more text'
        expect(refusal(source, model)).toBe('precondition')
    })

    test('E2: an alternate edit whose text moved', () => {
        const source = subject()
        const model = modelOf(source)
        source.alternateGreetings = ['zz {{image::wave}} q {{image::wave}} extra', 'g1']
        expect(refusal(source, model)).toBe('precondition')
    })

    test('E2: a first message whose later edit no longer sits on its text while the first one still does', () => {
        const source = subject()
        const model = modelOf(source)
        source.firstMessage = 'Hi {{image::wave22}} + {{image::smile2}}'
        expect(refusal(source, model)).toBe('precondition')
    })

    test('an edit with an offset that is not a position is refused', () => {
        const source = subject()
        const model = modelOf(source)
        model.textEdits = model.textEdits.map((edit) => (edit.target === 'firstMessage' ? { ...edit, offset: -1 } : edit))
        expect(refusal(source, model)).toBe('precondition')
        model.textEdits = model.textEdits.map((edit) => (edit.target === 'firstMessage' ? { ...edit, offset: 1.5 } : edit))
        expect(refusal(source, model)).toBe('precondition')
    })

    test('an insertion at an offset that is not a position is refused, though an empty text matches anywhere', () => {
        const source = subject()
        const model = modelOf(source)
        for (const offset of [-1, 1.5]) {
            model.textEdits = [{ target: 'firstMessage', offset, from: '', to: 'x' }]
            expect(refusal(source, model)).toBe('precondition')
        }
    })

    test('a first message that is gone or not a string refuses', () => {
        const source = subject()
        const model = modelOf(source)
        delete source.firstMessage
        expect(refusal(source, model)).toBe('precondition')
        source.firstMessage = 5 as unknown as string
        expect(refusal(source, model)).toBe('precondition')
    })

    test('an alternate list that cannot be read, or an entry that is gone or not a string, refuses', () => {
        const source = subject()
        const model = modelOf(source)
        source.alternateGreetings = undefined
        expect(refusal(source, model)).toBe('precondition')
        source.alternateGreetings = []
        expect(refusal(source, model)).toBe('precondition')
        source.alternateGreetings = [7 as unknown as string, 'g1']
        expect(refusal(source, model)).toBe('precondition')
    })

    test('a module model that names a first message or an alternate refuses', () => {
        const source = subject()
        const model = modelOf(source)
        model.ownerKind = 'module'
        expect(refusal(source, model)).toBe('precondition')
        const lore = { ...model, textEdits: model.textEdits.filter((edit) => edit.target === 'lore/0/content') }
        expect(refusal(source, lore)).toBe('built')
    })

    test('a non-canonical alternate path is never converted: it stays a text edit, which the owner write refuses', () => {
        const source = subject()
        const model = modelOf(source)
        model.textEdits = [{ target: 'alternateGreetings/00', offset: 11, from: 'smile2', to: 'smile' }]
        expect(opsOf(source, model).filter((op) => op.op !== 'assetRowRemove')).toEqual([
            { op: 'textEdit', target: 'alternateGreetings/00', offset: 11, from: 'smile2', to: 'smile' },
        ])
    })
})
