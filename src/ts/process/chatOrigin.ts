import { v4 as uuidv4 } from "uuid"
import { get } from "svelte/store"
import { DBState, selectedCharID } from "../stores.svelte"
import type { character, groupChat, Chat } from "../storage/database.svelte"
import { markCharacterForSave } from "../storage/characterSaveMarks"
import { bumpReplyVersion, isComposerWindowOpen, readReplyVersion } from "./generationOwnership.svelte"

/**
 * The origin API: an opaque, re-resolved-on-every-use address for a chat
 * (and, for a group, a member) inside the live database, plus the
 * synchronous read/write primitives built on it. This module imports the app
 * store (`stores.svelte.ts`) for live access to `DBState.db`, which is why
 * the pure id fill and duplicate-warning helpers live in the separate
 * `chatIds.ts` instead: storage, boot and backup code that only needs those
 * can use them without loading the rest of the app.
 */

/**
 * A write's address: which owner (a character, or a group by its own
 * `chaId`) holds the chat, which chat, and -- for a group -- which member's
 * trigger is running when that differs from the owner. Holds no index and no
 * object reference, because both go stale the moment the array they point
 * into is edited; every field here is an opaque id, re-resolved against the
 * live database on every use.
 */
export type Origin = {
    chaId: string
    chatId: string
    memberChaId?: string
}

/**
 * What an origin resolved to, for the duration of one synchronous callback.
 * Never persist any field of this past the callback that received it -- the
 * next edit to `characters` (an insert, a delete, a reorder, or a whole-slot
 * replacement) can move or invalidate every one of them.
 */
export interface OriginContext {
    owner: character | groupChat
    ownerIndex: number
    chat: Chat
    chatIndex: number
    member: character | null
    memberIndex: number | null
}

/**
 * Forms the origin of `chat` as held by `character`, straight from the ids
 * already on both objects. Pure: never touches the live database and never
 * mutates its arguments. Returns null and warns, naming `character`, when
 * either object has no id yet -- callers that may be handed an id-less
 * object should fill it first (see `beginWork`).
 */
export function originOf(character: character | groupChat, chat: Chat): Origin | null {
    if (!character.chaId) {
        console.warn(`originOf: character "${character.name}" has no chaId yet; cannot form an origin for it.`)
        return null
    }
    if (!chat.id) {
        console.warn(`originOf: a chat of character "${character.name}" has no id yet; cannot form an origin for it.`)
        return null
    }
    return { chaId: character.chaId, chatId: chat.id }
}

interface CharacterMatch {
    index: number
    character: character | groupChat
}

interface ChatMatch {
    index: number
    chat: Chat
}

/**
 * Whether a holder scan found exactly one live holder ("ok"), none ("gone",
 * `MC-075`), or more than one ("ambiguous", `MC-078`).
 */
export type OriginStatus = 'ok' | 'gone' | 'ambiguous'

interface CharacterLookup {
    status: OriginStatus
    match: CharacterMatch | null
}

interface ChatLookup {
    status: OriginStatus
    match: ChatMatch | null
}

/**
 * Scans `DBState.db.characters` for every holder of `chaId`, live, on every
 * call -- no cache, no memory of a past result. `status` is "gone" when
 * nothing holds it or its one holder is a cold-storage placeholder, and
 * "ambiguous" when more than one character holds it (warns in that case
 * only). A trashed character (`trashTime` set) still resolves "ok".
 */
function resolveCharacterByChaId(chaId: string): CharacterLookup {
    const characters = DBState.db?.characters
    if (!Array.isArray(characters)) {
        return { status: 'gone', match: null }
    }
    let match: CharacterMatch | null = null
    let holders = 0
    for (let i = 0; i < characters.length; i++) {
        const candidate = characters[i]
        if (candidate && candidate.chaId === chaId) {
            holders++
            match = { index: i, character: candidate }
        }
    }
    if (holders === 0) {
        return { status: 'gone', match: null }
    }
    if (holders > 1) {
        console.warn(
            `More than one character holds chaId "${chaId}". Skipping the write rather than guessing which `
            + `one is real -- this resolves on its own once the duplicate is gone.`
        )
        return { status: 'ambiguous', match: null }
    }
    if (match && match.character.coldstorage) {
        return { status: 'gone', match: null }
    }
    return { status: 'ok', match }
}

/**
 * Scans `owner.chats` for every holder of `chatId`, live, on every call.
 * Same gone/ambiguous rules as `resolveCharacterByChaId`, scoped to this one
 * owner's chats rather than the whole database.
 */
