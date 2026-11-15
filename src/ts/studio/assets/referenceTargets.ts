// The places a merge or a "used in" scan reads: the registry of an owner's text fields and the enumerator over it.
// Pure: property reads only, no DBState, no I/O. A target is `{ path, text }`; the path is stable for as long as
// the owner's lists keep their order (`desc`, `alternateGreetings/2`, `lore/3/content`, `regex/2/out`,
// `trigger/0/effect/1/value`), and the order of the enumeration is the registry order, then the index.
//
// A target is rewritable (the merge may edit it), flag-only (scanned and listed, never edited) or excluded
// (neither scanned nor counted). Trigger fields are classified one by one, and a conditional field follows the
// mode its effect holds when it is enumerated: the same text can be rewritable in one mode and absent in another.
//
// Not scanned, on purpose: `postHistoryInstructions` (moved into the chat note on load), groups (their text is
// never asset-resolved), `group_only_greetings`, `customscript[].in` (a pattern, never a rendered reference),
// `onboarding`, `sdData`, `extentions`, `loreExt`, `notes`, `backgroundCSS`, `virtualscript`, `nickname`.

import type { triggerEffectV2 } from '../../process/triggers'

export type TargetClass = 'rewritable' | 'flagOnly'

export interface TargetPair {
    path: string
    text: string
}

export interface ClassifiedTarget extends TargetPair {
    cls: TargetClass
}

export interface LoreEntryLike {
    readonly content?: string
}

export interface RegexScriptLike {
    readonly out?: string
}

/** A trigger list entry as far as the registry reads it. The real `triggerscript` is assignable. */
export interface TriggerListLike {
    /** The container's own name and mode are never scanned. */
    readonly comment?: string
    readonly type?: string
    readonly conditions?: readonly object[]
    readonly effect?: readonly object[]
}

export interface CharacterTargetFields {
    /** `'group'` marks a group, whose text is never asset-resolved: a group is not a character owner. */
    readonly type?: string
    readonly desc?: string
    readonly firstMessage?: string
    readonly alternateGreetings?: readonly string[]
    readonly systemPrompt?: string
    readonly replaceGlobalNote?: string
    readonly additionalText?: string
    readonly personality?: string
    readonly scenario?: string
    readonly exampleMessage?: string
    readonly depth_prompt?: { readonly prompt?: string }
    readonly newGenData?: {
        readonly prompt?: string
        readonly negative?: string
        readonly instructions?: string
        readonly emotionInstructions?: string
    }
    readonly backgroundHTML?: string
    readonly defaultVariables?: string
    readonly translatorNote?: string
    readonly creatorNotes?: string
    readonly globalLore?: readonly LoreEntryLike[]
    readonly customscript?: readonly RegexScriptLike[]
    readonly triggerscript?: readonly TriggerListLike[]
    readonly additionalAssets?: readonly (readonly [string, ...string[]])[]
    readonly emotionImages?: readonly (readonly [string, ...string[]])[]
    readonly extentions?: Readonly<Record<string, unknown>>
}

export interface ModuleTargetFields {
    readonly lorebook?: readonly LoreEntryLike[]
    readonly regex?: readonly RegexScriptLike[]
    readonly trigger?: readonly TriggerListLike[]
    readonly backgroundEmbedding?: string
    readonly cjs?: string
    readonly assets?: readonly (readonly [string, ...string[]])[]
    /** The folder document, stored under its fork-prefixed key (`ASSET_FOLDER_KEY`). */
    readonly risutanium_asset_folders?: unknown
}

export type TargetOwner =
    | { kind: 'character', source: CharacterTargetFields }
    | { kind: 'module', source: ModuleTargetFields }

type FieldClass = 'rewritable' | 'flagOnly' | 'excluded'

const V1_EFFECT_TYPES: ReadonlySet<string> = new Set([
    'cutchat', 'modifychat', 'runImgGen', 'extractRegex', 'runLLM', 'checkSimilarity', 'sendAIprompt', 'showAlert',
    'setvar', 'systemprompt', 'impersonate', 'command', 'stop', 'runtrigger', 'runAxLLM',
])

