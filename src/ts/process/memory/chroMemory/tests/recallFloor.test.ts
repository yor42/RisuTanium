// @vitest-environment node
// The recall floor of spec 11 on the CI-sized seeded subset: every ask fact turn runs through the src ranker and
// `packForRoom` and through the frozen S0 simulator, with the same stub counter. Src pack recall must stay within
// 0.05 of the simulator's pack recall (`recall.hit`), src delivered recall (the pack at the room make-room leaves)
// within 0.05 of its `delivered`, and the same for the knowledge-update turns, whose gold is the latest value. The
// oracle lives under Agents/Tools/ltm-eval/s0 and is loaded as it is; CI skips Agents/**, so a change there is
// checked by running this file by hand. The full-size measurement is Agents/Tools/ltm-eval/s1b-recall.harness.ts.
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { beforeAll, describe, expect, test } from 'vitest'
import { ChatUnitIndex, RARE_SHARE } from '../chatIndex'
import { SHADOW_COUNT_CAP, type PackLine } from '../pack'
import { recordOf, type MessageRecord } from '../records'
import { HISTORY_FLOOR, packForRoom } from '../shadow'

const S0 = fileURLToPath(new URL('../../../../../../Agents/Tools/ltm-eval/s0/', import.meta.url))
const imp = async <T>(file: string): Promise<T> => (await import(/* @vite-ignore */ pathToFileURL(path.join(S0, file)).href)) as T

interface Msg { role: string, text: string }
interface Span { msg: number, start: number, end: number }
interface Question { id: string, category: string, goldSpans: Span[], staleSpans: Span[] }
interface Chat { id: string, corpus: string, names: { user: string, char: string }, messages: Msg[], questions: Question[] }
interface Turn { kind: string, style: string, text: string, qid: string | null }
interface Counter { len(s: string): number }
interface OUnit { rec: number, off: number, text: string }
interface Sim {
    trim(turn: { text: string }, C: number): { first: number, kept: number[] }
    d0(first: number, L: number): { units: OUnit[] }
}
interface Recall { hit: boolean | null }
interface Settings { builder: string, C: number, L: number, rareShare: number, budget: number, queries: number, tau: null, F: number }
interface SimMod {
    ChatSim: new (chat: Chat, counter: Counter) => Sim
    runTurn(sim: Sim, chat: Chat, turn: Turn, q: Question, settings: Settings): { kept: boolean, recall: Recall, delivered: boolean }
    recallOf(q: Question, units: OUnit[], packed: Set<OUnit>, first: number): Recall
}

let SIM: SimMod
let chats: Chat[]
let buildTurns: (chat: Chat, o: { regime: string, profile: unknown }) => Turn[]
let specProfile: (k: string) => unknown
let stubCounter: () => Counter

beforeAll(async () => {
    SIM = await imp<SimMod>('sim.mjs')
    const corpus = await imp<{ ciSubset(): Chat[] }>('corpus.mjs')
    buildTurns = (await imp<{ buildTurns: typeof buildTurns }>('turns.mjs')).buildTurns
    specProfile = (await imp<{ specProfile: typeof specProfile }>('profile.mjs')).specProfile
    stubCounter = (await imp<{ stubCounter: typeof stubCounter }>('counter.mjs')).stubCounter
    chats = corpus.ciSubset()
}, 120000)

// S0's final settings (L 1200, rareShare 0.005, F 4) with the context and the budget lowered: the small CI chats then
// leave a dropped set to recall from, and a halved walk budget visibly costs recall.
const SETTINGS: Settings = { builder: 'rare', C: 4096, L: 1200, rareShare: 0.005, budget: 800, queries: 1, tau: null, F: 4 }

interface Tally { n: number, hit: number }
const tally = (): Tally => ({ n: 0, hit: 0 })
const add = (t: Tally, hit: boolean | null | undefined): void => { t.n++; if (hit) t.hit++ }
const ratio = (t: Tally): number => (t.n ? t.hit / t.n : 0)
const recOfKey = (key: string): number => Number(/^m(\d+)\u0000/.exec(key)![1])

/**
 * Runs every ask fact turn of the subset through both engines. `budgetOf` lets a test change the budget the src
 * walk gets (a stand-in for the mutant that halves it); the simulator always runs at SETTINGS.budget.
 */
