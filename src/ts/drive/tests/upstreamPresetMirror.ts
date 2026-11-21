/**
 * Test-only mirror of what upstream RisuAI does with a preset list, hotkey rows, loadouts and the preset chain. Every
 * function is a transcription of upstream source at commit 4d87a70ff (the file and lines are named per function), so a
 * round-trip test can apply upstream's own steps to a fork `.bin` without upstream's build. It proves behaviour only as
 * far as each transcription is faithful; nothing here runs upstream code. The `setPreset` an upstream switch ends with
 * is the fork's own, which copies the same working fields.
 */
import type { botPreset, StoredDatabase } from 'src/ts/storage/database.svelte'
import type { Hotkey } from 'src/ts/defaulthotkeys'
import { writeRisuSaveV0 } from 'src/ts/storage/risuSaveV0'

type PresetApplier = (db: StoredDatabase, preset: botPreset) => void

let applyPreset: PresetApplier | null = null

/**
 * Supplies the fork's real `setPreset` (the copy of a preset's fields into the working settings), which a suite that
 * replaces `database.svelte` takes from `vi.importActual`. Upstream's copy writes the same fields.
 */
export function setMirrorPresetApplier(applier: PresetApplier): void {
    applyPreset = applier
}

function setPreset(db: StoredDatabase, preset: botPreset): void {
    if (applyPreset === null) {
        throw new Error('The mirror has no setPreset: call setMirrorPresetApplier first.')
    }
    applyPreset(db, preset)
}

/** The hotkey rows of upstream `src/ts/defaulthotkeys.ts` at 4d87a70ff, in order. */
export const UPSTREAM_DEFAULT_HOTKEYS: Hotkey[] = [
    { key: 'r', ctrl: true, alt: true, action: 'reroll' },
    { key: 'f', ctrl: true, alt: true, action: 'unreroll' },
    { key: 't', ctrl: true, alt: true, action: 'translate' },
    { key: 'd', ctrl: true, alt: true, action: 'remove' },
    { key: 'e', ctrl: true, alt: true, action: 'edit' },
    { key: 'c', ctrl: true, alt: true, action: 'copy' },
    { key: 'Enter', ctrl: true, alt: true, action: 'send' },
    { key: 's', ctrl: true, action: 'settings' },
    { key: 'h', ctrl: true, action: 'home' },
    { key: 'p', ctrl: true, action: 'presets' },
    { key: 'e', ctrl: true, action: 'persona' },
    { key: 'm', ctrl: true, action: 'modelSelect' },
    { key: '.', ctrl: true, action: 'toggleCSS' },
    { key: '[', ctrl: true, action: 'prevChar' },
    { key: ']', ctrl: true, action: 'nextChar' },
    { key: '`', ctrl: true, action: 'quickMenu' },
    { key: 'q', ctrl: true, action: 'quickSettings' },
    { key: 'v', ctrl: true, action: 'toggleVoice' },
    { key: 'l', ctrl: true, action: 'toggleLog' },
    { key: 'u', ctrl: true, action: 'previewRequest' },
    { key: 'w', ctrl: true, action: 'webcam' },
    { key: ' ', action: 'focusInput' },
    { key: 'g', ctrl: true, action: 'scrollToActiveChar' },
    { key: 'x', ctrl: true, action: 'popupEditor' },
    { key: 'o', ctrl: true, action: 'loadout' },
]

/**
 * The keys of the literal upstream `saveCurrentPreset` builds (database.svelte.ts:2088-2167). A key outside this list
 * is dropped from the active entry when upstream saves into it.
 */