const KNOWN_V2_TYPES: readonly triggerEffectV2['type'][] = [
    'v2Header', 'v2If', 'v2Else', 'v2EndIndent', 'v2SetVar', 'v2Loop', 'v2LoopNTimes', 'v2BreakLoop', 'v2RunTrigger',
    'v2ConsoleLog', 'v2StopTrigger', 'v2CutChat', 'v2ModifyChat', 'v2SystemPrompt', 'v2Impersonate', 'v2Command',
    'v2SendAIprompt', 'v2ImgGen', 'v2CheckSimilarity', 'v2RunLLM', 'v2ShowAlert', 'v2ExtractRegex', 'v2GetLastMessage',
    'v2GetMessageAtIndex', 'v2GetMessageCount', 'v2ModifyLorebook', 'v2GetLorebook', 'v2GetLorebookCount',
    'v2GetLorebookEntry', 'v2SetLorebookActivation', 'v2GetLorebookIndexViaName', 'v2Random', 'v2GetCharAt',
    'v2GetCharCount', 'v2ToLowerCase', 'v2ToUpperCase', 'v2SetCharAt', 'v2SplitString', 'v2JoinArrayVar',
    'v2GetCharacterDesc', 'v2SetCharacterDesc', 'v2GetPersonaDesc', 'v2SetPersonaDesc', 'v2MakeArrayVar',
    'v2GetArrayVarLength', 'v2GetArrayVar', 'v2SetArrayVar', 'v2PushArrayVar', 'v2PopArrayVar', 'v2ShiftArrayVar',
    'v2UnshiftArrayVar', 'v2SpliceArrayVar', 'v2SliceArrayVar', 'v2GetIndexOfValueInArrayVar',
    'v2RemoveIndexFromArrayVar', 'v2ConcatString', 'v2GetLastUserMessage', 'v2GetLastCharMessage',
    'v2GetFirstMessage', 'v2GetAlertInput', 'v2GetDisplayState', 'v2SetDisplayState', 'v2GetRequestState',
    'v2GetRequestStateRole', 'v2SetRequestState', 'v2SetRequestStateRole', 'v2GetRequestStateLength', 'v2UpdateGUI',
    'v2UpdateChatAt', 'v2Wait', 'v2IfAdvanced', 'v2QuickSearchChat', 'v2StopPromptSending', 'v2Tokenize',
    'v2GetAllLorebooks', 'v2RegexTest', 'v2GetLorebookByName', 'v2GetLorebookByIndex', 'v2CreateLorebook',
    'v2ModifyLorebookByIndex', 'v2DeleteLorebookByIndex', 'v2GetLorebookCountNew', 'v2SetLorebookAlwaysActive',
    'v2GetAlertSelect', 'v2GetReplaceGlobalNote', 'v2SetReplaceGlobalNote', 'v2GetAuthorNote', 'v2SetAuthorNote',
    'v2MakeDictVar', 'v2GetDictVar', 'v2SetDictVar', 'v2DeleteDictKey', 'v2HasDictKey', 'v2ClearDict',
    'v2GetDictSize', 'v2GetDictKeys', 'v2GetDictValues', 'v2Calculate', 'v2ReplaceString', 'v2Comment',
    'v2DeclareLocalVar',
]
const KNOWN_V2: ReadonlySet<string> = new Set(KNOWN_V2_TYPES)

const V1_REWRITABLE: ReadonlySet<string> = new Set([
    'setvar.value', 'systemprompt.value', 'impersonate.value', 'command.value', 'modifychat.value', 'showAlert.value',
    'runLLM.value', 'runAxLLM.value', 'checkSimilarity.source', 'checkSimilarity.value', 'runImgGen.value',
    'runImgGen.negValue', 'extractRegex.value',
])

/** An unparsed `$`-template or a pattern: listed, never edited. */
const V1_FLAG_ONLY: ReadonlySet<string> = new Set(['extractRegex.regex', 'extractRegex.result'])

const V1_EXCLUDED_FIELDS: ReadonlySet<string> = new Set([
    'inputVar', 'var', 'location', 'role', 'alertType', 'operator',
])

const V1_EXCLUDED: ReadonlySet<string> = new Set([
    'runtrigger.value', 'cutchat.start', 'cutchat.end', 'modifychat.index', 'extractRegex.flags',
])

