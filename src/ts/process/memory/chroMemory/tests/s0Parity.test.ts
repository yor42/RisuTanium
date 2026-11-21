// @vitest-environment node
// The src retrieval modules rank and pack exactly as the frozen S0 oracle does, over the CI-sized synthetic corpus.
// The oracle lives under Agents/Tools/ltm-eval/s0 and is loaded as it is; CI skips Agents/**, so a change there is
// checked by running this file by hand (see Agents/Tools/ltm-eval/README.md).
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { beforeAll, describe, expect, test } from 'vitest'
import { ChatUnitIndex } from '../chatIndex'
import { packUnits, type PackLine } from '../pack'
import { recordOf, recordTextOf, type MessageRecord } from '../records'

const S0 = fileURLToPath(new URL('../../../../../../Agents/Tools/ltm-eval/s0/', import.meta.url))
const imp = async <T>(file: string): Promise<T> => (await import(/* @vite-ignore */ pathToFileURL(path.join(S0, file)).href)) as T

interface Msg { role: string, text: string }
interface Chat { id: string, corpus: string, names: { user: string, char: string }, messages: Msg[] }
interface Turn { kind: string, text: string, qid: string | null }
interface Counter { len(s: string): number }
interface OUnit { rec: number, off: number, text: string }
interface OPack { picks: OUnit[], block: string, T: number }
interface Profile { name: string }
interface Sim {
    trim(turn: { text: string }, C: number): { first: number }
    d0(first: number, L: number): { units: OUnit[] }
}
interface SimMod {
    ChatSim: new (chat: Chat, counter: Counter) => Sim
    orderFor(sim: Sim, turn: Turn, q: null, d0: { units: OUnit[] }, settings: Record<string, unknown>): number[]
    packFor(sim: Sim, order: OUnit[], budget: number): OPack
}

let SIM: SimMod
let chats: Chat[]
let buildTurns: (chat: Chat, o: { regime: string, profile: Profile }) => Turn[]
let specProfile: (k: string) => Profile
let stubCounter: () => Counter

beforeAll(async () => {
    SIM = await imp<SimMod>('sim.mjs')
    const corpus = await imp<{ ciSubset(): Chat[] }>('corpus.mjs')
    const turns = await imp<{ buildTurns: typeof buildTurns }>('turns.mjs')
    const profile = await imp<{ specProfile: typeof specProfile }>('profile.mjs')
    const counter = await imp<{ stubCounter: typeof stubCounter }>('counter.mjs')
    buildTurns = turns.buildTurns
    specProfile = profile.specProfile
    stubCounter = counter.stubCounter
    chats = corpus.ciSubset()
}, 120000)

const C = 32768
const BUDGET = 2400

function recordsFor(chat: Chat, first: number): MessageRecord[] {
    return chat.messages.slice(0, first).map((m, i) =>
        recordOf({ msg: { chatId: `m${i}`, role: m.role === 'char' ? 'char' : 'user', data: m.text }, chatIndex: i, name: chat.names.char, preWrap: m.text, data: m.text }, chat.names.user),
    )
}

describe('S0 parity', () => {
    test('guard: the src ranker and packer equal the S0 oracle on every sampled turn', async () => {
        expect(chats).toHaveLength(4)
        let compared = 0
        for (const chat of chats) {
            for (const m of chat.messages) expect(recordTextOf(m.text)).toBe(m.text)
            const turns = buildTurns(chat, { regime: 'POOL', profile: specProfile(chat.corpus === 'M4' ? 'short' : 'long') })
            const sampled = [...turns.filter((t) => t.kind === 'fact').slice(0, 6), ...turns.filter((t) => t.kind !== 'fact').slice(0, 3)]
            const stub = stubCounter()
            const sim = new SIM.ChatSim(chat, stub)
            const index = new ChatUnitIndex(chat.id)
            for (const turn of sampled) {
                const { first } = sim.trim(turn, C)
                const d0 = sim.d0(first, 1200)
                const order = SIM.orderFor(sim, turn, null, d0, { builder: 'rare', rareShare: 0.005, queries: 1, tau: null }).map((i) => d0.units[i])
                const oracle = SIM.packFor(sim, order, BUDGET)

                const records = recordsFor(chat, first)
                index.reconcile(records)
                const ranked = index.rank(turn.text, 0.005)
                const recOf = (key: string): number => Number(/^m(\d+)\u0000/.exec(key)![1])
                expect(ranked.order.map((u) => [recOf(u.key), u.off])).toEqual(order.map((u) => [u.rec, u.off]))

                const lines: PackLine[] = ranked.order.map((unit, i) => {
                    const r = records[recOf(unit.key)]
                    return { unit, pos: recOf(unit.key), label: String(r.index), name: r.name, text: unit.text, rank: i + 1 }
                })
                const out = await packUnits({ lines, budget: BUDGET, countText: async (t) => stub.len(t), countBlock: async (b) => stub.len(b) + 3, maxCounts: Infinity })
                expect(out.picks.map((p) => [p.pos, p.unit.off])).toEqual(oracle.picks.map((u) => [u.rec, u.off]))
                expect(out.block).toBe(oracle.block)
                expect(out.T).toBe(oracle.T)
                compared++
            }
        }
        expect(compared).toBe(36)
    }, 120000)
})
