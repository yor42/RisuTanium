// CBS problem checker: a second reading of the text with the same frame discipline as the engine's
// `risuChatParser` scan, reporting only what the text alone settles.
//
// Invariants:
// - The scan mirrors the engine's `{`, `#` and `}` cases on the text after the role-tag pre-pass: a
//   `}}` closes only a top frame opened by `{{` or `{#`; any other `}}` is text. Pairing never reads
//   the pure state, so it is the same at the root and inside every block body.
// - Wherever the engine's next structural step depends on a value (a frame whose head is partly a
//   nested value, a head left as text in a body that is only maybe pure, an evaluated `return`, an
//   `#each` whose array is not literal or whose expansion is too large, the engine's frame-depth
//   limit) the scan stops with one `not-static` info line. Problems before the stop stay; none after
//   it is reported.
// - A literal-array `#each` is simulated the way the engine does it: the body, as the pure first pass
//   leaves it, is expanded once per element and spliced after the closer, and the scan carries on
//   over it at the parent level. The expansion is bounded before it is built.
// - Offsets in problems are original offsets: the pre-pass changes `<user>`, `<char>` and `<bot>`
//   into `{{...}}`, and every position goes back through an offset map. Text that came from an
//   expansion has no original offset; its problems point at the outermost `#each` closer instead.
// - The advisory kinds (unknown macro, text that is no block, an `:else` its block does not read, a
//   slot outside a slot field, deprecated syntax) are reported only where the text alone settles
//   them: never inside a pure body, whose macros the engine does not run, and never for a slot whose
//   loop variable a value decides (the scan stops there instead).
// - Pure function of its arguments; no engine import and no global state.
import { classifyBlockStart, elseCapable, purity, registryNameFor, type EngineBlockType } from './cbsBlocks'
import {
    EACH_CHAR_BUDGET,
    EACH_MAX_ELEMENTS,
    eachBodyOutput,
    eachLoopVar,
    expandEach,
    expansionBound,
    legacyFrameOutput,
    parseEachHeader,
} from './cbsEach'
import { cbsNameKey, type MacroIndex } from './macroIndex'

export type CbsProblemKind = 'unclosed-macro' | 'stray-macro-close' | 'unclosed-block' | 'stray-block-close'
    | 'unknown-macro' | 'not-a-block' | 'misplaced-else' | 'slot-outside' | 'deprecated' | 'not-static'

export type NotStaticReason = 'dynamic-name' | 'maybe-pure' | 'each-reparse' | 'depth' | 'early-return'

export type CbsFix = { start: number; end: number; text: string }

export type CbsProblem = {
    kind: CbsProblemKind
    severity: 'error' | 'warning' | 'info'
    start: number
    end: number
    line: number
    name?: string
    registryName?: string
    reason?: NotStaticReason
    fix?: CbsFix
}

export type CbsCheckOptions = { mode: 'cbs' | 'html+cbs'; slotAllowed: boolean; typingAt?: number }

export type CbsCheckResult = { problems: readonly CbsProblem[]; valueDependent: boolean; judgedUntil: number }

const SEVERITY: Record<CbsProblemKind, CbsProblem['severity']> = {
    'unclosed-macro': 'error',
    'unclosed-block': 'error',
    'stray-block-close': 'error',
    'unknown-macro': 'warning',
    'not-a-block': 'warning',
    'misplaced-else': 'warning',
    'slot-outside': 'warning',
    'deprecated': 'info',
    'not-static': 'info',
    'stray-macro-close': 'info',
}

// The engine indexes its frame-type array (`Uint8Array(512)`) by frame count plus one; a push that
// would need index 512 or more cannot be recorded, and its `}}` never closes.
const MAX_OPEN_FRAMES = 510

const ROLE_TAG = /<(user|char|bot)>/gi

// The names the engine's `assetRegex` (parser.svelte.ts) matches before `::`. `risuChatParser`
// leaves such a frame as text and the display step renders it, so the name need not reach a registry
// entry: the registry key of `video-img` (`videoimg`) reaches none. Case-sensitive, like the regex.
export const ASSET_DISPLAY_NAMES: readonly string[] = [
    'raw', 'path', 'img', 'image', 'video', 'audio', 'bgm', 'bg', 'emotion', 'asset', 'video-img', 'source',
]

