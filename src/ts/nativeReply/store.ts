import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { base64ToBytes, splitRangeReply, TEXT_RANGE_MAX_BYTES } from '../storage/tauriByteTransport'

/**
 * The page's side of the native reply commands (`native_reply_*`). Rust is the only writer of the records; the page
 * lists them, reads a finished body in pieces and asks for a consume, a park or a discard.
 */

export type ReplyListingState = 'live' | 'unreadable' | 'terminal' | 'incomplete' | 'dead'
export type ReplyOutcome = 'done' | 'failed' | 'stopped'

/** One record as `native_reply_list` reports it; the fields past `state` are absent where the state cannot know them. */
export interface ReplyListing {
    key: string
    state: ReplyListingState
    parked: boolean
    createdMs?: number
    pageVersion?: number
    blob?: string
    outcome?: ReplyOutcome
    status?: number
    bodyBytes?: number
    visibility?: string
    detail?: 'transport' | 'body-not-stored' | 'body-too-large'
    error?: string
    /** Why an `unreadable` record cannot be read. */
    problem?: string
    /** Additive field of a later stage: the native side told the person already. Absent means the turn may be retried. */
    announced?: boolean
}

export interface RemoveOutcome {
    result: 'removed' | 'absent'
    flushed: boolean
}

export type ReplyInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

export interface NativeReplyStore {
    /** Every record. A visible-page call: the answer is an array that can carry blobs. */
    list(): Promise<ReplyListing[]>
    /** The whole body of a finished reply as text, read in pieces and decoded once. */
    readBody(key: string): Promise<string>
    consume(key: string): Promise<RemoveOutcome>
    discard(key: string): Promise<RemoveOutcome>
    park(key: string): Promise<void>
}

/**
 * Reads a body through `readPiece`, which answers one base64 reply (a piece of at most `TEXT_RANGE_MAX_BYTES` and the
 * range trailer) for an offset. The pieces are joined as bytes and decoded once, so a character cut by a piece
 * boundary is whole.
 */
export async function readReplyBody(
    readPiece: (offset: number, len: number) => Promise<string>,
    key: string,
): Promise<string> {
    const pieces: Uint8Array[] = []
    let offset = 0
    let total = -1
    let identity = ''
    while (total < 0 || offset < total) {
        const reply = await readPiece(offset, TEXT_RANGE_MAX_BYTES)
        if (typeof reply !== 'string') {
            throw new Error(`the body read of reply ${key} answered something other than a string`)
        }
        const piece = splitRangeReply(base64ToBytes(reply), `reply ${key}`)
        if (total < 0) {
            total = piece.total
            identity = piece.identity
        } else if (piece.identity !== identity) {
            throw new Error(`the body of reply ${key} changed while it was read`)
        }
        if (piece.bytes.length === 0) {
            if (offset < total) {
                throw new Error(`the body read of reply ${key} stopped at ${offset} of ${total} bytes`)
            }
            break
        }
        pieces.push(piece.bytes)
        offset += piece.bytes.length
    }
    const joined = new Uint8Array(pieces.reduce((sum, piece) => sum + piece.length, 0))
    let at = 0
    for (const piece of pieces) {
        joined.set(piece, at)
        at += piece.length
    }
    return new TextDecoder().decode(joined)
}

export function createReplyStore(invoke: ReplyInvoke = tauriInvoke as ReplyInvoke): NativeReplyStore {
    return {
        list: () => invoke<ReplyListing[]>('native_reply_list'),
        readBody: (key) => readReplyBody((offset, len) => invoke<string>('native_reply_read_body', { key, offset, len }), key),
        consume: (key) => invoke<RemoveOutcome>('native_reply_consume', { key }),
        discard: (key) => invoke<RemoveOutcome>('native_reply_discard', { key }),
        park: (key) => invoke<void>('native_reply_park', { key }),
    }
}
