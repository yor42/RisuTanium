// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte'
import { describe, expect, test, vi } from 'vitest'

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
