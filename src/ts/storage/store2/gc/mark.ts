import { isStore2Key } from '../../store/keyRules'
import type { CompareToken, Store2Backend, Store2Read } from '../backend/types'
import { classifyCommitRead } from '../commitKey'
import { keyOfTail, refsOf, UNIT_TYPE, type CommitKey, type RefTarget } from '../format'
import {
    checkManifestKey, judgeTree, planTree, readBatch,
    type ParentNode, type ParseMemo, type TreePlan, type TreeRead,
} from '../tree'

/**
 * The GC mark: the set of store keys a collector must keep, from ONE read of the
 * commit key. Every manifest the commit key names (`current`, `retained`, `pins`)
 * is read and validated once; the live set is those manifests, every unit they
 * name, and every unit their shards, module index and plugin-storage buckets
 * name. A leaf (core, chunk, preset, plugin, value, list) is live by being named
 * by one of those, so the live set is not the tree read's `keys`, which omit
 * every leaf.
 *
 * The validated reads come back as `closure`, in the form the deleter gate takes,
 * and `commitToken` is the token of the commit-key read the mark walked: a pass
 * evaluates the gate on that same read, so a batch can never carry a token newer
 * than the tree it was marked from. Nothing here writes or deletes.
 */

export type MarkRefusal =
    /** The commit key read is absent, damaged or from a newer writer. */
    | 'commit-unusable'
    /** A manifest or a structural node is unreadable, absent, damaged or too new. */
    | 'closure-not-ok'
    /** A body or the commit key holds a reference this build cannot read. */
    | 'malformed'

export type MarkResult =
    | { status: 'marked', live: Set<string>, closure: TreeRead[], commit: CommitKey, commitToken: CompareToken }
    | { status: 'refused', reason: MarkRefusal, detail: string, closure: TreeRead[] }

function refused(reason: MarkRefusal, detail: string, closure: TreeRead[] = []): MarkResult {
    return { status: 'refused', reason, detail, closure }
}

/** Adds every target to `live`; returns the first key that is not a store2 unit key, or null. */
function addTargets(live: Set<string>, targets: readonly RefTarget[]): string | null {
    for (const target of targets) {
        const key = keyOfTail(target.tail)
        if (!isStore2Key(key)) {
            return key
        }
        live.add(key)
    }
    return null
}

/** The unit bodies a mark walks, once per key across every manifest. */
function parentsOf(reads: readonly { parents: ParentNode[] }[]): ParentNode[] {
    const seen = new Set<string>()
    const out: ParentNode[] = []
    for (const read of reads) {
        for (const parent of read.parents) {
            if (!seen.has(parent.key)) {
                seen.add(parent.key)
                out.push(parent)
            }
        }
    }
    return out
}

/**
 * Marks from `commitRead`. Two batched reads at most, each over the distinct keys
 * of all manifests (`readUnits` bounds its own parallelism): the manifests, then
 * every unit of the tree positions a manifest opens.
 */
export async function markLiveKeys(backend: Store2Backend, commitRead: Store2Read): Promise<MarkResult> {
    const parsed = classifyCommitRead(commitRead)
    if (parsed.status !== 'parsed') {
        return refused('commit-unusable', parsed.status === 'absent' ? 'The commit key is absent.' : parsed.reason)
    }
    const commit = parsed.value

    const live = new Set<string>()
    const manifestKeys: string[] = []
    try {
        const named = refsOf(UNIT_TYPE.commit, commit)
        const bad = addTargets(live, named)
        if (bad !== null) {
            return refused('malformed', `${bad} is not a store2 unit key.`)
        }
        for (const target of named) {
            const key = keyOfTail(target.tail)
            if (!manifestKeys.includes(key)) {
                manifestKeys.push(key)
            }
        }
    } catch (error) {
        if (error instanceof TypeError) {
            return refused('malformed', error.message)
        }
        throw error
    }

    const reads = new Map<string, TreeRead>()
    const toRead: string[] = []
    for (const key of manifestKeys) {
        const refusal = checkManifestKey(key)
        if (refusal === null) {
            toRead.push(key)
        } else {
            reads.set(key, refusal)
        }
    }
    const closureOf = (): TreeRead[] => manifestKeys.flatMap(key => reads.get(key) ?? [])

    const first = toRead.length === 0 ? null : await readBatch(backend, toRead)
    if (first !== null && first.status === 'unreadable') {
        for (const key of toRead) {
            reads.set(key, { status: 'unreadable', manifestKey: key, cause: first.cause })
        }
        return refused('closure-not-ok', 'The manifests could not be read.', closureOf())
    }
    if (first !== null && first.status === 'not-binary') {
        reads.set(first.key, { status: 'damaged', manifestKey: first.key, keys: [first.key], missing: [], reason: `${first.key} is not binary data.` })
        return refused('closure-not-ok', `${first.key} is not binary data.`, closureOf())
    }

    const plans: TreePlan[] = []
    if (first !== null && first.status === 'read') {
        for (const key of toRead) {
            let planned: ReturnType<typeof planTree>
            try {
                planned = planTree(key, first.units.get(key) ?? null)
            } catch (error) {
                if (error instanceof TypeError) {
                    return refused('malformed', error.message, closureOf())
                }
                throw error
            }
            if ('read' in planned) {
                reads.set(key, planned.read)
            } else {
                plans.push(planned.plan)
            }
        }
    }

    const childKeys = [...new Set(plans.flatMap(plan => [...plan.expectations.keys()]))]
    const second = childKeys.length === 0 ? null : await readBatch(backend, childKeys)
    if (second !== null && second.status === 'unreadable') {
        for (const plan of plans) {
            reads.set(plan.manifestKey, { status: 'unreadable', manifestKey: plan.manifestKey, cause: second.cause })
        }
        return refused('closure-not-ok', 'The units of the manifests could not be read.', closureOf())
    }
    if (second !== null && second.status === 'not-binary') {
        for (const plan of plans) {
            if (plan.expectations.has(second.key)) {
                reads.set(plan.manifestKey, { status: 'damaged', manifestKey: plan.manifestKey, keys: [second.key], missing: [], reason: `${second.key} is not binary data.` })
            }
        }
        return refused('closure-not-ok', `${second.key} is not binary data.`, closureOf())
    }

    const memo: ParseMemo = new Map()
    const judged: { parents: ParentNode[] }[] = []
    for (const plan of plans) {
        const result = judgeTree(plan, second !== null && second.status === 'read' ? second.units : new Map(), memo)
        reads.set(plan.manifestKey, result.read)
        judged.push(result)
    }

    const closure = closureOf()
    const notOk = closure.find(read => read.status !== 'ok')
    if (notOk !== undefined) {
        return refused('closure-not-ok', `The tree of ${notOk.manifestKey} is ${notOk.status}.`, closure)
    }

    try {
        for (const read of closure) {
            if (read.status !== 'ok') {
                continue
            }
            const bad = addTargets(live, refsOf(UNIT_TYPE.manifest, read.manifest))
            if (bad !== null) {
                return refused('malformed', `${bad} is not a store2 unit key.`, closure)
            }
        }
        for (const parent of parentsOf(judged)) {
            const bad = addTargets(live, refsOf(parent.type, parent.body))
            if (bad !== null) {
                return refused('malformed', `${bad} is not a store2 unit key.`, closure)
            }
        }
    } catch (error) {
        if (error instanceof TypeError) {
            return refused('malformed', error.message, closure)
        }
        throw error
    }

    return { status: 'marked', live, closure, commit, commitToken: commitRead.token }
}
