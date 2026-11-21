/**
 * Adapters between the eight side stores (A3.4) and the `.rtb` side sections: reading a
 * store as ordered records for the writer, and restoring a section into a store.
 *
 * Reading: a store that cannot be probed is `unreadable` (its section is left out and
 * named). Otherwise records come lazily, sorted by code unit; a key deleted after the
 * key list was taken is skipped, so no key comes back to life; a value that cannot be
 * read fails the export and names the store and key.
 *
 * Restoring runs in two passes over the section body. Pass 1 validates every line and
 * writes nothing: any failure there leaves the store byte-identical and is reported as
 * `malformed` (a damaged line, a rule failure, a failed or cut entry read). Pass 2
 * clears the store and reads the body again, re-validating every line before it writes
 * it; a failure there means the file changed or was cut between the passes, and the
 * store has been changed: the result is `changed` and nothing is rolled back.
 *
 * Both passes count the same lines: the non-blank lines the splitter returns, unknown
 * tags and damaged lines included, blank lines excluded.
 *
 * The plugin-permissions store is always cleared by a restore, even when its section is
 * omitted or in conflict (MC-2047); the result still names the omission or conflict.
 *
 * A write never leaves its confinement: a localStorage section only touches the keys of
 * its own store (`safe_plugin_*`, or the `UI_PREFS_KEYS` allowlist).
 */
import localforage from 'localforage'
import { acceptStagedLine } from '../../connections/restoredKeys'
import { wrapForStaging } from '../../connections/keyVaultStore.svelte'
import { CONNECTION_KEYS_ID, SIDE_SECTION_IDS, type SideSectionId, type StoreSideSectionId } from './entryNames'
import type { SideAction } from './sideDecision'
import type { SideInput, SideRecord } from './rtbWriter'
import { SideLineSplitter, type NumberedSideLine } from './sideStream'
import {
    GOOGLE_SEARCH_STORE,
    HYPA_VECTOR_STORE,
    IRIS_STORE,
    MCP_TOOL_CALLS_STORE,
    PLUGIN_PERMISSIONS_STORE,
    PLUGIN_SAFE_STORE,
    RESTORED_KEYS_STORE,
    SAFE_PLUGIN_LS_PREFIX,
    UI_PREFS_KEYS,
    type ForageStoreConfig,
} from './sideStoreConfig'
import { prepareSideValue, RTB_SIDE_TAGS } from './sideTags'
import type { BodySink } from './zip64Reader'

export interface SideBackends {
    forage(config: ForageStoreConfig): LocalForage
    local(): Storage
    /**
     * Wraps a restored key for this device so its staging record can hold the envelope; null when this page has no
     * working vault. Absent means no vault: the record then holds the plain.
     */
    stageWrap?(plain: string): Promise<string | null>
}

export const defaultSideBackends: SideBackends = {
    forage: (config) => localforage.createInstance(config),
    local: () => localStorage,
    stageWrap: wrapForStaging,
}

type StoreKind =
    | { kind: 'forage', config: ForageStoreConfig }
    | { kind: 'safe-ls' }
    | { kind: 'ui-prefs' }
    | { kind: 'staging' }

const STORE_KINDS: Readonly<Record<SideSectionId, StoreKind>> = {
    'side.iris': { kind: 'forage', config: IRIS_STORE },
    'side.google-search': { kind: 'forage', config: GOOGLE_SEARCH_STORE },
    'side.hypa-vector': { kind: 'forage', config: HYPA_VECTOR_STORE },
    'side.plugin-safe': { kind: 'forage', config: PLUGIN_SAFE_STORE },
    'side.plugin-safe-ls': { kind: 'safe-ls' },
    'side.plugin-permissions': { kind: 'forage', config: PLUGIN_PERMISSIONS_STORE },
    'side.mcp-tool-calls': { kind: 'forage', config: MCP_TOOL_CALLS_STORE },
    'side.ui-prefs': { kind: 'ui-prefs' },
    'side.connection-keys': { kind: 'staging' },
}

