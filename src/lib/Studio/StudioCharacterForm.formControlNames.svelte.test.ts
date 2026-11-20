// @vitest-environment jsdom
/**
 * The hide-icon and render-when-complete checkboxes of the Studio character form are named through aria-label equal
 * to the visible text, and the second keeps its description link. REAL: StudioCharacterForm and the real language
 * table. MOCKED: the history service (absent, so the fields are read-only), the toast helper and the two child fields
 * (long text and greeting cards), which are not part of this check.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/stores.svelte', () => ({
    DBState: { db: { characters: [{ chaId: 'A', type: 'character', desc: '', alternateGreetings: [], chats: [], chatPage: 0 }], globalChatVariables: {} } },
}))
vi.mock('src/ts/studio/edit/studioToasts', () => ({ createStudioToasts: () => ({}), refusalText: () => '' }))
vi.mock('src/ts/studio/history/studioHistoryService.svelte', () => ({
    beginOwnerVisit: vi.fn(),
    ensureStudioHistory: vi.fn(),
    getStudioHistoryService: () => null,
    historyBannerText: () => null,
    studioHistoryLoadFailed: () => false,
}))
vi.mock('./GreetingCards.svelte', () => ({ default: () => ({}) }))
vi.mock('./LongTextField.svelte', () => ({ default: () => ({}) }))

import { language } from 'src/lang'
import { controlName, unnamedControls } from '../a11yNames.test-helpers'
import StudioCharacterForm from './StudioCharacterForm.svelte'

let app: ReturnType<typeof mount> | undefined
let host: HTMLElement
afterEach(async () => { if (app) await unmount(app); app = undefined; host?.remove() })

describe('StudioCharacterForm form control names', () => {
    test('both checkboxes carry aria-label equal to their visible text and no aria-labelledby', () => {
        host = document.createElement('div')
        document.body.appendChild(host)
        app = mount(StudioCharacterForm, { target: host, props: { chaId: 'A' } })
        flushSync()
        const hide = host.querySelector<HTMLInputElement>('[data-part="studio-form-hide-icon"]')!
        const render = host.querySelector<HTMLInputElement>('[data-part="studio-form-render-when-complete"]')!
        expect(hide.getAttribute('aria-label')).toBe(language.hideChatIcon)
        expect(render.getAttribute('aria-label')).toBe(language.studioFormRenderWhenComplete)
        for (const box of [hide, render]) {
            expect(box.hasAttribute('aria-labelledby')).toBe(false)
            expect(controlName(box)).toBe(box.closest('label')!.textContent!.trim())
        }
        expect(document.getElementById(render.getAttribute('aria-describedby')!)).not.toBeNull()
        expect(unnamedControls(host, { fields: true })).toEqual([])
    })
})
