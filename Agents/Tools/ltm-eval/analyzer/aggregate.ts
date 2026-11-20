// Pure aggregation of a resolved database into numbers only. No IO, no logging. Every label in the result
// is a key taken from the constants in schema.ts; nothing from the data (names, ids, keys, text) is stored.
// Real-data values are narrowed defensively: a field of an unexpected type counts as absent.
import type { Database } from 'src/ts/storage/database.svelte'
import { isHiddenAt, promptResetIndex } from 'src/ts/chatShell/inChatSearch'
import { countDecorators } from './decorators'
import {
    DECORATOR_KEYS, HANGUL_BANDS, HANGUL_BAND_EDGES, LORE_CONTENT_EDGES, LORE_ENTRIES_EDGES, LORE_MODES,
    MESSAGE_LENGTH_EDGES, MESSAGES_PER_CHAT_EDGES, REGEX_SCRIPTS_EDGES, SCHEMA_VERSION,
    type HangulBand, type Role,
} from './schema'

export type Hist = { edges: number[]; counts: number[]; n: number; p50: number; p90: number; p99: number; max: number }
type Keyed<K extends string, V> = { [P in K]: V }

export type LtmAggregates = {
    schemaVersion: number
    totals: Keyed<
        'characters' | 'groups' | 'chats' | 'messages' | 'messagesUser' | 'messagesChar' | 'nonStringMessageData'
        | 'hiddenMessages' | 'hiddenByFlag' | 'hiddenByReset' | 'altMessages' | 'modules' | 'enabledModules'
        | 'loreEntriesCharacter' | 'loreEntriesGroup' | 'loreEntriesChat' | 'loreEntriesModule'
        | 'regexScriptsGroup' | 'incompleteUnits' | 'omittedBlocks', number>
    hiddenShare: number
    hangulBandEdges: number[]
    messageLength: {
        edges: number[]
        byRole: Keyed<Role, Hist>
        byHangulBand: Keyed<HangulBand, Hist>
        byRoleAndHangulBand: Keyed<Role, Keyed<HangulBand, Hist>>
    }
    messagesPerChat: Hist
    loreEntriesPerCharacter: Hist
    loreEntriesPerChat: Hist
    loreEntriesPerModule: Hist
    loreContentLength: Hist
    lore: {
        selective: number
        useRegex: number
        alwaysActive: number
        withDecorators: number
        decoratorLines: number
        decoratorThrows: number
        decorators: Keyed<typeof DECORATOR_KEYS[number], number>
        mode: Keyed<typeof LORE_MODES[number], number>
    }
    regexScriptsPerCharacter: Hist
    regexScriptsPerModule: Hist
}

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const asArray = (v: unknown): unknown[] => Array.isArray(v) ? v : []

function bucketOf(edges: readonly number[], value: number): number {
    let lo = 0
    let hi = edges.length - 1
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (edges[mid] <= value) lo = mid
        else hi = mid - 1
    }
    return lo
}

/** Nearest-rank quantiles (`sorted[ceil(q*n)-1]`); everything is 0 when there are no values. */
export function histogram(edges: readonly number[], values: readonly number[]): Hist {
    const counts = edges.map(() => 0)
    for (const value of values) counts[bucketOf(edges, value)] += 1
    const n = values.length
    if (n === 0) return { edges: [...edges], counts, n: 0, p50: 0, p90: 0, p99: 0, max: 0 }
    const sorted = [...values].sort((a, b) => a - b)
    const rank = (q: number) => sorted[Math.max(0, Math.ceil(q * n) - 1)]
    return { edges: [...edges], counts, n, p50: rank(0.5), p90: rank(0.9), p99: rank(0.99), max: sorted[n - 1] }
}

function hangulBandOf(share: number): HangulBand {
    return HANGUL_BANDS[bucketOf(HANGUL_BAND_EDGES, share)]
}

const LETTER = /\p{L}/u
const HANGUL = /\p{Script=Hangul}/u

/** Code-point length and Hangul band of a text, in one pass. A text with no letters has share 0. */
function measureText(text: string): { length: number; band: HangulBand } {
    let length = 0
    let letters = 0
    let hangul = 0
    for (const ch of text) {
        length++
        if (LETTER.test(ch)) {
            letters++
            if (HANGUL.test(ch)) hangul++
        }
    }
    return { length, band: hangulBandOf(letters === 0 ? 0 : hangul / letters) }
}

