// Block classification for the CBS problem checker: a copy of the engine's `blockStartMatcher`
// (parser.svelte.ts) plus the two facts the checker reads from its result.
//
// Invariants:
// - Complete text (`complete: true`) classifies exactly as `blockStartMatcher` does, except that a
//   `#when::` fold reading chat state (`var`, `toggle`, `vis`, `visnot`, `tis`, `tisnot`) has an
//   unknown truth and answers both types of its mode.
// - Incomplete text (a prefix followed by a value that is only known at run time) answers a superset
//   of every reachable outcome: `undecidable` when both a block and plain text are reachable,
//   `nothing` when no completion is a block. A superset only ever adds stops in the checker.
// - Pure functions; this module imports nothing.

export type EngineBlockType = 'parse' | 'ignore' | 'ifpure' | 'newif' | 'newif-falsy' | 'pure'
    | 'pure-display' | 'normalize' | 'escape' | 'each' | 'function'

export type BlockKeyword = 'if' | 'if_pure' | 'when' | 'pure' | 'puredisplay' | 'code' | 'escape' | 'each' | 'func'

export type BlockStart =
    | { kind: 'block'; keyword: BlockKeyword; types: ReadonlySet<EngineBlockType> }
    | { kind: 'nothing' }
    | { kind: 'undecidable' }

type Tri = 'yes' | 'no' | 'maybe'

// Types that put the engine's scanner in pure mode (pureModeNest in risuChatParser).
const PURE_TYPES: ReadonlySet<EngineBlockType> = new Set<EngineBlockType>([
    'ignore', 'pure', 'each', 'function', 'pure-display', 'escape',
])

// Types whose block end reads a `{{:else}}` (blockEndMatcher).
const ELSE_TYPES: ReadonlySet<EngineBlockType> = new Set<EngineBlockType>(['newif', 'newif-falsy'])

// Every result a `#when::` text can have while its operands are not yet known.
const WHEN_COLON_TYPES: readonly EngineBlockType[] = ['newif', 'newif-falsy', 'parse', 'ignore']

const REGISTRY_NAMES: Record<BlockKeyword, string | null> = {
    if: '#if',
    if_pure: '#if_pure',
    when: '#when',
    pure: '#pure',
    puredisplay: '#puredisplay',
    code: null,
    escape: '#escape',
    each: '#each',
    func: null,
}

function membership(types: ReadonlySet<EngineBlockType>, member: ReadonlySet<EngineBlockType>): Tri {
    let inside = 0
    for(const t of types){
        if(member.has(t)){
            inside++
        }
    }
    if(inside === 0){
        return 'no'
    }
    return inside === types.size ? 'yes' : 'maybe'
}

/** Whether a block of these types puts the scanner in pure mode: all, none, or some of them. */
export function purity(types: ReadonlySet<EngineBlockType>): Tri {
    return membership(types, PURE_TYPES)
}

/** Whether a block of these types reads `{{:else}}` at its end: all, none, or some of them. */
export function elseCapable(types: ReadonlySet<EngineBlockType>): Tri {
    return membership(types, ELSE_TYPES)
}

/** The name a block keyword has in the macro registry, or null when the registry has none. */
export function registryNameFor(k: BlockKeyword): string | null {
    return REGISTRY_NAMES[k]
}

const isTruthy = (s: string) => s === 'true' || s === '1'

// A value on the `#when::` fold stack; null is a value only known at run time (chat state).
type Item = string | null

// Truth of a stack entry; an absent entry (popped from an empty stack) is falsy, as in the engine.
function truthOf(s: Item | undefined): boolean | null {
    if(s === undefined){
        return false
    }
    return s === null ? null : isTruthy(s)
}

function boolItem(t: boolean | null): Item {
    return t === null ? null : t ? '1' : '0'
}

