// @vitest-environment jsdom
/**
 * The paste-several sheet names its plus-minus-dash checkbox through aria-label equal to the visible text. REAL:
 * PasteSeveralSheet. MOCKED: as the sibling sheet test does; no history service is involved (Add is not driven).
 * Excluded, with the reason: the pasted-text field is named by aria-label only and is not in the A3c plan list.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => 0 }))
const db = $state({ db: { characters: [] as unknown[] } })
const selection = $state({ selId: 0 })
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        get DBState() { return db },
        get selIdState() { return selection },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        frozenSaveKeysStore: writable([]),
    }
})
vi.mock('src/ts/alertPrompts', async (importOriginal) => ({ ...(await importOriginal<typeof import('src/ts/alertPrompts')>()), pageCovered: () => false }))
vi.mock('src/lang', async () => {
    const helpers = await import('src/ts/studio/studioFixtures.test-helpers')
    return { language: helpers.studioLanguageMock() }
})

import { language } from 'src/lang'
import { characterOwnerKey } from '../../ts/studio/history/ownerPhase'
import { controlName } from '../a11yNames.test-helpers'
import PasteSeveralSheet from './PasteSeveralSheet.svelte'

let app: ReturnType<typeof mount> | undefined
let host: HTMLElement
afterEach(async () => { if (app) await unmount(app); app = undefined; host?.remove() })

describe('PasteSeveralSheet form control names', () => {
    test('the dash checkbox carries aria-label equal to its visible text and no aria-labelledby', () => {
        host = document.createElement('div')
        document.body.appendChild(host)
        app = mount(PasteSeveralSheet, {
            target: host,
            props: { owner: characterOwnerKey('A'), service: null, editable: true, isOpen: () => true, noted: () => true, onadded: vi.fn(), onclose: vi.fn() },
        })
        flushSync()
        const box = host.querySelector<HTMLInputElement>('[data-part="studio-paste-dash"]')!
        expect(box.getAttribute('aria-label')).toBe(language.ltPmDash)
        expect(box.hasAttribute('aria-labelledby')).toBe(false)
        expect(controlName(box)).toBe(box.closest('label')!.textContent!.trim())
    })
})
