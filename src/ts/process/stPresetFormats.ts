import type { botPreset } from '../storage/database.svelte'
import type { PromptItem } from './prompt'
import type { OobaChatCompletionRequestParams } from '../model/ooba'

/**
 * Converter for SillyTavern preset files (instruct, context, system prompt,
 * text-completion presets, settings bundles) into one Risu bot preset.
 *
 * Pure: no I/O, store access, alert or language lookup. The caller passes the
 * preset to fill and decides how results and notices are shown.
 */

export type StKind = 'STCHAT' | 'PARAMETERS' | 'STCONTEXT' | 'STINST' | 'STSYSPROMPT' | 'STREASONING' | 'STSRW' | 'STBUNDLE'

export type StConvertResult =
    | { ok: true, preset: botPreset, skipped: string[] }
    | { ok: false, reason: 'conflict', withType: 'STINST' | 'STSYSPROMPT' }
    | { ok: false, reason: 'bundleAlone' }
    | { ok: false, reason: 'nothing' }

type JsonObject = Record<string, unknown>

export const OobaParams = [
    "tokenizer",
    "min_p",
    "top_k",
    "repetition_penalty",
    "repetition_penalty_range",
    "typical_p",
    "tfs",
    "top_a",
    "epsilon_cutoff",
    "eta_cutoff",
    "guidance_scale",
    "negative_prompt",
    "penalty_alpha",
    "mirostat_mode",
    "mirostat_tau",
    "mirostat_eta",
    "temperature_last",
    "do_sample",
    "seed",
    "encoder_repetition_penalty",
    "no_repeat_ngram_size",
    "min_length",
    "num_beams",
    "length_penalty",
    "early_stopping",
    "truncation_length",
    "max_tokens_second",
    "custom_token_bans",
    "auto_max_new_tokens",
    "ban_eos_token",
    "add_bos_token",
    "skip_special_tokens",
    "grammar_string"
]

//#region detection

function isObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSet(value: unknown): boolean {
    return value !== null && value !== undefined
}

function hasOwn(obj: JsonObject, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(obj, key)
}

// Present in every Risu preset; a file carrying one is a Risu preset, never an ST file.
const risuPresetKeys = ['mainPrompt', 'jailbreak', 'formatingOrder', 'aiModel', 'apiType']

function isInstructShape(o: JsonObject): boolean {
    return typeof o.input_sequence === 'string' && typeof o.output_sequence === 'string'
}

function isContextShape(o: JsonObject): boolean {
    return typeof o.story_string === 'string'
}

function isSyspromptShape(o: JsonObject): boolean {
    return typeof o.name === 'string' && typeof o.content === 'string'
        && (o.post_history === undefined || typeof o.post_history === 'string')
}

function isParametersTier1(o: JsonObject): boolean {
    return isSet(o.temp) && isSet(o.rep_pen) && isSet(o.min_length)
}

function isParametersTier2(o: JsonObject): boolean {
    return isSet(o.temp) && isSet(o.rep_pen) && isSet(o.top_k) && isSet(o.top_p)
}

function isReasoningShape(o: JsonObject): boolean {
    return typeof o.name === 'string' && typeof o.prefix === 'string'
        && typeof o.suffix === 'string' && typeof o.separator === 'string'
}

function isSrwShape(o: JsonObject): boolean {
    return hasOwn(o, 'value') && hasOwn(o, 'show')
}

const bundleSections: { key: string, label: string, test: (o: JsonObject) => boolean }[] = [
    { key: 'instruct', label: 'Instruct Template', test: isInstructShape },
    { key: 'context', label: 'Context Template', test: isContextShape },
    { key: 'sysprompt', label: 'System Prompt', test: isSyspromptShape },
    { key: 'preset', label: 'Text Completion Preset', test: o => isParametersTier1(o) || isParametersTier2(o) },
    { key: 'reasoning', label: 'Reasoning Formatting', test: isReasoningShape },
    { key: 'srw', label: 'Start Reply With', test: isSrwShape },
]