function resolveChatInOwner(owner: character | groupChat, chatId: string): ChatLookup {
    const chats = owner.chats
    if (!Array.isArray(chats)) {
        return { status: 'gone', match: null }
    }
    let match: ChatMatch | null = null
    let holders = 0
    for (let i = 0; i < chats.length; i++) {
        const candidate = chats[i]
        if (candidate && candidate.id === chatId) {
            holders++
            match = { index: i, chat: candidate }
        }
    }
    if (holders === 0) {
        return { status: 'gone', match: null }
    }
    if (holders > 1) {
        console.warn(
            `More than one chat holds id "${chatId}" within "${owner.name}". Skipping the write rather than `
            + `guessing which one is real -- this resolves on its own once the duplicate is gone.`
        )
        return { status: 'ambiguous', match: null }
    }
    return { status: 'ok', match }
}

/**
 * The full result of a scan: the origin's own status (covering the owner and
 * the chat together), the resolved context when that status is "ok", and --
 * separately -- the member's own status. A gone or ambiguous member never
 * changes the origin's own status: a caller that only cares whether the
 * owner and chat are usable must not have that answer flip because of an
 * unrelated member problem.
 */
interface OriginResolution {
    status: OriginStatus
    ctx: OriginContext | null
    memberStatus: OriginStatus | null
}

function resolveOriginFull(origin: Origin): OriginResolution {
    const ownerLookup = resolveCharacterByChaId(origin.chaId)
    if (ownerLookup.status !== 'ok' || !ownerLookup.match) {
        return { status: ownerLookup.status, ctx: null, memberStatus: null }
    }
    const chatLookup = resolveChatInOwner(ownerLookup.match.character, origin.chatId)
    if (chatLookup.status !== 'ok' || !chatLookup.match) {
        return { status: chatLookup.status, ctx: null, memberStatus: null }
    }
    let member: character | null = null
    let memberIndex: number | null = null
    let memberStatus: OriginStatus | null = null
    if (origin.memberChaId) {
        const memberLookup = resolveCharacterByChaId(origin.memberChaId)
        memberStatus = memberLookup.status
        if (memberLookup.status === 'ok' && memberLookup.match) {
            member = memberLookup.match.character as character
            memberIndex = memberLookup.match.index
        }
    }
    return {
        status: 'ok',
        ctx: {
            owner: ownerLookup.match.character,
            ownerIndex: ownerLookup.match.index,
            chat: chatLookup.match.chat,
            chatIndex: chatLookup.match.index,
            member,
            memberIndex,
        },
        memberStatus,
    }
}

/**
 * Resolves an origin against the live database: the owner and its index, the
 * chat and its index, and -- when `origin.memberChaId` is set -- the member
 * and its index, resolved separately from the owner. A gone or ambiguous
 * member resolves to `member: null, memberIndex: null` without affecting the
 * owner or chat resolution. Never reads `selectedCharID` or `chatPage`, never
 * fabricates an object, and never guesses between two holders of an id.
 *
 * Exported for tests only. Every other caller reaches the live data through
 * `writeAt`, `readAt`, `commitCharacter`, `commitChat` or a run subject
 * (`createRunSubject`), which resolve an origin and discard the result at
 * the end of one synchronous stretch; none of those return a live object or
 * an index that can outlive that stretch.
 */
export function resolveOrigin(origin: Origin): OriginContext | null {
    return resolveOriginFull(origin).ctx
}

/**
 * A one-off status check for a caller that needs to tell a gone origin apart
 * from an ambiguous one after a run has already ended -- `resolveOrigin`
 * alone answers only "resolved" or not. Does not memoise and is not counted
 * by `resolutionCountForTests`, the same as `beginWork`'s own resolution.
 */
export function originStatus(origin: Origin): OriginStatus {
    return resolveOriginFull(origin).status
}

/**
 * A callback for `writeAt`/`readAt` must run to completion synchronously, in
 * the same tick as resolution: the context it receives goes stale on the
 * very next edit to `characters`. Typing the return as `undefined` rejects a
 * Promise-returning (and so `async`) function at compile time -- an ordinary
 * block-bodied arrow function that returns nothing still type-checks. A
 * caller reached through an untyped boundary (a plugin, `any`) can still pass
 * one at runtime; `runOrigin` below catches that with a thenable check, since
 * the compile-time guard alone cannot stop it.
 */
type OriginCallback = (ctx: OriginContext) => undefined

function isThenable(value: unknown): value is PromiseLike<unknown> {
    return (
        value !== null
        && (typeof value === 'object' || typeof value === 'function')
        && typeof (value as { then?: unknown }).then === 'function'
    )
}

/**
 * Resolves `origin` and, when it resolved, calls `fn` with the context. When
 * `mark` is set, marks the owner -- and the member, whenever it resolved --
 * for save, unconditionally, in a `finally`: a `fn` that throws after writing
 * in place still gets its write saved. A `fn` that returns a thenable throws
 * after it returns (marks still apply), since the compile-time guard on
 * `OriginCallback` cannot stop a caller that bypassed it. Returns false
 * without calling `fn` or marking anything when the origin is gone or
 * ambiguous.
 */