const UI_PREFS_SET: ReadonlySet<string> = new Set(UI_PREFS_KEYS)

/** A stored value that cannot be read; the export fails and names the store and key. */
export class RtbSideReadError extends Error {
    readonly id: SideSectionId
    readonly key: string | null

    constructor(id: SideSectionId, key: string | null, cause: unknown) {
        super(`the side store ${id} could not be read${key === null ? '' : ` at key ${JSON.stringify(key.length > 80 ? key.slice(0, 80) + '...' : key)}`}: ${cause instanceof Error ? cause.message : String(cause)}`)
        this.name = 'RtbSideReadError'
        this.id = id
        this.key = key
    }
}

// ---------------------------------------------------------------- read

function localKeys(storage: Storage): string[] {
    const keys: string[] = []
    for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i)
        if (key !== null) {
            keys.push(key)
        }
    }
    return keys
}

async function* forageRecords(id: SideSectionId, store: LocalForage, keys: readonly string[]): AsyncGenerator<SideRecord> {
    for (const key of keys) {
        let value: unknown
        try {
            value = await store.getItem<unknown>(key)
        } catch (error) {
            throw new RtbSideReadError(id, key, error)
        }
        if (value === null) {
            continue
        }
        yield { key, value: await prepareSideValue(value) }
    }
}

async function* localRecords(id: SideSectionId, storage: Storage, keys: readonly { store: string, carried: string }[]): AsyncGenerator<SideRecord> {
    for (const { store, carried } of keys) {
        let value: string | null
        try {
            value = storage.getItem(store)
        } catch (error) {
            throw new RtbSideReadError(id, store, error)
        }
        if (value !== null) {
            yield { key: carried, value }
        }
    }
}

function sorted(keys: readonly string[]): string[] {
    return [...keys].sort()
}

/** One store as the writer's input; `unreadable` when it cannot be probed. */
export async function readSideStore(id: StoreSideSectionId, backends: SideBackends = defaultSideBackends): Promise<SideInput> {
    const spec = STORE_KINDS[id]
    if (spec.kind === 'staging') {
        return { unreadable: true }
    }
    try {
        if (spec.kind === 'forage') {
            const store = backends.forage(spec.config)
            await store.ready()
            const keys = await store.keys()
            return { records: forageRecords(id, store, sorted(keys)) }
        }
        const storage = backends.local()
        const all = localKeys(storage)
        if (spec.kind === 'safe-ls') {
            const keys = sorted(all.filter((key) => key.startsWith(SAFE_PLUGIN_LS_PREFIX)))
                .map((key) => ({ store: key, carried: key.slice(SAFE_PLUGIN_LS_PREFIX.length) }))
            return { records: localRecords(id, storage, keys) }
        }
        const keys = sorted(all.filter((key) => UI_PREFS_SET.has(key))).map((key) => ({ store: key, carried: key }))
        return { records: localRecords(id, storage, keys) }
    } catch {
        return { unreadable: true }
    }
}

/** Every side store, by section id. The connection keys are not a store: the export builds that section from the live connections. */
export async function readSideStores(backends: SideBackends = defaultSideBackends): Promise<Record<StoreSideSectionId, SideInput>> {
    const out = {} as Record<StoreSideSectionId, SideInput>
    for (const id of SIDE_SECTION_IDS as readonly SideSectionId[]) {
        if (id === CONNECTION_KEYS_ID) {
            continue
        }
        out[id] = await readSideStore(id, backends)
    }
    return out
}

// ---------------------------------------------------------------- restore

/** Reads the section body into `sink`; `{ ok: false }` is a failed or cut read (CRC, short read). */
export type SideBodyReader = (sink: BodySink) => Promise<{ ok: true, reason?: undefined } | { ok: false, reason: string }>