/**
 * Classifies a PARSED file (never a template-merged object).
 *
 * Tier 1 tests are the long-standing ones; the relaxed tier 2 tests come after
 * the instruct test so a file matching an earlier kind keeps its label.
 */
export function detectStKind(parsed: unknown): StKind | null {
    if(!isObject(parsed)){
        return null
    }
    if(risuPresetKeys.some(key => hasOwn(parsed, key))){
        return null
    }
    if(Array.isArray(parsed.prompts) && Array.isArray(parsed.prompt_order)){
        return 'STCHAT'
    }
    if(isParametersTier1(parsed)){
        return 'PARAMETERS'
    }
    if(typeof parsed.story_string === 'string' && isSet(parsed.chat_start)){
        return 'STCONTEXT'
    }
    if(isInstructShape(parsed)){
        return 'STINST'
    }
    if(isParametersTier2(parsed)){
        return 'PARAMETERS'
    }
    if(isContextShape(parsed)){
        return 'STCONTEXT'
    }
    if(isSyspromptShape(parsed)){
        return 'STSYSPROMPT'
    }
    if(isReasoningShape(parsed)){
        return 'STREASONING'
    }
    if(isSrwShape(parsed)){
        return 'STSRW'
    }
    for(const section of bundleSections){
        const value = parsed[section.key]
        if(isObject(value) && section.test(value)){
            return 'STBUNDLE'
        }
    }
    return null
}

//#endregion

//#region instruct template

const macroPattern = /\{\{(user|char|name)\}\}/gi