function runOrigin(origin: Origin, fn: OriginCallback, mark: boolean): boolean {
    const ctx = resolveOrigin(origin)
    if (!ctx) {
        return false
    }
    try {
        const result: unknown = fn(ctx)
        if (isThenable(result)) {
            throw new Error(
                'writeAt/readAt requires a synchronous fn; a Promise-returning fn is not supported.'
            )
        }
    } finally {
        if (mark) {
            markCharacterForSave(ctx.owner.chaId)
            if (ctx.member) {
                markCharacterForSave(ctx.member.chaId)
            }
        }
    }
    return true
}

/**
 * Runs `fn` against `origin`'s resolved owner, chat and member, and marks
 * the owner -- and the member, whenever it resolved -- for save. See
 * `runOrigin` for the gone/ambiguous and marking rules.
 */
export function writeAt(origin: Origin, fn: OriginCallback): boolean {
    return runOrigin(origin, fn, true)
}

/**
 * Runs `fn` against `origin`'s resolved owner, chat and member, the same as
 * `writeAt`, but marks nothing -- for a caller that only reads.
 */
export function readAt(origin: Origin, fn: OriginCallback): boolean {
    return runOrigin(origin, fn, false)
}

// A count of full resolutions (actual scans of `characters`), not memo hits.
// Only `createRunSubject`'s and `createSendSubject`'s own fills increment
// this -- `writeAt`, `readAt`, `commitCharacter`, `commitChat` and
// `beginWork` each resolve at most once per call and are not part of a run's
// per-stretch cost, so counting them here would mix two different things a
// caller of these test-only exports might want to measure separately.
let resolutionCount = 0

export function resolutionCountForTests(): number {
    return resolutionCount
}

export function resetResolutionCountForTests(): void {
    resolutionCount = 0
}

/**
 * A run's own address into the live database, held for the run's whole
 * lifetime rather than re-created on every access. Resolution is memoised
 * for one synchronous stretch: filled on first use, and cleared by a
 * `queueMicrotask` queued at fill time, so the cached answer never survives
 * past whichever `await` the current stretch suspends on next -- a queued
 * microtask always runs before that suspension's own continuation. Before
 * reusing a still-live memo, `resolve`/`status`/`memberStatus` each confirm
 * the owner, its chat and the member (when present) are still at the
 * indices the memo recorded, and rescan when one has moved; this catches a
 * structural edit made by another flow of this same run -- concurrent Lua
 * coroutines sharing one call's subject -- that replaces or removes the
 * slot within one microtask checkpoint, without this run's own code ever
 * reaching an `await`.
 *
 * A caller must never keep the object `resolve()` returns past the
 * synchronous statement that called it -- the next access should go through
 * this same subject again, not through a held reference.
 */
export interface RunSubject {
    readonly origin: Origin
    resolve(): OriginContext | null
    status(): OriginStatus
    memberStatus(): OriginStatus | null
    mark(): void
}

export function createRunSubject(origin: Origin): RunSubject {
    let memo: OriginResolution | null = null

    function stillAtItsIndices(r: OriginResolution): boolean {
        if (r.status !== 'ok' || !r.ctx) {
            return true
        }
        const characters = DBState.db?.characters
        if (!Array.isArray(characters) || characters[r.ctx.ownerIndex] !== r.ctx.owner) {
            return false
        }
        if (!Array.isArray(r.ctx.owner.chats) || r.ctx.owner.chats[r.ctx.chatIndex] !== r.ctx.chat) {
            return false
        }
        if (r.ctx.member !== null && characters[r.ctx.memberIndex] !== r.ctx.member) {
            return false
        }
        return true
    }

    function ensure(): OriginResolution {
        if (memo && !stillAtItsIndices(memo)) {
            memo = null
        }
        if (!memo) {
            memo = resolveOriginFull(origin)
            resolutionCount++
            queueMicrotask(() => { memo = null })
        }
        return memo
    }

    return {
        origin,
        resolve(): OriginContext | null {
            return ensure().ctx
        },
        status(): OriginStatus {
            return ensure().status
        },
        memberStatus(): OriginStatus | null {
            return ensure().memberStatus
        },
        mark(): void {
            const r = ensure()
            if (r.status !== 'ok' || !r.ctx) {
                return
            }
            markCharacterForSave(r.ctx.owner.chaId)
            if (r.ctx.member) {
                markCharacterForSave(r.ctx.member.chaId)
            }
        },
    }
}

/**
 * The objects a caller read an origin's owner and chat through. Identity
 * hints only, never part of an `Origin` and never written to unless they are
 * a current holder: when an id has more than one holder, the holder that is
 * the hinted object is the one resolved to (rather than none), so a send in
 * a chat whose id is duplicated keeps writing to the chat it started from.
 * With a single holder the hint changes nothing, and a replacement object
 * holding the same ids is resolved to like any other single holder.
 */
export interface OriginHint {
    owner: character | groupChat
    chat: Chat
}

