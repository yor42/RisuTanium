// The rewrite planner of a merge: which places change from the removed name to the kept one, as `textEdit`
// splices. Pure: it plans and applies nothing.
//
// Invariants (the merge preview and the setter rely on them):
// - A reference is rewritten when it equals the removed name under its syntax's comparison and does not equal the
//   kept name under that comparison; it becomes the kept name exactly. One that already equals the kept name under
//   its comparison (a case-only merge of a case-insensitive form) is left and listed as "already shows".
// - Only places the scan reaches and does not flag are edited: the scan list and the rewrite list are the same
//   list, minus the flagged places. Flagged places are returned for the listing, never edited.
// - A kept name that the place would read as syntax is not written there: the place is listed instead.
// - The edits are one list in apply order: targets in registry order, and inside a target the highest offset first,
//   so an earlier edit never moves a later one. Spans never overlap.

import { assetPoolKey } from './folderCodec'
import { imgSrcNameIsReadable, readsAsReplacementPattern, scanForName, type AssetKind, type PlaceHit } from './referenceScan'
import type { ClassifiedTarget } from './referenceTargets'

export interface TextEdit {
    target: string
    offset: number
    /** The text now at `offset`. */
    from: string
    /** The text the edit writes there. */
    to: string
}

export interface TargetText {
    target: string
    text: string
}

export interface RewritePlan {
    /** In apply order. */
    edits: TextEdit[]
    /** The places the edits change, in the same order as `edits`. */
    rewritten: PlaceHit[]
    /** Left alone because they already show the kept name. */
    alreadyShows: PlaceHit[]
    /** Listed, never rewritten. */
    notRewritten: PlaceHit[]
    /** `{{ele::` lists naming the removed name. */
    nameLists: PlaceHit[]
    /**
     * The text before the edit of every edited target the restore point tracks (`desc` and
     * `alternateGreetings/<i>`), which the restore point records.
     */
    preWrite: TargetText[]
}

const RESTORE_TRACKED_TARGET = /^(desc|alternateGreetings\/\d+)$/

function equalsUnder(syntax: PlaceHit['syntax'], written: string, name: string): boolean {
    if (syntax === 'assetPrompt' || syntax === 'emoScript') {
        return written === name
    }
    return assetPoolKey(written) === assetPoolKey(name)
}

/**
 * Whether the kept name would be read as something else where it is written: as syntax (`{{`, `}}`, or a trailing
 * `}` that the lazy macro pattern would take for the closing braces), as a replacement pattern, or, in `<img src>`,
 * as a value the image lookup never takes for a name or that ends the attribute, or, in `@@emo`, as a name that the
 * engine trims before comparing it (a blank at either end). An empty name is never read as a reference: every pattern
 * needs at least one name character.
 */
function keptIsUnsafeAt(hit: PlaceHit, text: string, kept: string): boolean {
    if (kept === '' || kept.includes('{{') || kept.includes('}}') || kept.endsWith('}') || readsAsReplacementPattern(kept, hit.path)) {
        return true
    }
    // The engine trims an `@@emo` name before comparing it, so a kept name with a blank at either end would no longer
    // name the row once written.
    if (hit.syntax === 'emoScript' && kept !== kept.trim()) {
        return true
    }
    if (hit.syntax === 'imgSrc') {
        const quote = text.charAt(hit.offset - 1)
        return !imgSrcNameIsReadable(kept) || kept.includes('>') || ((quote === '"' || quote === "'") && kept.includes(quote))
    }
    return false
}

/**
 * Plans the merge of `removed` into `kept` over the targets. A target whose class is flag-only is never edited.
 */
export function planRewrite(targets: readonly ClassifiedTarget[], kind: AssetKind, removed: string, kept: string): RewritePlan {
    const plan: RewritePlan = { edits: [], rewritten: [], alreadyShows: [], notRewritten: [], nameLists: [], preWrite: [] }
    const scan = scanForName(targets, kind, removed)
    plan.notRewritten.push(...scan.flagged)
    plan.nameLists.push(...scan.nameLists)
    if (removed === kept) {
        plan.notRewritten.push(...scan.matches)
        return plan
    }
    const textOf = new Map(targets.map((target) => [target.path, target.text]))
    const byPath = new Map<string, PlaceHit[]>()
    for (const hit of scan.matches) {
        if (equalsUnder(hit.syntax, hit.name, kept)) {
            plan.alreadyShows.push(hit)
            continue
        }
        const list = byPath.get(hit.path)
        if (list) {
            list.push(hit)
        } else {
            byPath.set(hit.path, [hit])
        }
    }
    for (const target of targets) {
        const hits = byPath.get(target.path)
        if (!hits) {
            continue
        }
        const text = textOf.get(target.path) ?? ''
        const usable: PlaceHit[] = []
        let spanEnd = -1
        for (const hit of hits.slice().sort((a, b) => a.offset - b.offset)) {
            if (text.slice(hit.offset, hit.offset + hit.length) !== hit.name) {
                plan.notRewritten.push({ ...hit, reason: 'overlap' })
            } else if (keptIsUnsafeAt(hit, text, kept)) {
                plan.notRewritten.push({ ...hit, reason: 'unsafeKeptName' })
            } else if (hit.offset < spanEnd) {
                plan.notRewritten.push({ ...hit, reason: 'overlap' })
            } else {
                usable.push(hit)
                spanEnd = hit.offset + hit.length
            }
        }
        if (usable.length === 0) {
            continue
        }
        for (const hit of usable.reverse()) {
            plan.edits.push({ target: target.path, offset: hit.offset, from: hit.name, to: kept })
            plan.rewritten.push(hit)
        }
        if (RESTORE_TRACKED_TARGET.test(target.path)) {
            plan.preWrite.push({ target: target.path, text })
        }
    }
    return plan
}

/** Applies edits to a text, in the order given (highest offset first), as the setter does. */
export function spliceTextEdits(text: string, edits: readonly TextEdit[]): string {
    let result = text
    for (const edit of edits) {
        result = result.slice(0, edit.offset) + edit.to + result.slice(edit.offset + edit.from.length)
    }
    return result
}
