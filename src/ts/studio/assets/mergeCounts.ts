// The counts a merge confirm reads: how many chats of the owner, and for a module owner of every character that enables
// it, still name a removed asset or emotion name, and how many chats and characters were not read because they are
// archived. Pure jobs on the sliced runner: they read objects in place and never write, mark or load. A chat that is
// still a cold-storage pointer and a character that is a cold stub are counted as archived, never opened.
//
// A mention is the one the merge preview uses: `scanReferences` over the text, and a reference names a removed name by
// its own syntax's comparison (`referenceMatchesName`); a flagged dynamic or replacement-pattern name counts when it
// holds the name. A chat's texts are every message `data`, the chat `note` and every `localLore` entry `content`.
//
// A job never resolves a failure as a finished count: its result carries `state`, and only `done` is a complete count.
// A failed or aborted job leaves the figures it had reached, which are lower bounds ("at least n"). While a job runs it
// reports the figures reached so far, once per yield to the event loop and never per item, as a partial result in the
// `running` state; a partial is a lower bound too and is never a finished count.

import type { character, Chat, groupChat } from '../../storage/database.svelte'
import { isColdChat } from '../../process/coldstorageData'
import { matchesModuleRef, referencedModuleIds, type ModuleRefShape } from '../../process/moduleRefs'
import { isColdStub } from '../../storage/store2/codec/stub'
import { assetPoolKey } from './folderCodec'
import { referenceMatchesName, scanForName, scanReferences, type AssetKind, type PlaceHit, type RawReference } from './referenceScan'
import { enumerateClassifiedTargets } from './referenceTargets'
import { createSlicedRunner, textWindows, WINDOWED_SCAN_MIN_CHARS, type SlicedRunner, type SlicedRunnerOptions } from './slicedRunner'

/** `running` only appears in a progress partial; a job resolves `done`, `aborted` or `failed`. */
export type CountState = 'done' | 'running' | 'aborted' | 'failed'

export interface CountQuery {
    kind: AssetKind
    /** The removed names of the merge. */
    names: readonly string[]
}

export interface CountOptions extends SlicedRunnerOptions {
    /** Texts longer than this are scanned in windows; tests lower it. */
    windowChars?: number
}

export interface CountProgressOptions<R> extends CountOptions {
    /** Called with the figures reached so far at each yield of a running job; never after the job's signal aborted. */
    onProgress?: (partial: R) => void
}

export interface ChatCountResult {
    state: CountState
    /** Resident chats that name a removed name. */
    chats: number
    /** Chats that were not read because they are still cold-storage pointers. */
    archivedChats: number
}

export interface CharacterHits {
    chaId: string
    /** Places in the character's own texts that hold a removed name (references, flagged places and name lists). */
    textHits: number
    /** Resident chats of the character that name a removed name. */
    chatHits: number
    archivedChats: number
}

export interface EnablingCountResult {
    state: CountState
    /** Every character the module is enabled for, in list order, with its hits. */
    characters: CharacterHits[]
    /** Cold-stub characters, which are not read and whose enabling cannot be told. */
    archivedCharacters: number
}

export interface EnablingInput {
    module: ModuleRefShape
    characters: readonly (character | groupChat)[]
    enabledModules: readonly string[]
    moduleIntergration: string
}

// The widest a reference can be beside its name: the macro head and tail, or the attributes an `<img>` tag carries
// before its `src`. A reference whose head lies further back than this from its name, or whose tail further ahead, is
// not seen when it straddles two windows.
const REFERENCE_SPAN_SLACK = 4096

interface MentionMatcher {
    /** The longest span one reference may need after its name starts, for the window overlap. */
    readonly overlap: number
    /** Whether a reference whose name starts in `[from, to)` of `text` names a removed name. */
    mentions(text: string, from: number, to: number): boolean
}