interface MemberResolution {
    member: character | null
    memberIndex: number | null
    status: OriginStatus | null
}

const NO_MEMBER: MemberResolution = { member: null, memberIndex: null, status: null }

function memberById(memberChaId: string | undefined): MemberResolution {
    if (!memberChaId) {
        return NO_MEMBER
    }
    const lookup = resolveCharacterByChaId(memberChaId)
    if (lookup.status === 'ok' && lookup.match) {
        return { member: lookup.match.character as character, memberIndex: lookup.match.index, status: 'ok' }
    }
    return { member: null, memberIndex: null, status: lookup.status }
}

/**
 * A full scan like `resolveOriginFull`, except that a duplicated owner or
 * chat id resolves to the hinted holder instead of to nothing. The holders are
 * counted here rather than through `resolveCharacterByChaId` and
 * `resolveChatInOwner`, which warn inside their scans: a tie-break that
 * succeeds is silent, and only a duplicate with no hinted holder warns,
 * through `warn`. The member is resolved by `resolveMember`.
 */
function resolveOriginWithHintFull(
    origin: Origin,
    hint: OriginHint | undefined,
    warn: (message: string) => void,
    resolveMember: (characters: Array<character | groupChat>) => MemberResolution,
): OriginResolution {
    const characters = DBState.db?.characters
    if (!Array.isArray(characters)) {
        return { status: 'gone', ctx: null, memberStatus: null }
    }
    let ownerMatch: CharacterMatch | null = null
    let hintedOwner: CharacterMatch | null = null
    let ownerHolders = 0
    for (let i = 0; i < characters.length; i++) {
        const candidate = characters[i]
        if (candidate && candidate.chaId === origin.chaId) {
            ownerHolders++
            ownerMatch = { index: i, character: candidate }
            if (hint && candidate === hint.owner) {
                hintedOwner = ownerMatch
            }
        }
    }
    if (ownerHolders === 0 || !ownerMatch) {
        return { status: 'gone', ctx: null, memberStatus: null }
    }
    if (ownerHolders > 1) {
        if (!hintedOwner) {
            warn(
                `More than one character holds chaId "${origin.chaId}" and none is the one this write started `
                + `from. Skipping the write rather than guessing which one is real -- this resolves on its own `
                + `once the duplicate is gone.`
            )
            return { status: 'ambiguous', ctx: null, memberStatus: null }
        }
        ownerMatch = hintedOwner
    }
    if (ownerMatch.character.coldstorage) {
        return { status: 'gone', ctx: null, memberStatus: null }
    }
    const owner = ownerMatch.character
    const chats = owner.chats
    if (!Array.isArray(chats)) {
        return { status: 'gone', ctx: null, memberStatus: null }
    }
    let chatMatch: ChatMatch | null = null
    let hintedChat: ChatMatch | null = null
    let chatHolders = 0
    for (let i = 0; i < chats.length; i++) {
        const candidate = chats[i]
        if (candidate && candidate.id === origin.chatId) {
            chatHolders++
            chatMatch = { index: i, chat: candidate }
            if (hint && candidate === hint.chat) {
                hintedChat = chatMatch
            }
        }
    }
    if (chatHolders === 0 || !chatMatch) {
        return { status: 'gone', ctx: null, memberStatus: null }
    }
    if (chatHolders > 1) {
        if (!hintedChat) {
            warn(
                `More than one chat holds id "${origin.chatId}" within "${owner.name}" and none is the one this `
                + `write started from. Skipping the write rather than guessing which one is real -- this resolves `
                + `on its own once the duplicate is gone.`
            )
            return { status: 'ambiguous', ctx: null, memberStatus: null }
        }
        chatMatch = hintedChat
    }
    const member = resolveMember(characters)
    return {
        status: 'ok',
        ctx: {
            owner,
            ownerIndex: ownerMatch.index,
            chat: chatMatch.chat,
            chatIndex: chatMatch.index,
            member: member.member,
            memberIndex: member.memberIndex,
        },
        memberStatus: member.status,
    }
}

/**
 * A full scan of an origin against the live database, resolving a duplicated
 * owner or chat id to the hinted object (see `OriginHint`). With no hint, or
 * when no holder is the hinted object, it answers exactly as `resolveOrigin`
 * does. Nothing is cached, so the result is only good for the synchronous
 * stretch that asked. Exported for callers that read an origin's chat once
 * outside a subject, and as the reference a fast-pathed `SendSubject` is
 * compared with in tests.
 */
export function resolveOriginWithHint(origin: Origin, hint?: OriginHint): OriginContext | null {
    return resolveOriginWithHintFull(origin, hint, (message) => console.warn(message), () => memberById(origin.memberChaId)).ctx
}