// Block types whose body the engine never renders as a slot field: a slot there is not misplaced.
const SLOT_SKIPPED_TYPES: ReadonlySet<EngineBlockType> = new Set<EngineBlockType>([
    'pure', 'pure-display', 'escape', 'ignore', 'function',
])

type PureState = 'yes' | 'no' | 'maybe'

// The loop variable an `#each` frame declares: the header's own name, a name fixed by the static
// tail of a header that is partly a value, or none (a value decides, or the header is dropped).
type Loop = { kind: 'known'; name: string } | { kind: 'unknown' } | { kind: 'none' }

// The outermost `#each` closer a spliced text belongs to: problems found in the spliced text are
// reported once per kind at its original span, and not for a kind the body pass already reported.
type Expansion = {
    start: number
    end: number
    reported: Set<CbsProblemKind>
    bodyKinds: ReadonlySet<CbsProblemKind>
}

// A position in the scanned text: a working offset in the pre-passed input, or (with an expansion)
// somewhere in spliced text that has no original offset.
type Point = { at: number; expansion: Expansion | null }

// Text still to scan. The input is one segment; every splice puts a segment on top of the stack, so
// the characters after the splice stay where they are and the scan can read across the seam.
type Segment = { text: string; at: number; expansion: Expansion | null }

// `head` is the text before the first nested value; `tail` the text after the last one.
type MacroFrame = { type: 1; start: Point; firstChild: Point | null; head: string; tail: string }
type BlockFrame = {
    type: 5 | 6
    start: Point
    end: Point
    head: string
    types: ReadonlySet<EngineBlockType> | null
    purity: PureState
    // Problem counts when a simulable `#each` opened, to tell what its body pass reported.
    opened: ReadonlyMap<CbsProblemKind, number> | null
    // Set for an `#each` frame only.
    loop: Loop | null
    // `:else` frames its block's end read or left as text (an else-capable block reads only the first).
    elses: number
}
type Frame = MacroFrame | BlockFrame

// The text the engine's pure first pass collects for an `#each` body, one level per open frame above
// the block: `levels[0]` is the block's own buffer.
type Capture = { owner: BlockFrame; levels: string[]; call: boolean }

type Frozen = { reason: NotStaticReason; start: Point; end: Point }

type EachOutcome = { kind: 'none' } | { kind: 'frozen'; frozen: Frozen } | { kind: 'splice'; segment: Segment }

type RoleTag = { start: number; end: number; name: string; text: string }

type PrePass = {
    text: string
    tags: readonly RoleTag[]
    // Original offset of the character at a working offset, and of a span ending before it.
    startAt: (working: number) => number
    endAt: (working: number) => number
}

// The engine's role-tag pre-pass (`<user>`, `<char>`, `<bot>` become `{{user}}`, ...), with the maps
// that carry a working offset back to the original text. A position inside a replaced tag maps to
// the tag's start for a span start and to its end for a span end.
function prePass(text: string): PrePass {
    const matches = [...text.matchAll(ROLE_TAG)]
    if(matches.length === 0){
        const same = (working: number) => working
        return { text, tags: [], startAt: same, endAt: same }
    }
    const tags: RoleTag[] = []
    const startMap: number[] = []
    const endMap: number[] = []
    const parts: string[] = []
    let last = 0
    for(const m of matches){
        const at = m.index ?? 0
        for(let k = last; k < at; k++){
            startMap.push(k)
            endMap.push(k)
        }
        parts.push(text.slice(last, at))
        const replacement = `{{${m[1]}}}`
        tags.push({ start: at, end: at + m[0].length, name: m[0], text: replacement })
        for(let j = 0; j < replacement.length; j++){
            startMap.push(at)
            endMap.push(j === 0 ? at : at + m[0].length)
        }
        parts.push(replacement)
        last = at + m[0].length
    }
    for(let k = last; k < text.length; k++){
        startMap.push(k)
        endMap.push(k)
    }
    parts.push(text.slice(last))
    startMap.push(text.length)
    endMap.push(text.length)
    return {
        text: parts.join(''),
        tags,
        startAt: (working) => startMap[working],
        endAt: (working) => endMap[working],
    }
}

