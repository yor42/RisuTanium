// @vitest-environment jsdom

/**
 * `BarIcon.svelte`: the optional `label` names the button in all three `{#await}` branches
 * (pending, resolved, rejected). Without a label the button renders as before, with no
 * `aria-label` attribute, for callers such as the alert dialog that pass none.
 */
import { createRawSnippet, flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { controlName, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import BarIcon from './BarIcon.svelte'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const iconOnly = createRawSnippet(() => ({ render: () => '<span></span>' }))

let mounted: { app: Record<string, unknown>, target: HTMLElement }[] = []

function mountBar(props: { label?: string, additionalStyle?: string | Promise<string> }): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(BarIcon, { target, props: { ...props, children: iconOnly } }) as unknown as Record<string, unknown>
    mounted.push({ app, target })
    flushSync()
    return target
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
    vi.restoreAllMocks()
})

describe('BarIcon label', () => {
    test('regression reproducer: the resolved branch button takes the label', () => {
        const target = mountBar({ label: 'L', additionalStyle: 'background: red' })
        expect(controlName(target.querySelector('button')!)).toBe('L')
    })

    test('regression reproducer: the pending branch button takes the label', () => {
        const target = mountBar({ label: 'L', additionalStyle: new Promise<string>(() => {}) })
        expect(controlName(target.querySelector('button')!)).toBe('L')
    })

    test('regression reproducer: the rejected branch button takes the label', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const target = mountBar({ label: 'L', additionalStyle: Promise.reject(new Error('style failed')) })
        await sleep(20)
        flushSync()
        expect(unnamedControls(target)).toEqual([])
        expect(controlName(target.querySelector('button')!)).toBe('L')
    })

    test('guard: without a label no aria-label attribute is rendered in any branch (passes before and after)', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const resolved = mountBar({ additionalStyle: 'background: red' })
        const pending = mountBar({ additionalStyle: new Promise<string>(() => {}) })
        const rejected = mountBar({ additionalStyle: Promise.reject(new Error('style failed')) })
        await sleep(20)
        flushSync()
        for (const target of [resolved, pending, rejected]) {
            expect(target.querySelector('button')!.hasAttribute('aria-label')).toBe(false)
        }
    })
})
