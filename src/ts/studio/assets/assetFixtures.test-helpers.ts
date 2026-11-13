// Synthetic fixtures for the asset-list modules, shaped like the real producers:
// - a blank character's trigger list is `createBlankChar`'s v2 template (a `v2Header` with `code: ''` and one named
//   manual trigger), and the Lua list is the TriggerList component's Lua template;
// - creator comments are stored the way `MultiLangInput` writes them, through `encodeMultilangString`
//   (the same output: the untagged prefix, then one section per key, `xx` included);
// - an asset row is the stored `[name, path, ext]` tuple, an emotion row `[name, path]`.
import type { GroupRow } from './duplicateGroups'
import type { CharacterTargetFields, ModuleTargetFields, TargetOwner, TriggerListLike } from './referenceTargets'
import type { TextEdit } from './referenceRewrite'

/** The v2 template of a blank character (`createBlankChar`) and the TriggerList V2 switch. */
export function blankV2Triggers(): TriggerListLike[] {
    return [{
        comment: '',
        type: 'manual',
        conditions: [],
        effect: [{ type: 'v2Header', code: '', indent: 0 }],
    }, {
        comment: 'New Event',
        type: 'manual',
        conditions: [],
        effect: [],
    }]
}

/** A named v2 trigger holding the given effects. The container's `type` and `comment` are not scanned. */
export function v2Trigger(effects: object[], conditions: object[] = []): TriggerListLike {
    return { comment: 'event', type: 'manual', conditions, effect: effects }
}

/** The Lua template of the TriggerList component. */
export function luaTriggers(code: string): TriggerListLike[] {
    return [{
        comment: '',
        type: 'start',
        conditions: [],
        effect: [{ type: 'triggerlua', code }],
    }]
}

/** `encodeMultilangString`: the `xx` text as the prefix, then a section for every key. */
export function encodeCreatorNotes(data: Record<string, string>): string {
    let result = ''
    if (data.xx) {
        result = data.xx
    }
    for (const key of Object.keys(data)) {
        result = `${result}\n# \`${key}\`\n${data[key]}`
    }
    return result
}

export function characterOwner(fields: CharacterTargetFields = {}): TargetOwner {
    return { kind: 'character', source: fields }
}

export function moduleOwner(fields: ModuleTargetFields = {}): TargetOwner {
    return { kind: 'module', source: fields }
}

/** The stored asset tuple of an additional asset. */
export function assetRow(name: string, path: string, ext = 'png'): [string, string, string] {
    return [name, path, ext]
}

/** A group row at `index`. */
export function groupRow(name: string, path: string, index: number, extra: Partial<GroupRow> = {}): GroupRow {
    return { name, path, index, ...extra }
}

/** A 64-hex content-addressed path stem, so a hash path looks like the store's own. */
export function hashPath(letter: string, extension: string): string {
    return 'assets/' + letter.repeat(64) + '.' + extension
}

/** Applies a plan's edits, which are in apply order, to the text of one target. */
export function applyEditsTo(text: string, target: string, edits: readonly TextEdit[]): string {
    let result = text
    for (const edit of edits.filter((candidate) => candidate.target === target)) {
        result = result.slice(0, edit.offset) + edit.to + result.slice(edit.offset + edit.from.length)
    }
    return result
}

export const DEFAULT_SETTINGS = { assetMaxDifference: 4, legacyMediaFindings: false, newImageHandlingBeta: true }
