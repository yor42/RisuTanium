/**
 * Property over seeded operation sequences on the real tree operations: edits that name a path message, Branch
 * (`detachTail`), arrows and end presses (`switchTo`), and a delete of the last message through the real
 * `withSupaRepoint`. Three oracles after every tree operation:
 * - A: no token is lost unless it was created, or still live, while the chat ended at a message with children;
 * - B: no token at all is lost by any operation other than the end press;
 * - S: every record with `mem` holds the six branch keys and is a run head, and no arrived record keeps `mem`.
 * A SupaMemory token whose only holders point at a deleted message is the pointer-repoint seam of a middle delete;
 * it is counted and logged, not asserted.
 */
import { describe, expect, it } from 'vitest'
import type { Chat, ChatAlt } from '../../storage/database.svelte'
import { detachTail, siblingsAt, switchTo } from '../chatTree'
import { withSupaRepoint } from '../memory/supaResume'

const FIELDS = ['supaMemoryData', 'supaMemoryCoveredId', 'lastMemory', 'scriptstate', 'hypaV2Data', 'hypaV3Data'] as const
const SIX_KEYS = [...FIELDS].sort().join(',')

type Config = { endBias: number, endAnyChild: boolean, withDelete: boolean }
type Outcome = {
    nonEndLosses: number
    strictLosses: number
    structuralFailures: number
    supaDeleteRounds: number
    firstNonEnd: string | null
    firstStrict: string | null
    firstStructural: string | null
}

function lcg(seed: number): () => number {
    let state = seed >>> 0
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        return state / 4294967296
    }
}

/** Everything a token can live in: the six live fields and every parked `mem`. */
function reachable(chat: Chat): string {
    return JSON.stringify([...FIELDS.map((field) => chat[field]), (chat.alt ?? []).map((record) => record.mem)])
}

/** The holders of a token as [field, value] pairs over the live chat and every parked `mem`. */
function occurrences(chat: Chat, token: string): [string, unknown][] {
    const found: [string, unknown][] = []
    const scan = (holder: Chat | ChatAlt['mem']): void => {
        if (holder === undefined) {
            return
        }
        for (const field of FIELDS) {
            if (JSON.stringify(holder[field] ?? null).includes(token)) {
                found.push([field, holder[field]])
            }
        }
    }
    scan(chat)
    for (const record of chat.alt ?? []) {
        scan(record.mem)
    }
    return found
}

/** The end control's target: the highest stamp after the last path message, the last in list order among equals. */
function endChild(chat: Chat): string | null {
    const parent = chat.message[chat.message.length - 1]?.chatId ?? null
    let best: ChatAlt | undefined
    for (const record of chat.alt ?? []) {
        if (record.p === parent && (best === undefined || record.a >= best.a)) {
            best = record
        }
    }
    return best?.m.chatId ?? null
}

function structuralFailure(chat: Chat, arrived: readonly ChatAlt[]): string | null {
    const alt = chat.alt ?? []
    for (const record of alt) {
        if (record.mem === undefined) {
            continue
        }
        const keys = Object.keys(record.mem).sort().join(',')
        if (keys !== SIX_KEYS) {
            return `keys of ${record.m.chatId}: ${keys}`
        }
        if (alt.some((other) => other !== record && other.a === record.a && other.m.chatId === record.p)) {
            return `mem on interior ${record.m.chatId}`
        }
    }
    for (const record of arrived) {
        if (record.mem !== undefined) {
            return `arrived ${record.m.chatId} keeps mem`
        }
    }
    return null
}

function firstLine(data: string): string {
    const newline = data.indexOf('\n')
    return newline === -1 ? data : data.slice(0, newline)
}

