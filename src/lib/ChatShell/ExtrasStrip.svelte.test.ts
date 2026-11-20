// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { glyphsIn, iconsIn, lucideNames } from './tests/glyphFree'

vi.mock('../../lang', () => ({ language: { chatShellRemoveAttachment: 'Remove attachment' } }))
vi.mock('../ChatScreens/AssetInput.svelte', () => ({ default: () => ({}) }))

describe('ExtrasStrip', () => {
    test('shows draft attachment chips and routes removal by index', async () => {
        const { default: ExtrasStrip } = await import('./ExtrasStrip.svelte')
        const target = document.createElement('div')
        const onremove = vi.fn()
        const app = mount(ExtrasStrip, { target, props: {
            files: ['a.png', 'b.mp3'], currentCharacter: null, stickersOpen: false,
            onremove, onselect: vi.fn(),
        } })
        flushSync()
        expect(target.querySelectorAll('[data-part="chat-attachment-chip"]')).toHaveLength(2)
        target.querySelectorAll<HTMLButtonElement>('[data-part="chat-attachment-chip"] button')[1].click()
        expect(onremove).toHaveBeenCalledWith(1)
        await unmount(app)
    })

    // TC2-8 (regression reproducer): the remove control is a hidden Lucide X; its accessible name is unchanged.
    test('the remove control is an aria-hidden X icon, not a text glyph, and keeps its name', async () => {
        await import('@lucide/svelte')
        const { default: ExtrasStrip } = await import('./ExtrasStrip.svelte')
        const target = document.createElement('div')
        document.body.appendChild(target)
        const app = mount(ExtrasStrip, { target, props: { files: ['a.png'], currentCharacter: null, stickersOpen: false, onremove: vi.fn(), onselect: vi.fn() } })
        flushSync()
        const button = target.querySelector<HTMLButtonElement>('[data-part="chat-attachment-chip"] button')!
        expect(button.getAttribute('aria-label')).toBe('Remove attachment: a.png')
        expect(glyphsIn(button)).toEqual([])
        expect(lucideNames(button)).toEqual(['lucide-x'])
        expect(iconsIn(button)[0].getAttribute('aria-hidden')).toBe('true')
        await unmount(app)
        target.remove()
    }, 120_000)

    test('does not reserve an empty strip', async () => {
        const { default: ExtrasStrip } = await import('./ExtrasStrip.svelte')
        const target = document.createElement('div')
        const app = mount(ExtrasStrip, { target, props: {
            files: [], currentCharacter: null, stickersOpen: false,
            onremove: vi.fn(), onselect: vi.fn(),
        } })
        flushSync()
        expect(target.querySelector('[data-part="chat-extras-strip"]')).toBeNull()
        await unmount(app)
    })

    test('shows an escaped translated input preview', async () => {
        const { default: ExtrasStrip } = await import('./ExtrasStrip.svelte')
        const target = document.createElement('div')
        const app = mount(ExtrasStrip, { target, props: {
            files: [], currentCharacter: null, stickersOpen: false, translatePreview: '<img src=x>',
            onremove: vi.fn(), onselect: vi.fn(),
        } })
        flushSync()
        expect(target.querySelector('[data-part="chat-translate-preview"]')?.textContent).toBe('<img src=x>')
        expect(target.querySelector('[data-part="chat-translate-preview"] img')).toBeNull()
        await unmount(app)
    })
})
