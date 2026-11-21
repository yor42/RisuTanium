/**
 * The page's state for Keystore-wrapped connection keys. A leaf: it imports only the connection
 * types and the vault adapter, so the database module can reach it through keyAccess without a
 * cycle. The app side (database lookup, save requests, notices) is injected by `installVaultHost`.
 *
 * Nothing here is persisted. A connection holds either a plain `key` or, with `key === ''`, an
 * opaque `keyWrapped` envelope. The state classes of a wrapped key are:
 * - readable: the plain is in `readable`, keyed by envelope;
 * - needs re-entry: the envelope can never be read here (`reentry` on `vault`, any envelope on a
 *   platform without a vault). It is never rewritten until a user write replaces it;
 * - temporarily unavailable (`vault` only): not read yet, or a transient failure. It counts as
 *   present and is retried on the next use.
 *
 * Readers that run inside `$derived` and templates (`connectionKeyForUi`, `connectionHasKey`,
 * `connectionNeedsReentry`, `connectionKeyTemporarilyUnavailable`) only read; they never start a
 * vault call and never write state.
 */
import { unwrapKey, watchdogFired, wrapKey, type VaultErrorCode, type VaultResult } from 'src/ts/android/keyVault'
import type { Connection } from './connections'

/** `vault`: Android with the message channel. `android-legacy`: Android without it. `none`: everything else. */
export type VaultPlatform = 'vault' | 'android-legacy' | 'none'

/** A connection named in a notice. */
export type FlaggedConnection = { id: string, name: string }

export interface VaultHost {
    platform: VaultPlatform
    /** The live connection with this id, looked up at the moment of use. */
    findConnection(id: string): Connection | undefined
    /** Every live connection. */
    listConnections(): Connection[]
    /** Asks for a save pass now. */
    requestSaveNow(): void
    /** Marks a boot-time write to the database. */
    markBootWrite(): void
    /** True on a page that never saves. */
    isReadOnlyPage(): boolean
    notify: {
        /** A plain key stayed plain because it could not be wrapped. */
        keepPlain(): void
        /** A wrap succeeded, which re-arms the keep-plain notice. */
        wrapped(): void
        /** The set of connections whose key needs re-entry; the host decides whether it is news. */
        reentry(flagged: FlaggedConnection[]): void
    }
    messages: {
        keyUnavailable(): string
    }
}

/** Thrown to a request when a wrapped key is temporarily unreadable; the key itself is untouched. */
export class VaultKeyUnavailableError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'VaultKeyUnavailableError'
    }
}

type Expect = { key: string, keyWrapped: string | undefined }

type Pending = { seq: number, plain: string, expect: Expect }

/** Bumped on every change to `pending`, `readable`, `reentry` or the installed host, so readers rerun. */
let vaultVersion = $state(0)

let host: VaultHost | undefined
const pending = new Map<string, Pending>()
const readable = new Map<string, string>()
const reentry = new Set<string>()
const inflight = new Map<string, Promise<VaultResult<string>>>()
const wrapping = new Set<string>()
/** The running wrap loops, so an export can wait for typed keys to settle. */
const pumps = new Set<Promise<void>>()
/** Restored keys whose plain this boot holds and still has to wrap once the store is loaded. */
const stagedWraps: Array<{ envelope: string, plain: string }> = []
let seqCounter = 0
/** How long typing must pause before the keep-plain notice may open and take focus. */
export const KEEP_PLAIN_DEFER_MS = 1500
let keepPlainTimer: ReturnType<typeof setTimeout> | undefined
let keepPlainHost: VaultHost | undefined
let breaker = false
let bootOpen = false
/** Starts resolved, so a page that never runs `vaultBoot` never waits. */
let vaultReadyPromise: Promise<void> = Promise.resolve()

function bump(): void {
    vaultVersion++
}

