// @vitest-environment jsdom
import { createRawSnippet, flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'
import PatternDialog from './PatternDialog.svelte'

const mounted: { target: HTMLElement, app: Record<string, unknown> }[] = []

function show(extra: { role?: 'dialog' | 'alertdialog' } = {}): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const children = createRawSnippet(() => ({ render: () => '<h2 id="t">T</h2>' }))
    const app = mount(PatternDialog, { target, props: { labelId: 't', children, ...extra } })
    mounted.push({ target, app })
    flushSync()
    return target.querySelector<HTMLElement>('[data-part="pattern-dialog"]')!
}

afterEach(async () => {
    for (const { target, app } of mounted.splice(0)) {
        await unmount(app)
        target.remove()
    }
})

describe('PatternDialog role', () => {
    // R3-15 first part: the prop is ignored before the change
    test('role dialog renders a dialog', () => {
        expect(show({ role: 'dialog' }).getAttribute('role')).toBe('dialog')
    })

    // R3-15 default (compatibility guard)
    test('the default role stays alertdialog', () => {
        expect(show().getAttribute('role')).toBe('alertdialog')
    })
})