/** v2 fields the executor never reads as text, or reads as a name, a number or an enum. */
const V2_EXCLUDED: ReadonlySet<string> = new Set([
    'v2Header.code', 'v2Comment.value', 'v2If.source', 'v2RunTrigger.target', 'v2UpdateChatAt.index',
    'v2ModifyLorebook.target', 'v2GetLorebook.target', 'v2GetLorebookIndexViaName.name',
    'v2SetDictVar.var', 'v2DeleteDictKey.var',
    'v2Wait.value', 'v2LoopNTimes.value', 'v2SetRequestStateRole.value',
])

const V2_NUMERIC_FIELDS: ReadonlySet<string> = new Set([
    'index', 'start', 'end', 'min', 'max', 'depth', 'insertOrder', 'flags',
])

/** Flag-only in value mode, excluded in var mode: a pattern, an expression, a lookup or a JSON operand. */
const V2_FLAG_IN_VALUE_MODE: ReadonlySet<string> = new Set([
    'v2ExtractRegex.regex', 'v2RegexTest.regex', 'v2ReplaceString.regex', 'v2Calculate.expression',
    'v2GetLorebookByName.name',
    'v2JoinArrayVar.var', 'v2GetDictVar.var', 'v2HasDictKey.var', 'v2GetDictSize.var', 'v2GetDictKeys.var',
    'v2GetDictValues.var',
])

function valueOfMode(mode: unknown): 'value' | 'var' | 'regex' | null {
    return mode === 'value' || mode === 'var' || mode === 'regex' ? mode : null
}

function v2FieldClass(effect: Readonly<Record<string, unknown>>, type: string, field: string): FieldClass {
    const typed = type + '.' + field
    if (V2_EXCLUDED.has(typed)) {
        return 'excluded'
    }
    if (V2_NUMERIC_FIELDS.has(field) || field === 'outputVar' || field === 'condition' || field.endsWith('Type')) {
        return 'excluded'
    }
    if (field === 'var' && !('varType' in effect)) {
        return 'excluded'
    }
    const mode = valueOfMode(effect[field + 'Type'])
    if (!KNOWN_V2.has(type)) {
        return 'flagOnly'
    }
    let flagInValueMode = V2_FLAG_IN_VALUE_MODE.has(typed)
    if (type === 'v2IfAdvanced') {
        const condition = effect.condition
        flagInValueMode = (field === 'target' && (condition === '∈' || condition === '∉'))
            || (field === 'source' && (condition === '∋' || condition === '∌'))
    } else if (type === 'v2QuickSearchChat' && field === 'value') {
        flagInValueMode = effect.condition === 'regex'
    }
    if (type === 'v2SplitString' && field === 'delimiter') {
        return mode === 'value' ? 'rewritable' : mode === 'var' ? 'excluded' : 'flagOnly'
    }
    if (flagInValueMode) {
        return mode === 'var' ? 'excluded' : 'flagOnly'
    }
    if (mode === 'value') {
        return 'rewritable'
    }
    return mode === 'var' ? 'excluded' : 'flagOnly'
}

function effectFieldClass(effect: Readonly<Record<string, unknown>>, field: string): FieldClass {
    const type = effect.type
    if (field === 'type' || field === 'operator') {
        return 'excluded'
    }
    if (typeof type !== 'string') {
        return 'flagOnly'
    }
    if (type === 'triggerlua' || type === 'triggercode') {
        // Script text builds names at run time and may hold any literal: listed, never edited.
        return 'flagOnly'
    }
    if (V1_EFFECT_TYPES.has(type)) {
        const typed = type + '.' + field
        if (V1_EXCLUDED.has(typed) || V1_EXCLUDED_FIELDS.has(field)) {
            return 'excluded'
        }
        if (V1_REWRITABLE.has(typed)) {
            return 'rewritable'
        }
        return 'flagOnly'
    }
    if (type.startsWith('v2')) {
        return v2FieldClass(effect, type, field)
    }
    return 'flagOnly'
}