export interface SideSkip {
    key: string
    why: 'unknown-tag' | 'not-allowlisted'
    tag?: string
}

/**
 * `malformed`: the store was not touched (pass 1, or a conflict; a plugin-permissions conflict still clears the grants, MC-2047).
 * `changed`: pass 2 failed after the store was cleared; `written` records were written.
 * `write-failed`: the store itself failed. For `phase: 'clear'`, plugin-safe-ls and
 * ui-prefs clear key by key, so the failure may have removed some keys; the other
 * stores clear in one operation and are unchanged.
 */
export type SideRestoreResult =
    | { id: SideSectionId, status: 'ok', written: number, skipped: SideSkip[] }
    | { id: SideSectionId, status: 'omitted', reason: string }
    | { id: SideSectionId, status: 'newer', v: number }
    | { id: SideSectionId, status: 'absent' }
    | { id: SideSectionId, status: 'malformed', reason: string, line: number | null, conflict: boolean }
    | { id: SideSectionId, status: 'changed', reason: string, line: number | null, written: number }
    | { id: SideSectionId, status: 'write-failed', phase: 'clear' | 'write', written: number, key: string | null, message: string }

/** Whether the result needs the user told: false only for absent and for ok with nothing skipped. */
export function sideResultIsNamed(result: SideRestoreResult): boolean {
    if (result.status === 'absent') {
        return false
    }
    if (result.status === 'ok') {
        return result.skipped.length > 0
    }
    return true
}

type Accepted =
    | { kind: 'write', key: string, value: unknown }
    | { kind: 'skip', why: 'not-allowlisted' }
    | { kind: 'bad', reason: string }

interface StoreOps {
    clear(): Promise<void>
    accept(key: string, value: unknown): Accepted
    write(key: string, value: unknown): Promise<void>
}

function opsFor(id: SideSectionId, backends: SideBackends): StoreOps {
    const spec = STORE_KINDS[id]
    if (spec.kind === 'forage') {
        // One instance per section: localforage never releases an instance and each new one
        // re-initialises against every earlier one, so a per-write instance is quadratic.
        let instance: LocalForage | null = null
        const store = (): LocalForage => {
            instance ??= backends.forage(spec.config)
            return instance
        }
        return {
            clear: () => store().clear(),
            accept: (key, value) => ({ kind: 'write', key, value }),
            write: async (key, value) => {
                await store().setItem(key, value)
            },
        }
    }
    if (spec.kind === 'safe-ls') {
        return {
            clear: async () => {
                const storage = backends.local()
                for (const key of localKeys(storage).filter((candidate) => candidate.startsWith(SAFE_PLUGIN_LS_PREFIX))) {
                    storage.removeItem(key)
                }
            },
            accept: (key, value) => typeof value === 'string'
                ? { kind: 'write', key: `${SAFE_PLUGIN_LS_PREFIX}${key}`, value }
                : { kind: 'bad', reason: `the value of key ${JSON.stringify(key)} is not a string` },
            write: async (key, value) => {
                backends.local().setItem(key, value as string)
            },
        }
    }
    if (spec.kind === 'staging') {
        let instance: LocalForage | null = null
        const store = (): LocalForage => {
            instance ??= backends.forage(RESTORED_KEYS_STORE)
            return instance
        }
        return {
            clear: () => store().clear(),
            // The record is keyed by the envelope the restored database holds; the wrap is async, so it runs in write.
            accept: (key, value) => {
                const line = acceptStagedLine(value)
                return line === null
                    ? { kind: 'bad', reason: `the connection key line of key ${JSON.stringify(key)} has no envelope or plain` }
                    : { kind: 'write', key: line.e, value: { id: key, p: line.p } }
            },
            write: async (envelope, value) => {
                const line = value as { id: string, p: string }
                const wrapped = backends.stageWrap === undefined ? null : await backends.stageWrap(line.p)
                await store().setItem(envelope, wrapped === null ? { id: line.id, p: line.p } : { id: line.id, w: wrapped })
            },
        }
    }
    return {
        clear: async () => {
            const storage = backends.local()
            for (const key of UI_PREFS_KEYS) {
                storage.removeItem(key)
            }
        },
        accept: (key, value) => {
            if (!UI_PREFS_SET.has(key)) {
                return { kind: 'skip', why: 'not-allowlisted' }
            }
            return typeof value === 'string'
                ? { kind: 'write', key, value }
                : { kind: 'bad', reason: `the value of key ${JSON.stringify(key)} is not a string` }
        },
        write: async (key, value) => {
            backends.local().setItem(key, value as string)
        },
    }
}

