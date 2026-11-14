// @vitest-environment jsdom
/**
 * CHORE-729: Move up, Move down and Restore defaults work on the visible list and write it back through the stored order.
 *
 * Invariants:
 * - A move passes the next visible row; every hidden id (deleteAfter, customizeButtons) keeps its stored index.
 * - A move that leaves the visible list writes nothing.
 * - A built-in missing from storage is listed, pinnable and movable.
 * - Restore defaults writes DEFAULT_ORDER.
 *
 * Every test removes the stored layout (or writes its fixture) before it mounts: the layout store is a module singleton.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'

vi.mock('../../lang', () => ({ language: {
    chatShellCustomizeButtons: 'Customize buttons', chatShellOnThisDevice: 'On this device',
    chatShellMoveUp: 'Move up', chatShellMoveDown: 'Move down', chatShellRestoreDefaults: 'Restore defaults',
} }))
vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
    risuChatParser: vi.fn((text: string) => text ?? ''),
    assetRegex: /{{asset:[^}]+}}/g,
}) as unknown as typeof import('src/ts/parser/parser.svelte'))
vi.mock(import('src/ts/parser/chatML'), () => ({
    parseChatML: vi.fn(() => []),
}) as unknown as typeof import('src/ts/parser/chatML'))
import CustomizeButtonsSheet from './CustomizeButtonsSheet.svelte'
import { DEFAULT_ORDER, writeSlots, type ActionId } from '../../ts/chatShell/actionSlots'

const SLOTS_KEY = 'risuChatShell.actionSlots'
let target: HTMLElement
let app: ReturnType<typeof CustomizeButtonsSheet> | undefined
afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    localStorage.removeItem(SLOTS_KEY)
    localStorage.removeItem('risuChatShell.haptics')
})

const DEF: ActionId[] = [...DEFAULT_ORDER]
// Two pre-fix "Move down" presses on hideAI from the defaults: the hidden ids drifted ahead of it.
const R: ActionId[] = ['edit', 'delete', 'copy', 'translate', 'readAloud', 'selectText', 'stepPrev', 'stepNext', 'newReply', 'branch', 'bookmark', 'deleteAfter', 'customizeButtons', 'hideAI']
const E: ActionId[] = ['edit', 'delete', 'copy', 'translate', 'readAloud', 'selectText', 'stepPrev', 'stepNext', 'newReply', 'branch', 'hideAI', 'deleteAfter', 'customizeButtons', 'bookmark']
// The defaults as a build with a shorter action list would have stored them: newReply is absent.
const M: ActionId[] = DEF.filter((id) => id !== 'newReply')
const MV: ActionId[] = ['edit', 'delete', 'copy', 'translate', 'readAloud', 'selectText', 'stepPrev', 'stepNext', 'branch', 'bookmark', 'newReply', 'deleteAfter', 'customizeButtons', 'hideAI']

function mountSheet(): void {
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(CustomizeButtonsSheet, { target, props: { open: true, onclose: vi.fn() } })
    flushSync()
}
function rows(): Element[] { return [...target.querySelectorAll('[data-part="chat-customize-action"]')] }
function labelTexts(): (string | null)[] { return rows().map((row) => row.querySelector('label')!.textContent) }
function stored(): { order: ActionId[]; pinned: ActionId[] } { return JSON.parse(localStorage.getItem(SLOTS_KEY)!) }
function press(name: string): void {
    ;[...target.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.getAttribute('aria-label') === name || button.textContent === name)!.click()
    flushSync()
}

describe('Move up and Move down pass the next visible row', () => {
    test('T1: Move up hideAI swaps it with the visible row above it', () => {
        writeSlots({ order: R, pinned: ['edit', 'delete'] })
        mountSheet()
        press('Move up hideAI')
        expect(labelTexts().slice(-2)).toEqual(['hideAI', 'bookmark'])
        expect(labelTexts().slice(-3)).toEqual(['branch', 'hideAI', 'bookmark'])
    })
    test('T2: the hidden ids keep their stored indices', () => {
        writeSlots({ order: R, pinned: ['edit', 'delete'] })
        mountSheet()
        press('Move up hideAI')
        expect(stored().order).toEqual(E)
        expect(stored().order[11]).toBe('deleteAfter')
        expect(stored().order[12]).toBe('customizeButtons')
    })
    test('T2b: Move down bookmark swaps it with hideAI, not with the hidden id between them', () => {
        writeSlots({ order: R, pinned: ['edit', 'delete'] })
        mountSheet()
        press('Move down bookmark')
        expect(labelTexts().slice(-2)).toEqual(['hideAI', 'bookmark'])
        expect(stored().order).toEqual(E)
    })
})

describe('a move that leaves the visible list writes nothing', () => {
    test('T3: Move down on the last visible row', () => {
        localStorage.removeItem(SLOTS_KEY)
        mountSheet()
        press('Move down hideAI')
        expect(localStorage.getItem(SLOTS_KEY)).toBeNull()
    })
    test('T4: Move up on the first row', () => {
        localStorage.removeItem(SLOTS_KEY)
        mountSheet()
        press('Move up edit')
        expect(localStorage.getItem(SLOTS_KEY)).toBeNull()
    })
})

describe('a built-in missing from storage', () => {
    test('T6: is listed after the stored rows', () => {
        writeSlots({ order: M, pinned: ['edit', 'delete'] })
        mountSheet()
        expect(labelTexts()).toEqual(['edit', 'delete', 'copy', 'translate', 'readAloud', 'selectText', 'stepPrev', 'stepNext', 'branch', 'bookmark', 'hideAI', 'newReply'])
    })
    test('T6b: can be pinned and moved', () => {
        writeSlots({ order: M, pinned: ['edit', 'delete'] })
        mountSheet()
        const row = rows().find((item) => item.querySelector('label')?.textContent === 'newReply')
        expect(row).toBeTruthy()
        row!.querySelector<HTMLInputElement>('input')!.click()
        flushSync()
        expect(stored().pinned).toEqual(['edit', 'delete', 'newReply'])
        press('Move up newReply')
        expect(stored().order).toEqual(MV)
        expect(stored().order[11]).toBe('deleteAfter')
        expect(stored().order[12]).toBe('customizeButtons')
    })
})

describe('Restore defaults', () => {
    test('T7: writes DEFAULT_ORDER and the default pins', () => {
        localStorage.removeItem(SLOTS_KEY)
        mountSheet()
        const fresh = labelTexts()
        press('Restore defaults')
        expect(stored()).toEqual({ order: DEF, pinned: ['edit', 'delete'] })
        expect(labelTexts()).toEqual(fresh)
        expect(labelTexts()).toEqual(['edit', 'delete', 'copy', 'translate', 'readAloud', 'selectText', 'stepPrev', 'stepNext', 'newReply', 'branch', 'bookmark', 'hideAI'])
    })
})
