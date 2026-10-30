import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// Each test imports a fresh module, so every test starts with an empty record and an empty console de-duplication set.
async function freshModule() {
    vi.resetModules()
    return await import('./caughtErrors')
}

function records() {
    return window.__risuTaniumErrors ?? []
}

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    consoleError.mockRestore()
})

describe('T7 caught-error record', () => {
    test('an entry carries time, site, name, message and the first stack lines', async () => {
        const { recordCaughtError } = await freshModule()
        const error = new TypeError('boom')
        recordCaughtError('chat.message', error)

        expect(records()).toHaveLength(1)
        const entry = records()[0]
        expect(entry.site).toBe('chat.message')
        expect(entry.name).toBe('TypeError')
        expect(entry.message).toBe('boom')
        expect(Number.isNaN(Date.parse(entry.time))).toBe(false)
        expect(entry.stack.split('\n').length).toBeLessThanOrEqual(4)
        expect(entry.stack).toContain('TypeError: boom')
    })

    test('a thrown value that is not an Error is recorded by its text', async () => {
        const { recordCaughtError } = await freshModule()
        recordCaughtError('chat.parse', 'plain text')
        expect(records()[0]).toMatchObject({ site: 'chat.parse', name: 'NonError', message: 'plain text', stack: '' })
    })

    test('R a value without a string form is recorded with a fixed text and the recorder does not throw', async () => {
        const { recordCaughtError } = await freshModule()
        expect(() => recordCaughtError('chat.parse', Object.create(null))).not.toThrow()
        expect(records()[0]).toMatchObject({ site: 'chat.parse', name: 'NonError', stack: '' })
        expect(records()[0].message.length).toBeGreaterThan(0)
    })

    test('a long message is truncated', async () => {
        const { recordCaughtError } = await freshModule()
        recordCaughtError('chat.parse', new Error('x'.repeat(1000)))
        expect(records()[0].message).toHaveLength(300)
    })

    test('the ring keeps only the last MAX_RECORDS entries', async () => {
        const { recordCaughtError, MAX_RECORDS } = await freshModule()
        for (let i = 0; i < MAX_RECORDS + 25; i++) {
            recordCaughtError('chat.parse', new Error(`e${i}`))
        }
        const all = records()
        expect(all).toHaveLength(MAX_RECORDS)
        expect(all[0].message).toBe('e25')
        expect(all[all.length - 1].message).toBe(`e${MAX_RECORDS + 24}`)
    })

    test('the getter returns a copy: changing it changes neither the record nor later reads', async () => {
        const { recordCaughtError } = await freshModule()
        recordCaughtError('chat.parse', new Error('one'))
        const first = records()
        first[0].message = 'changed'
        first.push({ time: '', site: 'x', name: 'x', message: 'x', stack: '' })
        expect(records()).toHaveLength(1)
        expect(records()[0].message).toBe('one')
    })

    test('the console line is printed once per site and message, through the console at call time', async () => {
        const { recordCaughtError } = await freshModule()
        recordCaughtError('chat.parse', new Error('same'))
        recordCaughtError('chat.parse', new Error('same'))
        recordCaughtError('chat.message', new Error('same'))
        recordCaughtError('chat.parse', new Error('other'))
        expect(consoleError).toHaveBeenCalledTimes(3)
        expect(records()).toHaveLength(4)
    })

    test('nothing reaches storage', async () => {
        const setItem = vi.spyOn(Storage.prototype, 'setItem')
        const { recordCaughtError } = await freshModule()
        recordCaughtError('chat.parse', new Error('stored?'))
        expect(setItem).not.toHaveBeenCalled()
        setItem.mockRestore()
    })
})
