// @vitest-environment jsdom
// The explicit write hook on its own and on the real DBState. Probe groups:
// - hook reads leave Svelte reactivity as on the stock proxy (deletes of absent keys, foreign state values,
//   read-only properties, freezing), checked against the raw `$state` root and, for literal values, against what
//   unpatched Svelte 5.57.3 produces;
// - the list rule and spread rule (a held reference after a spread clone, a deep move, a foreign character);
// - the real `DBState` with the real change effects and save scheduler: identity, owner by identity after a splice,
//   rename, spread clone, same value, snapshots, deletes, moves and `$state` over a db object.
import { describe, expect, it, vi } from 'vitest'
import { flushSync } from 'svelte'
import { DBState, selectedCharID, selIdState } from '../../stores.svelte'
import { describeDbWriteMark, installDbWriteHook, ownersOf, uninstallDbWriteHook } from '../dbWriteHook'
import { markDbWrite } from '../characterSaveMarks'
import type { DbWriteMark } from '../characterSaveMarks'
import { makeDb, startMiniPage } from './dbWriteMarksMiniPage.svelte'

// The parser's module-level effect reads selIdState while the stores module is still initialising; these tests never parse.
vi.mock('../../parser/parser.svelte', () => ({
    hasher: vi.fn((s: string) => s),
    risuChatParser: vi.fn((text: string) => text ?? ''),
    assetRegex: /{{asset:[^}]+}}/g,
}))
vi.mock('../../parser/chatML', () => ({ parseChatML: vi.fn(() => []) }))

// Every mark the hook reports, as text (`char:<id>`, `newChar:<id>`, `top:<key>`, ...).
const hits: string[] = []
function wrap<T extends object>(root: T): T {
    return installDbWriteHook(root, {
        sink: (mark) => { hits.push(describeDbWriteMark(mark)) },
        onError: (error) => { hits.push('sink:' + String(error)) },
        selectedChaId: () => undefined,
    })
}
// The real DBState with the real sink: marks land in the page's tracker and scheduler.
function installOnDBState() {
    installDbWriteHook(DBState, {
        sink: (mark) => { hits.push(describeDbWriteMark(mark)); markDbWrite(mark) },
        onError: (error) => { hits.push('sink:' + String(error)) },
        selectedChaId: () => undefined,
    })
}

// Each reactivity case runs the raw $state (base) and the hooked root and asserts parity.
function setup(hooked: boolean) {
    const raw = $state({ db: { characters: [{ chaId: 'cA', chats: [{ id: 'A0', note: 'n' }] as Record<string, unknown>[] }, { chaId: 'cB', chats: [] as Record<string, unknown>[] }] } })
    return (hooked ? wrap(raw) : raw) as typeof raw
}

function delAbsentReruns(hooked: boolean, readFirst: boolean): number {
    const root = setup(hooked)
    if (readFirst) void (root.db.characters[0].chats[0] as Record<string, unknown>).absentKey
    let runs = 0
    const stop = $effect.root(() => { $effect(() => { runs++; void Object.keys(root.db.characters[0].chats[0]) }) })
    flushSync()
    const r0 = runs
    delete (root.db.characters[0].chats[0] as Record<string, unknown>).absentKey
    flushSync()
    stop()
    return runs - r0
}
function delInDerived(hooked: boolean): string {
    const root = setup(hooked)
    let err = 'none'
    const stop = $effect.root(() => {
        const d = $derived.by(() => {
            try { delete (root.db.characters[0].chats[0] as Record<string, unknown>).absentKey2 } catch (e) { err = String((e as Error).message).slice(0, 40) }
            return 1
        })
        $effect(() => { void d })
    })
    flushSync()
    stop()
    return err
}
function foreign(hooked: boolean) {
    const root = setup(hooked)
    const innerBefore = root.db.characters[0].chats
    const local = $state({ inner: innerBefore, other: 0 }) as Record<string, unknown>
    let runs = 0
    const stop = $effect.root(() => { $effect(() => { runs++; (root.db.characters[0] as Record<string, unknown>).extra = local }) })
    flushSync()
    const r0 = runs
    local.other = 1
    flushSync()
    local.added = 2
    flushSync()
    stop()
    return { reruns: runs - r0, innerKept: local.inner === innerBefore }
}
function readOnlyNested(hooked: boolean): string {
    const root = setup(hooked)
    const obj = {} as Record<string, unknown>
    Object.defineProperty(obj, 'ro', { value: root.db.characters[0].chats, writable: false, enumerable: true, configurable: true })
    try { (root.db.characters[1] as Record<string, unknown>).extra = obj; return 'ok' } catch (e) { return 'threw:' + String((e as Error).message).slice(0, 40) }
}

