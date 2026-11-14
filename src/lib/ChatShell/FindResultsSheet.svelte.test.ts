// @vitest-environment jsdom
/**
 * The search results sheet. REAL: `FindResultsSheet.svelte`, `chatListModel.windowRange`, `inChatSearch` (snippet text, hidden rule).
 * MOCKED: the sheet frame (renders its content while open) and the language table.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import { MAX_MOUNTED_ROWS } from '../../ts/chatShell/chatListModel'
import type { SearchHit } from '../../ts/chatShell/inChatSearch'
import type { Message } from '../../ts/storage/database.svelte'

vi.mock('./ShellSheet.svelte', () => ({ default: (anchor: Comment, props: { open: boolean, children: (anchor: Comment) => void }) => {
    if (props.open) props.children(anchor)
    return {}
} }))
vi.mock('../../lang', () => ({
    language: { chatShellFindSeeAll: 'See all', chatShellFindHidden: 'Hidden from the prompt', chatShellFindNoDate: 'no date' },
}))

import FindResultsSheet from './FindResultsSheet.svelte'

let app: ReturnType<typeof mount> | undefined
let target: HTMLElement
let onpick: Mock<(position: number) => void>
const messages = $state<Message[]>([])

function fill(count: number, data: (index: number) => string = (index) => `message ${index} lantern here`): void {
    messages.splice(0, messages.length, ...Array.from({ length: count }, (_, index) => ({
        role: index % 2 === 0 ? 'char' : 'user', data: data(index), saying: '', time: new Date(2026, 0, 1 + (index % 28), 12).getTime(),
    }) as Message))
}

// Newest first, as the scan reports them.
function hitsOf(indices: readonly number[]): SearchHit[] {
    return indices.map((index) => ({ index, message: index < 0 ? null : messages[index] }))
}

function show(hits: SearchHit[], extra: { complete?: boolean, query?: string, firstText?: string } = {}): void {
    target = document.createElement('div')
    document.body.appendChild(target)
    onpick = vi.fn<(position: number) => void>()
    app = mount(FindResultsSheet, {
        target,
        props: {
            open: true, opener: null, background: [], get messages() { return messages }, hits, query: extra.query ?? 'lantern',
            complete: extra.complete ?? true, thinking: false, firstText: extra.firstText ?? 'First lantern', userName: 'Me', charName: 'Seraphina',
            userImage: '', charImage: 'avatar.png', onpick, onclose: vi.fn<() => void>(),
        },
    })
    flushSync()
}

const rows = () => [...target.querySelectorAll<HTMLElement>('[role="listitem"]')]

beforeEach(() => { document.body.replaceChildren() })
afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    document.body.replaceChildren()
    messages.splice(0, messages.length)
})

describe('FindResultsSheet', () => {
    test('B2c-3: 500 hits mount no more than the window of rows, and the spacers hold the rest of the height', () => {
        fill(500)
        show(hitsOf(Array.from({ length: 500 }, (_, k) => 499 - k)))
        expect(rows().length).toBeGreaterThan(0)
        expect(rows().length).toBeLessThanOrEqual(MAX_MOUNTED_ROWS)
        const spacers = [...target.querySelectorAll<HTMLElement>('.spacer')]
        const heights = spacers.reduce((sum, spacer) => sum + parseInt(spacer.style.height, 10), 0)
        expect(heights + rows().length * 72).toBe(500 * 72)
    })

    test('B2c-3: scrolling moves the window and a tap reports the hit position, not the row offset', () => {
        fill(500)
        show(hitsOf(Array.from({ length: 500 }, (_, k) => 499 - k)))
        const list = target.querySelector<HTMLElement>('[data-part="chat-find-results"]')!
        list.scrollTop = 72 * 200
        list.dispatchEvent(new Event('scroll'))
        flushSync()
        const topSpacer = target.querySelector<HTMLElement>('.spacer')!
        expect(parseInt(topSpacer.style.height, 10)).toBeGreaterThan(0)
        const buttons = rows().map((row) => row.querySelector<HTMLButtonElement>('button')!)
        expect(rows().length).toBeLessThanOrEqual(MAX_MOUNTED_ROWS)
        const names = buttons.map((button) => button.querySelector('.snippet')!.textContent)
        expect(names.some((text) => text!.includes('message 299 '))).toBe(true)
        expect(names.some((text) => text!.includes('message 499 '))).toBe(false)
        const row = buttons.find((button) => button.querySelector('.snippet')!.textContent!.includes('message 299 '))!
        row.click()
        expect(onpick).toHaveBeenCalledWith(200)
    })

    test('B2c-3: the snippet marks the match as an element, keeps its case and renders message markup as text only', () => {
        fill(3, (index) => index === 1 ? 'Bring the <b>Lantern</b> <script>x</script> home' : 'nothing')
        show(hitsOf([1]))
        const snippet = target.querySelector('.snippet')!
        const mark = snippet.querySelector('mark')!
        expect(mark.textContent).toBe('Lantern')
        expect(snippet.querySelector('b, script')).toBeNull()
        expect(snippet.textContent).toBe('Bring the Lantern <script>x</script> home')
    })

    test('B2c-3: a match that lowercasing would shift shows the snippet without a mark', () => {
        fill(2, (index) => index === 1 ? 'İstanbul lantern' : 'nothing')
        show(hitsOf([1]))
        const snippet = target.querySelector('.snippet')!
        expect(snippet.querySelector('mark')).toBeNull()
        expect(snippet.textContent).toBe('İstanbul lantern')
    })

    test('B2c-3: the title counts the hits with a plus while the scan runs', () => {
        fill(3)
        show(hitsOf([2, 1]), { complete: false })
        expect(target.querySelector('h2')!.textContent).toBe('See all · 2+')
    })

    test('B2c-3: the speaker follows the role; the first message is the character and has no date or hidden label', () => {
        fill(3)
        show(hitsOf([1, 0, -1]), { firstText: 'The first lantern' })
        const names = rows().map((row) => row.querySelector('.result-name')!.textContent)
        expect(names).toEqual(['Me', 'Seraphina', 'Seraphina'])
        expect(rows()[2].querySelector('.result-date')!.textContent).toBe('no date')
        expect(rows()[2].querySelector('.snippet')!.textContent).toBe('The first lantern')
        expect(rows()[2].querySelector('.result-hidden')).toBeNull()
        expect(rows()[2].querySelector('mark')!.textContent).toBe('lantern')
    })

    test('B2c-3: the avatar is the picture when one is resolved and the initial otherwise', () => {
        fill(2)
        show(hitsOf([1, 0]))
        expect(rows()[0].querySelector('.avatar')!.textContent!.trim()).toBe('M')
        expect(rows()[0].querySelector('img')).toBeNull()
        expect(rows()[1].querySelector('img')!.getAttribute('src')).toBe('avatar.png')
    })

    test('B2c-5: a flag changed after the scan shows the hidden label on the next render, with no rescan', () => {
        fill(5)
        show(hitsOf([4, 3, 2, 1, 0]))
        expect(target.querySelectorAll('.result-hidden').length).toBe(0)
        messages[3].disabled = true
        flushSync()
        const labelled = rows().filter((row) => row.querySelector('.result-hidden'))
        expect(labelled.length).toBe(1)
        expect(labelled[0].querySelector('.snippet')!.textContent).toContain('message 3 ')
        expect(labelled[0].querySelector('.result-hidden')!.textContent).toBe('Hidden from the prompt')
    })

    test('B2c-5: a reset flag after the scan hides every message at or before it', () => {
        fill(5)
        show(hitsOf([4, 3, 2, 1, 0]))
        messages[2].disabled = 'allBefore'
        flushSync()
        const labelled = rows().map((row) => row.querySelector('.result-hidden') !== null)
        expect(labelled).toEqual([false, false, true, true, true])
    })
})