const zeroed = <K extends string>(keys: readonly K[]): Keyed<K, number> =>
    Object.fromEntries(keys.map((k) => [k, 0])) as Keyed<K, number>

export type Aggregator = {
    /** Feeds one character or group slot, in file order. */
    addOwner(owner: unknown): void
    /** Feeds the modules of the non-character root, once, after every owner. */
    addRoot(db: Pick<Database, 'modules' | 'enabledModules'>): void
    /** The aggregates of everything fed; call once. */
    finish(): LtmAggregates
}

/** An incremental aggregator: it keeps numbers only, never an owner, so a caller can feed one owner at a time. */
export function createAggregator(): Aggregator {
    const totals = zeroed([
        'characters', 'groups', 'chats', 'messages', 'messagesUser', 'messagesChar', 'nonStringMessageData',
        'hiddenMessages', 'hiddenByFlag', 'hiddenByReset', 'altMessages', 'modules', 'enabledModules',
        'loreEntriesCharacter', 'loreEntriesGroup', 'loreEntriesChat', 'loreEntriesModule',
        'regexScriptsGroup', 'incompleteUnits', 'omittedBlocks',
    ] as const)
    const lore = {
        selective: 0, useRegex: 0, alwaysActive: 0, withDecorators: 0, decoratorLines: 0, decoratorThrows: 0,
        decorators: zeroed(DECORATOR_KEYS), mode: zeroed(LORE_MODES),
    }
    const loreContent: number[] = []
    const perChat: number[] = []
    const perCharacterLore: number[] = []
    const perChatLore: number[] = []
    const perModuleLore: number[] = []
    const perCharacterRegex: number[] = []
    const perModuleRegex: number[] = []
    const byCell: Record<Role, Record<HangulBand, number[]>> = {
        user: { none: [], low: [], mixed: [], high: [] },
        char: { none: [], low: [], mixed: [], high: [] },
    }
    const otherRoleByBand: Record<HangulBand, number[]> = { none: [], low: [], mixed: [], high: [] }

    /** Counts the non-folder entries of one lore list and returns that count. */
    const countLore = (entries: unknown): number => {
        let count = 0
        for (const entry of asArray(entries)) {
            if (!isRec(entry)) continue
            const modeIndex = typeof entry.mode === 'string' ? (LORE_MODES as readonly string[]).indexOf(entry.mode) : -1
            const modeKey = modeIndex >= 0 ? LORE_MODES[modeIndex] : 'other'
            lore.mode[modeKey] += 1
            if (modeKey === 'folder') continue
            count++
            if (entry.selective === true) lore.selective++
            if (entry.useRegex === true) lore.useRegex++
            if (entry.alwaysActive === true) lore.alwaysActive++
            if (typeof entry.content !== 'string') {
                loreContent.push(0)
                continue
            }
            const result = countDecorators(entry.content)
            if (result.keys.length > 0) lore.withDecorators++
            lore.decoratorLines += result.keys.length
            for (const key of result.keys) lore.decorators[key] += 1
            if (result.threw) lore.decoratorThrows++
            if (result.bodyLength !== null) loreContent.push(result.bodyLength)
        }
        return count
    }

    const countChat = (chat: unknown): void => {
        if (!isRec(chat)) return
        totals.chats++
        const raw = asArray(chat.message)
        perChat.push(raw.length)
        totals.altMessages += asArray(chat.alt).length
        const loreCount = countLore(chat.localLore)
        totals.loreEntriesChat += loreCount
        perChatLore.push(loreCount)
        const msgs = raw.every(isRec) ? raw as Rec[] : raw.map((m) => isRec(m) ? m : {})
        const reset = promptResetIndex(msgs as { disabled?: false | true | 'allBefore' }[])
        for (let i = 0; i < msgs.length; i++) {
            const message = msgs[i]
            totals.messages++
            const role: Role | null = message.role === 'user' ? 'user' : message.role === 'char' ? 'char' : null
            if (role === 'user') totals.messagesUser++
            else if (role === 'char') totals.messagesChar++
            if (isHiddenAt(msgs as { disabled?: false | true | 'allBefore' }[], i, reset)) {
                totals.hiddenMessages++
                if (i <= reset) totals.hiddenByReset++
                else totals.hiddenByFlag++
            }
            if (typeof message.data !== 'string') {
                totals.nonStringMessageData++
                continue
            }
            const measured = measureText(message.data)
            if (role === null) otherRoleByBand[measured.band].push(measured.length)
            else byCell[role][measured.band].push(measured.length)
        }
    }

    const addOwner = (owner: unknown): void => {
        if (!isRec(owner)) return
        const isGroup = owner.type === 'group'
        const scripts = asArray(owner.customscript).length
        const loreCount = countLore(owner.globalLore)
        if (isGroup) {
            totals.groups++
            totals.loreEntriesGroup += loreCount
            totals.regexScriptsGroup += scripts
        } else {
            totals.characters++
            totals.loreEntriesCharacter += loreCount
            perCharacterLore.push(loreCount)
            perCharacterRegex.push(scripts)
        }
        for (const chat of asArray(owner.chats)) countChat(chat)
    }

    const addRoot = (db: Pick<Database, 'modules' | 'enabledModules'>): void => {
        totals.modules = asArray(db.modules).length
        totals.enabledModules = asArray(db.enabledModules).length
        for (const module of asArray(db.modules)) {
            if (!isRec(module)) continue
            const loreCount = countLore(module.lorebook)
            totals.loreEntriesModule += loreCount
            perModuleLore.push(loreCount)
            perModuleRegex.push(asArray(module.regex).length)
        }
    }

    const finish = (): LtmAggregates => {
        const bandValues = (band: HangulBand): number[] => [...byCell.user[band], ...byCell.char[band], ...otherRoleByBand[band]]
        const roleValues = (role: Role): number[] => HANGUL_BANDS.flatMap((band) => byCell[role][band])
        const edges = MESSAGE_LENGTH_EDGES
        const hist = (role: Role, band: HangulBand) => histogram(edges, byCell[role][band])

        return {
            schemaVersion: SCHEMA_VERSION,
            totals,
            hiddenShare: totals.messages === 0 ? 0 : totals.hiddenMessages / totals.messages,
            hangulBandEdges: [...HANGUL_BAND_EDGES],
            messageLength: {
                edges: [...edges],
                byRole: { user: histogram(edges, roleValues('user')), char: histogram(edges, roleValues('char')) },
                byHangulBand: {
                    none: histogram(edges, bandValues('none')), low: histogram(edges, bandValues('low')),
                    mixed: histogram(edges, bandValues('mixed')), high: histogram(edges, bandValues('high')),
                },
                byRoleAndHangulBand: {
                    user: { none: hist('user', 'none'), low: hist('user', 'low'), mixed: hist('user', 'mixed'), high: hist('user', 'high') },
                    char: { none: hist('char', 'none'), low: hist('char', 'low'), mixed: hist('char', 'mixed'), high: hist('char', 'high') },
                },
            },
            messagesPerChat: histogram(MESSAGES_PER_CHAT_EDGES, perChat),
            loreEntriesPerCharacter: histogram(LORE_ENTRIES_EDGES, perCharacterLore),
            loreEntriesPerChat: histogram(LORE_ENTRIES_EDGES, perChatLore),
            loreEntriesPerModule: histogram(LORE_ENTRIES_EDGES, perModuleLore),
            loreContentLength: histogram(LORE_CONTENT_EDGES, loreContent),
            lore,
            regexScriptsPerCharacter: histogram(REGEX_SCRIPTS_EDGES, perCharacterRegex),
            regexScriptsPerModule: histogram(REGEX_SCRIPTS_EDGES, perModuleRegex),
        }
    }

    return { addOwner, addRoot, finish }
}

/** The whole-tree path: every owner, then the root, through one aggregator. */
export function aggregateDatabase(db: Pick<Database, 'characters' | 'modules' | 'enabledModules'>): LtmAggregates {
    const aggregator = createAggregator()
    for (const owner of asArray(db.characters)) aggregator.addOwner(owner)
    aggregator.addRoot(db)
    return aggregator.finish()
}
