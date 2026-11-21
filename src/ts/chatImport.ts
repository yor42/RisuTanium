import type { ChatAlt, Message } from './storage/database.svelte'

/** The replies kept beside the shown one, in file order: those before it and those after it. */
export type TavernSwipes = {
    before: string[]
    after: string[]
}

export type TavernLine = {
    isUser: boolean
    mes: string
    /** Present only when at least one list is non-empty. */
    swipes?: TavernSwipes
    /** Milliseconds since the epoch, always within `boundTime`'s range. */
    sendDate?: number
    /** Trimmed, non-empty. The own-name filter runs in `tavernMessageName`. */
    name?: string
    isSystem?: true
}

export type TavernHeader = {
    userName?: string
    characterName?: string
}

export type ChatImportResult = {
    messages: TavernLine[]
    skipped: number
    /** Messages not kept beside the shown reply: alternatives that could not be kept and, for branched files, the messages after a branch's first differing message. */
    swipesNotKept: number
    header?: TavernHeader
    /** Picture or audio tokens removed from the text, which the import does not keep. */
    mediaNotKept?: number
}

export type TavernJsonlResult = ChatImportResult

export type TavernOwnNames = {
    userName: string
    characterName: string
}

const tavernHeaderKeys = ['user_name', 'character_name', 'chat_metadata', 'create_date']

// 9999-12-31T23:59:59.999Z. `Intl.DateTimeFormat#format` throws beyond the Date
// range, so a saved `time` must stay at or below this.
const maxTime = 253402300799999

const defaultChatName = 'Imported Chat'

const monthNumbers: Record<string, number> = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
    jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

const isoPattern = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}(?::?\d{2})?)?)?$/
const offsetPattern = /^([+-])(\d{2}):?(\d{2})?$/
const meridiemPattern = /^([A-Za-z]+) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2}) ?([ap]m)$/i
const humanizedPattern = /^(\d{4})-(\d{1,2})-(\d{1,2}) ?@ ?(\d{1,2})h ?(\d{1,2})m ?(\d{1,2})s(?: ?(\d{1,3})ms)?$/

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundTime(time: number): number | undefined {
    return Number.isFinite(time) && time > 0 && time <= maxTime ? time : undefined
}

// Date.UTC and the Date constructor map years 0-99 to 1900-1999 and roll an
// impossible day over, so the fields are set explicitly and compared back.
function isCalendarDate(year: number, month: number, day: number): boolean {
    const probe = new Date(0)
    probe.setUTCFullYear(year, month - 1, day)
    return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
}

function isClockTime(hour: number, minute: number, second: number): boolean {
    return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59
}

function utcTime(year: number, month: number, day: number, hour: number, minute: number, second: number, ms: number): number {
    const moment = new Date(0)
    moment.setUTCFullYear(year, month - 1, day)
    return moment.setUTCHours(hour, minute, second, ms)
}

function localTime(year: number, month: number, day: number, hour: number, minute: number, second: number, ms: number): number {
    const moment = new Date(0)
    moment.setFullYear(year, month - 1, day)
    return moment.setHours(hour, minute, second, ms)
}

// The first three fraction digits, right-padded, so `.1` is 100 ms.
function fractionToMs(fraction: string | undefined): number {
    return fraction === undefined ? 0 : Number((fraction + '00').slice(0, 3))
}

function parseOffsetMinutes(offset: string): number | undefined {
    const match = offsetPattern.exec(offset)
    if(!match){
        return undefined
    }
    const hours = Number(match[2])
    const minutes = match[3] === undefined ? 0 : Number(match[3])
    if(hours > 23 || minutes > 59){
        return undefined
    }
    return (match[1] === '-' ? -1 : 1) * (hours * 60 + minutes)
}

function parseIsoDate(text: string): number | undefined {
    const match = isoPattern.exec(text)
    if(!match){
        return undefined
    }
    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    if(!isCalendarDate(year, month, day)){
        return undefined
    }
    if(match[4] === undefined){
        return localTime(year, month, day, 0, 0, 0, 0)
    }
    const hour = Number(match[4])
    const minute = Number(match[5])
    const second = match[6] === undefined ? 0 : Number(match[6])
    if(!isClockTime(hour, minute, second)){
        return undefined
    }
    const ms = fractionToMs(match[7])
    const zone = match[8]
    if(zone === undefined){
        return localTime(year, month, day, hour, minute, second, ms)
    }
    if(zone === 'Z'){
        return utcTime(year, month, day, hour, minute, second, ms)
    }
    const offsetMinutes = parseOffsetMinutes(zone)
    if(offsetMinutes === undefined){
        return undefined
    }
    return utcTime(year, month, day, hour, minute, second, ms) - offsetMinutes * 60000
}

function parseMeridiemDate(text: string): number | undefined {
    const match = meridiemPattern.exec(text)
    if(!match){
        return undefined
    }
    const month = monthNumbers[match[1].toLowerCase()]
    const day = Number(match[2])
    const year = Number(match[3])
    const hour12 = Number(match[4])
    const minute = Number(match[5])
    if(month === undefined || hour12 < 1 || hour12 > 12 || minute > 59 || !isCalendarDate(year, month, day)){
        return undefined
    }
    const hour = (hour12 % 12) + (match[6].toLowerCase() === 'pm' ? 12 : 0)
    return localTime(year, month, day, hour, minute, 0, 0)
}

function parseHumanizedDate(text: string): number | undefined {
    const match = humanizedPattern.exec(text)
    if(!match){
        return undefined
    }
    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    const hour = Number(match[4])
    const minute = Number(match[5])
    const second = Number(match[6])
    const ms = match[7] === undefined ? 0 : Number(match[7])
    if(!isCalendarDate(year, month, day) || !isClockTime(hour, minute, second)){
        return undefined
    }
    return utcTime(year, month, day, hour, minute, second, ms)
}

/**
 * Reads a SillyTavern `send_date` into milliseconds since the epoch. Forms:
 * epoch milliseconds (number or digit string), ISO 8601 (no offset is local
 * time, a date alone is local midnight), the older `June 19, 2023 2:20pm`
 * (local) and the `2024-07-12@01h31m37s123ms` file-name form (UTC). Anything
 * unreadable, calendar-invalid, or outside 1970..9999 gives `undefined`, so a
 * saved `time` is always one that `Intl.DateTimeFormat` can format.
 */
export function parseTavernSendDate(value: unknown): number | undefined {
    if(typeof value === 'number'){
        return boundTime(value)
    }
    if(typeof value !== 'string'){
        return undefined
    }
    const text = value.trim()
    if(/^\d+$/.test(text)){
        return boundTime(Number(text))
    }
    const parsed = parseIsoDate(text) ?? parseMeridiemDate(text) ?? parseHumanizedDate(text)
    return parsed === undefined ? undefined : boundTime(parsed)
}

// A string, or a Chub object `{ message: string }`; anything else is unreadable.
function readReply(value: unknown): string | undefined {
    if(typeof value === 'string'){
        return value
    }
    if(isPlainObject(value) && typeof value.message === 'string'){
        return value.message
    }
    return undefined
}

// A kept reply is a readable, non-empty entry; the others hold no reply and are
// dropped silently.
function isKeptReply(entry: string | undefined): entry is string {
    return entry !== undefined && entry !== ''
}

// The slot of the shown text among `entries`: `index` only when it is in range
// and that entry is the shown text, else the first entry with that text, else
// -1 (the shown reply then goes before every kept reply).
function shownSlot(shown: string, entries: readonly (string | undefined)[], index: unknown): number {
    if(typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < entries.length && entries[index] === shown){
        return index
    }
    return entries.indexOf(shown)
}

