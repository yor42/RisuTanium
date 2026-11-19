import { describe, expect, test } from 'vitest'
import { createCharacterSavedWaiter, type CharacterVerdict } from '../characterSaved'

/**
 * T9 (guard, new rule): the waiter consumes only on a covering commit whose verdict is `saved` or `gone`, asks for at
 * most one extra pass per key, and otherwise only listens. Fake deps: a commit is simulated by firing the callbacks.
 * Mutants M14 (mark count only), M38 (`gone` as `absent`), M39 (never self-request), M43 (request on every commit).
 */

function world() {
    const callbacks = new Set<() => void>()
    const state = { committed: 0, marks: 0, verdict: 'absent' as CharacterVerdict, requests: 0, marked: [] as string[], asked: [] as string[] }
    const waiter = createCharacterSavedWaiter({
        committedMarkCount: () => state.committed,
        markCount: () => state.marks,
        verdict: (id) => { state.asked.push(id); return state.verdict },
        afterNextCommit: (callback) => { callbacks.add(callback) },
        markCharacter: (id) => { state.marked.push(id); state.marks += 1 },
        requestSaveNow: () => { state.requests += 1; state.marks += 1 },
    })
    /** One commit: the count it covers and the verdict it carries; callbacks run over a copy, as the page does. */
    const commit = (covers: number, verdict: CharacterVerdict) => {
        state.committed = Math.max(state.committed, covers)
        state.verdict = verdict
        for (const callback of [...callbacks]) {
            callbacks.delete(callback)
            callback()
        }
    }
    return { state, waiter, commit, listening: () => callbacks.size }
}

describe('character saved waiter', () => {
    test('a commit that does not cover the target waits', () => {
        const w = world()
        const saved: string[] = []
        w.waiter.watch('k', 'cha', 5, (key) => saved.push(key))
        w.commit(4, 'saved')
        expect(saved).toEqual([])
        expect(w.listening()).toBe(1)
        w.commit(5, 'saved')
        expect(saved).toEqual(['k'])
        expect(w.listening()).toBe(0)
    })

    test('saved and gone consume once', () => {
        const w = world()
        const saved: string[] = []
        w.waiter.watch('a', 'cha', 1, (key) => saved.push(key))
        w.waiter.watch('b', 'other', 1, (key) => saved.push(key))
        w.commit(1, 'gone')
        w.commit(2, 'saved')
        expect(saved.sort()).toEqual(['a', 'b'])
    })

    test('a gone commit alone consumes both keys and leaves nothing listening', () => {
        const w = world()
        const saved: string[] = []
        w.waiter.watch('a', 'cha', 1, (key) => saved.push(key))
        w.waiter.watch('b', 'other', 1, (key) => saved.push(key))
        w.commit(1, 'gone')
        expect(saved.sort()).toEqual(['a', 'b'])
        expect(w.listening()).toBe(0)
        expect(w.waiter.pending()).toBe(0)
    })

    test('ten absent commits make exactly one request; ten skipped commits make none', () => {
        const absent = world()
        absent.waiter.watch('k', 'cha', 1, () => {})
        for (let i = 1; i <= 10; i++) { absent.commit(i + absent.state.marks, 'absent') }
        expect(absent.state.requests).toBe(1)

        const skipped = world()
        skipped.waiter.watch('k', 'cha', 1, () => {})
        for (let i = 1; i <= 10; i++) { skipped.commit(i, 'skipped') }
        expect(skipped.state.requests).toBe(0)
    })

    test('three skipped commits request nothing', () => {
        const w = world()
        w.waiter.watch('k', 'cha', 1, () => {})
        for (let i = 1; i <= 3; i++) { w.commit(i, 'skipped') }
        expect(w.state.requests).toBe(0)
        expect(w.state.marked).toEqual([])
        expect(w.listening()).toBe(1)
    })

    test('two absent commits make exactly one request, then only listen', () => {
        const w = world()
        w.waiter.watch('k', 'cha', 1, () => {})
        w.commit(1, 'absent')
        expect(w.state.requests).toBe(1)
        expect(w.state.marked).toEqual(['cha'])
        // The request counted a mark: the next commit that covers it is the one that is judged.
        w.commit(w.state.marks, 'absent')
        w.commit(w.state.marks + 1, 'absent')
        expect(w.state.requests).toBe(1)
        expect(w.listening()).toBe(1)
    })

    test('absent then saved consumes', () => {
        const w = world()
        const saved: string[] = []
        w.waiter.watch('k', 'cha', 1, (key) => saved.push(key))
        w.commit(1, 'absent')
        w.commit(w.state.marks, 'saved')
        expect(saved).toEqual(['k'])
    })

    test('with no commit the key stays waiting and a later commit consumes it', () => {
        const w = world()
        const saved: string[] = []
        w.waiter.watch('k', 'cha', 1, (key) => saved.push(key))
        expect(w.waiter.pending()).toBe(1)
        expect(saved).toEqual([])
        w.commit(1, 'saved')
        expect(saved).toEqual(['k'])
    })

    test('a numeric chaId is asked as its string form', () => {
        const w = world()
        w.waiter.watch('k', 123, 1, () => {})
        w.commit(1, 'skipped')
        expect(w.state.asked).toEqual(['123'])
    })
})
