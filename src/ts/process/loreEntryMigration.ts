import type { loreBook } from '../storage/database.svelte'

/**
 * Brings one lorebook entry to bookVersion 2, in place: a legacy probability moves into an `@@probability` line, the
 * old `@@end` and `<char>`, `<bot>` and `<user>` forms become their current ones. An entry already at version 2 or
 * above comes back untouched. Shared by the load-time upgrade and by Studio's Duplicate.
 */
export function migrateLoreEntryToV2(v: loreBook): loreBook {
    v.bookVersion ??= 1
    if(v.bookVersion >= 2){
        return v
    }
    if(v.activationPercent){
        const perc = v.activationPercent
        v.activationPercent = null

        v.content = `@@probability ${perc}\n${v.content}`
    }
    v.content = v.content.replace(/@@@?end/g, '@@depth 0').replace(/\<(char|bot)\>/g, '{{char}}').replace(/\<(user)\>/g, '{{user}}')
    v.bookVersion = 2
    return v
}
