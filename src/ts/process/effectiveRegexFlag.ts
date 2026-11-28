export type EffectiveRegexFlag = {
    /** The flags handed to `new RegExp`: supported, de-duplicated, never empty. */
    flags: string
    /** The `<...>` custom actions, in order of appearance. */
    actions: string[]
    /** The `<order n>` value of the last order tag, 0 without one; NaN is kept. */
    order: number
    /** Whether any order tag was present, which is what makes a pass sort. */
    orderSet: boolean
}

/**
 * The regex flags, custom actions and order a script gets from its flag box and
 * flag text. Both the chat script pass and the translation pass use it, so they
 * cannot drift apart. A flag text that is not a string throws, and the caller
 * decides what a malformed entry does.
 */
export function effectiveRegexFlag(flag: string | undefined, ableFlag: boolean | undefined): EffectiveRegexFlag {
    if(!ableFlag){
        return { flags: 'g', actions: [], order: 0, orderSet: false }
    }

    let order = 0
    let orderSet = false
    const actions: string[] = []
    const collect = (_v: string, p1: string) => {
        const meta = p1.split(',').map((v) => v.trim())
        for(const m of meta){
            if(m.startsWith('order ')){
                order = parseInt(m.substring(6))
                orderSet = true
            }
            else{
                actions.push(m)
            }
        }
        return ''
    }
    const text = flag?.includes('<') ? flag.replace(/<(.+?)>/g, collect) : flag

    let flags = (text || 'g').trim().replace(/[^dgimsuvy]/g, '')
    flags = flags.split('').filter((v, i, a) => a.indexOf(v) === i).join('')
    if(flags.length === 0){
        flags = 'u'
    }

    return { flags, actions, order, orderSet }
}
