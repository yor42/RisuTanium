// @vitest-environment jsdom
// PROP-ALIAS: a property test over aliasing, adoption order, role changes and renames. Ops create source edges and
// one-level spreads, copy objects and arrays under object keys, alias a proxy at several places, replace a child
// and then place the old one, write `chaId`, change the list, store the list under another key, and assign an
// existing array as the list. The oracle is a traversal of the live tree from the db, which gives every proxy its
// true owner labels; the hook's side-effect-free `ownersOf` and one real write per step must include each label.
// Axiom S is asserted directly: no two visited plain-object proxies share a record.
//
// What it does not see: the traversal reads through proxies (as a save pass does), so its reads also run the link
// callback and tag raw elements before each check, not only link them. Raw edges (a proxy held inside a fresh
// container two or more levels deep) are outside it by construction. It cannot see a missing placement mark, because
// its list check accepts `listShape`; the directed tests in dbWriteHook.alias.svelte.test.ts cover placement, root-db
// replacement, sort/unshift/splice-insert and numeric ids.
//
// 100 seeds x 150 ops by default; set DBWRITEHOOK_PROP_SEEDS=300 for the long run used as release evidence.
import { describe, expect, it } from 'vitest'
import { untrack } from 'svelte'
import { describeDbWriteMark, installDbWriteHook, ownersOf } from '../dbWriteHook'
import { stateRecords } from '../svelteStatePatch'

