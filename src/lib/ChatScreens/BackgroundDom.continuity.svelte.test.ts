// @vitest-environment jsdom

/**
 * The card background waits for the selected modules like the message bodies do, parses once when the gate opens, and
 * keeps its last look across later bumps, re-parses and rejected parses. The gate predicate is a plain flag paired with
 * a real writable run version, as `moduleEnsure.ts` pairs them. The parser is a held double that answers with the
 * post-trimMarkdown shape, a style element plus a div carrying the received input. These rows assert mount timing, not
 * sanitizer output, so identity-sanitizer falsification does not apply.
 *
 * Labels: R = regression reproducer (red on the base, which has no gate and blanks on every remount), G = guard
 * (passes before and after).
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    parses: [] as Array<{ args: unknown[], resolve: (html: string) => void, reject: (error: Error) => void }>,
    pending: false,
    nullScope: false,
}))

vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: { characters: [] as Array<Record<string, unknown>> } })
    const selIdState = $state({ selId: 0 })
    return {
        DBState,
        selIdState,
        selectedCharID: writable(0),
        ReloadGUIPointer: writable(0),
        moduleBackgroundEmbedding: writable(''),
    }
})
vi.mock('src/ts/process/moduleEnsure', async () => {
    const { writable } = await import('svelte/store')
    return {
        selectedModulesPending: () => h.pending,
        moduleRunVersion: writable(0),
    }
})
vi.mock('src/ts/parser/parser.svelte', () => ({
    risuChatParser: vi.fn((text: string) => text),
    ParseMarkdown: vi.fn((...args: unknown[]) => new Promise<string>((resolve, reject) => { h.parses.push({ args, resolve, reject }) })),
}))
vi.mock('src/ts/storage/database.svelte', async () => {
    const stores = await import('src/ts/stores.svelte')
    const owner = () => (stores.DBState as unknown as { db: { characters: Array<Record<string, unknown>> } }).db.characters[
        (stores.selIdState as unknown as { selId: number }).selId
    ]
    return {
        getCurrentCharacter: () => owner(),
        getCurrentChat: () => (h.nullScope ? undefined : (owner()?.chats as Array<unknown> | undefined)?.[0]),
    }
})
vi.mock('src/ts/alert', () => ({ alertError: vi.fn() }))

import BackgroundDom from 'src/lib/ChatScreens/BackgroundDom.svelte'
import { clearChatBodyRenderCache } from 'src/lib/ChatScreens/chatBodyRenderCache'
import { DBState, ReloadGUIPointer, moduleBackgroundEmbedding, selIdState, selectedCharID } from 'src/ts/stores.svelte'
import { moduleRunVersion } from 'src/ts/process/moduleEnsure'
import { risuChatParser, ParseMarkdown } from 'src/ts/parser/parser.svelte'
import { alertError } from 'src/ts/alert'

const htmlOf = (label: string) => `<style>.x-risu-a{color:red}</style><div id="bg">${label}</div>`
const sample = (t: HTMLElement) => ({
    style: t.querySelectorAll('style').length,
    text: t.querySelector('#bg')?.textContent ?? null,
})
const settle = async () => { flushSync(); await tick(); await Promise.resolve(); await Promise.resolve(); flushSync() }
const resolveParse = async (index: number, label: string) => { h.parses[index].resolve(htmlOf(label)); await settle() }
const openGate = async () => { h.pending = false; moduleRunVersion.update((n) => n + 1); await settle() }

const mounted: Array<{ instance: object, target: HTMLElement }> = []
function mountBackground() {
    const target = document.createElement('div')
    document.body.append(target)
    const instance = mount(BackgroundDom, { target })
    mounted.push({ instance, target })
    return target
}

function setChars(...sources: string[]) {
    DBState.db.characters = sources.map((backgroundHTML, i) => ({
        chaId: 'c' + i,
        chatPage: 0,
        chats: [{ id: 'chat' + i }],
        backgroundHTML,
    })) as never
}

beforeEach(() => {
    h.parses.length = 0
    h.pending = false
    h.nullScope = false
    selIdState.selId = 0
    selectedCharID.set(0)
    ReloadGUIPointer.set(0)
    moduleBackgroundEmbedding.set('')
    moduleRunVersion.set(0)
    clearChatBodyRenderCache()
    setChars('CARD')
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(async () => {
    for (const { instance, target } of mounted.splice(0)) {
        await unmount(instance as never).catch(() => {})
        target.remove()
    }
})

describe('first open', () => {
    test('R T1: no CBS and no parse while pending, then one parse with the embedding, shown once', async () => {
        h.pending = true
        const target = mountBackground()
        await settle()
        const styles = [sample(target).style]
        // The bumps of a first open land while the gate is pending.
        ReloadGUIPointer.set(1)
        await settle()
        moduleBackgroundEmbedding.set('\nEMBED\n')
        await settle()
        ReloadGUIPointer.set(2)
        await settle()
        styles.push(sample(target).style)
        expect(risuChatParser).not.toHaveBeenCalled()
        expect(ParseMarkdown).not.toHaveBeenCalled()

        await openGate()
        styles.push(sample(target).style)
        expect(h.parses).toHaveLength(1)
        expect(h.parses[0].args[0]).toContain('EMBED')
        await resolveParse(0, 'final')
        styles.push(sample(target).style)
        expect(styles).toEqual([0, 0, 0, 1])
        expect(sample(target).text).toBe('final')
    })

    test('G T7: an embedding set after the gate opened never lets the earlier run commit', async () => {
        h.pending = true
        const target = mountBackground()
        await settle()
        await openGate()
        expect(h.parses).toHaveLength(1)
        moduleBackgroundEmbedding.set('\nEMBED\n')
        await settle()
        expect(h.parses).toHaveLength(2)
        await resolveParse(0, 'early')
        expect(sample(target)).toEqual({ style: 0, text: null })
        await resolveParse(1, 'final')
        expect(sample(target).text).toBe('final')
    })

    test('G T9: with no pending modules, one parse at mount with the same arguments as before', async () => {
        const target = mountBackground()
        await settle()
        expect(h.parses).toHaveLength(1)
        expect(h.parses[0].args).toEqual(['CARD\n', DBState.db.characters[0], 'back'])
        await resolveParse(0, 'a')
        expect(sample(target).text).toBe('a')
    })
})

describe('an open chat', () => {
    test('R T2: a ReloadGUIPointer bump keeps the old look until the new parse resolves', async () => {
        const target = mountBackground()
        await settle()
        await resolveParse(0, 'old')
        ReloadGUIPointer.set(5)
        flushSync()
        expect(sample(target)).toEqual({ style: 1, text: 'old' })
        await settle()
        expect(h.parses).toHaveLength(2)
        expect(sample(target)).toEqual({ style: 1, text: 'old' })
        await resolveParse(1, 'new')
        expect(sample(target).text).toBe('new')
    })

    test('R T3: an embedding change keeps the old look while its parse is unresolved', async () => {
        const target = mountBackground()
        await settle()
        await resolveParse(0, 'old')
        moduleBackgroundEmbedding.set('\nE2\n')
        await settle()
        expect(h.parses).toHaveLength(2)
        expect(sample(target)).toEqual({ style: 1, text: 'old' })
    })

    test('G T4: when the older parse resolves last, the newer result stays', async () => {
        const target = mountBackground()
        await settle()
        moduleBackgroundEmbedding.set('\nB\n')
        await settle()
        expect(h.parses).toHaveLength(2)
        await resolveParse(1, 'newer')
        await resolveParse(0, 'older')
        expect(sample(target).text).toBe('newer')
    })

    test('R T8: a rejected later parse keeps the old look and raises no alert', async () => {
        const target = mountBackground()
        await settle()
        await resolveParse(0, 'old')
        ReloadGUIPointer.set(1)
        await settle()
        h.parses[1].reject(new Error('parse failed'))
        await settle()
        expect(sample(target).text).toBe('old')
        expect(alertError).not.toHaveBeenCalled()
    })

    test('G E2: an emptied background source removes the background', async () => {
        const target = mountBackground()
        await settle()
        await resolveParse(0, 'old')
        expect(sample(target).text).toBe('old')
        DBState.db.characters[0].backgroundHTML = ''
        await settle()
        expect(sample(target)).toEqual({ style: 0, text: null })
    })
})

describe('chat switches', () => {
    test('G T5: another chat\'s look is never shown for the new chat', async () => {
        setChars('ONE', 'TWO')
        const target = mountBackground()
        await settle()
        await resolveParse(0, 'one')
        selectedCharID.set(1)
        selIdState.selId = 1
        await settle()
        expect(sample(target)).toEqual({ style: 0, text: null })
        await resolveParse(0, 'stale-one')
        expect(sample(target)).toEqual({ style: 0, text: null })
        await resolveParse(1, 'two')
        expect(sample(target).text).toBe('two')
    })

    test('R E3: a switch while pending clears the old chat, and the other chat\'s later release does not blank the new look', async () => {
        setChars('ONE', 'TWO')
        const target = mountBackground()
        await settle()
        await resolveParse(0, 'one')
        h.pending = true
        moduleRunVersion.update((n) => n + 1)
        await settle()
        selectedCharID.set(1)
        selIdState.selId = 1
        await settle()
        expect(sample(target)).toEqual({ style: 0, text: null })
        // The new chat has no stubs, so its gate is open while the old chat's load continues elsewhere.
        h.pending = false
        selectedCharID.set(1)
        await openGate()
        const parsesAfterOpen = h.parses.length
        await resolveParse(parsesAfterOpen - 1, 'two')
        ReloadGUIPointer.set(9)
        await settle()
        expect(sample(target)).toEqual({ style: 1, text: 'two' })
        await resolveParse(h.parses.length - 1, 'two2')
        expect(sample(target).text).toBe('two2')
    })

    test('R E1: with no known scope the background still parses and shows, and nothing is seeded on a remount', async () => {
        h.nullScope = true
        const target = mountBackground()
        await settle()
        expect(h.parses).toHaveLength(1)
        await resolveParse(0, 'x')
        expect(sample(target).text).toBe('x')
        ReloadGUIPointer.set(1)
        await settle()
        expect(sample(target).text).toBe('x')
        const second = mountBackground()
        await settle()
        expect(sample(second)).toEqual({ style: 0, text: null })
    })
})

describe('remount', () => {
    test('R T6: a remount in the same chat with the same input shows the last look at once', async () => {
        const first = mountBackground()
        await settle()
        await resolveParse(0, 'seen')
        const entry = mounted.pop()!
        await unmount(entry.instance as never)
        first.remove()

        const second = mountBackground()
        flushSync()
        await tick()
        expect(h.parses).toHaveLength(2)
        expect(sample(second)).toEqual({ style: 1, text: 'seen' })
    })
})