/**
 * A `RunSubject` for a send: it resolves with the identity tie-break of
 * `OriginHint`, and -- unlike a run's own subject -- keeps the positions of
 * its last full resolution across `await`s, reusing them only after checking
 * afresh, on every call, that the hinted owner and chat are still at those
 * positions and still carry the origin's ids. That check is what makes a
 * resolution per streamed chunk cheap: when it holds, a full scan would
 * return the same holders (the hinted object is one of the id's holders, and
 * the tie-break picks it whether it is the only one or one of several), and
 * when it fails the call takes the full scan and refreshes the positions. A
 * full scan is memoised for one synchronous stretch, like `createRunSubject`.
 * A duplicate warning is issued at most once per subject.
 *
 * A group turn pins its member once (`pinMember`); from then on the member is
 * re-found by the identity of that object, and only when that object is gone
 * from `characters` is it resolved by id again.
 */
export interface SendSubject extends RunSubject {
    /**
     * Fixes the member this subject speaks as to the one live, non-cold
     * character now holding `origin.memberChaId`. False, with nothing pinned,
     * when there is no member id or the id has no holder or several.
     */
    pinMember(): boolean
}

export function createSendSubject(origin: Origin, hint?: OriginHint): SendSubject {
    let warned = false
    const warnOnce = (message: string): void => {
        if (!warned) {
            warned = true
            console.warn(message)
        }
    }
    let memo: OriginResolution | null = null
    let pinned: character | null = null
    let positioned = false
    let ownerIndex = -1
    let chatIndex = -1
    let memberIndex = -1

    function resolveMember(characters: Array<character | groupChat>): MemberResolution {
        if (!origin.memberChaId) {
            return NO_MEMBER
        }
        if (pinned && pinned.chaId === origin.memberChaId) {
            let index = characters[memberIndex] === pinned ? memberIndex : characters.indexOf(pinned)
            if (index !== -1) {
                memberIndex = index
                return { member: pinned, memberIndex: index, status: 'ok' }
            }
        }
        return memberById(origin.memberChaId)
    }

    function resolveFast(characters: Array<character | groupChat>): OriginResolution | null {
        if (!hint || !positioned) {
            return null
        }
        const owner = hint.owner
        if (characters[ownerIndex] !== owner || owner.chaId !== origin.chaId) {
            return null
        }
        if (!Array.isArray(owner.chats) || owner.chats[chatIndex] !== hint.chat || hint.chat.id !== origin.chatId) {
            return null
        }
        const member = resolveMember(characters)
        return {
            status: 'ok',
            ctx: { owner, ownerIndex, chat: hint.chat, chatIndex, member: member.member, memberIndex: member.memberIndex },
            memberStatus: member.status,
        }
    }

    function stillAtItsIndices(r: OriginResolution): boolean {
        if (r.status !== 'ok' || !r.ctx) {
            return true
        }
        const characters = DBState.db?.characters
        if (!Array.isArray(characters) || characters[r.ctx.ownerIndex] !== r.ctx.owner) {
            return false
        }
        if (!Array.isArray(r.ctx.owner.chats) || r.ctx.owner.chats[r.ctx.chatIndex] !== r.ctx.chat) {
            return false
        }
        if (r.ctx.member !== null && characters[r.ctx.memberIndex] !== r.ctx.member) {
            return false
        }
        return true
    }

    function ensure(): OriginResolution {
        const characters = DBState.db?.characters
        if (Array.isArray(characters)) {
            const fast = resolveFast(characters)
            if (fast) {
                return fast
            }
        }
        if (memo && !stillAtItsIndices(memo)) {
            memo = null
        }
        if (!memo) {
            const full = resolveOriginWithHintFull(origin, hint, warnOnce, resolveMember)
            resolutionCount++
            if (full.status === 'ok' && full.ctx) {
                positioned = true
                ownerIndex = full.ctx.ownerIndex
                chatIndex = full.ctx.chatIndex
            }
            memo = full
            queueMicrotask(() => { memo = null })
        }
        return memo
    }

    return {
        origin,
        resolve(): OriginContext | null {
            return ensure().ctx
        },
        status(): OriginStatus {
            return ensure().status
        },
        memberStatus(): OriginStatus | null {
            return ensure().memberStatus
        },
        mark(): void {
            const r = ensure()
            if (r.status !== 'ok' || !r.ctx) {
                return
            }
            markCharacterForSave(r.ctx.owner.chaId)
            if (r.ctx.member) {
                markCharacterForSave(r.ctx.member.chaId)
            }
        },
        pinMember(): boolean {
            pinned = null
            memo = null
            const characters = DBState.db?.characters
            if (!origin.memberChaId || !Array.isArray(characters)) {
                return false
            }
            let found: character | null = null
            let holders = 0
            for (let i = 0; i < characters.length; i++) {
                const candidate = characters[i]
                if (candidate && candidate.chaId === origin.memberChaId) {
                    holders++
                    found = candidate as character
                }
            }
            if (holders !== 1 || !found || found.coldstorage) {
                return false
            }
            pinned = found
            memberIndex = -1
            return true
        },
    }
}