const hits: string[] = []
function wrap<T extends object>(root: T): T {
    return installDbWriteHook(root, {
        sink: (mark) => { hits.push(describeDbWriteMark(mark)) },
        onError: (error) => { hits.push('sink:' + String(error)) },
        selectedChaId: () => undefined,
    })
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is object => typeof v === 'object' && v !== null
const validId = (id: unknown) => (typeof id === 'string' && id !== '') || (typeof id === 'number' && Number.isFinite(id))
function mulberry(seed: number) {
    let a = seed >>> 0
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const SEEDS = Number(process.env.DBWRITEHOOK_PROP_SEEDS ?? '100')
const FIRST = 1
const OPS = 150
const OPNAMES = ['slot nested spread', 'copy object key', 'copy array key', 'alias at object key', 'alias into array', 'replace then place old', 'chaId write', 'list op', 'whole list op', 'move between arrays', 'role after link', 'list stored under another key', 'existing array as list']
const ran = new Array<number>(OPNAMES.length).fill(0)
const sub5 = { object: 0, array: 0 }

function runSeed(seed: number): string[] {
    const rnd = mulberry(seed)
    const pick = <T,>(xs: T[]): T | undefined => xs.length === 0 ? undefined : xs[Math.floor(rnd() * xs.length)]
    let counter = 0
    const freshChar = (): Obj => { const n = ++counter; return { chaId: 'c' + n, name: 'n' + n, chats: [{ id: 'k' + n, message: [{ data: 'm' + n }], meta: { n, sub: { a: n } } }], extra: null, cfg: { n, sub: { a: n } } } }
    const st = $state({ db: { characters: [freshChar(), freshChar(), freshChar()], arrA: [freshChar()], slotA: { n: 1, sub: { a: 1 } }, slotB: null, modules: [{ id: 'mod1', cfg: { n: 1 } }], note: { text: 't' } } as Obj })
    const root = wrap(st)
    const db = root.db as Obj
    const trace: string[] = []
    const failures: string[] = []

    function scan(): Map<object, Set<string>> {
        const seen = new Map<object, Set<string>>()
        const visit = (node: unknown, label: string) => {
            if (!isObj(node)) return
            let s = seen.get(node)
            if (s === undefined) { s = new Set(); seen.set(node, s) }
            if (s.has(label)) return
            s.add(label)
            for (const k of Object.keys(node)) visit((node as Obj)[k], label)
        }
        untrack(() => {
            for (const k of Object.keys(db)) {
                const v = db[k]
                if (k === 'characters') {
                    if (!Array.isArray(v)) continue
                    let s = seen.get(v)
                    if (s === undefined) { s = new Set(); seen.set(v, s) }
                    s.add('LIST')
                    for (let i = 0; i < v.length; i++) {
                        const el: unknown = v[i]
                        if (!isObj(el)) continue
                        const id = Array.isArray(el) ? undefined : (el as Obj).chaId
                        visit(el, validId(id) ? 'char:' + String(id) : 'char:?')
                    }
                } else visit(v, 'top:' + k)
            }
        })
        return seen
    }
    function check(when: string): Map<object, Set<string>> {
        const seen = scan()
        const byRec = new Map<object, object>()
        for (const [node, labels] of seen) {
            if (!Array.isArray(node)) {
                const R = stateRecords.get(node)
                if (R !== undefined) {
                    const other = byRec.get(R)
                    if (other !== undefined && other !== node) failures.push(`${when}: axiom S: two plain-object proxies share a record`)
                    byRec.set(R, node)
                }
            }
            const owners = new Set(ownersOf(node))
            for (const label of labels) {
                if (label === 'LIST') continue
                const want = label === 'char:?' ? 'char:undefined' : label
                if (!owners.has(want)) failures.push(`${when}: ownersOf lacks ${label}; has ${JSON.stringify([...owners])}`)
            }
        }
        return seen
    }
    function writeCheck(seen: Map<object, Set<string>>, when: string) {
        const nodes = [...seen.keys()]
        const node = pick(nodes)
        if (node === undefined) return
        const labels = seen.get(node)!
        hits.length = 0
        const n = ++counter
        if (Array.isArray(node)) {
            if (labels.has('LIST')) node.push(freshChar())
            else node.push({ leaf: n })
        } else (node as Obj).w = n
        const h = new Set(hits)
        hits.length = 0
        for (const label of labels) {
            if (label === 'LIST') {
                if (![...h].some((x) => x.startsWith('newChar:') || x.startsWith('listShape:'))) failures.push(`${when}: list write without a list hit; has ${JSON.stringify([...h])}`)
                continue
            }
            const want = label === 'char:?' ? 'fallback:noCharId' : label
            if (!h.has(want)) failures.push(`${when}: write lacks ${label}; hits ${JSON.stringify([...h])}`)
        }
    }

    check('init')
    for (let step = 0; step < OPS && failures.length === 0; step++) {
        const seen = scan()
        const nodes = [...seen.keys()]
        const objs = nodes.filter((n) => !Array.isArray(n)) as Obj[]
        const arrs = nodes.filter((n) => Array.isArray(n)) as unknown[][]
        const list = db.characters as unknown[]
        const op = Math.floor(rnd() * OPNAMES.length)
        let desc = OPNAMES[op]
        let did = false
        untrack(() => {
            if (op === 0) {
                // Slot replaced by a nested copy (same id): the copy's chats array is a fresh raw array of old chats.
                const cur = db.characters as unknown[]
                const i = Math.floor(rnd() * Math.max(1, cur.length))
                const c = cur[i]
                if (isObj(c) && !Array.isArray(c) && Array.isArray((c as Obj).chats)) { cur[i] = { ...(c as Obj), chats: [...((c as Obj).chats as unknown[])] }; did = true }
            } else if (op === 1 || op === 2) {
                const P = pick(nodes) as Obj | undefined
                if (P === undefined) return
                const keys = Object.keys(P).filter((k) => isObj(P[k]) && (op === 1 ? !Array.isArray(P[k]) : Array.isArray(P[k])))
                const k = pick(keys)
                if (k === undefined) return
                const X = P[k]
                P[k] = Array.isArray(X) ? [...X] : { ...(X as Obj) }
                desc += ` ${k} (${Array.isArray(P) ? 'array parent' : 'object parent'})`
                did = true
            } else if (op === 3) {
                const v = pick(nodes)
                if (v === undefined) return
                const where = Math.floor(rnd() * 3)
                if (where === 0) db.slotA = v
                else if (where === 1) db.slotB = v
                else { const c = pick(objs); if (c === undefined) return; c.extra = v }
                desc += ' ' + where
                did = true
            } else if (op === 4) {
                const a = pick(arrs)
                const v = pick(nodes)
                if (a === undefined || v === undefined) return
                a.push(v)
                desc += a === list ? ' (list)' : ''
                did = true
            } else if (op === 5) {
                const P = pick(objs)
                if (P === undefined) return
                const keys = Object.keys(P).filter((k) => isObj(P[k]))
                const k = pick(keys)
                if (k === undefined) return
                const X = P[k] as object
                P[k] = Array.isArray(X) ? [...X] : { ...(X as Obj), chaId: 'z' + (++counter) }
                if (Array.isArray(X)) sub5.array++; else sub5.object++
                const where = Math.floor(rnd() * 5)
                if (where === 0) list.push(X)
                else if (where === 1) (db.arrA as unknown[]).push(X)
                else if (where === 2) db.slotB = X
                else if (where === 3 && Array.isArray(X)) db.characters = X
                else if (where === 4 && Array.isArray(X)) db.arrA = X
                else list.push(X)
                desc += ` ${k} (${Array.isArray(X) ? 'array' : 'object'}) at ${where}`
                did = true
            } else if (op === 6) {
                // Rename: half the time a listed character, otherwise any plain object.
                const cur = (db.characters as unknown[]).filter((c) => isObj(c) && !Array.isArray(c)) as Obj[]
                const o = rnd() < 0.5 ? pick(cur) : pick(objs)
                if (o === undefined) return
                o.chaId = 'r' + (++counter)
                did = true
            } else if (op === 7) {
                const sub = Math.floor(rnd() * 4)
                const cur = db.characters as unknown[]
                if (sub === 0 && cur.length > 1) cur.splice(Math.floor(rnd() * cur.length), 1)
                else if (sub === 1) cur.reverse()
                else if (sub === 2 && cur.length > 0) { const i = Math.floor(rnd() * cur.length); const c = cur[i]; if (isObj(c) && !Array.isArray(c)) cur[i] = { ...(c as Obj) } }
                else cur.push(freshChar())
                desc += ' ' + sub
                did = true
            } else if (op === 8) {
                const sub = Math.floor(rnd() * 3)
                if (sub === 0) db.characters = [...(db.characters as unknown[])]
                else if (sub === 1) { const old = db.characters; db.characters = db.arrA; db.arrA = old }
                else db.arrA = [...(db.arrA as unknown[])]
                desc += ' ' + sub
                did = true
            } else if (op === 9) {
                const from = pick(arrs)
                const to = pick(arrs)
                if (from === undefined || to === undefined || from.length === 0) return
                const [m] = from.splice(Math.floor(rnd() * from.length), 1)
                to.push(m)
                did = true
            } else if (op === 10) {
                const A = db.arrA as unknown[]
                db.arrA = [...A]
                ;(db.arrA as unknown[]).push(freshChar())
                const X = (db.arrA as unknown[])[(db.arrA as unknown[]).length - 1]
                const oldList = db.characters as unknown[]
                db.characters = A
                if (rnd() < 0.7) (db.characters as unknown[]).push(X)
                if (rnd() < 0.5) db.slotB = oldList
                did = true
            } else if (op === 11) {
                // The current list array also stored under another key; sometimes written through that alias.
                const where = Math.floor(rnd() * 3)
                if (where === 0) db.slotA = list
                else if (where === 1) db.slotB = list
                else { const c = pick(objs); if (c === undefined) return; c.extra = list }
                if (rnd() < 0.5) list.push(freshChar())
                desc += ' ' + where
                did = true
            } else if (op === 12) {
                // An existing non-list array assigned as the list; the old list sometimes kept under another key.
                const cand = arrs.filter((a) => a !== list)
                const a = pick(cand)
                if (a === undefined) return
                const old = db.characters
                db.characters = a
                if (rnd() < 0.5) db.slotB = old
                did = true
            }
        })
        if (did) ran[op]++
        hits.length = 0
        trace.push(desc + (did ? '' : ' (no-op)'))
        const after = check(`seed ${seed} step ${step} ${desc}`)
        if (failures.length === 0) writeCheck(after, `seed ${seed} step ${step} after ${desc}`)
    }
    if (failures.length > 0) failures[0] = `seed ${seed}: ${failures[0]} || last ops: ${trace.slice(-8).join(' ; ')}`
    return failures
}

describe('PROP-ALIAS', () => {
    it('every reachable proxy resolves to its true owners, a write marks them, and axiom S holds', () => {
        const first: string[] = []
        for (let seed = FIRST; seed < FIRST + SEEDS; seed++) {
            const f = runSeed(seed)
            if (f.length > 0 && first.length < 3) first.push(f[0])
        }
        expect(first).toEqual([])
        for (let i = 0; i < OPNAMES.length; i++) expect(ran[i], OPNAMES[i]).toBeGreaterThan(0)
        expect(sub5.object).toBeGreaterThan(0)
        expect(sub5.array).toBeGreaterThan(0)
    }, 900_000)
})