/** The envelope a connection holds, when it holds a non-empty string one. */
export function wrappedOf(conn: Connection): string | undefined {
    return typeof conn.keyWrapped === 'string' && conn.keyWrapped !== '' ? conn.keyWrapped : undefined
}

function expectOf(conn: Connection): Expect {
    return { key: conn.key, keyWrapped: wrappedOf(conn) }
}

function matches(conn: Connection, expect: Expect): boolean {
    return conn.key === expect.key && wrappedOf(conn) === expect.keyWrapped
}

function clearKeepPlainTimer(): void {
    if (keepPlainTimer !== undefined) {
        clearTimeout(keepPlainTimer)
        keepPlainTimer = undefined
        keepPlainHost = undefined
    }
}

/** Runs the keep-plain notice once typing has paused; every call restarts the wait, so one timer serves all connections. */
function armKeepPlain(active: VaultHost): void {
    clearKeepPlainTimer()
    keepPlainHost = active
    keepPlainTimer = setTimeout(() => {
        keepPlainTimer = undefined
        keepPlainHost = undefined
        active.notify.keepPlain()
    }, KEEP_PLAIN_DEFER_MS)
}

function pendingFor(conn: Connection): Pending | undefined {
    const entry = pending.get(conn.id)
    return entry !== undefined && matches(conn, entry.expect) ? entry : undefined
}

function platform(): VaultPlatform {
    return host?.platform ?? 'none'
}

/** Whether `envelope` can never be read on this page, as far as this page knows. */
function envelopeNeedsReentry(envelope: string): boolean {
    return platform() === 'vault' ? reentry.has(envelope) : true
}

/** Installs the app side once per page; the store acts as uninstalled until then. Bumps, because every reader's answer can change. */
export function installVaultHost(next: VaultHost): void {
    clearKeepPlainTimer()
    host = next
    bump()
}

/** The platform the installed host reported, or `none` before install. */
export function vaultPlatform(): VaultPlatform {
    return platform()
}

/** The sync value an editor shows: the pending typed key, a non-empty plain key, or a readable envelope's plain. */
export function connectionKeyForUi(conn: Connection): string {
    void vaultVersion
    const entry = pendingFor(conn)
    if (entry !== undefined) {
        return entry.plain
    }
    if (conn.key !== '') {
        return conn.key
    }
    const envelope = wrappedOf(conn)
    return envelope !== undefined ? (readable.get(envelope) ?? '') : ''
}

/** Whether the connection has a key that can ever be read here. */
export function connectionHasKey(conn: Connection): boolean {
    void vaultVersion
    if (pendingFor(conn) !== undefined) {
        return true
    }
    if (conn.key !== '') {
        return conn.key.trim() !== ''
    }
    const envelope = wrappedOf(conn)
    return envelope !== undefined && (readable.has(envelope) || !envelopeNeedsReentry(envelope))
}

/** Whether the connection holds an envelope that this page can never read, so the user must type the key again. */
export function connectionNeedsReentry(conn: Connection): boolean {
    void vaultVersion
    if (conn.key !== '' || pendingFor(conn) !== undefined) {
        return false
    }
    const envelope = wrappedOf(conn)
    return envelope !== undefined && !readable.has(envelope) && envelopeNeedsReentry(envelope)
}

/** Whether a wrapped key is not readable yet but will be (not decrypted yet, or a transient failure). `vault` only. */
export function connectionKeyTemporarilyUnavailable(conn: Connection): boolean {
    void vaultVersion
    if (platform() !== 'vault' || conn.key !== '' || pendingFor(conn) !== undefined) {
        return false
    }
    const envelope = wrappedOf(conn)
    return envelope !== undefined && !readable.has(envelope) && !reentry.has(envelope)
}

/** The plain values this page knows, for log redaction. Sync, no vault call. */
export function vaultKnownPlaintexts(): string[] {
    return [...[...pending.values()].map((entry) => entry.plain), ...readable.values()]
}