// The fold of `blockStartMatcher` for `#when::a::b::...`, with chat-state operators unknown.
// Pop order and last-mode-wins are the engine's.
function foldWhen(segments: string[]): { mode: 'normal' | 'keep' | 'legacy'; truth: boolean | null } {
    const statement: Item[] = segments
    let mode: 'normal' | 'keep' | 'legacy' = 'normal'
    while(statement.length > 1){
        const condition = statement.pop() as Item
        const operator = statement.pop()
        switch(operator){
            case 'not':{
                const t = truthOf(condition)
                statement.push(boolItem(t === null ? null : !t))
                break
            }
            case 'keep':{
                mode = 'keep'
                statement.push(condition)
                break
            }
            case 'legacy':{
                mode = 'legacy'
                statement.push(condition)
                break
            }
            case 'and':{
                const a = truthOf(condition)
                const b = truthOf(statement.pop())
                statement.push(boolItem(a === false || b === false ? false : a === null || b === null ? null : true))
                break
            }
            case 'or':{
                const a = truthOf(condition)
                const b = truthOf(statement.pop())
                statement.push(boolItem(a === true || b === true ? true : a === null || b === null ? null : false))
                break
            }
            case 'is':
            case 'isnot':{
                const other = statement.pop()
                let equal: boolean | null
                if(other === undefined){
                    equal = false
                }
                else if(condition === null || other === null){
                    equal = null
                }
                else{
                    equal = condition === other
                }
                statement.push(boolItem(equal === null ? null : operator === 'is' ? equal : !equal))
                break
            }
            case 'var':
            case 'toggle':{
                statement.push(null)
                break
            }
            case 'vis':
            case 'visnot':
            case 'tis':
            case 'tisnot':{
                statement.pop()
                statement.push(null)
                break
            }
            case '>':
            case '<':
            case '>=':
            case '<=':{
                const other = statement.pop()
                let result: boolean | null
                if(other === undefined){
                    result = false
                }
                else if(condition === null || other === null){
                    result = null
                }
                else{
                    const left = parseFloat(other)
                    const right = parseFloat(condition)
                    result = operator === '>' ? left > right
                        : operator === '<' ? left < right
                        : operator === '>=' ? left >= right
                        : left <= right
                }
                statement.push(boolItem(result))
                break
            }
            default:{
                statement.push(boolItem(truthOf(condition)))
                break
            }
        }
    }
    return { mode, truth: truthOf(statement[0]) }
}

function types(...list: EngineBlockType[]): ReadonlySet<EngineBlockType> {
    return new Set<EngineBlockType>(list)
}

function block(keyword: BlockKeyword, list: ReadonlySet<EngineBlockType>): BlockStart {
    return { kind: 'block', keyword, types: list }
}

function classifyComplete(p1: string): BlockStart {
    if(p1.startsWith('#if') || p1.startsWith('#if_pure ')){
        const state = p1.split(' ', 2)[1]
        const pureKeyword = p1.startsWith('#if_pure')
        const truthy = state === 'true' || state === '1'
        return block(pureKeyword ? 'if_pure' : 'if', types(!truthy ? 'ignore' : pureKeyword ? 'ifpure' : 'parse'))
    }
    if(p1.startsWith('#when')){
        if(p1.startsWith('#when ')){
            const state = p1.split(' ', 2)[1]
            return block('when', types(state === 'true' || state === '1' ? 'newif' : 'newif-falsy'))
        }
        if(p1.startsWith('#when::')){
            const statement = p1.split('::').slice(1)
            if(statement.length === 1){
                return block('when', types(isTruthy(statement[0]) ? 'newif' : 'newif-falsy'))
            }
            const { mode, truth } = foldWhen(statement)
            if(mode === 'legacy'){
                return block('when', truth === null ? types('parse', 'ignore') : types(truth ? 'parse' : 'ignore'))
            }
            return block('when', truth === null ? types('newif', 'newif-falsy') : types(truth ? 'newif' : 'newif-falsy'))
        }
        return block('when', types('newif-falsy'))
    }
    if(p1 === '#pure'){
        return block('pure', types('pure'))
    }
    if(p1 === '#pure_display' || p1 === '#puredisplay'){
        return block('puredisplay', types('pure-display'))
    }
    if(p1 === '#code'){
        return block('code', types('normalize'))
    }
    if(p1.startsWith('#escape')){
        return block('escape', types('escape'))
    }
    if(p1.startsWith('#each')){
        return block('each', types('each'))
    }
    if(p1.startsWith('#func') && p1.split(' ').length > 1){
        return block('func', types('function'))
    }
    return { kind: 'nothing' }
}

