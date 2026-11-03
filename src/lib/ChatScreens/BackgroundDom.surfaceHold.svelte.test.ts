// @vitest-environment jsdom

/**
 * The real `BackgroundDom.svelte` under an installed chat surface. While Settings covers the chat the background
 * parses nothing; an input that changed meanwhile is parsed once on the return, and an idle visit parses nothing.
 * The parser is a held double. Settings is opened and closed through the real `settingsOpen` writable that
 * `chatSurface` follows. These rows assert call timing, not sanitizer output.
 *
 * Labels: R = regression reproducer (the base without the hold parses while hidden), G = guard.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    parses: [] as Array<{ args: unknown[], resolve: (html: string) => void, done: boolean }>,
}))

vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: {} as Record<string, unknown> })
    const selIdState = $state({ selId: 0 })
    return {
        DBState,
        selIdState,
        selectedCharID: writable(0),
        settingsOpen: writable(false),
        MobileGUI: writable(false),
        ReloadGUIPointer: writable(0),
        ReloadChatPointer: writable({} as Record<number, number>),
        moduleBackgroundEmbedding: writable(''),
    }
})
vi.mock('src/ts/parser/parser.svelte', () => ({
    risuChatParser: vi.fn((text: string) => text),
    ParseMarkdown: vi.fn((...args: unknown[]) => new Promise<string>((resolve) => {
        h.parses.push({ args, resolve, done: false })
    })),
}))
vi.mock('src/ts/storage/database.svelte', async () => {
    const stores = await import('src/ts/stores.svelte')
    const db = () => (stores.DBState as unknown as { db: { characters: Array<{ chats: unknown[] }> } }).db
    const owner = () => db().characters[0]
    return {
        getDatabase: () => db(),
        getCurrentCharacter: () => owner(),
        getCurrentChat: () => owner()?.chats[0],
    }
})
vi.mock('src/ts/alert', () => ({ alertError: vi.fn() }))
vi.mock('src/ts/util', () => ({ checkPersonaBinded: vi.fn(() => false) }))

import BackgroundDom from 'src/lib/ChatScreens/BackgroundDom.svelte'
import { clearChatBodyRenderCache } from 'src/lib/ChatScreens/chatBodyRenderCache'
import { installChatSurface, resetChatSurfaceForTests } from 'src/lib/ChatScreens/chatSurface.svelte'
import { DBState, ReloadGUIPointer, moduleBackgroundEmbedding, selectedCharID, selIdState, settingsOpen } from 'src/ts/stores.svelte'
import { ParseMarkdown } from 'src/ts/parser/parser.svelte'

const wait = async (ms = 0) => { await new Promise((r) => setTimeout(r, ms)); flushSync() }
const backParses = () => vi.mocked(ParseMarkdown).mock.calls.filter((call) => call[2] === 'back')
const mounted: Array<{ instance: object, target: HTMLElement }> = []

async function answerAll() {
    for (const parse of h.parses.filter((p) => !p.done)) {
        parse.done = true
        parse.resolve(`<div id="bg">${String(parse.args[0])}</div>`)
    }
    await wait(20)
}

async function mountSettledBackground() {
    DBState.db = {
        modules: [],
        enabledModules: [],
        moduleIntergration: '',
        characters: [{ chaId: 'a', chatPage: 0, chats: [{ id: 'cA' }], backgroundHTML: 'CARD' }],
    } as never
    const target = document.createElement('div')
    document.body.append(target)
    mounted.push({ instance: mount(BackgroundDom, { target }), target })
    flushSync()
    await wait(20)
    await answerAll()
    expect(target.querySelector('#bg')?.textContent).toContain('CARD')
    return target
}

async function openSettings() {
    settingsOpen.set(true)
    await tick()
    await tick()
}

async function closeSettings() {
    settingsOpen.set(false)
    await tick()
    await tick()
    await wait(20)
}

beforeEach(() => {
    h.parses.length = 0
    selIdState.selId = 0
    selectedCharID.set(0)
    ReloadGUIPointer.set(0)
    settingsOpen.set(false)
    moduleBackgroundEmbedding.set('')
    clearChatBodyRenderCache()
    resetChatSurfaceForTests()
    installChatSurface()
    vi.clearAllMocks()
})

afterEach(async () => {
    for (const { instance, target } of mounted.splice(0)) {
        await unmount(instance as never).catch(() => {})
        target.remove()
    }
    resetChatSurfaceForTests()
    settingsOpen.set(false)
})

describe('the background under the chat surface', () => {
    test('R T14 an embedding change while hidden parses nothing hidden, then once on the return', async () => {
        const target = await mountSettledBackground()
        const mark = backParses().length

        await openSettings()
        moduleBackgroundEmbedding.set('EMBED')
        await wait(30)
        expect(backParses().length - mark).toBe(0)

        await closeSettings()
        expect(backParses().length - mark).toBe(1)
        expect(String(backParses().at(-1)![0])).toContain('EMBED')
        await answerAll()
        expect(target.querySelector('#bg')?.textContent).toContain('EMBED')
    })

    test('R a GUI bump while hidden parses nothing hidden, then once on the return', async () => {
        await mountSettledBackground()
        const mark = backParses().length

        await openSettings()
        ReloadGUIPointer.update((v) => v + 1)
        await wait(30)
        expect(backParses().length - mark).toBe(0)

        await closeSettings()
        expect(backParses().length - mark).toBe(1)
    })

    test('G an idle visit parses nothing', async () => {
        await mountSettledBackground()
        const mark = backParses().length

        await openSettings()
        await wait(30)
        await closeSettings()

        expect(backParses().length - mark).toBe(0)
    })

    test('G the background still follows an input change after the visit', async () => {
        await mountSettledBackground()
        await openSettings()
        moduleBackgroundEmbedding.set('EMBED')
        await closeSettings()
        await answerAll()
        const mark = backParses().length

        moduleBackgroundEmbedding.set('EMBED2')
        await wait(30)

        expect(backParses().length - mark).toBe(1)
    })
})
