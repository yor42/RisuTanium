import { language } from 'src/lang'
import type { StagingLabel } from '../format/types'
import type { Staging } from '../owner'
import type { BlockedReason, Store2BootNotice } from '../bootActive'
import type { SkippedLegacyEntry } from '../legacy/lenient'
import type { IncompleteItem } from '../legacy/resolve'
import type { FlaggedItem } from '../leafFallback'
import type { CharacterPart } from '../treeBytes'

/**
 * The text and shape of every boot screen, as plain data. A screen is a model (title, paragraphs, lists of names,
 * buttons in DOM order, the button that takes initial focus) and, for a question, the answer each button stands for.
 * Builders read `language` when they are called, so the caller sets the language first; they hold no state.
 *
 * Invariants:
 *  - Every name from the user's data is a plain string that the component renders as a text node: nothing here joins
 *    names with a separator that a name could contain, and nothing is truncated.
 *  - The first button of a question is the one that writes nothing, and initial focus is never on a button that writes:
 *    where every button acts, focus is `null` and goes to the heading.
 *  - No copy promises what the next start will do.
 */

export interface BootButton {
    key: string
    label: string
}

export interface BootList {
    heading: string | null
    items: readonly string[]
}

export interface BootScreenModel {
    title: string
    paragraphs: readonly string[]
    lists: readonly BootList[]
    /** Diagnostic text kept apart from the explanation (English, as the code reports it). */
    details: string | null
    /** In DOM order, top to bottom. */
    buttons: readonly BootButton[]
    /** The key of the button that takes initial focus; `null` puts focus on the heading. */
    focus: string | null
}

/** A screen that waits for one of its buttons; `answers` maps each button key to what the dispatch is told. */
export interface BootQuestion<T> {
    model: BootScreenModel
    answers: Readonly<Record<string, T>>
}

//#region language

export const BOOT_LANGUAGES = ['de', 'en', 'ko', 'cn', 'vi', 'zh-Hant', 'es'] as const

export type BootLanguage = typeof BOOT_LANGUAGES[number]

/**
 * The interface language a boot screen uses before the database has chosen one: the browser's language, English when it
 * is not one the app has. Differs from the welcome screen, which sends every `zh-*` tag to English: Traditional Chinese
 * tags (`zh-TW`, `zh-HK`, `zh-Hant*`) map to `zh-Hant` and the other `zh*` tags to `cn`.
 */
export function bootLanguage(tag: string | undefined | null): BootLanguage {
    const parts = (tag ?? '').toLowerCase().split('-')
    const first = parts[0]
    if (first === 'zh') {
        return parts.slice(1).some((part) => part === 'tw' || part === 'hk' || part.startsWith('hant')) ? 'zh-Hant' : 'cn'
    }
    const known = BOOT_LANGUAGES.find((candidate) => candidate === first)
    return known ?? 'en'
}

//#endregion

//#region names

/** A name the person gave, or the id with "(name unavailable)" when there is none to show. */
export function displayName(name: string | undefined | null, id: string | undefined | null): string {
    if (typeof name === 'string' && name.trim() !== '') {
        return name
    }
    const unavailable = language.store2Boot.nameUnavailable
    return typeof id === 'string' && id !== '' ? `${id} ${unavailable}` : unavailable
}

/** The local date and time of a time given in milliseconds. */
export function formatTime(milliseconds: number): string {
    return new Date(milliseconds).toLocaleString()
}

/** A numbered backup is named by its time in units of a tenth of a second. */
export function backupDate(backup: number): string {
    return formatTime(backup * 100)
}

//#endregion

//#region lists

/** A skipped block that is not a character is named by what it holds, never by its internal name; an unknown kind gets the generic label. */
function skippedKindLabel(kind: SkippedLegacyEntry['kind']): string {
    const text = language.store2Boot
    switch (kind) {
        case 'presets':
            return text.skippedPresets
        case 'modules':
            return text.skippedModules
        case 'loadouts':
            return text.skippedLoadouts
        case 'plugins':
            return text.skippedPlugins
        case 'pluginStorage':
            return text.skippedPluginStorage
        case 'ignored':
            return text.skippedConfig
        default:
            return text.skippedOther
    }
}

export function skippedList(skipped: readonly SkippedLegacyEntry[]): BootList {
    return {
        heading: language.store2Boot.withoutListHeading,
        items: skipped.map((entry) => entry.kind === 'character' ? displayName(null, entry.name) : skippedKindLabel(entry.kind)),
    }
}

