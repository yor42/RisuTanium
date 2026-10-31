import { v4 } from "uuid";
import type { Chat, ChatAlt, ChatAltMemory, Message } from "../storage/database.svelte";
import type { SerializableHypaV2Data } from "./memory/hypav2";
import type { SerializableHypaV3Data } from "./memory/hypav3";

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
 * The chat id of the record the end control arrives at: among the records that follow the last path
 * message (the root for an empty path) the one with the highest stamp, the last in list order among
 * equals. Null when no record follows it and for a chat whose `alt` cannot be read.
 */
export function endTarget(chat: Chat): string | null {
    const path = chat.message;
    const alt = chat.alt;
    if (!isChatAltReadable(chat) || !Array.isArray(path) || alt === undefined) {
        return null;
    }
    const index = indexTree(path, alt);
    const owner = ownerBefore(path, index, path.length);
    let best = -1;
    for (const k of (owner === null ? [] : index.children.get(owner) ?? [])) {
        if (best === -1 || alt[k].a >= alt[best].a) {
            best = k;
        }
    }
    return best === -1 ? null : alt[best].m.chatId ?? null;
}

type BranchFields = Pick<Chat, "supaMemoryData" | "supaMemoryCoveredId" | "lastMemory" | "scriptstate" | "hypaV2Data" | "hypaV3Data">;

export interface BranchStateResult {
    /** What the chat holds afterwards; `null` removes the field. */
    next: ChatAltMemory;
    /** What the departing chain keeps: all six fields, a copy of the live values, an absent one as `null`. */
    park: ChatAltMemory;
}

/** A deep copy that reads through reactive proxies and keeps own keys such as `__proto__` as data. */
function deepCopy<T>(value: T): T;
function deepCopy(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((item: unknown) => deepCopy(item));
    }
    if (isObjectValue(value)) {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deepCopy(item)]));
    }
    return value;
}

