/**
 * The click-time merge guarantee and the pure helpers of the preview. `mergeAtClick` is tested over models from
 * `buildMergePreview` over real-shaped owners (the producer), each change made between the preview and the click. The
 * labels run over the language mock, which answers every function key with `key(args)`.
 */
import { describe, expect, test, vi } from 'vitest'

vi.mock('src/lang', () => {
    const call = (key: string) => (...args: (string | number)[]) => `${key}(${args.join(',')})`
    const table: Record<string, unknown> = {}
    for (const key of [
        'studioAssetPlaceNumbered', 'studioAssetPlaceAltFirstMessage', 'studioAssetPlaceTriggerEffect', 'studioAssetPlaceTriggerCondition',
        'studioAssetMergeChats', 'studioAssetMergeAtLeast', 'studioAssetMergeArchivedChats',
    ]) table[key] = call(key)
    return { language: new Proxy(table, { get: (target, key) => (typeof key === 'symbol' ? undefined : key in target ? target[key] : key) }) }
})

import { ASSET_FOLDER_KEY } from './assetOwnerKeys'
import { assetRow, DEFAULT_SETTINGS, groupRow } from './assetFixtures.test-helpers'
import { groupDuplicates, type DuplicateGroup, type GroupRow } from './duplicateGroups'
import {
    confirmFactsOf, groupByPlace, jumpTargetOf, mergeAtClick, mergeToastLine, needsConfirm, ownerSnapshotOf, ownerSnapshotsEqual, placeLabelOf,
} from './mergeCommit'
import type { EnablingCountResult } from './mergeCounts'
import { buildMergePreview, type MergePreview } from './mergePreview'
import type { CharacterTargetFields, TargetOwner } from './referenceTargets'

type Rows = [string, string, string][]

const SAME_FILE_ROWS = (): Rows => [assetRow('smile', 'assets/a.png'), assetRow('grin', 'assets/a.png'), assetRow('other', 'assets/o.png')]

