// @vitest-environment jsdom

/**
 * `OobaSettings.svelte` value controls: the mode select and every optional-value field (text, number
 * and the boolean pair) are named by their visible label span through `aria-labelledby`, and each
 * optional-value checkbox carries the same label text. No naming element is shared between two fields.
 * Mounts the REAL page over a real `$state` database with the real shared inputs; the chat format panel
 * belongs to its own file and stays a stub.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = { alertStore: writable({ type: 'none', msg: '' }) }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('./ChatFormatSettings.svelte', () => ({ default: () => {} }))

import { language } from 'src/lang'
import { fillLang } from 'src/lang/fill'
import { fieldNameProblems, unnamedControls, type FieldExpectation } from 'src/lib/a11yNames.test-helpers'
import { DBState } from 'src/ts/stores.svelte'
import OobaSettings from './OobaSettings.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

const TEXT_KEYS = ['tokenizer']
const NUMBER_KEYS = [
    'min_p', 'top_k', 'repetition_penalty', 'repetition_penalty_range', 'typical_p', 'tfs', 'top_a',
    'epsilon_cutoff', 'eta_cutoff', 'guidance_scale', 'penalty_alpha', 'mirostat_mode', 'mirostat_tau',
    'mirostat_eta', 'encoder_repetition_penalty', 'no_repeat_ngram_size', 'min_length', 'num_beams',
    'length_penalty', 'truncation_length', 'max_tokens_second',
]
const TEXT_KEYS_2 = ['negative_prompt', 'custom_token_bans', 'grammar_string']
const BOOL_KEYS = [
    'temperature_last', 'do_sample', 'early_stopping', 'auto_max_new_tokens', 'ban_eos_token', 'add_bos_token',
    'skip_special_tokens',
]
const ALL_KEYS = [...TEXT_KEYS, ...NUMBER_KEYS, ...TEXT_KEYS_2, ...BOOL_KEYS]

function render(args: Record<string, unknown>, instructionMode = false): HTMLElement {
    DBState.db = { reverseProxyOobaArgs: args, localStopStrings: null } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(OobaSettings, { target, props: { instructionMode } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    const header = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.includes('Ooba'))!
    header.click()
    flushSync()
    return target
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

/** Optional-value fields: a disabled default field with its checkbox, named like the label. */
const optional = (...labels: string[]): FieldExpectation[] => labels.map((name) => ({ name, toggle: true }))
const MODE = { name: fillLang(language.settingsPage.nameMode, { name: 'Ooba' }) }

/** Out-of-scope unnamed controls on this page: none. */
const KNOWN_UNNAMED: string[] = []

function check(target: HTMLElement, expected: FieldExpectation[]): void {
    expect(fieldNameProblems(target, expected)).toEqual([])
    expect(unnamedControls(target, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
    // Every control is named by its visible label span; a lost labelId would fall back to a duplicate sr-only name.
    expect(target.querySelectorAll('span.sr-only')).toHaveLength(0)
}

describe('OobaSettings value controls are named', () => {
    test('instruct mode: mode select, four instruct prefixes, then the shared keys', () => {
        const target = render({ mode: 'instruct' })
        check(target, [
            MODE,
            ...optional(
                language.settingsPage.userPrefix, language.settingsPage.botPrefix,
                language.settingsPage.systemPrefix, language.settingsPage.systemMessage,
                ...ALL_KEYS,
            ),
        ])
    })

    test('chat mode: four chat fields replace the instruct fields', () => {
        const target = render({ mode: 'chat' })
        check(target, [
            MODE,
            ...optional(
                language.settingsPage.userPrefix, language.settingsPage.botPrefix,
                language.settingsPage.systemPrefix, language.settingsPage.startMessage,
                ...ALL_KEYS,
            ),
        ])
    })

    test('chat-instruct mode adds the chat instruct command field after the chat fields', () => {
        const target = render({ mode: 'chat-instruct' })
        check(target, [
            MODE,
            ...optional(
                language.settingsPage.userPrefix, language.settingsPage.botPrefix,
                language.settingsPage.systemPrefix, language.settingsPage.startMessage,
                'chat_instruct_command',
                ...ALL_KEYS,
            ),
        ])
    })

    test('instruction mode drops the mode select and the prefix fields', () => {
        const target = render({ mode: 'instruct' }, true)
        check(target, optional(...ALL_KEYS))
    })

    test('enabled values: text and number fields are named, the boolean pair has no field', () => {
        const args: Record<string, unknown> = { mode: 'chat-instruct' }
        for (const key of [...TEXT_KEYS, ...TEXT_KEYS_2, 'name1', 'name2', 'context', 'greeting', 'chat_instruct_command']) args[key] = 'x'
        for (const key of NUMBER_KEYS) args[key] = 1
        for (const key of BOOL_KEYS) args[key] = true
        const target = render(args)
        check(target, [
            MODE,
            ...optional(
                language.settingsPage.userPrefix, language.settingsPage.botPrefix,
                language.settingsPage.systemPrefix, language.settingsPage.startMessage,
                'chat_instruct_command', ...TEXT_KEYS, ...NUMBER_KEYS, ...TEXT_KEYS_2,
            ),
        ])
    })
})