async function measure(budgetOf: (budget: number) => number, context: number = SETTINGS.C) {
    const settings = { ...SETTINGS, C: context }
    const total = { srcPack: tally(), srcDelivered: tally(), simPack: tally(), simDelivered: tally() }
    const ku = { srcPack: tally(), srcDelivered: tally(), simPack: tally(), simDelivered: tally() }
    for (const chat of chats) {
        const stub = stubCounter()
        const profile = specProfile(chat.corpus === 'M4' ? 'short' : 'long')
        const sim = new SIM.ChatSim(chat, stub)
        const index = new ChatUnitIndex(chat.id)
        const records: MessageRecord[] = chat.messages.map((m, i) =>
            recordOf({ msg: { chatId: `m${i}`, role: m.role === 'char' ? 'char' : 'user', data: m.text }, chatIndex: i, name: chat.names.char, preWrap: m.text, data: m.text }, chat.names.user),
        )
        for (const turn of buildTurns(chat, { regime: 'POOL', profile })) {
            if (turn.kind !== 'fact' || turn.style !== 'ask') continue
            const q = chat.questions.find((x) => x.id === turn.qid)!
            const s0 = SIM.runTurn(sim, chat, turn, q, settings)
            if (s0.kept) continue
            const t = sim.trim(turn, context)
            const d0 = sim.d0(t.first, settings.L)
            const byKey = new Map(d0.units.map((u) => [`${u.rec}:${u.off}`, u]))
            index.reconcile(records.slice(0, t.first))
            const ranked = index.rank(turn.text, RARE_SHARE)
            const args = {
                lineAt: (i: number): PackLine | undefined => {
                    const unit = ranked.order[i]
                    if (!unit) return undefined
                    const pos = recOfKey(unit.key)
                    return { unit, pos, label: String(records[pos].index), name: records[pos].name, text: unit.text, rank: i + 1 }
                },
                budget: budgetOf(SETTINGS.budget),
                countText: async (s: string) => stub.len(s),
                countBlock: async (b: string) => stub.len(b) + 3,
                countCap: SHADOW_COUNT_CAP,
                cache: undefined,
            }
            const hitOf = (picks: { pos: number, unit: { off: number } }[]): boolean => {
                const set = new Set<OUnit>()
                for (const p of picks) set.add(byKey.get(`${p.pos}:${p.unit.off}`)!)
                return SIM.recallOf(q, d0.units, set, t.first).hit === true
            }
            const pack = await packForRoom({ ...args, room: args.budget })
            const floorKept = t.kept.slice(Math.max(0, t.kept.length - Math.min(HISTORY_FLOOR, t.kept.length)))
            const room = context - floorKept.reduce((a, b) => a + b, 0)
            const delivered = room > 0 ? await packForRoom({ ...args, room }) : null
            const rows: [Tally, boolean | null | undefined][] = [
                [total.simPack, s0.recall.hit], [total.simDelivered, s0.delivered],
                [total.srcPack, hitOf(pack.picks)], [total.srcDelivered, delivered ? hitOf(delivered.picks) : false],
            ]
            for (const [tl, v] of rows) add(tl, v)
            if (q.category === 'knowledge_update') {
                add(ku.simPack, s0.recall.hit)
                add(ku.simDelivered, s0.delivered)
                add(ku.srcPack, rows[2][1])
                add(ku.srcDelivered, rows[3][1])
            }
        }
    }
    return { total, ku }
}

const WITHIN = 0.05
const TIGHT_CONTEXT = 1000

describe('recall floor (spec 11, CI subset)', () => {
    test('RF1 floor: src pack and delivered recall stay within 0.05 of the S0 simulator, knowledge updates too', async () => {
        const { total, ku } = await measure((b) => b)
        // Enough turns that the floor is not vacuous.
        expect(total.simPack.n).toBeGreaterThanOrEqual(20)
        expect(ku.simPack.n).toBeGreaterThanOrEqual(3)
        expect(total.srcPack.n).toBe(total.simPack.n)
        expect(ratio(total.srcPack)).toBeGreaterThanOrEqual(ratio(total.simPack) - WITHIN)
        expect(ratio(total.srcDelivered)).toBeGreaterThanOrEqual(ratio(total.simDelivered) - WITHIN)
        expect(ratio(ku.srcPack)).toBeGreaterThanOrEqual(ratio(ku.simPack) - WITHIN)
        expect(ratio(ku.srcDelivered)).toBeGreaterThanOrEqual(ratio(ku.simDelivered) - WITHIN)
    }, 120000)

    test('RF1 sensitivity: a walk budget cut in half breaks the pack floor', async () => {
        // The harness the floor test runs, with the src walk handed a smaller budget: the floor must notice.
        const { total } = await measure((b) => Math.floor(b / 2))
        expect(ratio(total.srcPack)).toBeLessThan(ratio(total.simPack) - WITHIN)
    }, 120000)

    test('RF1 room: where the kept chats leave less room than the budget, src delivered recall matches the simulator both ways', async () => {
        // A context this tight makes make-room evict: a pack that ignores the room delivers more than the simulator.
        const { total } = await measure((b) => b, TIGHT_CONTEXT)
        expect(total.simPack.n).toBeGreaterThanOrEqual(20)
        expect(ratio(total.srcDelivered)).toBeGreaterThanOrEqual(ratio(total.simDelivered) - WITHIN)
        expect(ratio(total.srcDelivered)).toBeLessThanOrEqual(ratio(total.simDelivered) + WITHIN)
    }, 120000)
})