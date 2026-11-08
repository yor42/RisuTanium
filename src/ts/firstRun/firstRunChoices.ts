/**
 * The first-run setup as pure choices: which steps show, what a set of answers resolves to, and the database fields the
 * resolved choices write. The Welcome screen holds the answers and renders; nothing here renders or asks.
 */
import { setPreset, type Database } from '../storage/database.svelte'
import { prebuiltPresets } from '../process/templates/templates'
import { FIRST_RUN_MODELS } from '../model/firstRunModels'
import { DBState } from '../stores.svelte'
import { updateTextThemeAndCSS } from '../gui/colorscheme'

export type FirstRunProvider = 'claude' | 'openai' | 'gemini' | 'openrouter' | 'horde' | 'later'
export type MemoryChoice = 'cheap' | 'balanced' | 'memory' | 'unlimited'
export type ChatLanguageChoice = 'english' | 'englishProcessing' | 'ownLanguage' | 'unchanged'
export type UseChoice = 'stories' | 'both' | 'tools'
export type FirstRunStep = 'welcome' | 'use' | 'persona' | 'nickname' | 'provider' | 'chatLanguage' | 'memory' | 'review'

/** Context and response token sizes of each memory choice. */
export const MEMORY_SIZES: Record<MemoryChoice, { maxContext: number, maxResponse: number }> = {
    cheap: { maxContext: 8000, maxResponse: 500 },
    balanced: { maxContext: 12000, maxResponse: 800 },
    memory: { maxContext: 16000, maxResponse: 1000 },
    unlimited: { maxContext: 100000, maxResponse: 1000 },
}

/** The app languages Welcome offers (the codes `changeLanguage` and `DBState.db.language` take). */
export const FIRST_RUN_LANGUAGES = ['de', 'en', 'ko', 'cn', 'vi', 'zh-Hant', 'es', 'ja'] as const
export type FirstRunLanguage = typeof FIRST_RUN_LANGUAGES[number]

/** The translator code each app language maps to. */
const TRANSLATOR_OF_LANGUAGE: Record<FirstRunLanguage, string> = {
    de: 'de',
    en: 'en',
    ko: 'ko',
    cn: 'zh',
    vi: 'vi',
    es: 'es',
    'zh-Hant': 'zh-TW',
    ja: 'ja',
}

//#region language

export interface DetectedLanguage {
    /** The language Welcome shows selected: the browser's when supported, otherwise English. */
    shown: FirstRunLanguage
    supported: boolean
}

/** The language the browser reports, reduced to its primary subtag as Welcome has always matched it. */
export function detectLanguage(browserLanguage: string): DetectedLanguage {
    const primary = browserLanguage.split('-')[0]
    const match = FIRST_RUN_LANGUAGES.find((code) => code === primary)
    return match === undefined ? { shown: 'en', supported: false } : { shown: match, supported: true }
}

export type LanguageWriteMoment = 'mount' | 'start' | 'skip' | 'restore'

/**
 * The app language to write at a moment, or null for none. A supported browser language is written at mount. An
 * unsupported one writes `en` only when the person starts or skips setup, never at mount and never on a restore (the
 * restored database brings its own language). A language the person picked has already been written by its own change.
 */
export function languageToWrite(moment: LanguageWriteMoment, detected: DetectedLanguage, picked: FirstRunLanguage | null): FirstRunLanguage | null {
    switch (moment) {
        case 'mount':
            return detected.supported ? detected.shown : null
        case 'start':
        case 'skip':
            return picked ?? detected.shown
        case 'restore':
            return null
    }
}

//#endregion

//#region keys

const KEY_PREFIX: Partial<Record<FirstRunProvider, string>> = {
    claude: 'sk-',
    openai: 'sk-',
    openrouter: 'sk-',
    gemini: 'AIza',
}

export interface KeyAdvisory {
    /** A trimmed, non-empty key is typed. This is the only thing that gates Continue. */
    ready: boolean
    /** The key starts the way the provider's keys usually do. Advisory only: it never blocks and never changes `ready`. */
    standardPrefix: boolean
}

export function providerTakesKey(provider: FirstRunProvider): boolean {
    return KEY_PREFIX[provider] !== undefined
}