/**
 * Replaces the owner's or the member's slot in `DBState.db.characters` with
 * `clone`, but only when `clone.chaId` equals that slot's own `chaId` -- a
 * member's clone can never land in the owner's slot, or the reverse. Follows
 * the same gone/ambiguous rule as `resolveOrigin`: false, with nothing
 * written, in either case. Marks whichever slot it wrote.
 */
export function commitCharacter(origin: Origin, which: 'owner' | 'member', clone: character | groupChat): boolean {
    const ctx = resolveOrigin(origin)
    if (!ctx) {
        return false
    }
    if (which === 'owner') {
        if (!clone.chaId || clone.chaId !== ctx.owner.chaId) {
            return false
        }
        DBState.db.characters[ctx.ownerIndex] = clone
        markCharacterForSave(clone.chaId)
        return true
    }
    if (ctx.member === null || ctx.memberIndex === null) {
        return false
    }
    if (!clone.chaId || clone.chaId !== ctx.member.chaId) {
        return false
    }
    DBState.db.characters[ctx.memberIndex] = clone
    markCharacterForSave(clone.chaId)
    return true
}

/**
 * Replaces the owner's chat with `clone`, but only when `clone.id` equals
 * `origin.chatId`. Follows the same gone/ambiguous rule as `resolveOrigin`:
 * false, with nothing written, in either case. Marks the owner.
 */
export function commitChat(origin: Origin, clone: Chat): boolean {
    const ctx = resolveOrigin(origin)
    if (!ctx) {
        return false
    }
    if (!clone.id || clone.id !== origin.chatId) {
        return false
    }
    ctx.owner.chats[ctx.chatIndex] = clone
    markCharacterForSave(ctx.owner.chaId)
    return true
}

/**
 * A registered unit of work in flight against an origin. `end()` unregisters
 * it; a second call is harmless.
 */
export interface WorkHandle {
    origin: Origin
    end: () => void
}

/**
 * What stops one unit of work on behalf of a delete. It runs synchronously in
 * the delete's own stretch, so it must not await, and must leave the character
 * list alone: it only cancels or aborts the unit it belongs to.
 */
export type WorkStop = () => void

/**
 * What a registration is for. A `reply` is a send that writes a chat's reply,
 * a `preview` is a send that builds a prompt and writes nothing, and `work` is
 * every other unit (a take, a tree edit, a command). Only `reply` and
 * `preview` are reported by `isGeneratingIn` and `isBusyIn`.
 */
export type WorkKind = 'reply' | 'preview' | 'work'

interface Registration {
    chaId: string
    chatId: string
    memberChaId?: string
    kind: WorkKind
    stop?: WorkStop
    stopped: boolean
    ended: boolean
}

// Plain module state, like `src/ts/localDrafts.ts` -- not a rune. `isWriting`,
// `hasWorkIn` and `stopWorkIn` are polled, never watched, and a registration
// that outlives its work (because a caller forgot to call `end()`) should not
// need a reactive graph to eventually settle; it just leaves a stale "writing"
// answer, never a lost write. The only reactive reads are `isGeneratingIn` and
// `isBusyIn`, which follow a version that changes whenever a `reply` or
// `preview` registration starts or ends.
const registrations: Registration[] = []

function registerOrigin(origin: Origin, stop?: WorkStop, kind: WorkKind = 'work'): WorkHandle {
    const registration: Registration = {
        chaId: origin.chaId,
        chatId: origin.chatId,
        memberChaId: origin.memberChaId,
        kind,
        stop,
        stopped: false,
        ended: false,
    }
    registrations.push(registration)
    if (kind !== 'work') {
        bumpReplyVersion()
    }
    return {
        origin,
        end: () => {
            if (registration.ended) {
                return
            }
            registration.ended = true
            const index = registrations.indexOf(registration)
            if (index !== -1) {
                registrations.splice(index, 1)
            }
            if (kind !== 'work') {
                bumpReplyVersion()
            }
        },
    }
}

/**
 * Registers a unit of work against `origin` exactly as given -- for a caller
 * that already holds an origin and needs neither the id fill nor the
 * resolution `beginWork` makes. Registrations are counted like `beginWork`'s.
 * `stop`, when given, is what `stopWorkIn` calls to end this unit early.
 * `kind` defaults to `work`.
 */
export function registerWork(origin: Origin, stop?: WorkStop, kind?: WorkKind): WorkHandle {
    return registerOrigin(origin, stop, kind)
}

/**
 * True when `character` already has a `chaId`, or is found by identity among
 * `DBState.db.characters` -- a pre-insertion object or a clone, which was
 * never inserted into the live array, cannot be told apart from the real
 * thing any other way (Svelte 5 proxies compare by identity when both sides
 * were read through `DBState`). Never mutates `character`. Warns and returns
 * false otherwise, so a caller that finds this false knows to fill nothing at
 * all rather than fill this one and fail a later check.
 */