describe('F1 hook reads leave Svelte reactivity unchanged', () => {
    it('DELABSENT: delete of an absent key reruns an ownKeys reader exactly as the raw proxy', () => {
        const base = delAbsentReruns(false, false), hook = delAbsentReruns(true, false)
        expect(hook).toBe(base)
    })
    it('DELABSENT-read: the same after the absent key was read once (source exists)', () => {
        const base = delAbsentReruns(false, true), hook = delAbsentReruns(true, true)
        expect(hook).toBe(base)
    })
    it('DELDERIVED: delete of an absent key inside $derived does not throw where the raw proxy is silent', () => {
        const base = delInDerived(false), hook = delInDerived(true)
        expect(hook).toBe(base)
    })
    it('FOREIGN: assigning a foreign $state value adds no dependency and does not mutate it', () => {
        const base = foreign(false), hook = foreign(true)
        expect(hook).toEqual(base)
    })
    it('RONESTED: a non-writable own property holding a db object does not make the write throw', () => {
        const base = readOnlyNested(false), hook = readOnlyNested(true)
        expect(hook).toBe(base)
    })
})

describe('F2 seen check before fill', () => {
    it('T6: a character that is already a $state proxy, assigned into a list slot, is marked by id', () => {
        const root = setup(true)
        void root.db.characters[0]; void root.db.characters[1]
        const foreignChar = $state({ chaId: 'cF', chats: [] as Record<string, unknown>[] })
        hits.length = 0
        root.db.characters[1] = foreignChar
        const got = [...hits]
        expect(got).toContain('newChar:cF')
    })
    it('T5-guard: a splice shift of seen elements marks no id', () => {
        const root = setup(true)
        void root.db.characters[0]; void root.db.characters[1]
        hits.length = 0
        root.db.characters.splice(0, 1)
        const got = [...hits]
        expect(got.filter((h) => h.startsWith('newChar:'))).toEqual([])
    })
})

describe('E5 preventExtensions', () => {
    it('FREEZE: a refused freeze leaves the wrapper readable (keys, JSON) as the raw proxy', () => {
        const res = (hooked: boolean) => {
            const root = setup(hooked)
            const c = root.db.characters[0]
            let froze = 'ok'
            try { Object.freeze(c) } catch (e) { froze = 'threw' }
            let keys = 'ok'
            try { Object.keys(c); JSON.stringify(c) } catch (e) { keys = 'threw:' + String((e as Error).message).slice(0, 40) }
            return { froze, keys }
        }
        const base = res(false), hook = res(true)
        expect(hook.froze).toBe('threw')
        expect(hook.keys).toBe(base.keys)
    })
})

describe('F1 second delete', () => {
    it('DELTWICE: two deletes of the same absent key rerun an ownKeys reader exactly as the raw proxy', () => {
        const run = (hooked: boolean) => {
            const root = setup(hooked)
            let runs = 0
            const stop = $effect.root(() => { $effect(() => { runs++; void Object.keys(root.db.characters[0].chats[0]) }) })
            flushSync()
            const r0 = runs
            delete (root.db.characters[0].chats[0] as Record<string, unknown>).absentKey3
            flushSync()
            delete (root.db.characters[0].chats[0] as Record<string, unknown>).absentKey3
            flushSync()
            stop()
            return runs - r0
        }
        const base = run(false), hook = run(true)
        expect(hook).toBe(base)
    })
})

// The literal values below were produced by unpatched Svelte 5.57.3, so they pin parity with the stock proxy.
describe('stock-Svelte literals', () => {
    it('LITERALS: hooked results equal the stock base values', () => {
        const twice = () => {
            const root = setup(true)
            let runs = 0
            const stop = $effect.root(() => { $effect(() => { runs++; void Object.keys(root.db.characters[0].chats[0]) }) })
            flushSync()
            const r0 = runs
            delete (root.db.characters[0].chats[0] as Record<string, unknown>).absentKey4
            flushSync()
            delete (root.db.characters[0].chats[0] as Record<string, unknown>).absentKey4
            flushSync()
            stop()
            return runs - r0
        }
        const got = { delAbsent: delAbsentReruns(true, false), delAbsentRead: delAbsentReruns(true, true), derived: delInDerived(true), foreign: foreign(true), ro: readOnlyNested(true), twice: twice() }
        expect(got).toEqual({ delAbsent: 0, delAbsentRead: 1, derived: 'none', foreign: { reruns: 0, innerKept: true }, ro: 'ok', twice: 0 })
    })
})