function incompleteReasonText(reason: IncompleteItem['reason']): string {
    const text = language.store2Boot
    switch (reason) {
        case 'missing':
            return text.reasonMissing
        case 'unparsable':
            return text.reasonUnreadable
        case 'shape':
        case 'mismatch':
        case 'invalid':
            return text.reasonDamaged
        case 'collision':
            return text.reasonCollision
    }
}

export function incompleteList(items: readonly IncompleteItem[]): BootList {
    const text = language.store2Boot
    return {
        heading: text.incompleteListHeading,
        items: items.map((item) => {
            switch (item.kind) {
                case 'character':
                    return text.incompleteCharacterLine(displayName(item.name, item.chaId), incompleteReasonText(item.reason))
                case 'chat':
                    return text.incompleteChatLine(displayName(item.name, item.chaId), item.chatIndex + 1, incompleteReasonText(item.reason))
                case 'plugin':
                    return text.incompletePluginLine(item.slotKey, incompleteReasonText(item.reason))
            }
        }),
    }
}

type FlaggedState = FlaggedItem['why']

function flaggedStateText(states: ReadonlySet<FlaggedState>): string {
    const text = language.store2Boot
    if (states.size > 1) {
        return text.flaggedBoth
    }
    return states.has('damaged') ? text.flaggedDamaged : text.flaggedMissing
}

function flaggedPartName(part: CharacterPart): string {
    const text = language.store2Boot
    switch (part) {
        case 'core':
            return text.flaggedPartCore
        case 'lore':
            return text.flaggedPartLore
        case 'scripts':
            return text.flaggedPartScripts
        case 'al':
            return text.flaggedPartAl
        case 'il':
            return text.flaggedPartIl
    }
}

/** A chat id that starts with `~` is a position (`~<index>`, zero-based); any other is the chat's own id. */
function flaggedChatLabel(chatId: string): string {
    const text = language.store2Boot
    if (chatId.startsWith('~')) {
        const position = /^~(\d+)/.exec(chatId)
        if (position !== null) {
            return text.flaggedChatPosition(Number(position[1]) + 1)
        }
    }
    return text.flaggedChatId(chatId)
}

interface FlaggedGroup {
    name: string
    parts: Map<CharacterPart, Set<FlaggedState>>
    chats: Map<string, { count: number, states: Set<FlaggedState> }>
}

/** The damaged or missing parts, one list per character: its own parts by name, then its chats, several parts of one chat as one row. */
export function flaggedLists(items: readonly FlaggedItem[]): BootList[] {
    const groups = new Map<string, FlaggedGroup>()
    for (const item of items) {
        let group = groups.get(item.chaId)
        if (group === undefined) {
            group = { name: item.name, parts: new Map(), chats: new Map() }
            groups.set(item.chaId, group)
        } else if (group.name.trim() === '') {
            group.name = item.name
        }
        if (item.kind === 'character-part') {
            const states = group.parts.get(item.part) ?? new Set<FlaggedState>()
            states.add(item.why)
            group.parts.set(item.part, states)
        } else {
            const row = group.chats.get(item.chatId) ?? { count: 0, states: new Set<FlaggedState>() }
            row.count += 1
            row.states.add(item.why)
            group.chats.set(item.chatId, row)
        }
    }
    const text = language.store2Boot
    return [...groups].map(([chaId, group]) => ({
        heading: displayName(group.name, chaId),
        items: [
            ...[...group.parts].map(([part, states]) => text.flaggedPartLine(flaggedPartName(part), flaggedStateText(states))),
            ...[...group.chats].map(([chatId, row]) => text.flaggedChatLine(flaggedChatLabel(chatId), flaggedStateText(row.states), row.count)),
        ],
    }))
}

//#endregion

//#region questions

function reloadButton(): BootButton {
    return { key: 'reload', label: language.store2Boot.reload }
}

export function confirmConvertScreen(): BootQuestion<boolean> {
    const text = language.store2Boot
    return {
        model: {
            title: text.convertTitle,
            paragraphs: [text.convertBody, text.convertMemoryNote],
            lists: [],
            details: null,
            buttons: [{ key: 'convertNo', label: text.convertNo }, { key: 'convertYes', label: text.convertYes }],
            focus: 'convertNo',
        },
        answers: { convertNo: false, convertYes: true },
    }
}

/** The import button exists only when the page has a way to act on it; both remaining buttons act, so focus goes to the heading. */
export function declinedScreen(importAvailable: boolean): BootQuestion<'convert' | 'import'> {
    const text = language.store2Boot
    const buttons: BootButton[] = [{ key: 'declinedConvert', label: text.declinedConvert }]
    const answers: Record<string, 'convert' | 'import'> = { declinedConvert: 'convert' }
    if (importAvailable) {
        buttons.push({ key: 'declinedImport', label: text.declinedImport })
        answers.declinedImport = 'import'
    }
    return {
        model: { title: text.declinedTitle, paragraphs: [importAvailable ? text.declinedBodyWithImport : text.declinedBody], lists: [], details: null, buttons, focus: null },
        answers,
    }
}

