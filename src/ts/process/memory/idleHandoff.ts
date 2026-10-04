/**
 * What an idle reload hands to the page that follows it: which character was
 * open and which characters must stay inline (the selection part), the unsent
 * text of chats that were not on screen (the drafts part), and the history that
 * limits how often the reload may happen.
 *
 * The two parts live in per-tab browser storage on the web and in a file in the
 * app's own data folder on the desktop. They are never part of the save, are
 * never read by a restore of a backup, and never enter a backup. The selection
 * part expires; the drafts part never does, and is deleted only after the page
 * that put its text back has committed a save, or by the page that wrote it when
 * it abandons the reload before the page goes away. A part still present when a
 * new idle reload writes is replaced by the drafts of the live page.
 */

import {
    exportRecords,
    restoreRecord,
    composerDraftsVersion,
    type ComposerDraftCarry,
} from '../composerDrafts.svelte'
import { draftContentOrphanGate } from '../../draftContentOrphanGate'
import { SELECTION_FRESH_MS } from './idleGate'

export type HandoffPart = 'selection' | 'drafts'

export interface SelectionPart {
    v: 1
    reason: 'idle'
    at: number
    /** The selected character, or null when none was selected. */
    chaId: string | null
    /** The selected character and, for a group, its members. */
    keepInline: string[]
}

export interface DurableDraftCarry {
    key: string
    text: string
    baseData: string
    updatedAt: number
    index?: number
}

export interface DraftsPart {
    v: 1
    at: number
    /** Oldest write first. */
    composer: ComposerDraftCarry[]
    /** Least recently used first. */
    durable: DurableDraftCarry[]
}

/** A medium whose every call completes before it returns: the web's per-tab storage. */
export interface SyncHandoffMedium {
    read(part: HandoffPart): string | null
    /** True only when the text reads back whole. */
    write(part: HandoffPart, text: string): boolean
    remove(part: HandoffPart): void
}

/** Either kind of medium; the desktop's file completes asynchronously. */
export interface HandoffMedium {
    read(part: HandoffPart): string | null | Promise<string | null>
    write(part: HandoffPart, text: string): boolean | Promise<boolean>
    remove(part: HandoffPart): void | Promise<void>
}

const PART_KEY_PREFIX = 'risu-idle-handoff:'
const HISTORY_KEY = 'risu-idle-reload-history'

export function createStorageMedium(storage: Storage): SyncHandoffMedium {
    return {
        read: (part) => storage.getItem(PART_KEY_PREFIX + part),
        write: (part, text) => {
            storage.setItem(PART_KEY_PREFIX + part, text)
            return storage.getItem(PART_KEY_PREFIX + part) === text
        },
        remove: (part) => storage.removeItem(PART_KEY_PREFIX + part),
    }
}

/** The file system calls the desktop medium needs; paths are relative to the app's data folder. */
export interface HandoffFiles {
    /** The file's bytes, or null when it does not exist. */
    read(path: string): Promise<Uint8Array | null>
    /** Replaces the file whole, or leaves it as it was. */
    writeAtomic(path: string, bytes: Uint8Array): Promise<void>
    remove(path: string): Promise<void>
}

/** A file of the app's own data folder, outside the folders that are swept, listed or backed up. */
export const HANDOFF_FILE_PATH = 'idle-reload-handoff.json'

type FileDocument = Partial<Record<HandoffPart, string>>

function parseDocument(bytes: Uint8Array): FileDocument | null {
    try {
        const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            return null
        }
        const record = parsed as Record<string, unknown>
        const document: FileDocument = {}
        for (const part of ['selection', 'drafts'] as const) {
            const value = record[part]
            if (typeof value === 'string') {
                document[part] = value
            }
        }
        return document
    } catch (error) {
        return null
    }
}

/**
 * Both parts in one file. Operations run one at a time, in the order they were
 * called, so a removal started right after another cannot overwrite it with an
 * older copy of the file.
 */
export function createFileMedium(files: HandoffFiles): HandoffMedium {
    let queue: Promise<unknown> = Promise.resolve()
    function serial<T>(work: () => Promise<T>): Promise<T> {
        const run = queue.then(work, work)
        queue = run.catch(() => undefined)
        return run
    }
    async function load(): Promise<FileDocument | null> {
        const bytes = await files.read(HANDOFF_FILE_PATH)
        return bytes === null ? {} : parseDocument(bytes)
    }
    return {
        read: (part) => serial(async () => (await load())?.[part] ?? null),
        write: (part, text) => serial(async () => {
            try {
                const document = (await load()) ?? {}
                document[part] = text
                await files.writeAtomic(HANDOFF_FILE_PATH, new TextEncoder().encode(JSON.stringify(document)))
                return (await load())?.[part] === text
            } catch (error) {
                console.error('The idle reload record could not be written:', error)
                return false
            }
        }),
        remove: (part) => serial(async () => {
            const document = await load()
            if (document === null) {
                return
            }
            delete document[part]
            if (document.selection === undefined && document.drafts === undefined) {
                await files.remove(HANDOFF_FILE_PATH)
                return
            }
            await files.writeAtomic(HANDOFF_FILE_PATH, new TextEncoder().encode(JSON.stringify(document)))
        }),
    }
}

