// @vitest-environment jsdom
// PT0: the patched Svelte client runtime (patches/svelte-5.57.3, served by its plugin under vitest.config.ts) is the
// one that compiled runes code runs against, and the seam sees the same instance. Without the plugin the seam's
// named imports read undefined and these tests fail.
import { afterEach, describe, expect, it } from 'vitest'
import { STATE_PATCH_ID, linkStateChild, recordOf, setStateWriteHook, stateRecords } from '../svelteStatePatch'

afterEach(() => {
    setStateWriteHook(null)
})

describe('PT0 patched Svelte runtime', () => {
    it('the seam exports the patch API and names the patch revision', () => {
        expect(typeof setStateWriteHook).toBe('function')
        expect(typeof linkStateChild).toBe('function')
        expect(typeof recordOf).toBe('function')
        expect(stateRecords).toBeInstanceOf(WeakMap)
        expect(STATE_PATCH_ID).toBe('risu-proxy-patch svelte@5.57.3 r1')
    })

    it('a compiled $state write reaches the registered callback with kind, owner, key, value and stored value', () => {
        const seen: string[] = []
        setStateWriteHook((kind, _owner, prop, value) => { seen.push(kind + ':' + String(prop) + '=' + String(value)) })
        const state = $state({ child: { n: 1 }, list: [1] })
        state.child.n = 2
        state.list.push(7)
        delete (state.child as { n?: number }).n
        Object.defineProperty(state, 'late', { value: 5, writable: true, enumerable: true, configurable: true })
        expect(seen).toContain('0:n=2')
        expect(seen).toContain('0:1=7')
        expect(seen).toContain('1:n=undefined')
        expect(seen).toContain('2:late=5')
    })

    it('an unchanged value and a no-op delete report nothing', () => {
        const seen: string[] = []
        setStateWriteHook((kind, _owner, prop) => { seen.push(kind + ':' + String(prop)) })
        const state = $state({ n: 1 }) as { n: number, absent?: number }
        state.n = 1
        delete state.absent
        expect(seen).toEqual([])
    })

    it('a child proxy gets a record linked to its parent record under the key it was stored with', () => {
        const state = $state({ child: { n: 1 }, list: [{ m: 1 }] })
        const child = state.child
        const element = state.list[0]
        const childRec = stateRecords.get(child)
        const elementRec = stateRecords.get(element)
        expect(childRec).toBeDefined()
        expect(childRec?.k).toBe('child')
        expect(childRec?.r).toBe(recordOf(state))
        expect(elementRec?.k).toBeNull()
        expect(elementRec?.r).toBe(recordOf(state.list))
    })

    it('records are shared only between arrays: a fresh array adopts the array it replaced, an object never does', () => {
        const state = $state({ box: { n: 1 }, items: [{ m: 1 }] })
        const oldBox = state.box
        const oldItems = state.items
        void oldBox.n
        void oldItems.length
        state.box = { n: 2 }
        state.items = [{ m: 2 }]
        expect(stateRecords.get(state.items)).toBe(stateRecords.get(oldItems))
        expect(stateRecords.get(state.box)).not.toBe(stateRecords.get(oldBox))
    })

    it('the link callback fires once for a new array-parent link and never for an object key', () => {
        const linked: string[] = []
        setStateWriteHook(null, null, (_child, _childRec, parentRec) => { linked.push(String(parentRec.k)) })
        const state = $state({ list: [{ m: 1 }], holder: { inner: { n: 1 } } })
        void state.list[0]
        void state.list[0]
        void state.holder.inner
        expect(linked).toEqual(['list'])
    })

    it('PT5: a throwing write callback never fails the write and reaches the error sink', () => {
        const errors: unknown[] = []
        setStateWriteHook(() => { throw new Error('callback boom') }, (error) => { errors.push(error) })
        const state = $state({ a: 1 })
        expect(() => { state.a = 2 }).not.toThrow()
        expect(state.a).toBe(2)
        expect(errors.length).toBe(1)
        expect(String(errors[0])).toContain('callback boom')
    })

    it('with no callback registered, links are still recorded and writes behave as on the stock proxy', () => {
        const state = $state({ child: { n: 1 } })
        const child = state.child
        child.n = 2
        expect(state.child.n).toBe(2)
        expect(stateRecords.get(child)?.k).toBe('child')
    })
})
