// @vitest-environment jsdom

/**
 * The parked-reply dialog: the reply renders as text, Copy and Save as .txt leave it open, Discard answers `discard`
 * with no confirm step, Later answers `later`.
 */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

const copyPlainText = vi.hoisted(() => vi.fn())
const downloadFile = vi.hoisted(() => vi.fn(async () => true))

vi.mock('src/ts/chatCopy', () => ({ copyPlainText }))
vi.mock('src/ts/downloadFile', () => ({ downloadFile }))

import { language } from 'src/lang'
import ParkedReplyPrompt from './ParkedReplyPrompt.svelte'

const HOSTILE = '<img src=x onerror="window.__parkedReplyXss = true"><b>bold</b>'

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function mountPrompt(onanswer: (message: 'discard' | 'later') => void, name = 'Ann', text = HOSTILE): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(ParkedReplyPrompt, { target, props: { name, text, title: language.parkedReplyTitle, onanswer } }))
    flushSync()
    return target
}

function button(target: HTMLElement, label: string): HTMLButtonElement {
    const found = [...target.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === label)
    expect(found, `the ${label} button`).toBeDefined()
    return found!
}

afterEach(async () => {
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach(target => target.remove())
    document.body.replaceChildren()
    vi.clearAllMocks()
})

describe('ParkedReplyPrompt.svelte', () => {
    test('the reply and the name render as text, never as markup', () => {
        const target = mountPrompt(() => {}, '<i>Ann</i>')
        expect(target.querySelector('img')).toBeNull()
        expect(target.querySelector('b')).toBeNull()
        expect(target.querySelector('i')).toBeNull()
        expect(target.querySelector('[data-parked-reply-text]')?.textContent).toBe(HOSTILE)
        expect(target.textContent).toContain('<i>Ann</i>')
    })

    test('Copy copies the reply, reports the outcome inside the dialog and stays open', () => {
        const onanswer = vi.fn()
        copyPlainText.mockImplementationOnce((_text: string, report: (outcome: { ok: true }) => void) => report({ ok: true }))
        const target = mountPrompt(onanswer)
        button(target, language.copy).click()
        flushSync()
        expect(copyPlainText).toHaveBeenCalledWith(HOSTILE, expect.any(Function))
        expect(target.querySelector('[data-parked-reply-status]')?.textContent).toBe(language.copied)
        expect(onanswer).not.toHaveBeenCalled()
    })

    test('a failed copy shows the failure text and the dialog stays open', () => {
        const onanswer = vi.fn()
        copyPlainText.mockImplementationOnce((_text: string, report: (outcome: { ok: false, errorName: string }) => void) => report({ ok: false, errorName: 'NotAllowedError' }))
        const target = mountPrompt(onanswer)
        button(target, language.copy).click()
        flushSync()
        expect(target.querySelector('[data-parked-reply-status]')?.textContent).toBe(`NotAllowedError: ${language.copyFailed}`)
        expect(onanswer).not.toHaveBeenCalled()
    })

    test('Save as .txt downloads the reply under a path-safe name and the dialog stays open, a cancelled picker included', async () => {
        const onanswer = vi.fn()
        downloadFile.mockResolvedValueOnce(false)
        const target = mountPrompt(onanswer, 'A/n:n')
        button(target, language.parkedReplySaveTxt).click()
        await Promise.resolve()
        flushSync()
        expect(downloadFile).toHaveBeenCalledWith('A_n_n-reply.txt', HOSTILE)
        expect(onanswer).not.toHaveBeenCalled()
    })

    test('a failed Save as .txt shows the error name with the Save as .txt label inside the dialog, which stays open', async () => {
        const onanswer = vi.fn()
        downloadFile.mockRejectedValueOnce(Object.assign(new Error('disk full'), { name: 'QuotaExceededError' }))
        const target = mountPrompt(onanswer)
        button(target, language.parkedReplySaveTxt).click()
        await Promise.resolve()
        await Promise.resolve()
        flushSync()
        expect(target.querySelector('[data-parked-reply-status]')?.textContent).toBe(`QuotaExceededError: ${language.parkedReplySaveTxt}`)
        expect(onanswer).not.toHaveBeenCalled()
    })

    test('Discard answers discard at once, with no confirm step', () => {
        const onanswer = vi.fn()
        const target = mountPrompt(onanswer)
        button(target, language.parkedReplyDiscard).click()
        expect(onanswer).toHaveBeenCalledTimes(1)
        expect(onanswer).toHaveBeenCalledWith('discard')
    })

    test('Later answers later and never discard', () => {
        const onanswer = vi.fn()
        const target = mountPrompt(onanswer)
        button(target, language.parkedReplyLater).click()
        expect(onanswer).toHaveBeenCalledTimes(1)
        expect(onanswer).toHaveBeenCalledWith('later')
    })
})