function characterIdFillable(character: character | groupChat): boolean {
    if (character.chaId) {
        return true
    }
    const characters = DBState.db?.characters
    if (Array.isArray(characters) && characters.indexOf(character) !== -1) {
        return true
    }
    console.warn(
        'beginWork: a character with no chaId was not found in the live database; refusing to fill its '
        + 'id. Pass an object read back through DBState, never a clone or a pre-insertion object.'
    )
    return false
}

/**
 * True when `chat` already has an id, or is found by identity among
 * `owner.chats` -- but only once `owner` itself is confirmed live by
 * identity in `DBState.db.characters`. A clone owner that already carries
 * its source's own `chaId` is not enough on its own: `characterIdFillable`
 * accepts such a clone because its own id needs no fill, but a clone's
 * `chats` cannot be trusted to prove `chat` is live either way -- a shallow
 * clone (`{ ...character }`) shares the very same live `chats` array, while
 * a deep one (`$state.snapshot`, `structuredClone`) does not -- so it is the
 * owner-liveness check above, not the clone's `chats` reference, that
 * refuses an unfindable owner here. Same purpose and refusal rule as
 * `characterIdFillable`, scoped to one owner's chats. Never mutates `chat`
 * or `owner`.
 */
function chatIdFillable(owner: character | groupChat, chat: Chat): boolean {
    if (chat.id) {
        return true
    }
    const characters = DBState.db?.characters
    const ownerIsLive = Array.isArray(characters) && characters.indexOf(owner) !== -1
    const chats = ownerIsLive ? owner.chats : null
    if (Array.isArray(chats) && chats.indexOf(chat) !== -1) {
        return true
    }
    console.warn(
        `beginWork: a chat with no id was not found among "${owner.name}"'s live chats; refusing to fill `
        + 'its id. Pass an object read back through DBState, never a clone or a pre-insertion object.'
    )
    return false
}

/**
 * Fills `character.chaId` with a fresh uuid when missing. Callers must only
 * call this once `characterIdFillable(character)` has already returned true.
 * A present `chaId` is never touched.
 */
function fillChaId(character: character | groupChat): { chaId: string, filled: boolean } {
    if (character.chaId) {
        return { chaId: character.chaId, filled: false }
    }
    const fresh = uuidv4()
    character.chaId = fresh
    return { chaId: fresh, filled: true }
}

/**
 * Fills `chat.id` with a fresh uuid when missing. Callers must only call this
 * once `chatIdFillable(owner, chat)` has already returned true. A present id
 * is never touched.
 */
function fillChatId(chat: Chat): { chatId: string, filled: boolean } {
    if (chat.id) {
        return { chatId: chat.id, filled: false }
    }
    const fresh = uuidv4()
    chat.id = fresh
    return { chatId: fresh, filled: true }
}

/**
 * Registers a unit of work against `character`'s chat, filling a missing
 * `chaId` or chat id on the live objects (never reassigning a present one).
 * `character`, `chat` and `member` must all be objects read back through
 * `DBState`, never a caller's pre-insertion object or a clone: a clone or
 * pre-insertion object can never be found in the live data by identity, and
 * filling a chat's id safely requires the owner itself to be found there too
 * -- a clone owner that already carries its source's own `chaId` needs no
 * fill for itself, but a shallow clone's `chats` is the same live array
 * while a deep clone's is not, so only the owner-liveness check, never the
 * clone's `chats` reference, can tell the chat is live. Every object with a
 * missing id is checked for findability first; only once every one of them
 * is found does any fill run,
 * so a call that is going to be refused never leaves a partial fill (an owner
 * id written, then the call refused for an unfindable chat) on the live
 * database. When one is not found, this returns null and warns, and writes
 * nothing. Also returns a handle -- with a warning -- when the origin it
 * built is already ambiguous; the writes made through it will then skip
 * under `resolveOrigin`'s own rule, on their own, until the duplicate is
 * gone.
 *
 * Call this only from an event handler or an async unit of work, never
 * during a reactive derivation ($derived/$effect): it can write to the live
 * database (the id fill), which a derivation must not do.
 *
 * `member` is typed `character | groupChat` because that is the element type
 * of `DBState.db.characters`, the array a caller reads it back from; a group
 * member is semantically always an ordinary character, never a nested group.
 *
 * `stop`, when given, is what `stopWorkIn` calls to end this unit early.
 * `kind` defaults to `work`.
 */
