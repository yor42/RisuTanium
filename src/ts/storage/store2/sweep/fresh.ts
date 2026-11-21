import { Store2BackendError, Store2CommitConflictError, Store2StalePageError } from '../backend/errors'
import { bytesTokenOf, tokenMatches, type CompareToken, type Store2Backend } from '../backend/types'
import type { GateOpen } from '../boot'
import type { Store2Session } from '../session'

/** What a deleting pass learns before a batch: `fresh` and `moved` let it go on, every other value ends it. */
export type GateFreshness = 'fresh' | 'moved' | 'fence-conflict' | 'stale-page' | 'probe-failed' | 'idle'

/** Whether a read token is the gate's revision token: the same kind and the same revision, never the revision alone. */
function sameRevision(gateToken: CompareToken, read: CompareToken): boolean {
    return gateToken.kind === 'revision' && read.kind === 'revision' && gateToken.revision === read.revision
}

/**
 * Whether the commit key and the fence are still what the gate read, in the check that precedes a batch or a record
 * write. A moved commit key is `moved` (rebuild the keep-set); a moved fence, a stale page, a failed probe or an idle
 * session is a value that ends the pass. A Node page compares the revisions of the gate's tokens (a token of another
 * kind counts as moved) and never byte tokens, which a revision token cannot be compared with. A Tauri page proves the
 * commit key unchanged with a same-bytes `casCommit` on the gate's token.
 */
export async function gateFreshness(
    session: Pick<Store2Session, 'kind' | 'idleReason'>,
    gate: GateOpen,
    backend: Store2Backend,
): Promise<GateFreshness> {
    const node = session.kind === 'node'
    try {
        const fence = await backend.readFence()
        if (node ? !sameRevision(gate.fenceToken, fence.token) : !tokenMatches(gate.fenceToken, fence.bytes)) {
            return 'fence-conflict'
        }
        if (session.kind === 'tauri') {
            const bytes = bytesTokenOf(gate.commitToken).bytes
            if (bytes === null) {
                return 'probe-failed'
            }
            // The same bytes under the gate's own token: it succeeds only while the commit key is unchanged, and the
            // native gate refuses it when a newer page has registered.
            await backend.casCommit(gate.commitToken, bytes)
        } else {
            const commit = await backend.readCommit()
            if (!sameRevision(gate.commitToken, commit.token)) {
                return 'moved'
            }
        }
    } catch (error) {
        if (error instanceof Store2CommitConflictError) {
            return 'moved'
        }
        if (error instanceof Store2StalePageError) {
            return 'stale-page'
        }
        if (error instanceof Store2BackendError) {
            return 'probe-failed'
        }
        throw error
    }
    return session.idleReason !== null ? 'idle' : 'fresh'
}
