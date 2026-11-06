import { LLMProvider, ProviderNames } from '../model/types'

/**
 * Where the failed-send card sends the person to fix the setting. Only the Chat Bot page exists today; a refusal
 * whose setting has no page carries `null` and the card shows no Fix button.
 */
export type SettingsFix = 'botSettings'

/** What the check needs to know about the selected model. */
export interface SendModelInfo {
    provider?: LLMProvider
    keyIdentifier?: string
}

/** The settings the check reads, and nothing else; the database satisfies this shape. */
export interface SendPrerequisiteSettings {
    aiModel: string
    customModels?: ReadonlyArray<{ id: string }>
    presetChain?: string
    fallbackModels?: { model?: readonly string[] }
    openAIKey?: string
    openrouterKey?: string
    claudeAPIKey?: string
    mistralKey?: string
    cohereAPIKey?: string
    OaiCompAPIKeys?: Record<string, string>
    google?: { accessToken?: string }
    novelai?: { token?: string }
}

export interface SendRefusal {
    reason: 'key' | 'model'
    fix: SettingsFix | null
    /** The provider whose key is missing, for the card's detail line. */
    provider?: string
}

/** Emptiness only: a secret reference is never resolved here, and no value is read beyond this test. */
function isBlank(value: unknown): boolean {
    return typeof value !== 'string' || !value.trim()
}

/**
 * Finds a reason a generation with the main model cannot possibly work, before anything is taken: no main model,
 * or no key for a provider that certainly needs one. It never blocks a setup the request path accepts with an empty
 * field: reverse proxies, local models, plugin and custom providers and every provider not listed pass, and so does
 * a setup with a preset chain (the preset can change inside the send) or a non-blank fallback model (the request
 * loop tries each fallback with its own credential). Each key row reads the field the request code reads when no
 * explicit key is passed.
 */
export function checkSendPrerequisites(db: SendPrerequisiteSettings, modelInfo: (id: string) => SendModelInfo): SendRefusal | null {
    if (isBlank(db.aiModel)) {
        return { reason: 'model', fix: 'botSettings' }
    }
    if (db.aiModel.startsWith('xcustom:::') && !(db.customModels ?? []).some((model) => model.id === db.aiModel)) {
        return { reason: 'model', fix: 'botSettings' }
    }
    if (db.presetChain) {
        return null
    }
    if ((db.fallbackModels?.model ?? []).some((id) => !isBlank(id))) {
        return null
    }

    const info = modelInfo(db.aiModel)
    const missing = (provider: string): SendRefusal => ({ reason: 'key', fix: 'botSettings', provider })
    if (info.keyIdentifier) {
        return isBlank(db.OaiCompAPIKeys?.[info.keyIdentifier]) ? missing(info.keyIdentifier) : null
    }
    if (db.aiModel === 'openrouter') {
        return isBlank(db.openrouterKey) ? missing('OpenRouter') : null
    }
    switch (info.provider) {
        case LLMProvider.OpenAI:
            return isBlank(db.openAIKey) ? missing(providerName(info.provider)) : null
        case LLMProvider.Anthropic:
            return isBlank(db.claudeAPIKey) ? missing(providerName(info.provider)) : null
        case LLMProvider.GoogleCloud:
            return isBlank(db.google?.accessToken) ? missing(providerName(info.provider)) : null
        case LLMProvider.Mistral:
            return isBlank(db.mistralKey) ? missing(providerName(info.provider)) : null
        case LLMProvider.Cohere:
            return isBlank(db.cohereAPIKey) ? missing(providerName(info.provider)) : null
        case LLMProvider.NovelAI:
            return isBlank(db.novelai?.token) ? missing(providerName(info.provider)) : null
        default:
            return null
    }
}

function providerName(provider: LLMProvider): string {
    return ProviderNames.get(provider) ?? ''
}
