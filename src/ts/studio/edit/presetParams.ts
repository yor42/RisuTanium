// Which model parameters the preset form shows, and which options each offers, for the preset's OWN model: classic's
// parameter items (botSettingsParamsData.ts) decide, evaluated with a context built from the edited preset instead of the
// working settings. Pure reads: nothing here writes, and changing a model never writes another field.

import { language } from '../../../lang'
import { getModelInfo } from '../../model/modellist'
import { resolveClaudeThinkingType, type ClaudeThinkingType } from '../../model/types'
import { allBasicParameterItems } from '../../setting/botSettingsParamsData'
import type { SegmentOption, SettingContext, SettingItem } from '../../setting/types'
import type { Database } from '../../storage/database.svelte'
import { DBState } from '../../stores.svelte'
import type { PresetPath } from './presetFields'
import { presetEffectiveModel, readPresetField } from './presetTarget'

// The classic parameter item each form row follows, in classic's order. The global seed is not a preset field.
const PARAM_PATH_OF_ITEM: Readonly<Record<string, PresetPath>> = {
    'params.maxContext': 'presetMaxContext',
    'params.maxResponse': 'presetMaxResponse',
    'params.thinkingType': 'presetThinkingType',
    'params.deepseekThinkingType': 'presetDeepseekThinkingType',
    'params.thinkingTokens': 'presetThinkingTokens',
    'params.adaptiveThinkingEffort': 'presetAdaptiveThinkingEffort',
    'params.deepseekReasoningEffort': 'presetDeepseekReasoningEffort',
    'params.temperature': 'presetTemperature',
    'params.topK': 'presetTopK',
    'params.minP': 'presetMinP',
    'params.topA': 'presetTopA',
    'params.repetitionPenalty': 'presetRepetitionPenalty',
    'params.reasoningEffort': 'presetReasonEffort',
    'params.verbosity': 'presetVerbosity',
    'params.topP': 'presetTopP',
    'params.frequencyPenalty': 'presetFrequencyPenalty',
    'params.presencePenalty': 'presetPresencePenalty',
}

export interface PresetParamRow {
    readonly path: PresetPath
    readonly item: SettingItem
}

export const PRESET_PARAM_ROWS: readonly PresetParamRow[] = allBasicParameterItems.flatMap((item) => {
    const path = PARAM_PATH_OF_ITEM[item.id]
    return path === undefined ? [] : [{ path, item }]
})

function pickOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return allowed.find((candidate) => candidate === value) ?? fallback
}

function textRead(id: string, path: PresetPath): string | null {
    const read = readPresetField(id, path)
    return read.had === true && typeof read.value === 'string' ? read.value : null
}

// The thinking type the preset's own stored value reads as: its constant default when the slot has none.
function storedThinkingType(id: string): ClaudeThinkingType {
    return pickOf(textRead(id, 'presetThinkingType'), ['off', 'budget', 'adaptive'], 'budget')
}

// What the request resolves the stored thinking type to for the preset's model; Studio shows it without writing it.
export function presetResolvedThinkingType(id: string): ClaudeThinkingType {
    const model = presetEffectiveModel(id)
    return resolveClaudeThinkingType(getModelInfo(model).flags, storedThinkingType(id))
}

// The context classic's conditions read: the preset's model and the three working values they look at, everything else
// as the working settings hold it. Null when the preset is gone.
export function presetParamContext(id: string): SettingContext | null {
    const model = presetEffectiveModel(id)
    if (model === null) {
        return null
    }
    const own = textRead(id, 'presetSubModel')
    const db: Database = {
        ...DBState.db,
        aiModel: model,
        subModel: own ?? DBState.db.subModel,
        thinkingType: storedThinkingType(id),
        deepseekThinkingType: pickOf(textRead(id, 'presetDeepseekThinkingType'), ['off', 'enabled'], 'off'),
    }
    const modelInfo = getModelInfo(model)
    return { db, modelInfo, subModelInfo: getModelInfo(db.subModel) }
}

// The rows classic would show for the preset's model, in classic's order.
export function visiblePresetParams(ctx: SettingContext): readonly PresetParamRow[] {
    return PRESET_PARAM_ROWS.filter((row) => row.item.condition === undefined || row.item.condition(ctx))
}

export interface PresetSegment {
    readonly value: string | number
    readonly label: string
}

function labelOf(option: SegmentOption): string {
    const table: Readonly<Record<string, unknown>> = language
    const translated = option.labelKey === undefined ? undefined : table[option.labelKey]
    return typeof translated === 'string' ? translated : (option.label ?? '')
}

// The options of a segmented row that classic offers for the preset's model.
export function presetSegments(item: SettingItem, ctx: SettingContext): readonly PresetSegment[] {
    return (item.options?.segmentOptions ?? [])
        .filter((option) => option.condition === undefined || option.condition(ctx))
        .map((option) => ({ value: option.value, label: labelOf(option) }))
}