// Names the engine's `return` macro answers to, from the index's callable `return` entry.
function returnNames(index: MacroIndex): string[] {
    const entry = index.entries.find((e) => e.name === 'return' && !e.docOnly)
    return entry ? [entry.name, ...entry.aliases] : []
}

// The name as written, before the engine's key rule lower-cases it and drops spaces.
function rawName(head: string): string {
    const colon = head.indexOf(':')
    return (colon !== -1 && head[colon + 1] === ':' ? head.split('::') : head.split(':'))[0]
}

// The registry entry listed under exactly this name. `lookup` cannot be used for a block's own
// name: its key rule drops `_`, so `#if_pure` reaches nothing.
function entryNamed(index: MacroIndex, name: string): MacroIndex['entries'][number] | null {
    for(let k = index.entries.length - 1; k >= 0; k--){
        const entry = index.entries[k]
        if(entry.name === name || entry.aliases.includes(name)){
            return entry
        }
    }
    return null
}

// The pre-pass rewrites role tags before anything is scanned, so they are judged from the text alone
// and stay reported after the scan stops. The fix is the pre-pass's own replacement, letter case
// included, so the engine reads the fixed text exactly as it read the tag. A tag that begins a line and is followed by `:` is read by
// the example-dialogue parser on the raw line, before any CBS parse, as a speaker prefix; the macro
// spelling is not the same prefix (`<char>:` is none, `{{bot}}:` is none), so the fix is withheld.
function roleTagProblems(text: string, tags: readonly RoleTag[], lineOf: (offset: number) => number): CbsProblem[] {
    return tags.map((tag) => {
        const lineStart = tag.start === 0 ? 0 : text.lastIndexOf('\n', tag.start - 1) + 1
        const speakerPrefix = text.slice(lineStart, tag.start).trim() === '' && text[tag.end] === ':'
        const problem: CbsProblem = {
            kind: 'deprecated',
            severity: SEVERITY.deprecated,
            start: tag.start,
            end: tag.end,
            line: lineOf(tag.start),
            name: tag.name,
        }
        if(!speakerPrefix){
            problem.fix = { start: tag.start, end: tag.end, text: tag.text }
        }
        return problem
    })
}

// 1-based line of an original offset: the number of line feeds before it, plus one.
function lineFinder(text: string): (offset: number) => number {
    const breaks: number[] = []
    for(let k = text.indexOf('\n'); k !== -1; k = text.indexOf('\n', k + 1)){
        breaks.push(k)
    }
    return (offset) => {
        let low = 0
        let high = breaks.length
        while(low < high){
            const mid = (low + high) >> 1
            if(breaks[mid] < offset){
                low = mid + 1
            }
            else{
                high = mid
            }
        }
        return low + 1
    }
}

export function checkCbs(text: string, index: MacroIndex, opts: CbsCheckOptions): CbsCheckResult {
    return scan(text, index, opts, null)
}

// Test seam: the check together with every text the scan spliced after a literal-array `#each`
// closer, in splice order.
export function checkCbsWithExpansions(
    text: string,
    index: MacroIndex,
    opts: CbsCheckOptions,
): { result: CbsCheckResult; expansions: string[] } {
    const expansions: string[] = []
    return { result: scan(text, index, opts, expansions), expansions }
}