function conditionFieldClass(condition: Readonly<Record<string, unknown>>, field: string): FieldClass {
    if (field === 'type' || field === 'operator' || field === 'type2') {
        return 'excluded'
    }
    const type = condition.type
    if (type === 'var') {
        return field === 'var' ? 'excluded' : field === 'value' ? 'rewritable' : 'flagOnly'
    }
    if (type === 'value') {
        return field === 'var' || field === 'value' ? 'rewritable' : 'flagOnly'
    }
    if (type === 'chatindex') {
        return field === 'value' ? 'excluded' : 'flagOnly'
    }
    if (type === 'exists') {
        if (field !== 'value') {
            return 'flagOnly'
        }
        return condition.type2 === 'regex' ? 'flagOnly' : condition.type2 === 'strict' || condition.type2 === 'loose' ? 'rewritable' : 'flagOnly'
    }
    return 'flagOnly'
}

/** A trigger entry's properties by name. Every field is read as `unknown` and narrowed by the caller. */
function fieldsOf(entry: object): Readonly<Record<string, unknown>> {
    return entry as Readonly<Record<string, unknown>>
}

function pushTriggerTargets(out: ClassifiedTarget[], lists: readonly TriggerListLike[] | undefined): void {
    if (!lists) {
        return
    }
    for (let i = 0; i < lists.length; i++) {
        const list = lists[i]
        const sections: ['conditions' | 'effect', readonly object[] | undefined, (entry: Readonly<Record<string, unknown>>, field: string) => FieldClass][] = [
            ['conditions', list.conditions, conditionFieldClass],
            ['effect', list.effect, effectFieldClass],
        ]
        for (const [section, entries, classify] of sections) {
            if (!entries) {
                continue
            }
            for (let j = 0; j < entries.length; j++) {
                const entry = fieldsOf(entries[j])
                for (const field of Object.keys(entry)) {
                    const value = entry[field]
                    if (typeof value !== 'string') {
                        continue
                    }
                    const cls = classify(entry, field)
                    if (cls !== 'excluded') {
                        out.push({ path: 'trigger/' + i + '/' + section + '/' + j + '/' + field, text: value, cls })
                    }
                }
            }
        }
    }
}

function pushText(out: ClassifiedTarget[], path: string, text: unknown, cls: TargetClass = 'rewritable'): void {
    if (typeof text === 'string') {
        out.push({ path, text, cls })
    }
}

function pushLoreAndRegex(
    out: ClassifiedTarget[],
    lore: readonly LoreEntryLike[] | undefined,
    regex: readonly RegexScriptLike[] | undefined,
): void {
    if (lore) {
        for (let i = 0; i < lore.length; i++) {
            pushText(out, 'lore/' + i + '/content', lore[i].content)
        }
    }
    if (regex) {
        for (let i = 0; i < regex.length; i++) {
            pushText(out, 'regex/' + i + '/out', regex[i].out)
        }
    }
}

/** A group is not an asset owner; the type allows it through, so callers are refused at run time. */
export function assertAssetOwner(owner: TargetOwner): void {
    if (owner.kind === 'character' && owner.source.type === 'group') {
        throw new TypeError('A group is not an asset owner')
    }
}

/**
 * Every scanned text of the owner with its class, in registry order. Reads properties only; the result is a fresh
 * array of fresh objects. The class is part of the answer because the same text can change class (a trigger field
 * whose mode switches) without changing.
 */
