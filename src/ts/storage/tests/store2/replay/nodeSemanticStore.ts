/**
 * An in-memory `ByteStore` with the semantics of the patched `server/node/server.cjs`
 * guarded routes, for the store2 replay: `createNodeBackend` runs on it unchanged.
 * It is an executable model of the server, so the test file runs the shared
 * byte-store conformance and differential cases against it and against the real
 * server; where the two disagree, this file is wrong.
 *
 * What it models: a revision per key (an absent key reads 0), a plain removal that
 * bumps the revision and leaves a tombstone, a retire that forgets the entry, a
 * create-only write at `ifVersion: 0`, own conditions compared before the
 * check-only list, check-only keys compared in list order and never written, a
 * removal that is atomic per request, and the capability answer of the patched
 * server. A guarded call either applies as asked or rejects, which is what the
 * client's proof of the server's echo guarantees; the unpatched servers that send
 * no echo are not modelled.
 *
 * The fake applies a request atomically even for readers; the real server's
 * readers can see a partly applied retire.
 *
 * Test hooks live on the returned handle, never on the `ByteStore`.
 */
import type { ByteStore, CheckOnlyEntry, DeleteEntry, GuardedCapabilities, GuardedOperations, ReadResult, StoreCondition, WriteResult } from 'src/ts/storage/store/contract'
import {
    StoreCheckListTooLongError,
    StoreDeleteManyError,
    StoreInvalidConditionError,
    StoreInvalidKeyError,
    StoreOutcomeUnknownError,
    StoreVersionConflictError,
    type DeleteReportEntry,
} from 'src/ts/storage/store/errors'
import { checkBytes, checkCondition, checkNoDuplicateKeys, versionOf } from 'src/ts/storage/store/guards'
import { STORE2_PREFIX, isStore2Key, nodeAddressableViolation, nodeCreatableViolation } from 'src/ts/storage/store/keyRules'

/** The route a request travels, as the client names it; a retire is a `remove-checked` on the wire. */
export type NodeOperation = 'read' | 'write' | 'remove' | 'list' | 'count' | 'caps' | 'write-checked' | 'remove-checked'

/** The operations whose reply `loseReply` can drop. */
export type LostReplyOperation = 'write' | 'remove' | 'write-checked' | 'remove-checked'

export interface NodeSemanticOptions {
    /** The client's limit of check-only keys per guarded request; the production figure by default. */
    maxCheckOnlyKeys?: number
    /** The client's limit of key and revision header bytes per guarded request; the production figure by default. */
    guardedHeaderBytes?: number
    /** The client's budget for the keys and revisions of one plain remove request; the production figure by default. */
    requestKeyBytes?: number
    /** The server's limit of request header bytes; a larger request gets a 431. Approximates the Node default of 16 KiB. */
    serverHeaderBytes?: number
}

export interface NodeEntryState {
    /** The value, or `null` when the key holds none. */
    bytes: Uint8Array | null
    /** The revision the server reports; a retired or never-seen key is 0. */
    revision: number
}

export interface NodeSemanticStore {
    readonly store: ByteStore
    /** Silent damage: the bytes change and the revision does not. */
    damage(key: string, bytes: Uint8Array): void
    /** A copy of every key that holds bytes or a revision above 0. */
    snapshot(): Map<string, NodeEntryState>
    /** The key as stored, read without a request and without any wrapper around `store`. */
    peek(key: string): NodeEntryState
    /** The keys under `prefix` that hold a value, read without a request. */
    list(prefix: string): string[]
    /** A file the server holds without a revision, the way upstream wrote it. */
    plant(key: string, bytes: Uint8Array): void
    /** The requests that reached the server, in order. */
    readonly log: readonly NodeOperation[]
    /** The next `times` requests of `operation` are applied and then answered with the loss of the reply. */
    loseReply(operation: LostReplyOperation, times?: number): void
}

const DEFAULT_MAX_CHECK_ONLY_KEYS = 60
const DEFAULT_GUARDED_HEADER_BYTES = 8000
const DEFAULT_REQUEST_KEY_BYTES = 8000
const DEFAULT_SERVER_HEADER_BYTES = 16 * 1024
/** What the other headers of a request weigh (the auth token, host, content type, ...). */
const OTHER_HEADER_BYTES = 700

const CAPABILITIES: GuardedCapabilities = { checkOnly: true, retire: true, pieces: false }

function hexOf(key: string): string {
    let hex = ''
    for (const byte of new TextEncoder().encode(key)) {
        hex += byte.toString(16).padStart(2, '0')
    }
    return hex
}

interface RemoveItem {
    key: string
    hex: string
    version: number | null
}