// The kept entries other than `slot`, in file order: those before `slot` in
// `before`, the rest in `after` (all of them when `slot` is -1). `undefined`
// when no kept entry other than `slot` exists.
function splitSwipes(entries: readonly (string | undefined)[], slot: number): TavernSwipes | undefined {
    const before: string[] = []
    const after: string[] = []
    entries.forEach((entry, index) => {
        if(!isKeptReply(entry) || index === slot){
            return
        }
        (slot !== -1 && index < slot ? before : after).push(entry)
    })
    return before.length === 0 && after.length === 0 ? undefined : { before, after }
}

// The shown reply of a line and the replies kept beside it, or `undefined` for
// an empty `mes` with no kept entry. The shown reply is always `mes` (an empty
// one is replaced by the first kept entry), so nothing the line shows changes.
// A lone entry equal to `mes` therefore leaves both lists empty.
function keepSwipes(mes: string, entries: readonly (string | undefined)[], index: unknown): { mes: string, swipes?: TavernSwipes } | undefined {
    let shown = mes
    let slot: number
    if(mes === ''){
        slot = entries.findIndex(isKeptReply)
        if(slot === -1){
            return undefined
        }
        shown = entries[slot] as string
    }
    else {
        slot = shownSlot(mes, entries, index)
    }
    const swipes = splitSwipes(entries, slot)
    return swipes === undefined ? { mes: shown } : { mes: shown, swipes }
}

// A SillyTavern line's `swipes`, read through `readReply`, with `swipe_id` as the slot hint.
function readSwipes(mes: string, swipes: unknown, swipeId: unknown): { mes: string, swipes?: TavernSwipes } | undefined {
    return keepSwipes(mes, Array.isArray(swipes) ? swipes.map(readReply) : [], swipeId)
}

// Role and name are copied from the shown message onto every kept swipe, so a
// swipe taken from another entry of the file must match the shown message's side.
function sameSide(a: TavernLine, b: TavernLine): boolean {
    return a.isUser === b.isUser && Boolean(a.isSystem) === Boolean(b.isSystem)
}

function sameSpeaker(a: TavernLine, b: TavernLine): boolean {
    return sameSide(a, b) && a.name === b.name
}

/** The chat name for an imported `.jsonl` or `.json` file: its name without the extension. */
export function chatNameFromFile(fileName: string): string {
    const name = fileName.replace(/\.jsonl?$/i, '').trim()
    return name === '' ? defaultChatName : name
}

/**
 * The `name` to store on an imported message: the line's own trimmed name
 * unless it equals (exact, after trimming) the app's or the header's name for
 * that side, in which case it carries no information and is dropped.
 */
export function tavernMessageName(
    line: { isUser: boolean, name?: string },
    header: TavernHeader | undefined,
    own: TavernOwnNames,
): string | undefined {
    const name = line.name?.trim()
    if(!name){
        return undefined
    }
    const ownNames = line.isUser
        ? [own.userName, header?.userName]
        : [own.characterName, header?.characterName]
    if(ownNames.some((ownName) => ownName?.trim() === name)){
        return undefined
    }
    return name
}

/**
 * Turns a reader's lines into the active path and the alternatives of a chat.
 * Each line becomes one path message. A line with `swipes` also yields one
 * record `{ m, p, a: 1 }` per kept reply, `p` the `chatId` of the previous path
 * message (null at position 0), one import being one run. Siblings display in
 * file order with the shown reply at its own slot: by millisecond offsets
 * around its time while every offset time stays within 1..`maxTime`, otherwise
 * by sorted ids, which the tree breaks equal times with. A chat without any
 * swipe is returned exactly as a plain path: no record, no `chatId`.
 */
export function buildTavernTree(
    result: Pick<ChatImportResult, 'messages' | 'header'>,
    own: TavernOwnNames,
    format: (text: string) => string,
    newId: () => string,
): { message: Message[], alt: ChatAlt[] } {
    const { messages, header } = result
    const message: Message[] = messages.map((line) => {
        const built: Message = {
            role: line.isUser ? 'user' : 'char',
            data: format(line.mes),
        }
        if(line.sendDate !== undefined){
            built.time = line.sendDate
        }
        const name = tavernMessageName(line, header, own)
        if(name !== undefined){
            built.name = name
        }
        if(line.isSystem){
            built.disabled = true
        }
        return built
    })
    if(!messages.some((line) => line.swipes !== undefined)){
        return { message, alt: [] }
    }

    const siblings: { position: number, text: string, time?: number, chatId: string }[] = []
    messages.forEach((line, position) => {
        if(line.swipes === undefined){
            return
        }
        const texts = [...line.swipes.before, line.mes, ...line.swipes.after]
        const shownSlot = line.swipes.before.length
        const shown = message[position]
        const shownTime = shown.time
        const offsets = shownTime !== undefined
            && shownTime - shownSlot >= 1
            && shownTime + (texts.length - 1 - shownSlot) <= maxTime
        const ids = offsets ? [] : texts.map(() => newId()).sort()
        if(!offsets){
            shown.chatId = ids[shownSlot]
        }
        texts.forEach((text, slot) => {
            if(slot === shownSlot){
                return
            }
            const sibling: { position: number, text: string, time?: number, chatId: string } = {
                position,
                text,
                chatId: offsets ? newId() : ids[slot],
            }
            if(shownTime !== undefined){
                sibling.time = offsets ? shownTime + (slot - shownSlot) : shownTime
            }
            siblings.push(sibling)
        })
    })
    for(const built of message){
        if(!built.chatId){
            built.chatId = newId()
        }
    }

    const alt: ChatAlt[] = siblings.map((sibling) => {
        const shown = message[sibling.position]
        const record: Message = { role: shown.role, data: format(sibling.text) }
        if(sibling.time !== undefined){
            record.time = sibling.time
        }
        if(shown.name !== undefined){
            record.name = shown.name
        }
        if(shown.disabled){
            record.disabled = shown.disabled
        }
        record.chatId = sibling.chatId
        return { m: record, p: sibling.position === 0 ? null : message[sibling.position - 1].chatId ?? null, a: 1 }
    })
    return { message, alt }
}

function readHeader(line: Record<string, unknown>): TavernHeader {
    const header: TavernHeader = {}
    if(typeof line.user_name === 'string' && line.user_name !== ''){
        header.userName = line.user_name
    }
    if(typeof line.character_name === 'string' && line.character_name !== ''){
        header.characterName = line.character_name
    }
    return header
}

// Only the first non-blank line can be the header, and a line carrying `mes`
// is a message even when it also has header keys.
function isTavernHeader(line: Record<string, unknown>): boolean {
    if('mes' in line){
        return false
    }
    return tavernHeaderKeys.some((key) => key in line)
}

/**
 * Reads a SillyTavern `.jsonl` chat. Every line whose `mes` is a string, or a
 * Chub object holding a string `message`, becomes a message in file order; a
 * line that cannot be read is counted in `skipped` instead of failing the
 * file. Blank lines and an empty `mes` without a non-empty swipe are ignored
 * without being counted, and a leading header line is dropped uncounted (its
 * names are returned). Every readable non-empty swipe is kept in `swipes` of its
 * line (see `readSwipes` for the slot rule; a lone entry equal to `mes` leaves
 * both lists empty and so no `swipes`), so `swipesNotKept` stays 0.
 */
