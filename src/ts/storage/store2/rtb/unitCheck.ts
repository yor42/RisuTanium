import { checkUnit, bodyCountMismatch } from '../codec/assemble'
import {
    ASSET_REF_V, FRAME_FMT, FRAME_OVERHEAD, IL_REF_V, KNOWN_REQ, UNIT_TYPE, decodeFrame, isKnownUnitType, keyOfRef, keyOfTail, refOfFrame,
    type AssetList, type ChatAltUnit, type ChatChunk, type InlayList, type Ref, type UnitBody, type UnitType,
} from '../format'

/**
 * What the full check of one framed unit of a `.rtb` closure came to. It is the codec's own unit check
 * (`checkUnit`: frame, length and checksum against the Ref, then the body parser) plus the two things that check folds
 * away or leaves to its caller:
 *   stale-list  a derived list (asset or inlay) below this build's version. `checkUnit` reports it `ok`; the export and the
 *               restore both need to know that its contents cannot be trusted, so it is its own outcome.
 *   a counted unit (a chat chunk, an alternatives unit) whose body holds another number of items than its Ref says is damaged.
 * `newer-list` is a derived list above this build's version: readable tree data that travels verbatim and is never trusted.
 * The function is pure, so export and restore judge a unit the same way.
 */
export type FramedUnitCheck =
    | { status: 'ok', body: UnitBody }
    | { status: 'stale-list', body: UnitBody, reason: string }
    | { status: 'newer-list', reason: string }
    | { status: 'missing' }
    | { status: 'damaged', reason: string }
    | { status: 'too-new', reason: string }

/** `bytes` is the stored frame of the unit `ref` names, or undefined when the store has none. */
export function checkFramedUnit(ref: Ref, type: UnitType, bytes: Uint8Array | null | undefined): FramedUnitCheck {
    const key = keyOfRef(ref)
    const checked = checkUnit({ get: asked => asked === key ? bytes ?? undefined : undefined }, ref, type)
    switch (checked.status) {
        case 'missing':
            return { status: 'missing' }
        case 'damaged':
            return { status: 'damaged', reason: checked.reason }
        case 'too-new':
            return { status: 'too-new', reason: checked.reason }
        case 'newer-list':
            return { status: 'newer-list', reason: checked.reason }
        case 'ok': {
            if (bodyCountMismatch(type, checked.body, ref)) {
                return { status: 'damaged', reason: `The unit holds a different number of items than its Ref says (${ref[3]}).` }
            }
            const stale = staleListReason(type, checked.body)
            return stale === null ? { status: 'ok', body: checked.body } : { status: 'stale-list', body: checked.body, reason: stale }
        }
    }
}

/**
 * How the restore's validation judges one unit of a file. It is `checkFramedUnit` with the answers a restore needs:
 *   unreadable-list  a derived list below or above this build's version: the file is accepted and the list travels as it is
 *                    (its owner's references are found some other way), so it is neither damage nor a newer format.
 *   newer            a frame, a body or a module index of a format this build does not know: the file is made by a newer version.
 */
export type RtbUnitClass =
    | { status: 'ok', body: UnitBody }
    | { status: 'unreadable-list', reason: string }
    | { status: 'newer', reason: string }
    | { status: 'damaged', reason: string }
    | { status: 'missing' }

export function classifyRtbUnit(ref: Ref, type: UnitType, bytes: Uint8Array | null | undefined): RtbUnitClass {
    const checked = checkFramedUnit(ref, type, bytes)
    switch (checked.status) {
        case 'stale-list':
        case 'newer-list':
            return { status: 'unreadable-list', reason: checked.reason }
        case 'too-new':
            return { status: 'newer', reason: checked.reason }
        case 'ok':
        case 'missing':
        case 'damaged':
            return checked
    }
}

/**
 * A unit judged without a parent: `items` is the number of messages of a chat chunk (type 8) or of records of an
 * alternatives unit (type 25), and null for every other type.
 */
export interface RtbUnitAlone {
    cls: RtbUnitClass
    items: number | null
}

/**
 * The restore's unit pass judges each unit of a file before it knows its parent. The unit is checked against its own
 * Ref (its framed length and checksum), with the frame's type byte as the authority, so the frame, the body parser and
 * the derived-list versions are judged as `classifyRtbUnit` judges them. The count a parent's Ref states for a chunk or an
 * alternatives unit is not known here, so `bodyCountMismatch` is never applied; the closure walk compares `items` with
 * the Ref's count where a parent names the unit.
 */
