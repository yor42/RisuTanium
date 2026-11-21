// @vitest-environment node
// ChroMemory S1b recall measurement (spec 11, S1 exit row). CI skips this file; run it by hand, one file at a time:
//   $env:LTM_S1B_OUT = "<dir under the temp folder>"
//   $env:LTM_REAL_AGG = "<aggregates.json outside the repository>"   (optional; the NF-real cells need it)
//   node node_modules/vitest/vitest.mjs run --config Agents/Tools/ltm-eval/vitest.ltm.config.ts Agents/Tools/ltm-eval/s1b-recall.harness.ts
//
// It replays the S0 gate draw (family GATE 610001, the final S0 settings, the llama3 app counter) and runs every ask
// fact turn through the src engine: the ranker and `packForRoom`. The src PACK recall (the walk and fit at
// limit = budget, before make-room) is the exit measure and is compared with the S0 gate value minus 0.05. The src
// DELIVERED recall (the same pack at the room make-room leaves, F kept chats) is reported beside it, not gating.
// Reports go to LTM_S1B_OUT only, which must lie under the temp folder. NF-real numbers stay there (MC-2633).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, test } from 'vitest'
import { ChatUnitIndex, RARE_SHARE } from '../../../src/ts/process/memory/chroMemory/chatIndex'
import { SHADOW_COUNT_CAP, type PackLine } from '../../../src/ts/process/memory/chroMemory/pack'
import { recordOf, type MessageRecord } from '../../../src/ts/process/memory/chroMemory/records'
import { HISTORY_FLOOR, packForRoom } from '../../../src/ts/process/memory/chroMemory/shadow'

const S0 = fileURLToPath(new URL('./s0/', import.meta.url))
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
interface Recall { kept: boolean, hit: boolean | null }
interface Rec { id: string, ask: { n: number, e: number }, allude: { n: number, e: number } }
interface Mods {
    sim: {
        ChatSim: new (chat: Chat, counter: Counter) => Sim
        runTurn(sim: Sim, chat: Chat, turn: Turn, q: Question, settings: Settings): { kept: boolean, recall: Recall, delivered: boolean }
        evalChatRecord(chat: Chat, counter: Counter, settings: Settings, opts: Record<string, unknown>): Rec
        recallOf(q: Question, units: OUnit[], packed: Set<OUnit>, first: number): Recall
    }
    turns: { buildTurns(chat: Chat, o: { regime: string, profile: unknown }): Turn[] }
    corpus: { drawWithReserve(spec: Record<string, unknown>, ctx: Record<string, unknown>): { chat: Chat } }
    profile: { specProfile(k: string): unknown, realProfile(file: string): unknown }
    counter: { loadCounter(kind: string): Promise<Counter> }
    stats: { growCell(sample: (k: number) => Rec, stop?: Record<string, number>): { chats: Rec[], status: string } }
}
interface Settings { builder: string, C: number, L: number, rareShare: number, budget: number, queries: number, tau: null, F: number }

// S0's final settings (sha 16df6c4c, decisions-s0.md) and the gate draw seed (O2).
const SETTINGS: Settings = { builder: 'rare', C: 32768, L: 1200, rareShare: 0.005, budget: 2400, queries: 1, tau: null, F: 4 }
const GATE_SEED = 610001
// The S0 gate value minus 0.05 (S0 ask recall .818, .837, .558, .525).
const CELLS = [
    { corpus: 'M4', lang: 'en', floor: 0.768 },
    { corpus: 'M4', lang: 'ko', floor: 0.787 },
    { corpus: 'NF-real', lang: 'en', floor: 0.508 },
    { corpus: 'NF-real', lang: 'ko', floor: 0.475 },
]

function outDir(): string {
    const dir = process.env.LTM_S1B_OUT
    if (!dir) throw new Error('LTM_S1B_OUT is not set')
    const abs = path.resolve(dir)
    const tmp = path.resolve(os.tmpdir()) + path.sep
    if (!(abs + path.sep).toLowerCase().startsWith(tmp.toLowerCase())) throw new Error('LTM_S1B_OUT must lie under the temp folder')
    fs.mkdirSync(abs, { recursive: true })
    return abs
}

const recOfKey = (key: string): number => Number(/^m(\d+)\u0000/.exec(key)![1])

/** One ask turn through the src ranker and `packForRoom`; null when the gold is all in the kept set. */
async function srcTurn(M: Mods, chat: Chat, records: MessageRecord[], index: ChatUnitIndex, sim: Sim, counter: Counter, turn: Turn, q: Question) {
    const C = SETTINGS.C
    const t = sim.trim(turn, C)
    if (!q.goldSpans.some((sp) => sp.msg < t.first)) return null
    const d0 = sim.d0(t.first, SETTINGS.L)
    const byKey = new Map(d0.units.map((u) => [`${u.rec}:${u.off}`, u]))
    index.reconcile(records.slice(0, t.first))
    const ranked = index.rank(turn.text, RARE_SHARE)
    const lineAt = (i: number): PackLine | undefined => {
        const unit = ranked.order[i]
        if (!unit) return undefined
        const pos = recOfKey(unit.key)
        const r = records[pos]
        return { unit, pos, label: String(r.index), name: r.name, text: unit.text, rank: i + 1 }
    }
    const args = {
        lineAt,
        budget: SETTINGS.budget,
        countText: async (s: string) => counter.len(s),
        countBlock: async (b: string) => counter.len(b) + 3,
        countCap: SHADOW_COUNT_CAP,
        cache: undefined,
    }
    const hitOf = (picks: { pos: number, unit: { off: number } }[]): boolean => {
        const set = new Set<OUnit>()
        for (const p of picks) {
            const u = byKey.get(`${p.pos}:${p.unit.off}`)
            if (!u) throw new Error('a packed unit is not an S0 unit')
            set.add(u)
        }
        return M.sim.recallOf(q, d0.units, set, t.first).hit === true
    }
    const pack = await packForRoom({ ...args, room: SETTINGS.budget })
    // The room make-room leaves: the context minus the newest F kept chats (K0's floor).
    const floorKept = t.kept.slice(Math.max(0, t.kept.length - Math.min(HISTORY_FLOOR, t.kept.length)))
    const room = C - floorKept.reduce((a, b) => a + b, 0)
    const delivered = room > 0 ? await packForRoom({ ...args, room }) : null
    return { pack: hitOf(pack.picks), delivered: delivered ? hitOf(delivered.picks) : false }
}

