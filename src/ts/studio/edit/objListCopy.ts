// The words of the object-list family (the lorebook today): restore lines and notes, refusals, History step texts, the
// deleted-item preview and the decorator copy of the content field. Pure over `language`; the components call these so
// the wording lives in one place.
import { language } from '../../../lang'
import type { ObjRefusal } from '../history/historyModel'
import { OBJ_LIST_MESSAGES, type ObjListName } from '../history/objectLists'
import type { ObjDeletedItem, ObjLabel, PropLabel } from '../history/objectListOps'
import type { LoreDecoratorCopy } from '../longText/loreDecorators'
import { displayNameOf, isFolderRow } from './loreListModel'

/** The restore sheet's line: "undo n changes" for the list. */
export function objListLine(list: ObjListName, n: number): string {
    return language[OBJ_LIST_MESSAGES[list].line](n)
}

export function objListChanged(list: ObjListName): string {
    return language[OBJ_LIST_MESSAGES[list].changed]
}

/** The D8 note: the list's changes of an earlier visit are not undone by the field restore. */
export function objListEarlierVisit(list: ObjListName): string {
    return language[OBJ_LIST_MESSAGES[list].earlierVisit]
}

export function objListIdTaken(list: ObjListName): string {
    return language[OBJ_LIST_MESSAGES[list].idTaken]
}

export function objListMixed(list: ObjListName): string {
    return language[OBJ_LIST_MESSAGES[list].mixed]
}

/**
 * The refusal text of an object-list rule, or null when the generic precondition text says it (`changed`, or no list
 * rule at all), so the caller writes `objRefusalText(result) ?? refusalTextOf(result)`.
 */
export function objRefusalText(result: { obj?: ObjRefusal }): string | null {
    if (result.obj === undefined) return null
    switch (result.obj.kind) {
        case 'idTaken': return objListIdTaken(result.obj.list)
        case 'mixed': return objListMixed(result.obj.list)
        case 'changed': return null
    }
}

function fieldText(field: string | undefined): string {
    switch (field) {
        case 'comment': return language.name
        case 'key': return language.activationKeys
        case 'secondkey': return language.SecondaryKeys
        case 'content': return language.prompt
        case 'insertorder': return language.insertOrder
        case 'alwaysActive': return language.alwaysActive
        case 'selective': return language.selective
        case 'useRegex': return language.useRegexLorebook
        case 'extentions': return language.caseSensitive
        case 'activationPercent': return language.studioLoreLegacyProbabilityLabel
        case 'folder': return language.studioLoreFolder
        default: return field ?? language.loreBook
    }
}

/** The History text of one lorebook step. A step without a name shows what it is (an unnamed entry or folder). */
export function loreStepText(label: ObjLabel | PropLabel): string {
    if (label.kind === 'prop') return language.studioLoreStepSettings
    const folderAction = label.action === 'folderCreate' || label.action === 'folderRename' || label.action === 'folderDelete' || label.action === 'folderActive'
    const name = label.name ?? (folderAction ? language.sidebarUi.unnamedFolder : language.sidebarUi.unnamedLore)
    const count = label.count ?? 0
    switch (label.action) {
        case 'add': return language.studioLoreStepAdd(name)
        case 'delete': return language.studioLoreStepDelete(name)
        case 'edit': return label.field === 'probability' ? language.studioLoreStepProbability(name) : language.studioLoreStepEdit(fieldText(label.field), name)
        case 'move': return language.studioLoreStepMove(name)
        case 'duplicate': return language.studioLoreStepDuplicate(name)
        case 'import': return language.studioLoreStepImport(count)
        case 'folderCreate': return language.studioLoreStepFolderCreate(name)
        case 'folderRename': return language.studioLoreStepFolderRename(name)
        case 'folderDelete': return language.studioLoreStepFolderDelete(name, count)
        case 'folderActive': return language.studioLoreStepFolderActive(name)
        case 'bulkActive': return language.studioLoreStepBulkActive(count)
        case 'newId': return language.studioLoreStepNewId(name)
        case 'link': return language.studioLoreStepLink(name)
        case 'unlink': return language.studioLoreStepUnlink(name)
    }
}

/**
 * The History text of one group-member step. The name is the member's own; a member with no character behind it has
 * none and reads as the missing-member label.
 */
export function memberStepText(label: ObjLabel): string {
    const name = label.name ?? language.studioGroupMemberMissing
    switch (label.action) {
        case 'add': return language.studioMembersStepAdd(name)
        case 'delete': return language.studioMembersStepRemove(name)
        case 'edit': return label.field === 'active' ? language.studioMembersStepActive(name) : language.studioMembersStepTalk(name)
        default: return language.studioMembersStepTalk(name)
    }
}
/** The preview of a deleted item: the deleted entry (the folder, for a folder delete) and how many more went with it. */
export function objItemPreview(item: ObjDeletedItem): string {
    const subject = item.entries.find((e) => isFolderRow(e.entry)) ?? item.entries[0]
    if (subject === undefined) return language.loreBook
    const folder = isFolderRow(subject.entry)
    const name = displayNameOf(subject.entry) ?? (folder ? language.sidebarUi.unnamedFolder : language.sidebarUi.unnamedLore)
    return language.studioLoreDeletedPreview(name, item.entries.length - 1)
}

/** The content field's decorator copy, from the language table. */
export function loreDecoratorCopy(): LoreDecoratorCopy {
    return {
        unknown: (name) => language.studioLoreDecoUnknown(name),
        afterText: () => language.studioLoreDecoAfterText,
        badArg: (name) => language.studioLoreDecoBadArg(name),
        argMissing: (name) => language.studioLoreDecoArgMissing(name),
        probabilityNaN: () => language.studioLoreDecoProbabilityNaN,
        priorityNaN: () => language.studioLoreDecoPriorityNaN,
        probabilityMany: () => language.studioLoreDecoProbabilityMany,
        ignored: (name) => language.studioLoreDecoIgnored(name),
        fallback: () => language.studioLoreDecoFallback,
        deprecated: () => language.studioLoreDecoDeprecated,
        help: (name) => language.studioLoreDecoHelp[name],
        matches: (n) => language.studioLoreDecoMatches(n),
        listLabel: () => language.studioLoreDecoListLabel,
    }
}