function runConfig(config: Config, rounds: number, steps: number): Outcome {
    const out: Outcome = { nonEndLosses: 0, strictLosses: 0, structuralFailures: 0, supaDeleteRounds: 0, firstNonEnd: null, firstStrict: null, firstStructural: null }
    for (let round = 0; round < rounds; round++) {
        const rnd = lcg(1000 + round)
        const pick = (n: number): number => Math.floor(rnd() * n)
        let time = 0
        let nextId = 0
        let nextToken = 0
        // token -> whether it was created while the chat ended at a message with children (an "E" token)
        const tokens = new Map<string, boolean>()
        const deleted = new Set<string>()
        const chat: Chat = {
            message: [],
            note: '',
            name: 'chat',
            localLore: [],
            hypaV3Data: { summaries: [] },
            hypaV2Data: { lastMainChunkID: 0, mainChunks: [], chunks: [] },
        }
        const endsAtChildren = (): boolean => siblingsAt(chat, chat.message.length).length > 0
        const putToken = (field: number, memo: string): void => {
            const token = `TK${round}_${nextToken++}_`
            tokens.set(token, endsAtChildren())
            const v3 = chat.hypaV3Data ?? { summaries: [] }
            const v2 = chat.hypaV2Data ?? { lastMainChunkID: 0, mainChunks: [], chunks: [] }
            chat.hypaV3Data = v3
            chat.hypaV2Data = v2
            if (field === 0) {
                chat.scriptstate = { v: token }
            } else if (field === 1) {
                chat.supaMemoryData = `${chat.message[chat.message.length - 1]?.chatId ?? 'x'}\n${token}`
            } else if (field === 2) {
                v3.summaries.push({ text: token, chatMemos: [memo], isImportant: false })
            } else {
                const id = v2.lastMainChunkID + 1
                v2.mainChunks.push({ id, text: token, chatMemos: [memo], lastChatMemo: memo })
                v2.chunks.push({ mainChunkID: id, text: token })
                v2.lastMainChunkID = id
            }
        }
        let stopA = false
        let stopB = false
        let stopS = false
        for (let step = 0; step < steps && !(stopA && stopB); step++) {
            const r = rnd()
            if (r < 0.35 || chat.message.length < 2) {
                const id = `x${nextId++}`
                chat.message.push({ role: 'char', data: id, chatId: id, time: ++time })
                if (rnd() < 0.7) {
                    putToken(pick(4), id)
                }
                continue
            }
            if (r >= 0.55 && r < 0.62 && config.withDelete) {
                const last = chat.message[chat.message.length - 1].chatId
                if (last !== undefined) {
                    deleted.add(last)
                }
                withSupaRepoint(chat, () => chat.message.pop())
                if (endsAtChildren()) {
                    // A value live when a delete leaves the chat ending at a message with children belongs to a path
                    // the user shortened; the end press may discard it.
                    const live = JSON.stringify([chat.supaMemoryData, chat.scriptstate, chat.hypaV2Data, chat.hypaV3Data])
                    for (const token of tokens.keys()) {
                        if (live.includes(token)) {
                            tokens.set(token, true)
                        }
                    }
                }
                continue
            }
            if (r < 0.55) {
                const memo = chat.message[pick(chat.message.length)].chatId ?? ''
                putToken(pick(4), memo)
                continue
            }
            const lengthBefore = chat.message.length
            const before = reachable(chat)
            const present = [...tokens.keys()].filter((token) => before.includes(token))
            const holders = new Map(present.map((token) => [token, occurrences(chat, token)]))
            const altBefore = (chat.alt ?? []).slice()
            let name: string
            let endPress = false
            if (r < 0.75) {
                const i = 1 + pick(chat.message.length - 1)
                detachTail(chat, i)
                name = `detachTail(${i})`
            } else {
                const i = rnd() < config.endBias ? chat.message.length : pick(chat.message.length + 1)
                let siblings = siblingsAt(chat, i)
                    .map((message) => message.chatId)
                    .filter((id): id is string => id !== undefined && (i >= chat.message.length || id !== chat.message[i].chatId))
                const end = endChild(chat)
                if (i === chat.message.length && !config.endAnyChild && siblings.length > 0 && end !== null) {
                    siblings = [end]
                }
                if (siblings.length === 0) {
                    continue
                }
                const target = siblings[pick(siblings.length)]
                switchTo(chat, i, target)
                endPress = i === lengthBefore
                name = `switchTo(${i},${target})${endPress ? ' END-PRESS' : ''}`
            }
            if (!stopS) {
                const bad = structuralFailure(chat, altBefore.filter((record) => !(chat.alt ?? []).includes(record)))
                if (bad !== null) {
                    out.structuralFailures++
                    stopS = true
                    out.firstStructural ??= `round ${round} step ${step} ${name} ${bad}`
                }
            }
            const after = reachable(chat)
            const lostAll = present.filter((token) => !after.includes(token))
            const isSupaDelete = (token: string): boolean => (holders.get(token) ?? []).every(([field, value]) => {
                return field === 'supaMemoryData' && typeof value === 'string' && deleted.has(firstLine(value))
            })
            if (lostAll.some(isSupaDelete)) {
                out.supaDeleteRounds++
            }
            const lost = lostAll.filter((token) => !isSupaDelete(token))
            const lostA = lost.filter((token) => tokens.get(token) !== true)
            const lostB = endPress ? lostA : lost
            if (!stopA && lostA.length > 0) {
                out.nonEndLosses++
                stopA = true
                out.firstNonEnd ??= `round ${round} step ${step} ${name} lost ${lostA.join(',')}`
            }
            if (!stopB && lostB.length > 0) {
                out.strictLosses++
                stopB = true
                out.firstStrict ??= `round ${round} step ${step} ${name} lost ${lostB.join(',')}`
            }
        }
    }
    return out
}

describe('reach of parked branch state over seeded sequences', () => {
    const configs: Config[] = []
    for (const endBias of [0, 0.5]) {
        for (const endAnyChild of [false, true]) {
            for (const withDelete of [false, true]) {
                configs.push({ endBias, endAnyChild, withDelete })
            }
        }
    }

    it.each(configs)('T79 no loss and a sound structure: endBias $endBias, any end child $endAnyChild, delete of the last message $withDelete', (config) => {
        const outcome = runConfig(config, 600, 30)
        console.info('T79', JSON.stringify(config), 'supaDeleteRounds', outcome.supaDeleteRounds)
        expect({
            nonEndLosses: outcome.nonEndLosses,
            strictLosses: outcome.strictLosses,
            structuralFailures: outcome.structuralFailures,
            first: [outcome.firstNonEnd, outcome.firstStrict, outcome.firstStructural],
        }).toEqual({ nonEndLosses: 0, strictLosses: 0, structuralFailures: 0, first: [null, null, null] })
    }, 60000)
})
