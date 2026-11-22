import type { StoredDatabase } from 'src/ts/storage/database.svelte'
import {
    cloneConnection, connectionById, customModelName, isMalformedStore, isRecord,
    nextConnectionId, providerLabel, proxyName, str, storedConnections, uniqueName,
    type Connection, type ConnectionProvider,
} from './connections'
import { wrappedOf } from './keyVaultStore.svelte'
import { GLOBAL_ROWS, type GlobalSlotRow } from './slotTable'

type PresetLegacyProp = 'proxyKey' | 'forceReplaceUrl' | 'openAIKey'

/**
 * The complete result of planning: a new `connections` array and, per position, the references
 * to write and the non-empty legacy values to clear. Planning is pure; nothing here touches the db.
 */
export type Plan = {
    connections: Connection[]
    rootRef?: string
    presetRefs: { index: number, id: string }[]
    modelRefs: { index: number, id: string }[]
    slotClears: GlobalSlotRow[]
    rootClears: ('proxyKey' | 'forceReplaceUrl')[]
    presetClears: { index: number, props: PresetLegacyProp[] }[]
    modelClears: { index: number, props: ('key' | 'url')[] }[]
    oaiCompDeletes: string[]
}

export type MigrationResult = 'none' | 'skip' | 'applied' | 'failed'

/**
 * Reads arbitrary JSON defensively: a non-string counts as empty, and null or non-object list
 * items are skipped. 'skip' when `connections` is present but malformed (the data is kept);
 * 'none' when no in-scope position holds a non-empty string (nothing is allocated or written).
 * Walk order, which fixes the ids: global slots in table order, OaiComp kids sorted, the root
 * working pair, presets by index, custom models by index.
 */
