import { describe, expect, test, vi } from 'vitest'
import { CCardLib } from '@risuai/ccardlib'
import { pickHashRand } from 'src/ts/util'

// util.ts pulls the app's reactive modules in; these two start effects at import that need a running app.
vi.mock('src/ts/parser/parser.svelte', () => ({ risuChatParser: (text: string) => text }))
vi.mock('src/ts/process/modules', () => ({ moduleUpdate: () => {}, getModules: () => [] }))
import { LORE_BUILD_CHUNK, createLoreIndexStore, createLoreLiveLookup, loreFingerprint, loreIndexKey, type LoreIndexDeps, type LoreScanEntries } from '../loreIndex'

type Entry = LoreScanEntries['entries'][number]

function manual() {
    const queue: Array<() => void> = []
    let clock = 0
    const deps: LoreIndexDeps = {
        hash: (c) => pickHashRand(5555, c),
        schedule: (run) => { queue.push(run) },
        now: () => ++clock,
    }
    return {
        deps,
        pending: () => queue.length,
        step: () => { queue.shift()?.() },
        drain: () => { while (queue.length) queue.shift()!() },
    }
}

function scan(entries: Entry[], extra: Partial<LoreScanEntries> = {}): LoreScanEntries {
    return { entries, characterCount: entries.length, chatCount: 0, moduleOwners: [], ...extra }
}

function lore(n: number, prefix = 'Entry'): Entry[] {
    return Array.from({ length: n }, (_, i) => ({ content: `${prefix} ${i} dragon fortress`, id: `id-${i}`, mode: 'normal' }))
}

describe('loreFingerprint and key', () => {
    test('T16 a: a count or length change changes the fingerprint; a same-length edit does not', () => {
        const base = scan(lore(3))
        const fp = loreFingerprint(base)
        expect(loreFingerprint(scan(lore(4)))).not.toBe(fp)
        const longer = lore(3)
        longer[1] = { ...longer[1], content: longer[1].content + 'x' }
        expect(loreFingerprint(scan(longer))).not.toBe(fp)
        const same = lore(3)
        same[1] = { ...same[1], content: same[1].content.replace('dragon', 'dragom') }
        expect(loreFingerprint(scan(same))).toBe(fp)
    })

    test('new rule: child and folder entries never enter the fingerprint', () => {
        const base = scan(lore(2))
        const withLinks = scan([...lore(2), { content: 'link text', id: 'id-0', mode: 'child' }, { content: '', id: 'f', mode: 'folder' }])
        expect(loreFingerprint(withLinks)).toBe(loreFingerprint(base))
    })

    test('new rule: the key is the owner plus the distinct modules in first-appearance order', () => {
        expect(loreIndexKey('c1', ['m2', 'm1', 'm2'])).toBe(loreIndexKey('c1', ['m2', 'm1']))
        expect(loreIndexKey('c1', ['m1', 'm2'])).not.toBe(loreIndexKey('c1', ['m2', 'm1']))
        expect(loreIndexKey('c1', [])).not.toBe(loreIndexKey('c2', []))
    })

    test('new rule: module entries are counted per owning module', () => {
        const entries = [...lore(1), { content: 'mod a', id: 'a', mode: 'normal' }, { content: 'mod b', id: 'b', mode: 'normal' }]
        const a = loreFingerprint({ entries, characterCount: 1, chatCount: 0, moduleOwners: ['m1', 'm2'] })
        const b = loreFingerprint({ entries, characterCount: 1, chatCount: 0, moduleOwners: ['m1', 'm1'] })
        expect(a).not.toBe(b)
    })
})

