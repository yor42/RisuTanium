import { describe, expect, test, vi } from 'vitest'
import { HINT_MS, LONG_CHAT_MESSAGES, createLongChatHint, type HintChat } from './longChatHint'

/**
 * The hint controller: once per chat, past the message threshold, gone after 8 s or on a dismissal, and a repeated question for
 * the chat it is showing changes nothing. Pure: the timer and the persisted flag are injected.
 */

function setup(options: { writeThrows?: boolean } = {}) {
    const flags = new Set<string>()
    const timers = new Map<number, () => void>()
    let nextTimer = 1
    const changes = vi.fn()
    const deps = {
        setTimer: (callback: () => void, _ms: number) => {
            const id = nextTimer++
            timers.set(id, callback)
            return id
        },
        clearTimer: (id: number) => { timers.delete(id) },
        read: vi.fn((cha: string, chat: string) => flags.has(`${cha}:${chat}`)),
        write: vi.fn((cha: string, chat: string) => {
            if (options.writeThrows) throw new Error('write failed')
            flags.add(`${cha}:${chat}`)
        }),
        onChange: changes,
    }
    const hint = createLongChatHint(deps)
    const fire = () => { for (const [id, callback] of [...timers]) { timers.delete(id); callback() } }
    return { hint, deps, flags, timers, fire, changes }
}

const chat = (id: string | undefined, slot = 0): HintChat => ({ cha: 'c', chat: id, slot })

describe('long-chat hint controller', () => {
    test('T4.1 a long chat without a flag shows the hint and sets the flag at show; a second open stays hidden', () => {
        const { hint, deps, flags } = setup()
        expect(hint.open(chat('a'), LONG_CHAT_MESSAGES + 1)).toBe(true)
        expect(hint.state.count).toBe(LONG_CHAT_MESSAGES + 1)
        expect(deps.write).toHaveBeenCalledWith('c', 'a')
        expect(flags.has('c:a')).toBe(true)
        hint.dismiss()
        expect(hint.open(chat('a'), LONG_CHAT_MESSAGES + 1)).toBe(false)
        expect(hint.state.count).toBeNull()
    })

    test('T4.1 asking again for the chat whose hint is visible is ignored: no write, no timer restart, no hide', () => {
        const { hint, deps, timers } = setup()
        hint.open(chat('a'), 2500)
        const armed = [...timers.keys()]
        expect(hint.open(chat('a'), 2500)).toBe(false)
        expect(hint.state.count).toBe(2500)
        expect(deps.write).toHaveBeenCalledTimes(1)
        expect([...timers.keys()]).toEqual(armed)
    })

    test('T4.2 a chat of exactly the threshold shows nothing and sets no flag', () => {
        const { hint, deps } = setup()
        expect(hint.open(chat('a'), LONG_CHAT_MESSAGES)).toBe(false)
        expect(hint.state.count).toBeNull()
        expect(deps.write).not.toHaveBeenCalled()
    })

    test('T4.3 the hint leaves after HINT_MS, on a dismissal and on a chat switch, clearing the timer each time', () => {
        const { hint, timers, fire } = setup()
        hint.open(chat('a'), 3000)
        expect(timers.size).toBe(1)
        fire()
        expect(hint.state.count).toBeNull()
        expect(timers.size).toBe(0)

        hint.open(chat('b'), 3000)
        hint.dismiss()
        expect(hint.state.count).toBeNull()
        expect(timers.size).toBe(0)

        hint.open(chat('d'), 3000)
        hint.open(chat('e'), 10)
        expect(hint.state.count).toBeNull()
        expect(timers.size).toBe(0)
        expect(HINT_MS).toBe(8000)
    })

    test('a chat switch into another long chat replaces the hint with the new count', () => {
        const { hint } = setup()
        hint.open(chat('a'), 2100)
        expect(hint.open(chat('b'), 2200)).toBe(true)
        expect(hint.state.count).toBe(2200)
    })

    test('a chat without an id is limited per session and never reaches the persisted flag', () => {
        const { hint, deps } = setup()
        expect(hint.open(chat(undefined, 1), 2500)).toBe(true)
        hint.dismiss()
        expect(hint.open(chat(undefined, 1), 2500)).toBe(false)
        expect(hint.open(chat(undefined, 2), 2500)).toBe(true)
        expect(deps.read).not.toHaveBeenCalled()
        expect(deps.write).not.toHaveBeenCalled()
    })

    test('a failing flag write still shows the hint and does not throw', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const { hint } = setup({ writeThrows: true })
        expect(hint.open(chat('a'), 2500)).toBe(true)
        expect(hint.state.count).toBe(2500)
        error.mockRestore()
    })
})