export function readTavernJsonl(text: string): TavernJsonlResult {
    const messages: TavernLine[] = []
    let skipped = 0
    const swipesNotKept = 0
    let header: TavernHeader | undefined
    let isFirst = true

    const source = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text
    for(const rawLine of source.split('\n')){
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
        if(line.trim() === ''){
            continue
        }
        const wasFirst = isFirst
        isFirst = false

        let parsed: unknown
        try {
            parsed = JSON.parse(line)
        } catch {
            skipped++
            continue
        }
        if(!isPlainObject(parsed)){
            skipped++
            continue
        }
        if(wasFirst && isTavernHeader(parsed)){
            header = readHeader(parsed)
            continue
        }
        const shownReply = readReply(parsed.mes)
        if(shownReply === undefined){
            skipped++
            continue
        }
        const read = readSwipes(shownReply, parsed.swipes, parsed.swipe_id)
        if(read === undefined){
            continue
        }

        const message: TavernLine = { isUser: Boolean(parsed.is_user), mes: read.mes }
        if(read.swipes !== undefined){
            message.swipes = read.swipes
        }
        const sendDate = parseTavernSendDate(parsed.send_date)
        if(sendDate !== undefined){
            message.sendDate = sendDate
        }
        if(typeof parsed.name === 'string' && parsed.name.trim() !== ''){
            message.name = parsed.name.trim()
        }
        if(parsed.is_system === true){
            message.isSystem = true
        }
        messages.push(message)
    }

    const result: TavernJsonlResult = { messages, skipped, swipesNotKept }
    if(header !== undefined){
        result.header = header
    }
    return result
}

export type JsonChatFormat = 'ooba' | 'agnai' | 'kobold' | 'cai-morse' | 'cai-dumper' | 'cai-turns'

const oobaMarker = '<|BEGIN-VISIBLE-CHAT|>'
const oobaTimestampPattern = /^([A-Za-z]+) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2})$/
const htmlEntityPattern = /&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g
const namedEntities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

// The pairs never cross: `internal` with `data_visible` is not a pair, and
// `internal`/`visible` wins over the older `data`/`data_visible`.
function oobaRowSets(value: unknown): { internal: unknown[], visible: unknown[] } | undefined {
    if(!isPlainObject(value)){
        return undefined
    }
    if(Array.isArray(value.internal) && Array.isArray(value.visible)){
        return { internal: value.internal, visible: value.visible }
    }
    if(Array.isArray(value.data) && Array.isArray(value.data_visible)){
        return { internal: value.data, visible: value.data_visible }
    }
    return undefined
}

/**
 * Names the chat format of a parsed `.json` file that is not a Risu export, or
 * `undefined` when it is none of them. A Risu `type` is never reinterpreted.
 * Later formats keep the exclusive-first order: a format with a unique tag or
 * key is tested before one recognised only by row shape (Ooba). Agnai is
 * recognised by shape alone and comes last, so a format with a tag of its own
 * that also has a `messages` array is inserted ahead of it. Kobold Lite is
 * recognised by shape alone as well and comes after both, so a file that
 * carries an Ooba or Agnai shape is never read as Kobold. The Character.AI
 * formats have a tag or key of their own and are tested first, so an object that
 * also carries another format's shape is read as Character.AI. A top-level array
 * is a bare Lianne export when it holds a turn, and nothing otherwise.
 */
export function detectJsonChatFormat(value: unknown): JsonChatFormat | undefined {
    if(Array.isArray(value)){
        return hasCaiTurn(value) ? 'cai-turns' : undefined
    }
    if(!isPlainObject(value) || value.type === 'risuChat' || value.type === 'risuAllChats'){
        return undefined
    }
    if(value.format === 'morse.cai-export' && value.version === 1 && Array.isArray(value.characters)){
        return 'cai-morse'
    }
    if(isPlainObject(value.histories) && Array.isArray(value.histories.histories)){
        return 'cai-dumper'
    }
    if(hasCaiTurn(value.messages)){
        return 'cai-turns'
    }
    if(oobaRowSets(value) !== undefined){
        return 'ooba'
    }
    if(isAgnaiShape(value)){
        return 'agnai'
    }
    if(isKoboldShape(value)){
        return 'kobold'
    }
    return undefined
}

// A non-empty `messages` array with at least one object whose `msg` is a string,
// and no object carrying a `candidates` array (another format's marker).
function isAgnaiShape(value: Record<string, unknown>): boolean {
    const messages = value.messages
    if(!Array.isArray(messages) || messages.length === 0){
        return false
    }
    let hasMessageText = false
    for(const element of messages as unknown[]){
        if(!isPlainObject(element)){
            continue
        }
        if(Array.isArray(element.candidates)){
            return false
        }
        if(typeof element.msg === 'string'){
            hasMessageText = true
        }
    }
    return hasMessageText
}

/**
 * Decodes the HTML entities Ooba stores in its visible text: `&amp; &lt; &gt;
 * &quot; &apos;` and numeric references to a valid, non-surrogate code point.
 * One pass, so `&amp;lt;` becomes `&lt;`; anything else stays literal. No DOM
 * is involved, so the result does not depend on the runtime.
 */
export function unescapeHtmlEntities(text: string): string {
    return text.replace(htmlEntityPattern, (match, body: string) => {
        if(body.charAt(0) !== '#'){
            return namedEntities[body]
        }
        const codePoint = body.charAt(1) === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
        if(codePoint < 1 || codePoint > 0x10FFFF || (codePoint >= 0xD800 && codePoint <= 0xDFFF)){
            return match
        }
        return String.fromCodePoint(codePoint)
    })
}

/**
 * Reads an Ooba message time such as `Oct 24, 2025 01:04` as local time. English
 * month names and a 24-hour clock only; anything else, a calendar-invalid
 * date, or a time outside 1970..9999 gives `undefined`.
 */
export function parseOobaTimestamp(value: unknown): number | undefined {
    if(typeof value !== 'string'){
        return undefined
    }
    const match = oobaTimestampPattern.exec(value.trim())
    if(!match){
        return undefined
    }
    const month = monthNumbers[match[1].toLowerCase()]
    const day = Number(match[2])
    const year = Number(match[3])
    const hour = Number(match[4])
    const minute = Number(match[5])
    if(month === undefined || !isCalendarDate(year, month, day) || !isClockTime(hour, minute, 0)){
        return undefined
    }
    return boundTime(localTime(year, month, day, hour, minute, 0, 0))
}

// The shown text of an Ooba cell and the other `versions` of it, or `undefined`
// when the shown text is empty and no version holds text. `content` holds what
// the stored cell held, so the shown slot is matched against `cell` (the stored
// cell) whatever field `text` reads for display. An empty cell never matches a
// slot while the shown text is not empty. An empty shown text shows the first
// kept version.
function readOobaVersions(
    shown: string,
    cell: string,
    versions: unknown,
    index: unknown,
    text: (version: Record<string, unknown>) => string | undefined,
): { mes: string, swipes?: TavernSwipes } | undefined {
    const list: unknown[] = Array.isArray(versions) ? versions : []
    const contents = list.map((version) => isPlainObject(version) && typeof version.content === 'string' ? version.content : undefined)
    const texts = list.map((version) => isPlainObject(version) ? text(version) : undefined)
    if(shown === ''){
        const first = texts.findIndex(isKeptReply)
        if(first === -1){
            return undefined
        }
        const swipes = splitSwipes(texts, first)
        return swipes === undefined ? { mes: texts[first] as string } : { mes: texts[first] as string, swipes }
    }
    const swipes = splitSwipes(texts, cell === '' ? -1 : shownSlot(cell, contents, index))
    return swipes === undefined ? { mes: shown } : { mes: shown, swipes }
}

