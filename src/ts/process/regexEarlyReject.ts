/**
 * Early rejection for regexes that begin with a lazy dot, which V8 runs in
 * quadratic time on text that holds no match.
 *
 * A pattern `LEAD REST`, with LEAD one of `(.+?)`, `.+?`, `(.*?)`, `.*?`, flag
 * `s` and neither `u`, `v` nor `y`, matches exactly when REST matches somewhere
 * at index 1 or later (index 0 or later for `.*?`): `.` then takes any single
 * code unit, so the lazy part can end at every such index. REST is searched
 * unsliced, so lookbehinds and `^` see the same text as in the full pattern.
 * This holds only while REST neither depends on the leading group nor changes
 * meaning standalone, which is why anything the scanner cannot prove plain
 * (top-level `|`, backreferences, a quantifier on the leading group, unbalanced
 * or unterminated constructs) is left to the full regex.
 *
 * An anchored lead `^` followed by a dot run (`.*`, `.+`, lazy or greedy, with
 * or without a group) behaves the same under flag `s`: `^` always matches at
 * index 0, the dot run spans any prefix from there, and the further line
 * starts that flag `m` adds can only reach REST positions index 0 already
 * reaches. Greedy or lazy changes which match is found, not whether one exists.
 *
 * The answer is one-sided: `true` means the full regex cannot match; `false`
 * only means this module cannot tell.
 */

interface RestSearch {
    search: RegExp
    from: number
}

const leads: { text: string, from: number }[] = [
    { text: '(.+?)', from: 1 },
    { text: '.+?', from: 1 },
    { text: '(.*?)', from: 0 },
    { text: '.*?', from: 0 },
    // Anchored leads. The lazy forms come first because a greedy form would
    // read the following `?` as a quantifier of the lead.
    { text: '^(.*?)', from: 0 },
    { text: '^.*?', from: 0 },
    { text: '^(.*)', from: 0 },
    { text: '^.*', from: 0 },
    { text: '^(.+?)', from: 1 },
    { text: '^.+?', from: 1 },
    { text: '^(.+)', from: 1 },
    { text: '^.+', from: 1 },
]

const restCacheLimit = 256

/** `null` records a pattern that is not a recognised shape, so it is not scanned again. */
const restCache = new Map<string, RestSearch | null>()

function isBackreferenceEscape(next: string): boolean {
    return (next >= '1' && next <= '9') || next === 'k'
}

/**
 * True when REST is balanced, has no top-level alternation and no
 * backreference. Character classes follow the non-unicode rules: a `]` right
 * after `[` or `[^` closes the class.
 */
function isPlainRest(rest: string): boolean {
    let depth = 0
    let i = 0
    while(i < rest.length){
        const c = rest[i]
        if(c === '\\'){
            if(i + 1 >= rest.length || isBackreferenceEscape(rest[i + 1])){
                return false
            }
            i += 2
        }
        else if(c === '['){
            i++
            if(rest[i] === '^'){
                i++
            }
            while(i < rest.length && rest[i] !== ']'){
                if(rest[i] === '\\'){
                    if(i + 1 >= rest.length || isBackreferenceEscape(rest[i + 1])){
                        return false
                    }
                    i += 2
                }
                else{
                    i++
                }
            }
            if(i >= rest.length){
                return false
            }
            i++
        }
        else if(c === '('){
            depth++
            i++
        }
        else if(c === ')'){
            depth--
            if(depth < 0){
                return false
            }
            i++
        }
        else if(c === '|' && depth === 0){
            return false
        }
        else{
            i++
        }
    }
    return depth === 0
}

function compileRest(input: string, flag: string): RestSearch | null {
    try{
        if(!flag.includes('s') || /[yuv]/.test(flag)){
            return null
        }
        const lead = leads.find((candidate) => input.startsWith(candidate.text))
        if(!lead){
            return null
        }
        const rest = input.slice(lead.text.length)
        if(rest.length > 0 && '*+?{'.includes(rest[0])){
            return null
        }
        if(!isPlainRest(rest)){
            return null
        }
        return { search: new RegExp(rest, flag.replace(/g/g, '') + 'g'), from: lead.from }
    }
    catch{
        return null
    }
}

/**
 * True only when `new RegExp(input, flag)` definitely has no match in `data`.
 * `input` is the final pattern source, as passed to the RegExp constructor.
 */
export function leadingLazyDotCannotMatch(input: string, flag: string, data: string): boolean {
    try{
        const key = flag + '\0' + input
        let entry = restCache.get(key)
        if(entry === undefined){
            entry = compileRest(input, flag)
            if(restCache.size >= restCacheLimit){
                restCache.delete(restCache.keys().next().value as string)
            }
            restCache.set(key, entry)
        }
        if(entry === null){
            return false
        }
        entry.search.lastIndex = entry.from
        const found = entry.search.exec(data)
        entry.search.lastIndex = 0
        return found === null
    }
    catch{
        return false
    }
}
