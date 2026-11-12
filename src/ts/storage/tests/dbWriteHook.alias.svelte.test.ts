// @vitest-environment jsdom
// Aliasing, adoption and role changes of the explicit write hook. A proxy can sit under several parents (an object
// key and the list at once, a list that was copied, a character renamed or moved outside the list), so the hook
// reads owners as a union over every link path and the character id from a tag only. Each case states which keys
// and which character a write must mark.
//
// Axiom S (two proxies share a record only when both are arrays) keeps every character, db and root record
// unshared; the list rule decides new versus moved by the tag; a role never ends the owner walk.
//
// Q1 and Q2 are compatibility guards for the premise of the list rule: a tagged value is placed with no character
// mark, and the character is still saved because the encoder's unheld-resident rule and the identity tracker cover
// it. They run the real `markDbWrite` sink and the real save encoder.
import { describe, expect, it } from 'vitest'
import { flushSync } from 'svelte'
import v8 from 'node:v8'
import vm from 'node:vm'
import { describeDbWriteMark, installDbWriteHook, linkCountOf, LINK_GROWTH_THRESHOLD, ownersOf } from '../dbWriteHook'
import { installCharacterSaveMarks, markDbWrite, resetCharacterSaveMarksForTest } from '../characterSaveMarks'
import type { DbWriteMark } from '../characterSaveMarks'
import { stateRecords } from '../svelteStatePatch'
import { createSaveEncoder } from '../store2/saveEncoder'
import { previousFrom } from '../store2/codec'
import { createKeyMint } from '../store2/commit'
import type { SavePassRequest } from '../store2/saveEncoder'
import type { toSaveType } from '../risuSave'
import { asDatabase, buildSmall, encodeWith, fakeLists, seededEnv } from './store2/codecFixtures'
import type { Obj } from './store2/codecFixtures'

v8.setFlagsFromString('--expose_gc')
const gc = vm.runInNewContext('gc') as () => void
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
async function settle() { for (let i = 0; i < 3; i++) { await tick(); gc() } }
type Msg = { role: string, data: string }
type Chat = { id: string, message: Msg[] }
type Cfg = { n: number, sub: { a: number } }
type Char = { chaId?: string | number, name?: string, chats: Chat[], cfg?: Cfg, coldstorage?: boolean }
const ch = (id: string): Chat => ({ id, message: [{ role: 'user', data: id }] })

// Every mark the hook reports, as text (`char:<id>`, `newChar:<id>`, `top:<key>`, ...); `take` reads and clears.
const hits: string[] = []
const take = () => { const h = [...hits]; hits.length = 0; return h }
function wrap<T extends object>(root: T, forward?: (mark: DbWriteMark) => void): T {
    return installDbWriteHook(root, {
        sink: (mark) => { hits.push(describeDbWriteMark(mark)); forward?.(mark) },
        onError: (error) => { hits.push('sink:' + String(error)) },
        selectedChaId: () => undefined,
    })
}
const linkGrowthRecords = () => (window.__risuTaniumErrors ?? []).filter((r) => r.site === 'dbWriteHook.linkGrowth').length

// A character with a `cfg` object replaced N times by a shallow copy that carries `cfg.sub`: each replacement adds
// one link to `sub` and keeps one dead parent record, and the old containers themselves are freed.
function objrep(N: number) {
    const st = $state({ db: { characters: [{ chaId: 'cA', chats: [ch('A0')], cfg: { n: 0, sub: { a: 0 } } }] as Char[] } })
    const root = wrap(st)
    JSON.stringify(root)
    const c = root.db.characters[0]
    const sub = c.cfg!.sub
    const olds: WeakRef<object>[] = []
    for (let i = 1; i <= N; i++) { olds.push(new WeakRef(c.cfg!)); c.cfg = { ...c.cfg!, n: i } }
    take()
    return { root, c, sub, olds }
}