// A character version shows its `content` as stored.
function oobaCharacterVersionText(version: Record<string, unknown>): string | undefined {
    return typeof version.content === 'string' ? version.content : undefined
}

// A user version shows like the user cell: its decoded `visible_content`, else its raw `content`.
function oobaUserVersionText(version: Record<string, unknown>): string | undefined {
    if(typeof version.visible_content === 'string' && version.visible_content !== ''){
        return unescapeHtmlEntities(version.visible_content)
    }
    return typeof version.content === 'string' ? version.content : undefined
}

function oobaMetadataEntry(metadata: unknown, key: string): Record<string, unknown> | undefined {
    if(!isPlainObject(metadata)){
        return undefined
    }
    const entry = metadata[key]
    return isPlainObject(entry) ? entry : undefined
}

function oobaSendDate(entry: Record<string, unknown> | undefined): number | undefined {
    return entry === undefined ? undefined : parseOobaTimestamp(entry.timestamp)
}

/**
 * Reads an Ooba chat file row by row. A row holds the user cell then the
 * character cell; the user text is the `visible` cell (entities decoded), or
 * the raw `internal` cell when `visible` has none, and the character text is the
 * `internal` cell as stored. The row whose internal user cell is the start
 * marker gives only its character message. A row that cannot be read is
 * counted in `skipped`; cells beyond the second are ignored. The other
 * `versions` of a row's `user_N` and `assistant_N` metadata entries are the
 * swipes of its message, in version order; `current_version_index` places the
 * shown reply among them (see `readOobaVersions`). A user version shows its
 * decoded `visible_content`, else its raw `content`. The marker row's and an
 * unreadable user cell's versions are ignored, an empty cell shows the first
 * version with text, and `swipesNotKept` stays 0. Message times come from the
 * row-indexed `metadata` entries.
 */
export function readOobaChat(value: unknown): ChatImportResult {
    const result: ChatImportResult = { messages: [], skipped: 0, swipesNotKept: 0 }
    const sets = oobaRowSets(value)
    if(sets === undefined){
        return result
    }
    const metadata: unknown = isPlainObject(value) ? value.metadata : undefined

    for(let index = 0; index < sets.internal.length; index++){
        const row: unknown = sets.internal[index]
        if(!Array.isArray(row) || row.length < 2){
            result.skipped++
            continue
        }
        const internalUser: unknown = row[0]
        const internalCharacter: unknown = row[1]
        const visibleRow: unknown = sets.visible[index]
        const visibleUser: unknown = Array.isArray(visibleRow) ? visibleRow[0] : undefined
        let unreadable = false

        let userText: string | undefined
        if(internalUser === oobaMarker){
            userText = undefined
        }
        else if(typeof visibleUser === 'string' && visibleUser !== ''){
            userText = unescapeHtmlEntities(visibleUser)
        }
        else if(typeof internalUser === 'string'){
            userText = internalUser
        }
        else if(typeof visibleUser !== 'string'){
            unreadable = true
        }
        if(userText !== undefined){
            const entry = oobaMetadataEntry(metadata, `user_${index}`)
            const read = readOobaVersions(userText, typeof internalUser === 'string' ? internalUser : '', entry?.versions, entry?.current_version_index, oobaUserVersionText)
            if(read !== undefined){
                const message: TavernLine = { isUser: true, mes: read.mes }
                if(read.swipes !== undefined){
                    message.swipes = read.swipes
                }
                const sendDate = oobaSendDate(entry)
                if(sendDate !== undefined){
                    message.sendDate = sendDate
                }
                result.messages.push(message)
            }
        }

        if(typeof internalCharacter !== 'string'){
            unreadable = true
        }
        else {
            const entry = oobaMetadataEntry(metadata, `assistant_${index}`)
            const read = readOobaVersions(internalCharacter, internalCharacter, entry?.versions, entry?.current_version_index, oobaCharacterVersionText)
            if(read !== undefined){
                const message: TavernLine = { isUser: false, mes: read.mes }
                if(read.swipes !== undefined){
                    message.swipes = read.swipes
                }
                const sendDate = oobaSendDate(entry)
                if(sendDate !== undefined){
                    message.sendDate = sendDate
                }
                result.messages.push(message)
            }
        }
        if(unreadable){
            result.skipped++
        }
    }
    return result
}

// One plain-object element of an Agnai file. `text` is set only when `msg` is a
// string; a node without it stays in the link map but emits no line.
type AgnaiNode = {
    index: number
    id: string | undefined
    parent: string | undefined
    when: number | undefined
    text: string | undefined
    source: Record<string, unknown>
}

const agnaiOnWalk = 1
const agnaiFinished = 2

function nonEmptyString(value: unknown): string | undefined {
    return typeof value === 'string' && value !== '' ? value : undefined
}

// The speaker is decided by `userId` (or `ooc`), never by `characterId`. A user
// line keeps its name only when it was sent as a character; a character line
// drops the placeholder `'imported'` character.
function agnaiLine(node: AgnaiNode, text: string): TavernLine {
    const source = node.source
    const characterId = nonEmptyString(source.characterId)
    const isUser = source.ooc === true || nonEmptyString(source.userId) !== undefined
    const line: TavernLine = { isUser, mes: text }
    if(node.when !== undefined){
        line.sendDate = node.when
    }
    const name = typeof source.name === 'string' ? source.name.trim() : ''
    const keepsName = isUser ? characterId !== undefined : characterId !== 'imported'
    if(keepsName && name !== ''){
        line.name = name
    }
    return line
}

// The newest-created candidate: by time when every candidate has one, ties and
// all-undated choices going to the greatest file index.
function newestAgnaiNode(candidates: AgnaiNode[]): AgnaiNode | undefined {
    const allDated = candidates.every((candidate) => candidate.when !== undefined)
    let newest: AgnaiNode | undefined
    for(const candidate of candidates){
        if(newest === undefined){
            newest = candidate
            continue
        }
        const candidateWhen = candidate.when ?? 0
        const newestWhen = newest.when ?? 0
        const isNewer = allDated
            ? candidateWhen > newestWhen || (candidateWhen === newestWhen && candidate.index > newest.index)
            : candidate.index > newest.index
        if(isNewer){
            newest = candidate
        }
    }
    return newest
}

/**
 * Reads an Agnai chat export. Each message is a node linked to its parent by
 * `_id`/`parent`; export eras without resolvable links (no ids, or parents that
 * are text prefixes) import every message in file order. A branched file
 * imports the path from the newest-created tip back to its root. An importable
 * message off the path that shares a path message's parent and speaker is a
 * swipe of that message, in file order. `swipesNotKept` is the number of other
 * importable messages off the path (descendants of a swipe, other speakers,
 * orphan subtrees). A repeated `_id` or a parent loop gives file order with
 * nothing counted. `treeLeafId` is never read. An element whose
 * `msg` is not a string is counted in `skipped` but stays a link, so its
 * children stay attached; an empty `msg` emits no line and is uncounted. Every
 * pass is iterative and linear in the number of messages.
 */
