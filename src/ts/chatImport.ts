export type TavernLine = {
    isUser: boolean
    mes: string
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

export type TavernJsonlResult = {
    messages: TavernLine[]
    skipped: number
    /** Lines whose swipes other than the shown reply were not kept. */
    swipesNotKept: number
    header?: TavernHeader
}

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

/**
 * True when `swipes` holds more than one entry and at least one of them is a
 * non-empty reply, i.e. a reply exists besides an empty shown one.
 */
export function hasOtherReplies(swipes: unknown): boolean {
    if(!Array.isArray(swipes) || swipes.length < 2){
        return false
    }
    return swipes.some((swipe) => {
        const reply = readReply(swipe)
        return reply !== undefined && reply !== ''
    })
}

/** The chat name for an imported `.jsonl` file: its name without the extension. */
export function chatNameFromFile(fileName: string): string {
    const name = fileName.replace(/\.jsonl$/i, '').trim()
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
 * file. Blank lines and an empty `mes` are ignored without being counted, and
 * a leading header line is dropped uncounted (its names are returned). Only
 * the shown reply is read: `swipesNotKept` counts the lines whose other
 * swipes are therefore lost.
 */
export function readTavernJsonl(text: string): TavernJsonlResult {
    const messages: TavernLine[] = []
    let skipped = 0
    let swipesNotKept = 0
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
        const mes = readReply(parsed.mes)
        if(mes === undefined){
            skipped++
            continue
        }
        if(mes === ''){
            if(hasOtherReplies(parsed.swipes)){
                swipesNotKept++
            }
            continue
        }
        if(Array.isArray(parsed.swipes) && parsed.swipes.length > 1){
            swipesNotKept++
        }

        const message: TavernLine = { isUser: Boolean(parsed.is_user), mes }
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