export function enumerateClassifiedTargets(owner: TargetOwner): ClassifiedTarget[] {
    assertAssetOwner(owner)
    const out: ClassifiedTarget[] = []
    if (owner.kind === 'character') {
        const c = owner.source
        pushText(out, 'desc', c.desc)
        pushText(out, 'firstMessage', c.firstMessage)
        if (c.alternateGreetings) {
            for (let i = 0; i < c.alternateGreetings.length; i++) {
                pushText(out, 'alternateGreetings/' + i, c.alternateGreetings[i])
            }
        }
        pushText(out, 'systemPrompt', c.systemPrompt)
        pushText(out, 'replaceGlobalNote', c.replaceGlobalNote)
        pushText(out, 'additionalText', c.additionalText)
        pushText(out, 'personality', c.personality)
        pushText(out, 'scenario', c.scenario)
        pushText(out, 'exampleMessage', c.exampleMessage)
        pushText(out, 'depth_prompt/prompt', c.depth_prompt?.prompt)
        pushText(out, 'newGenData/prompt', c.newGenData?.prompt)
        pushText(out, 'newGenData/negative', c.newGenData?.negative)
        pushText(out, 'newGenData/instructions', c.newGenData?.instructions)
        pushText(out, 'newGenData/emotionInstructions', c.newGenData?.emotionInstructions)
        pushText(out, 'backgroundHTML', c.backgroundHTML)
        pushText(out, 'defaultVariables', c.defaultVariables)
        pushText(out, 'translatorNote', c.translatorNote)
        pushText(out, 'creatorNotes', c.creatorNotes)
        pushLoreAndRegex(out, c.globalLore, c.customscript)
        pushTriggerTargets(out, c.triggerscript)
    } else {
        const m = owner.source
        pushLoreAndRegex(out, m.lorebook, m.regex)
        pushTriggerTargets(out, m.trigger)
        pushText(out, 'backgroundEmbedding', m.backgroundEmbedding)
        pushText(out, 'cjs', m.cjs, 'flagOnly')
    }
    return out
}

/** The `{ path, text }` pairs of the owner. Two enumerations of equal content at equal paths are equal. */
export function enumerateTargets(owner: TargetOwner): TargetPair[] {
    return enumerateClassifiedTargets(owner).map(({ path, text }) => ({ path, text }))
}

// ---------------------------------------------------------------- addressing a registry path

/** The shape every stored text target must have: `/`-separated segments of letters, digits and underscores. */
export const TEXT_TARGET = /^[A-Za-z0-9_]+(\/[A-Za-z0-9_]+)*$/

/** The top-level text fields a character registry path names. */
export const CHARACTER_TEXT_FIELDS = [
    'desc', 'firstMessage', 'exampleMessage', 'systemPrompt', 'replaceGlobalNote', 'additionalText', 'personality',
    'scenario', 'backgroundHTML', 'defaultVariables', 'translatorNote', 'creatorNotes',
] as const

export type CharacterTextField = (typeof CHARACTER_TEXT_FIELDS)[number]

const MODULE_TEXT_FIELDS: readonly string[] = ['backgroundEmbedding', 'cjs']

const NESTED_TEXT_FIELDS: Readonly<Record<'depth_prompt' | 'newGenData', readonly string[]>> = {
    depth_prompt: ['prompt'],
    newGenData: ['prompt', 'negative', 'instructions', 'emotionInstructions'],
}

const INDEX_SEGMENT = /^(0|[1-9][0-9]*)$/

/** A registry path as the pieces that address it. Every index is canonical decimal. */
export type TargetPath =
    | { field: string }
    | { nested: 'depth_prompt' | 'newGenData'; field: string }
    | { entry: 'lore' | 'regex'; index: number; field: string }
    | { trigger: number; section: 'conditions' | 'effect'; entry: number; field: string }
    | { greeting: number }

export type TriggerTargetPath = Extract<TargetPath, { trigger: number }>

function indexOf(segment: string): number | null {
    if (!INDEX_SEGMENT.test(segment)) {
        return null
    }
    const index = Number(segment)
    return Number.isSafeInteger(index) ? index : null
}

/**
 * The one parse of a registry path for an owner kind: null for anything that is not an address of that kind (a path
 * failing the stored shape, a `__proto__` segment, a non-canonical index, an unknown field). A parsed path says where
 * a text would live, not that it exists or may be edited: the resolver decides that against the owner.
 */
