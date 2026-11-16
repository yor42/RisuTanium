// The pure builders of the greeting list steps that reorder or exchange first messages: move, swap with the
// default first message, and append-many. Each returns one step whose ops are ordinary ops (no new op kind), plus
// the `chatFm` op that keeps the context chat showing the same text. The service calls them through
// `applyStudioWrite`; nothing here writes or marks.

import { firstMessageIndexOf } from '../../process/firstMessage'
import type { LiveReader, Op, WriteOp } from '../history/historyModel'
import { chatFmFollow, staleFmPin, type EditBuildResult, type LiveTarget } from './studioSetters'

// The effective index the context chat shows after a move of one entry from `from` to `to` (`to` in the coordinates
// of the list after the removal). The default first message (-1) never follows a move.
export function fmAfterMove(e: number, from: number, to: number): number {
    if (e === -1) {
        return -1
    }
    if (e === from) {
        return to
    }
    if (from < e && e <= to) {
        return e - 1
    }
    if (to <= e && e < from) {
        return e + 1
    }
    return e
}

// A swap exchanges the default first message with entry `i`: the chat on either one follows its text.
export function fmAfterSwap(e: number, i: number): number {
    if (e === -1) {
        return i
    }
    return e === i ? -1 : e
}

function isIndex(value: number, length: number): boolean {
    return Number.isInteger(value) && value >= 0 && value < length
}

// Adds the follow-up of the context chat when its effective index changes: `chatFm`, its write, and the page write.
function withChatFollow(target: LiveTarget, ops: Op[], writes: WriteOp[], next: (effective: number) => number): number | null {
    const context = target.character.chats?.[target.character.chatPage]
    if (!context) {
        return null
    }
    const effective = firstMessageIndexOf(target.character, context)
    const after = next(effective)
    if (after === effective) {
        return null
    }
    const follow = chatFmFollow(target, after)
    if (!follow) {
        return null
    }
    ops.push(follow.op)
    if (follow.write) {
        writes.push(follow.write)
    }
    return follow.pageFm
}

// One entry moves from `from` to `to`. The remove carries no deleted item (a move consumes and creates none), and the
// insert index is in post-removal coordinates.
export function buildGreetingMove(from: number, to: number, target: LiveTarget, live: LiveReader): EditBuildResult {
    const list = live.greetings()
    if (list === null || !isIndex(from, list.length) || !isIndex(to, list.length)) {
        return { ok: false, reason: 'precondition' }
    }
    if (from === to) {
        return { ok: false, reason: 'unchanged' }
    }
    const value = list[from]
    const ops: Op[] = [
        { op: 'listRemove', index: from, value, deletedId: null },
        { op: 'listInsert', index: to, value },
    ]
    const writes: WriteOp[] = [
        { op: 'listRemove', index: from },
        { op: 'listInsert', index: to, value },
    ]
    const pageFm = withChatFollow(target, ops, writes, (effective) => fmAfterMove(effective, from, to))
    return { ok: true, label: { kind: 'greetingMove' }, ops, writes, coalesceKey: null, pageFm }
}

// Entry `index` and the default first message exchange texts. The `set` is emitted directly, so a missing or
// non-string `firstMessage` is refused here.
export function buildGreetingSwap(index: number, target: LiveTarget, live: LiveReader): EditBuildResult {
    const list = live.greetings()
    const main = live.field('firstMessage')
    if (list === null || !isIndex(index, list.length) || !main.had || typeof main.value !== 'string') {
        return { ok: false, reason: 'precondition' }
    }
    const entry = list[index]
    if (typeof entry !== 'string') {
        return { ok: false, reason: 'precondition' }
    }
    if (entry === main.value) {
        return { ok: false, reason: 'unchanged' }
    }
    const ops: Op[] = [
        { op: 'set', path: 'firstMessage', before: main, after: { had: true, value: entry } },
        { op: 'listSet', index, before: entry, after: main.value },
    ]
    const writes: WriteOp[] = [
        { op: 'set', path: 'firstMessage', value: { had: true, value: entry } },
        { op: 'listSet', index, value: main.value },
    ]
    const pageFm = withChatFollow(target, ops, writes, (effective) => fmAfterSwap(effective, index))
    return { ok: true, label: { kind: 'greetingSwap' }, ops, writes, coalesceKey: null, pageFm }
}

// Appends only; an insert at an arbitrary index could move a chat's stored index onto another text. A chat whose
// stored index reads as the default but would name an appended entry is pinned to -1 in the same step.
export function buildGreetingAppendMany(values: readonly string[], target: LiveTarget, live: LiveReader): EditBuildResult {
    const list = live.greetings()
    if (list === null || values.length === 0 || !values.every((value) => typeof value === 'string')) {
        return { ok: false, reason: 'precondition' }
    }
    const ops: Op[] = values.map((value, k) => ({ op: 'listInsert', index: list.length + k, value }))
    const writes: WriteOp[] = values.map((value, k) => ({ op: 'listInsert', index: list.length + k, value }))
    const pin = staleFmPin(target, list.length)
    if (pin) {
        ops.push(pin.op)
        if (pin.write) {
            writes.push(pin.write)
        }
    }
    return {
        ok: true,
        label: { kind: 'greetingAddMany', count: values.length },
        ops,
        writes,
        coalesceKey: null,
        pageFm: pin?.pageFm ?? null,
    }
}