type PassStop =
    | { kind: 'stop', reason: string, line: number | null }
    | { kind: 'write-failed', key: string, message: string }

class PassAbort extends Error {
    readonly stop: PassStop

    constructor(stop: PassStop) {
        super('the pass was stopped')
        this.stop = stop
    }
}

type PassOutcome =
    | { kind: 'done' }
    | { kind: 'failed', stop: PassStop | null, reason: string }

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

/**
 * Feeds the body through a splitter and hands each returned line to `onLine`, which
 * throws a `PassAbort` to stop. A stop recorded by `onLine` wins over whatever the
 * entry reader reports afterwards, so an abort is never mistaken for a CRC failure.
 */
async function runPass(body: SideBodyReader, onLine: (line: NumberedSideLine) => Promise<void>): Promise<PassOutcome> {
    const splitter = new SideLineSplitter(RTB_SIDE_TAGS)
    const held: { stop: PassStop | null } = { stop: null }
    const feed = async (lines: NumberedSideLine[]): Promise<void> => {
        for (const line of lines) {
            try {
                await onLine(line)
            } catch (error) {
                if (error instanceof PassAbort) {
                    held.stop = error.stop
                }
                throw error
            }
        }
    }
    const sink: BodySink = async (chunk) => {
        await feed(splitter.push(chunk))
        if (splitter.stopped) {
            held.stop = { kind: 'stop', reason: 'a line is over the line bound', line: null }
            throw new PassAbort(held.stop)
        }
    }
    try {
        const result = await body(sink)
        if (held.stop !== null) {
            return { kind: 'failed', stop: held.stop, reason: '' }
        }
        if (result.ok === false) {
            return { kind: 'failed', stop: null, reason: `the section could not be read: ${result.reason}` }
        }
        await feed(splitter.end())
        return { kind: 'done' }
    } catch (error) {
        if (held.stop !== null) {
            return { kind: 'failed', stop: held.stop, reason: '' }
        }
        return { kind: 'failed', stop: null, reason: `the section could not be read: ${messageOf(error)}` }
    }
}

function stopOf(outcome: Extract<PassOutcome, { kind: 'failed' }>): { reason: string, line: number | null } {
    if (outcome.stop !== null && outcome.stop.kind === 'stop') {
        return { reason: outcome.stop.reason, line: outcome.stop.line }
    }
    return { reason: outcome.reason, line: null }
}

function skipOf(line: NumberedSideLine): SideSkip | null {
    return line.decoded.kind === 'skipped'
        ? { key: line.decoded.key, why: 'unknown-tag', tag: line.decoded.tag }
        : null
}