export function classifyRtbUnitAlone(tail: string, frameType: number, frame: Uint8Array): RtbUnitAlone {
    // A damaged header has no trustworthy type byte, so damage is decided before the type is judged.
    const decoded = decodeFrame(frame)
    if (decoded.status === 'damaged') {
        return { cls: { status: 'damaged', reason: decoded.reason }, items: null }
    }
    if (!isKnownUnitType(frameType)) {
        return { cls: { status: 'newer', reason: `Unit type ${frameType} is unknown to this build.` }, items: null }
    }
    if (frame.length < FRAME_OVERHEAD) {
        return { cls: { status: 'damaged', reason: 'The frame is shorter than a frame header.' }, items: null }
    }
    const key = keyOfTail(tail)
    const checked = checkUnit({ get: asked => asked === key ? frame : undefined }, refOfFrame(key, frame), frameType)
    switch (checked.status) {
        case 'missing':
            return { cls: { status: 'missing' }, items: null }
        case 'damaged':
            return { cls: { status: 'damaged', reason: checked.reason }, items: null }
        case 'too-new':
            return { cls: { status: 'newer', reason: checked.reason }, items: null }
        case 'newer-list':
            return { cls: { status: 'unreadable-list', reason: checked.reason }, items: null }
        case 'ok': {
            const stale = staleListReason(frameType, checked.body)
            if (stale !== null) {
                return { cls: { status: 'unreadable-list', reason: stale }, items: null }
            }
            const items = frameType === UNIT_TYPE.chatChunk
                ? (checked.body as ChatChunk).msgs.length
                : frameType === UNIT_TYPE.chatAlt ? (checked.body as ChatAltUnit).recs.length : null
            return { cls: { status: 'ok', body: checked.body }, items }
        }
    }
}

/**
 * What the manifest frame's `req` came to. A token this build does not know makes the file newer, and the refusal names the
 * token; `readUnit` alone only reports that the manifest is too new. `newer` without a token is a manifest `fmt` (or a frame
 * format) above this build's, which is judged before `req`, as the manifest parser judges it.
 */
export type RtbReqCheck =
    | { status: 'ok', req: string[] }
    | { status: 'newer', reason: string, token?: string }
    | { status: 'damaged', reason: string }

export function checkRtbManifestReq(bytes: Uint8Array): RtbReqCheck {
    const frame = decodeFrame(bytes)
    if (frame.status === 'too-new') {
        return { status: 'newer', reason: frame.reason }
    }
    if (frame.status === 'damaged') {
        return { status: 'damaged', reason: frame.reason }
    }
    if (frame.type !== UNIT_TYPE.manifest) {
        return { status: 'damaged', reason: `The unit has type ${frame.type}, not ${UNIT_TYPE.manifest}.` }
    }
    let raw: unknown
    try {
        raw = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(frame.payload))
    } catch {
        return { status: 'damaged', reason: 'The payload is not UTF-8 JSON.' }
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return { status: 'damaged', reason: 'The manifest is not an object.' }
    }
    const fields = raw as Record<string, unknown>
    const fmt = fields.fmt
    if (typeof fmt !== 'number' || !Number.isSafeInteger(fmt) || fmt < 1) {
        return { status: 'damaged', reason: 'The manifest fmt is not a whole number of at least 1.' }
    }
    if (fmt > FRAME_FMT) {
        return { status: 'newer', reason: `Format ${fmt} is newer than this build.` }
    }
    const listed: unknown = fields.req
    if (!Array.isArray(listed)) {
        return { status: 'damaged', reason: 'The manifest req is not a list.' }
    }
    const req: string[] = []
    for (const token of listed as unknown[]) {
        if (typeof token !== 'string') {
            return { status: 'damaged', reason: 'The manifest req holds a token that is not a string.' }
        }
        req.push(token)
    }
    const unknownToken = req.find(token => !KNOWN_REQ.has(token))
    if (unknownToken !== undefined) {
        return { status: 'newer', token: unknownToken, reason: `The required feature "${unknownToken}" is unknown to this build.` }
    }
    return { status: 'ok', req }
}

function staleListReason(type: UnitType, body: UnitBody): string | null {
    if (type === UNIT_TYPE.assetList && (body as AssetList).v < ASSET_REF_V) {
        return `Asset list version ${(body as AssetList).v} is below ${ASSET_REF_V}.`
    }
    if (type === UNIT_TYPE.inlayList && (body as InlayList).v < IL_REF_V) {
        return `Inlay list version ${(body as InlayList).v} is below ${IL_REF_V}.`
    }
    return null
}
