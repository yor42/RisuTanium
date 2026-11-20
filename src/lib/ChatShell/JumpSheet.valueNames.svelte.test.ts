// @vitest-environment jsdom
/**
 * `JumpSheet.svelte`: the date input is named by its visible text and carries that text first in its description.
 * REAL: the sheet, the language table and the checker. MOCKED: the sheet frame and the toast post.
 * The message-number field is a text field with no toggle, outside the value-control set.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Chat } from '../../ts/storage/database.svelte'
import { fieldNameProblems, unnamedControls } from '../a11yNames.test-helpers'

vi.mock('../../ts/toast/toastHost.svelte', () => ({ postToast: () => 1 }))
vi.mock('./ShellSheet.svelte', () => ({ default: (anchor: Comment, props: { open: boolean, children: (anchor: Comment) => void }) => {
    if (props.open) props.children(anchor)
    return {}
} }))

import { language } from '../../lang'
import JumpSheet from './JumpSheet.svelte'

let app: ReturnType<typeof mount> | undefined
afterEach(async () => { if (app) await unmount(app); app = undefined; document.body.replaceChildren() })

// The message-number text field: a text field named by `for` only, outside the value-control set of #334.
const KNOWN_UNNAMED: string[] = ['<input type=text class="svelte-12ys7ir">']

describe('JumpSheet value-control names', () => {
    test('regression reproducer: the date input is named by its visible text', () => {
        const target = document.createElement('div')
        document.body.appendChild(target)
        const chat = { message: [{ role: 'char', data: 'm0', chatId: 'id0', time: new Date(2026, 0, 1, 12).getTime() }], note: '', name: 'c', localLore: [], id: 'chat' } as unknown as Chat
        app = mount(JumpSheet, { target, props: { open: true, opener: null, background: [], chat, onjump: vi.fn(), onsearch: undefined, onclose: vi.fn() } })
        flushSync()
        expect(fieldNameProblems(target, [{ name: language.chatShellJumpDate }])).toEqual([])
        expect(unnamedControls(target, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
    })
})