export function readAgnaiChat(value: unknown): ChatImportResult {
    const result: ChatImportResult = { messages: [], skipped: 0, swipesNotKept: 0 }
    if(!isPlainObject(value) || !Array.isArray(value.messages)){
        return result
    }
    const elements: unknown[] = value.messages

    const nodes: AgnaiNode[] = []
    for(let index = 0; index < elements.length; index++){
        const element = elements[index]
        if(!isPlainObject(element)){
            result.skipped++
            continue
        }
        if(typeof element.msg !== 'string'){
            result.skipped++
        }
        nodes.push({
            index,
            id: nonEmptyString(element._id),
            parent: nonEmptyString(element.parent),
            when: parseTavernSendDate(element.createdAt),
            text: typeof element.msg === 'string' ? element.msg : undefined,
            source: element,
        })
    }

    const emit = (list: AgnaiNode[]) => {
        for(const node of list){
            if(node.text !== undefined && node.text !== ''){
                result.messages.push(agnaiLine(node, node.text))
            }
        }
        return result
    }

    const byId = new Map<string, AgnaiNode>()
    for(const node of nodes){
        if(node.id === undefined){
            continue
        }
        if(byId.has(node.id)){
            return emit(nodes)
        }
        byId.set(node.id, node)
    }

    const up = new Map<AgnaiNode, AgnaiNode>()
    const childCount = new Map<AgnaiNode, number>()
    for(const node of nodes){
        const parent = node.parent === undefined ? undefined : byId.get(node.parent)
        if(parent !== undefined){
            up.set(node, parent)
            childCount.set(parent, (childCount.get(parent) ?? 0) + 1)
        }
    }
    if(up.size === 0){
        return emit(nodes)
    }

    // Colour walk: a walk that ends on a node of its own walk is a loop. Every
    // node is coloured once, so the check is linear whatever the depth.
    const colour = new Map<AgnaiNode, number>()
    for(const start of nodes){
        if(colour.has(start)){
            continue
        }
        const walk: AgnaiNode[] = []
        let current: AgnaiNode | undefined = start
        while(current !== undefined && !colour.has(current)){
            colour.set(current, agnaiOnWalk)
            walk.push(current)
            current = up.get(current)
        }
        if(current !== undefined && colour.get(current) === agnaiOnWalk){
            return emit(nodes)
        }
        for(const visited of walk){
            colour.set(visited, agnaiFinished)
        }
    }

    const tip = newestAgnaiNode(nodes.filter((node) => !childCount.has(node)))
    if(tip === undefined){
        return emit(nodes)
    }
    // Bounded by the node count, so a loop the check above missed ends as file order.
    const path: AgnaiNode[] = []
    for(let current: AgnaiNode | undefined = tip; current !== undefined; current = up.get(current)){
        if(path.length >= nodes.length){
            return emit(nodes)
        }
        path.push(current)
    }
    path.reverse()

    const importable = (node: AgnaiNode): node is AgnaiNode & { text: string } => node.text !== undefined && node.text !== ''
    const onPath = new Set<AgnaiNode>(path)
    const next = new Map<AgnaiNode, AgnaiNode>()
    for(let position = 0; position + 1 < path.length; position++){
        next.set(path[position], path[position + 1])
    }
    // An off-path message whose parent is on the path and whose speaker is the
    // path child's is a swipe of that child, in file order. Everything else
    // off the path (descendants of a swipe, other components, another speaker,
    // a path child with no line) stays counted.
    const siblings = new Map<AgnaiNode, Array<{ index: number, text: string }>>()
    for(const node of nodes){
        if(onPath.has(node) || !importable(node)){
            continue
        }
        const parent = up.get(node)
        const child = parent === undefined ? undefined : next.get(parent)
        if(child !== undefined && importable(child) && sameSpeaker(agnaiLine(node, node.text), agnaiLine(child, child.text))){
            const kept = siblings.get(child)
            if(kept === undefined){
                siblings.set(child, [{ index: node.index, text: node.text }])
            }
            else {
                kept.push({ index: node.index, text: node.text })
            }
        }
        else {
            result.swipesNotKept++
        }
    }
    for(const node of path){
        if(!importable(node)){
            continue
        }
        const line = agnaiLine(node, node.text)
        const kept = siblings.get(node)
        if(kept !== undefined){
            line.swipes = {
                before: kept.filter((sibling) => sibling.index < node.index).map((sibling) => sibling.text),
                after: kept.filter((sibling) => sibling.index > node.index).map((sibling) => sibling.text),
            }
        }
        result.messages.push(line)
    }
    return result
}

export type KoboldChatResult = ChatImportResult & {
    /** Set when the save cannot be imported as a chat; `messages` is then empty. */
    refusal?: 'story' | 'settings'
}

type KoboldShape = Record<string, unknown> & { actions: unknown[] }

type KoboldMode = 1 | 2 | 3 | 4

/** What Kobold Lite holds in its settings once its loader has run (the tags are not yet newline-expanded). */
export type KoboldSettings = {
    /** 1 story, 2 adventure, 3 chat, 4 instruct. */
    mode: KoboldMode
    userName: string
    /** Declared opponent names, the first being the character's own; empty when the save declares none. */
    opponents: string[]
    startTag: string
    endTag: string
    systemTag: string
    startEndTag: string
    endEndTag: string
    systemEndTag: string
}

const koboldDefaultUser = 'User'
const koboldDefaultOpponent = 'KoboldAI'
const koboldParticipantSeparator = '||$||'
// Names beyond this are ignored, which bounds the colon scan of every line.
const koboldMaxNameLength = 100
// A speaker that opens an element is printed `\nName: ` by Lite's writer.
const koboldOpeningNamePattern = /^\n([^\n:]{1,40}): /
const koboldMediaOpenerPattern = /<\|([hpd])\|/g

const koboldPlaceholders = {
    user: '\n{{[INPUT]}}\n',
    character: '\n{{[OUTPUT]}}\n',
    system: '\n{{[SYSTEM]}}\n',
    ends: ['\n{{[INPUT_END]}}\n', '\n{{[OUTPUT_END]}}\n', '\n{{[SYSTEM_END]}}\n'],
}

// A story save is any object with an `actions` array and a string `prompt` or a
// `savedsettings` object. Whether it can be read as a chat is decided by the reader.
function isKoboldShape(value: Record<string, unknown>): value is KoboldShape {
    return Array.isArray(value.actions) && (typeof value.prompt === 'string' || isPlainObject(value.savedsettings))
}

function koboldMode(value: unknown): KoboldMode | undefined {
    let mode: number
    if(typeof value === 'number'){
        mode = value
    }
    else if(typeof value === 'string' && value.trim() !== ''){
        mode = Number(value)
    }
    else {
        return undefined
    }
    return mode === 1 || mode === 2 || mode === 3 || mode === 4 ? mode : undefined
}

// Lite's check for the legacy flag is a loose comparison with true.
function isLooselyTrue(value: unknown): boolean {
    return value === true || value === 1 || value === '1'
}

function koboldText(raw: Record<string, unknown>, key: string, fallback: string): string {
    const value = raw[key]
    return typeof value === 'string' ? value : fallback
}

function sanitizeKoboldName(name: string): string {
    return name.replace(/\s+/g, ' ').trim()
}

// A `||$||` list is split with empty entries dropped and each entry sanitised;
// a single name is used as stored. Blank names declare nobody, and only an absent
// or non-string key means Lite's default opponent.
function koboldOpponents(value: unknown): string[] {
    if(typeof value !== 'string'){
        return [koboldDefaultOpponent]
    }
    if(value.includes(koboldParticipantSeparator)){
        return value.split(koboldParticipantSeparator).filter((entry) => entry !== '').map(sanitizeKoboldName).filter((entry) => entry !== '')
    }
    const single = value.split('\n').join('')
    return single.trim() === '' ? [] : [single]
}

