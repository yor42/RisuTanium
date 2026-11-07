// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync } from 'svelte'
import { writable } from 'svelte/store'
// Reactive cases use this one instance: a module re-imported after resetModules would bring its
// own copy of the Svelte runtime, which the test's effects do not track.
import * as shared from './studioSwitch.svelte'

interface TestCharacter {
    chaId: string
    type: string
    coldstorage?: string
    chatPage: number
    chats: { id: string }[]
}

const db = $state({ db: { theme: '', characters: [] as TestCharacter[] } })
const selection = $state({ selId: -1 })
const MobileGUI = writable(false)

// Getters: the statically imported module is evaluated before these consts are initialised.
vi.mock('../stores.svelte', () => ({
    get DBState() { return db },
    get selIdState() { return selection },
    get MobileGUI() { return MobileGUI },
}))

async function load() {
    vi.resetModules()
    return import('./studioSwitch.svelte')
}

function character(overrides: Partial<TestCharacter> = {}): TestCharacter {
    return { chaId: 'char', type: 'character', chatPage: 0, chats: [{ id: 'chat' }], ...overrides }
}

beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    db.db.theme = ''
    db.db.characters = []
    selection.selId = -1
    MobileGUI.set(false)
    shared.setStudioEnabled(false)
    localStorage.clear()
})

describe('S0 studio switch', () => {
    test('an absent value defaults off without writing', async () => {
        const write = vi.spyOn(Storage.prototype, 'setItem')
        const { studioSwitch } = await load()
        expect(studioSwitch.enabled).toBe(false)
        expect(write).not.toHaveBeenCalled()
    })

    test('stored 0 and an unknown value read off and are left in place', async () => {
        localStorage.setItem('risuStudio.enabled', '0')
        expect((await load()).studioSwitch.enabled).toBe(false)
        localStorage.setItem('risuStudio.enabled', 'future')
        expect((await load()).studioSwitch.enabled).toBe(false)
        expect(localStorage.getItem('risuStudio.enabled')).toBe('future')
    })

    test('stored 1 reads on', async () => {
        localStorage.setItem('risuStudio.enabled', '1')
        expect((await load()).studioSwitch.enabled).toBe(true)
    })

    test('unreadable storage defaults off without writing', async () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
        const write = vi.spyOn(Storage.prototype, 'setItem')
        expect((await load()).studioSwitch.enabled).toBe(false)
        expect(write).not.toHaveBeenCalled()
    })

    test('0b: only risuStudio.enabled is read or written, and the chat shell key is ignored', async () => {
        localStorage.setItem('risuChatShell.enabled', '1')
        const read = vi.spyOn(Storage.prototype, 'getItem')
        const write = vi.spyOn(Storage.prototype, 'setItem')
        const switcher = await load()
        expect(switcher.studioSwitch.enabled).toBe(false)
        switcher.setStudioEnabled(true)
        expect(switcher.studioSwitch.enabled).toBe(true)
        switcher.setStudioEnabled(false)
        expect(read.mock.calls.map((call) => call[0])).toEqual(['risuStudio.enabled'])
        expect(write.mock.calls).toEqual([['risuStudio.enabled', '1'], ['risuStudio.enabled', '0']])
    })

    test('the setter keeps the in-memory choice when storage throws', async () => {
        const switcher = await load()
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full') })
        expect(() => switcher.setStudioEnabled(true)).not.toThrow()
        expect(switcher.studioSwitch.enabled).toBe(true)
    })
})

describe('S0b studio eligibility', () => {
    test('with the switch off nothing else is read', async () => {
        const switcher = shared
        selection.selId = 0
        db.db.characters = [character()]
        expect(switcher.studioEligible()).toBe(false)
    })

    test('0c: eligible under a custom theme and with no chat', async () => {
        const switcher = shared
        switcher.setStudioEnabled(true)
        db.db.characters = [character({ chats: [] })]
        selection.selId = 0
        expect(switcher.studioEligible()).toBe(true)
        for (const theme of ['waifu', 'mobilechat', 'cardboard', 'customHTML', 'other']) {
            db.db.theme = theme
            expect(switcher.studioEligible()).toBe(true)
        }
    })

    test('0d: no selection, group, playground and cold stub are refused', async () => {
        const switcher = shared
        switcher.setStudioEnabled(true)
        db.db.characters = [character()]
        expect(switcher.studioEligible()).toBe(false)
        selection.selId = 0
        expect(switcher.studioEligible()).toBe(true)
        db.db.characters[0].type = 'group'
        expect(switcher.studioEligible()).toBe(false)
        db.db.characters[0].type = 'character'
        db.db.characters[0].chaId = '§playground'
        expect(switcher.studioEligible()).toBe(false)
        db.db.characters[0].chaId = 'char'
        db.db.characters[0].coldstorage = 'unit-1'
        expect(switcher.studioEligible()).toBe(false)
        db.db.characters = []
        expect(switcher.studioEligible()).toBe(false)
    })

    test('0d: the Beta Mobile GUI refuses, and a live reader follows its changes and the selection', async () => {
        const switcher = shared
        switcher.setStudioEnabled(true)
        db.db.characters = [character(), character({ chaId: 'group', type: 'group' })]
        selection.selId = 0
        const seen: boolean[] = []
        const stop = $effect.root(() => {
            $effect(() => { seen.push(switcher.studioEligible()) })
        })
        flushSync()
        MobileGUI.set(true)
        flushSync()
        MobileGUI.set(false)
        flushSync()
        selection.selId = 1
        flushSync()
        selection.selId = 0
        flushSync()
        expect(seen).toEqual([true, false, true, false, true])
        stop()
    })

    test('0d: the Beta Mobile GUI is refused when it is on before the first check', async () => {
        const switcher = shared
        switcher.setStudioEnabled(true)
        db.db.characters = [character()]
        selection.selId = 0
        MobileGUI.set(true)
        expect(switcher.studioEligible()).toBe(false)
    })
})