export function confirmFromBackupScreen(backup: number): BootQuestion<'convert' | 'decline'> {
    const text = language.store2Boot
    return {
        model: {
            title: text.fromBackupTitle,
            paragraphs: [text.fromBackupBody(backupDate(backup))],
            lists: [],
            details: null,
            buttons: [{ key: 'fromBackupNo', label: text.fromBackupNo }, { key: 'fromBackupYes', label: text.fromBackupYes }],
            focus: 'fromBackupNo',
        },
        answers: { fromBackupNo: 'decline', fromBackupYes: 'convert' },
    }
}

export function confirmConvertWithoutScreen(skipped: readonly SkippedLegacyEntry[]): BootQuestion<'convert' | 'decline'> {
    const text = language.store2Boot
    return {
        model: {
            title: text.withoutTitle,
            paragraphs: skipped.length > 0 ? [text.withoutBody] : [text.withoutBody, text.withoutNothingNamed],
            lists: skipped.length > 0 ? [skippedList(skipped)] : [],
            details: null,
            buttons: [{ key: 'withoutNo', label: text.withoutNo }, { key: 'withoutYes', label: text.withoutYes }],
            focus: 'withoutNo',
        },
        answers: { withoutNo: 'decline', withoutYes: 'convert' },
    }
}

export function confirmIncompleteScreen(items: readonly IncompleteItem[]): BootQuestion<boolean> {
    const text = language.store2Boot
    return {
        model: {
            title: text.incompleteTitle,
            paragraphs: [text.incompleteBody],
            lists: [incompleteList(items)],
            details: null,
            buttons: [{ key: 'incompleteNo', label: text.incompleteNo }, { key: 'incompleteYes', label: text.incompleteYes }],
            focus: 'incompleteNo',
        },
        answers: { incompleteNo: false, incompleteYes: true },
    }
}

export function confirmFlaggedOpenScreen(items: readonly FlaggedItem[]): BootQuestion<'continue' | 'decline' | 'earlier'> {
    const text = language.store2Boot
    return {
        model: {
            title: text.flaggedTitle,
            paragraphs: [text.flaggedBody, text.flaggedListHeading],
            lists: flaggedLists(items),
            details: null,
            buttons: [
                { key: 'flaggedDecline', label: text.flaggedDecline },
                { key: 'flaggedContinue', label: text.flaggedContinue },
                { key: 'flaggedEarlier', label: text.flaggedEarlier },
            ],
            focus: 'flaggedDecline',
        },
        answers: { flaggedDecline: 'decline', flaggedContinue: 'continue', flaggedEarlier: 'earlier' },
    }
}

function operationText(label: StagingLabel): string {
    const text = language.store2Boot
    switch (label) {
        case 'convert':
            return text.foreignOpConvert
        case 'seed':
            return text.foreignOpSeed
        case 'import':
            return text.foreignOpImport
        case 'restore':
            return text.foreignOpRestore
        case 'recovery':
            return text.foreignOpRecovery
        case 'bulk':
            return text.foreignOpBulk
    }
}

export function foreignMarkerScreen(marker: Staging): BootQuestion<'wait' | 'clear'> {
    const text = language.store2Boot
    return {
        model: {
            title: text.foreignTitle,
            paragraphs: [text.foreignBody(operationText(marker.label), formatTime(marker.startedAt))],
            lists: [],
            details: null,
            buttons: [{ key: 'foreignWait', label: text.foreignWait }, { key: 'foreignClear', label: text.foreignClear }],
            focus: 'foreignWait',
        },
        answers: { foreignWait: 'wait', foreignClear: 'clear' },
    }
}

//#endregion

//#region terminal screens

/** A screen the page stays on: the one button reloads, and it writes nothing. */
function terminal(title: string, paragraphs: readonly string[], details: string | null, focus: 'reload' | null): BootScreenModel {
    return { title, paragraphs, lists: [], details, buttons: [reloadButton()], focus }
}

export function stoppedScreen(): BootScreenModel {
    const text = language.store2Boot
    return terminal(text.stoppedTitle, [text.stoppedBody], null, 'reload')
}

export function offerScreen(backups: readonly number[]): BootScreenModel {
    const text = language.store2Boot
    const newest = backups.length > 0 ? Math.max(...backups) : 0
    return terminal(text.offerTitle, [text.offerBody(backups.length, backupDate(newest))], null, null)
}