interface Tally { n: number, hit: number }
const tally = (): Tally => ({ n: 0, hit: 0 })
const add = (t: Tally, hit: boolean | null | undefined): void => { t.n++; if (hit) t.hit++ }
const ratio = (t: Tally): number => (t.n ? t.hit / t.n : 0)

let M: Mods
let counter: Counter

beforeAll(async () => {
    M = {
        sim: await imp('sim.mjs'),
        turns: await imp('turns.mjs'),
        corpus: await imp('corpus.mjs'),
        profile: await imp('profile.mjs'),
        counter: await imp('counter.mjs'),
        stats: await imp('stats.mjs'),
    }
    counter = await M.counter.loadCounter('llama3')
}, 600000)

describe('S1b recall, S0 gate draw 610001 at the final S0 settings', () => {
    for (const cell of CELLS) {
        const name = `${cell.corpus}-${cell.lang}`
        const needsAgg = cell.corpus === 'NF-real'
        const run = needsAgg && !process.env.LTM_REAL_AGG ? test.skip : test
        run(`cell ${name}`, async () => {
            const out = outDir()
            const profiles: Record<string, unknown> = {}
            if (needsAgg) profiles.real = M.profile.realProfile(process.env.LTM_REAL_AGG!)
            const profile = needsAgg ? profiles.real : M.profile.specProfile('short')
            const chats: Chat[] = []
            // The S0 stop rule on the S0 engine arm picks the chats, so this is the chats S0's gate read.
            const grown = M.stats.growCell((k) => {
                const { chat } = M.corpus.drawWithReserve({ drawSeed: GATE_SEED, corpus: cell.corpus, lang: cell.lang, i: k }, { profiles })
                chats.push(chat)
                return M.sim.evalChatRecord(chat, counter, SETTINGS, { profile, regime: 'POOL', nofact: false, totalTokens: true })
            })
            const simAsk = { e: 0, n: 0 }
            for (const r of grown.chats) { simAsk.e += r.ask.e; simAsk.n += r.ask.n }
            const srcPack = tally()
            const srcDelivered = tally()
            const simPack = tally()
            const simDelivered = tally()
            const kuSrc = tally()
            const kuSim = tally()
            const kuDelivered = tally()
            for (const chat of chats.slice(0, grown.chats.length)) {
                const turns = M.turns.buildTurns(chat, { regime: 'POOL', profile })
                const sim = new M.sim.ChatSim(chat, counter)
                const index = new ChatUnitIndex(chat.id)
                const records = chat.messages.map((m, i) =>
                    recordOf({ msg: { chatId: `m${i}`, role: m.role === 'char' ? 'char' : 'user', data: m.text }, chatIndex: i, name: chat.names.char, preWrap: m.text, data: m.text }, chat.names.user),
                )
                for (const turn of turns) {
                    if (turn.kind !== 'fact' || turn.style !== 'ask') continue
                    const q = chat.questions.find((x) => x.id === turn.qid)!
                    const s0 = M.sim.runTurn(sim, chat, turn, q, SETTINGS)
                    if (s0.kept) continue
                    const mine = await srcTurn(M, chat, records, index, sim, counter, turn, q)
                    if (!mine) throw new Error('S0 and src disagree on which ask turns have gold in D0')
                    add(simPack, s0.recall.hit)
                    add(simDelivered, s0.delivered)
                    add(srcPack, mine.pack)
                    add(srcDelivered, mine.delivered)
                    if (q.category === 'knowledge_update') {
                        add(kuSim, s0.recall.hit)
                        add(kuSrc, mine.pack)
                        add(kuDelivered, mine.delivered)
                    }
                }
            }
            const report = {
                cell: name,
                seed: GATE_SEED,
                counter: counter.kind,
                chats: grown.chats.length,
                stop: grown.status,
                askTurns: srcPack.n,
                s0AskRecallFromRecords: simAsk.n ? simAsk.e / simAsk.n : 0,
                pack: { src: ratio(srcPack), sim: ratio(simPack), floor: cell.floor, pass: ratio(srcPack) >= cell.floor },
                delivered: { src: ratio(srcDelivered), sim: ratio(simDelivered) },
                knowledgeUpdate: {
                    askTurns: kuSrc.n,
                    srcPackLatestPresent: `${kuSrc.hit}/${kuSrc.n}`,
                    simPackLatestPresent: `${kuSim.hit}/${kuSim.n}`,
                    srcDeliveredLatestPresent: `${kuDelivered.hit}/${kuDelivered.n}`,
                    specCases: 28,
                },
            }
            fs.writeFileSync(path.join(out, `cell-${name}.json`), JSON.stringify(report, null, 2))
            expect(report.askTurns).toBeGreaterThan(0)
            expect(report.pack.pass).toBe(true)
        }, 7_200_000)
    }
})
