/**
 * Page side of opening files from other Android apps. The host queues what the
 * system hands the activity (a view or share intent) as batches of content
 * URIs with their display names. The page takes the queue with `take()` and
 * imports each batch one after another through `importOpenedSources`, which
 * accepts only the card, module and preset kinds. Everywhere the host bridge is
 * absent (web, desktop, iOS, an old host) it does nothing.
 */
import { importOpenedSources } from '../characterCards'
import { getDatabase } from '../storage/database.svelte'

/** The host object `OpenedFilesBridge` exposes to the page. */
export interface OpenedFilesHost {
    /** Hands over every queued batch as a JSON array of `[{uri, name}]` arrays and empties the queue. */
    take(): unknown
}

declare global {
    interface Window {
        /** Android host: the opened-files queue. Absent elsewhere. */
        __risuTaniumOpenedFilesHost?: Partial<OpenedFilesHost>
        /** Called by the host when a file arrives while the page is running, and by first setup once it is done. */
        __risuTaniumOpenedFiles?: () => void
    }
}

interface OpenedEntry {
    name: string
    path: string
}

//Drains run one at a time, in arrival order; a failed drain never stops the next one.
let chain: Promise<void> = Promise.resolve()

/** The display name without any directory or document-id prefix a provider may put in front of it. */
function baseName(name: unknown): string {
    if (typeof name !== 'string') {
        return ''
    }
    return name.split(/[\\/:]/).pop() ?? ''
}

function entryOf(value: unknown): OpenedEntry | null {
    if (typeof value !== 'object' || value === null) {
        return null
    }
    const record = value as Record<string, unknown>
    if (typeof record.uri !== 'string') {
        return null
    }
    return { name: baseName(record.name), path: record.uri }
}

/** A malformed payload, or a part of it with the wrong shape, is dropped and never thrown on. */
function parseBatches(raw: unknown): OpenedEntry[][] {
    if (typeof raw !== 'string') {
        console.warn('Opened files are not available')
        return []
    }
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch (error) {
        console.warn('Opened files could not be read', error)
        return []
    }
    if (!Array.isArray(parsed)) {
        console.warn('Opened files have an unexpected shape')
        return []
    }
    const batches: OpenedEntry[][] = []
    for (const batch of parsed) {
        if (!Array.isArray(batch)) {
            continue
        }
        const entries: OpenedEntry[] = []
        for (const item of batch) {
            const entry = entryOf(item)
            if (entry) {
                entries.push(entry)
            }
        }
        if (entries.length > 0) {
            batches.push(entries)
        }
    }
    return batches
}

async function drain(): Promise<void> {
    // Before first setup the entries stay in the host; first setup triggers the drain again.
    if (!getDatabase().didFirstSetup) {
        return
    }
    const host = window.__risuTaniumOpenedFilesHost
    if (typeof host?.take !== 'function') {
        return
    }
    let raw: unknown
    try {
        // Called as a method: the host bridge object needs its receiver.
        raw = host.take()
    } catch (error) {
        console.warn('Opened files could not be taken', error)
        return
    }
    for (const batch of parseBatches(raw)) {
        try {
            await importOpenedSources(batch)
        } catch (error) {
            console.warn('Opened files were not imported', error)
        }
    }
}

function scheduleDrain(): void {
    chain = chain.then(drain).catch((error) => {
        console.warn('Opened files were not handled', error)
    })
}

const openedFilesHook = (): void => {
    scheduleDrain()
}

/**
 * Starts importing files other Android apps opened or shared. A no-op where the
 * host bridge is absent. Safe to call again: the hook is installed once and a
 * second drain finds the queue empty.
 */
export function androidOpenedFilesImport(): void {
    if (!window.__risuTaniumOpenedFilesHost) {
        return
    }
    window.__risuTaniumOpenedFiles = openedFilesHook
    scheduleDrain()
}
