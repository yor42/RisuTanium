// @vitest-environment jsdom
// Link lifetime of the patched Svelte proxy: replacing a container frees the old one while one link per carried
// child survives (RET); a held old container put back keeps its children owned (RET-PUTBACK); a state proxy stored
// by defineProperty is owned (DEFLINK); a throwing callback reaches the error sink and never fails the write (SINK);
// and the owner of every held descendant stays correct under random operations (PROP).
import { describe, expect, it } from 'vitest'
import v8 from 'node:v8'
import vm from 'node:vm'
import { describeDbWriteMark, installDbWriteHook, linkCountOf, ownersOf } from '../dbWriteHook'
import { setStateWriteHook } from '../svelteStatePatch'

v8.setFlagsFromString('--expose_gc')
const gc = vm.runInNewContext('gc') as () => void
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const N = 600
const SWIPES = 60
type Msg = { role: string, data: string }
type Chat = { id: string, message: Msg[], extra?: number }
type Char = { chaId: string, chats: Chat[], box?: { data: string } }

async function settle() { await tick(); gc(); await tick(); gc() }

const hits: string[] = []
function wrap<T extends object>(root: T): T {
    return installDbWriteHook(root, {
        sink: (mark) => { hits.push(describeDbWriteMark(mark)) },
        onError: (error) => { hits.push('sink:' + String(error)) },
        selectedChaId: () => undefined,
    })
}



describe('link lifetime', () => {
    it('RET: switchTo-shape replacements free the old containers and keep one live link per carried child', async () => {
        const raw = $state({ db: { characters: [{ chaId: 'cA', chats: [{ id: 'ch0', message: Array.from({ length: N }, (_, m) => ({ role: m % 2 ? 'char' : 'user', data: 'x'.repeat(200) + m })) }] }] as Char[] } })
        const root = wrap(raw) as typeof raw
        const chat = root.db.characters[0].chats[0]
        JSON.stringify(chat)
        const held = chat.message[5]
        await settle()
        const h0 = process.memoryUsage().heapUsed
        const olds: WeakRef<object>[] = []
        for (let s = 1; s <= SWIPES; s++) {
            olds.push(new WeakRef(chat.message))
            const next = chat.message.slice(0, N - 1)
            next.push({ role: 'char', data: 'swipe ' + s })
            chat.message = next
            JSON.stringify(chat)
            for (let i = 0; i < 20; i++) chat.message[i].data = 'w' + s + i
            await tick()
        }
        await settle()
        const growth = (process.memoryUsage().heapUsed - h0) / 1048576
        const alive = olds.filter((r) => r.deref() !== undefined).length
        hits.length = 0
        held.data = 'held write'
        const links = linkCountOf(chat.message[0])
        expect(alive).toBeLessThanOrEqual(1)
        expect(links).toBe(1)
        expect(hits).toContain('char:cA')
    })

    it('RET-PUTBACK: a held old container put back keeps its children owned', async () => {
        const raw = $state({ db: { characters: [{ chaId: 'cA', chats: [{ id: 'ch0', message: [{ role: 'user', data: 'a' }, { role: 'char', data: 'b' }] }] }] as Char[] } })
        const root = wrap(raw) as typeof raw
        const chat = root.db.characters[0].chats[0]
        const old = chat.message
        const child = old[1]
        for (let s = 0; s < 5; s++) { chat.message = [...chat.message.slice(0, 1), { role: 'char', data: 'alt' + s }]; JSON.stringify(chat); await tick() }
        chat.message = old
        await settle()
        hits.length = 0
        child.data = 'after put-back'
        expect(hits).toContain('char:cA')
    })

    it('DEFLINK: a state proxy stored by defineProperty is owned by the receiving character', () => {
        const raw = $state({ db: { characters: [{ chaId: 'cA', chats: [] }] as Char[] } })
        const root = wrap(raw) as typeof raw
        const box = $state({ data: 'box' })
        Object.defineProperty(root.db.characters[0], 'box', { value: box, writable: true, enumerable: true, configurable: true })
        hits.length = 0
        box.data = 'changed'
        expect(hits).toContain('char:cA')
    })

    it('SINK: a throwing callback reaches the registered error sink and never fails the write', () => {
        const raw = $state({ db: { characters: [{ chaId: 'cA', chats: [] }] as Char[] } })
        const root = wrap(raw) as typeof raw
        const sinkHits: unknown[] = []
        setStateWriteHook(() => { throw new Error('hook boom') }, (e: unknown) => { sinkHits.push(e) })
        let threw = false
        try { root.db.characters[0].chaId = 'cZ' } catch { threw = true }
        const value = root.db.characters[0].chaId
        const reRoot = $state({ db: {} })
        wrap(reRoot)
        expect(threw).toBe(false)
        expect(value).toBe('cZ')
        expect(sinkHits.length).toBe(1)
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

describe('link invariant property', () => {
    // Mirror of the structure, holding the same proxies the app would hold. After every operation each held chat,
    // message and box must resolve to an owner set that contains its structural owner (the character holding it).
    for (const seed of [1, 2, 3, 4, 5]) {
        it('PROP seed ' + seed, async () => {
            const r = rng(seed)
            const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)]
            const mk = (id: string, n: number): Chat => ({ id, message: Array.from({ length: n }, (_, m) => ({ role: 'user', data: id + ':' + m })) })
            const raw = $state({ db: { characters: [
                { chaId: 'cA', chats: [mk('A0', 3), mk('A1', 2)] },
                { chaId: 'cB', chats: [mk('B0', 2)] },
                { chaId: 'cC', chats: [] },
            ] as Char[] } })
            const root = wrap(raw) as typeof raw
            type MChat = { p: Chat, msgs: Msg[] }
            type MChar = { p: Char, id: string, chats: MChat[], box: { data: string } | null }
            const chars: MChar[] = root.db.characters.map((c) => ({ p: c, id: c.chaId, chats: [], box: null }))
            for (const mc of chars) for (let i = 0; i < mc.p.chats.length; i++) {
                const cp = mc.p.chats[i]
                mc.chats.push({ p: cp, msgs: Array.from({ length: cp.message.length }, (_, j) => cp.message[j]) })
            }
            let uid = 0
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
            for (let step = 0; step < 200; step++) {
                const mc = pick(chars)
                const kind = Math.floor(r() * 9)
                const ch = mc.chats.length > 0 ? pick(mc.chats) : null
                let op = 'none'
                if (kind === 0 && ch && ch.msgs.length > 0) {
                    const j = Math.floor(r() * ch.msgs.length); ch.p.message[j] = { role: 'char', data: 'n' + uid++ }; ch.msgs[j] = ch.p.message[j]; op = 'assign'
                } else if (kind === 1 && ch) {
                    ch.p.message.push({ role: 'char', data: 'p' + uid++ }); ch.msgs.push(ch.p.message[ch.p.message.length - 1]); op = 'push'
                } else if (kind === 2 && ch && ch.msgs.length > 0) {
                    const j = Math.floor(r() * ch.msgs.length); ch.p.message.splice(j, 1); ch.msgs.splice(j, 1); op = 'splice'
                } else if (kind === 3 && ch) {
                    const next = [...ch.p.message.slice(0, Math.max(0, ch.p.message.length - 1)), { role: 'char', data: 's' + uid++ }]
                    ch.p.message = next; ch.msgs = [...ch.msgs.slice(0, Math.max(0, ch.msgs.length - 1)), ch.p.message[ch.p.message.length - 1]]; op = 'spread'
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
                }
                ops.push(op)
                check(op)
                if (step % 25 === 0) await settle()
            }
        })
    }
})