export function tooNewScreen(): BootScreenModel {
    const text = language.store2Boot
    return terminal(text.tooNewTitle, [text.tooNewBody], null, 'reload')
}

type BlockedKind = 'read' | 'unwritable' | 'refused' | 'markerFailed' | 'exhausted' | 'standing' | 'install'

/**
 * What each reason says and whether the reason itself implies that nothing was written. "Nothing was changed" is added
 * only when both hold: the reason is a before-write one (a reason that leaves a marker or staged units standing never
 * is) and the boot does not report `mayHaveWritten` (any write this boot made through the dispatch sets it, an install included; the session's own owner-id store and
 * same-bytes re-flush change no data and are not counted).
 * A new reason without an entry fails the type check.
 */
export const BLOCKED_TABLE: Readonly<Record<BlockedReason, { kind: BlockedKind, beforeWrite: boolean }>> = {
    'no-backend': { kind: 'read', beforeWrite: true },
    'commit-key-unreadable': { kind: 'read', beforeWrite: true },
    'commit-unreadable': { kind: 'read', beforeWrite: true },
    'tree-unreadable': { kind: 'read', beforeWrite: true },
    'main-file-unknown': { kind: 'read', beforeWrite: true },
    'backups-unlistable': { kind: 'read', beforeWrite: true },
    'store2-profile-unwritable': { kind: 'unwritable', beforeWrite: true },
    'no-profile-unwritable': { kind: 'unwritable', beforeWrite: true },
    'first-life-refused': { kind: 'refused', beforeWrite: true },
    'assemble-failed': { kind: 'read', beforeWrite: true },
    'convert-read-failed': { kind: 'read', beforeWrite: true },
    'convert-main-unreadable': { kind: 'read', beforeWrite: true },
    'convert-lenient-failed': { kind: 'read', beforeWrite: true },
    'presence-unknown': { kind: 'read', beforeWrite: true },
    'marker-failed': { kind: 'markerFailed', beforeWrite: true },
    'reclassify-exhausted': { kind: 'exhausted', beforeWrite: false },
    'own-marker-not-cleared': { kind: 'standing', beforeWrite: false },
    'foreign-marker-unreadable': { kind: 'standing', beforeWrite: false },
    'foreign-clear-failed': { kind: 'standing', beforeWrite: false },
    'install-unknown': { kind: 'install', beforeWrite: false },
    'install-invalid': { kind: 'install', beforeWrite: false },
    'install-failed': { kind: 'install', beforeWrite: false },
    'install-upload-failed': { kind: 'install', beforeWrite: false },
}

function blockedKindText(kind: BlockedKind): string {
    const text = language.store2Boot
    switch (kind) {
        case 'read':
            return text.blockedRead
        case 'unwritable':
            return text.blockedUnwritable
        case 'refused':
            return text.blockedRefused
        case 'markerFailed':
            return text.blockedMarkerFailed
        case 'exhausted':
            return text.blockedExhausted
        case 'standing':
            return text.blockedStanding
        case 'install':
            return text.blockedInstall
    }
}

export function blockedScreen(blocked: { reason: BlockedReason, detail: string, mayHaveWritten: boolean }): BootScreenModel {
    const text = language.store2Boot
    const entry = BLOCKED_TABLE[blocked.reason]
    const paragraphs = entry.beforeWrite && !blocked.mayHaveWritten ? [blockedKindText(entry.kind), text.blockedNothingChanged] : [blockedKindText(entry.kind)]
    return terminal(text.blockedTitle, paragraphs, `${text.blockedDetailsHeading}: ${blocked.reason}: ${blocked.detail}`, 'reload')
}

//#endregion

//#region notices

/**
 * The text of a notice the page posts once the database (and so its language) is installed. `too-new` is shown at once as
 * a terminal screen, never as a notice; it has no text here.
 */
export function noticeText(notice: Store2BootNotice): string | null {
    const text = language.store2Boot
    switch (notice.name) {
        case 'seeded':
            return text.noticeSeeded
        case 'cleanup-blocked':
            return text.noticeCleanupBlocked
        case 'reflush-failed':
            return text.noticeReflushFailed
        case 'flush-unconfirmed':
            return text.noticeFlushUnconfirmed
        case 'converted-from-backup':
            return text.noticeConvertedFromBackup(backupDate(notice.backup))
        case 'server-capability':
            return text.noticeServerCapability
        case 'backend-unavailable':
            return text.noticeBackendUnavailable
        case 'too-new':
            return null
    }
}

//#endregion
