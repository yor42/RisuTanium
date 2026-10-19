import { Store2BackendError, Store2BackendFailureError, Store2CommitConflictError, Store2UnknownOutcomeError } from './backend/errors'
import type { Store2Backend, Store2Read } from './backend/types'
import { checkBuiltUnits, createKeyMint, type AbandonResult, type BuildContext, type BuiltCommit } from './commit'
import { probeStore2Presence } from './boot'
import { classifyCommitRead } from './commitKey'
import {
    defaultKeyEnv, encodeUnit, newStagingId, stagingPrefix, UNIT_TYPE,
    type KeyEnv, type StagingLabel,
} from './format'
import type { Staging } from './owner'
import { confirmMarker, judgeConflict, markerKey, settleUnknown, type Landed, type MarkerOutcome } from './recovery'
import { finalWrite, InstallStop, stagingIdOf, type InstallBasis, type InstallResult } from './recoveryPick'
import type { SessionDecision } from './session'

/**
 * First life of a store (plan v3.4 amendment 7, boot rows 1 and 9). A first-life install writes an unfenced marker,
 * stages the encoder-built tree under the marker's prefix and makes one final compare-and-write; no fence is written,
 * because a fence stops every sweep and a first-life store has nothing to protect.
 *
 * The unfenced marker is accepted only from two states, enforced by the type `FirstLifeGrant`, which only
 * `firstLifeGrant` can make:
 *  - an absence read of the commit key whose store2 listing classified boot row 1;
 *  - this page's own row-9 clear, i.e. the cleared result of its start-up clear, with the key read back unchanged.
 * A grant is made from values the caller holds, so `writeFirstLifeMarker` does not trust the row-1 grant: it lists
 * `store2/` again immediately before the marker write and refuses unless the store holds no unit (units cannot appear under
 * an absent commit key, so the answer cannot go stale before the write). The row-9 grant checks that the cleared bytes
 * decode to the cleared value and that the key read back parses as `current: null, staging: null`.
 * Every other state (a standing marker, a parsed key with a `current`, a foreign marker, a damaged or too-new key) is
 * refused, because the fence is what makes a marker over such a state safe; that path is `runExit`. A standing marker
 * of this page's own device that its start-up clear removed is the row-9 state, and that clear only removes a convert or seed marker: a
 * convert or seed that a fenced `runExit` marker left behind on a device that keeps its owner id is re-run through
 * this grant, without the question, because the marker already recorded the consent. Its fence stays and still stops
 * the sweeps.
 *
 * `installBuilt` is the one installer of an encoder-built tree. It serves the first-life marker and a fenced `runExit`
 * marker alike. Nothing is written outside the marker's staging prefix before the final write, and the final write
 * compares at the marker's read-back token.
 *
 * Invariant: an install that does not reach its final write (a failed or lost unit write, a build that throws, a crash)
 * leaves its marker standing and clears nothing; a final write whose outcome cannot be read back answers `unknown`, never
 * a throw, because that write may have landed. The next boot classifies the marker as it classifies any other: its own
 * on a device that keeps its owner id (row 9, cleared and re-run), foreign on a web page (the foreign-marker path).
 */

const GRANT_BRAND: unique symbol = Symbol('firstLifeGrant')

/** The license to write an unfenced marker. Never built outside `firstLifeGrant`. */
export interface FirstLifeGrant {
    readonly [GRANT_BRAND]: true
    /** Which of the two accepted states the grant stands on. */
    readonly source: 'absent-row-1' | 'own-row-9-clear'
    /** `convert` when an upstream main file exists (or the cleared marker was a conversion), `seed` otherwise. */
    readonly kind: 'convert' | 'seed'
    /**
     * The staging label the marker carries. It is `kind` unless a row-1 caller overrode it (`FirstLifeLabel`): the label
     * is what the caller is about to install, because it decides how a crashed install classifies at the next boot.
     */
    readonly label: StagingLabel
    /** The read the marker is written at: the absence read, or the read of the cleared key. */
    readonly read: Store2Read
}