// Lite wraps a tag in a literal backslash-n on both sides unless it already holds one.
function wrapKoboldTag(tag: string): string {
    return tag.includes('\\n') ? tag : '\\n' + tag + '\\n'
}

/**
 * Turns a save's `savedsettings` into the settings Lite holds after loading it,
 * or `undefined` when the block is not an object or its `opmode` is not 1 to 4.
 * An absent key takes Lite's default. When `instruct_has_newlines` is loosely
 * true, or the save carries neither it nor `instruct_has_markdown`, the loader
 * wraps the start and end tags in newlines; the system tag and the three end
 * tags are never wrapped. The splitters read only this result.
 */
export function loadKoboldSettings(raw: unknown): KoboldSettings | undefined {
    if(!isPlainObject(raw)){
        return undefined
    }
    const mode = koboldMode(raw.opmode)
    if(mode === undefined){
        return undefined
    }
    const newlines = raw.instruct_has_newlines
    const markdown = raw.instruct_has_markdown
    const legacy = isLooselyTrue(newlines) || ((newlines === undefined || newlines === null) && (markdown === undefined || markdown === null))
    const startTag = koboldText(raw, 'instruct_starttag', '{{[INPUT]}}')
    const endTag = koboldText(raw, 'instruct_endtag', '{{[OUTPUT]}}')
    const name = raw.chatname
    return {
        mode,
        userName: typeof name === 'string' && name !== '' ? name : koboldDefaultUser,
        opponents: koboldOpponents(raw.chatopponent),
        startTag: legacy ? wrapKoboldTag(startTag) : startTag,
        endTag: legacy ? wrapKoboldTag(endTag) : endTag,
        systemTag: koboldText(raw, 'instruct_systag', '{{[SYSTEM]}}'),
        startEndTag: koboldText(raw, 'instruct_starttag_end', ''),
        endEndTag: koboldText(raw, 'instruct_endtag_end', ''),
        systemEndTag: koboldText(raw, 'instruct_systag_end', ''),
    }
}

type KoboldRole = 'user' | 'character' | 'system' | 'end'

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Every token that marks a role: the newline-bounded placeholder Lite's writer
// stores in non-raw mode and the configured tag with its literal backslash-n
// expanded. A blank tag marks nothing. The longest token wins at one position.
function koboldMarkers(settings: KoboldSettings): Array<[string, KoboldRole]> {
    const tag = (value: string) => {
        const text = value.split('\\n').join('\n')
        return text.trim() === '' ? '' : text
    }
    const groups: Array<[KoboldRole, string[]]> = [
        ['user', [koboldPlaceholders.user, tag(settings.startTag)]],
        ['character', [koboldPlaceholders.character, tag(settings.endTag)]],
        ['system', [koboldPlaceholders.system, tag(settings.systemTag)]],
        ['end', [...koboldPlaceholders.ends, tag(settings.startEndTag), tag(settings.endEndTag), tag(settings.systemEndTag)]],
    ]
    const roles = new Map<string, KoboldRole>()
    for(const [role, tokens] of groups){
        for(const token of tokens){
            if(token !== '' && !roles.has(token)){
                roles.set(token, role)
            }
        }
    }
    return [...roles].sort((a, b) => b[0].length - a[0].length)
}

function splitKoboldInstruct(text: string, settings: KoboldSettings): TavernLine[] {
    const markers = koboldMarkers(settings)
    const endTokens = markers.filter(([, role]) => role === 'end').map(([token]) => token)
    const body = endTokens.length === 0 ? text : text.replace(new RegExp(endTokens.map(escapeRegExp).join('|'), 'g'), '')
    const live = markers.filter(([, role]) => role !== 'end')
    const lines: TavernLine[] = []
    const push = (role: KoboldRole | undefined, segment: string) => {
        const mes = segment.trim()
        if(mes === ''){
            return
        }
        if(role === 'system'){
            lines.push({ isUser: false, mes, isSystem: true })
        }
        else {
            lines.push({ isUser: role === 'user', mes })
        }
    }
    if(live.length === 0){
        push(undefined, body)
        return lines
    }
    const pattern = new RegExp(live.map(([token]) => escapeRegExp(token)).join('|'), 'g')
    const roles = new Map(live)
    let role: KoboldRole | undefined
    let start = 0
    for(let match = pattern.exec(body); match !== null; match = pattern.exec(body)){
        push(role, body.slice(start, match.index))
        role = roles.get(match[0])
        start = match.index + match[0].length
    }
    push(role, body.slice(start))
    return lines
}

// A line starts a turn when the text before one of its first colons is exactly a
// known name and a space follows; the longest such name wins. Text before the
// first turn is the first character message.
function splitKoboldChat(text: string, settings: KoboldSettings, openingNames: string[]): TavernLine[] {
    const names = new Set([settings.userName, ...settings.opponents, ...openingNames].filter((name) => name.length <= koboldMaxNameLength))
    const lines: TavernLine[] = []
    const lead: string[] = []
    let current: { name: string, body: string[] } | undefined
    const close = () => {
        if(current === undefined){
            return
        }
        const mes = current.body.join('\n').trim()
        if(mes !== ''){
            const line: TavernLine = { isUser: current.name === settings.userName, mes }
            const name = current.name.trim()
            if(name !== ''){
                line.name = name
            }
            lines.push(line)
        }
    }
    for(const row of text.split('\n')){
        let hit = -1
        const limit = Math.min(row.length, koboldMaxNameLength + 1)
        for(let colon = row.indexOf(':'); colon !== -1 && colon <= limit; colon = row.indexOf(':', colon + 1)){
            if(row.charAt(colon + 1) === ' ' && names.has(row.slice(0, colon))){
                hit = colon
            }
        }
        if(hit !== -1){
            close()
            current = { name: row.slice(0, hit), body: [row.slice(hit + 2)] }
        }
        else if(current !== undefined){
            current.body.push(row)
        }
        else {
            lead.push(row)
        }
    }
    close()
    const leadText = lead.join('\n').trim()
    if(leadText !== ''){
        lines.unshift({ isUser: false, mes: leadText })
    }
    return lines
}

// Removes picture and audio tokens (`<|h|..|h|>`, `<|d|..|d|>` and the pending
// `<|p|..|p|>`, with their brackets when both are present) that close on the same
// line with the same letter. h and d tokens are counted, a pending one is not.
// Every cached search position only moves forward, so the scan is linear.
function stripKoboldMedia(text: string): { text: string, counted: number } {
    const closers: Record<string, number> = { h: -2, p: -2, d: -2 }
    const opener = new RegExp(koboldMediaOpenerPattern.source, 'g')
    let newline = -2
    let out = ''
    let last = 0
    let counted = 0
    for(let match = opener.exec(text); match !== null; match = opener.exec(text)){
        const letter = match[1]
        const closer = `|${letter}|>`
        const from = match.index + match[0].length
        let at = closers[letter]
        if(at === -2 || (at !== -1 && at < from + 1)){
            at = text.indexOf(closer, from + 1)
            closers[letter] = at
        }
        if(at === -1){
            continue
        }
        if(newline === -2 || (newline !== -1 && newline < from)){
            newline = text.indexOf('\n', from)
        }
        if(newline !== -1 && at > newline){
            continue
        }
        let start = match.index
        let end = at + closer.length
        if(start - 1 >= last && text.charAt(start - 1) === '[' && text.charAt(end) === ']'){
            start--
            end++
        }
        out += text.slice(last, start)
        last = end
        opener.lastIndex = end
        if(letter !== 'p'){
            counted++
        }
    }
    return { text: out + text.slice(last), counted }
}