// The template engine rewrites its source text before tokenizing, quoted strings included:
// it removes `{# ... #}`, strips blanks before `{%`/`{#` at a line start (a line start follows
// \n, \r, U+2028 and U+2029) and joins whitespace around `-%}`, `-}}`, `{%-` and `{{-`.
// Splitting imported text at exactly those places keeps each piece inert.
const hazardSplit = /(?<=\{)(?=#)|(?<=\{[%{])(?=-)|(?<=-)(?=%\}|\}\})|(?<=[\p{Zl}\p{Zp}])/u

type Speaker = 'user' | 'assistant' | 'system'

function jinjaQuote(s: string): string {
    return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '\\r').replace(/\n/g, '\\n') + "'"
}

/** Text emitted as quoted pieces so it renders back verbatim and is never evaluated. */
export function jinjaLiteral(s: string): string {
    return s.split(hazardSplit).filter(p => p !== '').map(p => `{{ ${jinjaQuote(p)} }}`).join('')
}

/**
 * Literal text where `{{user}}`, `{{char}}` and `{{name}}` (any case, no inner blanks)
 * become expressions: `name` is the speaker of the branch, `System` in the system branch.
 */
export function jinjaText(s: string, speaker: Speaker): string {
    let out = ''
    let last = 0
    for(const m of s.matchAll(macroPattern)){
        out += jinjaLiteral(s.slice(last, m.index))
        const macro = m[1].toLowerCase()
        if(macro === 'name' && speaker === 'system'){
            out += "{{ 'System' }}"
        }
        else{
            const asUser = macro === 'name' ? speaker === 'user' : macro === 'user'
            out += asUser ? '{{ risu_user }}' : '{{ risu_char }}'
        }
        last = m.index + m[0].length
    }
    return out + jinjaLiteral(s.slice(last))
}

function text(value: unknown): string {
    return typeof value === 'string' ? value : ''
}

// Story strings are cleaned of every macro and conditional block before embedding.
function storyChain(story: string, systemPrompt: string): string {
    return story
        .replace(/{{user}}/gi, '{{risu_user}}')
        .replace(/{{user}}/gi, '{{risu_user}}')
        .replace(/{{system_prompt}}/gi, systemPrompt)
        .replace(/{{system}}/gi, systemPrompt)
        .replace(/{{#if (.+?){{\/if}}/gis, '')
        .replace(/{{(.+?)}}/gi, '')
        .replace(/\n\n+/g, '\n\n')
}

export function buildInstructJinja(inst: JsonObject, storyString: string, chatStart: string): string {
    const wrap = inst.wrap === true
    const inputSequence = text(inst.input_sequence)
    const outputSequence = text(inst.output_sequence)
    let systemPrefix = text(inst.system_sequence) + text(inst.system_sequence_prefix)
    let systemSuffix = text(inst.system_sequence_suffix) + text(inst.system_suffix)
    if(inst.system_same_as_user === true){
        systemPrefix = inputSequence
        systemSuffix = text(inst.input_suffix)
    }
    const seq = (s: string) => s !== '' && wrap ? s + '\n' : s
    const suf = (s: string) => s !== '' ? s : (wrap ? '\n' : '')
    const branch = (role: Speaker, prefix: string, suffix: string) =>
        `{% if message.role == '${role}' %}` + jinjaText(seq(prefix), role) + '{{ message.content }}' + jinjaText(suf(suffix), role) + '{% endif %}'

    return jinjaLiteral(storyChain(storyString, text(inst.system_prompt)))
        + jinjaLiteral(chatStart)
        + '{% for message in messages %}'
        + branch('user', inputSequence, text(inst.input_suffix))
        + branch('assistant', outputSequence, text(inst.output_suffix))
        + branch('system', systemPrefix, systemSuffix)
        + '{% endfor %}'
        + jinjaText(seq(outputSequence), 'assistant')
}

//#endregion

//#region conversion

/** Strips one trailing `.json` and nothing else. */
export function fileBaseName(name: string): string {
    return name.replace(/\.json$/i, '')
}

type PartKind = 'instruct' | 'context' | 'sysprompt' | 'params' | 'none'

interface Entry {
    label: string
    part: PartKind
    data: JsonObject
}

const standaloneEntry: Partial<Record<StKind, { label: string, part: PartKind }>> = {
    STINST: { label: 'Instruct Template', part: 'instruct' },
    STCONTEXT: { label: 'Context Template', part: 'context' },
    STSYSPROMPT: { label: 'System Prompt', part: 'sysprompt' },
    PARAMETERS: { label: 'Text Completion Preset', part: 'params' },
    STREASONING: { label: 'Reasoning Formatting', part: 'none' },
    STSRW: { label: 'Start Reply With', part: 'none' },
}

const bundlePart: Record<string, PartKind> = {
    instruct: 'instruct',
    context: 'context',
    sysprompt: 'sysprompt',
    preset: 'params',
}

function entriesOfBundle(bundle: JsonObject): Entry[] {
    const entries: Entry[] = []
    for(const key of Object.keys(bundle)){
        const section = bundleSections.find(s => s.key === key)
        if(!section){
            entries.push({ label: key, part: 'none', data: {} })
            continue
        }
        const value = bundle[key]
        const valid = isObject(value) && section.test(value)
        entries.push({
            label: section.label,
            part: valid ? (bundlePart[key] ?? 'none') : 'none',
            data: valid ? value : {},
        })
    }
    return entries
}

function byValue(source: JsonObject, keys: string[], multiplier: number): number {
    for(const key of keys){
        const value = source[key]
        if(typeof value === 'number' && Number.isFinite(value)){
            return value * multiplier
        }
    }
    return -1000
}

function applyParameters(preset: botPreset, data: JsonObject) {
    preset.temperature = byValue(data, ['temp'], 100)
    preset.top_p = byValue(data, ['top_p'], 1)
    preset.top_k = byValue(data, ['top_k'], 1)
    preset.top_a = byValue(data, ['top_a'], 1)
    preset.min_p = byValue(data, ['min_p'], 1)
    preset.repetition_penalty = byValue(data, ['rep_pen'], 1)
    preset.frequencyPenalty = byValue(data, ['freq_pen'], 100)
    preset.PresensePenalty = byValue(data, ['presence_pen', 'presence_penalty'], 100)

    const args: JsonObject = { mode: 'instruct' }
    for(const key of OobaParams){
        if(isSet(data[key])){
            args[key] = data[key]
        }
    }
    preset.reverseProxyOobaArgs = args as unknown as OobaChatCompletionRequestParams
}

function plainTemplate(mainText: string, postHistory: string): PromptItem[] {
    const items: PromptItem[] = [
        { type: 'plain', type2: 'main', text: mainText, role: 'system' },
        { type: 'description' },
        { type: 'persona' },
        { type: 'lorebook' },
        { type: 'chat', rangeStart: 0, rangeEnd: 'end' },
    ]
    if(postHistory !== ''){
        items.push({ type: 'plain', type2: 'normal', text: postHistory, role: 'system' })
    }
    items.push({ type: 'authornote' })
    items.push({ type: 'plain', type2: 'globalNote', text: '', role: 'system' })
    return items
}

/**
 * Builds ONE preset from the supported files (or the sections of one bundle).
 * `base` is filled in place of a fresh template; files of kind null are ignored.
 * Chat-completion files (STCHAT) only take part in conflict detection here.
 */
export function convertStFiles(files: { name: string, parsed: unknown }[], base: botPreset): StConvertResult {
    const supported = files
        .map(file => ({ name: file.name, parsed: file.parsed, kind: detectStKind(file.parsed) }))
        .filter(file => file.kind !== null)

    if(supported.some(file => file.kind === 'STBUNDLE') && supported.length > 1){
        return { ok: false, reason: 'bundleAlone' }
    }
    if(supported.some(file => file.kind === 'STCHAT')){
        if(supported.some(file => file.kind === 'STINST')){
            return { ok: false, reason: 'conflict', withType: 'STINST' }
        }
        if(supported.some(file => file.kind === 'STSYSPROMPT')){
            return { ok: false, reason: 'conflict', withType: 'STSYSPROMPT' }
        }
    }

    const entries: Entry[] = []
    for(const file of supported){
        if(!isObject(file.parsed) || file.kind === null){
            continue
        }
        if(file.kind === 'STBUNDLE'){
            entries.push(...entriesOfBundle(file.parsed))
            continue
        }
        const known = standaloneEntry[file.kind]
        if(known){
            entries.push({ label: known.label, part: known.part, data: file.parsed })
        }
    }

    // The first entry of each kind wins; later ones are ignored without notice.
    const parts = new Map<PartKind, JsonObject>()
    const counted: Entry[] = []
    for(const entry of entries){
        if(entry.part !== 'none'){
            if(parts.has(entry.part)){
                continue
            }
            parts.set(entry.part, entry.data)
        }
        counted.push(entry)
    }

    const instruct = parts.get('instruct')
    const context = parts.get('context')
    const sysprompt = parts.get('sysprompt')
    const params = parts.get('params')
    if(!instruct && !context && !sysprompt && !params){
        return { ok: false, reason: 'nothing' }
    }

    const skipped = counted
        .filter(entry => entry.part === 'none' || (entry.part === 'context' && !instruct))
        .map(entry => entry.label)

    const preset = base
    const firstName = supported[0] ? fileBaseName(supported[0].name) : ''
    preset.name = firstName !== '' ? firstName : 'Converted from JSON'

    const content = sysprompt ? text(sysprompt.content) : ''
    const postHistory = sysprompt ? text(sysprompt.post_history) : ''
    preset.promptTemplate = plainTemplate(content, postHistory)
    if(sysprompt){
        preset.mainPrompt = content
        preset.jailbreak = ''
    }

    if(params){
        applyParameters(preset, params)
    }

    if(instruct){
        preset.instructChatTemplate = 'jinja'
        preset.JinjaTemplate = buildInstructJinja(instruct, text(context?.story_string), text(context?.chat_start))
        preset.aiModel = 'openrouter'
        preset.subModel = 'openrouter'
        preset.useInstructPrompt = true
    }

    return { ok: true, preset, skipped }
}

//#endregion