/** Connections whose key needs re-entry, in list order. */
function flaggedConnections(): FlaggedConnection[] {
    return (host?.listConnections() ?? [])
        .filter((conn) => connectionNeedsReentry(conn))
        .map((conn) => ({ id: conn.id, name: conn.name }))
}

/** Runs the notice rule for the current flagged set. Never throws. */
export function noticeReentry(): void {
    try {
        host?.notify.reentry(flaggedConnections())
    } catch (error) {
        console.error(error)
    }
}

/**
 * One unwrap per envelope at a time. A permanent failure is remembered in `reentry`, a success in
 * `readable`; a transient failure changes nothing. Waiters of the same envelope share one post.
 */
export function unwrapEnvelope(envelope: string): Promise<VaultResult<string>> {
    const running = inflight.get(envelope)
    if (running !== undefined) {
        return running
    }
    const task = unwrapKey(envelope).then((result) => {
        inflight.delete(envelope)
        if (result.ok) {
            readable.set(envelope, result.value)
            bump()
        } else if (isPermanent(codeOf(result))) {
            const added = !reentry.has(envelope)
            reentry.add(envelope)
            bump()
            if (added && !bootOpen) {
                noticeReentry()
            }
        }
        return result
    })
    inflight.set(envelope, task)
    return task
}

/** The failure code of a result, or undefined for a success. The project is not strict, so a union is not narrowed by ok. */
function codeOf(result: VaultResult<unknown>): VaultErrorCode | undefined {
    return 'code' in result ? result.code : undefined
}

function isPermanent(code: VaultErrorCode | undefined): boolean {
    return code === 'invalidated' || code === 'unreadable'
}

function isTransient(code: VaultErrorCode | undefined): boolean {
    return !isPermanent(code)
}

/**
 * The plaintext key of a connection. A key that is temporarily unreadable is tried once more
 * (not while the watchdog is stalled), then rejects with `VaultKeyUnavailableError`; it is never
 * treated as needing re-entry.
 */
export async function connectionKey(conn: Connection): Promise<string> {
    const typed = pendingFor(conn)
    if (typed !== undefined) {
        return typed.plain
    }
    if (conn.key !== '') {
        return conn.key
    }
    const envelope = wrappedOf(conn)
    if (envelope === undefined || host === undefined || platform() !== 'vault') {
        return ''
    }
    if (reentry.has(envelope)) {
        return ''
    }
    await vaultReadyPromise
    for (let attempt = 0; attempt < 2; attempt++) {
        const known = readable.get(envelope)
        if (known !== undefined) {
            return known
        }
        if (reentry.has(envelope)) {
            return ''
        }
        const result = await unwrapEnvelope(envelope)
        if (result.ok) {
            return result.value
        }
        if (!isTransient(codeOf(result))) {
            return ''
        }
        if (watchdogFired()) {
            break
        }
    }
    throw new VaultKeyUnavailableError(host.messages.keyUnavailable())
}

function removeWrapped(conn: Connection): void {
    delete conn.keyWrapped
}

/**
 * The write rule behind `setConnectionKey`; safe to call without awaiting. Every call supersedes
 * the connection's earlier pending key. `plainOnly` is a reference-only value, which is never wrapped.
 * On `vault` the database is not touched until the wrap is verified: the typed key is served from
 * `pending`, then swapped in as an envelope, or written plain when the wrap fails.
 */
