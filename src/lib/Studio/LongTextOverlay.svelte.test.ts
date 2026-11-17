// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Segment, SpanKind } from '../../ts/studio/longText/highlightSpans'
import { LT_TEXT_LAYOUT } from '../../ts/studio/longText/overlayMetrics'
import LongTextOverlay from './LongTextOverlay.svelte'

interface Props {
    area: HTMLTextAreaElement | undefined
    segments: readonly Segment[]
    phase: 'on' | 'off' | 'typing'
    scrollTop: number
    onmisalign?: () => void
}

let mounted: ReturnType<typeof mount>[] = []
let hosts: HTMLElement[] = []

afterEach(async () => {
    for (const app of mounted.splice(0)) await unmount(app)
    for (const host of hosts.splice(0)) host.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

// A real computed-style object: the area's box and font values as the engine would report them.
function computedOf(values: Record<string, string>): CSSStyleDeclaration {
    const style = document.createElement('div').style
    for (const [name, value] of Object.entries(values)) style.setProperty(name, value)
    return style
}

const BOX = { 'padding-top': '8px', 'padding-right': '8px', 'padding-bottom': '8px', 'padding-left': '8px', 'border-top-width': '0.761905px', 'border-right-width': '0.761905px', 'border-bottom-width': '0.761905px', 'border-left-width': '0.761905px' }

function widths(area: HTMLTextAreaElement, offsetWidth: number, clientWidth: number): void {
    Object.defineProperty(area, 'offsetWidth', { configurable: true, get: () => offsetWidth })
    Object.defineProperty(area, 'clientWidth', { configurable: true, get: () => clientWidth })
}

function mountOverlay(computed: () => CSSStyleDeclaration, segments: readonly Segment[] = []): { area: HTMLTextAreaElement, element: HTMLElement, props: Props } {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const area = document.createElement('textarea')
    host.appendChild(area)
    vi.spyOn(window, 'getComputedStyle').mockImplementation(computed)
    const props: Props = $state({ area, segments, phase: 'on', scrollTop: 0 })
    mounted.push(mount(LongTextOverlay, { target: host, props }))
    hosts.push(host)
    flushSync()
    return { area, element: host.querySelector('[data-part="studio-lt-overlay"]') as HTMLElement, props }
}

describe('the overlay box', () => {
    test('T1 it copies no font or spacing length: a zoomed font size is inherited, never written inline', () => {
        const { element } = mountOverlay(() => computedOf({ ...BOX, 'font-size': '17.6px', 'line-height': '26.4px', 'letter-spacing': '0.5px', 'word-spacing': '2px' }))
        const inline = element.getAttribute('style') ?? ''
        expect(inline).not.toMatch(/font-|line-height|letter-spacing|word-spacing/)
        expect(element.style.paddingTop).toBe('8px')
    })

    test('T2 a font-size change with no box resize leaves no stale px on the overlay', () => {
        let fontSize = '16px'
        const { element, props } = mountOverlay(() => computedOf({ ...BOX, 'font-size': fontSize }))
        fontSize = '17.6px'
        props.scrollTop = 1
        flushSync()
        expect(element.getAttribute('style') ?? '').not.toContain('font-size')
    })

    test('T3 with gutter support no right offset is derived from the rounded widths, and both carry the gutter class', () => {
        vi.stubGlobal('CSS', { supports: () => true })
        const host = document.createElement('div')
        document.body.appendChild(host)
        hosts.push(host)
        const area = document.createElement('textarea')
        host.appendChild(area)
        widths(area, 323, 317)
        vi.spyOn(window, 'getComputedStyle').mockImplementation(() => computedOf(BOX))
        mounted.push(mount(LongTextOverlay, { target: host, props: { area, segments: [], phase: 'on', scrollTop: 0 } }))
        flushSync()
        const element = host.querySelector('[data-part="studio-lt-overlay"]') as HTMLElement
        expect(element.style.right).toBe('')
        for (const token of LT_TEXT_LAYOUT.split(' ')) expect(element.classList.contains(token)).toBe(true)
        expect(element.classList.contains('inset-0')).toBe(true)
    })

    test('T3b without gutter support the right offset is the real scrollbar width (compatibility guard)', () => {
        vi.stubGlobal('CSS', { supports: () => false })
        const host = document.createElement('div')
        document.body.appendChild(host)
        hosts.push(host)
        const area = document.createElement('textarea')
        host.appendChild(area)
        widths(area, 323, 317)
        vi.spyOn(window, 'getComputedStyle').mockImplementation(() => computedOf(BOX))
        mounted.push(mount(LongTextOverlay, { target: host, props: { area, segments: [], phase: 'on', scrollTop: 0 } }))
        flushSync()
        const element = host.querySelector('[data-part="studio-lt-overlay"]') as HTMLElement
        expect(parseFloat(element.style.right)).toBeCloseTo(323 - 317 - 2 * 0.761905, 4)
    })

    test('T7b the fallback right offset follows a scrollbar that appears without a box resize, and keeps the box', () => {
        vi.stubGlobal('CSS', { supports: () => false })
        const noBorder = { ...BOX, 'border-top-width': '0px', 'border-right-width': '0px', 'border-bottom-width': '0px', 'border-left-width': '0px' }
        const host = document.createElement('div')
        document.body.appendChild(host)
        hosts.push(host)
        const area = document.createElement('textarea')
        host.appendChild(area)
        widths(area, 300, 300)
        vi.spyOn(window, 'getComputedStyle').mockImplementation(() => computedOf(noBorder))
        const props: Props = $state({ area, segments: [], phase: 'on', scrollTop: 0 })
        mounted.push(mount(LongTextOverlay, { target: host, props }))
        flushSync()
        const element = host.querySelector('[data-part="studio-lt-overlay"]') as HTMLElement
        expect(element.style.right).toBe('0px')
        widths(area, 300, 295)
        props.segments = [{ text: 'x', kind: null, severity: null }]
        flushSync()
        expect(element.style.right).toBe('5px')
        expect(element.style.paddingTop).toBe('8px')
    })
})

describe('the overlay misalignment check', () => {
    // The overlay only matches the textarea's height when its own box carries the textarea's current padding.
    function mountChecked(): { area: HTMLTextAreaElement, element: HTMLElement, props: Props, setPadding: (px: number) => void, observed: () => void, tripped: ReturnType<typeof vi.fn> } {
        let areaCallback: (() => void) | null = null
        vi.stubGlobal('ResizeObserver', class {
            constructor(callback: () => void) { areaCallback = callback }
            observe(): void {}
            disconnect(): void {}
        })
        vi.stubGlobal('CSS', { supports: () => true })
        const host = document.createElement('div')
        document.body.appendChild(host)
        hosts.push(host)
        const area = document.createElement('textarea')
        host.appendChild(area)
        let padding = 8
        Object.defineProperty(area, 'offsetParent', { configurable: true, get: () => host })
        Object.defineProperty(area, 'scrollHeight', { configurable: true, get: () => 1000 })
        vi.spyOn(window, 'getComputedStyle').mockImplementation((target: Element) => computedOf(target === area ? { ...BOX, 'padding-top': `${padding}px`, 'line-height': '24px' } : { 'line-height': '24px' }))
        const tripped = vi.fn()
        const props: Props = $state({ area, segments: [{ text: 'x', kind: null, severity: null }], phase: 'on', scrollTop: 0, onmisalign: tripped })
        mounted.push(mount(LongTextOverlay, { target: host, props }))
        const element = host.querySelector('[data-part="studio-lt-overlay"]') as HTMLElement
        Object.defineProperty(element, 'scrollHeight', { configurable: true, get: () => (element.style.paddingTop === `${padding}px` ? 1000 : 952) })
        flushSync()
        return { area, element, props, setPadding: (px) => { padding = px }, observed: () => areaCallback?.(), tripped }
    }

    test('T7 a box change seen only through the area observer is applied before the heights are read', () => {
        const { setPadding, observed, tripped } = mountChecked()
        expect(tripped).not.toHaveBeenCalled()
        setPadding(12)
        observed()
        expect(tripped).not.toHaveBeenCalled()
    })

    test('T7c heights a whole line apart report a mismatch, and only while the overlay is on', () => {
        const { element, props, tripped } = mountChecked()
        Object.defineProperty(element, 'scrollHeight', { configurable: true, get: () => 952 })
        props.phase = 'typing'
        props.segments = [{ text: 'y', kind: null, severity: null }]
        flushSync()
        expect(tripped).not.toHaveBeenCalled()
        props.phase = 'on'
        flushSync()
        expect(tripped).toHaveBeenCalled()
    })

    test('T7d a font metric that differs between the textarea and the overlay reports a mismatch', () => {
        const { area, props, tripped } = mountChecked()
        vi.spyOn(window, 'getComputedStyle').mockImplementation((target: Element) => computedOf({ 'line-height': '24px', 'font-size': target === area ? '16px' : '17.6px' }))
        props.segments = [{ text: 'z', kind: null, severity: null }]
        flushSync()
        expect(tripped).toHaveBeenCalled()
    })
})

describe('the overlay spans', () => {
    test('T4 no span class changes glyph advances, for every kind and severity', () => {
        const kinds: (SpanKind | null)[] = ['brace', 'name', 'sep', 'arg', 'block', 'comment', 'deprecated', null]
        const severities: (Segment['severity'])[] = ['error', 'warning', 'info', null]
        const segments: Segment[] = kinds.flatMap((kind) => severities.map((severity) => ({ text: 'x', kind, severity })))
        const { element } = mountOverlay(() => computedOf(BOX), segments)
        const spans = element.querySelectorAll('span:not([data-sentinel])')
        expect(spans).toHaveLength(kinds.length * severities.length)
        const glyphMoving = /^(font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)|italic|tracking-.*|leading-.*|text-(xs|sm|base|lg|[2-9]?xl))$/
        for (const span of spans) for (const token of span.classList) expect(token).not.toMatch(glyphMoving)
    })
})
