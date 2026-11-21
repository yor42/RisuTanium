import type { Database } from 'src/ts/storage/database.svelte'
import {
    cloneConnection, customModelIndex, customModelName, customModelReferrers, GLOBAL_SLOT_PROVIDERS,
    isMalformedStore, isRecord, nextConnectionId, ownedConnection, proxyName, providerLabel, slotConnection,
    storedConnections, uniqueName, type Connection, type ConnectionProvider, type ConnectionSlot, type GlobalSlot,
} from './connections'
import { connectionKeyForUi, setConnectionKey } from './keyAccess'

/*
 * The writers behind the settings fields. A setter edits the connection its owner resolves to; with
 * none and an empty value it writes nothing. A custom connection that another model also names is
 * cloned for the model being written first, so one model's edit never reaches another. A proxy edit
 * changes the shared connection in place. Every setter refuses to write on a malformed store.
 */

/** The key text a settings field shows for a slot. */
export function slotEditorValue(db: Database, slot: ConnectionSlot): string {
    const conn = slotConnection(db, slot)
    return conn ? connectionKeyForUi(conn) : ''
}

/** The URL text of the working proxy. */
export function proxyUrlValue(db: Database): string {
    return ownedConnection(db, { slot: 'proxyKey' })?.url ?? ''
}

/** The URL text of a custom model's connection. */
export function customModelUrlValue(db: Database, modelId: string): string {
    return ownedConnection(db, { slot: `customModels:${modelId}` })?.url ?? ''
}

/** Appends a connection and returns the stored element, which may be a reactive proxy. */
export function appendConnection(db: Database, conn: Connection): Connection {
    db.connections = [...storedConnections(db), conn]
    return storedConnections(db).find((item) => item.id === conn.id) ?? conn
}

function newConnection(db: Database, provider: ConnectionProvider, name: string, url?: string): Connection {
    const conns = storedConnections(db)
    const conn: Connection = { id: nextConnectionId(conns), name: uniqueName(name, conns), provider, key: '' }
    if (url !== undefined) {
        conn.url = url
    }
    return conn
}

/** The connection of a custom model for writing: cloned when another model names it too. */
function writableCustomConnection(db: Database, modelId: string, create: boolean): Connection | undefined {
    const index = customModelIndex(db, modelId)
    const model: unknown = index < 0 ? undefined : db.customModels[index]
    if (!isRecord(model)) {
        return undefined
    }
    const current = ownedConnection(db, { modelIndex: index })
    if (current && customModelReferrers(db, current.id) > 1) {
        const conns = storedConnections(db)
        const clone = cloneConnection(current, {
            id: nextConnectionId(conns),
            name: uniqueName(customModelName(model), conns),
        })
        const stored = appendConnection(db, clone)
        db.customModels[index].connectionId = stored.id
        return stored
    }
    if (current || !create) {
        return current
    }
    const stored = appendConnection(db, newConnection(db, 'custom', customModelName(model), ''))
    db.customModels[index].connectionId = stored.id
    return stored
}

function writableProxy(db: Database, create: boolean, url?: string): Connection | undefined {
    const current = ownedConnection(db, { slot: 'proxyKey' })
    if (current || !create) {
        return current
    }
    const stored = appendConnection(db, newConnection(db, 'reverse_proxy', proxyName(url ?? ''), url ?? ''))
    db.proxyConnectionId = stored.id
    return stored
}

function slotProvider(slot: ConnectionSlot): ConnectionProvider | undefined {
    if (slot.startsWith('OaiCompAPIKeys:')) {
        return `oaicomp:${slot.slice('OaiCompAPIKeys:'.length)}`
    }
    return Object.hasOwn(GLOBAL_SLOT_PROVIDERS, slot) ? GLOBAL_SLOT_PROVIDERS[slot as GlobalSlot] : undefined
}

/** Stores the key typed for a slot, creating its connection on the first non-empty value. */
export async function setSlotKey(db: Database, slot: ConnectionSlot, value: string): Promise<void> {
    if (isMalformedStore(db)) {
        return
    }
    let conn: Connection | undefined
    if (slot === 'proxyKey') {
        conn = writableProxy(db, value !== '')
    } else if (slot.startsWith('customModels:')) {
        conn = writableCustomConnection(db, slot.slice('customModels:'.length), value !== '')
    } else {
        conn = slotConnection(db, slot)
        const provider = slotProvider(slot)
        if (!conn && value !== '' && provider !== undefined) {
            conn = appendConnection(db, newConnection(db, provider, providerLabel(provider)))
        }
    }
    if (conn) {
        await setConnectionKey(conn, value)
    }
}

/** Stores the URL typed for the working proxy, creating its connection on the first non-empty value. */
export function setProxyUrl(db: Database, url: string): void {
    if (isMalformedStore(db)) {
        return
    }
    const conn = writableProxy(db, url !== '', url)
    if (conn) {
        conn.url = url
    }
}

/** Stores the URL typed for a custom model, creating or cloning its connection as needed. */
export function setCustomModelUrl(db: Database, modelId: string, url: string): void {
    if (isMalformedStore(db)) {
        return
    }
    const conn = writableCustomConnection(db, modelId, url !== '')
    if (conn) {
        conn.url = url
    }
}