// Whether some completion of `p` starts with `lit`.
const canStart = (p: string, lit: string) => p.startsWith(lit) || lit.startsWith(p)

// The truthy and falsy outcomes still reachable when the text after `head ` (the state token of
// `#if` / `#when `) may continue. `from` is the index of the first character after the space.
function stateOutcomes(p: string, from: number): { truthy: boolean; falsy: boolean } {
    const rest = p.slice(from)
    const token = rest.split(' ')[0]
    if(rest.includes(' ')){
        const truthy = isTruthy(token)
        return { truthy, falsy: !truthy }
    }
    // The token may still grow: it can reach `true` or `1` when it prefixes one, and any other
    // state by appending a character.
    return { truthy: 'true'.startsWith(token) || '1'.startsWith(token), falsy: true }
}

function classifyIncomplete(p: string): BlockStart {
    const found: { keyword: BlockKeyword; types: Set<EngineBlockType> }[] = []
    const add = (keyword: BlockKeyword, list: readonly EngineBlockType[]) => {
        found.push({ keyword, types: new Set<EngineBlockType>(list) })
    }

    if(canStart(p, '#if')){
        const out: EngineBlockType[] = []
        let truthy = true
        let falsy = true
        if(p.startsWith('#if')){
            const space = p.indexOf(' ')
            if(space !== -1){
                ({ truthy, falsy } = stateOutcomes(p, space + 1))
            }
        }
        const pureCertain = p.startsWith('#if_pure')
        const pureCan = pureCertain || ('#if_pure'.startsWith(p) && !p.includes(' '))
        const plainCan = !pureCertain
        if(truthy){
            if(plainCan){
                out.push('parse')
            }
            if(pureCan){
                out.push('ifpure')
            }
        }
        if(falsy){
            out.push('ignore')
        }
        add(pureCertain ? 'if_pure' : 'if', out)
    }

    if(canStart(p, '#when')){
        const out: EngineBlockType[] = []
        const rest = p.slice(5)
        if(!p.startsWith('#when') || rest === '' || rest === ':' || rest.startsWith('::')){
            out.push(...WHEN_COLON_TYPES)
        }
        else if(rest.startsWith(' ')){
            const { truthy, falsy } = stateOutcomes(p, 6)
            if(truthy){
                out.push('newif')
            }
            if(falsy){
                out.push('newif-falsy')
            }
        }
        else{
            out.push('newif-falsy')
        }
        add('when', out)
    }

    if('#pure'.startsWith(p)){
        add('pure', ['pure'])
    }
    if('#pure_display'.startsWith(p) || '#puredisplay'.startsWith(p)){
        add('puredisplay', ['pure-display'])
    }
    if('#code'.startsWith(p)){
        add('code', ['normalize'])
    }
    if(canStart(p, '#escape')){
        add('escape', ['escape'])
    }
    if(canStart(p, '#each')){
        add('each', ['each'])
    }
    if(canStart(p, '#func')){
        add('func', ['function'])
    }

    // Plain text stays reachable unless the prefix already commits to an always-block head or to a
    // `#func` head that has its space.
    const committed = ['#if', '#when', '#escape', '#each'].some((head) => p.startsWith(head))
        || (p.startsWith('#func') && p.includes(' '))
    if(found.length === 0){
        return { kind: 'nothing' }
    }
    if(!committed){
        return { kind: 'undecidable' }
    }
    const union = new Set<EngineBlockType>()
    for(const f of found){
        for(const t of f.types){
            union.add(t)
        }
    }
    return block(found[0].keyword, union)
}

/**
 * Classifies the head of a `{{#...}}` or `{{:...}}` frame. `prefix` is the frame text before its
 * first nested value; `complete` says the frame has no nested value, so `prefix` is all of it.
 */
export function classifyBlockStart(prefix: string, complete: boolean): BlockStart {
    return complete ? classifyComplete(prefix) : classifyIncomplete(prefix)
}