function sameValue(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

function pickBranchFields(chat: BranchFields): BranchFields {
    return {
        supaMemoryData: chat.supaMemoryData,
        supaMemoryCoveredId: chat.supaMemoryCoveredId,
        lastMemory: chat.lastMemory,
        scriptstate: chat.scriptstate,
        hypaV2Data: chat.hypaV2Data,
        hypaV3Data: chat.hypaV3Data,
    };
}

/**
 * Whether `supaMemory` can resume from `data` on a path whose messages carry exactly the chat ids
 * `pathIds`: false for the data that would end in "the saved resume point ... cannot be found" (plain)
 * or "hypaMemory: chat ID not found" (legacy `hypa:`). Data the resolver ignores or reports
 * differently (empty, too short, not parseable, not a list) is left alone and counts as resumable.
 * The seams of this section live here, not beside the memory code, so that the tree module stays
 * free of the memory modules' imports.
 */
export function supaResumeResolvable(data: string | undefined, pathIds: ReadonlySet<string>): boolean {
    if (!data || data.length <= 4) {
        return true;
    }
    const newline = data.indexOf("\n");
    const id = newline === -1 ? data : data.slice(0, newline);
    if (!id.startsWith("hypa:")) {
        return pathIds.has(id);
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(data.slice(newline + 1).trim());
    } catch {
        return true;
    }
    if (!Array.isArray(parsed)) {
        return true;
    }
    return parsed.some((entry: unknown) => isObjectValue(entry) && typeof entry.id === "string" && pathIds.has(entry.id));
}

/**
 * HypaV2 data without the summaries that name a chat id of `ids`, their retrieval chunks, and
 * `lastMainChunkID` as the send-time cleanup recomputes it. Returns `data` itself when nothing is
 * removed. Ignores `preserveOrphanedMemory`: summaries of a departed branch are parked, not orphaned.
 */
export function hypaV2WithoutMemos(data: SerializableHypaV2Data, ids: ReadonlySet<string>): SerializableHypaV2Data {
    if (!Array.isArray(data.mainChunks) || !Array.isArray(data.chunks)) {
        return data;
    }
    const mainChunks = data.mainChunks.filter((mainChunk) => {
        return !(Array.isArray(mainChunk.chatMemos) && mainChunk.chatMemos.some((memo) => ids.has(memo)));
    });
    if (mainChunks.length === data.mainChunks.length) {
        return data;
    }
    const keptIds = new Set(mainChunks.map((mainChunk) => mainChunk.id));
    return {
        ...data,
        mainChunks,
        chunks: data.chunks.filter((chunk) => keptIds.has(chunk.mainChunkID)),
        lastMainChunkID: mainChunks.length > 0 ? mainChunks[mainChunks.length - 1].id : 0,
    };
}

/**
 * HypaV3 data without the summaries that name a chat id of `ids`; categories, metrics and modal
 * settings stay. Returns `data` itself when nothing is removed. Ignores `preserveOrphanedMemory`.
 */
export function hypaV3WithoutMemos(data: SerializableHypaV3Data, ids: ReadonlySet<string>): SerializableHypaV3Data {
    if (!Array.isArray(data.summaries)) {
        return data;
    }
    const summaries = data.summaries.filter((summary) => {
        return !(Array.isArray(summary.chatMemos) && summary.chatMemos.some((memo) => ids.has(memo)));
    });
    return summaries.length === data.summaries.length ? data : { ...data, summaries };
}

function parkedText(mem: ChatAltMemory | undefined, key: "supaMemoryData" | "supaMemoryCoveredId" | "lastMemory"): string | null | undefined {
    const value: unknown = mem?.[key];
    if (typeof value === "string") {
        return value;
    }
    return value === null ? null : undefined;
}

function parkedObject<K extends "scriptstate" | "hypaV2Data" | "hypaV3Data">(mem: ChatAltMemory | undefined, key: K): ChatAltMemory[K] {
    const value: unknown = mem?.[key];
    return (value === null || isObjectValue(value) ? value : undefined) as ChatAltMemory[K];
}

/**
 * The state a chat holds after a switch, and the state the departing chain keeps. `departing` is the
 * set of chat ids of the departing chain, `arrivingPathIds` those of the path afterwards, `parked` the
 * state the arriving chain left behind (a field it lacks is carried instead of restored).
 *
 * Every departure parks all six fields as copies of the live values, an absent value as `null`, so no
 * parked branch shares a value with the live chat and a later change of the live store cannot alter
 * what a branch left. For data this module produces every head's `mem` carries all six keys, and only
 * run heads carry `mem`. A record without `mem`, or without a key (a never-shown sibling such as a
 * prereroll candidate, or an imported record), carries the live value as a copy instead: the pair
 * only while `supaResumeResolvable` holds on the new path (otherwise both fields go), `lastMemory`
 * unless it names a departing message, `scriptstate` as it is when `keepLiveScriptState` and removed
 * otherwise, the summary stores minus what names a departing message. A restored pair that does not
 * resolve on the new path is dropped too, so a later send never meets the "reset SupaMemory data"
 * error. `next` and `park` share no object with each other, with `live` or with `parked`.
 */
export function branchState(
    live: BranchFields,
    departing: ReadonlySet<string>,
    arrivingPathIds: ReadonlySet<string>,
    parked: ChatAltMemory | undefined,
    keepLiveScriptState: boolean,
): BranchStateResult {
    const mine = deepCopy(pickBranchFields(live));
    const work = deepCopy(pickBranchFields(live));
    const park: ChatAltMemory = {
        supaMemoryData: mine.supaMemoryData ?? null,
        supaMemoryCoveredId: mine.supaMemoryCoveredId ?? null,
        lastMemory: mine.lastMemory ?? null,
        scriptstate: mine.scriptstate ?? null,
        hypaV2Data: mine.hypaV2Data ?? null,
        hypaV3Data: mine.hypaV3Data ?? null,
    };

    const parkedData = parkedText(parked, "supaMemoryData");
    let data = parkedData !== undefined ? parkedData : work.supaMemoryData ?? null;
    let covered = parkedData !== undefined ? parkedText(parked, "supaMemoryCoveredId") ?? null : work.supaMemoryCoveredId ?? null;
    if (data !== null && !supaResumeResolvable(data, arrivingPathIds)) {
        data = null;
        covered = null;
    }

    const parkedLast = parkedText(parked, "lastMemory");
    const liveLast = work.lastMemory ?? null;
    const lastMemory = parkedLast !== undefined ? parkedLast : (liveLast !== null && departing.has(liveLast) ? null : liveLast);

    const parkedScript = parkedObject(parked, "scriptstate");
    const scriptstate = parkedScript !== undefined ? deepCopy(parkedScript) : (keepLiveScriptState ? work.scriptstate ?? null : null);

    const parkedV2 = parkedObject(parked, "hypaV2Data");
    const hypaV2Data = parkedV2 !== undefined ? deepCopy(parkedV2) : (work.hypaV2Data === undefined ? null : hypaV2WithoutMemos(work.hypaV2Data, departing));

    const parkedV3 = parkedObject(parked, "hypaV3Data");
    const hypaV3Data = parkedV3 !== undefined ? deepCopy(parkedV3) : (work.hypaV3Data === undefined ? null : hypaV3WithoutMemos(work.hypaV3Data, departing));

    return {
        next: { supaMemoryData: data, supaMemoryCoveredId: covered, lastMemory, scriptstate, hypaV2Data, hypaV3Data },
        park,
    };
}

function setBranchField<K extends keyof BranchFields>(chat: Chat, key: K, value: Chat[K] | null): void {
    if (value === null || value === undefined) {
        if (chat[key] !== undefined) {
            Reflect.deleteProperty(chat, key);
        }
        return;
    }
    if (!sameValue(chat[key], value)) {
        chat[key] = value;
    }
}

/**
 * Parks and restores the state of a branch around a switch. `departed` are the records now holding the
 * departed chain (the first one gets the parked state), `arrivedHead` the record the arriving chain's
 * first message came from, null when nothing arrives. Only that head's `mem` is restored, then deleted.
 * An arrival without departing messages (the end press) replaces all six live fields with the head's
 * copy and discards the live values: no message holds them. The suggestions never follow a branch.
 */
function carryBranchState(chat: Chat, departed: readonly ChatAlt[], arrivedHead: ChatAlt | null, keepLiveScriptState: boolean): void {
    const departing = new Set<string>();
    for (const record of departed) {
        if (record.m.chatId) {
            departing.add(record.m.chatId);
        }
    }
    const pathIds = new Set<string>();
    for (const message of chat.message) {
        if (message.chatId) {
            pathIds.add(message.chatId);
        }
    }
    const mem: unknown = arrivedHead?.mem;
    const parked = isObjectValue(mem) ? (mem as ChatAltMemory) : undefined;
    const { next, park } = branchState(chat, departing, pathIds, parked, keepLiveScriptState);
    if (departed.length > 0 && chat.alt !== undefined) {
        chat.alt[chat.alt.length - departed.length].mem = park;
    }
    if (arrivedHead !== null) {
        delete arrivedHead.mem;
    }
    setBranchField(chat, "supaMemoryData", next.supaMemoryData ?? null);
    setBranchField(chat, "supaMemoryCoveredId", next.supaMemoryCoveredId ?? null);
    setBranchField(chat, "lastMemory", next.lastMemory ?? null);
    setBranchField(chat, "scriptstate", next.scriptstate ?? null);
    setBranchField(chat, "hypaV2Data", next.hypaV2Data ?? null);
    setBranchField(chat, "hypaV3Data", next.hypaV3Data ?? null);
    if (chat.suggestMessages !== undefined) {
        delete chat.suggestMessages;
    }
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
    carryBranchState(chat, records, null, true);
    return true;
}

/**
 * Makes the sibling `headId` of position `i` the message there. The departing tail `message[i..]`
 * becomes records (as `detachTail` does); the arriving chain is the record with that head and, at each
 * step, the child with the same stamp `a` (the last in list order among equals), so it is the run that
 * departed together and the chat ends as the user left it. Newer side children stay in `alt`. Any child
 * of the last message is accepted at `message.length`; the end control passes `endTarget`. Returns
 * whether anything changed: false when `headId` is already on the path at `i`, is no sibling of
 * position `i`, or the chat's `alt` cannot be read.
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
            if (!seen.has(k) && alt[k].a === alt[cursor].a && (next === -1 || alt[k].a >= alt[next].a)) {
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
    carryBranchState(chat, departed, arriving[0], false);
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
