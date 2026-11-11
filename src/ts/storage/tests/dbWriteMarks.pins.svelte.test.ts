// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync, mount, unmount, type Component } from 'svelte'
import { DBState, selectedCharID, selIdState } from '../../stores.svelte'
import { makeDb, startMiniPage } from './dbWriteMarksMiniPage.svelte'

// The parser's module-level effect reads selIdState while the stores module is still initialising; these pins never parse.
vi.mock('../../parser/parser.svelte', () => ({
    hasher: vi.fn((s: string) => s),
    risuChatParser: vi.fn((text: string) => text ?? ''),
    assetRegex: /{{asset:[^}]+}}/g,
}))
vi.mock('../../parser/chatML', () => ({ parseChatML: vi.fn(() => []) }))

// Limitation pins: each test asserts what a DBState write does TODAY, before a write hook exists. The flip to the
// required assertion (a synchronous mark) changes the first expectation of each test and nothing else.

let page: ReturnType<typeof startMiniPage>
let disposers: Array<() => void> = []

beforeEach(() => {
    DBState.db = makeDb() as never
    selectedCharID.set(0)
    selIdState.selId = 0
    page = startMiniPage()
})

afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose()
    page.stop()
})

describe('DBState write marks: limitation pins on the current effect-only marking', () => {
    it('pin R1: a selected-character message write is not marked until an effect flush', () => {
        page.snapshot()
        DBState.db.characters[0].chats[0].message[0].data = 'edited'
        expect(page.dirty).toBe(false)
        flushSync()
        expect(page.dirty).toBe(true)
    })

    it('pin R1b: a non-selected character write is never marked, before or after a flush', () => {
        page.snapshot()
        DBState.db.characters[1].personality = 'edited'
        expect(page.dirty).toBe(false)
        expect(page.tracker.character).not.toContain('cB')
        flushSync()
        expect(page.dirty).toBe(false)
        expect(page.tracker.character).not.toContain('cB')
    })

    it('pin R2: a write after a flush in which another effect threw is never marked', () => {
        const stopThrower = $effect.root(() => {
            $effect.pre(() => {
                if (DBState.db.characters[0].name === 'trigger') throw new Error('thrower')
            })
        })
        disposers.push(stopThrower)
        flushSync()
        page.snapshot()

        DBState.db.characters[0].name = 'trigger'
        DBState.db.characters[0].personality = 'p1'
        expect(() => flushSync()).toThrow('thrower')
        page.snapshot()
        const effectMarksBefore = page.effectMarks

        DBState.db.characters[0].personality = 'p2'
        try { flushSync() } catch { /* the scheduler may keep rethrowing the failed effect */ }
        expect(page.dirty).toBe(false)
        expect(page.effectMarks - effectMarksBefore).toBe(0)
    })

    it('pin R3: a write in the same turn as a pending markup await is not marked while it is pending', async () => {
        // Loaded through a variable path so the type checker never compiles the fixture without experimental.async.
        const fixturePath = './PendingAwait.asyncFixture.svelte'
        const fixture: { default: Component<{ load: (name: string) => Promise<string> }> } = await import(/* @vite-ignore */ fixturePath)
        let releaseLoad!: (value: string) => void
        const load = (name: string) => name === 'A'
            ? Promise.resolve('ready')
            : new Promise<string>((resolve) => { releaseLoad = resolve })
        const host = document.createElement('div')
        document.body.appendChild(host)
        const component = mount(fixture.default, { target: host, props: { load } })
        disposers.push(() => { void unmount(component); host.remove() })
        await new Promise((resolve) => setTimeout(resolve, 60))
        flushSync()
        page.snapshot()
        const effectMarksBefore = page.effectMarks

        DBState.db.characters[0].name = 'trigger'
        DBState.db.characters[0].personality = 'p3'
        await new Promise((resolve) => setTimeout(resolve, 60))
        expect(releaseLoad).toBeTypeOf('function')
        expect(page.dirty).toBe(false)
        expect(page.effectMarks - effectMarksBefore).toBe(0)
    })
})
