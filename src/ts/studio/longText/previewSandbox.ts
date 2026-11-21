/**
 * The CBS preview's offline run. A preview parses a field's text against a scratch owner and a scratch chat that are
 * built fresh on every call and never enter the database, through a fake `RunSubject` that resolves to them. The
 * parser's variable writes therefore land in the scratch chat, the subject's `mark` does nothing, and the subject's
 * `sharedGlobals` makes every shared variable read come from the preview's own values instead of the live ones.
 * `ParseMarkdown` and `processScriptFull` are never called: they run scripts and assets on the live character.
 * Reads that remain live are the ones the engine resolves offline: the persona list, preset prompts, template
 * defaults, and module rows and lorebooks (by the source's module reference ids). Nothing here loads a module.
 */
import { v4 as uuidv4 } from 'uuid'
import { risuChatParser } from '../../parser/parser.svelte'
import { createBlankChar } from '../../characters'
import { getUserName } from '../../util'
import type { OriginContext, RunSubject } from '../../process/chatOrigin'
import type { Chat, character, Message } from '../../storage/database.svelte'
import { collectMacroEntries } from './macroRegistry'
import { cbsNameKey, createMacroIndex, type MacroEntry, type MacroIndex } from './macroIndex'
import type { LongTextKind } from './fieldWrite'

export type SandboxSamples = { user: string; char: string }

export type SandboxValues = {
    /** The `{{char}}` name. */
    char: string
    /** Chat variables by name, without the stored `$` prefix. */
    chat: Readonly<Record<string, string>>
    /** Shared toggle values by `toggle_<key>`. */
    toggles: Readonly<Record<string, string>>
    /** The two sample messages, so `{{lastmessage}}` never indexes an empty list. */
    samples?: SandboxSamples
}

const TEXT_KEYS = [
    'desc', 'personality', 'scenario', 'firstMessage', 'exampleMessage', 'systemPrompt', 'postHistoryInstructions',
    'creatorNotes', 'replaceGlobalNote', 'additionalText',
] as const
type TextKey = typeof TEXT_KEYS[number]

/** Strings and one string array only: the source holds no reference into the live character. */
export type SandboxSource = {
    name: string
    defaultVariables: string
    alternateGreetings: readonly string[]
    texts: Readonly<Partial<Record<TextKey, string>>>
    /** The source chat's bound persona id, so `{{user}}` and `{{persona}}` read what a real chat would. */
    bindedPersona: string | null
    /** Module reference ids only; the module rows are read live. */
    modules: readonly string[]
    chatModules: readonly string[]
    /** The character's own toggle definitions: its author defaults apply to unset toggles in the preview. */
    customModuleToggle: string
}

export type SandboxWrite = { key: string; before: string | null; after: string }
export type PreviewRun = { ok: true; text: string; writes: SandboxWrite[]; varies: boolean } | { ok: false }

const DEFAULT_SAMPLES: SandboxSamples = { user: 'Sample message from you', char: 'Sample reply' }

export function sandboxSourceOf(live: character, chat: Chat | null): SandboxSource {
    const texts: Partial<Record<TextKey, string>> = {}
    for (const key of TEXT_KEYS) {
        const value = live[key]
        if (typeof value === 'string') texts[key] = value
    }
    return {
        name: live.name,
        defaultVariables: live.defaultVariables ?? '',
        alternateGreetings: [...(live.alternateGreetings ?? [])],
        texts,
        bindedPersona: chat?.bindedPersona || null,
        modules: [...(live.modules ?? [])],
        chatModules: [...(chat?.modules ?? [])],
        customModuleToggle: live.customModuleToggle ?? '',
    }
}

// The scratch chat matches the real one in what the engine reads: the bound persona, the module ids, the `$`-prefixed
// variable store as `setChatVar` writes it, and local globals with no prototype and no entries (so every read inherits).
function scratchChatOf(source: SandboxSource, chatValues: Readonly<Record<string, string>>, samples: SandboxSamples): Chat {
    const scriptstate: Record<string, string> = {}
    for (const [key, value] of Object.entries(chatValues)) scriptstate['$' + key] = value
    const message: Message[] = [
        { role: 'user', data: samples.user },
        { role: 'char', data: samples.char },
    ]
    const chat: Chat = {
        id: uuidv4(),
        name: '',
        note: '',
        localLore: [],
        message,
        scriptstate,
        GLGlobalVariables: Object.create(null),
        modules: [...source.chatModules],
    }
    if (source.bindedPersona !== null) chat.bindedPersona = source.bindedPersona
    return chat
}

/** The `{{user}}` name a real chat with this source's binding would show. */
export function sandboxUserName(source: SandboxSource): string {
    return getUserName(scratchChatOf(source, {}, DEFAULT_SAMPLES))
}

