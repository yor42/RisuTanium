// @vitest-environment jsdom
/**
 * The keep checkbox of each field that changed elsewhere is named through aria-label equal to the visible keep text.
 * REAL: StudioRestoreSheet and the restore path order. MOCKED: the history service view, the screen selection, the
 * live readers, the toast host and the back layer, so the sheet mounts over a fixed restore with two changed fields.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/studio/history/studioHistoryService.svelte', () => ({
    getStudioHistoryService: () => ({ view: () => ({ restore: { fields: { desc: 'a', firstMessage: 'b' } } }) }),
}))
vi.mock('src/ts/studio/studioScreen.svelte', () => ({
    selectedHistoryOwner: () => 'character:A',
    setStudioRestoreSheetOpen: vi.fn(),
}))
// The session adapter table loads the preset adapter, which reads the page database; the real store module loads the
// whole app, so a bare database stands in.
vi.mock('src/ts/stores.svelte', () => ({ DBState: { db: {} } }))
vi.mock('src/ts/studio/studioBack.svelte', () => ({ registerStudioSheetBack: vi.fn() }))
vi.mock('src/ts/studio/edit/studioToasts', () => ({
    createStudioToasts: () => ({ suspendWhileMounted: vi.fn() }),
    refusalText: () => '',
}))
vi.mock('src/ts/studio/history/historyModel', async (importOriginal) => ({
    ...await importOriginal<typeof import('src/ts/studio/history/historyModel')>(),
    listChangedElsewhere: () => ['desc', 'firstMessage'],
}))
vi.mock('src/ts/studio/edit/studioSetters', () => ({
    resolveLiveTarget: () => ({ ok: true, target: {} }),
    createLiveReader: () => ({}),
    createModuleLiveReader: () => ({}),
    isModuleTarget: () => false,
}))
vi.mock('src/ts/studio/assets/openModuleForm.svelte', () => ({ openStudioModuleId: null }))
vi.mock('src/ts/studio/historyFocus', () => ({ placeFocusAfterHistory: vi.fn(async () => {}) }))
vi.mock('src/ts/studio/ownerFields', () => ({ readOwnerFields: () => ({}) }))

import { language } from 'src/lang'
import { controlName, unnamedControls } from '../a11yNames.test-helpers'
import StudioRestoreSheet from './StudioRestoreSheet.svelte'

let app: ReturnType<typeof mount> | undefined
let host: HTMLElement
afterEach(async () => { if (app) await unmount(app); app = undefined; host?.remove() })

describe('StudioRestoreSheet form control names', () => {
    test('each keep checkbox carries aria-label equal to the visible keep text and no aria-labelledby', () => {
        host = document.createElement('div')
        document.body.appendChild(host)
        app = mount(StudioRestoreSheet, { target: host, props: {} })
        flushSync()
        const boxes = [...host.querySelectorAll<HTMLInputElement>('[data-part="studio-restore-keep"]')]
        expect(boxes).toHaveLength(2)
        for (const box of boxes) {
            expect(box.getAttribute('aria-label')).toBe(language.studioRestoreKeep)
            expect(box.hasAttribute('aria-labelledby')).toBe(false)
            expect(controlName(box)).toBe(box.closest('label')!.textContent!.trim())
        }
        expect(unnamedControls(host, { fields: true })).toEqual([])
    })
})
