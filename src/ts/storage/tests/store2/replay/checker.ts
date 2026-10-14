/**
 * The property checker of the store2 replay. After every scheduler step it reads
 * the stored state through a raw, unscheduled path (the fake's `snapshot`, the
 * memory backend's `snapshot`), compares it with the state before the step, and
 * judges the difference against the protocol's properties. It never calls the
 * code under test and it contains no `expect`: it returns violations, so a long
 * run can collect them.
 *
 * Properties, named as the plan names them:
 *  - I1  the refs walk of every manifest the commit key names finds every unit,
 *        and no unit is removed while the commit key, as it stood before the step (evaluated at the deleter's read; see amendment J below),
 *        is absent, unparsable, too new or names no current. That second clause has
 *        no exempt remover: the only unit deleter is the GC pass, whose gate
 *        refuses all four states, and neither a recovery step nor an abandon-clear
 *        deletes a unit (they only write the commit key).
 *        The live set is current, retained and pins. The library keeps no other
 *        commit-key field that protects units: the units a recovery has staged are
 *        protected by the standing `staging` prefix (property h) and the keys a
 *        recovery-screen exit listed by the fence (G1), not by a field of the
 *        commit key, and the candidate picked but not yet installed exists only in
 *        the recovering page's memory. Skipped while the commit key does not parse.
 *  - b   a restore never installs a manifest naming a missing unit. Reported only
 *        for a restore; any other write that names a missing unit is I1.
 *  - I2  a unit key is never created twice, tombstones and retired keys included.
 *  - I3  a commit-key write that succeeded presented the stored version, and its
 *        value was built from the stored `seq`. A heuristic: the token match and
 *        `seq + 1` are checked, so a write built from stale content that recomputes
 *        its `seq` passes; only an actor that declared the token it read could be
 *        held to the content.
 *  - h   `staging` changes only by the transitions the writing operation allows,
 *        and no removal hits a standing staging prefix. While the commit key does
 *        not parse the transition is judged against the last value that did.
 *  - G1  no key a standing fence lists is removed, and nothing at all is removed
 *        while the fence is present but cannot be understood. The fence key itself
 *        is guarded as well: only a `fence-exit` writes it, only a `fence-discard`
 *        removes it, and a fence write or unit removal that presented a fence basis
 *        other than the stored one is reported. Read failures are not modelled, so
 *        the unreadable-fence branch of the library is reached here only through
 *        damage.
 *  - G10 a fence write only grows its key list; over a damaged fence the list is
 *        the last one that parsed.
 *  - i   a bulk or recovery install names only keys its actor uploaded or its base
 *        named.
 *  - p   pins change only by a pin operation (recovery starts with none).
 *  - r   a restore pushes the previous current into `retained`.
 *  - I4  the commit key is never removed.
 *
 * Plan amendment J, the deleter gate. The commit-key clause of I1 and the blocked
 * branch of G1 are gate rules, evaluated at the deleter's own read: the checker
 * records, per actor, the commit key and the fence as its most recent read
 * observed them (op `readCommit`/`readFence` on a backend, op `read` of the key on
 * a ByteStore). A deletion after a read that saw a refusing state is reported. When
 * the read saw an allowing state and the key was damaged afterwards, the deletion
 * is judged against the pre-damage ground truth instead, as the model judges every
 * deletion: I1 reports a removed key reachable from the last commit key that parsed
 * (current, retained and pins), G1 a key in the last fence list that parsed, h a key
 * under the pre-damage staging prefix. Damage after the read is invisible to a
 * revision compare (Node silent damage) and to the Tauri compare-then-delete, so no
 * library deleter could refuse it. With no recorded read the stored state stands
 * for the gate, so an actor that deletes must read first for the gate to be judged
 * at its read.
 *
 * A Tauri rig must expose bytes-only raw state (every `revision` null), so that a
 * re-flush that rewrites identical bytes is not a write; the rig goes with the
 * Tauri actors, and the re-flush must not be labelled `fence-exit`.
 *
 * Omitted on purpose: the model's clause that a recovery marker never replaces a
 * healthy commit key. The library legitimately begins a recovery over a key that
 * parses (the recovery-begin transition), so the clause is not a property of the
 * stored state alone.
 */