/**
 * The label a row-1 caller installs under when it is not the boot decision's own: `convert` for a restore of the newest
 * numbered backup (a crash classifies as row 10), `import` for a `.bin` import (a crash classifies as row 11). Neither
 * may classify as row 9, whose re-run would seed an empty profile over the backups.
 */
export type FirstLifeLabel = Extract<StagingLabel, 'convert' | 'import'>

/** The boot decision of row 1 over an absent key: the only decision a label override may accompany. */
export type Row1FirstLifeDecision = Extract<SessionDecision, { row: 1, mode: 'first-life' }>

/** What `firstLifeGrant` reads: the boot decision, the page's read of the commit key and the result of its start-up clear. A `Store2Session` has all three. */
export interface FirstLifeFacts {
    decision: SessionDecision
    commitRead: Store2Read | null
    startupClear: AbandonResult | null
}

export type FirstLifeRefusal =
    | 'not-first-life' | 'read-missing' | 'key-present'
    | 'foreign-marker' | 'not-cleared' | 'key-changed' | 'label-not-row-1'

export type GrantResult =
    | { status: 'granted', grant: FirstLifeGrant }
    | { status: 'refused', reason: FirstLifeRefusal, detail: string }

function refused(reason: FirstLifeRefusal, detail: string): GrantResult {
    return { status: 'refused', reason, detail }
}

function granted(source: FirstLifeGrant['source'], kind: FirstLifeGrant['kind'], label: StagingLabel, read: Store2Read): GrantResult {
    return { status: 'granted', grant: { [GRANT_BRAND]: true, source, kind, label, read } }
}

/** The facts of a row-1 grant: the decision is narrowed, so a label override cannot be passed with a row-9 decision. */
export interface Row1FirstLifeFacts extends FirstLifeFacts {
    decision: Row1FirstLifeDecision
}

/**
 * The grant for an unfenced marker, or the reason there is none. Only boot row 1 over an absence read, and boot
 * row 9 with this page's own marker cleared by this page's start-up clear, are accepted.
 *
 * `options.label` overrides the marker's label on a row-1 grant only; the overload makes it a type error with any other
 * decision, and a row-9 decision that reaches it anyway is refused at run time (`label-not-row-1`).
 */
export function firstLifeGrant(facts: FirstLifeFacts): GrantResult
export function firstLifeGrant(facts: Row1FirstLifeFacts, options: { label: FirstLifeLabel }): GrantResult
export function firstLifeGrant(facts: FirstLifeFacts, options?: { label: FirstLifeLabel }): GrantResult {
    const { decision, commitRead, startupClear } = facts
    if (options !== undefined && !(decision.row === 1 && decision.mode === 'first-life')) {
        return refused('label-not-row-1', 'A label override is accepted only on a boot row 1 grant.')
    }
    if (decision.row === 1 && decision.mode === 'first-life') {
        if (commitRead === null) {
            return refused('read-missing', 'The commit key read is missing.')
        }
        if (classifyCommitRead(commitRead).status !== 'absent') {
            return refused('key-present', 'The commit key is not absent.')
        }
        return granted('absent-row-1', decision.action, options?.label ?? decision.action, commitRead)
    }
    if (decision.row === 9 && decision.mode === 'rerun') {
        if (decision.clear !== 'own') {
            return refused('foreign-marker', 'The standing marker is not this page\'s own.')
        }
        if (startupClear === null || startupClear.status !== 'cleared' || startupClear.value.current !== null || startupClear.value.staging !== null) {
            return refused('not-cleared', 'This page\'s own marker was not cleared by its start-up clear.')
        }
        if (commitRead === null || commitRead.bytes === null || !sameClearedBytes(commitRead.bytes, startupClear.bytes)) {
            return refused('key-changed', 'The commit key is not what the start-up clear left.')
        }
        const read = classifyCommitRead(commitRead)
        const decoded = classifyCommitRead({ bytes: startupClear.bytes })
        if (read.status !== 'parsed' || read.value.current !== null || read.value.staging !== null
            || decoded.status !== 'parsed' || JSON.stringify(decoded.value) !== JSON.stringify(startupClear.value)) {
            return refused('not-cleared', 'The cleared bytes are not the cleared state this page\'s start-up clear reported.')
        }
        return granted('own-row-9-clear', decision.operation, decision.operation, commitRead)
    }
    return refused('not-first-life', `Boot row ${decision.row ?? 'none'} is not a first-life state.`)
}