type Msg = { data: string }
type Chat = { id: string, message: Msg[] }
type Char = { chaId: string, chats: Chat[] }
function setupMoves() {
    const raw = $state({ db: { characters: [
        { chaId: 'cA', chats: [{ id: 'A0', message: [{ data: 'a' }] }] },
        { chaId: 'cB', chats: [] },
    ] as Char[] } })
    return wrap(raw) as typeof raw
}

describe('moves and spread clones', () => {
    it('T4+: a chats array held from A before a spread clone into C marks A and C on push', () => {
        const root = setupMoves()
        const a = root.db.characters[0]
        const aChats = a.chats
        root.db.characters.push({ ...a, chaId: 'cC' })
        hits.length = 0
        aChats.push({ id: 'x', message: [] })
        const got = [...hits]
        expect(got).toContain('char:cA')
        expect(got).toContain('char:cC')
    })
})

describe('failure handling', () => {
    it('NOID-SELECTED: a write under a character with no usable id takes the per-write fallback with the selected id', () => {
        const marks: DbWriteMark[] = []
        const raw = $state({ db: { characters: [{ chats: [{ id: 'x' }] }] } })
        installDbWriteHook(raw, { sink: (mark) => { marks.push(mark) }, selectedChaId: () => 'selected' })
        raw.db.characters[0].chats[0].id = 'y'
        expect(marks).toContainEqual({ kind: 'fallback', cause: 'noCharId', id: 'selected' })
        expect(marks.some((mark) => mark.kind === 'owner')).toBe(false)
    })

    it('SINKFAIL: a sink that throws never fails the write; the failure is reported and a fallback is attempted', () => {
        const errors: unknown[] = []
        const marks: DbWriteMark[] = []
        let first = true
        const raw = $state({ db: { characters: [{ chaId: 'cA', chats: [{ id: 'x' }] }] } })
        installDbWriteHook(raw, {
            sink: (mark) => { if (first) { first = false; throw new Error('sink boom') } marks.push(mark) },
            onError: (error) => { errors.push(error) },
            selectedChaId: () => 'selected',
        })
        expect(() => { raw.db.characters[0].chats[0].id = 'y' }).not.toThrow()
        expect(raw.db.characters[0].chats[0].id).toBe('y')
        expect(errors.length).toBe(1)
        expect(marks).toContainEqual({ kind: 'fallback', cause: 'error', id: 'selected' })
    })

    it('an uninstalled hook reports nothing', () => {
        const marks: DbWriteMark[] = []
        const raw = $state({ db: { characters: [{ chaId: 'cA', chats: [{ id: 'x' }] }] } })
        installDbWriteHook(raw, { sink: (mark) => { marks.push(mark) }, selectedChaId: () => undefined })
        uninstallDbWriteHook()
        raw.db.characters[0].chats[0].id = 'y'
        expect(marks).toEqual([])
    })
})

describe('placement and deep moves', () => {
    it('DEEPMOVE: a message held two levels below a moved chat marks the new owner', () => {
        const raw = $state({ db: { characters: [
            { chaId: 'cA', chats: [{ id: 'A0', message: [{ data: 'a' }] }] },
            { chaId: 'cB', chats: [] as { id: string, message: { data: string }[] }[] },
        ] } })
        const root = wrap(raw)
        const msg = root.db.characters[0].chats[0].message[0]
        root.db.characters[1].chats.push(root.db.characters[0].chats[0])
        root.db.characters[0].chats.splice(0, 1)
        hits.length = 0
        msg.data = 'after move'
        expect([...hits]).toContain('char:cB')
    })

    it('PT7: a write to component-local $state reaches the hook and marks nothing', () => {
        const root = $state({ db: { characters: [] as unknown[] } })
        wrap(root)
        const local = $state({ items: [{ n: 1 }] })
        hits.length = 0
        local.items[0].n = 2
        local.items.push({ n: 3 })
        expect(hits.filter((h) => h.startsWith('char:') || h.startsWith('newChar:'))).toEqual([])
    })
})

