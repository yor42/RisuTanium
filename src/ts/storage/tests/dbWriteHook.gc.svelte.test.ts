// @vitest-environment jsdom
// The character a write marks must not depend on garbage collection: ids come from tags and links, never from a
// live read through a weak reference. Every case replaces or copies characters, forces collection, and then writes
// through a proxy held from before. Shapes: one-level and nested spreads, list maps, duplicates, array-slot
// replacements, a list that is an existing state array, and a property test with forced collection.
import { describe, expect, it } from 'vitest'
import v8 from 'node:v8'
import vm from 'node:vm'
import { describeDbWriteMark, installDbWriteHook, linkCountOf, ownersOf } from '../dbWriteHook'

v8.setFlagsFromString('--expose_gc')
const gc = vm.runInNewContext('gc') as () => void
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
async function settle() { for (let i = 0; i < 3; i++) { await tick(); gc() } }
type Msg = { role: string, data: string }
type Chat = { id: string, message: Msg[], extra?: number }
type Char = { chaId?: string | number, name?: string, chats: Chat[], box?: { data: string } }

// Every mark the hook reports, as text (`char:<id>`, `newChar:<id>`, `top:<key>`, ...).
const hits: string[] = []
function wrap<T extends object>(root: T): T {
    return installDbWriteHook(root, {
        sink: (mark) => { hits.push(describeDbWriteMark(mark)) },
        onError: (error) => { hits.push('sink:' + String(error)) },
        selectedChaId: () => undefined,
    })
}

// Shapes: SPREAD1, SPREAD2, LISTMAP, DUP2, SLOTREP, RENAME-GC, NUMID-GC, NOID and the property test PROP-GC.

const mkDb = () => ({ db: { characters: [
    { chaId: 'cA', name: 'A', chats: [{ id: 'A0', message: [{ role: 'user', data: 'a0' }, { role: 'char', data: 'a1' }] }] },
    { chaId: 'cB', name: 'B', chats: [{ id: 'B0', message: [{ role: 'user', data: 'b0' }] }] },
] as Char[] } })

