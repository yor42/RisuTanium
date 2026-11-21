/** The longest unit, in code points (spec 3.1). */
export const UNIT_CHARS = 1200

export interface Piece {
    off: number
    text: string
}

const SENTENCE_BREAK = /(?<=[.!?…。"”])\s+/g

const cpLen = (s: string): number => Array.from(s).length

/**
 * Splits one record into pieces of at most `limit` code points: paragraphs
 * first, then sentences joined greedily inside a paragraph; a sentence longer
 * than the limit is hard-cut at the limit. A piece keeps its offset in the
 * record text, so `text.slice(off, off + piece.text.length) === piece.text`.
 */
export function splitRecord(text: string, limit: number): Piece[] {
    const paras: Array<[number, number]> = []
    let pos = 0
    for (const m of text.matchAll(/\n{2,}/g)) {
        paras.push([pos, m.index])
        pos = m.index + m[0].length
    }
    paras.push([pos, text.length])
    const pieces: Piece[] = []
    const push = (a: number, b: number) => {
        if (b > a) pieces.push({ off: a, text: text.slice(a, b) })
    }
    for (const [a, b] of paras) {
        if (b <= a) continue
        const sents: Array<[number, number]> = []
        let sp = a
        const body = text.slice(a, b)
        for (const m of body.matchAll(SENTENCE_BREAK)) {
            sents.push([sp, a + m.index])
            sp = a + m.index + m[0].length
        }
        sents.push([sp, b])
        let cur: [number, number] | null = null
        for (const [sa, sb] of sents) {
            if (cur && cpLen(text.slice(cur[0], sb)) <= limit) {
                cur[1] = sb
                continue
            }
            if (cur) push(cur[0], cur[1])
            cur = null
            if (cpLen(text.slice(sa, sb)) <= limit) {
                cur = [sa, sb]
                continue
            }
            let at = sa
            const chars = Array.from(text.slice(sa, sb))
            for (let i = 0; i < chars.length; i += limit) {
                const seg = chars.slice(i, i + limit).join('')
                push(at, at + seg.length)
                at += seg.length
            }
        }
        if (cur) push(cur[0], cur[1])
    }
    return pieces
}