// The story is the prompt followed by every string action, joined without a separator.
function readKoboldStory(elements: string[], settings: KoboldSettings): { messages: TavernLine[], counted: number } {
    const stripped = stripKoboldMedia(elements.join(''))
    if(settings.mode === 4){
        return { messages: splitKoboldInstruct(stripped.text, settings), counted: stripped.counted }
    }
    const openingNames: string[] = []
    for(const element of elements){
        const opening = koboldOpeningNamePattern.exec(element)
        if(opening !== null){
            openingNames.push(opening[1])
        }
    }
    return { messages: splitKoboldChat(stripped.text, settings, openingNames), counted: stripped.counted }
}

function sameKoboldLine(a: TavernLine, b: TavernLine): boolean {
    return a.isUser === b.isUser && a.mes === b.mes && Boolean(a.isSystem) === Boolean(b.isSystem)
}

/**
 * Reads a Kobold Lite story save as a chat. The mode comes only from
 * `savedsettings.opmode`: 3 is chat, 4 is instruct, and a save in story or
 * adventure mode, an empty save, or one without a usable settings block is
 * refused with `refusal` set. Splitting compares exactly what Lite's writer
 * stores, using the settings after `loadKoboldSettings`. Non-string actions are
 * counted in `skipped`; picture and audio tokens are removed and counted in
 * `mediaNotKept`. A branch in `altbranches` that is not an older snapshot of the
 * shown story keeps its first message after the common message prefix as a
 * swipe of the shown message at that position (when it is from the same
 * speaker, once per distinct text) and counts its later messages in
 * `swipesNotKept`; a branch that only extends the shown story counts them all.
 * Pictures inside a kept head are not counted. Memory, author's note and world
 * info are not read.
 */
export function readKoboldChat(value: unknown): KoboldChatResult {
    const result: KoboldChatResult = { messages: [], skipped: 0, swipesNotKept: 0 }
    if(!isPlainObject(value) || !isKoboldShape(value)){
        return result
    }
    const elements: string[] = []
    if(typeof value.prompt === 'string'){
        elements.push(value.prompt)
    }
    for(const action of value.actions){
        if(typeof action === 'string'){
            elements.push(action)
        }
        else {
            result.skipped++
        }
    }
    if(elements.every((element) => element.trim() === '')){
        result.refusal = 'story'
        return result
    }
    const settings = loadKoboldSettings(value.savedsettings)
    if(settings === undefined){
        result.refusal = 'settings'
        return result
    }
    if(settings.mode === 1 || settings.mode === 2){
        result.refusal = 'story'
        return result
    }

    const shown = readKoboldStory(elements, settings)
    result.messages = shown.messages
    if(shown.counted > 0){
        result.mediaNotKept = shown.counted
    }
    if(settings.mode === 3){
        result.header = { userName: settings.userName }
        if(settings.opponents.length > 0){
            result.header.characterName = settings.opponents[0]
        }
    }

    if(Array.isArray(value.altbranches)){
        const branches = value.altbranches as unknown[]
        // Lite stores the shown branch as `null` and lists the others in array
        // order, so earlier branches go before the shown reply and later ones after.
        const shownBranch = branches.indexOf(null)
        const positions = new Map<number, { before: string[], after: string[], seen: Set<string> }>()
        for(let branchIndex = 0; branchIndex < branches.length; branchIndex++){
            const branch = branches[branchIndex]
            if(!Array.isArray(branch)){
                continue
            }
            const strings = (branch as unknown[]).filter((element): element is string => typeof element === 'string')
            if(strings.every((element) => element === '')){
                continue
            }
            if(strings.length <= elements.length && strings.every((element, index) => element === elements[index])){
                continue
            }
            const other = readKoboldStory(strings.filter((element) => element !== ''), settings).messages
            let common = 0
            while(common < other.length && common < shown.messages.length && sameKoboldLine(other[common], shown.messages[common])){
                common++
            }
            let rest = other.length - common
            const head = other[common]
            if(head !== undefined && common < shown.messages.length && sameSpeaker(head, shown.messages[common])){
                let position = positions.get(common)
                if(position === undefined){
                    position = { before: [], after: [], seen: new Set<string>() }
                    positions.set(common, position)
                }
                if(!position.seen.has(head.mes)){
                    position.seen.add(head.mes)
                    const side = shownBranch !== -1 && branchIndex < shownBranch ? position.before : position.after
                    side.push(head.mes)
                }
                rest--
            }
            result.swipesNotKept += rest
        }
        for(const [position, lists] of positions){
            shown.messages[position].swipes = { before: lists.before, after: lists.after }
        }
    }
    return result
}

const caiRedactionToken = '[NAME_IN_MESSAGE_REDACTED]'

// A turn holds a candidate with a string `raw_content`: the shape both neo
// exporters (Lianne, Morse) store for every message.
function isCaiTurn(value: unknown): boolean {
    return isPlainObject(value) && Array.isArray(value.candidates)
        && value.candidates.some((candidate) => isPlainObject(candidate) && typeof candidate.raw_content === 'string')
}

function hasCaiTurn(value: unknown): boolean {
    return Array.isArray(value) && value.some(isCaiTurn)
}