export function createNodeSemanticStore(options: NodeSemanticOptions = {}): NodeSemanticStore {
    const maxCheckOnlyKeys = options.maxCheckOnlyKeys ?? DEFAULT_MAX_CHECK_ONLY_KEYS
    const guardedHeaderBytes = options.guardedHeaderBytes ?? DEFAULT_GUARDED_HEADER_BYTES
    const requestKeyBytes = options.requestKeyBytes ?? DEFAULT_REQUEST_KEY_BYTES
    const serverHeaderBytes = options.serverHeaderBytes ?? DEFAULT_SERVER_HEADER_BYTES

    const values = new Map<string, Uint8Array>()
    const revisions = new Map<string, number>()
    const log: NodeOperation[] = []
    const lost = new Map<LostReplyOperation, number>()

    const revisionOf = (key: string): number => revisions.get(key) ?? 0

    function reachServer(operation: NodeOperation): void {
        log.push(operation)
    }

    /**
     * Runs a request on the server and then answers it. A pending loss drops the
     * reply whatever the request did, a conflict included: the client then sees
     * the transport failure, never the conflict.
     */
    function applyThenAnswer<T>(operation: LostReplyOperation, run: () => T): T {
        let result: T | undefined
        let failure: unknown
        let failed = false
        try {
            result = run()
        } catch (error) {
            failed = true
            failure = error
        }
        const remaining = lost.get(operation) ?? 0
        if (remaining > 0) {
            lost.set(operation, remaining - 1)
            const transport = new TypeError('fetch failed')
            // The guarded routes' client reports a failure after the request was sent as an unknown outcome.
            throw operation === 'write-checked' || operation === 'remove-checked' ? new StoreOutcomeUnknownError(operation, transport) : transport
        }
        if (failed) {
            throw failure
        }
        return result as T
    }

    function assertCheckOnly(checkOnly: readonly CheckOnlyEntry[]): void {
        for (const entry of checkOnly) {
            const current = revisionOf(entry.key)
            if (current !== entry.version) {
                throw new StoreVersionConflictError(entry.key, current)
            }
        }
    }

    function applyWrite(key: string, bytes: Uint8Array, ifVersion: number | null, checkOnly: readonly CheckOnlyEntry[]): number {
        const current = revisionOf(key)
        if (ifVersion !== null && ifVersion !== current) {
            throw new StoreVersionConflictError(key, current)
        }
        assertCheckOnly(checkOnly)
        revisions.set(key, current + 1)
        values.set(key, bytes.slice())
        return current + 1
    }

    function applyRemove(items: readonly RemoveItem[], checkOnly: readonly CheckOnlyEntry[], retire: boolean): void {
        for (const item of items) {
            const current = revisionOf(item.key)
            if (item.version !== null && item.version !== current) {
                throw new StoreVersionConflictError(item.key, current)
            }
        }
        assertCheckOnly(checkOnly)
        for (const item of items) {
            values.delete(item.key)
            if (retire) {
                revisions.delete(item.key)
            } else {
                revisions.set(item.key, revisionOf(item.key) + 1)
            }
        }
    }

    function checkAddressable(key: string): void {
        const reason = nodeAddressableViolation(key)
        if (reason !== null) {
            throw new StoreInvalidKeyError(key, reason)
        }
    }

    function removeItemOf(entry: DeleteEntry): RemoveItem {
        return { key: entry.key, hex: hexOf(entry.key), version: versionOf(entry.condition) }
    }

    function chunksOf(items: readonly RemoveItem[]): RemoveItem[][] {
        const chunks: RemoveItem[][] = []
        let current: RemoveItem[] = []
        let bytes = 0
        for (const item of items) {
            const cost = item.hex.length + 2 + (item.version === null ? 0 : String(item.version).length) + 2
            if (current.length > 0 && bytes + cost > requestKeyBytes) {
                chunks.push(current)
                current = []
                bytes = 0
            }
            current.push(item)
            bytes += cost
        }
        if (current.length > 0) {
            chunks.push(current)
        }
        return chunks
    }

    type ChunkOutcome = { kind: 'removed' } | { kind: 'conflict', key: string, currentVersion: number | null } | { kind: 'unknown', error: unknown }

    /** One plain remove request: all of its keys or none. */
    function removeChunk(items: readonly RemoveItem[]): ChunkOutcome {
        reachServer('remove')
        try {
            applyThenAnswer('remove', () => applyRemove(items, [], false))
        } catch (error) {
            if (error instanceof StoreVersionConflictError) {
                return { kind: 'conflict', key: error.key, currentVersion: error.currentVersion }
            }
            return { kind: 'unknown', error }
        }
        return { kind: 'removed' }
    }

    function checkOnlyHeaders(checkOnly: readonly CheckOnlyEntry[]): Record<string, string> {
        const headers: Record<string, string> = { 'check-only-count': String(checkOnly.length) }
        if (checkOnly.length > 0) {
            headers['check-only-path'] = checkOnly.map((entry) => hexOf(entry.key)).join('$$')
            headers['check-only-revision'] = checkOnly.map((entry) => String(entry.version)).join('$$')
        }
        return headers
    }

    /** Refuses a check-only list that is malformed, repeats a key, or names a key the request itself writes or removes. */
    function checkCheckOnly(checkOnly: readonly CheckOnlyEntry[], ownKeys: readonly string[]): void {
        const seen = new Set<string>(ownKeys)
        for (const entry of checkOnly) {
            checkAddressable(entry.key)
            if (typeof entry.version !== 'number' || !Number.isSafeInteger(entry.version) || entry.version < 0) {
                throw new StoreInvalidConditionError('a check-only version is a non-negative integer')
            }
            if (seen.has(entry.key)) {
                throw new StoreInvalidKeyError(entry.key, 'a check-only key is listed once and is not also a written or removed key')
            }
            seen.add(entry.key)
        }
    }

    /** The client's refusal of a request whose key lists cannot fit one request, before anything is sent. */
    function checkListFits(keyCount: number, headerValues: readonly string[]): void {
        const bytes = headerValues.reduce((sum, value) => sum + value.length, 0)
        if (keyCount > maxCheckOnlyKeys || bytes > guardedHeaderBytes) {
            throw new StoreCheckListTooLongError(keyCount, false, false)
        }
    }

    /** The server's 431: the request header block is over its limit, and nothing ran. */
    function serverReadsHeaders(keyCount: number, headers: Record<string, string>): void {
        let bytes = OTHER_HEADER_BYTES
        for (const [name, value] of Object.entries(headers)) {
            bytes += name.length + value.length + 4
        }
        if (bytes > serverHeaderBytes) {
            throw new StoreCheckListTooLongError(keyCount, true, false)
        }
    }

    function removeChecked(entries: readonly DeleteEntry[], checkOnly: readonly CheckOnlyEntry[], retire: boolean): void {
        if (entries.length === 0) {
            throw new StoreInvalidKeyError('', 'a guarded remove names at least one key')
        }
        for (const entry of entries) {
            checkAddressable(entry.key)
            checkCondition(entry.condition, true)
            if (retire && !isStore2Key(entry.key)) {
                throw new StoreInvalidKeyError(entry.key, `retire reaches only keys under ${STORE2_PREFIX}`)
            }
        }
        checkNoDuplicateKeys(entries)
        if (retire && checkOnly.length === 0) {
            throw new StoreInvalidConditionError('retire needs at least one check-only entry')
        }
        checkCheckOnly(checkOnly, entries.map((entry) => entry.key))
        const items = entries.map(removeItemOf)
        const headers: Record<string, string> = {
            'file-path': items.map((item) => item.hex).join('$$'),
            ...checkOnlyHeaders(checkOnly),
            'retire-count': retire ? String(entries.length) : '0',
            'own-condition-count': String(items.filter((item) => item.version !== null).length),
        }
        if (retire) {
            headers.retire = '1'
        }
        if (items.some((item) => item.version !== null)) {
            headers['if-match-revision'] = items.map((item) => item.version === null ? '' : String(item.version)).join('$$')
        }
        const keyCount = entries.length + checkOnly.length
        checkListFits(keyCount, [headers['file-path'], headers['check-only-path'] ?? '', headers['check-only-revision'] ?? '', headers['if-match-revision'] ?? ''])
        reachServer('remove-checked')
        serverReadsHeaders(keyCount, headers)
        applyThenAnswer('remove-checked', () => applyRemove(items, checkOnly, retire))
    }

    const guarded: GuardedOperations = {
        async probe(): Promise<GuardedCapabilities> {
            reachServer('caps')
            return { ...CAPABILITIES }
        },

        async writeChecked(key: string, bytes: Uint8Array, condition: StoreCondition, checkOnly: readonly CheckOnlyEntry[]): Promise<WriteResult> {
            const reason = nodeAddressableViolation(key) ?? nodeCreatableViolation(key)
            if (reason !== null) {
                throw new StoreInvalidKeyError(key, reason)
            }
            checkCondition(condition, true)
            checkBytes(bytes)
            checkCheckOnly(checkOnly, [key])
            const ifVersion = versionOf(condition)
            const headers: Record<string, string> = {
                'content-type': 'application/octet-stream',
                'file-path': hexOf(key),
                ...checkOnlyHeaders(checkOnly),
                'own-condition-count': ifVersion === null ? '0' : '1',
            }
            if (ifVersion !== null) {
                headers['if-match-revision'] = String(ifVersion)
            }
            checkListFits(checkOnly.length, [headers['check-only-path'] ?? '', headers['check-only-revision'] ?? ''])
            reachServer('write-checked')
            serverReadsHeaders(checkOnly.length, headers)
            return { version: applyThenAnswer('write-checked', () => applyWrite(key, bytes, ifVersion, checkOnly)) }
        },

        async removeChecked(entries: readonly DeleteEntry[], checkOnly: readonly CheckOnlyEntry[]): Promise<void> {
            removeChecked(entries, checkOnly, false)
        },

        async retireChecked(entries: readonly DeleteEntry[], checkOnly: readonly CheckOnlyEntry[]): Promise<void> {
            removeChecked(entries, checkOnly, true)
        },
    }

    const store: ByteStore = {
        capabilities: { conditionalWrites: true },
        guarded,

        async read(key: string): Promise<ReadResult> {
            checkAddressable(key)
            reachServer('read')
            const held = values.get(key)
            return { bytes: held === undefined ? null : held.slice(), version: revisionOf(key) }
        },

        async write(key: string, bytes: Uint8Array, condition: StoreCondition): Promise<WriteResult> {
            const reason = nodeAddressableViolation(key) ?? nodeCreatableViolation(key)
            if (reason !== null) {
                throw new StoreInvalidKeyError(key, reason)
            }
            checkCondition(condition, true)
            checkBytes(bytes)
            reachServer('write')
            return { version: applyThenAnswer('write', () => applyWrite(key, bytes, versionOf(condition), [])) }
        },

        async delete(key: string, condition: StoreCondition): Promise<void> {
            checkAddressable(key)
            checkCondition(condition, true)
            const outcome = removeChunk([removeItemOf({ key, condition })])
            if (outcome.kind === 'conflict') {
                throw new StoreVersionConflictError(key, outcome.currentVersion)
            }
            if (outcome.kind === 'unknown') {
                throw outcome.error
            }
        },

        async deleteMany(entries: readonly DeleteEntry[]): Promise<void> {
            for (const entry of entries) {
                checkAddressable(entry.key)
                checkCondition(entry.condition, true)
            }
            checkNoDuplicateKeys(entries)
            const report: DeleteReportEntry[] = entries.map((entry) => ({ key: entry.key, outcome: 'unchanged' }))
            const reportOf = new Map(report.map((entry) => [entry.key, entry]))
            // Requests run in order and the first failure stops the rest, as the real store does.
            for (const chunk of chunksOf(entries.map(removeItemOf))) {
                const outcome = removeChunk(chunk)
                if (outcome.kind === 'removed') {
                    for (const item of chunk) {
                        reportOf.get(item.key)!.outcome = 'removed'
                    }
                    continue
                }
                if (outcome.kind === 'conflict') {
                    const entry = reportOf.get(outcome.key)
                    if (entry !== undefined) {
                        entry.outcome = 'conflict'
                        entry.currentVersion = outcome.currentVersion
                    }
                } else {
                    for (const item of chunk) {
                        const entry = reportOf.get(item.key)!
                        entry.outcome = 'unknown'
                        entry.error = outcome.error
                    }
                }
                break
            }
            if (report.some((entry) => entry.outcome !== 'removed')) {
                throw new StoreDeleteManyError(report)
            }
        },

        async list(prefix: string): Promise<string[]> {
            checkAddressable(prefix)
            reachServer('list')
            return listHeld(prefix)
        },

        async countPrefix(prefix: string): Promise<number | null> {
            if (prefix !== '') {
                checkAddressable(prefix)
            }
            reachServer('count')
            return listHeld(prefix).length
        },

        async has(key: string): Promise<boolean> {
            checkAddressable(key)
            reachServer('read')
            return values.has(key)
        },
    }

    function listHeld(prefix: string): string[] {
        return [...values.keys()].filter((key) => key.startsWith(prefix))
    }

    return {
        store,
        damage(key, bytes) {
            values.set(key, bytes.slice())
        },
        snapshot() {
            const out = new Map<string, NodeEntryState>()
            for (const key of new Set([...values.keys(), ...revisions.keys()])) {
                out.set(key, { bytes: values.get(key)?.slice() ?? null, revision: revisionOf(key) })
            }
            return out
        },
        peek(key) {
            return { bytes: values.get(key)?.slice() ?? null, revision: revisionOf(key) }
        },
        list: listHeld,
        plant(key, bytes) {
            values.set(key, bytes.slice())
        },
        log,
        loseReply(operation, times = 1) {
            lost.set(operation, (lost.get(operation) ?? 0) + times)
        },
    }
}
