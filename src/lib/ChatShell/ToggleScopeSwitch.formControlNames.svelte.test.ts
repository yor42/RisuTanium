// @vitest-environment happy-dom
/**
 * The scope switch is named through aria-label equal to its visible label and keeps its description link to the note.
 * REAL: ToggleScopeSwitch and the engine. MOCKED: the stores, as the sibling test does.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Chat } from 'src/ts/storage/database.svelte'
import { controlName, unnamedControls } from '../a11yNames.test-helpers'

const state = vi.hoisted(() => ({ db: {} as Record<string, unknown> }))

vi.mock('src/ts/stores.svelte', () => ({
    DBState: { get db() { return state.db } },
    selIdState: { selId: -1 },
    selectedCharID: writable(0),
}))
vi.mock('src/ts/storage/database.svelte', () => ({
    appVer: '1234.5.67',
    getCurrentCharacter: () => undefined,
    getCurrentChat: () => undefined,
    getDatabase: () => state.db,
}))
vi.mock('src/ts/globalApi.svelte', () => ({
    aiWatermarkingLawApplies: () => false,
    getFileSrc: () => Promise.resolve(''),
    readImage: () => Promise.resolve(undefined),
}))
vi.mock('src/ts/storage/characterSaveMarks', () => ({ markCharacterForSave: vi.fn() }))
vi.mock('src/ts/process/modules', () => ({ getModuleToggles: () => '' }))
vi.mock('src/lang', () => ({ language: new Proxy({}, { get: (_target, key) => String(key) }) }))

import ToggleScopeSwitch from './ToggleScopeSwitch.svelte'

let mounted: ReturnType<typeof mount> | undefined

beforeEach(() => {
    const chat = { message: [{ role: 'user', data: 'hi', chatId: 'm1' }], note: '', name: 'chat', localLore: [], id: 'chat-1' } as unknown as Chat
    const owner = { chaId: 'char-a', name: 'A', chats: [chat] }
    state.db = { characters: [owner], globalChatVariables: {}, customPromptTemplateToggle: '' }
    mounted = mount(ToggleScopeSwitch, { target: document.body, props: { owner, chat } })
    flushSync()
})
afterEach(() => {
    if (mounted) unmount(mounted)
    mounted = undefined
    document.body.innerHTML = ''
})

describe('ToggleScopeSwitch form control names', () => {
    test('the switch carries aria-label equal to its label, no aria-labelledby, and still describes itself by the note', () => {
        const box = document.querySelector<HTMLInputElement>('input[role="switch"]')!
        expect(box.getAttribute('aria-label')).toBe('chatShellToggleScopeLabel')
        expect(box.hasAttribute('aria-labelledby')).toBe(false)
        expect(document.getElementById(box.getAttribute('aria-describedby')!)).not.toBeNull()
        expect(controlName(box)).toBe('chatShellToggleScopeLabel')
        expect(unnamedControls(document.body, { fields: true })).toEqual([])
    })
})
