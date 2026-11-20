// @vitest-environment jsdom

/**
 * `RealmHubIcon.svelte`: the tile is one named button, its capability marks are text badges, its glyphs
 * are hidden and no default-palette class is left. Mounts the REAL component; the stores, the hub constants and
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
import { controlName, exposedIcons, paletteClasses } from 'src/lib/a11yNames.test-helpers'
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

// The tile is one native button: the capability marks are plain text badges inside it, so there is
// no nested interactive element to name or to activate by key, and a click anywhere opens the card.
describe('RealmHubIcon tile and capability badges', () => {
    test('the tile is a single button and contains no nested interactive element', () => {
        const target = mountIcon()
        const buttons = target.querySelectorAll('button')
        expect(buttons.length).toBe(1)
        expect(target.querySelectorAll('[role="button"], [tabindex="0"]').length).toBe(0)
        expect(controlName(buttons[0])).not.toBe('')
    })

    test('the capability badges are visible text, not alerts', () => {
        const target = mountIcon()
        const text = target.querySelector('button')!.textContent ?? ''
        for (const badge of [language.realmBadgeEmotion, language.realmBadgeAssets, language.realmBadgeLore]) {
            expect(text).toContain(badge)
        }
        ;(target.querySelector('button') as HTMLButtonElement).click()
        flushSync()
        expect(onClick).toHaveBeenCalledTimes(1)
        expect(alertNormalSpy).not.toHaveBeenCalled()
    })

    test('the glyphs are hidden', () => {
        expect(exposedIcons(mountIcon())).toEqual([])
    })

    test('no default-palette class is left', () => {
        expect(paletteClasses(mountIcon())).toEqual([])
    })
})