import { isStore2Key } from 'src/ts/storage/store/keyRules'
import { sameBytes, type MemoryBackend } from 'src/ts/storage/store2/backend'
import { classifyCommitRead } from 'src/ts/storage/store2/commitKey'
import { keyOfTail, readUnit, refsOf, UNIT_TYPE, type CommitKey, type FenceRecord, type UnitType } from 'src/ts/storage/store2/format'
import { COMMIT_KEY, FENCE_KEY } from 'src/ts/storage/store2/format/keys'
import type { NodeSemanticStore } from './nodeSemanticStore'
import type { ActorContext, Expect, OperationKind, RawEntry, RawState, StepInfo } from './scheduler'

// Whether the commit key, as it stood, allows any deleter to run: parsed and naming a current.
function commitAllowsDeletion(bytes: Uint8Array | null): boolean {
    const read = classifyCommitRead({ bytes })
    return read.status === 'parsed' && read.value.current !== null
}

export type PropertyId ='I1' | 'b' | 'I2' | 'I3' | 'h' | 'G1' | 'G10' | 'i' | 'p' | 'r' | 'I4'

export interface Violation {
    property: PropertyId
    step: number
    actor: string
    detail: string
}

export interface Checker {
    /** Judges the step that just applied; returns the violations it found that were not reported before. */
    observe(info: StepInfo): Violation[]
    readonly violations: readonly Violation[]
}

// ---- Raw state adapters ----

const ABSENT_REVISION = 0

/** The raw state of the Node-semantics fake. The commit key and the fence always have an entry. */
export function rawOfNodeSemantic(fake: NodeSemanticStore): () => RawState {
    return () => {
        const out = new Map<string, RawEntry>()
        for (const [key, state] of fake.snapshot()) {
            out.set(key, { bytes: state.bytes, revision: state.revision })
        }
        for (const key of [COMMIT_KEY, FENCE_KEY]) {
            if (!out.has(key)) {
                out.set(key, { bytes: null, revision: ABSENT_REVISION })
            }
        }
        return out
    }
}

/** The raw state of the memory backend, which reports no revision. */
export function rawOfMemory(memory: MemoryBackend): () => RawState {
    return () => {
        const out = new Map<string, RawEntry>()
        for (const [key, bytes] of memory.snapshot()) {
            out.set(key, { bytes, revision: null })
        }
        for (const key of [COMMIT_KEY, FENCE_KEY]) {
            if (!out.has(key)) {
                out.set(key, { bytes: null, revision: null })
            }
        }
        return out
    }
}

// ---- Reading the stored state ----

const NOTHING: RawEntry = { bytes: null, revision: null }

function entryOf(state: RawState, key: string): RawEntry {
    return state.get(key) ?? NOTHING
}

function bytesOfKey(state: RawState, key: string): Uint8Array | null {
    return entryOf(state, key).bytes
}

function sameOptionalBytes(a: Uint8Array | null, b: Uint8Array | null): boolean {
    return a === null || b === null ? a === b : sameBytes(a, b)
}

function entriesDiffer(a: RawEntry, b: RawEntry): boolean {
    return !sameOptionalBytes(a.bytes, b.bytes) || a.revision !== b.revision
}

type FenceView =
    | { state: 'absent' }
    | { state: 'parsed', keys: Set<string> }
    | { state: 'blocked' }

function fenceViewOf(bytes: Uint8Array | null): FenceView {
    if (bytes === null) {
        return { state: 'absent' }
    }
    const unit = readUnit(bytes, UNIT_TYPE.fenceRecord)
    if (unit.status === 'ok' || unit.status === 'stale') {
        const record = unit.value.body as FenceRecord
        return { state: 'parsed', keys: new Set(record.keys.map(keyOfTail)) }
    }
    return { state: 'blocked' }
}