export function planConnections(db: StoredDatabase): Plan | 'skip' | 'none' {
    if (isMalformedStore(db)) {
        return 'skip'
    }
    const conns: Connection[] = storedConnections(db)
    const plan: Plan = {
        connections: conns,
        presetRefs: [],
        modelRefs: [],
        slotClears: [],
        rootClears: [],
        presetClears: [],
        modelClears: [],
        oaiCompDeletes: [],
    }
    let touched = false

    const allocId = () => nextConnectionId(conns)

    // Global slot and OaiComp absorption: write into the provider's first connection, else a new one.
    const absorbKey = (provider: ConnectionProvider, value: string) => {
        const index = conns.findIndex((conn) => conn.provider === provider)
        if (index >= 0) {
            conns[index] = cloneConnection(conns[index], { key: value })
        } else {
            conns.push({
                id: allocId(),
                name: uniqueName(providerLabel(provider), conns),
                provider,
                key: value,
            })
        }
    }

    for (const row of GLOBAL_ROWS) {
        const value = row.legacyGet(db)
        if (value === '') {
            continue
        }
        absorbKey(row.provider, value)
        plan.slotClears.push(row)
        touched = true
    }

    const oaiComp: unknown = db.OaiCompAPIKeys
    if (isRecord(oaiComp)) {
        for (const kid of Object.keys(oaiComp).sort()) {
            const value = oaiComp[kid]
            if (typeof value === 'string' && value !== '') {
                absorbKey(`oaicomp:${kid}`, value)
                plan.oaiCompDeletes.push(kid)
                touched = true
            }
        }
    }

    // A proxy connection is matched on exact strings on both sides and never edited here. A non-empty key
    // matches on the key alone (it is authoritative, so a both-set connection matches too); an empty key
    // matches only a connection with the same envelope, so a key-less pair never lands on a wrapped proxy.
    const findOrCreateProxy = (url: string, key: string, wrapped?: string): string => {
        const hit = conns.find((conn) => conn.provider === 'reverse_proxy' && (conn.url ?? '') === url
            && (key !== '' ? conn.key === key : conn.key === '' && wrappedOf(conn) === wrapped))
        if (hit) {
            return hit.id
        }
        const id = allocId()
        const created: Connection = { id, name: uniqueName(proxyName(url), conns), provider: 'reverse_proxy', key, url }
        if (wrapped !== undefined) {
            created.keyWrapped = wrapped
        }
        conns.push(created)
        return id
    }

    // First migration (the owner does not resolve): the exact pair. Steady state: a partial edit of the owner.
    const absorbPair = (url: string, key: string, currentRef: unknown): string => {
        const current = connectionById(conns, currentRef, 'reverse_proxy')
        if (!current) {
            return findOrCreateProxy(url, key)
        }
        if (key !== '') {
            return findOrCreateProxy(url || (current.url ?? ''), key)
        }
        return findOrCreateProxy(url || (current.url ?? ''), current.key, current.key === '' ? wrappedOf(current) : undefined)
    }

    const rootUrl = str(db.forceReplaceUrl)
    const rootKey = str(db.proxyKey)
    if (rootUrl !== '' || rootKey !== '') {
        plan.rootRef = absorbPair(rootUrl, rootKey, db.proxyConnectionId)
        if (rootKey !== '') {
            plan.rootClears.push('proxyKey')
        }
        if (rootUrl !== '') {
            plan.rootClears.push('forceReplaceUrl')
        }
        touched = true
    }

    const presets: unknown = db.botPresets
    if (Array.isArray(presets)) {
        presets.forEach((preset: unknown, index) => {
            if (!isRecord(preset)) {
                return
            }
            const props: PresetLegacyProp[] = []
            const url = str(preset.forceReplaceUrl)
            const key = str(preset.proxyKey)
            if (url !== '' || key !== '') {
                plan.presetRefs.push({ index, id: absorbPair(url, key, preset.proxyConnectionId) })
                if (key !== '') {
                    props.push('proxyKey')
                }
                if (url !== '') {
                    props.push('forceReplaceUrl')
                }
            }
            if (str(preset.openAIKey) !== '') {
                props.push('openAIKey')
            }
            if (props.length > 0) {
                plan.presetClears.push({ index, props })
                touched = true
            }
        })
    }

    // Custom models are copy-on-write: a connection other models also name is cloned, never overlaid.
    const models: unknown = db.customModels
    if (Array.isArray(models)) {
        const refs: (string | undefined)[] = models.map((model: unknown) =>
            isRecord(model) && typeof model.connectionId === 'string' ? model.connectionId : undefined)
        const referrers = (id: string) => refs.filter((ref) => ref === id).length
        models.forEach((model: unknown, index) => {
            if (!isRecord(model)) {
                return
            }
            const url = str(model.url)
            const key = str(model.key)
            if (url === '' && key === '') {
                return
            }
            const current = connectionById(conns, refs[index], 'custom')
            let id: string
            if (current && referrers(current.id) === 1) {
                id = current.id
                const next = cloneConnection(current, { key: key || current.key })
                if (url !== '' || current.url !== undefined) {
                    next.url = url || current.url
                }
                conns[conns.findIndex((conn) => conn.id === id)] = next
            } else if (current) {
                id = allocId()
                const next: Connection = {
                    id,
                    name: uniqueName(customModelName(model), conns),
                    provider: 'custom',
                    key: key || current.key,
                }
                const envelope = wrappedOf(current)
                if (next.key === '' && envelope !== undefined) {
                    next.keyWrapped = envelope
                }
                if (url !== '' || current.url !== undefined) {
                    next.url = url || current.url
                }
                conns.push(next)
            } else {
                id = allocId()
                conns.push({
                    id,
                    name: uniqueName(customModelName(model), conns),
                    provider: 'custom',
                    key,
                    url,
                })
            }
            refs[index] = id
            plan.modelRefs.push({ index, id })
            const props: ('key' | 'url')[] = []
            if (key !== '') {
                props.push('key')
            }
            if (url !== '') {
                props.push('url')
            }
            plan.modelClears.push({ index, props })
            touched = true
        })
    }

    return touched ? plan : 'none'
}