function fresh() {
    installOnDBState()
    DBState.db = makeDb() as never
    selectedCharID.set(0)
    selIdState.selId = 0
    flushSync()
    const page = startMiniPage()
    page.snapshot()
    hits.length = 0
    return page
}

describe('DBState properties', () => {
    it('P1 identity: the same element reads as the same object', () => {
        const page = fresh()
        try {
            const a = DBState.db.characters[1]
            expect(a).toBe(DBState.db.characters[1])
            expect(DBState.db.characters.indexOf(a)).toBe(1)
            expect(a.chats[0]).toBe(DBState.db.characters[1].chats[0])
        } finally { page.stop() }
    })
    it('P2 owner by identity after splice: a held reference marks its own character', () => {
        const page = fresh()
        try {
            const b = DBState.db.characters[1]
            const chat = b.chats[0]
            DBState.db.characters.splice(0, 1)
            page.snapshot(); hits.length = 0
            chat.message[0].data = 'after splice'
            expect(page.tracker.character).toContain('cB')
        } finally { page.stop() }
    })
    it('P3 rename: the id is read at write time', () => {
        const page = fresh()
        try {
            const b = DBState.db.characters[1]
            b.chaId = 'cB2'
            page.snapshot(); hits.length = 0
            b.personality = 'x'
            expect(page.tracker.character).toContain('cB2')
        } finally { page.stop() }
    })
    it('P4 spread clone: nested objects copied from A mark the new owner', () => {
        const page = fresh()
        try {
            const a = DBState.db.characters[0]
            DBState.db.characters.push({ ...a, chaId: 'cC' } as never)
            page.snapshot(); hits.length = 0
            DBState.db.characters[2].chats[0].message[0].data = 'cloned edit'
            expect(page.tracker.character).toContain('cC')
        } finally { page.stop() }
    })
    it('P5 same value: no mark', () => {
        const page = fresh()
        try {
            const n = page.marks
            DBState.db.characters[1].personality = DBState.db.characters[1].personality
            expect(page.marks).toBe(n)
        } finally { page.stop() }
    })
    it('P6 an effect that writes a db key does not come to depend on it', () => {
        const page = fresh()
        let runs = 0
        const stop = $effect.root(() => {
            $effect(() => {
                runs++
                DBState.db.characters[1].name = 'derived-' + DBState.db.theme
            })
        })
        try {
            flushSync()
            const r0 = runs
            DBState.db.characters[1].name = 'external'
            flushSync()
            expect(runs).toBe(r0)
        } finally { stop(); page.stop() }
    })
    it('P7 snapshot, JSON and moves', () => {
        const page = fresh()
        try {
            const snap = $state.snapshot(DBState.db.characters[1])
            expect(snap.chaId).toBe('cB')
            expect(JSON.parse(JSON.stringify(DBState.db.characters[1])).chaId).toBe('cB')
            DBState.db.characters.reverse()
            expect(page.tracker.character.filter((id) => id === 'cB').length).toBe(0)
        } finally { page.stop() }
    })
    it('P8 descriptor read returns the raw child: a write through it is not seen (accepted bypass class)', () => {
        const page = fresh()
        try {
            const d = Object.getOwnPropertyDescriptor(DBState.db.characters[1], 'chats')!
            d.value[0].message[0].data = 'via descriptor'
            // Stock Svelte hands out the raw child, so no proxy trap runs and nothing is reported for cB.
            expect(hits).not.toContain('char:cB')
            expect(page.tracker.character).not.toContain('cB')
        } finally { page.stop() }
    })
})

function freshWithOrder() {
    const db = makeDb() as Record<string, unknown>
    db.characterOrder = ['cA', 'cB']
    ;(db.characters as Record<string, unknown>[])[1].chats = [{ id: 'B0', note: 'n', localLore: [], message: [{ role: 'char', data: 'base', chatId: 'B0-m0' }] }]
    installOnDBState()
    DBState.db = db as never
    selectedCharID.set(0)
    selIdState.selId = 0
    flushSync()
    const page = startMiniPage()
    flushSync()
    page.snapshot()
    hits.length = 0
    return page
}