describe('character id independent of GC', () => {
    it('SPREAD1: slot replaced by a one-level spread, gc, held chat write', async () => {
        const st = $state(mkDb()); const root = wrap(st)
        const heldChat = root.db.characters[0].chats[0]
        JSON.stringify(root)
        ;(() => { const c = root.db.characters[0]; root.db.characters[0] = { ...c, name: 'A2' } })()
        await settle()
        hits.length = 0
        heldChat.id = 'A0x'
        expect(hits).toContain('char:cA')
    })

    it('SPREAD2-nogc: slot replaced by a two-level spread, no gc, held message write', () => {
        const st = $state(mkDb()); const root = wrap(st)
        const heldMsg = root.db.characters[0].chats[0].message[1]
        JSON.stringify(root)
        const keep = root.db.characters[0]
        root.db.characters[0] = { ...keep, chats: [...keep.chats] }
        hits.length = 0
        heldMsg.data = 'edited'
        expect(hits).toContain('char:cA')
    })

    it('SPREAD2-gc: two-level spread, gc, held writes before any read of the new path', async () => {
        const st = $state(mkDb()); const root = wrap(st)
        const heldMsg = root.db.characters[0].chats[0].message[1]
        const heldChat = root.db.characters[0].chats[0]
        JSON.stringify(root)
        let oldRef: WeakRef<object> | null = null
        ;(() => { const c = root.db.characters[0]; oldRef = new WeakRef(c); root.db.characters[0] = { ...c, chats: [...c.chats] } })()
        await settle()
        const oldAlive = oldRef!.deref() !== undefined
        hits.length = 0
        heldMsg.data = 'edited after gc'
        const h1 = [...hits]
        hits.length = 0
        heldChat.id = 'A0y'
        const h2 = [...hits]
        expect(oldAlive).toBe(false)
        expect(h1).toContain('char:cA')
        expect(h2).toContain('char:cA')
    })

    it('LISTMAP-gc: list replaced by a map of spreads, gc, held chat write', async () => {
        const st = $state(mkDb()); const root = wrap(st)
        const heldChat = root.db.characters[1].chats[0]
        JSON.stringify(root)
        let oldRef: WeakRef<object> | null = null
        ;(() => { oldRef = new WeakRef(root.db.characters[1]); root.db.characters = root.db.characters.map((c) => ({ ...c })) })()
        await settle()
        const oldAlive = oldRef!.deref() !== undefined
        hits.length = 0
        heldChat.id = 'B0x'
        expect(oldAlive).toBe(false)
        expect(hits).toContain('char:cB')
    })

    it('RENAME-GC: chaId renamed by a write, then a two-level spread, gc, held write marks the new id', async () => {
        const st = $state(mkDb()); const root = wrap(st)
        const heldMsg = root.db.characters[0].chats[0].message[0]
        JSON.stringify(root)
        root.db.characters[0].chaId = 'cA2'
        ;(() => { const c = root.db.characters[0]; root.db.characters[0] = { ...c, chats: [...c.chats] } })()
        await settle()
        hits.length = 0
        heldMsg.data = 'x'
        expect(hits).toContain('char:cA2')
    })

    it('NUMID-GC: a numeric chaId survives the two-level spread and gc', async () => {
        const raw = mkDb()
        raw.db.characters[0].chaId = 7
        const st = $state(raw); const root = wrap(st)
        const heldChat = root.db.characters[0].chats[0]
        JSON.stringify(root)
        ;(() => { const c = root.db.characters[0]; root.db.characters[0] = { ...c, chats: [...c.chats] } })()
        await settle()
        hits.length = 0
        heldChat.id = 'n'
        expect(hits).toContain('char:7')
    })

    it('NOID: an owner with no id takes the logged fallback, never a silent return', () => {
        const raw = mkDb()
        delete raw.db.characters[0].chaId
        const st = $state(raw); const root = wrap(st)
        const heldChat = root.db.characters[0].chats[0]
        hits.length = 0
        heldChat.id = 'z'
        expect(hits).toContain('fallback:noCharId')
        // The cause is recorded through recordCaughtError, so a release build (which strips console output) keeps it.
        expect(window.__risuTaniumErrors?.at(-1)?.site).toBe('dbWriteHook.noCharId')
    })

    it('DUP2: a duplicate made by a two-level spread is marked when placed and owns the shared chats after the first full read', () => {
        const st = $state(mkDb()); const root = wrap(st)
        const heldChat = root.db.characters[0].chats[0]
        JSON.stringify(root)
        const c = root.db.characters[0]
        hits.length = 0
        root.db.characters.push({ ...c, chaId: 'cA-dup', chats: [...c.chats] })
        const placed = [...hits]
        hits.length = 0
        heldChat.id = 'shared-before-read'
        const beforeRead = [...hits]
        JSON.stringify(root.db.characters[2])
        hits.length = 0
        heldChat.id = 'shared-after-read'
        const afterRead = [...hits]
        expect(placed).toContain('newChar:cA-dup')
        expect(beforeRead).toContain('char:cA')
        expect(afterRead).toContain('char:cA')
        expect(afterRead).toContain('char:cA-dup')
    })

    it('SLOTREP: 100 array-slot replacements carrying a child; old chats freed, links bounded by the replacement count', async () => {
        const st = $state(mkDb()); const root = wrap(st)
        const char = root.db.characters[0]
        const heldArr = char.chats[0].message
        JSON.stringify(root)
        const olds: WeakRef<object>[] = []
        for (let s = 0; s < 100; s++) { olds.push(new WeakRef(char.chats[0])); char.chats[0] = { ...char.chats[0], id: 'A0-' + s }; JSON.stringify(char); await tick() }
        await settle()
        const alive = olds.filter((r) => r.deref() !== undefined).length
        hits.length = 0
        heldArr[0].data = 'w'
        const links = linkCountOf(heldArr)
        expect(alive).toBe(0)
        expect(links).toBeLessThanOrEqual(101)
        expect(hits).toContain('char:cA')
    })
})

