import { v4 } from "uuid";
import type { Chat, ChatAlt, Message } from "../storage/database.svelte";

/**
 * A chat is a tree of messages. The active path is `chat.message`; every other
 * message sits in `chat.alt` as a record `{m, p, a}`: `m` the message, `p` the
 * `chatId` of the message it follows (null: it is a first message), `a` the
 * departure stamp. A record may carry further keys; they travel untouched.
 *
 * Invariants:
 * - `alt` stays in ascending `a`. A departure appends its records as one run
 *   with the stamp `max(a) + 1`; an arrival removes its records where they are.
 * - No operation here rewrites the `time` of a message or deletes a record.
 * - `chatId` is unique within a chat. When it is not, a `p` resolves to the
 *   first message on the path that holds it, otherwise to the first record in
 *   list order that holds it. A `p` that resolves to nothing is read as the
 *   root, and is not rewritten by a read.
 * - A chat whose `alt` is not a list of well-formed records is never
 *   interpreted: every operation here leaves it and its path unchanged.
 */

type PathMessage = Pick<Message, "chatId">;

function isObjectValue(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecordShape(value: unknown): value is ChatAlt {
    if (!isObjectValue(value)) {
        return false;
    }
    return isObjectValue(value.m)
        && (value.p === null || typeof value.p === "string")
        && typeof value.a === "number"
        && Number.isFinite(value.a);
}

/** Whether the chat's `alt` is absent or a list of well-formed records. */
export function isChatAltReadable(chat: Chat): boolean {
    const alt: unknown = chat.alt;
    return alt === undefined || (Array.isArray(alt) && alt.every(isRecordShape));
}

/**
 * The refusal every tree entry applies before it acts: true after calling
 * `notify` when the chat's `alt` cannot be read, in which case the caller
 * changes nothing and starts nothing.
 */
export function refuseUnreadableAlt(chat: Chat, notify: () => void): boolean {
    if (isChatAltReadable(chat)) {
        return false;
    }
    notify();
    return true;
}

/** Gives every path message without a `chatId` a fresh one; returns how many it stamped. */
export function stampMissingIds(chat: Chat): number {
    let stamped = 0;
    for (const message of chat.message) {
        if (!message.chatId) {
            message.chatId = v4();
            stamped++;
        }
    }
    return stamped;
}

/** Deletes the chat's alternatives; for a writer that emptied a non-empty path. */
export function clearAltOnFullClear(chat: Chat): void {
    if (chat.alt !== undefined) {
        delete chat.alt;
    }
}

const ROOT = "R";

interface TreeIndex {
    pathFirst: Map<string, number>;
    altFirst: Map<string, number>;
    /** Owner key (ROOT, `P<path index>`, `A<alt index>`) to the alt indexes that follow it, in list order. */
    children: Map<string, number[]>;
}

function indexTree(path: readonly Message[], alt: readonly ChatAlt[]): TreeIndex {
    const pathFirst = new Map<string, number>();
    for (let k = 0; k < path.length; k++) {
        const id = path[k].chatId;
        if (id && !pathFirst.has(id)) {
            pathFirst.set(id, k);
        }
    }
    const altFirst = new Map<string, number>();
    for (let k = 0; k < alt.length; k++) {
        const id = alt[k].m.chatId;
        if (id && !altFirst.has(id)) {
            altFirst.set(id, k);
        }
    }
    const children = new Map<string, number[]>();
    for (let k = 0; k < alt.length; k++) {
        const p = alt[k].p;
        let owner = ROOT;
        if (p !== null) {
            const onPath = pathFirst.get(p);
            const inAlt = altFirst.get(p);
            owner = onPath !== undefined ? `P${onPath}` : inAlt !== undefined ? `A${inAlt}` : ROOT;
        }
        const kids = children.get(owner);
        if (kids) {
            kids.push(k);
        } else {
            children.set(owner, [k]);
        }
    }
    return { pathFirst, altFirst, children };
}

/** The owner key of the children of the message that precedes position `i`, or null when no record can follow it. */
function ownerBefore(path: readonly Message[], index: TreeIndex, i: number): string | null {
    if (i === 0) {
        return ROOT;
    }
    const id = path[i - 1].chatId;
    return id && index.pathFirst.get(id) === i - 1 ? `P${i - 1}` : null;
}

function byDisplayOrder(a: Message, b: Message): number {
    const timeA = a.time ?? 0;
    const timeB = b.time ?? 0;
    if (timeA !== timeB) {
        return timeA - timeB;
    }
    const idA = a.chatId ?? "";
    const idB = b.chatId ?? "";
    return idA < idB ? -1 : idA > idB ? 1 : 0;
}

function nextStamp(alt: readonly ChatAlt[]): number {
    let highest = 0;
    for (const record of alt) {
        if (record.a > highest) {
            highest = record.a;
        }
    }
    return highest + 1;
}

/**
 * The messages that can stand at position `i`: the one on the path (when there is one) and the head of
 * every record that follows the message before it, in display order (ascending `time`, a missing time
 * is 0, ties by `chatId`). Position `message.length` holds only the children of the last message. A
 * chat whose `alt` cannot be read has no siblings.
 */
export function siblingsAt(chat: Chat, i: number): Message[] {
    const path = chat.message;
    if (!Array.isArray(path) || !Number.isInteger(i) || i < 0 || i > path.length) {
        return [];
    }
    const heads: Message[] = [];
    if (i < path.length) {
        heads.push(path[i]);
    }
    if (chat.alt !== undefined && isChatAltReadable(chat)) {
        const index = indexTree(path, chat.alt);
        const owner = ownerBefore(path, index, i);
        for (const k of (owner === null ? [] : index.children.get(owner) ?? [])) {
            heads.push(chat.alt[k].m);
        }
    }
    return heads.sort(byDisplayOrder);
}

/**
 * Where the state of a branch (memory, script state) is parked and restored. `departedHead` is the
 * record that now holds the departed chain's first message and `arrivedHead` the record the arriving
 * chain's first message came from, each null when that side was empty.
 */
function carryBranchState(_chat: Chat, _departedHead: ChatAlt | null, _arrivedHead: ChatAlt | null): void {
}

function departRecords(chat: Chat, tail: readonly Message[], parentId: string | null): ChatAlt[] {
    chat.alt ??= [];
    const alt = chat.alt;
    const stamp = nextStamp(alt);
    const records = tail.map((m, k): ChatAlt => ({
        m,
        p: k === 0 ? parentId : tail[k - 1].chatId ?? null,
        a: stamp,
    }));
    alt.push(...records);
    return records;
}

/**
 * Cuts `message[i..]` off the path into records, the first one following `message[i - 1]` (or the root)
 * and each later one following the message before it, all with one new stamp appended to `alt`. Messages
 * without an id get one first. Returns whether anything moved: false for a position at or past the end
 * and for a chat whose `alt` cannot be read.
 */
export function detachTail(chat: Chat, i: number): boolean {
    const path = chat.message;
    if (!isChatAltReadable(chat) || !Array.isArray(path) || !Number.isInteger(i) || i < 0 || i >= path.length) {
        return false;
    }
    stampMissingIds(chat);
    const tail = path.slice(i);
    path.splice(i);
    const records = departRecords(chat, tail, i === 0 ? null : path[i - 1].chatId ?? null);
    carryBranchState(chat, records[0], null);
    return true;
}

/**
 * Makes the sibling `headId` of position `i` the message there. The departing tail `message[i..]`
 * becomes records (as `detachTail` does); the arriving chain is the record with that head and, at each
 * step, its newest child (highest `a`, the last in list order among equals). Returns whether anything
 * changed: false when `headId` is already on the path at `i`, is no sibling of position `i`, or the
 * chat's `alt` cannot be read.
 */
export function switchTo(chat: Chat, i: number, headId: string): boolean {
    const path = chat.message;
    if (!isChatAltReadable(chat) || !Array.isArray(path) || !Number.isInteger(i) || i < 0 || i > path.length) {
        return false;
    }
    if (i < path.length && path[i].chatId === headId) {
        return false;
    }
    const alt = chat.alt;
    if (alt === undefined) {
        return false;
    }
    const index = indexTree(path, alt);
    const owner = ownerBefore(path, index, i);
    const target = owner === null ? undefined : (index.children.get(owner) ?? []).find((k) => alt[k].m.chatId === headId);
    if (target === undefined) {
        return false;
    }
    const arrivingAt = [target];
    const seen = new Set(arrivingAt);
    for (let cursor = target; ;) {
        let next = -1;
        for (const k of index.children.get(`A${cursor}`) ?? []) {
            if (!seen.has(k) && (next === -1 || alt[k].a >= alt[next].a)) {
                next = k;
            }
        }
        if (next === -1) {
            break;
        }
        arrivingAt.push(next);
        seen.add(next);
        cursor = next;
    }
    const arriving = arrivingAt.map((k) => alt[k]);
    stampMissingIds(chat);
    const tail = path.slice(i);
    path.splice(i);
    const parentId = i === 0 ? null : path[i - 1].chatId ?? null;
    for (const k of [...arrivingAt].sort((a, b) => b - a)) {
        alt.splice(k, 1);
    }
    const departed = tail.length === 0 ? [] : departRecords(chat, tail, parentId);
    path.push(...arriving.map((record) => record.m));
    carryBranchState(chat, departed[0] ?? null, arriving[0]);
    return true;
}

/**
 * After a writer changed `chat.message`, moves every record whose parent left the path to the nearest
 * earlier message of `previousPath` that is still on the path, or to the root when none is. A record
 * whose parent is an alternative, still on the path, or unknown to `previousPath` stays as it is.
 * Returns whether any record moved; a chat whose `alt` cannot be read is left alone.
 */
export function reattachOrphans(chat: Chat, previousPath: readonly PathMessage[]): boolean {
    if (!isChatAltReadable(chat) || chat.alt === undefined || chat.alt.length === 0 || !Array.isArray(chat.message)) {
        return false;
    }
    const alt = chat.alt;
    const index = indexTree(chat.message, alt);
    const previousAt = new Map<string, number>();
    for (let k = 0; k < previousPath.length; k++) {
        const id = previousPath[k]?.chatId;
        if (id && !previousAt.has(id)) {
            previousAt.set(id, k);
        }
    }
    let moved = false;
    for (const record of alt) {
        const p = record.p;
        if (p === null || index.pathFirst.has(p) || index.altFirst.has(p)) {
            continue;
        }
        const at = previousAt.get(p);
        if (at === undefined) {
            continue;
        }
        let survivor: string | null = null;
        for (let k = at - 1; k >= 0; k--) {
            const id = previousPath[k]?.chatId;
            if (id && index.pathFirst.has(id)) {
                survivor = id;
                break;
            }
        }
        record.p = survivor;
        moved = true;
    }
    return moved;
}