// A text with none of these cannot hold a reference of either kind: the macros open with `{{`, `<img` opens a source
// attribute; `@@emo` is read only in a regex `out`, which a chat never is.
function couldHoldReference(text: string): boolean {
    return text.includes('{{') || /<img/i.test(text)
}

// Compiled once per merge: the names, their fold keys and the window overlap.
function compileMatcher(query: CountQuery): MentionMatcher {
    const names = [...query.names]
    const keys = names.map(assetPoolKey)
    const longest = names.reduce((most, name) => Math.max(most, name.length), 0)
    const named = (reference: RawReference): boolean => {
        if (reference.flag === 'dynamicName' || reference.flag === 'replacementPattern') {
            const held = assetPoolKey(reference.name)
            return keys.some((key) => held.includes(key))
        }
        return names.some((name) => referenceMatchesName(reference, name))
    }
    return {
        overlap: longest + REFERENCE_SPAN_SLACK,
        mentions(text, from, to) {
            if (!couldHoldReference(text)) {
                return false
            }
            return scanReferences(text, query.kind, 'chat').some((reference) => reference.offset >= from && reference.offset < to && named(reference))
        },
    }
}

function yieldToEventLoop(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0))
}

// The job's runner, reporting through `report` just before every yield to the event loop: a yield is the bounded cadence,
// and nothing is reported once the signal aborted.
function createReportingRunner(options: CountOptions, report: (() => void) | undefined): SlicedRunner {
    if (report === undefined) {
        return createSlicedRunner(options)
    }
    const yieldToLoop = options.yieldToLoop ?? yieldToEventLoop
    return createSlicedRunner({
        ...options,
        yieldToLoop: async () => {
            if (options.signal?.aborted !== true) {
                report()
            }
            await yieldToLoop()
        },
    })
}

// Whether one text names a removed name, in windows for a long one. Null when the job was aborted.
async function textNames(text: string, matcher: MentionMatcher, runner: SlicedRunner, windowChars: number): Promise<boolean | null> {
    for (const window of textWindows(text.length, matcher.overlap, windowChars)) {
        // A reference is owned by the window its name starts in; the window also reads the lead before it, where the
        // macro head or the `<img` tag opens, and the overlap after it, where the reference closes.
        const from = Math.max(0, window.ownedFrom - REFERENCE_SPAN_SLACK)
        if (matcher.mentions(text.slice(from, window.end), window.ownedFrom - from, window.ownedTo - from)) {
            return true
        }
        if (!await runner.checkpoint()) {
            return null
        }
    }
    return false
}

type ChatTexts = Pick<Chat, 'message' | 'note' | 'localLore'>

// Whether a resident chat names a removed name in any message, its note or its local lore. Null when aborted. The
// stored values are read as they are: an entry that is not a string is no text.
async function chatNames(chat: ChatTexts, matcher: MentionMatcher, runner: SlicedRunner, windowChars: number): Promise<boolean | null> {
    const texts: unknown[] = [chat.note]
    for (const message of Array.isArray(chat.message) ? chat.message : []) {
        texts.push(message?.data)
    }
    for (const lore of Array.isArray(chat.localLore) ? chat.localLore : []) {
        texts.push(lore?.content)
    }
    for (const text of texts) {
        if (typeof text !== 'string') {
            continue
        }
        const found = await textNames(text, matcher, runner, windowChars)
        if (found !== false) {
            return found
        }
    }
    return false
}

/**
 * The chats of one owner that name a removed name. A cold-storage pointer is counted as archived and not read. Never
 * rejects: a failure resolves `failed`, an abort `aborted`, and neither is a finished count.
 */