export function writeConnectionKey(conn: Connection, value: string, plainOnly: boolean): Promise<void> {
    const id = conn.id
    if (value !== '') {
        // A pending entry whose precondition no longer holds will be dropped at settle, so it never
        // makes a write redundant.
        const queued = pending.get(id)
        const envelope = wrappedOf(conn)
        const unchanged = queued !== undefined
            ? queued.plain === value && matches(conn, queued.expect)
            : conn.key === '' && envelope !== undefined && readable.get(envelope) === value
        if (unchanged) {
            return Promise.resolve()
        }
    }
    const hadPending = pending.delete(id)
    if (value === '') {
        conn.key = ''
        removeWrapped(conn)
        if (hadPending) {
            bump()
        }
        return Promise.resolve()
    }
    const active = host
    if (active !== undefined && keepPlainTimer !== undefined) {
        armKeepPlain(active)
    }
    if (plainOnly || active === undefined || active.platform !== 'vault') {
        conn.key = value
        removeWrapped(conn)
        if (active?.platform === 'android-legacy' && !plainOnly) {
            armKeepPlain(active)
        }
        if (hadPending) {
            bump()
        }
        return Promise.resolve()
    }
    pending.set(id, { seq: ++seqCounter, plain: value, expect: expectOf(conn) })
    bump()
    const run = pump(active, id)
    pumps.add(run)
    const done = (): void => { pumps.delete(run) }
    void run.then(done, done)
    return run
}

/** At most one wrap in flight per connection; a stale result is dropped and only the latest value is posted next. */
async function pump(active: VaultHost, id: string): Promise<void> {
    if (wrapping.has(id)) {
        return
    }
    wrapping.add(id)
    try {
        for (;;) {
            const entry = pending.get(id)
            if (entry === undefined) {
                return
            }
            const wrapped = await wrapAndVerify(entry.plain, () => pending.get(id) !== entry)
            if (pending.get(id) !== entry) {
                continue
            }
            settle(active, id, entry, wrapped)
        }
    } finally {
        wrapping.delete(id)
    }
}

/** Wraps, then unwraps the envelope and compares; `superseded` skips the verify of a value nobody wants any more. */
async function wrapAndVerify(plain: string, superseded: () => boolean = () => false): Promise<VaultResult<string>> {
    const wrapped = await wrapKey(plain)
    if (!wrapped.ok || superseded()) {
        return wrapped
    }
    const verified = await unwrapKey(wrapped.value)
    if (!verified.ok) {
        return verified
    }
    return verified.value === plain ? wrapped : { ok: false, code: 'other' }
}

/** Synchronous: the swap, the failure fallback or the precondition drop, for the entry that is still the latest. */
function settle(active: VaultHost, id: string, entry: Pending, outcome: VaultResult<string>): void {
    pending.delete(id)
    const conn = active.findConnection(id)
    if (conn === undefined || !matches(conn, entry.expect)) {
        bump()
        return
    }
    if (outcome.ok) {
        readable.set(outcome.value, entry.plain)
        conn.key = ''
        conn.keyWrapped = outcome.value
        bump()
        clearKeepPlainTimer()
        active.notify.wrapped()
        active.markBootWrite()
        return
    }
    conn.key = entry.plain
    removeWrapped(conn)
    bump()
    armKeepPlain(active)
}

/**
 * The leave flush: a typed key that is still only in memory is written plain, so a hide or a
 * kill never loses it, and a save is requested because the change effects run after the flush.
 * Only an entry whose live key differs from its plain writes and requests, so a repeat hide asks
 * for nothing. The entry stays, so the verified wrap still swaps in later.
 */
export function vaultLeaveFlush(): void {
    const active = host
    if (active === undefined) {
        return
    }
    if (keepPlainTimer !== undefined && keepPlainHost !== undefined) {
        const waiting = keepPlainHost
        clearKeepPlainTimer()
        waiting.notify.keepPlain()
    }
    let wrote = false
    for (const [id, entry] of pending) {
        const conn = active.findConnection(id)
        if (conn === undefined || !matches(conn, entry.expect)) {
            continue
        }
        if (conn.key === entry.plain && wrappedOf(conn) === undefined) {
            continue
        }
        conn.key = entry.plain
        removeWrapped(conn)
        entry.expect = { key: entry.plain, keyWrapped: undefined }
        wrote = true
    }
    if (wrote) {
        bump()
        active.requestSaveNow()
    }
}

