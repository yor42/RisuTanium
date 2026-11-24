// @vitest-environment jsdom
/**
 * The render-when-complete checkbox of the Studio character form is named through aria-label equal to the visible
 * text and keeps its description link, and the name input is named by its label (the hide-icon switch lives in the
 * Display form). REAL: StudioCharacterForm and the real language
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
    test('the checkbox carries aria-label equal to its visible text and no aria-labelledby, and the name input has its label', () => {
        host = document.createElement('div')
        document.body.appendChild(host)
        app = mount(StudioCharacterForm, { target: host, props: { chaId: 'A' } })
        flushSync()
        expect(host.querySelector('[data-part="studio-form-hide-icon"]')).toBeNull()
        const name = host.querySelector<HTMLInputElement>('[data-part="studio-form-name"]')!
        expect(host.querySelector(`label[for="${name.id}"]`)?.textContent).toBe(language.name)
        const render = host.querySelector<HTMLInputElement>('[data-part="studio-form-render-when-complete"]')!
        expect(render.getAttribute('aria-label')).toBe(language.studioFormRenderWhenComplete)
        expect(render.hasAttribute('aria-labelledby')).toBe(false)
        expect(controlName(render)).toBe(render.closest('label')!.textContent!.trim())
        expect(document.getElementById(render.getAttribute('aria-describedby')!)).not.toBeNull()
        expect(unnamedControls(host, { fields: true })).toEqual([])
    })
})