/** The manifest positions whose unit names further units that a refs walk must open. */
const DESCENT: Readonly<Record<string, UnitType>> = {
    'shards[]': UNIT_TYPE.shard,
    'fixed.moduleIndex': UNIT_TYPE.moduleIndex,
    'fixed.pluginStorage.refs[]': UNIT_TYPE.pluginStorageBucket,
}

interface Walk {
    /** Every key of the tree, the manifest first. */
    keys: string[]
    /** The keys of the tree that hold no value. */
    missing: string[]
    /** Why a unit could not be opened, when one could not. */
    unreadable: string[]
}

/** The refs walk of one manifest over `state`, through `refsOf` and the stored bytes only. */
function walkManifest(state: RawState, manifestKey: string): Walk {
    const walk: Walk = { keys: [manifestKey], missing: [], unreadable: [] }
    const note = (key: string): void => {
        walk.keys.push(key)
        if (bytesOfKey(state, key) === null) {
            walk.missing.push(key)
        }
    }
    const manifestBytes = bytesOfKey(state, manifestKey)
    if (manifestBytes === null) {
        walk.missing.push(manifestKey)
        return walk
    }
    const manifest = readUnit(manifestBytes, UNIT_TYPE.manifest)
    if (manifest.status !== 'ok' && manifest.status !== 'stale') {
        walk.unreadable.push(manifestKey)
        return walk
    }
    for (const target of refsOf(UNIT_TYPE.manifest, manifest.value.body)) {
        const key = keyOfTail(target.tail)
        note(key)
        const type = DESCENT[target.path]
        const bytes = bytesOfKey(state, key)
        if (type === undefined || bytes === null) {
            continue
        }
        const child = readUnit(bytes, type)
        if (child.status !== 'ok' && child.status !== 'stale') {
            walk.unreadable.push(key)
            continue
        }
        for (const leaf of refsOf(type, child.value.body)) {
            note(keyOfTail(leaf.tail))
        }
    }
    return walk
}

function manifestsNamed(key: CommitKey): string[] {
    return [
        ...(key.current === null ? [] : [key.current.key]),
        ...key.retained.map((entry) => entry.key),
        ...key.pins.map((pin) => pin.key),
    ]
}

function parsedCommitOf(bytes: Uint8Array | null): CommitKey | null {
    const read = classifyCommitRead({ bytes })
    return read.status === 'parsed' ? read.value : null
}

function sameJson(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b)
}

type Staging = CommitKey['staging']

/** Whether `kind` may move `staging` from `old` to `next`; a change by any other operation is a violation. */
function stagingMayChange(kind: OperationKind | null, context: ActorContext | null, old: Staging, next: Staging): boolean {
    const owner = context?.owner
    switch (kind) {
        case 'bulk-begin':
            return next !== null && next.owner === owner && (old === null || old.owner === owner)
        case 'bulk-final':
            return old !== null && old.owner === owner && next === null
        case 'start-clear':
            return old !== null && old.owner === owner && next === null
        case 'foreign-clear':
            return old !== null && old.owner !== owner && next === null
        case 'abandon-clear':
            return old !== null && context?.abandon !== undefined
                && old.owner === context.abandon.owner && old.prefix === context.abandon.prefix && next === null
        case 'recovery-begin':
            return next !== null && next.owner === owner
        case 'recovery-install':
            return next === null
        default:
            return false
    }
}

const PIN_KINDS: readonly OperationKind[] = ['pin', 'unpin', 'recovery-begin', 'recovery-install']
const UPLOADER_KINDS: readonly OperationKind[] = ['bulk-final', 'recovery-install']

function expectMatches(expect: Expect, stored: RawEntry): boolean {
    if (expect.kind === 'bytes') {
        return sameOptionalBytes(expect.bytes, stored.bytes)
    }
    // An unconditional write presents no revision.
    return expect.revision === null || expect.revision === (stored.revision ?? ABSENT_REVISION)
}

// ---- The checker ----

