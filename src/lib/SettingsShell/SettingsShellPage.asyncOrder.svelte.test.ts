// @vitest-environment jsdom
import 'src/ts/tests/asyncScheduler.test-helpers'

/**
 * `SettingsShellPage.svelte` under Svelte's async scheduler: the scroll-memory scenarios of
 * `SettingsShellPage.modes.svelte.test.ts` run again with the async scheduler on (the helper import above is
 * first), where the block update runs before an `$effect.pre`, so the leaving view's position must be remembered
 * while the shown index is computed. Regression reproducers for that ordering; the same scenarios stay green
 * under the shipped scheduler.
 *
 * MOCKED: as in `SettingsShellPage.modes.svelte.test.ts`, `stores.svelte`, `alertBack` and the legacy Settings
 * pages (empty stubs).
 */
import { writable } from 'svelte/store'
import { vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'

vi.mock(import('../../ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    const menu = $state([] as unknown[])
    return {
        DBState: state,
        additionalSettingsMenu: menu,
        easyPanelStore: { open: false },
        SettingsMenuIndex: writable(-1),
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('../../ts/stores.svelte')
})

vi.mock('../../ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('../Setting/Pages/UserSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/BotSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/OtherBotSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/DisplaySettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/PluginSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/AdvancedSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/LanguageSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/AccessibilitySettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/PersonaSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/PromptSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/Module/ModuleSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/HotkeySettings.svelte', () => ({ default: () => {} }))
vi.mock('../Others/PluginDefinedIcon.svelte', () => ({ default: () => {} }))

import { registerSettingsScrollMemorySuite } from './SettingsShellPage.scenarios.test-helpers.svelte'

registerSettingsScrollMemorySuite()