export function parseTargetPath(kind: TargetOwner['kind'], path: string): TargetPath | null {
    if (!TEXT_TARGET.test(path)) {
        return null
    }
    const parts = path.split('/')
    if (parts.includes('__proto__')) {
        return null
    }
    if (parts.length === 1) {
        const names: readonly string[] = kind === 'character' ? CHARACTER_TEXT_FIELDS : MODULE_TEXT_FIELDS
        return names.includes(parts[0]) ? { field: parts[0] } : null
    }
    if (parts.length === 2) {
        const [head, tail] = parts
        if (kind !== 'character') {
            return null
        }
        if (head === 'alternateGreetings') {
            const index = indexOf(tail)
            return index === null ? null : { greeting: index }
        }
        if (head === 'depth_prompt' || head === 'newGenData') {
            return NESTED_TEXT_FIELDS[head].includes(tail) ? { nested: head, field: tail } : null
        }
        return null
    }
    if (parts.length === 3) {
        const [head, indexText, field] = parts
        const index = indexOf(indexText)
        if (index === null) {
            return null
        }
        if (head === 'lore' && field === 'content') {
            return { entry: 'lore', index, field }
        }
        return head === 'regex' && field === 'out' ? { entry: 'regex', index, field } : null
    }
    if (parts.length === 5 && parts[0] === 'trigger') {
        const section = parts[2]
        const list = indexOf(parts[1])
        const entry = indexOf(parts[3])
        if ((section === 'conditions' || section === 'effect') && list !== null && entry !== null) {
            return { trigger: list, section, entry, field: parts[4] }
        }
    }
    return null
}

function stringAt(list: readonly unknown[] | undefined, index: number): string | null {
    if (!Array.isArray(list)) {
        return null
    }
    const value: unknown = list[index]
    return typeof value === 'string' ? value : null
}

function objectAt(list: readonly object[] | undefined, index: number): object | null {
    if (!Array.isArray(list)) {
        return null
    }
    const value: unknown = list[index]
    return typeof value === 'object' && value !== null ? value : null
}

function stringField(holder: object | null | undefined, field: string): string | null {
    if (!holder) {
        return null
    }
    const value = fieldsOf(holder)[field]
    return typeof value === 'string' ? value : null
}

function triggerTextAt(lists: readonly TriggerListLike[] | undefined, parsed: TriggerTargetPath): string | null {
    const list = objectAt(lists, parsed.trigger) as TriggerListLike | null
    if (!list) {
        return null
    }
    const entry = objectAt(parsed.section === 'conditions' ? list.conditions : list.effect, parsed.entry)
    if (!entry) {
        return null
    }
    const fields = fieldsOf(entry)
    // The enumerator reads own keys only, and classifies each field against the entry as it is now.
    if (!Object.prototype.hasOwnProperty.call(fields, parsed.field)) {
        return null
    }
    const value = fields[parsed.field]
    if (typeof value !== 'string') {
        return null
    }
    const cls = parsed.section === 'conditions' ? conditionFieldClass(fields, parsed.field) : effectFieldClass(fields, parsed.field)
    return cls === 'rewritable' ? value : null
}

/**
 * The text at `path` when the enumerator would list it as rewritable now, else null: a path outside the registry, a
 * missing entry or parent, a value that is not a string, a flag-only or excluded field (a trigger field is classified
 * against its entry as it is at this read), and every path of a group. Reads only the addressed entry.
 */
export function rewritableTextAt(owner: TargetOwner, path: string): string | null {
    if (owner.kind === 'character' && owner.source.type === 'group') {
        return null
    }
    const parsed = parseTargetPath(owner.kind, path)
    if (parsed === null) {
        return null
    }
    if (owner.kind === 'character') {
        const c = owner.source
        if ('greeting' in parsed) {
            return stringAt(c.alternateGreetings, parsed.greeting)
        }
        if ('trigger' in parsed) {
            return triggerTextAt(c.triggerscript, parsed)
        }
        if ('entry' in parsed) {
            return stringField(objectAt(parsed.entry === 'lore' ? c.globalLore : c.customscript, parsed.index), parsed.field)
        }
        if ('nested' in parsed) {
            return stringField(c[parsed.nested], parsed.field)
        }
        return stringField(c, parsed.field)
    }
    const m = owner.source
    if ('trigger' in parsed) {
        return triggerTextAt(m.trigger, parsed)
    }
    if ('entry' in parsed) {
        return stringField(objectAt(parsed.entry === 'lore' ? m.lorebook : m.regex, parsed.index), parsed.field)
    }
    // A module's `cjs` is flag-only: scanned, never edited.
    return 'field' in parsed && !('nested' in parsed) && parsed.field === 'backgroundEmbedding' ? stringField(m, parsed.field) : null
}