export function createChecker(read: () => RawState): Checker {
    let before = read()
    const created = new Set<string>()
    for (const [key, entry] of before) {
        if (isStore2Key(key) && entry.bytes !== null) {
            created.add(key)
        }
    }
    const uploadedBy = new Map<string, Set<string>>()
    // The last commit-key value that parsed: what a damaged key stood for.
    let lastGood: CommitKey | null = parsedCommitOf(bytesOfKey(before, COMMIT_KEY))
    // The last fence key list that parsed, kept across damage; null once the fence was absent.
    let knownFenceKeys: Set<string> | null = (() => {
        const view = fenceViewOf(bytesOfKey(before, FENCE_KEY))
        return view.state === 'parsed' ? view.keys : null
    })()
    // Per actor, the commit key and the fence as its most recent read observed them: the gate a deleter evaluated.
    const lastCommitRead = new Map<string, RawEntry>()
    const lastFenceRead = new Map<string, RawEntry>()
    const reported = new Set<string>()
    const violations: Violation[] = []
    let walked = false

    function observe(info: StepInfo): Violation[] {
        const after = read()
        const found: Violation[] = []
        const report = (property: PropertyId, detail: string, key: string = detail): void => {
            const id = `${property}|${key}`
            if (reported.has(id)) {
                return
            }
            reported.add(id)
            const violation: Violation = { property, step: info.step, actor: info.actor, detail }
            violations.push(violation)
            found.push(violation)
        }

        const isCall = info.kind === 'call'
        const context = info.context
        const kind: OperationKind | null = context === null ? null : context.kind
        const commitBefore = entryOf(before, COMMIT_KEY)
        const commitAfter = entryOf(after, COMMIT_KEY)
        const fenceBefore = entryOf(before, FENCE_KEY)
        const fenceAfter = entryOf(after, FENCE_KEY)
        const commitChanged = entriesDiffer(commitBefore, commitAfter)
        const fenceChanged = entriesDiffer(fenceBefore, fenceAfter)

        const removed: string[] = []
        let unitsChanged = false
        for (const [key, entry] of before) {
            if (isStore2Key(key) && entry.bytes !== null && entryOf(after, key).bytes === null) {
                removed.push(key)
            }
        }
        for (const [key, entry] of after) {
            if (!isStore2Key(key)) {
                continue
            }
            const previous = entryOf(before, key)
            if (!entriesDiffer(previous, entry)) {
                continue
            }
            unitsChanged = true
            if (!isCall || entry.bytes === null) {
                continue
            }
            if (previous.bytes === null) {
                if (created.has(key)) {
                    report('I2', `${key} was created a second time by ${info.actor} (${info.op})`)
                }
                created.add(key)
                let mine = uploadedBy.get(info.actor)
                if (mine === undefined) {
                    mine = new Set<string>()
                    uploadedBy.set(info.actor, mine)
                }
                mine.add(key)
            } else {
                report('I2', `${key} was rewritten in place by ${info.actor} (${info.op})`)
            }
        }
        unitsChanged = unitsChanged || removed.length > 0

        // The value a possibly damaged commit key stands for.
        const parsedBefore = parsedCommitOf(commitBefore.bytes)
        const viewBefore = parsedBefore ?? lastGood

        if (commitBefore.bytes !== null && commitAfter.bytes === null) {
            report('I4', `the commit key was removed by ${info.actor} (${info.op})`)
        }

        if (isCall) {
            // Removals against a standing staging prefix and a standing fence.
            const staging = viewBefore?.staging ?? null
            if (staging !== null) {
                for (const key of removed) {
                    if (key.startsWith(staging.prefix)) {
                        report('h', `${key} under the standing staging prefix ${staging.prefix} was removed by ${info.actor} (${info.op})`)
                    }
                }
            }
            // The gate is evaluated at the deleter's read. With no recorded read the stored state stands for it.
            const fenceRead = lastFenceRead.get(info.actor)
            const fenceView = fenceViewOf(fenceBefore.bytes)
            if (removed.length > 0 && fenceRead !== undefined && fenceViewOf(fenceRead.bytes).state === 'blocked') {
                report('G1', `${removed.length} key(s) were removed by ${info.actor} (${info.op}) after it read a fence that could not be understood: ${removed[0]}`)
            } else if (fenceView.state === 'parsed') {
                for (const key of removed) {
                    if (fenceView.keys.has(key)) {
                        report('G1', `${key} listed by the standing fence was removed by ${info.actor} (${info.op})`)
                    }
                }
            } else if (fenceView.state === 'blocked' && removed.length > 0) {
                if (fenceRead === undefined) {
                    report('G1', `${removed.length} key(s) were removed by ${info.actor} (${info.op}) while the fence could not be understood: ${removed[0]}`)
                } else if (knownFenceKeys !== null) {
                    // Damage arrived after the read: judged against the list the fence held before it.
                    for (const key of removed) {
                        if (knownFenceKeys.has(key)) {
                            report('G1', `${key} listed by the fence before it was damaged was removed by ${info.actor} (${info.op})`)
                        }
                    }
                }
            }

            if (removed.length > 0) {
                const commitRead = lastCommitRead.get(info.actor)
                const refusedAtRead = commitRead !== undefined && !commitAllowsDeletion(commitRead.bytes)
                const damagedSinceRead = commitRead !== undefined && !refusedAtRead && parsedBefore === null
                if (damagedSinceRead) {
                    // Damage arrived after the gate read: judged against the last commit key that parsed.
                    const reachable = new Set<string>()
                    for (const manifest of viewBefore === null ? [] : manifestsNamed(viewBefore)) {
                        for (const key of walkManifest(before, manifest).keys) {
                            reachable.add(key)
                        }
                    }
                    for (const key of removed) {
                        if (reachable.has(key)) {
                            report('I1', `${key}, reachable from the commit key as it stood before it was damaged, was removed by ${info.actor} (${info.op})`)
                        }
                    }
                } else if (refusedAtRead || !commitAllowsDeletion(commitBefore.bytes)) {
                    report('I1', `${removed.length} key(s) were removed by ${info.actor} (${info.op}) while the commit key was absent, unparsable, too new or named no current: ${removed[0]}`)
                }
            }

            // The fence key is written by an exit alone and removed by a discard alone.
            if (fenceChanged && fenceAfter.bytes !== null && kind !== 'fence-exit') {
                report('G1', `the fence key was written by ${info.actor} (${info.op}, ${kind ?? 'no operation'}), which is not a fence exit`)
            }
            if (fenceBefore.bytes !== null && fenceAfter.bytes === null && kind !== 'fence-discard') {
                report('G1', `the fence key was removed by ${info.actor} (${info.op}, ${kind ?? 'no operation'}), which is not a fence discard`)
            }
            // A call that changed the fence or removed units acted on the fence it presented.
            if (info.fenceExpect !== null && (fenceChanged || removed.length > 0) && !expectMatches(info.fenceExpect, fenceBefore)) {
                report('G1', `${info.actor} (${info.op}) acted on a fence other than the one it presented`)
            }

            if (fenceChanged && fenceAfter.bytes !== null) {
                const next = fenceViewOf(fenceAfter.bytes)
                const base = fenceViewOf(fenceBefore.bytes)
                const baseKeys = base.state === 'parsed' ? base.keys : base.state === 'blocked' ? knownFenceKeys : null
                if (next.state === 'parsed' && baseKeys !== null) {
                    for (const key of baseKeys) {
                        if (!next.keys.has(key)) {
                            report('G10', `the fence written by ${info.actor} (${info.op}) no longer lists ${key}`)
                            break
                        }
                    }
                }
            }
        }

        const parsedAfter = parsedCommitOf(commitAfter.bytes)
        if (isCall && commitChanged && parsedAfter !== null) {
            judgeCommitWrite(parsedAfter)
        }

        function judgeCommitWrite(next: CommitKey): void {
            const base = viewBefore
            if (info.commitExpect !== null && !expectMatches(info.commitExpect, commitBefore)) {
                report('I3', `${info.actor} (${info.op}) replaced a commit key that was not the version it presented`)
            }
            if (parsedBefore !== null && next.seq !== parsedBefore.seq + 1) {
                report('I3', `${info.actor} (${info.op}) wrote seq ${next.seq} over a stored seq ${parsedBefore.seq}: the value was not built from the stored version`)
            }

            const oldStaging = base?.staging ?? null
            if (!sameJson(oldStaging, next.staging) && !stagingMayChange(kind, context, oldStaging, next.staging)) {
                report('h', `${info.actor} (${kind ?? 'no operation'}) changed staging ${JSON.stringify(oldStaging)} to ${JSON.stringify(next.staging)}`)
            }

            const oldPins = base?.pins ?? []
            if ((kind === null || !PIN_KINDS.includes(kind)) && !sameJson(oldPins, next.pins)) {
                report('p', `${info.actor} (${kind ?? 'no operation'}) changed the pins ${JSON.stringify(oldPins)} to ${JSON.stringify(next.pins)}`)
            }

            if (kind === 'restore') {
                const previous = base?.current ?? null
                if (previous !== null && next.retained[0]?.key !== previous.key) {
                    report('r', `${info.actor} restored without pushing the previous current ${previous.key} to the head of retained`)
                }
                if (next.current !== null) {
                    const walk = walkManifest(after, next.current.key)
                    for (const key of [...walk.missing, ...walk.unreadable]) {
                        report('b', `${info.actor} restored ${next.current.key}, which names ${key}, a unit that is missing or unreadable`)
                    }
                }
            }

            if (kind !== null && UPLOADER_KINDS.includes(kind) && next.current !== null && next.current.key !== base?.current?.key) {
                const allowed = new Set<string>(uploadedBy.get(info.actor) ?? [])
                for (const manifest of base === null ? [] : manifestsNamed(base)) {
                    for (const key of walkManifest(before, manifest).keys) {
                        allowed.add(key)
                    }
                }
                for (const key of walkManifest(after, next.current.key).keys) {
                    if (!allowed.has(key)) {
                        report('i', `${info.actor} (${kind}) installed ${next.current.key}, which names ${key}, neither uploaded by it nor named by its base`)
                    }
                }
            }
        }

        // I1 over the stored state, skipped while the commit key does not parse.
        if (parsedAfter !== null && (!walked || commitChanged || unitsChanged)) {
            walked = true
            for (const manifest of manifestsNamed(parsedAfter)) {
                const walk = walkManifest(after, manifest)
                for (const key of walk.missing) {
                    if (!isRestoreReported(manifest, key)) {
                        report('I1', `${manifest} (named by the commit key) needs ${key}, which holds no value`, `${manifest}|${key}`)
                    }
                }
                for (const key of walk.unreadable) {
                    report('I1', `${manifest} (named by the commit key) needs ${key}, which cannot be read`, `${manifest}|${key}|unreadable`)
                }
            }
        }

        function isRestoreReported(manifest: string, key: string): boolean {
            return violations.some((violation) => violation.property === 'b' && violation.detail.includes(`${manifest}, which names ${key},`))
        }

        // What the next step is judged against.
        if (parsedAfter !== null) {
            lastGood = parsedAfter
        }
        const fenceNow = fenceViewOf(fenceAfter.bytes)
        if (fenceNow.state === 'parsed') {
            knownFenceKeys = fenceNow.keys
        } else if (fenceNow.state === 'absent') {
            knownFenceKeys = null
        }
        if (isCall) {
            // A read's target is the key itself on the ByteStore layer and implied by the op on a backend.
            if (info.op === 'readCommit' || (info.op === 'read' && info.target === COMMIT_KEY)) {
                lastCommitRead.set(info.actor, commitAfter)
            }
            if (info.op === 'readFence' || (info.op === 'read' && info.target === FENCE_KEY)) {
                lastFenceRead.set(info.actor, fenceAfter)
            }
        }
        before = after
        return found
    }

    return { observe, violations }
}
