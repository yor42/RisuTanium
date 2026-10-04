// @vitest-environment happy-dom

/**
 * What `SidebarAvatar.svelte` and `BarIcon.svelte` show when an image or style
 * promise they were given rejects.
 *
 * Invariants pinned here:
 *  - a rejection raises no unhandled rejection and is logged with `console.warn`;
 *  - the control stays rendered: `SidebarAvatar` `src` shows the same placeholder
 *    as its pending state, `backgroundimg` shows what a falsy image shows (with
 *    the children), `BarIcon` shows its button without the extra style;
 *  - a later promise that resolves replaces the fallback.
 *
 * Every test is a regression reproducer: without a rejection branch on the
 * `{#await}` blocks, Svelte rethrows the rejection as an unhandled rejection and
 * the block disappears.
 */

import { createRawSnippet, flushSync, mount, tick, unmount, type ComponentProps } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import SidebarAvatar from './SidebarAvatar.svelte'
import BarIcon from './BarIcon.svelte'

function deferred() {
    let resolve!: (v: string) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<string>((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

// Lets queued microtasks run, then lets a timer-driven unhandled-rejection
// report arrive and flushes the resulting DOM update.
async function settle() {
    for (let i = 0; i < 6; i++) await Promise.resolve()
    await tick()
    await new Promise((resolve) => setTimeout(resolve, 20))
    flushSync()
}

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function mountInto<C extends typeof SidebarAvatar | typeof BarIcon>(component: C, props: ComponentProps<C>) {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(component as never, { target, props: props as never }))
    flushSync()
    return target
}

const kids = createRawSnippet(() => ({ render: () => '<i class="kid"></i>' }))

const unhandled: unknown[] = []
const onUnhandled = (reason: unknown) => {
    unhandled.push(reason)
}
let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
    unhandled.length = 0
    process.on('unhandledRejection', onUnhandled)
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(async () => {
    process.off('unhandledRejection', onUnhandled)
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    warn.mockRestore()
})

describe('SidebarAvatar src', () => {
    const baseProps = { rounded: true, name: 'n', size: '40' }

    test('regression reproducer: a src that is already rejected at mount keeps the placeholder, warns, and raises no unhandled rejection', async () => {
        const d = deferred()
        const pendingTarget = mountInto(SidebarAvatar, { ...baseProps, src: d.promise })
        const pendingHtml = pendingTarget.querySelector('.sidebar-avatar')!.outerHTML
        expect(pendingTarget.querySelector('img')).toBeNull()

        const target = mountInto(SidebarAvatar, { ...baseProps, src: Promise.reject(new Error('boom')) })
        await settle()

        expect(unhandled).toEqual([])
        expect(warn).toHaveBeenCalled()
        expect(target.querySelectorAll('.sidebar-avatar')).toHaveLength(1)
        expect(target.querySelector('img')).toBeNull()
        expect(target.querySelector('.sidebar-avatar')!.outerHTML).toBe(pendingHtml)
    })

    test('regression reproducer: a src that rejects after mount keeps the placeholder', async () => {
        const d = deferred()
        const target = mountInto(SidebarAvatar, { ...baseProps, src: d.promise })
        await settle()
        const pendingHtml = target.querySelector('.sidebar-avatar')!.outerHTML

        d.reject(new Error('late'))
        await settle()

        expect(unhandled).toEqual([])
        expect(warn).toHaveBeenCalled()
        expect(target.querySelectorAll('.sidebar-avatar')).toHaveLength(1)
        expect(target.querySelector('.sidebar-avatar')!.outerHTML).toBe(pendingHtml)
    })

    test('regression reproducer: after a rejection, a new src that resolves replaces the placeholder with its image', async () => {
        const props = $state({ src: Promise.reject(new Error('boom')) as Promise<string> })
        const target = mountInto(SidebarAvatar, {
            ...baseProps,
            get src() {
                return props.src
            },
        })
        await settle()
        expect(target.querySelectorAll('.sidebar-avatar')).toHaveLength(1)

        const next = deferred()
        props.src = next.promise
        flushSync()
        next.resolve('data:image/png;base64,AAAA')
        await settle()

        expect(unhandled).toEqual([])
        expect(target.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA')
    })
})

describe('SidebarAvatar backgroundimg', () => {
    const baseProps = { rounded: true, name: 'n', size: '40', src: 'slot' }

    test('regression reproducer: a rejected backgroundimg shows the children and no background image, warns, and raises no unhandled rejection', async () => {
        const target = mountInto(SidebarAvatar, {
            ...baseProps,
            backgroundimg: Promise.reject(new Error('boom')),
            children: kids,
        })
        await settle()

        expect(unhandled).toEqual([])
        expect(warn).toHaveBeenCalled()
        expect(target.querySelectorAll('.sidebar-avatar')).toHaveLength(1)
        expect(target.querySelector('.sidebar-avatar .kid')).not.toBeNull()
        expect(target.querySelector('.sidebar-avatar')!.getAttribute('style')).not.toContain('background-image')
    })

    test('regression reproducer: a backgroundimg that rejects later keeps one block with the children', async () => {
        const d = deferred()
        const target = mountInto(SidebarAvatar, { ...baseProps, backgroundimg: d.promise, children: kids })
        await settle()
        d.reject(new Error('late'))
        await settle()

        expect(unhandled).toEqual([])
        expect(target.querySelectorAll('.sidebar-avatar')).toHaveLength(1)
        expect(target.querySelector('.sidebar-avatar .kid')).not.toBeNull()
    })

    test('regression reproducer: after a rejection, a new backgroundimg that resolves replaces the fallback', async () => {
        const props = $state({ bg: Promise.reject(new Error('boom')) as Promise<string> })
        const target = mountInto(SidebarAvatar, {
            ...baseProps,
            children: kids,
            get backgroundimg() {
                return props.bg
            },
        })
        await settle()

        const next = deferred()
        props.bg = next.promise
        flushSync()
        next.resolve('data:image/png;base64,BBBB')
        await settle()

        expect(unhandled).toEqual([])
        expect(target.querySelector('.sidebar-avatar')!.getAttribute('style')).toContain('background-image')
        expect(target.querySelector('.sidebar-avatar .kid')).toBeNull()
    })
})

describe('BarIcon additionalStyle', () => {
    test('regression reproducer: a rejected additionalStyle keeps one usable button without extra style, warns, and raises no unhandled rejection', async () => {
        const onClick = vi.fn()
        const target = mountInto(BarIcon, { additionalStyle: Promise.reject(new Error('boom')), onClick, children: kids })
        await settle()

        expect(unhandled).toEqual([])
        expect(warn).toHaveBeenCalled()
        const buttons = target.querySelectorAll('button')
        expect(buttons).toHaveLength(1)
        expect(buttons[0].getAttribute('style')).toBeNull()
        expect(buttons[0].querySelector('.kid')).not.toBeNull()
        buttons[0].click()
        expect(onClick).toHaveBeenCalledTimes(1)
    })

    test('regression reproducer: an additionalStyle that rejects later keeps one button', async () => {
        const d = deferred()
        const target = mountInto(BarIcon, { additionalStyle: d.promise, children: kids })
        await settle()
        d.reject(new Error('late'))
        await settle()

        expect(unhandled).toEqual([])
        expect(target.querySelectorAll('button')).toHaveLength(1)
    })

    test('regression reproducer: after a rejection, a new additionalStyle that resolves applies its style', async () => {
        const props = $state({ s: Promise.reject(new Error('boom')) as Promise<string> })
        const target = mountInto(BarIcon, {
            children: kids,
            get additionalStyle() {
                return props.s
            },
        })
        await settle()

        const next = deferred()
        props.s = next.promise
        flushSync()
        next.resolve('color: blue;')
        await settle()

        expect(unhandled).toEqual([])
        expect(target.querySelector('button')!.getAttribute('style')).toContain('color: blue;')
    })
})