describe('createLoreIndexStore', () => {
    test('T16 a: a changed fingerprint builds in the background and nothing is ready until the scheduler drains', () => {
        const m = manual()
        const store = createLoreIndexStore(m.deps)
        const v1 = scan(lore(5))
        expect(store.ensure('c', v1)).toBeNull()
        expect(store.info().state).toBe('building')
        expect(store.ensure('c', v1)).toBeNull()
        m.drain()
        const ready = store.ensure('c', v1)
        expect(ready).not.toBeNull()
        expect(ready!.entries).toBe(5)
        expect(store.info().state).toBe('ready')
        // a count change starts over
        expect(store.ensure('c', scan(lore(6)))).toBeNull()
        expect(store.info().state).toBe('building')
        m.drain()
        expect(store.ensure('c', scan(lore(6)))!.entries).toBe(6)
    })

    test('T16 b: a same-length edit does not rebuild', () => {
        const m = manual()
        const store = createLoreIndexStore(m.deps)
        const v1 = scan(lore(4))
        store.ensure('c', v1)
        m.drain()
        const edited = lore(4)
        edited[2] = { ...edited[2], content: edited[2].content.replace('fortress', 'fortrezz') }
        expect(store.ensure('c', scan(edited))).not.toBeNull()
        expect(m.pending()).toBe(0)
    })

    test('T16 b: a different owner or module set rebuilds', () => {
        const m = manual()
        const store = createLoreIndexStore(m.deps)
        const v1 = scan(lore(2))
        store.ensure('c', v1)
        m.drain()
        expect(store.ensure('other', v1)).toBeNull()
        m.drain()
        expect(store.ensure('other', v1)).not.toBeNull()
    })

    test('T17: ensure returns before any chunk runs, chunks hold at most 300 entries, and the build is not awaited', () => {
        const m = manual()
        const store = createLoreIndexStore(m.deps)
        const v = scan(lore(700))
        expect(store.ensure('c', v)).toBeNull()
        expect(m.pending()).toBe(1)
        expect(store.info().entries).toBe(0)
        m.step()
        expect(m.pending()).toBe(1)
        expect(store.info().state).toBe('building')
        m.step()
        expect(m.pending()).toBe(1)
        m.step()
        expect(m.pending()).toBe(0)
        expect(LORE_BUILD_CHUNK).toBe(300)
        expect(store.ensure('c', v)!.entries).toBe(700)
    })

    test('T17: a superseded generation is discarded', () => {
        const m = manual()
        const store = createLoreIndexStore(m.deps)
        store.ensure('c', scan(lore(10)))
        store.ensure('c', scan(lore(12)))
        expect(m.pending()).toBe(2)
        m.drain()
        expect(store.info().entries).toBe(12)
        expect(store.ensure('c', scan(lore(12)))!.docs).toHaveLength(12)
    })

    test('new rule: child and folder entries are not indexed', () => {
        const m = manual()
        const store = createLoreIndexStore(m.deps)
        const v = scan([...lore(3), { content: 'link', id: 'id-0', mode: 'child' }, { content: '', id: 'f', mode: 'folder' }])
        store.ensure('c', v)
        m.drain()
        expect(store.ensure('c', v)!.entries).toBe(3)
    })

    test('new rule: a rebuild request starts a new build once and nothing is ready until it drains', () => {
        const m = manual()
        const store = createLoreIndexStore(m.deps)
        const v = scan(lore(3))
        store.ensure('c', v)
        m.drain()
        store.requestRebuild('c', v)
        store.requestRebuild('c', v)
        expect(m.pending()).toBe(1)
        expect(store.ensure('c', v)).toBeNull()
        m.drain()
        expect(store.ensure('c', v)).not.toBeNull()
    })

    test('new rule: a throwing hash marks the build failed and the send path never throws', () => {
        const m = manual()
        const store = createLoreIndexStore({ ...m.deps, hash: () => { throw new Error('boom') } })
        const v = scan([{ content: 'no id here', mode: 'normal' }])
        expect(store.ensure('c', v)).toBeNull()
        m.drain()
        expect(store.info().state).toBe('failed')
        expect(store.ensure('c', v)).toBeNull()
    })

    test('T18: the indexed body equals the stripped body of the scan, for decorators, @@@ fallbacks and @@@end', () => {
        const contents = [
            '@@depth 4\n@@activate_only_after 2\nPlain body after decorators',
            '@@@end\n@@@depth 3\nFallback body',
            '@@additional_keys a,b\n@@@additional_keys a\nText',
            'No decorators here',
        ]
        const m = manual()
        const store = createLoreIndexStore(m.deps)
        const v = scan(contents.map((content, i) => ({ content, id: 'e' + i, mode: 'normal' })))
        store.ensure('c', v)
        m.drain()
        const ready = store.ensure('c', v)!
        for (let i = 0; i < contents.length; i++) {
            // The scan's callback answers per decorator; the body never depends on that answer.
            const strict = CCardLib.decorator.parse(contents[i], () => undefined)
            const allTrue = CCardLib.decorator.parse(contents[i], () => true)
            const allFalse = CCardLib.decorator.parse(contents[i], () => false)
            expect(strict, String(i)).toBe(allTrue)
            expect(strict, String(i)).toBe(allFalse)
            expect(ready.bm25.score(strict).some((x) => x > 0) || strict.length === 0).toBe(true)
        }
        expect(ready.bm25.df('plain')).toBe(1)
        expect(ready.bm25.df('depth')).toBe(0)
    })
})