export function keyAdvisory(provider: FirstRunProvider, key: string): KeyAdvisory {
    const trimmed = key.trim()
    const prefix = KEY_PREFIX[provider]
    return { ready: trimmed.length > 0, standardPrefix: prefix !== undefined && trimmed.startsWith(prefix) }
}

//#endregion

//#region answers and steps

/** The answers given so far. `null` marks a question not answered yet; nothing is preselected for it. */
export interface FirstRunState {
    skipped: boolean
    appLanguage: string
    use: UseChoice | null
    /** Persona name for stories and both, nickname for tools. */
    name: string
    description: string
    /** The picture chosen on the persona step is kept (the avatar already sits in the database). */
    keepPicture: boolean
    /** Tools only: whether to set a nickname. */
    wantsNickname: boolean | null
    provider: FirstRunProvider | null
    apiKey: string
    /** Horde and set-up-later only: whether to choose memory and chat language now. */
    setUpNow: boolean | null
    memory: MemoryChoice
    chatLanguage: ChatLanguageChoice
}

export type FirstRunQuestion = 'setUpNow'

export interface StepList {
    steps: FirstRunStep[]
    /** The question that must be answered before the steps after it are known; null when none. */
    needsAnswer: FirstRunQuestion | null
}

/** The Use step holds no default: Continue stays disabled until the person picks. */
export function useStepReady(use: UseChoice | null): boolean {
    return use !== null
}

/** With Yes chosen a nickname is required; No needs nothing; an unanswered question is not ready. */
export function nicknameReady(wantsNickname: boolean | null, name: string): boolean {
    if (wantsNickname === null) {
        return false
    }
    return !wantsNickname || name.trim().length > 0
}

function asksSetUpNow(provider: FirstRunProvider | null): boolean {
    return provider === 'horde' || provider === 'later'
}

/**
 * The ordered visible steps. The persona step is the nickname step for tools. Chat language is dropped when the app
 * language is English. For Horde and set-up-later, chat language and memory show only after Yes to "set up now"; before
 * any answer the list stops at the provider step and `needsAnswer` names the question, because it has no default.
 */
export function stepsFor(state: Pick<FirstRunState, 'appLanguage' | 'use' | 'provider' | 'setUpNow'>): StepList {
    const steps: FirstRunStep[] = ['welcome', 'use', state.use === 'tools' ? 'nickname' : 'persona', 'provider']
    if (asksSetUpNow(state.provider)) {
        if (state.setUpNow === null) {
            return { steps, needsAnswer: 'setUpNow' }
        }
        if (state.setUpNow) {
            addMemoryAndLanguage(steps, state.appLanguage)
        }
    } else {
        addMemoryAndLanguage(steps, state.appLanguage)
    }
    steps.push('review')
    return { steps, needsAnswer: null }
}

function addMemoryAndLanguage(steps: FirstRunStep[], appLanguage: string): void {
    if (appLanguage !== 'en') {
        steps.push('chatLanguage')
    }
    steps.push('memory')
}

//#endregion

//#region choices

export interface FirstRunPersona {
    /** Trimmed; empty keeps the database's current name. */
    name: string
    description: string
    keepPicture: boolean
}

export interface FirstRunChoices {
    provider: FirstRunProvider
    apiKey: string
    memory: MemoryChoice
    chatLanguage: ChatLanguageChoice
    persona: FirstRunPersona
}

const NO_PERSONA: FirstRunPersona = { name: '', description: '', keepPicture: false }

/**
 * What the answers resolve to, or null while a question is unanswered. Skip setup, and Horde or set-up-later without
 * "set up now", resolve to Balanced memory and an unchanged chat language, discarding any earlier memory and language
 * answers. Tools carries only the nickname.
 */
