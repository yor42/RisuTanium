// @vitest-environment happy-dom

/**
 * `getEmotion` puts a style marker ('normal' or 'emp') in front of the image
 * URLs. The marker is never an image: with no image to show, nothing renders.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'
import TransitionImage from './TransitionImage.svelte'

const targets: HTMLElement[] = []
const instances: Record<string, unknown>[] = []

async function render(src: string[]): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    targets.push(target)
    instances.push(mount(TransitionImage, { target, props: { src, classType: 'waifu' } }))
    await Promise.resolve()
    flushSync()
    return target
}

const sources = (root: HTMLElement) => Array.from(root.querySelectorAll('img')).map((img) => img.getAttribute('src'))

afterEach(() => {
    for (const instance of instances.splice(0)) {
        unmount(instance)
    }
    for (const target of targets.splice(0)) {
        target.remove()
    }
})

describe('TransitionImage style marker', () => {
    test('reproducer: a lone normal marker renders no image', async () => {
        const root = await render(['normal'])
        expect(sources(root)).toEqual([])
    })

    test('reproducer: a lone emp marker renders no image', async () => {
        const root = await render(['emp'])
        expect(sources(root)).toEqual([])
    })

    test('guard: the marker is split off a list of images, which render in order', async () => {
        const root = await render(['normal', 'a.png', 'b.png'])
        expect(sources(root)).toEqual(['a.png', 'b.png'])
    })

    test('guard: a later non-empty list renders images again after a lone marker', async () => {
        const target = document.createElement('div')
        document.body.appendChild(target)
        targets.push(target)
        const props = $state({ src: ['normal', 'a.png'] as string[] | Promise<string[]>, classType: 'waifu' as const })
        instances.push(mount(TransitionImage, { target, props }))
        await Promise.resolve()
        flushSync()
        expect(sources(target)).toEqual(['a.png'])

        props.src = Promise.resolve(['emp'])
        flushSync()
        await Promise.resolve()
        await Promise.resolve()
        flushSync()
        expect(sources(target)).toEqual([])

        props.src = Promise.resolve(['normal', 'b.png'])
        flushSync()
        await Promise.resolve()
        await Promise.resolve()
        flushSync()
        expect(sources(target)).toEqual(['b.png'])
        expect(target.querySelectorAll('img.old-image').length).toBe(0)
    })

    test('guard: the emp marker keeps its stacked layout', async () => {
        const root = await render(['emp', 'a.png', 'b.png'])
        expect(sources(root)).toEqual(['a.png', 'b.png'])
        expect(root.querySelectorAll('img')[0].style.width).toBe('80%')
    })
})