function sameClearedBytes(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) {
        return false
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false
        }
    }
    return true
}

// ---- The unfenced marker ----

/** A landed first-life marker: `runExit`'s `marked` result with no fence. */
export type FirstLifeMarked = Extract<MarkerOutcome<undefined>, { status: 'marked' }>

export type FirstLifeMarkerResult =
    | MarkerOutcome<undefined>
    /**
     * A row-1 grant over a store that holds, or may hold, a unit: no marker was written. With a grant derived from a
     * session's own boot facts, `store-not-empty` means a peer moved first; the caller re-classifies the boot exactly as
     * after a conflict and never treats it as row 2. `presence-unknown` blocks, as row-1 presence-unknown does.
     */
    | { status: 'refused', reason: 'store-not-empty' | 'presence-unknown' }
    /** The marker write failed definitely; the commit key was not changed. */
    | { status: 'failed', cause: Store2BackendError }

/**
 * Compare-and-writes the marker at the grant's read: `current: null`, empty `retained` and `pins`, a fresh staged
 * prefix, `seq` 1 over an absent key and one above the cleared key otherwise. No fence is read or written. A
 * conflict is judged as `runExit` judges it: a key that now holds a `current` is `abandoned`, anything else is a
 * `conflict` for the caller to classify again.
 */
export async function writeFirstLifeMarker(
    backend: Store2Backend, grant: FirstLifeGrant, options: { owner: string, env?: KeyEnv },
): Promise<FirstLifeMarkerResult> {
    const env: KeyEnv = { ...defaultKeyEnv, ...options.env }
    if (grant.source === 'absent-row-1') {
        const presence = await probeStore2Presence(backend)
        if (presence.status !== 'none') {
            return { status: 'refused', reason: presence.status === 'some' ? 'store-not-empty' : 'presence-unknown' }
        }
    }
    const label = grant.label
    const stagedPrefix = stagingPrefix(newStagingId(env))
    const staging: Staging = { owner: options.owner, prefix: stagedPrefix, startedAt: env.now(), label }
    const marker = markerKey(classifyCommitRead(grant.read), staging, 0, env)
    const markerBytes = encodeUnit(UNIT_TYPE.commit, marker)
    const landed: Landed<undefined> = { label, owner: options.owner, stagedPrefix, fence: undefined }
    try {
        const flushed = (await backend.casCommit(grant.read.token, markerBytes)).flushed
        return await confirmMarker(backend, marker, markerBytes, landed, flushed)
    } catch (error) {
        if (error instanceof Store2CommitConflictError) {
            return judgeConflict(backend)
        }
        if (error instanceof Store2UnknownOutcomeError) {
            return settleUnknown(backend, marker, markerBytes, landed, error)
        }
        if (error instanceof Store2BackendError) {
            return { status: 'failed', cause: error }
        }
        throw error
    }
}

// ---- The installer ----

/** A standing marker of any kind the installer can build on: the final write's basis plus the prefix the staged units go under. */
export interface BuiltInstallBasis extends InstallBasis {
    marked: InstallBasis['marked'] & { stagedPrefix: string }
}

