import { describe, expect, test } from 'vitest'
import type { OpenAIChat } from './index.svelte'
import { recheckToContext } from './recheck'

/** A chat costs its content length plus 50 per multimodal part, so every sum is exact. */
const countChat = async (chat: OpenAIChat): Promise<number> => chat.content.length + (chat.multimodals?.length ?? 0) * 50

/** The send's recheck as it was written inline before the seam existed. */
async function frozenRecheck(formatedIn: OpenAIChat[], maxContextTokens: number): Promise<{ fits: boolean, inputTokens: number, formated: OpenAIChat[] }> {
    let formated = formatedIn
    let inputTokens = 0
    for (const chat of formated) {
        inputTokens += await countChat(chat)
    }
    if (inputTokens > maxContextTokens) {
        let pointer = 0
        while (inputTokens > maxContextTokens) {
            if (pointer >= formated.length) {
                return { fits: false, inputTokens, formated }
            }
            if (formated[pointer].removable) {
                inputTokens -= await countChat(formated[pointer])
                formated[pointer].content = ''
            }
            pointer++
        }
        formated = formated.filter((v) => {
            return v.content !== '' || (v.multimodals && v.multimodals.length > 0)
        })
    }
    return { fits: true, inputTokens, formated }
}

function rng(seed: number): () => number {
    let s = seed
    return () => {
        s = (s * 1664525 + 1013904223) % 4294967296
        return s / 4294967296
    }
}

type Kind = 'removable' | 'fixed' | 'memory' | 'image'

function arrayOf(seed: number, withMemory: boolean): OpenAIChat[] {
    const next = rng(seed)
    const n = 1 + Math.floor(next() * 9)
    return Array.from({ length: n }, (_, i): OpenAIChat => {
        const kinds: Kind[] = withMemory ? ['removable', 'removable', 'fixed', 'memory', 'image'] : ['removable', 'removable', 'fixed', 'image']
        const kind = kinds[Math.floor(next() * kinds.length)]
        const content = kind === 'image' && next() < 0.5 ? '' : 'x'.repeat(Math.floor(next() * 40))
        const chat: OpenAIChat = { role: 'user', content: content || (i % 2 ? 'y' : '') }
        if (kind === 'removable') chat.removable = true
        if (kind === 'memory') chat.memo = 'supaMemory'
        if (kind === 'image') {
            chat.multimodals = [{ type: 'image', base64: 'AAAA' }]
            if (next() < 0.5) chat.removable = true
        }
        return chat
    })
}

const clone = (chats: OpenAIChat[]): OpenAIChat[] => chats.map((c) => ({ ...c, multimodals: c.multimodals ? [...c.multimodals] : undefined }))
const totalOf = (chats: OpenAIChat[]): number => chats.reduce((a, c) => a + c.content.length + (c.multimodals?.length ?? 0) * 50, 0)

