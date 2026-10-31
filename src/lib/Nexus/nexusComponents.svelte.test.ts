import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { BootNotice, BootProgress } from './boot/bootProgress'
import NexusBootScreen from './boot/NexusBootScreen.svelte'
import NexusStatusMark from './brand/NexusStatusMark.svelte'
import NexusNetworkBackground from './network/NexusNetworkBackground.svelte'

const mounted: { target: HTMLElement, app: Record<string, unknown> }[] = []

function mountInto<P extends Record<string, unknown>>(component: Parameters<typeof mount>[0], props: P): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(component, { target, props }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    return target
}

afterEach(async () => {
    for (const { target, app } of mounted.splice(0)) {
        await unmount(app as never)
        target.remove()
    }
    vi.restoreAllMocks()
})

describe('NexusStatusMark', () => {
    test('exposes the label to assistive technology and the status to the stylesheet', () => {
        const target = mountInto(NexusStatusMark as never, { status: 'error', label: 'Broken' })
        expect(target.querySelector('[role="status"] .sr-only')?.textContent).toBe('Broken')
        expect(target.querySelector('svg')?.getAttribute('data-status')).toBe('error')
        expect(target.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    })

    test('draws the ring from 40 px up and shows the percentage as text below it', () => {
        const large = mountInto(NexusStatusMark as never, { status: 'preparing', size: 48, progress: 0.5 })
        expect(large.querySelector('svg')?.hasAttribute('data-progress')).toBe(true)
        const small = mountInto(NexusStatusMark as never, { status: 'preparing', size: 24, progress: 0.5 })
        expect(small.querySelector('svg')?.hasAttribute('data-progress')).toBe(false)
        expect(small.textContent).toContain('50%')
    })

    test('the light tone uses the app text colour', () => {
        const target = mountInto(NexusStatusMark as never, { status: 'done', tone: 'light' })
        expect(target.querySelector('[role="status"]')?.classList.contains('text-textcolor')).toBe(true)
    })
})

describe('NexusNetworkBackground', () => {
    test('a canvas without a 2D context gives a no-op field and mounts without error', () => {
        const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
        const target = mountInto(NexusNetworkBackground as never, {})
        flushSync()
        expect(getContext).toHaveBeenCalledWith('2d')
        const canvas = target.querySelector('canvas')
        expect(canvas?.getAttribute('aria-hidden')).toBe('true')
        expect(canvas?.classList.contains('pointer-events-none')).toBe(true)
    })
})

describe('NexusBootScreen', () => {
    function progressProps(progress: BootProgress, notice?: BootNotice) {
        const props = $state<{ progress: BootProgress, notice?: BootNotice }>({ progress, notice })
        return props
    }

    test('the bar value does not fall when progress is reported lower', () => {
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
        const props = progressProps({ step: 'files', state: 'running' })
        const target = mountInto(NexusBootScreen as never, props)
        flushSync()
        const bar = target.querySelector('[role="progressbar"]')!
        const high = Number(bar.getAttribute('aria-valuenow'))
        expect(high).toBeGreaterThan(0)
        props.progress = { step: 'save', state: 'running' }
        flushSync()
        expect(Number(bar.getAttribute('aria-valuenow'))).toBe(high)
        props.progress = { step: 'plugins', state: 'running' }
        flushSync()
        expect(Number(bar.getAttribute('aria-valuenow'))).toBeGreaterThan(high)
    })

    test('an error notice renders in the danger token with no arbitrary colour, and its action takes focus', () => {
        const onDismiss = vi.fn()
        const props = progressProps({ step: 'save', state: 'running' }, { kind: 'error', message: 'Disk full', onDismiss })
        const target = mountInto(NexusBootScreen as never, props)
        flushSync()
        const message = [...target.querySelectorAll('p')].find((p) => p.textContent === 'Disk full')!
        expect(message.classList.contains('text-nexus-danger')).toBe(true)
        expect([...message.classList].some((c) => c.includes('#'))).toBe(false)
        expect(target.querySelector('[role="progressbar"]')?.getAttribute('data-state')).toBe('waiting')
        const button = target.querySelector('[role="alert"] button') as HTMLButtonElement
        expect(document.activeElement).toBe(button)
        button.click()
        expect(onDismiss).toHaveBeenCalledOnce()
    })
})
