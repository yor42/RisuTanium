// @vitest-environment jsdom

/**
 * `RealmHubIcon.svelte`: the three capability `role="button"` divs are named, their glyphs are
 * hidden, they activate on Enter and Space only when the event target is the div itself, and the
 * hovers and tags use scheme tokens. Mounts the REAL component; the stores, the hub constants and
 * the alert are replaced.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { hubType } from 'src/ts/characterCards'

const alertNormalSpy = vi.hoisted(() => vi.fn())

vi.mock(import('src/ts/alert'), () => ({
    alertNormal: alertNormalSpy,
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/characterCards'), () => ({
    hubURL: 'https://hub.test',
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: { hideAllImages: false, language: 'en' } as unknown as Record<string, unknown> })
    const selId = $state({ selId: 0 })
    return { DBState: state, selIdState: selId } as unknown as typeof import('src/ts/stores.svelte')
})

import { language } from 'src/lang'
import { controlName, exposedIcons, paletteClasses, textColourTokens } from 'src/lib/a11yNames.test-helpers'
import RealmHubIcon from './RealmHubIcon.svelte'

function makeChara(): hubType {
    return {
        name: 'chara', desc: '', download: '', id: 'chara-id', img: '', tags: ['a', 'b', 'c', 'd', 'e', 'f'],
        viewScreen: 'none', hasLore: true, hasEmotion: true, hasAsset: true, hot: 0, license: '', type: 'character',
    } as hubType
}

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []
const onClick = vi.fn()

function mountIcon(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(RealmHubIcon, { target, props: { chara: makeChara(), onClick } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

beforeEach(() => {
    alertNormalSpy.mockReset()
    onClick.mockReset()
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

const pills = (target: HTMLElement) => Array.from(target.querySelectorAll('div[role="button"]')) as HTMLElement[]

function press(el: Element, key: string, dispatchOn: Element = el): void {
    dispatchOn.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    flushSync()
}

describe('RealmHubIcon capability pills', () => {
    test('regression reproducer: the three role=button divs are named by what they report', () => {
        const target = mountIcon()
        expect(pills(target).map(controlName)).toEqual([
            language.alerts.characterHasEmotion,
            language.alerts.characterHasAssets,
            language.alerts.characterHasLore,
        ])
    })

    test('regression reproducer: the glyphs are hidden', () => {
        expect(exposedIcons(mountIcon())).toEqual([])
    })

    test.each(['Enter', ' '])('regression reproducer: %j on a pill activates it once and does not open the card', (key) => {
        const target = mountIcon()
        press(pills(target)[0], key)
        expect(alertNormalSpy).toHaveBeenCalledTimes(1)
        expect(alertNormalSpy).toHaveBeenCalledWith(language.alerts.characterHasEmotion)
        expect(onClick).not.toHaveBeenCalled()
    })

    test('regression reproducer: a key pressed on a nested element does not activate the pill', () => {
        const target = mountIcon()
        const pill = pills(target)[0]
        press(pill, 'Enter', pill.querySelector('svg') as Element)
        expect(alertNormalSpy).not.toHaveBeenCalled()
    })

    test('regression reproducer: other keys do nothing', () => {
        const target = mountIcon()
        press(pills(target)[0], 'a')
        expect(alertNormalSpy).not.toHaveBeenCalled()
    })

    test('regression reproducer: no default-palette class is left and each pill hovers to a different token', () => {
        const target = mountIcon()
        expect(paletteClasses(target)).toEqual([])
        for (const pill of pills(target)) {
            const { rest, hover } = textColourTokens(pill.querySelector('svg')!.parentElement!)
            expect(rest).toBe('textcolor2')
            expect(hover).toBe('textcolor')
        }
    })
})