export const UPSTREAM_SAVED_PRESET_KEYS: readonly string[] = [
    'name', 'apiType', 'openAIKey', 'localNetworkMode', 'localNetworkTimeoutSec', 'mainPrompt', 'jailbreak', 'globalNote',
    'temperature', 'maxContext', 'maxResponse', 'frequencyPenalty', 'PresensePenalty', 'formatingOrder', 'aiModel', 'subModel',
    'currentPluginProvider', 'textgenWebUIStreamURL', 'textgenWebUIBlockingURL', 'forceReplaceUrl', 'promptPreprocess', 'bias',
    'koboldURL', 'proxyKey', 'ooba', 'ainconfig', 'proxyRequestModel', 'openrouterRequestModel', 'NAISettings', 'promptTemplate',
    'NAIadventure', 'NAIappendName', 'localStopStrings', 'autoSuggestPrompt', 'customProxyRequestModel', 'reverseProxyOobaArgs',
    'top_p', 'promptSettings', 'repetition_penalty', 'min_p', 'top_a', 'openrouterProvider', 'useInstructPrompt',
    'customPromptTemplateToggle', 'templateDefaultVariables', 'moduleIntergration', 'top_k', 'instructChatTemplate',
    'JinjaTemplate', 'jsonSchemaEnabled', 'jsonSchema', 'strictJsonSchema', 'extractJson', 'groupOtherBotRole', 'groupTemplate',
    'seperateParametersEnabled', 'seperateParameters', 'customAPIFormat', 'systemContentReplacement', 'systemRoleReplacement',
    'customFlags', 'enableCustomFlags', 'regex', 'image', 'reasonEffort', 'thinkingTokens', 'thinkingType', 'deepseekThinkingType',
    'adaptiveThinkingEffort', 'deepseekReasoningEffort', 'outputImageModal', 'seperateModelsForAxModels', 'seperateModels',
    'modelTools', 'fallbackModels', 'fallbackWhenBlankResponse', 'verbosity', 'dynamicOutput',
]

/** The case labels of upstream hotkey.ts:34-163; any other action falls to `default` and runs nothing. */
export const UPSTREAM_KNOWN_HOTKEY_ACTIONS: readonly string[] = [
    'reroll', 'unreroll', 'translate', 'remove', 'edit', 'copy', 'focusInput', 'send', 'settings', 'home', 'presets', 'persona',
    'toggleCSS', 'prevChar', 'nextChar', 'quickMenu', 'previewRequest', 'toggleLog', 'quickSettings', 'scrollToActiveChar', 'loadout',
]

/**
 * Upstream `saveCurrentPreset` (database.svelte.ts:2081-2179): the active entry is replaced by a literal built from named
 * working fields, so any key outside `UPSTREAM_SAVED_PRESET_KEYS` is lost. `normalizePromptTemplate` is not applied; the
 * working fields the tests set are already normal.
 */