/** Resolves when the boot's unwraps settled or the budget ran out; resolved when no boot ran. */
export function whenVaultReady(): Promise<void> {
    return vaultReadyPromise
}

/**
 * Replaces the ready promise synchronously and runs `work`. The promise resolves when `work`
 * settles or after `budgetMs`, whichever is first; `work` goes on after the budget.
 */
export function beginVaultBoot(work: () => Promise<void>, budgetMs: number): void {
    breaker = false
    bootOpen = true
    let release: () => void = () => {}
    vaultReadyPromise = new Promise<void>((resolve) => {
        release = resolve
    })
    const timer = setTimeout(release, budgetMs)
    void work().catch((error: unknown) => console.error(error)).finally(() => {
        clearTimeout(timer)
        release()
    })
}

/** Ends the boot window: later late unwraps run the notice rule themselves. */
export function endVaultBoot(): void {
    bootOpen = false
}

/** Boot step 2: unwraps every distinct uncached envelope at once. A first timeout or unavailable trips the breaker. */
export async function unwrapAllForBoot(): Promise<void> {
    if (platform() !== 'vault' || host === undefined) {
        return
    }
    const envelopes = new Set<string>()
    for (const conn of host.listConnections()) {
        const envelope = wrappedOf(conn)
        if (conn.key === '' && envelope !== undefined && !readable.has(envelope) && !reentry.has(envelope)) {
            envelopes.add(envelope)
        }
    }
    await Promise.all([...envelopes].map(async (envelope) => {
        const code = codeOf(await unwrapEnvelope(envelope))
        if (code === 'timeout' || code === 'unavailable') {
            breaker = true
        }
    }))
}

/** Whether a value is only `${NAME}` references, which are never wrapped. */
export function isReferenceOnlyKey(value: string, isRef: (line: string) => boolean): boolean {
    const lines = value.split(/\r?\n/).filter((line) => line.trim() !== '')
    return lines.length > 0 && lines.every(isRef)
}

/**
 * Boot step 3, after the store is loaded: wraps every plain, non-reference key (a both-set
 * connection included, the plain key authoritative), verifies it, and swaps only while the
 * connection is unchanged. A failed wrap keeps the plain key, drops a stale envelope and gives
 * the keep-plain notice. Skipped on a read-only page; a tripped breaker posts nothing.
 */
export async function wrapPlainKeysAfterLoad(isRef: (line: string) => boolean): Promise<void> {
    const active = host
    if (active === undefined || active.platform === 'none' || active.isReadOnlyPage()) {
        return
    }
    await wrapStagedKeys(active)
    const todo = active.listConnections()
        .filter((conn) => conn.key !== '' && !isReferenceOnlyKey(conn.key, isRef))
        .map((conn) => ({ id: conn.id, expect: expectOf(conn), plain: conn.key }))
    if (todo.length === 0) {
        return
    }
    if (active.platform === 'android-legacy' || breaker) {
        active.notify.keepPlain()
        return
    }
    for (const item of todo) {
        if (breaker) {
            active.notify.keepPlain()
            return
        }
        const wrapped = await wrapAndVerify(item.plain)
        const wrapCode = codeOf(wrapped)
        if (wrapCode === 'timeout' || wrapCode === 'unavailable') {
            breaker = true
        }
        const conn = active.findConnection(item.id)
        if (conn === undefined || !matches(conn, item.expect)) {
            continue
        }
        if (wrapped.ok) {
            readable.set(wrapped.value, item.plain)
            conn.key = ''
            conn.keyWrapped = wrapped.value
            bump()
            active.notify.wrapped()
            active.markBootWrite()
        } else {
            removeWrapped(conn)
            bump()
            active.notify.keepPlain()
        }
    }
}

/**
 * What an export learned about wrapped keys before its writer opened, keyed by envelope. `values` holds
 * the plains the snapshot unwrapped; `unreadable` and `unavailableNow` are the envelopes it could not
 * read (this device can never read them, or cannot right now), and the `*Names` are the connections
 * carrying them, for the one confirm.
 */
