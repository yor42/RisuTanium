/**
 * The candidates one generation produced for its reply, and a cursor on the one
 * shown. They belong to the chat that generated them: a copy of that chat
 * carries the same generation id but never steps or edits these. The cursor
 * stays within the candidates. Kept in memory only.
 */
interface Candidates {
    owner: string
    values: string[]
    index: number
}

const candidates:{[genId:string]:Candidates} = {};

interface ChatAddress {
    chaId: string
    chatId: string
}

function ownerKey(address:ChatAddress){
    return `${address.chaId}\u0000${address.chatId}`
}

/**
 * The candidate after the one shown in `shown`'s chat, or null when that chat
 * does not own the generation's candidates or the last one is already shown.
 * `shownText` is stored into the candidate being left, so an in-place edit of
 * it comes back.
 */
export function Prereroll(genId:string, shown:ChatAddress, shownText:string){
    const entry = candidates[genId];
    if(!entry || entry.owner !== ownerKey(shown)){
        return null;
    }
    const next = entry.index + 1;
    if(next >= entry.values.length){
        return null;
    }
    entry.values[entry.index] = shownText;
    entry.index = next;
    return entry.values[next];
}

/** The candidate before the one shown, under the same rules as `Prereroll`. */
export function PreUnreroll(genId:string, shown:ChatAddress, shownText:string){
    const entry = candidates[genId];
    if(!entry || entry.owner !== ownerKey(shown)){
        return null;
    }
    const previous = entry.index - 1;
    if(previous < 0){
        return null;
    }
    entry.values[entry.index] = shownText;
    entry.index = previous;
    return entry.values[previous];
}

/** `origin` is the chat the generation wrote into; a group member's id is not part of the owner. */
export function addRerolls(genId:string, values:string[], origin:ChatAddress){
    candidates[genId] = { owner: ownerKey(origin), values: [...values], index: 0 };
}