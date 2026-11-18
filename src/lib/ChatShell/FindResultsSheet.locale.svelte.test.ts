// @vitest-environment jsdom
/**
 * The date of a search result follows the app language, live. REAL: `FindResultsSheet.svelte`, the language module (`changeLanguage`).
 * MOCKED: the sheet frame (renders its content while open) and the language table's strings.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { SearchHit } from '../../ts/chatShell/inChatSearch'
import type { Message } from '../../ts/storage/database.svelte'

vi.mock('./ShellSheet.svelte', () => ({ default: (anchor: Comment, props: { open: boolean, children: (anchor: Comment) => void }) => {
    if (props.open) props.children(anchor)
    return {}
} }))
vi.mock('../../lang', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../lang')>()
    return { ...actual, language: { chatShellFindSeeAll: 'See all', chatShellFindHidden: 'Hidden from the prompt', chatShellFindNoDate: 'no date' } }
})

import { changeLanguage } from '../../lang'
import FindResultsSheet from './FindResultsSheet.svelte'

const TIME = new Date(2026, 0, 15, 12).getTime()
const OPTIONS: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' }
const textFor = (tag: string | undefined): string => new Intl.DateTimeFormat(tag, OPTIONS).format(TIME)

/** Two app languages whose date text differs from the host's and from each other. */
function pickLanguages(): [string, string] {
    const host = textFor(undefined)
    const fit = ['en', 'ko', 'de', 'ja'].filter((tag) => textFor(tag) !== host)
    const first = fit[0]
    const second = fit.find((tag) => textFor(tag) !== textFor(first))
    if (!first || !second) throw new Error('no distinguishable locales on this host')
    return [first, second]
}

let app: ReturnType<typeof mount> | undefined
let target: HTMLElement | undefined
afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    changeLanguage('en')
    document.documentElement.removeAttribute('lang')
})

describe('FindResultsSheet result date', () => {
    test('shows the app language and follows a switch without a remount', () => {
        const [first, second] = pickLanguages()
        changeLanguage(first)
        const message = { role: 'char', data: 'a lantern here', saying: '', time: TIME } as Message
        const hits: SearchHit[] = [{ index: 0, message }]
        target = document.createElement('div')
        document.body.appendChild(target)
        app = mount(FindResultsSheet, {
            target,
            props: {
                open: true, opener: null, background: [], messages: [message], hits, query: 'lantern',
                complete: true, thinking: false, firstText: 'First lantern', userName: 'Me', charName: 'Seraphina',
                userImage: '', charImage: 'avatar.png', onpick: vi.fn(), onclose: vi.fn(),
            },
        })
        flushSync()
        const row = (): string => target!.querySelector<HTMLElement>('[role="listitem"]')!.textContent ?? ''
        expect(row()).toContain(textFor(first))
        changeLanguage(second)
        flushSync()
        expect(row()).toContain(textFor(second))
        expect(row()).not.toContain(textFor(first))
    })
})
