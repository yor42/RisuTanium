// @vitest-environment happy-dom

/**
 * The first-run choices as pure rules: the steps a set of answers shows, what the answers resolve to, and the database
 * fields the choices write. Faked: `setPreset` (it writes values no choice produces, so the order of the writes shows),
 * the preset table, the live database holder and the theme refresh. Nothing here renders Welcome.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../storage/database.svelte'

const box = vi.hoisted(() => ({
    state: { db: {} as unknown } as { db: unknown },
    order: [] as string[],
    flagAtThemeRefresh: undefined as unknown,
    flagAtRedrain: undefined as unknown,
}))

vi.mock('../storage/database.svelte', () => ({
    setPreset: (db: Record<string, unknown>) => {
        box.order.push('setPreset')
        db.maxContext = 9999
        db.maxResponse = 9999
        db.aiModel = 'preset'
        db.subModel = 'preset'
        return db
    },
}))
vi.mock('../process/templates/templates', () => ({ prebuiltPresets: { OAI2: { name: 'oai2' } } }))
vi.mock('../stores.svelte', () => ({ DBState: box.state }))
vi.mock('../gui/colorscheme', () => ({
    updateTextThemeAndCSS: () => {
        box.order.push('theme')
        box.flagAtThemeRefresh = (box.state.db as { didFirstSetup?: unknown }).didFirstSetup
    },
}))

import { FIRST_RUN_MODELS } from '../model/firstRunModels'
import {
    FIRST_RUN_LANGUAGES,
    MEMORY_SIZES,
    applyFirstRunChoices,
    detectLanguage,
    finishFirstRun,
    keyAdvisory,
    languageToWrite,
    standardKeyPrefix,
    nicknameReady,
    providerTakesKey,
    resolveChoices,
    stepsFor,
    useStepReady,
    type ChatLanguageChoice,
    type FirstRunChoices,
    type FirstRunLanguage,
    type FirstRunProvider,
    type FirstRunState,
    type MemoryChoice,
} from './firstRunChoices'

type FakeDb = Record<string, unknown> & {
    google: { accessToken: string }
    personas: Array<{ name: string, icon: string, personaPrompt: string, note: string }>
}

function freshDb(language = 'en'): FakeDb {
    return {
        language,
        username: 'User',
        userIcon: 'old-icon',
        personaPrompt: 'old prompt',
        userNote: 'a note',
        selectedPersona: 0,
        personas: [{ name: 'User', icon: 'old-icon', personaPrompt: 'old prompt', note: 'a note' }],
        google: { accessToken: '' },
        claudeAPIKey: '',
        openAIKey: '',
        openrouterKey: '',
        translator: 'untouched',
        translatorType: 'untouched',
        autoTranslate: false,
        useAutoTranslateInput: false,
        maxContext: 1,
        maxResponse: 1,
        aiModel: 'untouched',
        subModel: 'untouched',
        openrouterRequestModel: 'untouched',
        textTheme: 'untouched',
        claudeCachingExperimental: false,
    }
}

function choices(over: Partial<FirstRunChoices> = {}): FirstRunChoices {
    return {
        provider: 'later',
        apiKey: '',
        memory: 'balanced',
        chatLanguage: 'unchanged',
        persona: { name: '', description: '', keepPicture: true },
        ...over,
    }
}

function state(over: Partial<FirstRunState> = {}): FirstRunState {
    return {
        skipped: false,
        appLanguage: 'en',
        use: 'stories',
        name: '',
        description: '',
        keepPicture: false,
        wantsNickname: null,
        provider: 'claude',
        apiKey: '',
        setUpNow: null,
        memory: 'balanced',
        chatLanguage: 'unchanged',
        ...over,
    }
}

const apply = (db: FakeDb, c: FirstRunChoices): FakeDb => applyFirstRunChoices(db as unknown as Database, c) as unknown as FakeDb

beforeEach(() => {
    box.order.length = 0
    box.flagAtThemeRefresh = undefined
    box.flagAtRedrain = undefined
})

afterEach(() => {
    delete window.__risuTaniumOpenedFiles
})

describe('provider, model and key', () => {
    test.each([
        ['claude', 'claudeAPIKey'],
        ['openai', 'openAIKey'],
        ['openrouter', 'openrouterKey'],
    ] as const)('%s writes the trimmed key only into %s', (provider, field) => {
        const db = apply(freshDb(), choices({ provider, apiKey: 'K-1' }))

        const keyFields = ['claudeAPIKey', 'openAIKey', 'openrouterKey'] as const
        for (const other of keyFields) {
            expect(db[other]).toBe(other === field ? 'K-1' : '')
        }
        expect(db.google.accessToken).toBe('')
    })

    test('gemini writes its key into google.accessToken and nowhere else, with the recommended model', () => {
        const db = apply(freshDb(), choices({ provider: 'gemini', apiKey: 'K-2' }))

        expect(db.google.accessToken).toBe('K-2')
        expect(db.openAIKey).toBe('')
        expect(db.claudeAPIKey).toBe('')
        expect(db.aiModel).toBe(FIRST_RUN_MODELS.gemini)
        expect(db.subModel).toBe(FIRST_RUN_MODELS.gemini)
        expect(FIRST_RUN_MODELS.gemini).toBe('gemini-flash-latest')
    })

    test.each(['claude', 'openai'] as const)('%s sets both models from the first-run table', (provider) => {
        const db = apply(freshDb(), choices({ provider, apiKey: 'K' }))

        expect(db.aiModel).toBe(FIRST_RUN_MODELS[provider])
        expect(db.subModel).toBe(FIRST_RUN_MODELS[provider])
    })

    test('openrouter sets the free router model; horde sets the auto model; later changes no model', () => {
        const router = apply(freshDb(), choices({ provider: 'openrouter', apiKey: 'K' }))
        expect([router.aiModel, router.subModel, router.openrouterRequestModel]).toEqual(['openrouter', 'openrouter', 'risu/free'])

        const horde = apply(freshDb(), choices({ provider: 'horde' }))
        expect([horde.aiModel, horde.subModel]).toEqual(['horde:::auto', 'horde:::auto'])

        const later = apply(freshDb(), choices({ provider: 'later' }))
        expect([later.aiModel, later.subModel]).toEqual(['preset', 'preset'])
    })

    test('a provider without a key field writes no key', () => {
        const db = apply(freshDb(), choices({ provider: 'horde', apiKey: 'ignored' }))

        expect([db.claudeAPIKey, db.openAIKey, db.openrouterKey, db.google.accessToken]).toEqual(['', '', '', ''])
    })
})

describe('memory', () => {
    test('the size table', () => {
        expect(MEMORY_SIZES).toEqual({
            cheap: { maxContext: 8000, maxResponse: 500 },
            balanced: { maxContext: 12000, maxResponse: 800 },
            memory: { maxContext: 16000, maxResponse: 1000 },
            unlimited: { maxContext: 100000, maxResponse: 1000 },
        })
    })

    test.each(Object.keys(MEMORY_SIZES) as MemoryChoice[])('%s writes its sizes', (memory) => {
        const db = apply(freshDb(), choices({ memory }))

        expect([db.maxContext, db.maxResponse]).toEqual([MEMORY_SIZES[memory].maxContext, MEMORY_SIZES[memory].maxResponse])
    })
})

describe('preset order', () => {
    test('the preset is applied first: the person\'s memory and model replace what it wrote', () => {
        const db = apply(freshDb(), choices({ provider: 'claude', apiKey: 'K', memory: 'cheap' }))

        expect(box.order[0]).toBe('setPreset')
        expect([db.maxContext, db.maxResponse]).toEqual([8000, 500])
        expect(db.aiModel).toBe(FIRST_RUN_MODELS.claude)
        expect(db.textTheme).toBe('highcontrast')
        expect(db.claudeCachingExperimental).toBe(true)
    })
})

describe('skip and set-up-later resolve to the defaults', () => {
    test('skip setup resolves to Balanced, unchanged chat language, no provider and no persona', () => {
        const resolved = resolveChoices(state({ skipped: true, memory: 'unlimited', chatLanguage: 'englishProcessing', appLanguage: 'ko', provider: 'claude', apiKey: 'K' }))

        expect(resolved).toEqual({
            provider: 'later',
            apiKey: '',
            memory: 'balanced',
            chatLanguage: 'unchanged',
            persona: { name: '', description: '', keepPicture: false },
        })
        const db = apply(freshDb(), resolved as FirstRunChoices)
        expect([db.maxContext, db.maxResponse]).toEqual([12000, 800])
        expect([db.aiModel, db.subModel]).toEqual(['preset', 'preset'])
        expect(db.textTheme).toBe('highcontrast')
    })

    test.each(['horde', 'later'] as const)('%s with No discards an earlier Unlimited and chat-language answer', (provider) => {
        const resolved = resolveChoices(state({ provider, setUpNow: false, memory: 'unlimited', chatLanguage: 'englishProcessing', appLanguage: 'ko' }))

        expect(resolved?.memory).toBe('balanced')
        expect(resolved?.chatLanguage).toBe('unchanged')
    })

    test.each(['horde', 'later'] as const)('%s with Yes keeps the memory and chat-language answers', (provider) => {
        const resolved = resolveChoices(state({ provider, setUpNow: true, memory: 'unlimited', chatLanguage: 'ownLanguage', appLanguage: 'ko' }))

        expect(resolved?.memory).toBe('unlimited')
        expect(resolved?.chatLanguage).toBe('ownLanguage')
    })

    test('an English app language never carries a chat-language answer', () => {
        expect(resolveChoices(state({ appLanguage: 'en', chatLanguage: 'englishProcessing' }))?.chatLanguage).toBe('unchanged')
    })

    test('an unanswered question resolves to nothing', () => {
        expect(resolveChoices(state({ use: null }))).toBeNull()
        expect(resolveChoices(state({ provider: null }))).toBeNull()
        expect(resolveChoices(state({ provider: 'horde', setUpNow: null }))).toBeNull()
    })
})

describe('chat language table', () => {
    const TRANSLATORS: Record<FirstRunLanguage, string> = { de: 'de', en: 'en', ko: 'ko', cn: 'zh', vi: 'vi', es: 'es', 'zh-Hant': 'zh-TW', ja: 'ja' }

    test.each(FIRST_RUN_LANGUAGES.flatMap((code) => (['english', 'unchanged', 'englishProcessing', 'ownLanguage'] as ChatLanguageChoice[]).map((choice) => [code, choice] as const)))('%s with %s', (code, choice) => {
        const db = apply(freshDb(code), choices({ chatLanguage: choice }))

        if (choice === 'english' || choice === 'unchanged') {
            expect([db.translator, db.translatorType, db.autoTranslate, db.useAutoTranslateInput]).toEqual(['untouched', 'untouched', false, false])
        } else if (choice === 'ownLanguage') {
            expect([db.translator, db.translatorType, db.autoTranslate, db.useAutoTranslateInput]).toEqual([TRANSLATORS[code], 'untouched', false, false])
        } else {
            expect([db.translator, db.translatorType, db.autoTranslate, db.useAutoTranslateInput]).toEqual([TRANSLATORS[code], 'google', true, true])
        }
    })

    test('an app language outside the table writes no translator', () => {
        const db = apply(freshDb('fr'), choices({ chatLanguage: 'englishProcessing' }))

        expect(db.translator).toBe('untouched')
    })
})

describe('persona', () => {
    test('a named persona with a description and a kept picture writes the fields and syncs the selected persona', () => {
        const db = apply(freshDb(), choices({ persona: { name: 'Mina', description: 'A traveller.', keepPicture: true } }))

        expect([db.username, db.personaPrompt, db.userIcon]).toEqual(['Mina', 'A traveller.', 'old-icon'])
        expect(db.personas[0]).toEqual({ name: 'Mina', icon: 'old-icon', personaPrompt: 'A traveller.', note: 'a note' })
    })

    test('an empty name keeps the current username instead of writing an empty one', () => {
        const db = apply(freshDb(), choices({ persona: { name: '', description: '', keepPicture: true } }))

        expect(db.username).toBe('User')
        expect(db.personas[0].name).toBe('User')
    })

    test('a persona without a picture or description clears both, in the database and the selected persona', () => {
        const db = apply(freshDb(), choices({ persona: { name: '', description: '', keepPicture: false } }))

        expect([db.personaPrompt, db.userIcon]).toEqual(['', ''])
        expect([db.personas[0].personaPrompt, db.personas[0].icon]).toEqual(['', ''])
    })

    test('tools with a nickname carries only the nickname; tools with No leaves the default name', () => {
        const yes = resolveChoices(state({ use: 'tools', wantsNickname: true, name: '  Kai ', description: 'ignored', keepPicture: true }))
        expect(yes?.persona).toEqual({ name: 'Kai', description: '', keepPicture: false })

        const no = resolveChoices(state({ use: 'tools', wantsNickname: false, name: 'ignored' }))
        expect(no?.persona).toEqual({ name: '', description: '', keepPicture: false })
        const db = apply(freshDb(), no as FirstRunChoices)
        expect([db.username, db.personaPrompt, db.userIcon]).toEqual(['User', '', ''])
    })

    test('a key typed with surrounding spaces resolves to the trimmed key', () => {
        const resolved = resolveChoices(state({ provider: 'claude', apiKey: '  sk-test  ' }))

        expect(resolved?.apiKey).toBe('sk-test')
    })

    test('stories and both trim the name and keep the description and picture answer', () => {
        const resolved = resolveChoices(state({ use: 'both', name: ' Mina ', description: 'A traveller.', keepPicture: true }))

        expect(resolved?.persona).toEqual({ name: 'Mina', description: 'A traveller.', keepPicture: true })
    })
})

describe('scope', () => {
    test('the choices never write the mode fields or the setup flag', () => {
        const db = apply(freshDb(), choices({ provider: 'claude', apiKey: 'K', chatLanguage: 'englishProcessing', persona: { name: 'Mina', description: 'd', keepPicture: true } }))

        expect(Object.keys(db)).not.toContain('hideUnusedModes')
        expect(Object.keys(db)).not.toContain('visibleModes')
        expect(Object.keys(db)).not.toContain('didFirstSetup')
    })
})

describe('key advisory', () => {
    test.each([
        ['claude', 'sk-abc', true],
        ['openai', 'sk-abc', true],
        ['openrouter', 'sk-or-abc', true],
        ['gemini', 'AIzaSyAbc', true],
        ['gemini', 'sk-abc', false],
        ['claude', 'AIzaSyAbc', false],
        ['openai', 'abc', false],
    ] as const)('%s with %s: standard prefix %s', (provider, key, standard) => {
        expect(keyAdvisory(provider, key)).toEqual({ ready: true, standardPrefix: standard })
    })

    test('a non-standard key is still ready, so the advisory never blocks Continue', () => {
        expect(keyAdvisory('claude', 'abc').ready).toBe(true)
    })

    test('an empty or whitespace key is not ready and has no standard prefix', () => {
        expect(keyAdvisory('claude', '')).toEqual({ ready: false, standardPrefix: false })
        expect(keyAdvisory('gemini', '   ')).toEqual({ ready: false, standardPrefix: false })
    })

    test('the prefix is judged on the trimmed key', () => {
        expect(keyAdvisory('claude', '  sk-abc ')).toEqual({ ready: true, standardPrefix: true })
    })

    test('the displayed standard prefix is the one the advisory judges against', () => {
        expect(standardKeyPrefix('claude')).toBe('sk-')
        expect(standardKeyPrefix('openai')).toBe('sk-')
        expect(standardKeyPrefix('openrouter')).toBe('sk-')
        expect(standardKeyPrefix('gemini')).toBe('AIza')
        expect(standardKeyPrefix('horde')).toBe('')
        expect(standardKeyPrefix('later')).toBe('')
    })

    test('horde and later take no key', () => {
        expect(providerTakesKey('horde')).toBe(false)
        expect(providerTakesKey('later')).toBe(false)
        expect((['claude', 'openai', 'gemini', 'openrouter'] as FirstRunProvider[]).every(providerTakesKey)).toBe(true)
        expect(keyAdvisory('horde', 'sk-abc').standardPrefix).toBe(false)
    })
})

describe('steps', () => {
    test('the persona step becomes the nickname step for tools', () => {
        expect(stepsFor(state({ use: 'tools' })).steps).toContain('nickname')
        expect(stepsFor(state({ use: 'tools' })).steps).not.toContain('persona')
        expect(stepsFor(state({ use: 'stories' })).steps).toContain('persona')
        expect(stepsFor(state({ use: 'both' })).steps).not.toContain('nickname')
    })

    test('the English app language has no chat-language step; any other has one before memory', () => {
        expect(stepsFor(state({ appLanguage: 'en' })).steps).toEqual(['welcome', 'use', 'persona', 'provider', 'memory', 'review'])
        expect(stepsFor(state({ appLanguage: 'ko' })).steps).toEqual(['welcome', 'use', 'persona', 'provider', 'chatLanguage', 'memory', 'review'])
    })

    test('horde and later with No have no memory or chat-language step; with Yes they do', () => {
        for (const provider of ['horde', 'later'] as const) {
            expect(stepsFor(state({ provider, setUpNow: false, appLanguage: 'ko' })).steps).toEqual(['welcome', 'use', 'persona', 'provider', 'review'])
            expect(stepsFor(state({ provider, setUpNow: true, appLanguage: 'ko' })).steps).toEqual(['welcome', 'use', 'persona', 'provider', 'chatLanguage', 'memory', 'review'])
        }
    })

    test('an unanswered set-up-now question has no default: the list reports that it needs an answer', () => {
        for (const provider of ['horde', 'later'] as const) {
            const list = stepsFor(state({ provider, setUpNow: null, appLanguage: 'ko' }))

            expect(list.needsAnswer).toBe('setUpNow')
            expect(list.steps).toEqual(['welcome', 'use', 'persona', 'provider'])
        }
    })

    test('a keyed provider, or none chosen yet, needs no extra answer', () => {
        expect(stepsFor(state({ provider: 'claude' })).needsAnswer).toBeNull()
        expect(stepsFor(state({ provider: null })).needsAnswer).toBeNull()
    })

    test('the Use step has no preselection: it is ready only after a pick', () => {
        expect(useStepReady(null)).toBe(false)
        expect(useStepReady('stories')).toBe(true)
        expect(useStepReady('both')).toBe(true)
        expect(useStepReady('tools')).toBe(true)
    })
})

describe('nickname', () => {
    test('with Yes a nickname is required before Continue; with No nothing is; unanswered is not ready', () => {
        expect(nicknameReady(true, '')).toBe(false)
        expect(nicknameReady(true, '   ')).toBe(false)
        expect(nicknameReady(true, 'Kai')).toBe(true)
        expect(nicknameReady(false, '')).toBe(true)
        expect(nicknameReady(null, 'Kai')).toBe(false)
    })
})

describe('app language', () => {
    test.each(FIRST_RUN_LANGUAGES.filter((code) => code !== 'zh-Hant'))('a %s browser language is supported and shown', (code) => {
        expect(detectLanguage(`${code}-XX`)).toEqual({ shown: code, supported: true })
    })

    test('the browser language is matched on its primary subtag, so a Traditional Chinese browser is unsupported (chosen by hand)', () => {
        expect(detectLanguage('zh-TW')).toEqual({ shown: 'en', supported: false })
    })

    test('es-ES and ko-KR are supported; fr-FR shows en and is unsupported', () => {
        expect(detectLanguage('es-ES')).toEqual({ shown: 'es', supported: true })
        expect(detectLanguage('ko-KR')).toEqual({ shown: 'ko', supported: true })
        expect(detectLanguage('fr-FR')).toEqual({ shown: 'en', supported: false })
    })

    test('a supported browser language is written at mount; an unsupported one writes nothing at mount', () => {
        expect(languageToWrite('mount', detectLanguage('es-ES'), null)).toBe('es')
        expect(languageToWrite('mount', detectLanguage('fr-FR'), null)).toBeNull()
    })

    test('an unsupported browser language writes en on Start and on Skip, and nothing on Restore', () => {
        const detected = detectLanguage('fr-FR')

        expect(languageToWrite('start', detected, null)).toBe('en')
        expect(languageToWrite('skip', detected, null)).toBe('en')
        expect(languageToWrite('restore', detected, null)).toBeNull()
    })

    test('a restore writes no language even for a supported browser language, and a picked language wins on Start', () => {
        expect(languageToWrite('restore', detectLanguage('es-ES'), null)).toBeNull()
        expect(languageToWrite('start', detectLanguage('fr-FR'), 'ja')).toBe('ja')
    })
})

describe('finishing', () => {
    test('the flag is the last write: the theme refresh sees it unset, the opened-files re-drain sees it set, once', () => {
        const db = freshDb()
        box.state.db = db
        const redrain = vi.fn(() => {
            box.order.push('redrain')
            box.flagAtRedrain = (box.state.db as { didFirstSetup?: unknown }).didFirstSetup
        })
        window.__risuTaniumOpenedFiles = redrain

        finishFirstRun(choices({ provider: 'claude', apiKey: 'K' }))

        expect(box.order).toEqual(['setPreset', 'theme', 'redrain'])
        expect(box.flagAtThemeRefresh).toBeUndefined()
        expect(box.flagAtRedrain).toBe(true)
        expect(redrain).toHaveBeenCalledTimes(1)
        expect(db.claudeAPIKey).toBe('K')
    })

    test('without an opened-files hook the finish still sets the flag', () => {
        const db = freshDb()
        box.state.db = db

        finishFirstRun(choices())

        expect((box.state.db as { didFirstSetup?: unknown }).didFirstSetup).toBe(true)
    })
})