async function restoreSection(id: SideSectionId, body: SideBodyReader, ops: StoreOps): Promise<SideRestoreResult> {
    // Pass 1: validate everything; the store is not touched.
    let expected = 0
    const first = await runPass(body, async (line) => {
        const { decoded } = line
        if (decoded.kind === 'damaged') {
            throw new PassAbort({ kind: 'stop', reason: decoded.reason, line: line.line })
        }
        if (decoded.kind === 'value') {
            const accepted = ops.accept(decoded.key, decoded.value)
            if (accepted.kind === 'bad') {
                throw new PassAbort({ kind: 'stop', reason: accepted.reason, line: line.line })
            }
        }
        expected++
    })
    if (first.kind === 'failed') {
        const stop = stopOf(first)
        return { id, status: 'malformed', reason: stop.reason, line: stop.line, conflict: false }
    }

    try {
        await ops.clear()
    } catch (error) {
        return { id, status: 'write-failed', phase: 'clear', written: 0, key: null, message: messageOf(error) }
    }

    // Pass 2: re-validate every line before writing it.
    let seen = 0
    let written = 0
    const skipped: SideSkip[] = []
    const second = await runPass(body, async (line) => {
        const { decoded } = line
        seen++
        if (seen > expected) {
            throw new PassAbort({ kind: 'stop', reason: 'the section holds more lines than it did when it was first read', line: line.line })
        }
        if (decoded.kind === 'damaged') {
            throw new PassAbort({ kind: 'stop', reason: decoded.reason, line: line.line })
        }
        if (decoded.kind === 'skipped') {
            const skip = skipOf(line)
            if (skip !== null) {
                skipped.push(skip)
            }
            return
        }
        const accepted = ops.accept(decoded.key, decoded.value)
        if (accepted.kind === 'bad') {
            throw new PassAbort({ kind: 'stop', reason: accepted.reason, line: line.line })
        }
        if (accepted.kind === 'skip') {
            skipped.push({ key: decoded.key, why: accepted.why })
            return
        }
        try {
            await ops.write(accepted.key, accepted.value)
        } catch (error) {
            throw new PassAbort({ kind: 'write-failed', key: accepted.key, message: messageOf(error) })
        }
        written++
    })
    if (second.kind === 'failed') {
        if (second.stop !== null && second.stop.kind === 'write-failed') {
            return { id, status: 'write-failed', phase: 'write', written, key: second.stop.key, message: second.stop.message }
        }
        const stop = stopOf(second)
        return { id, status: 'changed', reason: stop.reason, line: stop.line, written }
    }
    if (seen < expected) {
        return { id, status: 'changed', reason: 'the section holds fewer lines than it did when it was first read', line: null, written }
    }
    return { id, status: 'ok', written, skipped }
}

async function clearOnly(id: SideSectionId, ops: StoreOps): Promise<SideRestoreResult | null> {
    try {
        await ops.clear()
        return null
    } catch (error) {
        return { id, status: 'write-failed', phase: 'clear', written: 0, key: null, message: messageOf(error) }
    }
}

/**
 * Applies one decided action. `body` reads the section's data entry; it is `null` only
 * where the section is cleared without being read (the plugin grants).
 */
export async function applySideAction(action: SideAction, body: SideBodyReader | null, backends: SideBackends = defaultSideBackends): Promise<SideRestoreResult> {
    const { id } = action
    if (action.kind === 'leave') {
        if (id === 'side.plugin-permissions') {
            // MC-2047: grants are always cleared, so every restored plugin asks again; the result still names the omission or conflict.
            const failed = await clearOnly(id, opsFor(id, backends))
            if (failed !== null) {
                return failed
            }
        }
        return action.status === 'omitted'
            ? { id, status: 'omitted', reason: action.reason }
            : { id, status: 'malformed', reason: 'the file lists the section as present and as omitted', line: null, conflict: true }
    }
    const ops = opsFor(id, backends)
    if (action.kind === 'clear') {
        const failed = await clearOnly(id, ops)
        if (failed !== null) {
            return failed
        }
        return action.status === 'newer' ? { id, status: 'newer', v: action.v } : { id, status: 'absent' }
    }
    if (id === 'side.plugin-permissions' || body === null) {
        // The grants are never restored; the body is not read, so damage in it cannot keep old grants.
        const failed = await clearOnly(id, ops)
        return failed ?? { id, status: 'ok', written: 0, skipped: [] }
    }
    return restoreSection(id, body, ops)
}
