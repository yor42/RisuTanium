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

// Passes the real install through and records whether the patched runtime had already linked a record for the root
// when stores.svelte made the call: it has once anything read `DBState` before the install.
const install = vi.hoisted(() => ({ rootLinkedBeforeInstall: null as boolean | null }))
vi.mock('../dbWriteHook', async (importOriginal) => {
    const original = await importOriginal<typeof import('../dbWriteHook')>()
    const { stateRecords } = await import('../svelteStatePatch')
    return {
        ...original,
        installDbWriteHook: (root: object, options: Parameters<typeof original.installDbWriteHook>[1]) => {
            install.rootLinkedBeforeInstall = stateRecords.has(root)
            return original.installDbWriteHook(root, options)
        },
    }
})

// Required marks: a DBState write reaches the save marks synchronously through the write hook that stores.svelte
// installs on DBState, with no effect flush in between. Each test asserts that mark at the write, where the effects
// alone (an effect flush, a thrown effect, a pending markup await, a non-selected character) leave it absent.

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

describe('DBState write marks: the write hook marks at the write, before any effect runs', () => {
    it('R1: a selected-character message write is marked before an effect flush', () => {
        page.snapshot()
        DBState.db.characters[0].chats[0].message[0].data = 'edited'
        expect(page.dirty).toBe(true)
        expect(page.tracker.character).toContain('cA')
        flushSync()
        expect(page.dirty).toBe(true)
    })

    it('R1b: a non-selected character write is marked at the write and stays marked after a flush', () => {
        page.snapshot()
        DBState.db.characters[1].personality = 'edited'
        expect(page.dirty).toBe(true)
        expect(page.tracker.character).toContain('cB')
        flushSync()
        expect(page.dirty).toBe(true)
        expect(page.tracker.character).toContain('cB')
    })

    it('R2: a write after a flush in which another effect threw is marked at the write', () => {
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
        const marksBefore = page.marks

        DBState.db.characters[0].personality = 'p2'
        expect(page.dirty).toBe(true)
        expect(page.marks - marksBefore).toBeGreaterThanOrEqual(1)
        try { flushSync() } catch { /* the scheduler may keep rethrowing the failed effect */ }
        expect(page.dirty).toBe(true)
    })

    it('R3: a write in the same turn as a pending markup await is marked while it is pending', async () => {
        const fixture: { default: Component<{ load: (name: string) => Promise<string> }> } = await import('./PendingAwait.asyncFixture.svelte')
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
        const marksBefore = page.marks

        DBState.db.characters[0].name = 'trigger'
        DBState.db.characters[0].personality = 'p3'
        expect(page.dirty).toBe(true)
        expect(page.marks - marksBefore).toBeGreaterThanOrEqual(1)
        await new Promise((resolve) => setTimeout(resolve, 60))
        expect(releaseLoad).toBeTypeOf('function')
        expect(page.dirty).toBe(true)
    })
})

describe('the install in stores.svelte', () => {
    it('I28: the hook is installed before DBState is first read, so every record is linked as it is created', () => {
        expect(install.rootLinkedBeforeInstall).toBe(false)
    })

    it('a write the hook cannot pin to a character marks the selected character, whose id the install provides', () => {
        selectedCharID.set(1)
        DBState.db.characters.push({ chaId: '', type: 'character', name: 'no usable id', chats: [] } as never)
        page.snapshot()

        DBState.db.characters[2].name = 'edited'

        expect(page.tracker.character).toContain('cB')
        expect(page.dirty).toBe(true)
    })
})