export interface BuiltInstall {
    /** How many new units the build writes, the manifest included. */
    newUnits: number
    /** Builds the tree under keys of `context.mint`, the staging mint of the marker's prefix; the same contract as `CommitRequest.build`. */
    build(context: BuildContext): BuiltCommit | Promise<BuiltCommit>
    /** `convertedFrom` of the final commit key; `convertedAt` is the clock at the final write's build. */
    convertedFrom: string
}

async function putBuilt(backend: Store2Backend, key: string, bytes: Uint8Array): Promise<void> {
    let flushed: boolean | undefined
    try {
        flushed = (await backend.putUnit(key, bytes)).flushed
    } catch (error) {
        if (error instanceof Store2BackendError) {
            throw new InstallStop({ status: 'upload-failed', cause: error })
        }
        throw error
    }
    if (flushed === false) {
        // The final write must not name a unit that may not survive power loss.
        throw new InstallStop({ status: 'upload-failed', cause: new Store2BackendFailureError(`The unit ${key} was written but its flush failed or was not reported as done, so the install stopped.`) })
    }
}

/**
 * Installs an encoder-built tree on a standing marker. Every unit is written under a key of the marker's staging
 * mint (an unminted key, or one outside the prefix, is refused before anything is written), the manifest last, and
 * then one compare-and-write at the marker's read-back token installs `current`, clears the marker, empties
 * `retained` and `pins`, stamps `convertedFrom` and `convertedAt` and, when the build carries one, sets the pointer to
 * its deletion snapshot. The snapshot unit is one of the units written before the manifest, and a unit whose flush
 * is not confirmed stops the install before the final write. A build that throws propagates with the marker
 * standing. Every outcome of the writes, including a failed read-back after the final write (`unknown`), is an
 * `InstallResult`; an `InstallStop` never escapes.
 */
export async function installBuilt(basis: BuiltInstallBasis, request: BuiltInstall): Promise<InstallResult> {
    const { backend, env, marked } = basis
    const { mint, issued } = createKeyMint(env, stagingIdOf(marked.stagedPrefix))
    const built = await request.build({ mint, seq: marked.marker.seq + 1, now: env.now() })
    const refusal = checkBuiltUnits(built, issued, request.newUnits, true)
    if (refusal !== null) {
        throw new TypeError(`The built tree was refused before any write: ${refusal.detail}`)
    }
    try {
        for (const unit of built.units) {
            await putBuilt(backend, unit.key, unit.bytes)
        }
        await putBuilt(backend, built.manifest.key, encodeUnit(UNIT_TYPE.manifest, built.manifest.body))
        return await finalWrite(basis, built.manifest.key, built.manifest.body, { from: request.convertedFrom, at: env.now() }, built.snapshot)
    } catch (error) {
        if (error instanceof InstallStop) {
            return error.result
        }
        throw error
    }
}

export type FirstLifeResult =
    /**
     * The marker did not land (a conflict, an abandonment, a refusal, a failed or unknown write): nothing was staged.
     * A `refused` marker with a session-derived grant means a peer moved first: re-classify the boot as after a conflict.
     */
    | { status: 'not-marked', marker: Exclude<FirstLifeMarkerResult, FirstLifeMarked> }
    | InstallResult

/**
 * A first-life install: the unfenced marker, then `installBuilt` on it. The staging prefix of the marker is the only
 * place the tree is written before the final write.
 */
export async function firstLifeInstall(
    backend: Store2Backend, grant: FirstLifeGrant, request: BuiltInstall, options: { owner: string, env?: KeyEnv },
): Promise<FirstLifeResult> {
    const env: KeyEnv = { ...defaultKeyEnv, ...options.env }
    const marker = await writeFirstLifeMarker(backend, grant, { owner: options.owner, env })
    if (marker.status !== 'marked') {
        return { status: 'not-marked', marker }
    }
    return installBuilt({ backend, env, marked: marker }, request)
}