//#region selection part

export function buildSelectionPart(input: { chaId: string | null, members: readonly string[], now: number }): SelectionPart {
    const keepInline = new Set<string>()
    if (input.chaId) {
        keepInline.add(input.chaId)
    }
    for (const member of input.members) {
        keepInline.add(member)
    }
    return { v: 1, reason: 'idle', at: input.now, chaId: input.chaId, keepInline: [...keepInline] }
}

function isNullableString(value: unknown): value is string | null {
    return typeof value === 'string' || value === null
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export type SelectionRead =
    | { status: 'fresh', part: SelectionPart }
    | { status: 'stale' }
    | { status: 'unreadable' }

export function parseSelectionPart(text: string, now: number): SelectionRead {
    try {
        const parsed: unknown = JSON.parse(text)
        if (typeof parsed !== 'object' || parsed === null) {
            return { status: 'unreadable' }
        }
        const record = parsed as Record<string, unknown>
        const { at, chaId, keepInline } = record
        if (record.v !== 1 || record.reason !== 'idle' || typeof at !== 'number' || !Number.isFinite(at)) {
            return { status: 'unreadable' }
        }
        if (!isNullableString(chaId)) {
            return { status: 'unreadable' }
        }
        if (!isStringArray(keepInline)) {
            return { status: 'unreadable' }
        }
        if (!(now - at < SELECTION_FRESH_MS) || at > now) {
            return { status: 'stale' }
        }
        return { status: 'fresh', part: { v: 1, reason: 'idle', at, chaId, keepInline } }
    } catch (error) {
        return { status: 'unreadable' }
    }
}

//#endregion

//#region drafts part

/** The draft stores' change counters, in a fixed order: a record taken at one reading is stale once either differs. */
export function draftsVersions(): number[] {
    return [composerDraftsVersion(), draftContentOrphanGate.version()]
}

/** Every carried draft of the page, as detached copies. */
export function takeDraftsPart(now: number): DraftsPart {
    return {
        v: 1,
        at: now,
        composer: exportRecords(),
        durable: draftContentOrphanGate.entries().map(({ key, record }) => ({
            key,
            text: record.text,
            baseData: record.baseData,
            updatedAt: record.updatedAt,
        })),
    }
}

function isComposerCarry(value: unknown): value is ComposerDraftCarry {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const record = value as Record<string, unknown>
    return typeof record.key === 'string'
        && typeof record.messageInput === 'string'
        && typeof record.messageInputTranslate === 'string'
        && isStringArray(record.fileInput)
}

function isDurableCarry(value: unknown): value is DurableDraftCarry {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const record = value as Record<string, unknown>
    return typeof record.key === 'string'
        && typeof record.text === 'string'
        && typeof record.baseData === 'string'
        && typeof record.updatedAt === 'number'
        && Number.isFinite(record.updatedAt)
        && (record.index === undefined || typeof record.index === 'number')
}

/** The drafts part, or null when the text is not a whole, well-formed part. */
export function parseDraftsPart(text: string): DraftsPart | null {
    try {
        const parsed: unknown = JSON.parse(text)
        if (typeof parsed !== 'object' || parsed === null) {
            return null
        }
        const record = parsed as Record<string, unknown>
        if (
            record.v !== 1
            || typeof record.at !== 'number'
            || !Array.isArray(record.composer)
            || !Array.isArray(record.durable)
            || !record.composer.every(isComposerCarry)
            || !record.durable.every(isDurableCarry)
        ) {
            return null
        }
        return { v: 1, at: record.at, composer: record.composer, durable: record.durable }
    } catch (error) {
        return null
    }
}

/**
 * Puts every carried draft back by its own key, oldest first. A composer key
 * that already holds text and a durable draft that is as new or newer are left
 * alone, so nothing typed since is displaced.
 */
export function putBackDrafts(part: DraftsPart, now: number = Date.now()): void {
    for (const carried of part.composer) {
        restoreRecord(carried)
    }
    for (const carried of part.durable) {
        draftContentOrphanGate.restore(
            carried.key,
            { text: carried.text, baseData: carried.baseData, updatedAt: carried.updatedAt, index: carried.index },
            now,
        )
    }
}

//#endregion

//#region the record as a whole

export interface ReadHandoff {
    selection: SelectionPart | null
    /** Present only when the drafts part was read whole. */
    drafts: DraftsPart | null
}

/**
 * Reads both parts at boot. A stale or unreadable selection part is deleted;
 * an unreadable drafts part is left where it is and reported.
 */
export async function readHandoff(medium: HandoffMedium, now: number): Promise<ReadHandoff> {
    let selection: SelectionPart | null = null
    try {
        const text = await medium.read('selection')
        if (text !== null) {
            const read = parseSelectionPart(text, now)
            if (read.status === 'fresh') {
                selection = read.part
            } else {
                await medium.remove('selection')
            }
        }
    } catch (error) {
        console.error('The idle reload selection could not be read:', error)
    }
    let drafts: DraftsPart | null = null
    try {
        const text = await medium.read('drafts')
        if (text !== null) {
            drafts = parseDraftsPart(text)
            if (drafts === null) {
                console.error('The carried drafts of an idle reload are unreadable and were left in place.')
            }
        }
    } catch (error) {
        console.error('The carried drafts of an idle reload could not be read:', error)
    }
    return { selection, drafts }
}

/**
 * Applies a read hand-off after the database is installed. The drafts are put
 * back at once, but their part stays until `afterFirstCommit` calls back (the
 * page's first save that committed): a page that dies before then leaves the
 * part for the next boot, whose put-back never displaces newer text. The
 * selection part is deleted and the character selected. The returned promise
 * settles when the selection and the deletion of the selection part have
 * finished.
 */
export function applyHandoff(
    handoff: ReadHandoff,
    medium: HandoffMedium,
    selectByChaId: (chaId: string) => Promise<boolean>,
    afterFirstCommit: (callback: () => void) => void,
): Promise<void> {
    const pending: Promise<unknown>[] = []
    if (handoff.drafts) {
        putBackDrafts(handoff.drafts)
        afterFirstCommit(() => {
            try {
                void Promise.resolve(medium.remove('drafts')).catch((error) => console.error(error))
            } catch (error) {
                console.error(error)
            }
        })
    }
    if (handoff.selection) {
        pending.push(Promise.resolve(medium.remove('selection')))
        if (handoff.selection.chaId !== null) {
            pending.push(selectByChaId(handoff.selection.chaId))
        }
    }
    return Promise.allSettled(pending).then((results) => {
        for (const result of results) {
            if (result.status === 'rejected') {
                console.error('Finishing the idle reload hand-off failed:', result.reason)
            }
        }
    })
}

/**
 * Writes both parts and reads them back. Drafts first: a record cut short
 * between the two leaves text that a later boot puts back and no selection.
 * False when either write did not read back whole.
 */
export function writeHandoffSync(medium: SyncHandoffMedium, selection: SelectionPart, drafts: DraftsPart): boolean {
    return medium.write('drafts', JSON.stringify(drafts)) && medium.write('selection', JSON.stringify(selection))
}

export async function writeHandoff(medium: HandoffMedium, selection: SelectionPart, drafts: DraftsPart): Promise<boolean> {
    return (await medium.write('drafts', JSON.stringify(drafts))) && (await medium.write('selection', JSON.stringify(selection)))
}

//#endregion

//#region the rate-limit history

/** The time of this tab's last idle reload, `null` when none is recorded, `'unreadable'` when the record cannot be relied on. */
export function readReloadHistory(storage: Pick<Storage, 'getItem'>): number | null | 'unreadable' {
    try {
        const raw = storage.getItem(HISTORY_KEY)
        if (raw === null) {
            return null
        }
        const parsed: unknown = JSON.parse(raw)
        const lastAt = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>).lastAt : undefined
        return typeof lastAt === 'number' && Number.isFinite(lastAt) && lastAt >= 0 ? lastAt : 'unreadable'
    } catch (error) {
        return 'unreadable'
    }
}

/** True only when the time reads back, so a tab that cannot remember a reload does not make one. */
export function writeReloadHistory(storage: Pick<Storage, 'getItem' | 'setItem'>, lastAt: number): boolean {
    try {
        const text = JSON.stringify({ lastAt })
        storage.setItem(HISTORY_KEY, text)
        return storage.getItem(HISTORY_KEY) === text
    } catch (error) {
        return false
    }
}

//#endregion