export interface ExportKeySnapshot {
    values: Map<string, string>
    unreadable: Set<string>
    unavailableNow: Set<string>
    unreadableNames: string[]
    unavailableNames: string[]
}

/** The synchronous key reader of a writer that is already open: it never calls the vault. */
export interface ExportKeyReader {
    keyOf(conn: Connection): string
    /** The connections whose wrapped key was first found unreadable after the snapshot, once each. */
    late(): string[]
}

/** Waits for the running wrap loops; each is bounded by the vault watchdog. */
async function settlePendingWrites(): Promise<void> {
    while (pumps.size > 0) {
        await Promise.allSettled([...pumps])
    }
}

/**
 * Reads every wrapped key of `connections` that is not readable yet, before an export opens its writer.
 * Typed keys settle first. A transient failure is retried once (not while the watchdog is stalled); an
 * envelope that is still unreadable is `unavailableNow`, one that can never be read here is `unreadable`.
 */
export async function exportKeySnapshot(connections: readonly Connection[]): Promise<ExportKeySnapshot> {
    await settlePendingWrites()
    const carriers = new Map<string, Connection[]>()
    for (const conn of connections) {
        const envelope = wrappedOf(conn)
        if (conn.key !== '' || envelope === undefined || readable.has(envelope)) {
            continue
        }
        const list = carriers.get(envelope) ?? []
        list.push(conn)
        carriers.set(envelope, list)
    }
    const snapshot: ExportKeySnapshot = {
        values: new Map<string, string>(),
        unreadable: new Set<string>(),
        unavailableNow: new Set<string>(),
        unreadableNames: [],
        unavailableNames: [],
    }
    await Promise.all([...carriers.keys()].map(async (envelope) => {
        if (envelopeNeedsReentry(envelope)) {
            snapshot.unreadable.add(envelope)
            return
        }
        let result = await unwrapEnvelope(envelope)
        if (!result.ok && isTransient(codeOf(result)) && !watchdogFired()) {
            result = await unwrapEnvelope(envelope)
        }
        if (result.ok) {
            snapshot.values.set(envelope, result.value)
        } else if (isPermanent(codeOf(result))) {
            snapshot.unreadable.add(envelope)
        } else {
            snapshot.unavailableNow.add(envelope)
        }
    }))
    const named = new Set<string>()
    for (const [envelope, list] of carriers) {
        const into = snapshot.unreadable.has(envelope) ? snapshot.unreadableNames : snapshot.unavailableNow.has(envelope) ? snapshot.unavailableNames : null
        for (const conn of list) {
            if (into !== null && !named.has(conn.id)) {
                named.add(conn.id)
                into.push(conn.name)
            }
        }
    }
    return snapshot
}

/**
 * The reader over a snapshot, keyed by envelope and never by object: the writers hand it projection
 * copies. A non-empty plain key wins, then the snapshot, then a plain a swap has since put in `readable`.
 * It never reads `pending` (an export reflects the database). An envelope in none of those, and not
 * already named by the confirm, is recorded once per connection for the export's report.
 */
export function exportKeyReader(snapshot: ExportKeySnapshot): ExportKeyReader {
    const late = new Map<string, string>()
    return {
        keyOf(conn) {
            if (conn.key !== '') {
                return conn.key
            }
            const envelope = wrappedOf(conn)
            if (envelope === undefined) {
                return ''
            }
            const plain = snapshot.values.get(envelope) ?? readable.get(envelope)
            if (plain !== undefined) {
                return plain
            }
            if (!snapshot.unreadable.has(envelope) && !snapshot.unavailableNow.has(envelope) && !late.has(conn.id)) {
                late.set(conn.id, conn.name)
            }
            return ''
        },
        late: () => [...late.values()],
    }
}

