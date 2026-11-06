// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync } from 'svelte'
import { writable } from 'svelte/store'

interface TestCharacter {
    chaId: string
    type: string
    chatPage: number
    chats: { id: string }[]
}

const db = $state({ db: { theme: '', characters: [] as TestCharacter[] } })
const selection = $state({ selId: -1 })

const selectedCharID = writable(0)
vi.mock('../stores.svelte', () => ({ DBState: db, selIdState: selection, selectedCharID }))

async function load() {
    vi.resetModules()
    return import('./shellSwitch.svelte')
}

beforeEach(() => {
    localStorage.clear()
    db.db.theme = ''
    db.db.characters = []
    selection.selId = -1
    selectedCharID.set(0)
})

describe('S0 shell switch', () => {
    test('an absent value defaults off without writing', async () => {
        const write = vi.spyOn(Storage.prototype, 'setItem')
        const { shellSwitch } = await load()
        expect(shellSwitch.enabled).toBe(false)
        expect(write).not.toHaveBeenCalled()
        write.mockRestore()
    })

    test('stored 1 reads true and an unknown value is left in place', async () => {
        localStorage.setItem('risuChatShell.enabled', '1')
        expect((await load()).shellSwitch.enabled).toBe(true)
        localStorage.setItem('risuChatShell.enabled', 'future')
        const { shellSwitch } = await load()
        expect(shellSwitch.enabled).toBe(false)
        expect(localStorage.getItem('risuChatShell.enabled')).toBe('future')
    })

    test('unreadable storage defaults off without writing', async () => {
        const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
        const write = vi.spyOn(Storage.prototype, 'setItem')
        expect((await load()).shellSwitch.enabled).toBe(false)
        expect(write).not.toHaveBeenCalled()
        read.mockRestore()
        write.mockRestore()
    })

    test('the setter is the writer', async () => {
        const switcher = await load()
        switcher.setShellEnabled(true)
        expect(switcher.shellSwitch.enabled).toBe(true)
        expect(localStorage.getItem('risuChatShell.enabled')).toBe('1')
    })

    test('eligibility requires Standard Risu and an on-screen non-group chat', async () => {
        const switcher = await load()
        db.db.characters = [{ chaId: 'char', type: 'character', chatPage: 0, chats: [{ id: 'chat' }] }]
        selection.selId = 0
        expect(switcher.shellEligible()).toBe(false)
        switcher.setShellEnabled(true)
        expect(switcher.shellEligible()).toBe(true)
        for (const theme of ['waifu', 'mobilechat', 'cardboard', 'customHTML', 'other']) {
            db.db.theme = theme
            expect(switcher.shellEligible()).toBe(false)
        }
        db.db.theme = ''
        db.db.characters[0].type = 'group'
        expect(switcher.shellEligible()).toBe(false)
        db.db.characters[0].type = 'character'
        db.db.characters[0].chaId = '§playground'
        expect(switcher.shellEligible()).toBe(false)
        db.db.characters = []
        expect(switcher.shellEligible()).toBe(false)
    })

    test('T26b: selection changes invalidate a live reactive eligibility reader', async () => {
        const switcher = await load()
        db.db.characters = [
            { chaId: 'char', type: 'character', chatPage: 0, chats: [{ id: 'a' }] },
            { chaId: 'group', type: 'group', chatPage: 0, chats: [{ id: 'b' }] },
            { chaId: '§playground', type: 'character', chatPage: 0, chats: [{ id: 'c' }] },
        ]
        switcher.setShellEnabled(true)
        const seen: boolean[] = []
        const stop = $effect.root(() => {
            $effect(() => { seen.push(switcher.shellEligible()) })
        })
        selection.selId = 0
        flushSync()
        selection.selId = 1
        flushSync()
        selection.selId = 2
        flushSync()
        selection.selId = 0
        flushSync()
        expect(seen.slice(-4)).toEqual([true, false, false, true])
        stop()
    })
})
