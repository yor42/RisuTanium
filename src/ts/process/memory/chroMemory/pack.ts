import type { IndexedUnit } from './chatIndex'

/** The injected heading (fixed English, MC-3202). */
export const HEADER = 'Earlier in this chat'
/** The pack walk stops when fewer than this many tokens remain. */
export const MIN_LEFT = 8
/** Count slots per send on a deterministic counter. */
export const SHADOW_COUNT_CAP = 64
/** Count slots per send on a varying counter (spec 4.7). */
export const VARYING_COUNT_CAP = 12

export interface PackLine {
    unit: IndexedUnit
    /** The record's position in D0. */
    pos: number
    label: string
    name: string
    text: string
    rank: number
}

export interface PackResult {
    picks: PackLine[]
    /** The token cost of each pick (its count plus one), parallel to `picks`. */
    pickTokens: number[]
    block: string
    T: number
    slots: number
    counted: number
    capped: boolean
    /** Picks removed after the walk, lowest ranked first, to make the block fit `limit`. */
    droppedForFit: number
}

export interface PackArgs {
    /** Best first; a function lets the caller build each line's text only when the walk reaches it. */
    lines: readonly PackLine[] | ((i: number) => PackLine | undefined)
    budget: number
    countText(text: string): Promise<number>
    /** The count of the would-be memory message: the text count plus the per-message overhead. */
    countBlock(block: string): Promise<number>
    /** SHADOW_COUNT_CAP, VARYING_COUNT_CAP, or Infinity (the S0 parity test only). */
    maxCounts: number
    /** Line text to countText result; passed only on a deterministic counter. */
    cache?: Map<string, number>
    /** The walk's starting run; it takes one slot. Default: the header's count plus one. */
    headCount?: () => Promise<number>
    /** Slots kept back from the walk for block counts. Default 1. */
    reserve?: number
    /** The block must also fit this; the walk still admits lines by `budget`. Default `budget`. */
    limit?: number
}

const lineOf = (l: PackLine): string => `[#${l.label}] ${l.name}: ${l.text}`

/**
 * Greedy pack of ranked lines under a token budget. Every count, cached or
 * not, uses one slot, so which lines are visited never depends on what the
 * cache holds; `counted` reports the counter calls actually made. One slot is
 * always kept for the block count, so the walk visits at most maxCounts - 2
 * lines. After the walk, picks drop lowest ranked first, on the walk's own
 * estimate and without a count, until the estimate fits; the block is then
 * counted and drops one more pick per failed count.
 */
export async function packUnits(args: PackArgs): Promise<PackResult> {
    const { budget, maxCounts, cache } = args
    const reserve = args.reserve ?? 1
    const fit = Math.min(budget, args.limit ?? budget)
    let slots = 0
    let counted = 0
    let capped = false
    let droppedForFit = 0
    const countLine = async (text: string): Promise<number> => {
        slots++
        const hit = cache?.get(text)
        if (hit !== undefined) return hit
        const v = await args.countText(text)
        counted++
        cache?.set(text, v)
        return v
    }
    const result = (picks: PackLine[], pickTokens: number[], block: string, T: number): PackResult => ({ picks, pickTokens, block, T, slots, counted, capped, droppedForFit })

    let run: number
    if (args.headCount) {
        slots++
        counted++
        run = await args.headCount()
    } else {
        run = (await countLine(HEADER)) + 1
    }
    const head = run
    let picks: PackLine[] = []
    let pickTokens: number[] = []
    for (let i = 0; ; i++) {
        if (slots + 1 + reserve > maxCounts) {
            capped = true
            break
        }
        const line = typeof args.lines === 'function' ? args.lines(i) : args.lines[i]
        if (!line) break
        const c = (await countLine(lineOf(line))) + 1
        if (run + c <= budget) {
            picks.push(line)
            pickTokens.push(c)
            run += c
        }
        if (budget - run < MIN_LEFT) break
    }
    if (!picks.length) return result([], [], '', 0)

    const assemble = (ps: readonly PackLine[]): string => {
        const sorted = [...ps].sort((a, b) => a.pos - b.pos || a.unit.off - b.unit.off)
        return [HEADER, ...sorted.map(lineOf)].join('\n')
    }
    for (;;) {
        let estimate = head + pickTokens.reduce((a, b) => a + b, 0)
        while (picks.length && estimate > fit) {
            estimate -= pickTokens[pickTokens.length - 1]
            picks = picks.slice(0, -1)
            pickTokens = pickTokens.slice(0, -1)
            droppedForFit++
        }
        if (!picks.length) return result([], [], '', 0)
        if (slots + 1 > maxCounts) {
            capped = true
            return result([], [], '', 0)
        }
        const block = assemble(picks)
        slots++
        counted++
        const T = await args.countBlock(block)
        if (T <= fit) return result(picks, pickTokens, block, T)
        picks = picks.slice(0, -1)
        pickTokens = pickTokens.slice(0, -1)
        droppedForFit++
        if (!picks.length) return result([], [], '', 0)
    }
}