export async function countChatMentions(chats: readonly Chat[], query: CountQuery, options: CountProgressOptions<ChatCountResult> = {}): Promise<ChatCountResult> {
    const result: ChatCountResult = { state: 'done', chats: 0, archivedChats: 0 }
    const matcher = compileMatcher(query)
    const onProgress = options.onProgress
    const runner = createReportingRunner(options, onProgress === undefined ? undefined : () => onProgress({ ...result, state: 'running' }))
    const windowChars = options.windowChars ?? WINDOWED_SCAN_MIN_CHARS
    try {
        for (const chat of chats) {
            if (runner.aborted()) {
                result.state = 'aborted'
                return result
            }
            if (isColdChat(chat)) {
                result.archivedChats += 1
                continue
            }
            const found = await chatNames(chat, matcher, runner, windowChars)
            if (found === null || !await runner.checkpoint()) {
                result.state = 'aborted'
                return result
            }
            if (found) {
                result.chats += 1
            }
        }
    } catch {
        result.state = 'failed'
    }
    return result
}

function placeKey(hit: PlaceHit): string {
    return hit.path + '\0' + hit.offset + '\0' + hit.syntax
}

// The places of the character's own texts that hold a removed name, each counted once.
function ownTextHits(char: character, query: CountQuery): number {
    const targets = enumerateClassifiedTargets({ kind: 'character', source: char })
    const seen = new Set<string>()
    for (const name of query.names) {
        const scan = scanForName(targets, query.kind, name)
        for (const hit of [...scan.matches, ...scan.flagged, ...scan.nameLists]) {
            seen.add(placeKey(hit))
        }
    }
    return seen.size
}

/**
 * The characters a module is enabled for, with the places and chats of each that name a removed name. A module is
 * enabled for every character when its id or non-empty namespace is in `enabledModules` or the integration list;
 * otherwise through the character's own `modules` or the `modules` of one of its resident chats. A group is skipped; a
 * cold stub is counted as archived and not read. Never rejects: a failure resolves `failed`, an abort `aborted`.
 */
export async function countEnablingCharacters(input: EnablingInput, query: CountQuery, options: CountProgressOptions<EnablingCountResult> = {}): Promise<EnablingCountResult> {
    const result: EnablingCountResult = { state: 'done', characters: [], archivedCharacters: 0 }
    const matcher = compileMatcher(query)
    const onProgress = options.onProgress
    // The characters are copied: a hit's chat count still grows after the partial is handed out.
    const runner = createReportingRunner(
        options,
        onProgress === undefined ? undefined : () => onProgress({ ...result, state: 'running', characters: result.characters.map((entry) => ({ ...entry })) }),
    )
    const windowChars = options.windowChars ?? WINDOWED_SCAN_MIN_CHARS
    try {
        const everywhere = matchesModuleRef(
            input.module,
            new Set(referencedModuleIds({ enabledModules: [...input.enabledModules], moduleIntergration: input.moduleIntergration })),
        )
        for (const char of input.characters) {
            if (runner.aborted()) {
                result.state = 'aborted'
                return result
            }
            if (char.type === 'group') {
                continue
            }
            if (isColdStub(char)) {
                result.archivedCharacters += 1
                continue
            }
            const chats = Array.isArray(char.chats) ? char.chats : []
            const resident = chats.filter((chat) => !isColdChat(chat))
            const enabled =
                everywhere ||
                matchesModuleRef(input.module, new Set(referencedModuleIds({ character: char }))) ||
                resident.some((chat) => matchesModuleRef(input.module, new Set(referencedModuleIds({ chat }))))
            if (!enabled) {
                continue
            }
            const hits: CharacterHits = { chaId: char.chaId, textHits: ownTextHits(char, query), chatHits: 0, archivedChats: chats.length - resident.length }
            result.characters.push(hits)
            if (!await runner.checkpoint()) {
                result.state = 'aborted'
                return result
            }
            for (const chat of resident) {
                if (runner.aborted()) {
                    result.state = 'aborted'
                    return result
                }
                const found = await chatNames(chat, matcher, runner, windowChars)
                if (found === null || !await runner.checkpoint()) {
                    result.state = 'aborted'
                    return result
                }
                if (found) {
                    hits.chatHits += 1
                }
            }
        }
    } catch {
        result.state = 'failed'
    }
    return result
}