describe('recheckToContext', () => {
    for (const withMemory of [false, true]) {
        test(`RK1 guard (the base algorithm): without the last resort the seam equals the frozen loop on generated arrays${withMemory ? ' that hold supaMemory entries' : ''}`, async () => {
            let overs = 0
            let fails = 0
            for (let seed = 1; seed <= 400; seed++) {
                const chats = arrayOf(seed, withMemory)
                const total = totalOf(chats)
                for (const limit of [total + 5, total, Math.floor(total * 0.7), Math.floor(total * 0.3), 0]) {
                    const a = clone(chats)
                    const b = clone(chats)
                    const frozen = await frozenRecheck(a, limit)
                    const got = await recheckToContext({ formated: b, maxContextTokens: limit, count: countChat, memoryLastResort: false })
                    expect(got.fits).toBe(frozen.fits)
                    expect(got.inputTokens).toBe(frozen.inputTokens)
                    expect(got.droppedMemory).toBe(false)
                    expect(got.formated.map((c) => c.content)).toEqual(frozen.formated.map((c) => c.content))
                    expect(b.map((c) => c.content)).toEqual(a.map((c) => c.content))
                    if (total > limit) overs++
                    if (!frozen.fits) fails++
                }
            }
            expect(overs).toBeGreaterThan(500)
            expect(fails).toBeGreaterThan(50)
        })
    }

    test('RK3 guard: the flag with no supaMemory entry is the plain loop', async () => {
        for (let seed = 1; seed <= 300; seed++) {
            const chats = arrayOf(seed, false)
            const total = totalOf(chats)
            for (const limit of [total, Math.floor(total * 0.5), 0]) {
                const a = clone(chats)
                const frozen = await frozenRecheck(a, limit)
                const got = await recheckToContext({ formated: clone(chats), maxContextTokens: limit, count: countChat, memoryLastResort: true })
                expect(got.fits).toBe(frozen.fits)
                expect(got.inputTokens).toBe(frozen.inputTokens)
                expect(got.droppedMemory).toBe(false)
                expect(got.formated.map((c) => c.content)).toEqual(frozen.formated.map((c) => c.content))
            }
        }
    })

    function sendLike(): { formated: OpenAIChat[], memory: OpenAIChat, history: OpenAIChat } {
        const memory: OpenAIChat = { role: 'system', content: 'M'.repeat(40), memo: 'supaMemory' }
        const history: OpenAIChat = { role: 'user', content: 'H'.repeat(30), removable: true }
        const formated: OpenAIChat[] = [
            { role: 'system', content: 'P'.repeat(100) },
            history,
            memory,
            memory,
            { role: 'user', content: 'L'.repeat(10) },
        ]
        return { formated, memory, history }
    }

    test('RK2 mutant-evidenced: over with non-removable content, the memory entries go first (each occurrence once) and history survives', async () => {
        const { formated, memory, history } = sendLike()
        const got = await recheckToContext({ formated, maxContextTokens: 150, count: countChat, memoryLastResort: true })
        expect(got.fits).toBe(true)
        expect(got.droppedMemory).toBe(true)
        expect(got.inputTokens).toBe(100 + 30 + 10)
        expect(memory.content).toBe('')
        expect(history.content).toBe('H'.repeat(30))
        expect(got.formated.map((c) => c.content.length)).toEqual([100, 30, 10])
    })

    test('RK2 mutant-evidenced: still over after the memory entries and every removable entry are gone is fits false', async () => {
        const { formated, memory } = sendLike()
        const got = await recheckToContext({ formated, maxContextTokens: 100, count: countChat, memoryLastResort: true })
        expect(got.fits).toBe(false)
        expect(got.droppedMemory).toBe(true)
        expect(memory.content).toBe('')
        expect(got.inputTokens).toBe(110)
    })

    test('RK2 mutant-evidenced: the flag false leaves memory entries alone and fails as the plain loop does', async () => {
        const { formated, memory } = sendLike()
        const got = await recheckToContext({ formated, maxContextTokens: 195, count: countChat, memoryLastResort: false })
        expect(got.fits).toBe(true)
        expect(got.droppedMemory).toBe(false)
        expect(memory.content).toBe('M'.repeat(40))
        const tight = sendLike()
        const failed = await recheckToContext({ formated: tight.formated, maxContextTokens: 189, count: countChat, memoryLastResort: false })
        expect(failed.fits).toBe(false)
        expect(failed.droppedMemory).toBe(false)
        expect(tight.memory.content).toBe('M'.repeat(40))
    })

    test('RK2 new rule: a total that fits changes nothing even with the flag', async () => {
        const { formated, memory } = sendLike()
        const got = await recheckToContext({ formated, maxContextTokens: 1000, count: countChat, memoryLastResort: true })
        expect(got).toMatchObject({ fits: true, droppedMemory: false, inputTokens: 100 + 30 + 80 + 10 })
        expect(got.formated).toBe(formated)
        expect(memory.content).toHaveLength(40)
    })

    test('RK2 new rule: when a recount differs after the removable entries are gone, the last resort still clears the memory', async () => {
        const memory: OpenAIChat = { role: 'system', content: 'M'.repeat(40), memo: 'supaMemory' }
        const hist: OpenAIChat = { role: 'user', content: 'H'.repeat(30), removable: true }
        const formated: OpenAIChat[] = [{ role: 'system', content: 'P'.repeat(60) }, hist, memory]
        // The first count of the history is 30; the count taken when it is emptied is 1,
        // so the total is still over after every removable entry is emptied.
        let seen = 0
        const count = async (chat: OpenAIChat): Promise<number> => {
            if (chat === hist) return seen++ === 0 ? 30 : 1
            return chat.content.length
        }
        const got = await recheckToContext({ formated, maxContextTokens: 100, count, memoryLastResort: true })
        expect(got.fits).toBe(true)
        expect(got.droppedMemory).toBe(true)
        expect(memory.content).toBe('')
        expect(got.formated.map((c) => c.content.length)).toEqual([60])
    })
})
