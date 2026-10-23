const regexFlagChars = 'dgimsuvy'

/**
 * Index just past a regex key whose body starts at `from` (after the opening
 * `/`): the position of the comma or the end of the text that follows its
 * closing `/flags`, or -1 when no closing slash is followed by one. A backslash
 * skips the next character and a `[...]` class holds slashes, so `/a\/,b/` and
 * `/[/],x/` stay one key.
 */
function findRegexKeyEnd(raw:string, from:number):number {
    let inClass = false
    for(let i = from; i < raw.length; i++){
        const ch = raw[i]
        if(ch === '\\'){
            i++
        }
        else if(inClass){
            inClass = ch !== ']'
        }
        else if(ch === '['){
            inClass = true
        }
        else if(ch === '/'){
            let end = i + 1
            while(end < raw.length && regexFlagChars.includes(raw[end])){
                end++
            }
            let next = end
            while(next < raw.length && /\s/.test(raw[next])){
                next++
            }
            if(next >= raw.length){
                return raw.length
            }
            if(raw[next] === ','){
                return next
            }
        }
    }
    return -1
}

/**
 * Splits a lorebook entry's key text into keys. Outside regex mode this is a
 * plain comma split. In regex mode a key that starts with `/` (after optional
 * whitespace) runs through its closing `/flags`, so a comma inside
 * `/pattern/flags` stays part of the pattern; any other key, and a slash key
 * with no closing `/flags`, ends at its next comma. Pieces are not trimmed.
 */
export function splitLoreKeys(raw:string, useRegex:boolean):string[] {
    if(!useRegex){
        return raw.split(',')
    }
    const keys:string[] = []
    let start = 0
    while(true){
        let open = start
        while(open < raw.length && /\s/.test(raw[open])){
            open++
        }
        let end = raw[open] === '/' ? findRegexKeyEnd(raw, open + 1) : -1
        if(end === -1){
            end = raw.indexOf(',', start)
            if(end === -1){
                end = raw.length
            }
        }
        keys.push(raw.slice(start, end))
        if(end >= raw.length){
            return keys
        }
        start = end + 1
    }
}
