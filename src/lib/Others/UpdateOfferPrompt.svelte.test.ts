// @vitest-environment jsdom

/**
 * The update offer dialog: the installed version, the offered version and the release notes render as text in their own
 * labelled places, never as markup; Install answers `install` and Not now answers `later`.
 */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import type { UpdateOffer } from 'src/ts/alert'
import UpdateOfferPrompt from './UpdateOfferPrompt.svelte'

const HOSTILE = '<script>window.__u = 1</script><img src=x onerror="window.__updateXss = true"><b>b</b>'

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function mountPrompt(offer: UpdateOffer, onanswer: (message: 'install' | 'later') => void = () => {}): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(UpdateOfferPrompt, { target, props: { offer, messageId: 'offer-message', onanswer } }))
    flushSync()
    return target
}

function button(target: HTMLElement, label: string): HTMLButtonElement {
    const found = [...target.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === label)
    expect(found, `the ${label} button`).toBeDefined()
    return found!
}

/** The `dd` that follows the `dt` carrying `label`. */
function valueOf(target: HTMLElement, label: string): string | undefined {
    const term = [...target.querySelectorAll('dt')].find(dt => dt.textContent === label)
    return term?.nextElementSibling?.textContent ?? undefined
}

afterEach(async () => {
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach(target => target.remove())
    document.body.replaceChildren()
    delete (window as unknown as Record<string, unknown>).__u
    delete (window as unknown as Record<string, unknown>).__updateXss
})

describe('UpdateOfferPrompt.svelte', () => {
    test('the installed and the new version each sit in their own labelled place, and the notes show', () => {
        const target = mountPrompt({ currentVersion: '0.1.0', version: '0.2.0', notes: 'Fixed a thing' })
        expect(valueOf(target, language.updateInstalledVersion)).toBe('0.1.0')
        expect(valueOf(target, language.updateNewVersion)).toBe('0.2.0')
        expect(target.querySelector('[data-update-notes]')?.textContent).toBe('Fixed a thing')
        expect(target.querySelector('dl')?.id).toBe('offer-message')
    })

    test('notes with nothing but whitespace show the no-notes line and no well', () => {
        const target = mountPrompt({ currentVersion: '0.1.0', version: '0.2.0', notes: '  \n ' })
        expect(target.querySelector('[data-update-notes]')).toBeNull()
        expect(target.querySelector('[data-update-notes-empty]')?.textContent).toBe(language.updateNoReleaseNotes)
    })

    test('the notes region is named by the release notes label', () => {
        const target = mountPrompt({ currentVersion: '0.1.0', version: '0.2.0', notes: 'n' })
        const region = target.querySelector('[role="region"]')
        expect(document.getElementById(region?.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(language.updateReleaseNotes)
    })

    test('hostile notes render as inert text', () => {
        const target = mountPrompt({ currentVersion: '0.1.0', version: '0.2.0', notes: HOSTILE })
        const notes = target.querySelector('[data-update-notes]')!
        expect(notes.querySelector('img, script, b')).toBeNull()
        expect(target.querySelector('img, script, b')).toBeNull()
        expect(notes.textContent).toBe(HOSTILE)
        expect((window as unknown as Record<string, unknown>).__updateXss).toBeUndefined()
        expect((window as unknown as Record<string, unknown>).__u).toBeUndefined()
    })

    test('hostile versions render as inert text', () => {
        const target = mountPrompt({ currentVersion: '<i>0.1.0</i>', version: '<img src=x onerror="window.__updateXss = true">', notes: 'n' })
        expect(target.querySelector('img, i')).toBeNull()
        expect(valueOf(target, language.updateNewVersion)).toContain('<img')
        expect(valueOf(target, language.updateInstalledVersion)).toBe('<i>0.1.0</i>')
        expect((window as unknown as Record<string, unknown>).__updateXss).toBeUndefined()
    })

    test('Install answers install and Not now answers later, once each', () => {
        const onanswer = vi.fn()
        const target = mountPrompt({ currentVersion: '0.1.0', version: '0.2.0', notes: 'n' }, onanswer)
        button(target, language.updateNotNow).click()
        expect(onanswer).toHaveBeenCalledTimes(1)
        expect(onanswer).toHaveBeenLastCalledWith('later')
        button(target, language.updateInstall).click()
        expect(onanswer).toHaveBeenCalledTimes(2)
        expect(onanswer).toHaveBeenLastCalledWith('install')
    })
})