export function upstreamSaveCurrentPreset(db: StoredDatabase): void {
    const pres = db.botPresets
    if (db.botPresetsId === -1) {
        return
    }
    const saved = {
        name: pres[db.botPresetsId].name,
        apiType: db.apiType,
        openAIKey: db.openAIKey,
        localNetworkMode: db.localNetworkMode,
        localNetworkTimeoutSec: db.localNetworkTimeoutSec,
        mainPrompt: db.mainPrompt,
        jailbreak: db.jailbreak,
        globalNote: db.globalNote,
        temperature: db.temperature,
        maxContext: db.maxContext,
        maxResponse: db.maxResponse,
        frequencyPenalty: db.frequencyPenalty,
        PresensePenalty: db.PresensePenalty,
        formatingOrder: db.formatingOrder,
        aiModel: db.aiModel,
        subModel: db.subModel,
        currentPluginProvider: db.currentPluginProvider,
        textgenWebUIStreamURL: db.textgenWebUIStreamURL,
        textgenWebUIBlockingURL: db.textgenWebUIBlockingURL,
        forceReplaceUrl: db.forceReplaceUrl,
        promptPreprocess: db.promptPreprocess,
        bias: db.bias,
        koboldURL: db.koboldURL,
        proxyKey: db.proxyKey,
        ooba: structuredClone(db.ooba),
        ainconfig: structuredClone(db.ainconfig),
        proxyRequestModel: db.proxyRequestModel,
        openrouterRequestModel: db.openrouterRequestModel,
        NAISettings: structuredClone(db.NAIsettings),
        promptTemplate: db.promptTemplate ?? null,
        NAIadventure: db.NAIadventure ?? false,
        NAIappendName: db.NAIappendName ?? false,
        localStopStrings: db.localStopStrings,
        autoSuggestPrompt: db.autoSuggestPrompt,
        customProxyRequestModel: db.customProxyRequestModel,
        reverseProxyOobaArgs: structuredClone(db.reverseProxyOobaArgs) ?? null,
        top_p: db.top_p ?? 1,
        promptSettings: structuredClone(db.promptSettings) ?? null,
        repetition_penalty: db.repetition_penalty,
        min_p: db.min_p,
        top_a: db.top_a,
        openrouterProvider: db.openrouterProvider,
        useInstructPrompt: db.useInstructPrompt,
        customPromptTemplateToggle: db.customPromptTemplateToggle ?? '',
        templateDefaultVariables: db.templateDefaultVariables ?? '',
        moduleIntergration: db.moduleIntergration ?? '',
        top_k: db.top_k,
        instructChatTemplate: db.instructChatTemplate,
        JinjaTemplate: db.JinjaTemplate ?? '',
        jsonSchemaEnabled: db.jsonSchemaEnabled ?? false,
        jsonSchema: db.jsonSchema ?? '',
        strictJsonSchema: db.strictJsonSchema ?? true,
        extractJson: db.extractJson ?? '',
        groupOtherBotRole: db.groupOtherBotRole ?? 'user',
        groupTemplate: db.groupTemplate ?? '',
        seperateParametersEnabled: db.seperateParametersEnabled ?? false,
        seperateParameters: structuredClone(db.seperateParameters),
        customAPIFormat: structuredClone(db.customAPIFormat),
        systemContentReplacement: db.systemContentReplacement,
        systemRoleReplacement: db.systemRoleReplacement,
        customFlags: structuredClone(db.customFlags),
        enableCustomFlags: db.enableCustomFlags,
        regex: db.presetRegex,
        image: pres?.[db.botPresetsId]?.image ?? '',
        reasonEffort: db.reasoningEffort ?? 0,
        thinkingTokens: db.thinkingTokens ?? null,
        thinkingType: db.thinkingType ?? 'budget',
        deepseekThinkingType: db.deepseekThinkingType ?? 'off',
        adaptiveThinkingEffort: db.adaptiveThinkingEffort ?? 'high',
        deepseekReasoningEffort: db.deepseekReasoningEffort ?? 'high',
        outputImageModal: db.outputImageModal ?? false,
        seperateModelsForAxModels: db.doNotChangeSeperateModels ? false : db.seperateModelsForAxModels ?? false,
        seperateModels: db.doNotChangeSeperateModels ? null : structuredClone(db.seperateModels),
        modelTools: structuredClone(db.modelTools),
        fallbackModels: structuredClone(db.fallbackModels),
        fallbackWhenBlankResponse: db.fallbackWhenBlankResponse ?? false,
        verbosity: db.verbosity ?? 1,
        dynamicOutput: db.dynamicOutput ?? null,
    } as botPreset
    if (db.botPresetsId >= pres.length) {
        pres.push(saved)
    }
    else {
        pres[db.botPresetsId] = saved
    }
    db.botPresets = pres
}

/** Upstream `changeToPreset` (database.svelte.ts:2190-2198). */
export function upstreamChangeToPreset(db: StoredDatabase, id = 0, saveCurrent = true): void {
    if (saveCurrent) {
        upstreamSaveCurrentPreset(db)
    }
    db.botPresetsId = id
    setPreset(db, db.botPresets[id])
}

/** Upstream `copyPreset` (database.svelte.ts:2182-2188): the clone keeps every key of its source, meta included. */
export function upstreamCopyPreset(db: StoredDatabase, id: number): void {
    upstreamSaveCurrentPreset(db)
    const copy = structuredClone(db.botPresets[id])
    copy.name += ' Copy'
    db.botPresets.push(copy)
}

/** Upstream `movePreset` (botpreset.svelte:28-49), including its `botPresetsId` adjustment. */
export function upstreamMovePreset(db: StoredDatabase, fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) return
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= db.botPresets.length || toIndex > db.botPresets.length) return
    const list = [...db.botPresets]
    const moved = list.splice(fromIndex, 1)[0]
    if (!moved) return
    const adjustedToIndex = fromIndex < toIndex ? toIndex - 1 : toIndex
    list.splice(adjustedToIndex, 0, moved)
    const currentId = db.botPresetsId
    if (currentId === fromIndex) {
        db.botPresetsId = adjustedToIndex
    } else if (fromIndex < currentId && adjustedToIndex >= currentId) {
        db.botPresetsId = currentId - 1
    } else if (fromIndex > currentId && adjustedToIndex <= currentId) {
        db.botPresetsId = currentId + 1
    }
    db.botPresets = list
}

