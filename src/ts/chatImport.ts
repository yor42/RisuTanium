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

export type ChatImportResult = {
    messages: TavernLine[]
    skipped: number
    /** Messages whose swipes other than the shown reply were not kept. */
    swipesNotKept: number
    header?: TavernHeader
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

export type JsonChatFormat = 'ooba' | 'agnai'

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
 * that also has a `messages` array is inserted ahead of it.
 */
export function detectJsonChatFormat(value: unknown): JsonChatFormat | undefined {
    if(!isPlainObject(value) || value.type === 'risuChat' || value.type === 'risuAllChats'){
        return undefined
    }
    if(oobaRowSets(value) !== undefined){
        return 'ooba'
    }
    if(isAgnaiShape(value)){
        return 'agnai'
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

// True when `versions` holds more than one entry and at least one has non-empty
// text, i.e. a reply exists besides an empty shown one.
function hasOtherOobaVersions(versions: unknown): boolean {
    if(!Array.isArray(versions) || versions.length < 2){
        return false
    }
    return versions.some((version) => isPlainObject(version) && typeof version.content === 'string' && version.content !== '')
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
 * counted in `skipped`; cells beyond the second are ignored. Only the shown
 * reply is read: `swipesNotKept` counts the rows whose other versions are
 * therefore lost. Message times come from the row-indexed `metadata` entries.
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
        if(userText !== undefined && userText !== ''){
            const message: TavernLine = { isUser: true, mes: userText }
            const sendDate = oobaSendDate(oobaMetadataEntry(metadata, `user_${index}`))
            if(sendDate !== undefined){
                message.sendDate = sendDate
            }
            result.messages.push(message)
        }

        if(typeof internalCharacter !== 'string'){
            unreadable = true
        }
        else {
            const entry = oobaMetadataEntry(metadata, `assistant_${index}`)
            const versions: unknown = entry?.versions
            if(internalCharacter !== ''){
                const message: TavernLine = { isUser: false, mes: internalCharacter }
                const sendDate = oobaSendDate(entry)
                if(sendDate !== undefined){
                    message.sendDate = sendDate
                }
                result.messages.push(message)
                if(Array.isArray(versions) && versions.length > 1){
                    result.swipesNotKept++
                }
            }
            else if(hasOtherOobaVersions(versions)){
                result.swipesNotKept++
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
 * imports the path from the newest-created tip back to its root, and
 * `swipesNotKept` is the number of importable messages off that path (other
 * branches and orphan subtrees). A repeated `_id` or a parent loop gives file
 * order with nothing counted. `treeLeafId` is never read. An element whose
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

    const onPath = new Set<AgnaiNode>(path)
    for(const node of nodes){
        if(!onPath.has(node) && node.text !== undefined && node.text !== ''){
            result.swipesNotKept++
        }
    }
    return emit(path)
}