describe('placement, tags and link growth', () => {
    // A draft whose chaId is written through its proxy before it is placed is still a new character at placement.
    it('CHAID-BEFORE-PLACE: chaId written on a draft, then the draft is pushed: newChar and own id', () => {
        const st = $state({ db: { characters: [{ chaId: 'cA', chats: [ch('A0')] }] as Char[], draft: { chaId: 'q0', chats: [ch('Q0')] } as Char } })
        const root = wrap(st)
        JSON.stringify(root)
        const X = root.db.draft
        X.chaId = 'q1'
        take()
        root.db.characters.push(X)
        const pushed = take()
        X.chats[0].id = 'edited'
        const edited = take()
        expect(pushed).toContain('newChar:q1')
        expect(edited).toContain('char:q1')
    })

    // A whole-slot defineProperty (kind 2) of an untagged existing proxy is a new character.
    it('DEFINE-SLOT: an untagged draft installed in a list slot by defineProperty is new and owns its writes', () => {
        const st = $state({ db: { characters: [{ chaId: 'cA', chats: [ch('A0')] }] as Char[], draft: { chaId: 'cX', chats: [ch('X0')] } as Char } })
        const root = wrap(st)
        JSON.stringify(root)
        const X = root.db.draft
        take()
        Object.defineProperty(root.db.characters, '1', { value: X, writable: true, enumerable: true, configurable: true })
        const placed = take()
        X.chats[0].id = 'edited'
        const edited = take()
        expect(placed).toContain('newChar:cX')
        expect(edited).toContain('char:cX')
    })

    // Tags live on plain-object records only; an array placed in a list slot takes the logged fallback.
    it('ARRAY-IN-SLOT: an array in a list slot is never tagged; a write under it takes the logged fallback', () => {
        const st = $state({ db: { characters: [{ chaId: 'cA', chats: [ch('A0')] }] as unknown[] } })
        const root = wrap(st)
        JSON.stringify(root)
        const arr = Object.assign([{ k: 1 }], { chaId: 'cArr' })
        root.db.characters.push(arr)
        take()
        ;(root.db.characters[1] as { k: number }[])[0].k = 2
        const h = take()
        expect(h).toContain('fallback:noCharId')
        expect(h).not.toContain('char:cArr')
    })

    // I22 restated: each plain-object replacement under an object key adds one link per carried child and keeps
    // one dead parent record; the old containers themselves are freed.
    it('OBJREP-BOUND: 100 plain-object replacements carrying a child: links = replacements + 1, old containers freed', async () => {
        const { sub, olds } = objrep(100)
        await settle()
        const alive = olds.filter((w) => w.deref() !== undefined).length
        sub.a = 1
        const h = take()
        const links = linkCountOf(sub)
        expect(links).toBe(101)
        expect(alive).toBe(0)
        expect(h).toContain('char:cA')
    })

    // The once-only link-growth record is made when a write's walk visits a record above the threshold, and only
    // once per install. The marks themselves are unaffected.
    it('LINKWARN: a record above the link threshold is recorded once; below it nothing is recorded', () => {
        const before = linkGrowthRecords()
        const small = objrep(10)
        small.sub.a = 1
        take()
        expect(linkGrowthRecords()).toBe(before)
        const big = objrep(LINK_GROWTH_THRESHOLD + 5)
        big.sub.a = 1
        big.sub.a = 2
        const hb = take()
        expect(linkGrowthRecords()).toBe(before + 1)
        expect(hb).toContain('char:cA')
    })
})