/** Upstream preset delete (botpreset.svelte:250-256): `changeToPreset(0)`, splice, then `changeToPreset(0, false)`. */
export function upstreamDeletePreset(db: StoredDatabase, index: number): void {
    upstreamChangeToPreset(db, 0)
    db.botPresets.splice(index, 1)
    upstreamChangeToPreset(db, 0, false)
}

/**
 * The parts of upstream `setDatabase` the preset, hotkey and loadout data meet (database.svelte.ts:490-520, 631-645,
 * 709): the in-place per-entry normalisation of the local-network fields, the hotkey merge by action that keeps unknown
 * rows, and `loadouts ??= []`. The default-list seeding and the per-entry `promptTemplate` and `openrouterProvider`
 * normalisation are not transcribed; neither touches the preset meta.
 */
export function upstreamSetDatabaseSubset(db: StoredDatabase): void {
    for (const preset of db.botPresets) {
        preset.localNetworkMode ??= false
        preset.localNetworkTimeoutSec ??= 600
        if (typeof preset.localNetworkMode !== 'boolean') {
            preset.localNetworkMode = false
        }
        if (typeof preset.localNetworkTimeoutSec !== 'number' || Number.isNaN(preset.localNetworkTimeoutSec)) {
            preset.localNetworkTimeoutSec = 600
        }
    }
    if (!db.hotkeys) {
        db.hotkeys = structuredClone(UPSTREAM_DEFAULT_HOTKEYS)
    } else {
        const existing = new Set(db.hotkeys.map((hotkey) => hotkey.action))
        const missing = UPSTREAM_DEFAULT_HOTKEYS.filter((hotkey) => !existing.has(hotkey.action))
        if (missing.length > 0) {
            db.hotkeys.push(...structuredClone(missing))
        }
    }
    db.loadouts ??= []
}

export type UpstreamCtrlDigit = { kind: 'action', action: string } | { kind: 'preset', index: number } | { kind: 'none' }

/**
 * What upstream's keydown does for Ctrl+`digit` (hotkey.ts:28-34, 164-179 for the rows loop, then the index block at
 * :182-233 and :429-436): a row of a known action that matches wins; an unknown action runs nothing and the loop goes on;
 * then Ctrl+n selects index n-1 when the list is long enough.
 */
export function upstreamCtrlDigitTarget(db: Pick<StoredDatabase, 'hotkeys' | 'botPresets'>, digit: number): UpstreamCtrlDigit {
    for (const hotkey of db.hotkeys) {
        const matches = hotkey.key === String(digit) && !!hotkey.ctrl && !hotkey.alt && !hotkey.shift
        if (matches && UPSTREAM_KNOWN_HOTKEY_ACTIONS.includes(hotkey.action)) {
            return { kind: 'action', action: hotkey.action }
        }
    }
    if (db.botPresets.length > digit - 1) {
        return { kind: 'preset', index: digit - 1 }
    }
    return { kind: 'none' }
}

/** Upstream loadout apply (loadout.ts:61): the first preset whose name equals `presetName`, or -1. */
export function upstreamLoadoutTarget(db: Pick<StoredDatabase, 'botPresets'>, loadout: { presetName: string }): number {
    return db.botPresets.findIndex((preset) => preset.name === loadout.presetName)
}

/** Upstream preset chain (process/index.svelte.ts:226-228): the first preset whose name equals `name`, or -1. */
export function upstreamChainTarget(db: Pick<StoredDatabase, 'botPresets'>, name: string): number {
    return db.botPresets.findIndex((preset) => preset.name === name)
}

/**
 * Upstream re-export of the database (backuplocal.ts:164, 176 and 384-388: `encodeRisuSave(db, { compression: true, kv })`,
 * block format). The fork's own writer of the same format is `writeRisuSaveV0` (its backuplocal.ts export), so the
 * re-encoded bytes are what an upstream export of the same tree holds.
 */
export function upstreamReexport(tree: StoredDatabase): Uint8Array {
    const { upstreamKvBlocks: kv, ...rest } = tree
    return writeRisuSaveV0(rest, kv ?? {})
}