function trimmedName(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

type CaiTurnRead = {
    line?: TavernLine
    skipped: boolean
    /** Kept candidates that carry a picture, which the import does not keep. */
    media: number
}

// The shown reply is the candidate named by `primary_candidate_id`; the other
// candidates that are not blank are its swipes, in array order, for character
// and human turns alike. A blank shown candidate is replaced by the first
// non-blank one. Only the boolean `true` makes a user line; a human turn's
// author name is never read.
function readCaiTurn(turn: unknown): CaiTurnRead {
    if(!isPlainObject(turn) || !Array.isArray(turn.candidates)){
        return { skipped: true, media: 0 }
    }
    const candidates: unknown[] = turn.candidates
    const shownIndex = turn.primary_candidate_id === undefined ? -1 : candidates.findIndex(
        (candidate) => isPlainObject(candidate) && candidate.candidate_id === turn.primary_candidate_id
    )
    const shown = shownIndex === -1 ? undefined : candidates[shownIndex]
    if(!isPlainObject(shown) || typeof shown.raw_content !== 'string'){
        return { skipped: true, media: 0 }
    }
    const texts = candidates.map((candidate) =>
        isPlainObject(candidate) && typeof candidate.raw_content === 'string' && candidate.raw_content.trim() !== '' ? candidate.raw_content : undefined)
    const read = keepSwipes(texts[shownIndex] ?? '', texts, shownIndex)
    if(read === undefined){
        return { skipped: false, media: 0 }
    }
    const media = candidates.filter((candidate, index) =>
        texts[index] !== undefined && isPlainObject(candidate) && trimmedName(candidate.tti_image_rel_path) !== undefined).length
    const author = isPlainObject(turn.author) ? turn.author : undefined
    const isUser = author?.is_human === true
    const line: TavernLine = { isUser, mes: read.mes }
    if(read.swipes !== undefined){
        line.swipes = read.swipes
    }
    const sendDate = parseTavernSendDate(turn.create_time)
    if(sendDate !== undefined){
        line.sendDate = sendDate
    }
    const name = isUser ? undefined : trimmedName(author?.name)
    if(name !== undefined){
        line.name = name
    }
    return { line, skipped: false, media }
}

// `dedupe` skips a turn whose `turn_key.turn_id` was already read (the first
// copy in reading order is kept); a turn without an id is never skipped.
function readCaiTurns(turns: unknown[], newestFirst: boolean, dedupe: boolean): ChatImportResult {
    const result: ChatImportResult = { messages: [], skipped: 0, swipesNotKept: 0 }
    const seen = new Set<string>()
    let media = 0
    for(let index = 0; index < turns.length; index++){
        const turn = turns[newestFirst ? turns.length - 1 - index : index]
        if(dedupe && isPlainObject(turn) && isPlainObject(turn.turn_key)){
            const id = turn.turn_key.turn_id
            if(typeof id === 'string' && id !== ''){
                if(seen.has(id)){
                    continue
                }
                seen.add(id)
            }
        }
        const read = readCaiTurn(turn)
        if(read.skipped){
            result.skipped++
        }
        media += read.media
        if(read.line !== undefined){
            result.messages.push(read.line)
        }
    }
    if(media > 0){
        result.mediaNotKept = media
    }
    return result
}

/**
 * Reads a Lianne export (`cai_export`): `{ messages }` or the bare list of raw
 * turns, both newest first. The chat has no character name of its own, so the
 * header names the first character line's author and the chat's own two names
 * drop from the lines. Repeated turn ids are read once.
 */
export function readCaiTurnsChat(value: unknown): ChatImportResult {
    const turns: unknown[] = Array.isArray(value) ? value : isPlainObject(value) && Array.isArray(value.messages) ? value.messages : []
    const result = readCaiTurns(turns, true, true)
    const characterName = result.messages.find((line) => !line.isUser && line.name !== undefined)?.name
    if(characterName !== undefined){
        result.header = { characterName }
    }
    return result
}

/**
 * The chats of a file that may hold several. `total` and `leftOut` count only
 * chats with at least one importable message, so empty chats never turn a
 * one-chat file into a multi-chat file. `memoryNotKept` counts the returned
 * chats that had a memory box, which is not imported.
 */
export type CaiChatsResult = {
    chats: ChatImportResult[]
    total: number
    leftOut: number
    /** Distinct character names among the counted chats, in file order. */
    names: string[]
    memoryNotKept: number
}

type CaiFoundChat = { name: string | undefined, result: ChatImportResult, hasMemory: boolean }

// One chat in all is imported whatever its character is called. Several chats
// are matched to the open character by name, trimmed and case-sensitive; a chat
// with no readable name never matches.
function pickCaiChats(found: CaiFoundChat[], openName: string): CaiChatsResult {
    const importable = found.filter((chat) => chat.result.messages.length > 0)
    const open = openName.trim()
    const picked = importable.length <= 1 ? importable : importable.filter((chat) => chat.name !== undefined && chat.name === open)
    const names = new Set<string>()
    for(const chat of importable){
        if(chat.name !== undefined){
            names.add(chat.name)
        }
    }
    return {
        chats: picked.map((chat) => chat.result),
        total: importable.length,
        leftOut: importable.length - picked.length,
        names: [...names],
        memoryNotKept: picked.filter((chat) => chat.hasMemory).length,
    }
}

/**
 * Reads a Morse export (`morse.cai-export`, version 1), turns oldest first. An
 * entry's character name is `name`, else `participant__name`. Personas, user,
 * avatar and the memory box are not imported.
 */
export function readMorseChats(value: unknown, openName: string): CaiChatsResult {
    const found: CaiFoundChat[] = []
    if(isPlainObject(value) && Array.isArray(value.characters)){
        for(const entry of value.characters as unknown[]){
            if(!isPlainObject(entry) || !Array.isArray(entry.chats)){
                continue
            }
            const character = isPlainObject(entry.character) ? entry.character : undefined
            const name = trimmedName(character?.name) ?? trimmedName(character?.participant__name)
            for(const chat of entry.chats as unknown[]){
                if(!isPlainObject(chat) || !Array.isArray(chat.turns)){
                    continue
                }
                const result = readCaiTurns(chat.turns, false, false)
                if(name !== undefined){
                    result.header = { characterName: name }
                }
                found.push({ name, result, hasMemory: trimmedName(chat.memory) !== undefined })
            }
        }
    }
    return pickCaiChats(found, openName)
}

// A message built from a dumper entry: the redaction token becomes the user
// placeholder and a human message carries no name.
function dumperLine(text: string, src: unknown): TavernLine {
    const source = isPlainObject(src) ? src : undefined
    const isUser = source?.is_human === true
    const line: TavernLine = { isUser, mes: text.split(caiRedactionToken).join('{{user}}') }
    const name = isUser ? undefined : trimmedName(source?.name)
    if(name !== undefined){
        line.name = name
    }
    return line
}

// An alternate (`is_alternative`) is a swipe of the message just before it
// when it is from the same side (one history belongs to one character, so the
// source name is not compared); a blank message with such an alternate takes
// the first one as its text. An alternate with no message before it (a
// non-object entry ends the run), or from the other side, is not kept, and a
// run of them counts once. Blank alternates are dropped silently. Message text
// is kept in stored order.
function readDumperHistory(msgs: unknown[]): ChatImportResult {
    const result: ChatImportResult = { messages: [], skipped: 0, swipesNotKept: 0 }
    let owner: { isUser: boolean, line: TavernLine | undefined } | undefined
    let runCounted = false
    for(const msg of msgs){
        if(!isPlainObject(msg) || typeof msg.text !== 'string'){
            result.skipped++
            owner = undefined
            runCounted = false
            continue
        }
        const alt = msg.is_alternative === true
        if(alt && msg.text.trim() === ''){
            continue
        }
        const line = msg.text.trim() === '' ? undefined : dumperLine(msg.text, msg.src)
        if(!alt){
            runCounted = false
            owner = { isUser: isPlainObject(msg.src) && msg.src.is_human === true, line }
            if(line !== undefined){
                result.messages.push(line)
            }
            continue
        }
        const swipe = dumperLine(msg.text, msg.src)
        if(owner === undefined || owner.isUser !== swipe.isUser){
            if(!runCounted){
                result.swipesNotKept++
                runCounted = true
            }
        }
        else if(owner.line === undefined){
            owner.line = swipe
            result.messages.push(swipe)
        }
        else {
            if(owner.line.swipes === undefined){
                owner.line.swipes = { before: [], after: [] }
            }
            owner.line.swipes.after.push(swipe.mes)
        }
    }
    return result
}

/**
 * Reads a characterai-dumper file, `{ info, histories: { histories } }`. Every
 * history belongs to the character `info.character.name`, so several histories
 * are imported together or refused together. The writer's redaction token for
 * the user's name becomes `{{user}}`, which the import renders as the current
 * persona name. The stored message order is kept.
 */
export function readDumperChats(value: unknown, openName: string): CaiChatsResult {
    const found: CaiFoundChat[] = []
    if(isPlainObject(value) && isPlainObject(value.histories) && Array.isArray(value.histories.histories)){
        const info = isPlainObject(value.info) && isPlainObject(value.info.character) ? trimmedName(value.info.character.name) : undefined
        for(const history of value.histories.histories as unknown[]){
            if(!isPlainObject(history)){
                continue
            }
            const result = readDumperHistory(Array.isArray(history.msgs) ? history.msgs : [])
            if(info !== undefined){
                result.header = { characterName: info }
            }
            found.push({ name: info, result, hasMemory: false })
        }
    }
    return pickCaiChats(found, openName)
}