function scan(text: string, index: MacroIndex, opts: CbsCheckOptions, spliced: string[] | null): CbsCheckResult {
    const pre = prePass(text)
    const w = pre.text
    const lineOf = lineFinder(text)
    const roleTags = roleTagProblems(text, pre.tags, lineOf)
    const returns = returnNames(index)
    let problems: CbsProblem[] = []
    const counts = new Map<CbsProblemKind, number>()

    const report = (kind: CbsProblemKind, from: Point, to: Point, extra: Partial<CbsProblem> = {}) => {
        const expansion = from.expansion ?? to.expansion
        let start: number
        let end: number
        if(expansion){
            if(kind === 'unknown-macro' || kind === 'slot-outside' || expansion.reported.has(kind) || expansion.bodyKinds.has(kind)){
                return
            }
            expansion.reported.add(kind)
            start = expansion.start
            end = expansion.end
        }
        else{
            start = pre.startAt(from.at)
            end = pre.endAt(to.at)
            counts.set(kind, (counts.get(kind) ?? 0) + 1)
        }
        problems.push({ kind, severity: SEVERITY[kind], start, end, line: lineOf(start), ...extra })
    }

    const segments: Segment[] = [{ text: w, at: 0, expansion: null }]
    // The segment the pointer is in; segments read to their end are dropped on the way.
    const current = (): Segment | null => {
        while(segments.length > 0 && segments[segments.length - 1].at >= segments[segments.length - 1].text.length){
            segments.pop()
        }
        return segments.length > 0 ? segments[segments.length - 1] : null
    }
    // The engine's `pointer++`.
    const step = () => {
        const seg = current()
        if(seg){
            seg.at++
        }
    }
    // The character after the pointer, across a seam.
    const lookahead = (seg: Segment): string | undefined => {
        if(seg.at + 1 < seg.text.length){
            return seg.text[seg.at + 1]
        }
        for(let k = segments.length - 2; k >= 0; k--){
            if(segments[k].at < segments[k].text.length){
                return segments[k].text[segments[k].at]
            }
        }
        return undefined
    }
    const here = (seg: Segment): Point => ({ at: seg.at, expansion: seg.expansion })
    const where = (): Point => {
        const seg = current()
        return seg ? here(seg) : { at: w.length, expansion: null }
    }
    const plus = (p: Point, n: number): Point => ({ at: p.at + n, expansion: p.expansion })

    const frames: Frame[] = []
    let capture: Capture | null = null
    let budgetUsed = 0
    let pureYes = 0
    let pureMaybe = 0
    const state = (): PureState => pureYes > 0 ? 'yes' : pureMaybe > 0 ? 'maybe' : 'no'
    const addPurity = (p: PureState, by: 1 | -1) => {
        if(p === 'yes'){
            pureYes += by
        }
        else if(p === 'maybe'){
            pureMaybe += by
        }
    }

    // Text the engine appends to the buffer of the top frame as it is: the head of a macro frame
    // until its first nested value, and the `#each` body capture.
    const plain = (s: string) => {
        const top = frames[frames.length - 1]
        if(top && top.type === 1){
            top.tail += s
            if(top.firstChild === null){
                top.head += s
            }
        }
        if(capture){
            capture.levels[capture.levels.length - 1] += s
        }
    }

    // The loop variable of an `#each` head: its own name for a static header, the name its static tail
    // fixes for a header that is partly a value, none for a dropped header. A leading value that
    // evaluates empty lets the engine drop the whole block instead (the tail's `as ` is then stripped
    // as a prefix); the name then names a body that is never rendered, so the exemption errs toward silence.
    const loopOf = (head: string, nested: boolean, tail: string): Loop => {
        if(nested){
            const name = eachLoopVar(tail)
            return name === null ? { kind: 'unknown' } : { kind: 'known', name }
        }
        const header = parseEachHeader(head)
        return 'dropped' in header ? { kind: 'none' } : { kind: 'known', name: header.slotName }
    }

    // Whether a slot macro (`head`, a complete frame or one with a static name) is outside every slot
    // field the engine fills. A block whose body is never rendered excludes it; the loop variable of an
    // enclosing `#each` that equals the slot's name exempts it; a loop variable a value decides leaves the
    // verdict open, which stops the scan rather than guess.
    const slotVerdict = (head: string, nested: boolean): 'misplaced' | 'fine' | 'unknown-loop' => {
        let unknownLoop = false
        const written = !nested && head.startsWith('slot::') ? head.slice('slot::'.length) : null
        for(const frame of frames.filter((f): f is BlockFrame => f.type !== 1)){
            if(frame.type === 5 && frame.types && [...frame.types].every((type) => SLOT_SKIPPED_TYPES.has(type))){
                return 'fine'
            }
            if(frame.loop?.kind === 'known' && frame.loop.name === written){
                return 'fine'
            }
            if(frame.loop?.kind === 'unknown'){
                unknownLoop = true
            }
        }
        return unknownLoop && head.startsWith('slot::') ? 'unknown-loop' : 'misplaced'
    }

    // A frame that ended is a nested value of the macro frame below it, so the text after the last
    // nested value starts over.
    const valueEnded = () => {
        const below = frames[frames.length - 1]
        if(below && below.type === 1){
            below.tail = ''
        }
    }

    // Whether a macro head can be the early-returning macro: its name key is one of the names, or
    // (head partly a nested value) can still become one.
    const mayReturn = (head: string, hasNested: boolean): boolean => {
        const key = cbsNameKey(head)
        if(!hasNested || head.includes(':')){
            return returns.includes(key)
        }
        return returns.some((name) => name.startsWith(key))
    }

    // The engine's `#each` close: the body buffer becomes the text of every element, spliced after
    // the closer. A body that calls a function, a non-literal or oversized array, and a pure state
    // that is only maybe all depend on a value or on more work than the checker does.
    const closeEach = (block: BlockFrame, owned: Capture | null, closer: Point, closerEnd: Point): EachOutcome => {
        const stop: EachOutcome = { kind: 'frozen', frozen: { reason: 'each-reparse', start: closer, end: closerEnd } }
        if(!owned || owned.call){
            return stop
        }
        const header = parseEachHeader(block.head)
        if('dropped' in header || header.array.length === 0){
            return { kind: 'none' }
        }
        if(header.array.length > EACH_MAX_ELEMENTS){
            return stop
        }
        const body = eachBodyOutput(owned.levels[0], header.keep)
        if(budgetUsed + expansionBound(header, body) > EACH_CHAR_BUDGET){
            return stop
        }
        const added = expandEach(header, body)
        budgetUsed += added.length
        if(added === ''){
            return { kind: 'none' }
        }
        spliced?.push(added)
        const expansion: Expansion = closer.expansion ?? {
            start: pre.startAt(closer.at),
            end: pre.endAt(closerEnd.at),
            reported: new Set(),
            bodyKinds: bodyKindsSince(block.opened),
        }
        return { kind: 'splice', segment: { text: added, at: 0, expansion } }
    }
    const bodyKindsSince = (opened: ReadonlyMap<CbsProblemKind, number> | null): ReadonlySet<CbsProblemKind> => {
        const kinds = new Set<CbsProblemKind>()
        for(const [kind, n] of counts){
            if(opened && n > (opened.get(kind) ?? 0)){
                kinds.add(kind)
            }
        }
        return kinds
    }

    let frozen: Frozen | null = null

    scan:
    for(let seg = current(); seg; seg = current()){
        const c = seg.text[seg.at]
        const next = lookahead(seg)
        const point = here(seg)
        done: {
            if(c === '{'){
                if(next !== '{' && next !== '#'){
                    plain(c)
                    break done
                }
                if(frames.length >= MAX_OPEN_FRAMES){
                    frozen = { reason: 'depth', start: point, end: plus(point, 2) }
                    break scan
                }
                const parent = frames[frames.length - 1]
                if(parent && parent.type === 1 && parent.firstChild === null){
                    parent.firstChild = point
                }
                frames.push({ type: 1, start: point, firstChild: null, head: '', tail: '' })
                capture?.levels.push('')
                step()
                break done
            }
            if(c === '#'){
                // Legacy `{#...#}`: `#}` closes a top frame opened by `{{` or `{#`.
                const top = frames[frames.length - 1]
                if(next === '}' && top && top.type === 1){
                    frames.pop()
                    valueEnded()
                    report('deprecated', top.start, plus(point, 2))
                    step()
                    if(capture){
                        const dat = capture.levels.pop() ?? ''
                        capture.levels[capture.levels.length - 1] += legacyFrameOutput(dat) ?? `{#${dat}#}`
                    }
                }
                else{
                    plain(c)
                }
                break done
            }
            if(c !== '}' || next !== '}'){
                plain(c)
                break done
            }
            const top = frames[frames.length - 1]
            if(!top || top.type !== 1){
                if(opts.mode === 'cbs'){
                    report('stray-macro-close', point, plus(point, 2))
                }
                // A pair counts once: the engine reads both characters as text, and the second cannot
                // change the frame stack either.
                plain('}}')
                step()
                break done
            }

            frames.pop()
            valueEnded()
            step()
            const end = plus(where(), 1)
            const nested = top.firstChild !== null
            const head = top.head
            // What the engine's buffer of this frame holds, kept only for an `#each` body.
            const dat = capture ? capture.levels.pop() ?? '' : ''

            if(nested && head === ''){
                frozen = { reason: 'dynamic-name', start: top.start, end }
                break scan
            }

            const lead = head[0]
            if(lead === '#' || lead === ':'){
                const exactElse = head === ':else' && !nested
                if(state() === 'yes'){
                    if(capture){
                        capture.levels[capture.levels.length - 1] += `{{${dat}}}`
                    }
                    if(exactElse){
                        break done
                    }
                    if(nested && ':else'.startsWith(head)){
                        frozen = { reason: 'dynamic-name', start: top.start, end }
                        break scan
                    }
                    // A pure body keeps the frame as text, and the engine reads it again after the
                    // enclosing `#each` is spliced, so an `#each` frame in it declares its loop variable too.
                    const inner = classifyBlockStart(head, !nested)
                    frames.push({
                        type: 6, start: top.start, end, head, types: null, purity: 'no', opened: null,
                        loop: inner.kind === 'block' && inner.types.has('each') ? loopOf(head, nested, top.tail) : null,
                        elses: 0,
                    })
                    capture?.levels.push('')
                    break done
                }
                const start = classifyBlockStart(head, !nested)
                if(start.kind === 'block'){
                    const p = purity(start.types)
                    const simulable = !nested && state() === 'no' && start.types.size === 1 && start.types.has('each')
                    const registryName = registryNameFor(start.keyword)
                    const listed = registryName === null ? null : entryNamed(index, registryName)
                    if(listed?.deprecated){
                        report('deprecated', top.start, end, { name: head, registryName: listed.name })
                    }
                    const frame: BlockFrame = {
                        type: 5, start: top.start, end, head, types: start.types, purity: p,
                        opened: simulable ? new Map(counts) : null,
                        loop: start.types.has('each') ? loopOf(head, nested, top.tail) : null, elses: 0,
                    }
                    frames.push(frame)
                    addPurity(p, 1)
                    if(simulable){
                        capture = { owner: frame, levels: [''], call: false }
                    }
                    break done
                }
                if(start.kind === 'undecidable'){
                    frozen = { reason: 'dynamic-name', start: top.start, end }
                    break scan
                }
                if(state() === 'maybe' && !exactElse){
                    frozen = { reason: 'maybe-pure', start: top.start, end }
                    break scan
                }
                if(!exactElse){
                    report('not-a-block', top.start, end, { name: head })
                    break done
                }
                // The innermost block reads the first `:else` of an else-capable type only; a block
                // whose type is not else-capable leaves it as text, and a frame with no block around
                // it has nothing to read it. Where the type is only maybe else-capable nothing is claimed.
                const holder = frames[frames.length - 1]
                let misplaced = false
                if(!holder){
                    misplaced = true
                }
                else if(holder.type === 5 && holder.types){
                    const reads = elseCapable(holder.types)
                    if(reads === 'no'){
                        misplaced = true
                    }
                    else if(reads === 'yes'){
                        holder.elses++
                        misplaced = holder.elses > 1
                    }
                }
                if(misplaced){
                    report('misplaced-else', top.start, end, { name: head })
                }
                break done
            }

            if(lead === '/' && head[1] !== '/'){
                if(head === '/' && nested){
                    frozen = { reason: 'dynamic-name', start: top.start, end }
                    break scan
                }
                const block = frames[frames.length - 1]
                if(block && block.type !== 1){
                    frames.pop()
                    valueEnded()
                    if(block.type === 6){
                        if(capture){
                            const inner = capture.levels.pop() ?? ''
                            capture.levels[capture.levels.length - 1] += `${inner}{{${dat}}}`
                        }
                        break done
                    }
                    addPurity(block.purity, -1)
                    if(block.types?.has('each')){
                        const owned: Capture | null = capture !== null && capture.owner === block ? capture : null
                        capture = null
                        const outcome = closeEach(block, owned, top.start, end)
                        if(outcome.kind === 'frozen'){
                            frozen = outcome.frozen
                            break scan
                        }
                        if(outcome.kind === 'splice'){
                            // The closer's last character is read; the spliced text follows it.
                            step()
                            segments.push(outcome.segment)
                            continue scan
                        }
                    }
                }
                else{
                    report('stray-block-close', top.start, end, { name: head })
                    if(capture){
                        capture.levels[capture.levels.length - 1] += `{{${dat}}}`
                    }
                }
                break done
            }

            if(state() !== 'yes' && mayReturn(head, nested)){
                frozen = { reason: 'early-return', start: top.start, end }
                break scan
            }
            // A macro whose name a value decides is not judged; a spliced text's frames are not judged
            // for names or slots either (the body pass judged them).
            if(!nested || head.includes(':')){
                if(cbsNameKey(head) === 'slot' && !opts.slotAllowed && !top.start.expansion){
                    const verdict = slotVerdict(head, nested)
                    if(verdict === 'unknown-loop'){
                        frozen = { reason: 'each-reparse', start: top.start, end }
                        break scan
                    }
                    if(verdict === 'misplaced'){
                        report('slot-outside', top.start, end, { name: rawName(head) })
                    }
                }
                if(state() !== 'yes' && !ASSET_DISPLAY_NAMES.some((name) => head.startsWith(`${name}::`))){
                    const entry = index.lookup(head)
                    if(entry === null){
                        if(!head.startsWith('? ') && !head.startsWith('//') && !head.startsWith('call::')){
                            report('unknown-macro', top.start, end, { name: rawName(head) })
                        }
                    }
                    else if(entry.deprecated){
                        report('deprecated', top.start, end, { name: rawName(head), registryName: entry.name })
                    }
                }
            }
            if(capture){
                // The engine runs a `call::` frame even in pure mode.
                if(head.startsWith('call::')){
                    capture.call = true
                }
                capture.levels[capture.levels.length - 1] += `{{${dat}}}`
            }
        }
        step()
    }

    if(frozen){
        const at = frozen.start.expansion ? frozen.start.expansion.start : pre.startAt(frozen.start.at)
        const stopEnd = frozen.end.expansion ? frozen.end.expansion.end : pre.endAt(frozen.end.at)
        problems = problems.filter((p) => p.start < at)
        problems.push({
            kind: 'not-static',
            severity: SEVERITY['not-static'],
            start: at,
            end: stopEnd,
            line: lineOf(at),
            reason: frozen.reason,
        })
        return { problems: sortProblems([...problems, ...roleTags]), valueDependent: true, judgedUntil: at }
    }

    // End of input: the innermost open `{{` starting before the cursor is the one being typed. Text
    // spliced from an `#each` is never the macro being typed.
    const typingAt = opts.typingAt
    let typing = typingAt !== undefined
    for(let k = frames.length - 1; k >= 0; k--){
        const frame = frames[k]
        if(frame.type === 1){
            if(typing && typingAt !== undefined && !frame.start.expansion && pre.startAt(frame.start.at) < typingAt){
                typing = false
                continue
            }
            report('unclosed-macro', frame.start, plus(frame.start, 2))
        }
        else{
            report('unclosed-block', frame.start, frame.end, { name: frame.head })
        }
    }
    return { problems: sortProblems([...problems, ...roleTags]), valueDependent: false, judgedUntil: text.length }
}

// Source order; problems at one offset keep the order they were found in.
function sortProblems(list: CbsProblem[]): CbsProblem[] {
    return list
        .map((problem, order) => ({ problem, order }))
        .sort((a, b) => a.problem.start - b.problem.start || a.order - b.order)
        .map((entry) => entry.problem)
}
