// @vitest-environment jsdom

/**
 * #892: a key that is not a connection slot (the per-character OpenAI TTS key) uses the same masked field: a last-four
 * chip, Replace key and Remove key, never the saved key in a field. Regression reproducer: before the fix the character
 * panel bound a text field to the stored key. Synthetic keys only. The write callback stands in for the character field.
 */
import 'src/ts/polyfill'
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { maskKeyHint } from '../../../ts/connections/connectionHint'

vi.mock('../../../ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('../../Nexus/pattern/patternWarning', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../Nexus/pattern/patternWarning')>()),
    armDelayMs: () => 0,
}))

import MaskedKeyField from './MaskedKeyField.svelte'

const KEY = 'sk-SYNTH-character-tts-7777'
const mounted: Array<ReturnType<typeof mount>> = []
let saved = ''

async function settle(): Promise<void> {
    for (let round = 0; round < 4; round++) {
        flushSync()
        await tick()
        await Promise.resolve()
    }
}

function everything(): string {
    const values = Array.from(document.querySelectorAll<HTMLInputElement>('input, textarea')).map((el) => el.value)
    const attrs = Array.from(document.querySelectorAll('*')).flatMap((el) => Array.from(el.attributes).map((attr) => attr.value))
    return [document.body.innerHTML, ...values, ...attrs].join(' ')
}

function mountField(initial: string): void {
    saved = initial
    document.body.innerHTML = '<span id="lbl">Key</span>'
    const props = {
        labelId: 'lbl',
        fieldName: 'characterTtsApiKey',
        get hint() { return maskKeyHint(saved, 'openai') },
        write: async (plain: string) => { saved = plain },
    }
    mounted.push(mount(MaskedKeyField, { target: document.body, props }))
}

function part(name: string): HTMLButtonElement | null {
    return document.querySelector<HTMLButtonElement>(`[data-slot-key="${name}"]`)
}

afterEach(() => {
    while (mounted.length > 0) void unmount(mounted.pop()!)
    document.body.innerHTML = ''
})

describe('MaskedKeyField', () => {
    test('shows a last-four chip and no field holds the saved key', async () => {
        mountField(KEY)
        await settle()
        expect(document.querySelector('[data-slot-key="chip"]')?.textContent).toContain('7777')
        expect(document.querySelector('input')).toBeNull()
        expect(everything()).not.toContain(KEY)
        expect(everything()).not.toContain('character-tts')
    })

    test('a blank key opens the masked field directly', async () => {
        mountField('')
        await settle()
        expect(document.querySelector<HTMLInputElement>('input')?.type).toBe('password')
    })

    test('Replace key then Save stores the typed key and closes the field', async () => {
        mountField(KEY)
        await settle()
        part('replace')!.click()
        await settle()
        const input = document.querySelector<HTMLInputElement>('input')!
        expect(input.value).toBe('')
        input.value = 'sk-SYNTH-new-key-0001'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        part('save')!.click()
        await settle()
        expect(saved).toBe('sk-SYNTH-new-key-0001')
        expect(document.querySelector('input')).toBeNull()
    })

    test('Remove key asks first, then writes an empty key', async () => {
        mountField(KEY)
        await settle()
        part('remove')!.click()
        await settle()
        expect(saved).toBe(KEY)
        Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Remove key' && b !== part('remove'))!.click()
        await settle()
        expect(saved).toBe('')
    })
})
