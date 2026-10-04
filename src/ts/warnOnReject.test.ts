import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compile } from 'svelte/compiler'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { warnOnReject } from './warnOnReject'

let warn: ReturnType<typeof vi.spyOn>
const unhandled: unknown[] = []
const onUnhandled = (reason: unknown) => { unhandled.push(reason) }

beforeEach(() => {
    unhandled.length = 0
    process.on('unhandledRejection', onUnhandled)
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
    process.off('unhandledRejection', onUnhandled)
    warn.mockRestore()
})

async function flush() {
    await new Promise((r) => setTimeout(r, 10))
}

describe('warnOnReject', () => {
    test('a rejection warns once with the label and reason, and the wrapper rejects with the same reason', async () => {
        const reason = new Error('boom')
        const wrapped = warnOnReject('label', Promise.reject(reason))
        await expect(wrapped).rejects.toBe(reason)
        expect(warn).toHaveBeenCalledTimes(1)
        expect(warn).toHaveBeenCalledWith('label', reason)
        await flush()
        expect(unhandled).toEqual([])
    })

    test('a resolving promise resolves to the same value without warning', async () => {
        await expect(warnOnReject('label', Promise.resolve('ok'))).resolves.toBe('ok')
        expect(warn).not.toHaveBeenCalled()
    })

    test('the same input promise yields the same wrapper and warns once however often it is wrapped and awaited', async () => {
        const input = Promise.reject(new Error('boom'))
        const a = warnOnReject('label', input)
        const b = warnOnReject('label', input)
        expect(b).toBe(a)
        await a.catch(() => {})
        await b.catch(() => {})
        expect(warn).toHaveBeenCalledTimes(1)
        await flush()
        expect(unhandled).toEqual([])
    })

    test('a value that is not a promise is returned unchanged', () => {
        expect(warnOnReject('label', 'plain')).toBe('plain')
        expect(warnOnReject('label', '')).toBe('')
        expect(warn).not.toHaveBeenCalled()
    })
})

// The warning is an ordinary call in each `{#await}` expression. Compiling the
// components with `dev: false` must keep that call and must not reintroduce a
// side effect inside a `{@const}` tag, which production builds never evaluate.
describe('production compile of the media components', () => {
    const components = [
        'src/lib/SideBars/SidebarAvatar.svelte',
        'src/lib/SideBars/BarIcon.svelte',
        'src/lib/SideBars/CharConfig.svelte',
        'src/lib/Setting/Pages/PersonaSettings.svelte',
        'src/lib/Setting/Pages/OtherBotSettings.svelte',
        'src/lib/ChatScreens/EmotionBox.svelte',
        'src/lib/ChatScreens/DefaultChatScreen.svelte',
        'src/lib/Playground/PlaygroundInlayExplorer.svelte',
    ]

    test.each(components)('%s evaluates warnOnReject in its await expressions and has no console.warn const tag', (path) => {
        const source = readFileSync(resolve(process.cwd(), path), 'utf8')
        expect(source).not.toMatch(/\{@const[^}]*console\.warn/)
        const { js } = compile(source, { filename: path, generate: 'client', dev: false })
        expect(js.code).toContain('warnOnReject(')
        expect(js.code).not.toContain('console.warn')
    })
})