function groupOf(rows: readonly (readonly string[])[]): DuplicateGroup<GroupRow> {
    const group = groupDuplicates(rows.map((row, index) => groupRow(row[0], row[1], index))).find((candidate) => candidate.cls === 'sameFileDifferentNames')
    if (!group) throw new Error('no candidate group')
    return group
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

interface MutableCharacter extends Mutable<CharacterTargetFields> {
    additionalAssets: Rows
    globalLore: { content: string }[]
    extentions: Record<string, unknown>
}

// A character as the database holds it: every field the registry reads, as plain mutable data.
function character(): MutableCharacter {
    return {
        desc: 'a {{image::grin}} b',
        additionalAssets: SAME_FILE_ROWS(),
        globalLore: [{ content: 'plain' }],
        extentions: { [ASSET_FOLDER_KEY]: { v: 1, additional: { order: ['Faces'], of: [['grin', 'Faces'], ['smile', 'Faces']] } } },
    }
}

function rig(source: MutableCharacter = character()) {
    const owner: TargetOwner = { kind: 'character', source }
    const group = groupOf(SAME_FILE_ROWS())
    const rebuild = (): MergePreview => buildMergePreview(owner, 'asset', group, 'smile', [], DEFAULT_SETTINGS)
    return { source, owner, rebuild, previewed: rebuild() }
}

describe('mergeAtClick', () => {
    // Each change is made after the preview and before the click; the rebuild at the click sees it, so nothing is applied.
    const changes: [string, (source: MutableCharacter) => void][] = [
        ['a folder move', (source) => { source.extentions[ASSET_FOLDER_KEY] = { v: 1, additional: { order: ['Faces', 'Other'], of: [['grin', 'Faces'], ['smile', 'Other']] } } }],
        ['an appended entry with the old name', (source) => { source.globalLore.push({ content: '{{image::grin}}' }) }],
        ['a row change', (source) => { source.additionalAssets.push(assetRow('grin', 'assets/b.png')) }],
        ['a new flagged reference', (source) => { source.defaultVariables = 'mood=grin' }],
    ]

    test.each(changes)('%s between the preview and the click: stale, and apply is never called', (_name, change) => {
        const { source, rebuild, previewed } = rig()
        change(source)
        const apply = vi.fn()
        expect(mergeAtClick(previewed, rebuild, apply)).toEqual({ kind: 'stale' })
        expect(apply).not.toHaveBeenCalled()
    })

    test('no change: apply is given a model deep-equal to the previewed one, and its result comes back', () => {
        const { rebuild, previewed } = rig()
        const apply = vi.fn((current: MergePreview) => ({ ok: true, rows: current.rowOps.length }))
        const outcome = mergeAtClick(previewed, rebuild, apply)
        expect(outcome).toEqual({ kind: 'applied', result: { ok: true, rows: 1 } })
        expect(apply).toHaveBeenCalledTimes(1)
        expect(apply.mock.calls[0][0]).toEqual(previewed)
    })

    test('the model that is applied is the rebuilt one, not the previewed object', () => {
        const { rebuild, previewed } = rig()
        const seen: MergePreview[] = []
        mergeAtClick(previewed, rebuild, (current) => { seen.push(current) })
        expect(seen[0]).not.toBe(previewed)
    })

    test('the rebuild is read once per click and the compare and the apply follow it in the same call', () => {
        const { previewed } = rig()
        const order: string[] = []
        mergeAtClick(previewed, () => { order.push('rebuild'); return previewed }, () => { order.push('apply') })
        expect(order).toEqual(['rebuild', 'apply'])
    })
})

describe('the early staleness snapshot', () => {
    test('equal owners give equal snapshots, and a text, a row or the folder document each differ', () => {
        const base = character()
        const same = ownerSnapshotOf({ kind: 'character', source: base }, 'additionalAssets')
        expect(ownerSnapshotsEqual(same, ownerSnapshotOf({ kind: 'character', source: character() }, 'additionalAssets'))).toBe(true)
        const text = character()
        text.desc = 'a {{image::grin}} c'
        const row = character()
        row.additionalAssets[2] = assetRow('other', 'assets/p.png')
        const folder = character()
        folder.extentions[ASSET_FOLDER_KEY] = { v: 1, additional: { order: ['Faces'], of: [['grin', 'Faces']] } }
        for (const changed of [text, row, folder]) {
            expect(ownerSnapshotsEqual(same, ownerSnapshotOf({ kind: 'character', source: changed }, 'additionalAssets'))).toBe(false)
        }
    })

    test('an appended entry, a removed entry and two swapped entries differ although every string stays among the texts', () => {
        const base = character()
        base.globalLore = [{ content: 'one' }, { content: 'two' }]
        const snapshot = (lore: { content: string }[]) => ownerSnapshotOf({ kind: 'character', source: { ...base, globalLore: lore } }, 'additionalAssets')
        const original = snapshot(base.globalLore)
        expect(ownerSnapshotsEqual(original, snapshot([...base.globalLore, { content: '' }]))).toBe(false)
        expect(ownerSnapshotsEqual(original, snapshot([base.globalLore[0]]))).toBe(false)
        expect(ownerSnapshotsEqual(original, snapshot([base.globalLore[1], base.globalLore[0]]))).toBe(false)
    })

    test('an unreadable folder document is compared by its stored value', () => {
        const unreadable = character()
        unreadable.extentions[ASSET_FOLDER_KEY] = { v: 9, additional: 'x' }
        const other = character()
        other.extentions[ASSET_FOLDER_KEY] = { v: 9, additional: 'y' }
        expect(ownerSnapshotsEqual(ownerSnapshotOf({ kind: 'character', source: unreadable }, 'additionalAssets'), ownerSnapshotOf({ kind: 'character', source: other }, 'additionalAssets'))).toBe(false)
    })
})

describe('place labels', () => {
    test('a field is named by its own label; a list entry by its kind and a 1-based index', () => {
        expect(placeLabelOf('character', 'desc')).toBe('description')
        expect(placeLabelOf('character', 'firstMessage')).toBe('firstMessage')
        expect(placeLabelOf('character', 'systemPrompt')).toBe('systemPrompt')
        expect(placeLabelOf('character', 'lore/0/content')).toBe('studioAssetPlaceNumbered(loreBook,1)')
        expect(placeLabelOf('character', 'regex/2/out')).toBe('studioAssetPlaceNumbered(regexScript,3)')
        expect(placeLabelOf('module', 'backgroundEmbedding')).toBe('backgroundHTML')
    })

    test('an alternate first message says first message, never greeting', () => {
        expect(placeLabelOf('character', 'alternateGreetings/0')).toBe('studioAssetPlaceAltFirstMessage(1)')
        expect(placeLabelOf('character', 'alternateGreetings/4')).toBe('studioAssetPlaceAltFirstMessage(5)')
    })

    test('the nested fields reuse the classic labels, and a trigger field takes two 1-based indices', () => {
        expect(placeLabelOf('character', 'depth_prompt/prompt')).toBe('depthPrompt')
        expect(placeLabelOf('character', 'newGenData/prompt')).toBe('imgGenPrompt')
        expect(placeLabelOf('character', 'newGenData/negative')).toBe('imgGenNegatives')
        expect(placeLabelOf('character', 'newGenData/instructions')).toBe('imgGenInstructions')
        expect(placeLabelOf('character', 'newGenData/emotionInstructions')).toBe('emotionInstructions')
        expect(placeLabelOf('character', 'trigger/1/effect/2/value')).toBe('studioAssetPlaceTriggerEffect(triggerScript,2,3,value)')
        expect(placeLabelOf('module', 'trigger/0/conditions/0/value')).toBe('studioAssetPlaceTriggerCondition(triggerScript,1,1,value)')
    })

    test('a path that is no registry address is shown as it is', () => {
        expect(placeLabelOf('character', 'nope/x')).toBe('nope/x')
        expect(placeLabelOf('module', 'alternateGreetings/0')).toBe('alternateGreetings/0')
    })
})

describe('where a place is jumped to', () => {
    test('lore and regex entries by index, triggers at the scripts item, the background at html, first messages at basic, the rest at advanced', () => {
        expect(jumpTargetOf('character', 'A', 'lore/3/content')).toEqual({ kind: 'lore', itemId: 'A/lore:3' })
        expect(jumpTargetOf('character', 'A', 'regex/1/out')).toEqual({ kind: 'regex', itemId: 'A/regex:1' })
        expect(jumpTargetOf('character', 'A', 'trigger/2/effect/0/value')).toEqual({ kind: 'scripts', itemId: 'A/scripts:0' })
        expect(jumpTargetOf('character', 'A', 'backgroundHTML')).toEqual({ kind: 'html', itemId: 'A/html:0' })
        expect(jumpTargetOf('character', 'A', 'desc')).toEqual({ kind: 'basic', itemId: 'A/basic:0' })
        expect(jumpTargetOf('character', 'A', 'alternateGreetings/1')).toEqual({ kind: 'basic', itemId: 'A/basic:0' })
        expect(jumpTargetOf('character', 'A', 'systemPrompt')).toEqual({ kind: 'advanced', itemId: 'A/advanced:0' })
        expect(jumpTargetOf('character', 'A', 'newGenData/prompt')).toEqual({ kind: 'advanced', itemId: 'A/advanced:0' })
        expect(jumpTargetOf('module', 'm1', 'backgroundEmbedding')).toEqual({ kind: 'html', itemId: 'm1/html:0' })
        expect(jumpTargetOf('module', 'm1', 'lore/0/content')).toEqual({ kind: 'lore', itemId: 'm1/lore:0' })
    })

    test('a path that is no registry address has no target', () => {
        expect(jumpTargetOf('character', 'A', 'lore/x/content')).toBeNull()
    })
})

test('hits are grouped by place in order of first appearance', () => {
    const grouped = groupByPlace([{ path: 'desc', n: 1 }, { path: 'lore/0/content', n: 2 }, { path: 'desc', n: 3 }])
    expect(grouped.map((place) => [place.path, place.items.map((item) => item.n)])).toEqual([['desc', [1, 3]], ['lore/0/content', [2]]])
})

describe('what the module confirm and the merge toast say of the counts', () => {
    const result = (over: Partial<EnablingCountResult>): EnablingCountResult => ({ state: 'done', characters: [], archivedCharacters: 0, ...over })

    test('a scan that has not answered, failed or aborted is unfinished and opens the confirm', () => {
        expect(needsConfirm(confirmFactsOf(null))).toBe(true)
        expect(needsConfirm(confirmFactsOf(result({ state: 'failed' })))).toBe(true)
        expect(needsConfirm(confirmFactsOf(result({ state: 'aborted' })))).toBe(true)
    })

    test('hits in a character text or a chat, or an archived character, open it; a finished scan with neither does not', () => {
        expect(needsConfirm(confirmFactsOf(result({ characters: [{ chaId: 'a', textHits: 1, chatHits: 0, archivedChats: 0 }] })))).toBe(true)
        expect(needsConfirm(confirmFactsOf(result({ characters: [{ chaId: 'a', textHits: 0, chatHits: 2, archivedChats: 0 }] })))).toBe(true)
        expect(needsConfirm(confirmFactsOf(result({ archivedCharacters: 1 })))).toBe(true)
        const quiet = confirmFactsOf(result({ characters: [{ chaId: 'a', textHits: 0, chatHits: 0, archivedChats: 3 }] }))
        expect(quiet).toEqual({ hits: [], archived: 0, finished: true })
        expect(needsConfirm(quiet)).toBe(false)
    })

    test('the facts list every character with hits and the sum of its two counts', () => {
        const facts = confirmFactsOf(result({ characters: [
            { chaId: 'a', textHits: 1, chatHits: 2, archivedChats: 0 },
            { chaId: 'b', textHits: 0, chatHits: 0, archivedChats: 0 },
            { chaId: 'c', textHits: 0, chatHits: 4, archivedChats: 0 },
        ] }))
        expect(facts.hits).toEqual([{ chaId: 'a', count: 3 }, { chaId: 'c', count: 4 }])
    })

    test('the toast line for a character owner: the chats, "at least n" while unfinished, and the archived chats', () => {
        expect(mergeToastLine('character', ['grin'], { state: 'done', chats: 3, archivedChats: 0 })).toBe('studioAssetMergeChats(3,grin)')
        expect(mergeToastLine('character', ['grin', 'glad'], { state: 'done', chats: 0, archivedChats: 2 })).toBe('studioAssetMergeArchivedChats(2)')
        expect(mergeToastLine('character', ['grin'], { state: 'aborted', chats: 2, archivedChats: 1 })).toBe('studioAssetMergeChats(studioAssetMergeAtLeast(2),grin) studioAssetMergeArchivedChats(1)')
        expect(mergeToastLine('character', ['grin'], null)).toBe('studioAssetMergeChats(studioAssetMergeAtLeast(0),grin)')
        expect(mergeToastLine('character', ['grin'], { state: 'done', chats: 0, archivedChats: 0 })).toBeUndefined()
    })

    test('a module owner has no chat line', () => {
        expect(mergeToastLine('module', ['grin'], { state: 'done', chats: 5, archivedChats: 0 })).toBeUndefined()
    })
})