describe('DBState changes through the real effects and scheduler', () => {
    it('C1 one wrapper per raw: the same raw reached through two owner paths is ===, and a write marks both owners', () => {
        const page = freshWithOrder()
        try {
            const aChat = DBState.db.characters[0].chats[0]
            DBState.db.characters[1].chats.push(aChat)
            flushSync(); page.snapshot(); hits.length = 0
            const viaA = DBState.db.characters[0].chats[0]
            const viaB = DBState.db.characters[1].chats[1]
            const same = viaA === viaB
            viaB.message[0].data = 'shared edit'
            const ids = [...page.tracker.character]
            expect(same).toBe(true)
            expect(ids).toContain('cA')
            expect(ids).toContain('cB')
        } finally { page.stop() }
    })
    it('C3a self-assignment of a root key (checkCharOrder shape) marks nothing and reruns no effect', () => {
        const page = freshWithOrder()
        let runs = 0
        const stop = $effect.root(() => { $effect(() => { runs++; void DBState.db.characterOrder }) })
        try {
            flushSync()
            const r0 = runs, m0 = page.marks, e0 = page.effectMarks
            DBState.db.characterOrder = DBState.db.characterOrder ?? []
            flushSync()
            const info = { reruns: runs - r0, marks: page.marks - m0, effectMarks: page.effectMarks - e0, hits: [...hits] }
            expect(info.reruns).toBe(0)
            expect(info.marks).toBe(0)
        } finally { stop(); page.stop() }
    })
    it('C3b setCurrentChat shape: writing the same chat wrapper back marks nothing and reruns no effect', () => {
        const page = freshWithOrder()
        let runs = 0
        const stop = $effect.root(() => { $effect(() => { runs++; void DBState.db.characters[0].chats[0] }) })
        try {
            flushSync()
            const r0 = runs, m0 = page.marks
            const char = DBState.db.characters[0]
            const chat = char.chats[char.chatPage]
            char.chats[char.chatPage] = chat
            flushSync()
            const info = { reruns: runs - r0, marks: page.marks - m0, ids: [...page.tracker.character], hits: [...hits] }
            expect(info.reruns).toBe(0)
            expect(info.marks).toBe(0)
        } finally { stop(); page.stop() }
    })
    it('C4 delete of an existing field marks the owner before any flush; delete of an absent key marks nothing', () => {
        const page = freshWithOrder()
        try {
            const chat = DBState.db.characters[1].chats[0] as { absentKey?: string, note?: string }
            delete chat.absentKey
            const afterAbsent = [...page.tracker.character]
            delete chat.note
            const ids = [...page.tracker.character]
            expect(afterAbsent).not.toContain('cB')
            expect(ids).toContain('cB')
            expect(page.dirty).toBe(true)
        } finally { page.stop() }
    })
    it('C5 re-stamp on move: a held chat moved to B marks B on a later write with no traversal through B', () => {
        const page = freshWithOrder()
        try {
            const held = DBState.db.characters[0].chats[0]
            DBState.db.characters[1].chats.push(held)
            DBState.db.characters[0].chats.splice(0, 1)
            flushSync(); page.snapshot(); hits.length = 0
            held.message[0].data = 'after move'
            const heldName = held as { name?: string }
            heldName.name = 'moved chat'
            const ids = [...page.tracker.character]
            expect(ids).toContain('cB')
        } finally { page.stop() }
    })
    it('C8a array identity helpers: indexOf/includes on wrappers match and raise no equality warning', () => {
        const page = freshWithOrder()
        const warn = vi.spyOn(console, 'warn')
        try {
            const list = DBState.db.characters
            const b = list[1]
            const r = { indexOf: list.indexOf(b), includes: list.includes(b), lastIndexOf: list.lastIndexOf(b) }
            const eqWarns = warn.mock.calls.filter((c) => String(c[0]).includes('state_proxy_equality_mismatch')).length
            expect(r).toEqual({ indexOf: 1, includes: true, lastIndexOf: 1 })
            expect(eqWarns).toBe(0)
        } finally { warn.mockRestore(); page.stop() }
    })
    it('C8c $state over a db object (Suggestion shape) keeps the hooked wrapper and marks', () => {
        const page = freshWithOrder()
        try {
            const msgs = DBState.db.characters[1].chats[0].message
            const held = $state(msgs)
            const same = held === msgs
            held.push({ role: 'user', data: 'x', chatId: 'n' } as never)
            const ids = [...page.tracker.character]
            expect(same).toBe(true)
            expect(ids).toContain('cB')
        } finally { page.stop() }
    })
})