type JournalEntry = { target: Record<string, unknown>, prop: string, hadOwn: boolean, old: unknown }

function journaledSet(journal: JournalEntry[], target: object, prop: string, value: unknown): void {
    const record = target as Record<string, unknown>
    const hadOwn = Object.hasOwn(record, prop)
    const old = record[prop]
    record[prop] = value
    journal.push({ target: record, prop, hadOwn, old })
}

function undoJournal(journal: JournalEntry[]): void {
    for (let i = journal.length - 1; i >= 0; i--) {
        const { target, prop, hadOwn, old } = journal[i]
        try {
            if (hadOwn) {
                target[prop] = old
            } else {
                delete target[prop]
            }
        } catch {
            // Best effort: a frozen target never took the write this entry records.
        }
    }
}

/**
 * Applies a plan in a fixed order (connections, root reference, preset references, model
 * references, clears), journaling every write. On a throw the journal replays in reverse and an
 * absent property is deleted rather than set to `undefined`; the db is left as it was. Even
 * without the journal, this order keeps each secret in its legacy field, a connection, or both.
 */
export function applyPlan(db: StoredDatabase, plan: Plan): boolean {
    const journal: JournalEntry[] = []
    try {
        journaledSet(journal, db, 'connections', plan.connections)
        if (plan.rootRef !== undefined && db.proxyConnectionId !== plan.rootRef) {
            journaledSet(journal, db, 'proxyConnectionId', plan.rootRef)
        }
        for (const { index, id } of plan.presetRefs) {
            const preset = db.botPresets[index]
            if (preset.proxyConnectionId !== id) {
                journaledSet(journal, preset, 'proxyConnectionId', id)
            }
        }
        for (const { index, id } of plan.modelRefs) {
            const model = db.customModels[index]
            if (model.connectionId !== id) {
                journaledSet(journal, model, 'connectionId', id)
            }
        }
        for (const row of plan.slotClears) {
            const hadOwn = Object.hasOwn(db, row.rootProp)
            const old: unknown = db[row.rootProp]
            row.legacySet(db, '')
            journal.push({ target: db as unknown as Record<string, unknown>, prop: row.rootProp, hadOwn, old })
        }
        for (const prop of plan.rootClears) {
            journaledSet(journal, db, prop, '')
        }
        for (const { index, props } of plan.presetClears) {
            for (const prop of props) {
                journaledSet(journal, db.botPresets[index], prop, '')
            }
        }
        for (const { index, props } of plan.modelClears) {
            for (const prop of props) {
                journaledSet(journal, db.customModels[index], prop, '')
            }
        }
        for (const kid of plan.oaiCompDeletes) {
            const target = db.OaiCompAPIKeys as Record<string, unknown>
            const old = target[kid]
            delete target[kid]
            journal.push({ target, prop: kid, hadOwn: true, old })
        }
        return true
    } catch (error) {
        undoJournal(journal)
        console.error('Connection migration failed; the database was left as it was.', error)
        return false
    }
}

/** Plan and apply with no flag; used by the `.bin` projection and the test adapter. */
export function migrateConnections(db: StoredDatabase): MigrationResult {
    const plan = planConnections(db)
    if (plan === 'none' || plan === 'skip') {
        return plan
    }
    return applyPlan(db, plan) ? 'applied' : 'failed'
}

let connectionsMigratedFlag = false

/** The load hook: only a successful plan marks the boot write; 'none' and 'skip' write nothing. */
export function migrateConnectionsOnLoad(db: StoredDatabase): MigrationResult {
    try {
        const result = migrateConnections(db)
        if (result === 'applied') {
            connectionsMigratedFlag = true
        }
        return result
    } catch (error) {
        console.error('Connection migration failed while planning; the database was left as it was.', error)
        return 'failed'
    }
}

/** True once after a load-time migration wrote; reading resets it. */
export function takeConnectionsMigrated(): boolean {
    const was = connectionsMigratedFlag
    connectionsMigratedFlag = false
    return was
}