describe('owners as a union over every link path', () => {
    // The list is replaced by a copy (the fresh array adopts the list record); the old list array is then stored
    // under another db key. Writes to that other key must mark that key.
    it('LISTSHARE-ARCHIVE: old list array stored under another key after the list was replaced', () => {
        const st = $state({ db: { characters: [{ chaId: 'cA', chats: [ch('A0')] }, { chaId: 'cB', chats: [ch('B0')] }] as Char[], archive: [] as Char[] } })
        const root = wrap(st)
        JSON.stringify(root)
        const old = root.db.characters
        root.db.characters = [...old]
        root.db.archive = old
        const placed = take()
        root.db.archive.push({ chaId: 'cNew', name: 'n', chats: [] })
        const pushed = take()
        root.db.archive[2].name = 'edited'
        const edited = take()
        root.db.archive.length = 1
        const trunc = take()
        expect(pushed).toContain('top:archive')
        expect(edited).toContain('top:archive')
        expect(trunc).toContain('top:archive')
    })

    // No adoption at all: the same list proxy is stored under a second key.
    it('LISTALIAS: the list proxy also stored under a second db key', () => {
        const st = $state({ db: { characters: [{ chaId: 'cA', chats: [ch('A0')] }] as Char[], mirror: null as Char[] | null } })
        const root = wrap(st)
        JSON.stringify(root)
        root.db.mirror = root.db.characters
        take()
        root.db.mirror!.push({ chaId: 'cM', chats: [] })
        const pushed = take()
        expect(pushed).toContain('top:mirror')
    })

    // An array is shared by adoption before it becomes the list.
    it('LISTSHARE-BECOMES-LIST: an array shared under an object key, then the old array becomes the list', () => {
        const st = $state({ db: { characters: [] as Char[], drafts: [{ chaId: 'cD', chats: [ch('D0')] }] as Char[] } })
        const root = wrap(st)
        JSON.stringify(root)
        const X = root.db.drafts
        root.db.drafts = [...X]
        root.db.characters = X
        take()
        root.db.drafts.push({ chaId: 'cE', name: 'e', chats: [] })
        const pushed = take()
        root.db.drafts[1].name = 'edited'
        const edited = take()
        expect(pushed).toContain('top:drafts')
        expect(edited).toContain('top:drafts')
    })

    // Role after link: X is linked under an array record before that record becomes the list record (through a
    // sibling array that shares it); X is then pushed into the real list, where the link already exists.
    it('LISTROLE-AFTER-LINK: an element linked before its array record became the list, then pushed into the list', () => {
        const st = $state({ db: { characters: [] as Char[], drafts: [{ chaId: 'cD', chats: [ch('D0')] }] as Char[] } })
        const root = wrap(st)
        JSON.stringify(root)
        const A = root.db.drafts
        root.db.drafts = [...A]
        root.db.drafts.push({ chaId: 'cX', name: 'x', chats: [ch('X0')] })
        const X = root.db.drafts[1]
        root.db.characters = A
        take()
        root.db.characters.push(X)
        const pushed = take()
        X.chats[0].id = 'X0-edited'
        const edited = take()
        expect(pushed).toContain('newChar:cX')
        expect(edited).toContain('char:cX')
    })

    // The link callback tags a child only under a list-role record. A draft staged in a non-list array stays untagged,
    // so placing it in the list is a placement; tagging it at staging would make the placement look like a move.
    it('STAGED-NEW: a new character staged in a non-list array, then pushed into the list, is a placement', () => {
        const st = $state({ db: { characters: [{ chaId: 'cA', chats: [ch('A0')] }] as Char[], staging: [] as Char[] } })
        const root = wrap(st)
        JSON.stringify(root)
        root.db.staging.push({ chaId: 'cS', chats: [ch('S0')] })
        const S = root.db.staging[0]
        take()
        root.db.characters.push(S)
        const placed = take()
        expect(placed).toContain('newChar:cS')
    })

    // Same staging, but the staged copy carries the id of a live character and replaces its slot: the placement is
    // still marked (`newChar`, from the list rule's untagged branch), so the replaced unit is saved.
    it('STAGED-SAMEID: a same-id copy staged in a non-list array replaces the live slot and marks that id', () => {
        const st = $state({ db: { characters: [{ chaId: 'cA', name: 'old', chats: [ch('A0')] }] as Char[], staging: [] as Char[] } })
        const root = wrap(st)
        JSON.stringify(root)
        root.db.staging.push({ chaId: 'cA', name: 'new', chats: [ch('A0')] })
        const X = root.db.staging[0]
        take()
        root.db.characters[0] = X
        const placed = take()
        expect(placed).toContain('newChar:cA')
    })

    // Tag-only id: chaId written before placement, after placement, then a nested-spread slot copy and gc.
    it('CHAID-TIMELINE: chaId written before and after placement; nested spread; gc; held write', async () => {
        const st = $state({ db: { characters: [{ chaId: 'cA', chats: [ch('A0')] }] as Char[], draft: { chaId: 'q0', chats: [ch('Q0')] } as Char } })
        const root = wrap(st)
        JSON.stringify(root)
        ;(() => { const X = root.db.draft; X.chaId = 'q1'; root.db.characters.push(X) })()
        const heldChat = root.db.characters[1].chats[0]
        root.db.characters[1].chaId = 'q2'
        ;(() => { const c = root.db.characters[1]; root.db.characters[1] = { ...c, chats: [...c.chats] } })()
        await settle()
        take()
        heldChat.id = 'x'
        const h = take()
        expect(h).toContain('char:q2')
    })
})