export function resolveChoices(state: FirstRunState): FirstRunChoices | null {
    if (state.skipped) {
        return { provider: 'later', apiKey: '', memory: 'balanced', chatLanguage: 'unchanged', persona: NO_PERSONA }
    }
    if (state.use === null || state.provider === null || stepsFor(state).needsAnswer !== null) {
        return null
    }
    const persona: FirstRunPersona = state.use === 'tools'
        ? { name: state.wantsNickname === true ? state.name.trim() : '', description: '', keepPicture: false }
        : { name: state.name.trim(), description: state.description, keepPicture: state.keepPicture }
    const apiKey = providerTakesKey(state.provider) ? state.apiKey.trim() : ''
    const later = asksSetUpNow(state.provider) && state.setUpNow !== true
    return {
        provider: state.provider,
        apiKey,
        memory: later ? 'balanced' : state.memory,
        chatLanguage: later || state.appLanguage === 'en' ? 'unchanged' : state.chatLanguage,
        persona,
    }
}

//#endregion

//#region writes

function writeApiKey(db: Database, provider: FirstRunProvider, key: string): void {
    switch (provider) {
        case 'claude':
            db.claudeAPIKey = key
            break
        case 'openai':
            db.openAIKey = key
            break
        case 'openrouter':
            db.openrouterKey = key
            break
        case 'gemini':
            db.google.accessToken = key
            break
        case 'horde':
        case 'later':
            break
    }
}

function writeModel(db: Database, provider: FirstRunProvider): void {
    switch (provider) {
        case 'claude':
        case 'openai':
        case 'gemini':
            db.aiModel = FIRST_RUN_MODELS[provider]
            db.subModel = FIRST_RUN_MODELS[provider]
            break
        case 'openrouter':
            db.aiModel = 'openrouter'
            db.subModel = 'openrouter'
            db.openrouterRequestModel = 'risu/free'
            break
        case 'horde':
            db.aiModel = 'horde:::auto'
            db.subModel = 'horde:::auto'
            break
        case 'later':
            break
    }
}

/**
 * Chat language: `english` and `unchanged` write nothing; `ownLanguage` sets the translator for the app language;
 * `englishProcessing` sets the translator and turns automatic translation of the chat on.
 */
function writeChatLanguage(db: Database, choice: ChatLanguageChoice): void {
    if (choice === 'english' || choice === 'unchanged') {
        return
    }
    // The app language is any string the database holds, so look it up through the widened view of the table.
    const translators: Partial<Record<string, string>> = TRANSLATOR_OF_LANGUAGE
    const translator = translators[db.language]
    if (translator !== undefined) {
        db.translator = translator
    }
    if (choice === 'englishProcessing') {
        db.autoTranslate = true
        db.translatorType = 'google'
        db.useAutoTranslateInput = true
    }
}

function writePersona(db: Database, persona: FirstRunPersona): void {
    if (persona.name.length > 0) {
        db.username = persona.name
    }
    db.personaPrompt = persona.description
    if (!persona.keepPicture) {
        db.userIcon = ''
    }
    const selected = db.personas[db.selectedPersona]
    if (selected !== undefined) {
        selected.name = db.username
        selected.icon = db.userIcon
        selected.personaPrompt = db.personaPrompt
        selected.note = db.userNote
    }
}

/**
 * Writes the choices into `db` and returns it. The preset goes first because it overwrites context, response and model;
 * everything the person chose follows it. It never writes the mode fields and never sets `didFirstSetup`.
 */
export function applyFirstRunChoices(db: Database, choices: FirstRunChoices): Database {
    const target = setPreset(db, prebuiltPresets.OAI2)
    target.textTheme = 'highcontrast'
    target.claudeCachingExperimental = true
    target.maxContext = MEMORY_SIZES[choices.memory].maxContext
    target.maxResponse = MEMORY_SIZES[choices.memory].maxResponse
    writeModel(target, choices.provider)
    if (choices.apiKey.length > 0) {
        writeApiKey(target, choices.provider, choices.apiKey)
    }
    writeChatLanguage(target, choices.chatLanguage)
    writePersona(target, choices.persona)
    return target
}

/**
 * Ends first-run setup on the live database: the choices, the theme, then `didFirstSetup` as the last write, then the
 * opened-files re-drain (which holds while the flag is false).
 */
export function finishFirstRun(choices: FirstRunChoices): void {
    DBState.db = applyFirstRunChoices(DBState.db, choices)
    updateTextThemeAndCSS()
    DBState.db.didFirstSetup = true
    window.__risuTaniumOpenedFiles?.()
}

//#endregion