/** A restored key staged for this device: its own envelope (`w`) or the plain (`p`) to wrap at boot. */
export type StagedKey = { id: string, w: string } | { id: string, p: string }

/** Wraps and verifies `plain` for a restore's staging record; null off `vault` or when the wrap fails. */
export async function wrapForStaging(plain: string): Promise<string | null> {
    if (platform() !== 'vault') {
        return null
    }
    const wrapped = await wrapAndVerify(plain)
    return wrapped.ok ? wrapped.value : null
}

/**
 * Boot step 1: applies the staged records of a restore, keyed by the envelope the restored database
 * holds. A carrier is a live connection with that envelope and no plain key (a plain key was typed since
 * and wins). Nothing is cleared here: a crash before the save applies again, and an edit changes the
 * envelope so a stale record never lands. Returns the envelopes whose record can be deleted (no carrier,
 * or a record that could not be read).
 */
export function applyStagedKeys(records: ReadonlyMap<string, StagedKey | null>): { drop: string[] } {
    const active = host
    const drop: string[] = []
    if (active === undefined) {
        return { drop }
    }
    let wrote = false
    let touched = false
    for (const [envelope, record] of records) {
        const carriers = active.listConnections().filter((conn) => wrappedOf(conn) === envelope)
        if (record === null || carriers.length === 0) {
            drop.push(envelope)
            continue
        }
        for (const conn of carriers) {
            if (conn.key !== '') {
                continue
            }
            if ('w' in record) {
                conn.keyWrapped = record.w
                wrote = true
            } else if (active.platform === 'vault') {
                readable.set(envelope, record.p)
                touched = true
                if (!stagedWraps.some((item) => item.envelope === envelope)) {
                    stagedWraps.push({ envelope, plain: record.p })
                }
            } else {
                conn.key = record.p
                removeWrapped(conn)
                wrote = true
            }
        }
    }
    if (wrote || touched) {
        bump()
    }
    if (wrote) {
        active.markBootWrite()
    }
    return { drop }
}

/**
 * Wraps the plains of staged `{p}` records on `vault`, after the store is loaded. Each swap needs the
 * connection to be unchanged since the step began; a failed wrap keeps the plain key and gives the
 * keep-plain notice. A tripped breaker posts nothing: the record stays and the next boot tries again.
 */
async function wrapStagedKeys(active: VaultHost): Promise<void> {
    const todo = stagedWraps.splice(0)
    if (active.platform !== 'vault') {
        return
    }
    for (const item of todo) {
        if (breaker) {
            return
        }
        const targets = active.listConnections().filter((conn) => conn.key === '' && wrappedOf(conn) === item.envelope).map((conn) => conn.id)
        if (targets.length === 0) {
            continue
        }
        const wrapped = await wrapAndVerify(item.plain)
        const wrapCode = codeOf(wrapped)
        if (wrapCode === 'timeout' || wrapCode === 'unavailable') {
            breaker = true
        }
        for (const id of targets) {
            const conn = active.findConnection(id)
            if (conn === undefined || !matches(conn, { key: '', keyWrapped: item.envelope })) {
                continue
            }
            if (wrapped.ok) {
                readable.set(wrapped.value, item.plain)
                conn.keyWrapped = wrapped.value
                active.notify.wrapped()
                active.markBootWrite()
            } else {
                // The plain key stays and no envelope: the plain-key wrap that follows retries once and gives the notice.
                conn.key = item.plain
                removeWrapped(conn)
            }
        }
        bump()
    }
}

/** Resets every piece of state; tests only. */
export function resetVaultStoreForTest(): void {
    clearKeepPlainTimer()
    host = undefined
    pending.clear()
    readable.clear()
    reentry.clear()
    inflight.clear()
    wrapping.clear()
    pumps.clear()
    stagedWraps.length = 0
    seqCounter = 0
    breaker = false
    bootOpen = false
    vaultReadyPromise = Promise.resolve()
    vaultVersion = 0
}