describe('shared array records and renames', () => {
    // Adoption happens while X is not yet a character (untagged); X is then pushed. Y (the adopter) shares X's record.
    it('ADOPT-PUSH-BOTH: the adopter pushed later is a new character and its edits mark its own id', () => {
        const st = $state({ db: { characters: [{ chaId: 'cA', chats: [ch('A0')] }] as Char[], draft: { chaId: 'cP', chats: [ch('P0')] } as Char } })
        const root = wrap(st)
        JSON.stringify(root)
        const X = root.db.draft
        root.db.draft = { chaId: 'cZ', chats: [ch('Z0')] }
        root.db.characters.push(X)
        const pushX = take()
        const Y = root.db.draft
        root.db.characters.push(Y)
        const pushY = take()
        const yChat = root.db.characters[2].chats[0]
        yChat.id = 'Z0-edited'
        const editY = take()
        expect(pushX).toContain('newChar:cP')
        expect(pushY).toContain('newChar:cZ')
        expect(editY).toContain('char:cZ')
    })

    // Same sharing; X's slot is replaced by a nested-spread copy and collected; then the adopter's chaId is written.
    it('ADOPT-DEADW-RETAG: a chaId write on the adopter does not retag the character record', async () => {
        const st = $state({ db: { characters: [{ chaId: 'cA', chats: [ch('A0')] }] as Char[], draft: { chaId: 'cP', chats: [ch('P0')] } as Char | null } })
        const root = wrap(st)
        JSON.stringify(root)
        ;(() => { const X = root.db.draft!; root.db.draft = { chaId: 'cZ', chats: [] }; root.db.characters.push(X) })()
        const heldChat = root.db.characters[1].chats[0]
        ;(() => { const c = root.db.characters[1]; root.db.characters[1] = { ...c, chats: [...c.chats] } })()
        await settle()
        root.db.draft!.chaId = 'cQ'
        take()
        heldChat.id = 'P0-edited'
        const h = take()
        expect(h).toContain('char:cP')
    })

    // Same as above with X alive: the tag is refreshed only by the character record's own `chaId` writes.
    it('ADOPT-LIVEW-RETAG: adopter chaId write while the character is alive; held write after a slot copy and gc', async () => {
        const st = $state({ db: { characters: [{ chaId: 'cA', chats: [ch('A0')] }] as Char[], draft: { chaId: 'cP', chats: [ch('P0')] } as Char | null } })
        const root = wrap(st)
        JSON.stringify(root)
        ;(() => { const X = root.db.draft!; root.db.draft = { chaId: 'cZ', chats: [] }; root.db.characters.push(X) })()
        const heldChat = root.db.characters[1].chats[0]
        root.db.draft!.chaId = 'cQ'
        ;(() => { const c = root.db.characters[1]; root.db.characters[1] = { ...c, chats: [...c.chats] } })()
        await settle()
        take()
        heldChat.id = 'P0-edited'
        const h = take()
        expect(h).toContain('char:cP')
    })

    it('RENAME-AFTER-PLACE (L1): the copy is renamed after placement; held write before and after a full read', async () => {
        const st = $state({ db: { characters: [{ chaId: 'cA', chats: [ch('A0')] }] as Char[] } })
        const root = wrap(st)
        JSON.stringify(root)
        const heldChat = root.db.characters[0].chats[0]
        ;(() => { const c = root.db.characters[0]; root.db.characters[0] = { ...c, chats: [...c.chats] } })()
        const placed = take()
        root.db.characters[0].chaId = 'cA2'
        await settle()
        take()
        heldChat.id = 'x1'
        take()
        JSON.stringify(root.db.characters[0])
        heldChat.id = 'x2'
        const after = take()
        expect(placed).toContain('newChar:cA')
        expect(after).toContain('char:cA2')
    })

    it('MOVE-TRASH-PUTBACK: a character moved to another array and put back keeps its id', async () => {
        const st = $state({ db: { characters: [{ chaId: 'cA', chats: [ch('A0')] }, { chaId: 'cB', chats: [ch('B0')] }] as Char[], trash: [] as Char[] } })
        const root = wrap(st)
        JSON.stringify(root)
        const heldChat = root.db.characters[0].chats[0]
        const [moved] = root.db.characters.splice(0, 1)
        root.db.trash.push(moved)
        await settle()
        take()
        heldChat.id = 't1'
        const inTrash = take()
        const back = root.db.trash.pop()!
        root.db.characters.push(back)
        const putBack = take()
        heldChat.id = 't2'
        const afterBack = take()
        // A write under the character while it sits in another array still reaches its id through the never-removed
        // list link; putting it back is a move of a tagged proxy: list shape only, no placement.
        expect(inTrash).toContain('char:cA')
        expect(putBack.some((h) => h.startsWith('listShape:'))).toBe(true)
        expect(putBack.some((h) => h.startsWith('newChar:'))).toBe(false)
        expect(afterBack).toContain('char:cA')
    })

    it('ARCHIVE-STUB-RESTORE: slot replaced by a stub then by a restored fresh tree; held write of the restored chat', async () => {
        const st = $state({ db: { characters: [{ chaId: 'cA', chats: [ch('A0')] }] as Char[] } })
        const root = wrap(st)
        JSON.stringify(root)
        const oldHeld = root.db.characters[0].chats[0]
        root.db.characters[0] = { chaId: 'cA', chats: [], coldstorage: true }
        root.db.characters[0] = { chaId: 'cA', chats: [ch('A0r')] }
        await settle()
        const restoredChat = root.db.characters[0].chats[0]
        take()
        restoredChat.id = 'r1'
        const h1 = take()
        oldHeld.id = 'o1'
        const h2 = take()
        expect(h1).toContain('char:cA')
        // The stub replaced by a restored tree has the same id; the replaced tree's chat still resolves to it.
        expect(h2).toContain('char:cA')
    })

    it('NUMID-RENAME: numeric id renamed to a string, nested spread, gc', async () => {
        const st = $state({ db: { characters: [{ chaId: 7, chats: [ch('N0')] }] as Char[] } })
        const root = wrap(st)
        JSON.stringify(root)
        const heldChat = root.db.characters[0].chats[0]
        root.db.characters[0].chaId = 'n7'
        ;(() => { const c = root.db.characters[0]; root.db.characters[0] = { ...c, chats: [...c.chats] } })()
        await settle()
        take()
        heldChat.id = 'x'
        const h = take()
        expect(h).toContain('char:n7')
    })

    it('NOID-THEN-ID: a character pushed without chaId, given one by a write, then nested spread and gc', async () => {
        const st = $state({ db: { characters: [] as Char[] } })
        const root = wrap(st)
        JSON.stringify(root)
        root.db.characters.push({ name: 'new', chats: [ch('W0')] })
        const placed = take()
        const heldChat = root.db.characters[0].chats[0]
        root.db.characters[0].chaId = 'cW'
        ;(() => { const c = root.db.characters[0]; root.db.characters[0] = { ...c, chats: [...c.chats] } })()
        await settle()
        take()
        heldChat.id = 'x'
        const h = take()
        // Without a usable id the placement still marks the slot (`newChar:undefined` is the sink's no-id placement).
        expect(placed.some((m) => m.startsWith('newChar:'))).toBe(true)
        expect(h).toContain('char:cW')
    })

    it('LISTPROXY-UNREAD: existing state array assigned as the list before any element read; nested spread; gc', async () => {
        const st = $state({ db: { characters: [] as Char[] } })
        const root = wrap(st)
        JSON.stringify(root)
        const local = $state([{ chaId: 'cU', chats: [ch('U0')] }] as Char[])
        root.db.characters = local
        const heldChat = root.db.characters[0].chats[0]
        ;(() => { const c = root.db.characters[0]; root.db.characters[0] = { ...c, chats: [...c.chats] } })()
        await settle()
        take()
        heldChat.id = 'x'
        const h = take()
        expect(h).toContain('char:cU')
    })

    it('LISTPROXY-DEFINE: existing state array installed as the list by defineProperty; nested spread; gc', async () => {
        const st = $state({ db: { characters: [] as Char[] } })
        const root = wrap(st)
        JSON.stringify(root)
        const local = $state([{ chaId: 'cD', chats: [ch('D0')] }] as Char[])
        const heldChat = local[0].chats[0]
        JSON.stringify(local)
        Object.defineProperty(root.db, 'characters', { value: local, writable: true, enumerable: true, configurable: true })
        ;(() => { const c = root.db.characters[0]; root.db.characters[0] = { ...c, chats: [...c.chats] } })()
        await settle()
        take()
        heldChat.id = 'x'
        const h = take()
        expect(h).toContain('char:cD')
    })

    it('DBSPREAD-NESTED: db replaced by a raw copy whose characters is a raw array holding existing character proxies', async () => {
        const st = $state({ db: { characters: [] as Char[], other: 1 } })
        const root = wrap(st)
        JSON.stringify(root)
        const local = $state([{ chaId: 'cF', chats: [ch('F0')] }] as Char[])
        const heldChat = local[0].chats[0]
        JSON.stringify(local)
        root.db = { ...root.db, characters: [local[0]] }
        ;(() => { const c = root.db.characters[0]; root.db.characters[0] = { ...c, chats: [...c.chats] } })()
        await settle()
        take()
        heldChat.id = 'x'
        const h = take()
        expect(h).toContain('char:cF')
    })

    it('PREINSTALL (I28 second sentence): characters read before install; nested spread; gc', async () => {
        const st = $state({ db: { characters: [{ chaId: 'cI', chats: [ch('I0')] }] as Char[] } })
        JSON.stringify(st)
        const heldChat = st.db.characters[0].chats[0]
        const root = wrap(st)
        root.db.characters[0].name = 'touch'
        ;(() => { const c = root.db.characters[0]; root.db.characters[0] = { ...c, chats: [...c.chats] } })()
        await settle()
        take()
        heldChat.id = 'x'
        const h = take()
        expect(h).toContain('char:cI')
    })
    it('FOREIGN-DEEP: a component-local chat carried two levels into a fresh character slot; write before and after a full read', () => {
        const st = $state({ db: { characters: [{ chaId: 'cA', chats: [ch('A0')] }] as Char[] } })
        const root = wrap(st)
        JSON.stringify(root)
        const local = $state(ch('L0'))
        JSON.stringify(local)
        ;(() => { const c = root.db.characters[0]; root.db.characters[0] = { ...c, chats: [...c.chats, local] } })()
        const placed = take()
        local.id = 'L0-edit'
        take()
        JSON.stringify(root.db.characters[0])
        local.id = 'L0-edit2'
        const after = take()
        expect(placed).toContain('newChar:cA')
        expect(after).toContain('char:cA')
    })
})