export function beginWork(character: character | groupChat, chat: Chat, member?: character | groupChat, stop?: WorkStop, kind?: WorkKind): WorkHandle | null {
    // Every object with a missing id must be findable live before any fill
    // runs: filling the owner and then discovering the chat cannot be found
    // would leave a fresh chaId written to the live database even though the
    // call as a whole is refused.
    if (!characterIdFillable(character) || !chatIdFillable(character, chat) || (member && !characterIdFillable(member))) {
        return null
    }

    const ownerFill = fillChaId(character)
    const chatFill = fillChatId(chat)
    if (ownerFill.filled || chatFill.filled) {
        markCharacterForSave(ownerFill.chaId)
    }

    let memberChaId: string | undefined
    if (member) {
        const memberFill = fillChaId(member)
        memberChaId = memberFill.chaId
        if (memberFill.filled) {
            markCharacterForSave(memberFill.chaId)
        }
    }

    const origin: Origin = memberChaId
        ? { chaId: ownerFill.chaId, chatId: chatFill.chatId, memberChaId }
        : { chaId: ownerFill.chaId, chatId: chatFill.chatId }

    // Read-only: resolving here (and discarding the result) is what produces
    // the ambiguous-origin warning at registration time, in addition to the
    // one every later write already gets from resolveOrigin.
    resolveOrigin(origin)

    return registerOrigin(origin, stop, kind)
}

/**
 * True when a registered unit of work targets `target.chaId` (as an owner or
 * as a group's member), or -- when `target.chatId` is given -- targets that
 * chat of it specifically. Registrations are counted, so two overlapping
 * units of work both keep `isWriting` true until both have called `end()`.
 * A stale registration (a caller that never called `end()`) leaves a
 * spurious "writing" answer here, never a lost write.
 */
export function isWriting(target: { chaId: string, chatId?: string }): boolean {
    return registrations.some((registration) => {
        const targetsCharacter = registration.chaId === target.chaId || registration.memberChaId === target.chaId
        if (!targetsCharacter) {
            return false
        }
        return target.chatId === undefined || registration.chatId === target.chatId
    })
}

function ownedBy(registration: Registration, target: { chaId: string, chatId?: string }): boolean {
    return registration.chaId === target.chaId
        && (target.chatId === undefined || registration.chatId === target.chatId)
}

/**
 * True when a registered unit of work is owned by `target.chaId` -- and, when
 * `target.chatId` is given, by that chat of it. Unlike `isWriting`, a unit
 * registered for a group's turn counts for the group only, never for the
 * member it speaks as: deleting the member deletes no chat the turn writes to.
 */
export function hasWorkIn(target: { chaId: string, chatId?: string }): boolean {
    return registrations.some((registration) => ownedBy(registration, target))
}

function hasKindIn(target: { chaId: string, chatId?: string }, kinds: readonly WorkKind[]): boolean {
    // The version is read first, so a reader inside an effect or a template
    // re-runs when a reply or preview registration starts or ends.
    readReplyVersion()
    return registrations.some((registration) => kinds.includes(registration.kind) && ownedBy(registration, target))
}

/**
 * True while a `reply` send is registered as owned by `target` (see
 * `hasWorkIn` for the owner-level match: a group's turn shows on the group,
 * never on the member it speaks as). Reactive.
 */
export function isGeneratingIn(target: { chaId: string, chatId?: string }): boolean {
    return hasKindIn(target, ['reply'])
}

/**
 * True while a `reply` or a `preview` send is registered as owned by `target`.
 * Reactive; same owner-level match as `isGeneratingIn`.
 */
export function isBusyIn(target: { chaId: string, chatId?: string }): boolean {
    return hasKindIn(target, ['reply', 'preview'])
}

/** True while the chat on screen is the one `origin` names. */
export function isShownChat(origin: { chaId: string, chatId: string }): boolean {
    const shown = DBState.db.characters[get(selectedCharID)]
    return shown?.chaId === origin.chaId && shown.chats?.[shown.chatPage]?.id === origin.chatId
}

/**
 * Stops every unit of work owned by `target` (see `hasWorkIn`): the matching
 * registrations are fixed first, then each one's stop is called once. A stop
 * may end its own registration, or another matching one; a registration that
 * has ended by the time its turn comes is skipped, and so is one whose stop
 * has already run, so a second call does nothing. A throwing stop is logged
 * and does not keep the others from running.
 */
export function stopWorkIn(target: { chaId: string, chatId?: string }): void {
    const matching = registrations.filter((registration) => ownedBy(registration, target))
    for (const registration of matching) {
        if (registration.ended || registration.stopped) {
            continue
        }
        registration.stopped = true
        try {
            registration.stop?.()
        } catch (error) {
            console.error(error)
        }
    }
}

/** True while any unit of work is registered, whatever chat it is bound to. */
export function hasAnyWork(): boolean {
    return registrations.length > 0
}

/**
 * True while anything is generating or about to: a registered unit of work
 * (which covers every send holding `doingChat`, since a send registers before
 * it takes the flag and ends its registration after releasing it), or the
 * composer's action window.
 */
export function isWorkInProgress(): boolean {
    return hasAnyWork() || isComposerWindowOpen()
}
