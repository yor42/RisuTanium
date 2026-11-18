/**
 * The lorebook rule tester's session: the typed text and the last result of the
 * one character the tester is bound to, plus the signal that the result no
 * longer matches the data it was computed from.
 *
 * Memory only. Nothing here is written to storage, `studioScreen` or the
 * database; a reload or a different bound character starts empty. The stale
 * signal only reads.
 *
 * Only the slot is reactive. The latch, the baseline and the run token are
 * plain variables, so asking `isLoreTestStale` from a template or a derived
 * never mutates reactive state.
 */
import type { OwnerModel } from './ownerModel'
import type { LoreTestOutcome } from './loreTest'
import { CHAT_SKIP, OWNER_SKIP } from './loreTestFields'
import { DBState } from '../stores.svelte'
import { isModuleStub } from '../storage/moduleStub'

export interface LoreTestSlot {
    chaId: string
    text: string
    pending: boolean
    outcome: LoreTestOutcome | null
    error: boolean
}

export const loreTestSlot: LoreTestSlot = $state({ chaId: '', text: '', pending: false, outcome: null, error: false })

let latched = false
let baseline = 0
let seq = 0
let revision: (() => number) | null = null
let deepReads = 0

/** How many times the scan inputs were deep-read since the page loaded. */
export function loreTestDeepReadCount(): number {
    return deepReads
}

/**
 * The own string keys of `value`. `Reflect.ownKeys` rather than `Object.keys`:
 * on a reactive proxy `Object.keys` also reads every key's value to test its
 * descriptor, which would watch the keys the scan skips.
 */
function keysOf(value: object): string[] {
    return Reflect.ownKeys(value).filter((key): key is string => typeof key === 'string')
}

/** Reads every value of `value`, so a change anywhere inside it invalidates the reader. Writes nothing. */
function touch(value: unknown, seen: Set<object>): void {
    if (typeof value !== 'object' || value === null || seen.has(value)) {
        return
    }
    seen.add(value)
    for (const key of keysOf(value)) {
        touch((value as Record<string, unknown>)[key], seen)
    }
}

function moduleRowOf(ownerId: string): unknown {
    const rows = DBState.db.modules ?? []
    const suffix = ownerId.lastIndexOf('#')
    if (suffix > 0) {
        const row = rows[Number(ownerId.slice(suffix + 1))]
        if (row && `${row.id}${ownerId.slice(suffix)}` === ownerId) {
            return row
        }
    }
    return rows.find((row) => row.id === ownerId)
}

/**
 * The inputs one Run reads: the bound character's own fields except its chats,
 * the context chat except its memory and branch fields, the lorebook settings
 * and module switches in the database, the user name, the persona bound to the
 * context chat and the lorebooks of the modules active at the Run. It mirrors
 * the runner's copy; another chat of the character is never reached.
 */
function readScanInputs(chaId: string, moduleIds: readonly string[]): void {
    deepReads += 1
    const db = DBState.db
    const seen = new Set<object>()
    const live = db.characters.find((candidate) => candidate.chaId === chaId)
    let bound: string | undefined
    if (live) {
        for (const key of keysOf(live)) {
            if (!OWNER_SKIP.has(key)) {
                touch((live as unknown as Record<string, unknown>)[key], seen)
            }
        }
        const chat = live.chats?.[live.chatPage]
        if (chat) {
            for (const key of keysOf(chat)) {
                if (!CHAT_SKIP.has(key)) {
                    touch((chat as unknown as Record<string, unknown>)[key], seen)
                }
            }
            bound = chat.bindedPersona
        }
    }
    touch(db.enabledModules, seen)
    touch(db.moduleIntergration, seen)
    touch(db.loreBookDepth, seen)
    touch(db.loreBookToken, seen)
    touch(db.templateDefaultVariables, seen)
    touch(db.username, seen)
    if (bound) {
        touch(db.personas?.find((persona) => persona.id === bound), seen)
    }
    for (const id of moduleIds) {
        const row = moduleRowOf(id)
        if (row && !isModuleStub(row)) {
            touch((row as { lorebook?: unknown }).lorebook, seen)
        }
    }
}

/**
 * A reader that is a fresh unowned derived over the scan inputs: it returns a
 * new number each time one of them changed, and never writes or defaults.
 */
function createRevision(chaId: string, moduleIds: readonly string[]): () => number {
    let evaluations = 0
    const current = $derived.by(() => {
        readScanInputs(chaId, moduleIds)
        evaluations += 1
        return evaluations
    })
    return () => current
}

/** Clears the slot and the stale bookkeeping when `chaId` is not the bound character; call only from an effect or a handler. */
export function resetLoreTestFor(chaId: string): void {
    if (loreTestSlot.chaId === chaId) {
        return
    }
    seq += 1
    latched = false
    revision = null
    loreTestSlot.chaId = chaId
    loreTestSlot.text = ''
    loreTestSlot.pending = false
    loreTestSlot.outcome = null
    loreTestSlot.error = false
}

export function setLoreTestText(chaId: string, text: string): void {
    resetLoreTestFor(chaId)
    loreTestSlot.text = text
}

/**
 * True once any scan input changed since the Run that produced the result.
 * Once true it stays true until the next Run and the inputs are not read again.
 */
export function isLoreTestStale(): boolean {
    // The outcome is the reactive read that re-asks after a Run, which replaces the reader.
    void loreTestSlot.outcome
    if (latched) {
        return true
    }
    if (revision === null) {
        return false
    }
    if (revision() !== baseline) {
        latched = true
        revision = null
        return true
    }
    return false
}

/**
 * Runs the test for the model's character with the slot's text. The runner is
 * imported first; the baseline and the runner's snapshot are then taken in one
 * synchronous turn, so an edit during the import is neither missed nor falsely
 * stale, and an edit during the run is stale.
 */
export async function runLoreTester(model: OwnerModel): Promise<void> {
    const chaId = model.character.id
    resetLoreTestFor(chaId)
    if (loreTestSlot.pending) {
        return
    }
    const moduleIds = model.modules.filter((owner) => !owner.stub).map((owner) => owner.id)
    loreTestSlot.pending = true
    loreTestSlot.error = false
    seq += 1
    const token = seq
    latched = false
    revision = null
    try {
        const runner = await import('./loreTest')
        if (token !== seq) {
            return
        }
        revision = createRevision(chaId, moduleIds)
        baseline = revision()
        const outcome = await runner.runLoreTest({ chaId, text: loreTestSlot.text })
        if (token === seq) {
            loreTestSlot.outcome = outcome
        }
    }
    catch {
        if (token === seq) {
            loreTestSlot.error = true
        }
    }
    finally {
        if (token === seq) {
            loreTestSlot.pending = false
        }
    }
}