type Db = { characters: Char[], trash: Char[], archive?: Char[], draft?: Char, d1?: Char, d2?: Char, slot?: Char }
function mk(extra: Partial<Db> = {}) {
    const st = $state({ db: { characters: [{ chaId: 'cA', chats: [ch('A0')] }, { chaId: 'cB0', chats: [ch('B0')] }], trash: [], ...extra } as Db })
    const root = wrap(st)
    JSON.stringify(root)
    take()
    return root
}

// The real pieces behind the list rule's premise: the sink is `markDbWrite` over a real tracker, and a pass is
// planned by the real save encoder over the page's `$state` database. The acknowledged encoding is the one the
// page booted from, so a placed character that encoding does not hold is an unheld resident of the next pass.
async function realPass() {
    const NOW = 1_700_000_000_000
    const plain = JSON.parse(JSON.stringify(buildSmall(3))) as Obj
    const previous = previousFrom(encodeWith(asDatabase(JSON.parse(JSON.stringify(plain)) as Obj)))
    const encoder = createSaveEncoder({ previous, lists: fakeLists, env: seededEnv(77), now: () => NOW })
    const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => {} })
    const st = $state({ db: { ...plain, trash: [] as Obj[] } as Obj & { characters: Obj[], trash: Obj[] } })
    const root = wrap(st, markDbWrite)
    JSON.stringify(root)
    take()
    return {
        root,
        tracker,
        encoder,
        idOf: (index: number) => (root.db.characters[index] as { chaId: string }).chaId,
        /**
         * What a save pass does with the marks: keep the ones whose character is in the list (`marksOf`), add the
         * unheld residents (`scopeOf`), plan, build and acknowledge. Returns the two sets the pass was made from.
         */
        async pass() {
            const present = new Set(root.db.characters.map((c) => String((c as { chaId?: unknown }).chaId)))
            const marked = new Set(tracker.character.filter((id) => typeof id === 'string' && present.has(id)))
            const unheld = encoder.unheldChaIds(asDatabase(root.db as Obj))
            const request: SavePassRequest = { marked, modules: false, whole: false }
            const plan = await encoder.plan(asDatabase(root.db as Obj), request)
            const { mint } = createKeyMint(seededEnv(900), null)
            await plan.commitRequest().build({ mint, seq: 2, now: NOW })
            plan.acknowledge()
            tracker.character.length = 0
            return { marked, unheld }
        },
        held: (chaId: string) => encoder.acknowledged().entities.has(`${chaId}#0`),
    }
}