function makeBox(data: string) {
    const box = $state({ data })
    return box
}
function rng(seed: number) {
    let a = seed >>> 0
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

describe('link invariant property with character replacements and forced GC', () => {
    // Ops 0-8 assign, push, splice, spread, delete, move (splice and spread), put back and define; 9 replaces a
    // character slot by a nested spread, 10 replaces the list by a map of spreads, 11 duplicates a character by a
    // nested spread. Ops 9-11 force a GC before the check and then write through a held descendant. The run must
    // observe at least one replaced character proxy collected before its check.
    for (const seed of [1, 2, 3, 4, 5]) {
        it('PROP-GC seed ' + seed, async () => {
            const r = rng(seed)
            const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)]
            const mk = (id: string, n: number): Chat => ({ id, message: Array.from({ length: n }, (_, m) => ({ role: 'user', data: id + ':' + m })) })
            const st = $state({ db: { characters: [
                { chaId: 'cA', chats: [mk('A0', 3), mk('A1', 2)] },
                { chaId: 'cB', chats: [mk('B0', 2)] },
                { chaId: 'cC', chats: [] },
            ] as Char[] } })
            const root = wrap(st)
            type MChat = { p: Chat, msgs: Msg[] }
            type MChar = { p: Char, id: string, chats: MChat[], box: { data: string } | null }
            const chars: MChar[] = root.db.characters.map((c) => ({ p: c, id: String(c.chaId), chats: [], box: null }))
            for (const mc of chars) for (let i = 0; i < mc.p.chats.length; i++) {
                const cp = mc.p.chats[i]
                mc.chats.push({ p: cp, msgs: Array.from({ length: cp.message.length }, (_, j) => cp.message[j]) })
            }
            let uid = 0, dups = 0, deadSeen = 0, gcOps = 0
            const ops: string[] = []
            const check = (op: string) => {
                for (const mc of chars) {
                    const want = 'char:' + mc.id
                    if (mc.box !== null && !ownersOf(mc.box).includes(want)) throw new Error(`seed ${seed} after ${op}: box of ${mc.id} -> ${ownersOf(mc.box)} | ${ops.slice(-4).join(' ; ')}`)
                    for (const ch of mc.chats) {
                        if (!ownersOf(ch.p).includes(want)) throw new Error(`seed ${seed} after ${op}: chat of ${mc.id} -> ${ownersOf(ch.p)} | ${ops.slice(-4).join(' ; ')}`)
                        for (const m of ch.msgs) if (!ownersOf(m).includes(want)) throw new Error(`seed ${seed} after ${op}: msg of ${mc.id} -> ${ownersOf(m)} | ${ops.slice(-4).join(' ; ')}`)
                    }
                }
            }
            const probeWrite = (mc: MChar, op: string) => {
                const ch = mc.chats.find((x) => x.msgs.length > 0)
                if (ch === undefined) return
                hits.length = 0
                ch.msgs[0].data = 'g' + uid++
                if (!hits.includes('char:' + mc.id)) throw new Error(`seed ${seed} after ${op}: held write in ${mc.id} -> ${JSON.stringify(hits)} | ${ops.slice(-4).join(' ; ')}`)
            }
            for (let step = 0; step < 240; step++) {
                const mc = pick(chars)
                const kind = Math.floor(r() * 12)
                const ch = mc.chats.length > 0 ? pick(mc.chats) : null
                let op = 'none'
                let olds: WeakRef<object>[] | null = null
                let probe: MChar | null = null
                if (kind === 0 && ch && ch.msgs.length > 0) {
                    const j = Math.floor(r() * ch.msgs.length); ch.p.message[j] = { role: 'char', data: 'n' + uid++ }; ch.msgs[j] = ch.p.message[j]; op = 'assign'
                } else if (kind === 1 && ch) {
                    ch.p.message.push({ role: 'char', data: 'p' + uid++ }); ch.msgs.push(ch.p.message[ch.p.message.length - 1]); op = 'push'
                } else if (kind === 2 && ch && ch.msgs.length > 0) {
                    const j = Math.floor(r() * ch.msgs.length); ch.p.message.splice(j, 1); ch.msgs.splice(j, 1); op = 'splice'
                } else if (kind === 3 && ch) {
                    const next = [...ch.p.message.slice(0, Math.max(0, ch.p.message.length - 1)), { role: 'char', data: 's' + uid++ }]
                    ch.p.message = next; ch.msgs.splice(0, ch.msgs.length, ...ch.msgs.slice(0, Math.max(0, ch.msgs.length - 1)), ch.p.message[ch.p.message.length - 1]); op = 'spread'
                } else if (kind === 4 && ch) {
                    ch.p.extra = uid++; delete ch.p.extra; op = 'delete'
                } else if (kind === 5 && ch) {
                    const to = pick(chars.filter((x) => x !== mc)); const i = mc.chats.indexOf(ch)
                    const [moved] = mc.p.chats.splice(i, 1); to.p.chats.push(moved); mc.chats.splice(i, 1); to.chats.push(ch); op = 'move-splice ' + mc.id + '->' + to.id
                } else if (kind === 6 && ch) {
                    const to = pick(chars.filter((x) => x !== mc)); const i = mc.chats.indexOf(ch)
                    to.p.chats = [...to.p.chats, mc.p.chats[i]]; mc.p.chats = mc.p.chats.filter((_, k) => k !== i); mc.chats.splice(i, 1); to.chats.push(ch); op = 'move-spread ' + mc.id + '->' + to.id
                } else if (kind === 7 && ch) {
                    const old = ch.p.message; ch.p.message = old.slice(); ch.p.message = old; op = 'put-back'
                } else if (kind === 8) {
                    const box = makeBox('box' + uid++)
                    Object.defineProperty(mc.p, 'box', { value: box, writable: true, enumerable: true, configurable: true }); mc.box = box; op = 'define'
                } else if (kind === 9) {
                    const i = chars.indexOf(mc)
                    olds = [new WeakRef(mc.p)]
                    ;(() => { const c = root.db.characters[i]; root.db.characters[i] = { ...c, chats: [...c.chats] } })()
                    mc.p = root.db.characters[i]; probe = mc; op = 'slot-nested-spread ' + mc.id
                } else if (kind === 10) {
                    olds = chars.map((x) => new WeakRef(x.p))
                    root.db.characters = root.db.characters.map((c) => ({ ...c }))
                    for (let k = 0; k < chars.length; k++) chars[k].p = root.db.characters[k]
                    probe = mc; op = 'list-map-spread'
                } else if (kind === 11 && dups < 3) {
                    const dupId = 'd' + uid++
                    hits.length = 0
                    ;(() => { const c = mc.p; root.db.characters.push({ ...c, chaId: dupId, chats: [...c.chats] }) })()
                    if (!hits.includes('newChar:' + dupId)) throw new Error(`seed ${seed}: duplicate ${dupId} not marked when placed: ${JSON.stringify(hits)}`)
                    const p = root.db.characters[root.db.characters.length - 1]
                    JSON.stringify(p) // the save pass that services the placement mark reads the duplicate through proxies
                    chars.push({ p, id: dupId, chats: [...mc.chats], box: mc.box })
                    dups++; probe = mc; op = 'duplicate ' + mc.id + '->' + dupId
                }
                ops.push(op)
                if (probe !== null) {
                    gcOps++
                    await settle()
                    if (olds !== null) deadSeen += olds.filter((w) => w.deref() === undefined).length
                    check(op)
                    probeWrite(probe, op)
                } else {
                    check(op)
                    if (step % 25 === 0) await settle()
                }
            }
            expect(deadSeen).toBeGreaterThan(0)
        })
    }
})