function sortedWrites(before: Readonly<Record<string, string | number | boolean>>, after: Readonly<Record<string, string | number | boolean>>): SandboxWrite[] {
    const writes: SandboxWrite[] = []
    for (const stateKey of Object.keys(after)) {
        const next = String(after[stateKey])
        const previous = stateKey in before ? String(before[stateKey]) : null
        if (next !== previous) writes.push({ key: stateKey.replace(/^\$/, ''), before: previous, after: next })
    }
    return writes.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

export function runPreview(fieldText: string, kind: LongTextKind, source: SandboxSource, values: SandboxValues): PreviewRun {
    try {
        const samples = values.samples ?? DEFAULT_SAMPLES
        const owner = createBlankChar()
        owner.name = values.char
        owner.defaultVariables = source.defaultVariables
        owner.alternateGreetings = [...source.alternateGreetings]
        owner.modules = [...source.modules]
        owner.customModuleToggle = source.customModuleToggle
        for (const key of TEXT_KEYS) {
            const value = source.texts[key]
            if (value !== undefined) owner[key] = value
        }
        if (kind === 'desc') owner.desc = fieldText
        const chat = scratchChatOf(source, values.chat, samples)
        const chatId = chat.id ?? ''
        owner.chats = [chat]
        owner.chatPage = 0
        const ctx: OriginContext = { owner, ownerIndex: -1, chat, chatIndex: 0, member: null, memberIndex: null }
        const subject: RunSubject = {
            origin: { chaId: owner.chaId, chatId },
            resolve: () => ctx,
            status: () => 'ok',
            memberStatus: () => null,
            mark: () => {},
            sharedGlobals: Object.assign(Object.create(null) as Record<string, string>, values.toggles),
        }
        const before = { ...chat.scriptstate }
        const greeting = kind === 'greeting'
        const text = risuChatParser(fieldText, {
            subject,
            chara: owner,
            runVar: true,
            rmVar: false,
            var: {},
            functions: new Map(),
            chatID: -1,
            visualize: greeting,
            cbsConditions: greeting ? { firstmsg: true, chatRole: 'char' } : {},
        })
        return { ok: true, text, writes: sortedWrites(before, chat.scriptstate ?? {}), varies: variesIn(fieldText) }
    } catch {
        return { ok: false }
    }
}

// Every text between a `{{` and the next brace. `complete` is true when that brace closes the macro, so a name that
// itself holds another macro (`getvar::{{x}}`, `getvar::a{{x}}`) is never listed as a static name.
function macroPieces(text: string): { piece: string; complete: boolean }[] {
    const pieces: { piece: string; complete: boolean }[] = []
    for (const found of text.matchAll(/\{\{([^{}]*)(?=([{}]|$))/g)) {
        pieces.push({ piece: found[1], complete: found[2] === '}' })
    }
    return pieces
}

const CHAT_KEY_HEADS = ['getvar', 'setvar', 'addvar', 'setdefaultvar']

/** The variable names a text names statically, in first-appearance order; toggles are listed as `toggle_<key>`. */
export function sandboxKeysOf(text: string): { chat: string[]; toggles: string[] } {
    const chat = new Set<string>()
    const toggles = new Set<string>()
    for (const { piece, complete } of macroPieces(text)) {
        if (!complete) continue
        const parts = piece.split('::')
        const head = cbsNameKey(parts[0])
        if (CHAT_KEY_HEADS.includes(head)) {
            if (parts[1]) chat.add(parts[1])
        } else if (head === 'getglobalvar') {
            if (parts[1]?.startsWith('toggle_') && parts[1].length > 'toggle_'.length) toggles.add(parts[1])
        } else if (head === '#when') {
            const tokens = parts.slice(1)
            tokens.forEach((token, i) => {
                if (token === 'var' && tokens[i + 1]) chat.add(tokens[i + 1])
                else if (token === 'toggle' && tokens[i + 1]) toggles.add('toggle_' + tokens[i + 1])
                else if ((token === 'vis' || token === 'visnot') && i > 0) chat.add(tokens[i - 1])
                else if ((token === 'tis' || token === 'tisnot') && i > 0) toggles.add('toggle_' + tokens[i - 1])
            })
        }
    }
    return { chat: [...chat], toggles: [...toggles] }
}

/** Every macro whose callback reads the clock, a random number or `dateTimeFormat`. Aliases resolve to the same entry. */
export const VARIES_NAMES: readonly string[] = [
    'time', 'date', 'unixtime', 'isotime', 'isodate', 'idleduration', 'random', 'randint', 'dice', 'roll', 'pick', 'rollp',
]

let macroIndex: MacroIndex | null = null
let varyingEntries: ReadonlySet<MacroEntry> | null = null

function varying(): { index: MacroIndex; entries: ReadonlySet<MacroEntry> } {
    macroIndex ??= createMacroIndex(collectMacroEntries())
    const index = macroIndex
    varyingEntries ??= new Set(VARIES_NAMES.flatMap((name) => {
        const entry = index.lookup(name)
        return entry ? [entry] : []
    }))
    return { index, entries: varyingEntries }
}

/** True when the text calls a macro that gives a different result on each run. */
export function variesIn(text: string): boolean {
    const { index, entries } = varying()
    return macroPieces(text).some(({ piece }) => {
        const entry = index.lookup(piece)
        return entry !== null && entries.has(entry)
    })
}

/**
 * The values a real chat holds, copied for the preview: every string chat variable, and every `toggle_` global. A
 * chat-local toggle wins only when it is not empty and not `'null'`, which is the engine's own "inherit" rule. A pure
 * read: it never goes through a live chat's variable reader, which creates a missing `scriptstate`.
 */
export function copiedChatValues(
    chat: Readonly<Chat> | null | undefined,
    globals: Readonly<Record<string, string>>,
): { chat: Record<string, string>; toggles: Record<string, string> } | null {
    if (!chat) return null
    const variables: Record<string, string> = {}
    for (const [key, value] of Object.entries(chat.scriptstate ?? {})) {
        if (key.startsWith('$') && typeof value === 'string') variables[key.slice(1)] = value
    }
    const toggles: Record<string, string> = {}
    for (const [key, value] of Object.entries(globals)) {
        if (key.startsWith('toggle_')) toggles[key] = value
    }
    for (const [key, value] of Object.entries(chat.GLGlobalVariables ?? {})) {
        if (key.startsWith('toggle_') && value && value !== 'null') toggles[key] = value
    }
    return { chat: variables, toggles }
}