describe('list rule premise and directed placement probes', () => {
    it('Q1 TRASH-RENAME-PUTBACK: a character renamed outside the list and put back is saved by the next pass', async () => {
        const w = await realPass()
        const X = w.root.db.characters[0]
        const originalId = w.idOf(0)
        w.root.db.characters.splice(0, 1)
        w.root.db.trash.push(X)
        take()
        X.chaId = 'cR'
        const rename = take()
        // A pass that runs while X is outside the list consumes the marks naming it: marksOf keeps only listed ids.
        await w.pass()
        w.root.db.trash.splice(0, 1)
        w.root.db.characters.push(X)
        const putback = take()
        X.chats[0].id = 'e'
        const edit = take()
        expect(rename).toContain('char:cR')
        // The put-back is a move of a tagged proxy: it marks the list shape and no character.
        expect(putback.some((h) => h.startsWith('listShape:'))).toBe(true)
        expect(putback.some((h) => h.startsWith('newChar:'))).toBe(false)
        expect(edit).toContain('char:cR')
        // The unit is still written: the acknowledged encoding holds no unit for cR, so cR is an unheld resident.
        expect(originalId).not.toBe('cR')
        expect(w.held('cR')).toBe(false)
        const { marked, unheld } = await w.pass()
        expect(marked.has('cR')).toBe(true)
        expect(unheld).toContain('cR')
        expect(w.held('cR')).toBe(true)
    })

    it('Q2 LISTSHARE-TAG-THEN-PLACE: a draft pushed through a shared list record is saved by the next pass', async () => {
        const w = await realPass()
        const draft = { ...(JSON.parse(JSON.stringify(w.root.db.characters[1])) as Obj), chaId: 'cD' }
        const old = w.root.db.characters
        w.root.db.characters = [...old]
        ;(w.root.db as Obj).archive = old
        take()
        ;(w.root.db as Obj).draft = draft
        const D = (w.root.db as Obj).draft as { chaId: string, name: string }
        take()
        ;((w.root.db as Obj).archive as Obj[]).push(D)
        const intoArchive = take()
        w.root.db.characters.push(D)
        const intoList = take()
        D.name = 'edited'
        const edit = take()
        // D is tagged by its first placement (through the array that shares the list record), so placing it in the
        // live list is a move: no character mark.
        expect(intoArchive).toContain('newChar:cD')
        expect(intoList.some((h) => h.startsWith('newChar:'))).toBe(false)
        expect(edit).toContain('char:cD')
        // A pass between the two placements would have consumed the mark; the unit is written through unheld.
        w.tracker.character.length = 0
        const { marked, unheld } = await w.pass()
        expect(marked.has('cD')).toBe(false)
        expect(unheld).toContain('cD')
        expect(w.held('cD')).toBe(true)
    })
    // Residual, accepted: a proxy that was seen in the live list, edited while outside it, and put back over a
    // different live proxy that has the same chaId is carried from the other proxy's unit (parity with the base).

    it('Q3 ROOT-DB-NESTED: db replaced by a spread holding a raw copy of the list', () => {
        const root = mk()
        const held = root.db.characters[0].chats[0]
        root.db = { ...root.db, characters: [...root.db.characters] }
        take()
        held.id = 'e1'
        const before = take()
        root.db.characters.push({ chaId: 'cN', chats: [ch('N0')] })
        const push = take()
        root.db.characters[2].chats[0].id = 'e2'
        const editN = take()
        expect(before).toContain('char:cA')
        expect(push).toContain('newChar:cN')
        expect(editN).toContain('char:cN')
    })

    it('Q4 UNSHIFT-SORT-REVERSE: a new character by unshift is placed; sort and reverse are moves', () => {
        const root = mk({ draft: { chaId: 'cX', chats: [ch('X0')] } })
        const X = root.db.draft!
        take()
        root.db.characters.unshift(X)
        const unshift = take()
        root.db.characters.sort((a: Char, b: Char) => String(a.chaId).localeCompare(String(b.chaId)))
        const sort = take()
        root.db.characters.reverse()
        take()
        X.chats[0].id = 'e'
        const edit = take()
        expect(unshift).toContain('newChar:cX')
        expect(sort.some((h) => h.startsWith('newChar'))).toBe(false)
        expect(edit).toContain('char:cX')
    })

    it('Q5 SPLICE-INSERT and OBJECT-ASSIGN-SLOT are new-character placements', () => {
        const root = mk({ d1: { chaId: 'cS', chats: [ch('S0')] }, d2: { chaId: 'cO', chats: [ch('O0')] } })
        const S = root.db.d1!, O = root.db.d2!
        take()
        root.db.characters.splice(1, 0, S)
        const spliced = take()
        Object.assign(root.db.characters, { [root.db.characters.length]: O })
        const assigned = take()
        S.chats[0].id = 'e'; const editS = take()
        O.chats[0].id = 'e'; const editO = take()
        expect(spliced).toContain('newChar:cS')
        expect(assigned).toContain('newChar:cO')
        expect(editS).toContain('char:cS')
        expect(editO).toContain('char:cO')
    })

    it('Q6 NUMERIC-ID: placement, edit and rename of a numeric id', () => {
        const root = mk()
        root.db.characters.push({ chaId: 7, chats: [ch('N7')] })
        expect(take()).toContain('newChar:7')
        const N = root.db.characters[2]
        N.chats[0].id = 'e'; const edit = take()
        N.chaId = 8
        take()
        N.chats[0].id = 'f'; const edit2 = take()
        expect(edit).toContain('char:7')
        expect(edit2).toContain('char:8')
    })

    it('Q7 DELETE-CHAID and INVALID-CHAID: a later edit still marks something (the old tag stays)', () => {
        const root = mk()
        const A = root.db.characters[0]
        delete A.chaId
        take()
        A.chats[0].id = 'e'; const afterDelete = take()
        A.chaId = ''
        A.chats[0].id = 'f'; const afterEmpty = take()
        // A delete or an invalid value leaves the old tag, so the old id is marked instead of the fallback.
        expect(afterDelete).toContain('char:cA')
        expect(afterEmpty).toContain('char:cA')
    })

    it('Q8 TRUNC-REPUSH and DUP-SAME-PROXY: a truncated character pushed back and a duplicate proxy keep their own ids', () => {
        const root = mk()
        const B = root.db.characters[1]
        root.db.characters.length = 1
        take()
        root.db.characters.push(B)
        take()
        root.db.characters.push(root.db.characters[0])
        take()
        root.db.characters[0].chats[0].id = 'e'; const edit = take()
        B.chats[0].id = 'e'; const editB = take()
        expect(edit).toContain('char:cA')
        expect(editB).toContain('char:cB0')
    })

    it('Q9 HAS-CREATION in an effect links and tags an unread element', () => {
        const st = $state({ db: { characters: [{ chaId: 'cH', chats: [ch('H0')] }] as Char[] } })
        const root = wrap(st)
        take()
        const list = root.db.characters
        const stop = $effect.root(() => { $effect(() => { void ('0' in list) }) })
        flushSync()
        expect(linkCountOf(list[0])).toBeGreaterThan(0)
        list[0].chats[0].id = 'e'
        const edit = take()
        stop()
        expect(edit).toContain('char:cH')
    })

    it('Q10 MOVE-VIA-OBJECT-KEY: a character moved to an object key and back keeps its id', () => {
        const root = mk()
        const A = root.db.characters[0]
        root.db.characters.splice(0, 1)
        root.db.slot = A
        take()
        A.chats[0].id = 'e'; const outside = take()
        root.db.characters.push(root.db.slot)
        take()
        A.chats[0].id = 'f'; const edit = take()
        expect(outside).toContain('top:slot')
        expect(edit).toContain('char:cA')
        expect(ownersOf(A)).toContain('char:cA')
    })

    it('Q11 DEFINE-COPY: a raw copy stored by defineProperty is a placement; a later write is a bypass class', () => {
        const root = mk()
        const A = root.db.characters[0]
        Object.defineProperty(root.db.characters, '0', { value: { ...A, chaId: 'cN' }, writable: true, enumerable: true, configurable: true })
        const placed = take()
        const slot = root.db.characters[0]
        expect(placed).toContain('newChar:cN')
        // The stored value stayed raw, so the slot has no record and its later writes are not seen (accepted bypass).
        expect(stateRecords.get(slot)).toBeUndefined()
    })

    it('Q12 STRUCTUREDCLONE of a proxy throws as on the base', () => {
        const root = mk()
        expect(() => structuredClone(root.db.characters[0])).toThrow()
    })
})