// A record becomes a character record when its parent becomes the list (a whole-list or whole-db write).
// Characters read through a state array before that array is assigned as the list must still get their tag.

const mkChars = (): Char[] => [{ chaId: 'cL', chats: [{ id: 'L0', message: [{ role: 'user', data: 'l' }] }] }]

describe('an array becomes the list after its children were linked', () => {
    it('LISTPROXY-gc: an existing state array assigned as the list; a nested-spread slot replacement; gc; held write', async () => {
        const st = $state({ db: { characters: [] as Char[] } })
        const root = wrap(st)
        JSON.stringify(root)
        const local = $state(mkChars())
        const heldChat = local[0].chats[0]
        JSON.stringify(local)
        root.db.characters = local
        ;(() => { const c = root.db.characters[0]; root.db.characters[0] = { ...c, chats: [...c.chats] } })()
        await settle()
        hits.length = 0
        heldChat.id = 'x'
        expect(hits).toContain('char:cL')
    })

    it('DBPROXY-gc: an existing state db assigned as the db; a nested-spread slot replacement; gc; held write', async () => {
        const st = $state({ db: { characters: [] as Char[] } })
        const root = wrap(st)
        JSON.stringify(root)
        const localDb = $state({ characters: mkChars() })
        const heldChat = localDb.characters[0].chats[0]
        JSON.stringify(localDb)
        root.db = localDb
        ;(() => { const c = root.db.characters[0]; root.db.characters[0] = { ...c, chats: [...c.chats] } })()
        await settle()
        hits.length = 0
        heldChat.id = 'y'
        expect(hits).toContain('char:cL')
    })

    it('FOREIGN-gc: a fresh list carrying a foreign character proxy; a nested-spread slot replacement; gc; held write', async () => {
        const st = $state({ db: { characters: [{ chaId: 'cA', chats: [] }] as Char[] } })
        const root = wrap(st)
        JSON.stringify(root)
        const local = $state(mkChars())
        const heldChat = local[0].chats[0]
        JSON.stringify(local)
        root.db.characters = [...root.db.characters, local[0]]
        ;(() => { const c = root.db.characters[1]; root.db.characters[1] = { ...c, chats: [...c.chats] } })()
        await settle()
        hits.length = 0
        heldChat.id = 'z'
        expect(hits).toContain('char:cL')
    })
})


// A character record is never shared (axiom S). A character proxy also held under an object key keeps its own id
// when that key is replaced by a fresh object: only arrays adopt a record, so the fresh object has its own.

describe('a plain-object record is never adopted', () => {
    it('TAGADOPT: replacing an object key that held a character proxy leaves the character marked by its own id', async () => {
        const st = $state({ db: { characters: [{ chaId: 'cA', chats: [{ id: 'A0', message: [{ role: 'user', data: 'a' }] }] }] as Char[], pinned: null as Char | null } })
        const root = wrap(st)
        const heldChat = root.db.characters[0].chats[0]
        JSON.stringify(root)
        root.db.pinned = root.db.characters[0]
        root.db.pinned = { chaId: 'cX', chats: [] }
        ;(() => { const c = root.db.characters[0]; root.db.characters[0] = { ...c, chats: [...c.chats] } })()
        await settle()
        root.db.pinned!.chaId = 'cY'
        hits.length = 0
        heldChat.id = 'p'
        expect(hits).toContain('char:cA')
    })
})