describe('createLoreLiveLookup', () => {
    const missedAll = () => true

    test('T9d: an id-less entry has the real pickHashRand identity and an id (even the empty one) is its own identity', () => {
        const m = manual()
        const store = createLoreIndexStore(m.deps)
        const entries: Entry[] = [
            { content: 'alpha text', mode: 'normal' },
            { content: 'beta text', id: '', mode: 'normal' },
            { content: 'gamma text', id: undefined, mode: 'normal' },
        ]
        const v = scan(entries)
        store.ensure('c', v)
        m.drain()
        const ready = store.ensure('c', v)!
        expect(ready.docs[0]).toEqual({ kind: 'hash', length: 10, hash: pickHashRand(5555, 'alpha text') })
        expect(ready.docs[1]).toEqual({ kind: 'id', id: '' })
        expect(ready.docs[2]).toEqual({ kind: 'hash', length: 10, hash: pickHashRand(5555, 'gamma text') })
        const lookup = createLoreLiveLookup(v, missedAll, m.deps.hash)
        expect(lookup.resolve(ready.docs[1])).toEqual({ kind: 'matches', indexes: [1] })
        expect(lookup.resolve(ready.docs[0])).toEqual({ kind: 'matches', indexes: [0] })
    })

    test('new rule: two live entries sharing an id both match, so the caller can skip both', () => {
        const v = scan([{ content: 'a', id: 'x', mode: 'normal' }, { content: 'b', id: 'x', mode: 'normal' }])
        const lookup = createLoreLiveLookup(v, missedAll, (c) => c.length)
        expect(lookup.resolve({ kind: 'id', id: 'x' })).toEqual({ kind: 'matches', indexes: [0, 1] })
        expect(lookup.resolve({ kind: 'id', id: 'none' })).toEqual({ kind: 'matches', indexes: [] })
    })

    test('new rule: child and folder entries are not live candidates', () => {
        const v = scan([{ content: 'a', id: 'x', mode: 'child' }, { content: 'b', id: 'f', mode: 'folder' }, { content: 'cc', mode: 'child' }])
        const lookup = createLoreLiveLookup(v, missedAll, (c) => c.length)
        expect(lookup.resolve({ kind: 'id', id: 'x' })).toEqual({ kind: 'matches', indexes: [] })
        expect(lookup.resolve({ kind: 'hash', length: 2, hash: 2 })).toEqual({ kind: 'prefiltered' })
    })

    test('new rule: a same-length edit resolves to no match once the bucket holds a missed entry', () => {
        const v = scan([{ content: 'abcdef', mode: 'normal' }])
        const lookup = createLoreLiveLookup(v, missedAll, (c) => pickHashRand(5555, c))
        expect(lookup.resolve({ kind: 'hash', length: 6, hash: pickHashRand(5555, 'abcdeX') })).toEqual({ kind: 'matches', indexes: [] })
        expect(lookup.hashCalls()).toBe(1)
    })
})
