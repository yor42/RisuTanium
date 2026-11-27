// What the classic trigger editors write when a user switches the trigger mode, adds an event, a V1 row, a V1
// condition or effect, or changes the type of a V1 condition or effect: the same keys in the same order, and a
// fresh object on every call. A type change keeps nothing of the old element, the keys it does not know included.
// Pure: no DBState, no I/O, and `process/triggers` is imported as a type only.
import type { triggerscript, triggerCondition, triggerConditionsVar, triggerEffectV1 } from '../../process/triggers'

export type TriggerListMode = 'v1' | 'v2' | 'lua'

/** The list a mode switch writes: V1 an empty list, V2 the header row and a first event, Lua one start row. */
export function modeTemplate(mode: TriggerListMode): triggerscript[] {
    if (mode === 'v1') return []
    if (mode === 'lua') {
        return [{
            comment: '',
            type: 'start',
            conditions: [],
            effect: [{
                type: 'triggerlua',
                code: '',
            }],
        }]
    }
    return [{
        comment: '',
        type: 'manual',
        conditions: [],
        effect: [{
            type: 'v2Header',
            code: '',
            indent: 0,
        }],
    }, {
        comment: 'New Event',
        type: 'manual',
        conditions: [],
        effect: [],
    }]
}

/** The event the V2 editor's add button appends. */
export function v2EventTemplate(): triggerscript {
    return {
        comment: '',
        type: 'manual',
        conditions: [],
        effect: [],
    }
}

/** The row the V1 editor's add button appends. */
export function v1RowTemplate(): triggerscript {
    return {
        comment: '',
        type: 'start',
        conditions: [],
        effect: [],
    }
}

/** The condition a V1 row's condition add button appends. */
export function v1ConditionTemplate(): triggerConditionsVar {
    return {
        type: 'value',
        value: '',
        operator: 'true',
        var: '',
    }
}

/** The effect a V1 row's effect add button appends: a start row gets a system prompt, every other row a variable set. */
export function v1EffectTemplate(rowType: triggerscript['type']): triggerEffectV1 {
    if (rowType === 'start') {
        return {
            type: 'systemprompt',
            value: '',
            location: 'historyend',
        }
    }
    return {
        type: 'setvar',
        var: '',
        value: '',
        operator: '=',
    }
}

/** The condition that replaces a condition whose type select was changed to `type`. */
export function v1ConditionTypeTemplate(type: triggerCondition['type']): triggerCondition {
    if (type === 'exists') {
        return {
            type: 'exists',
            value: '',
            type2: 'loose',
            depth: 3,
        }
    }
    if (type === 'chatindex') {
        return {
            type: 'chatindex',
            value: '',
            operator: '=',
        }
    }
    return {
        type,
        var: '',
        value: '',
        operator: '=',
    }
}

/** The effect that replaces an effect whose type select was changed to `type`. */
export function v1EffectTypeTemplate(type: triggerEffectV1['type']): triggerEffectV1 {
    switch (type) {
        case 'systemprompt':
            return { type: 'systemprompt', value: '', location: 'historyend' }
        case 'setvar':
            return { type: 'setvar', var: '', value: '', operator: '=' }
        case 'impersonate':
            return { type: 'impersonate', role: 'char', value: '' }
        case 'command':
            return { type: 'command', value: '' }
        case 'stop':
            return { type: 'stop' }
        case 'runtrigger':
            return { type: 'runtrigger', value: '' }
        case 'runLLM':
            return { type: 'runLLM', value: '', inputVar: '' }
        case 'checkSimilarity':
            return { type: 'checkSimilarity', source: '', value: '', inputVar: '' }
        case 'showAlert':
            return { type: 'showAlert', alertType: 'normal', value: '', inputVar: '' }
        case 'extractRegex':
            return { type: 'extractRegex', value: '', regex: '', flags: '', inputVar: '', result: '' }
        case 'runImgGen':
            return { type: 'runImgGen', value: '', negValue: '', inputVar: '' }
        case 'sendAIprompt':
            return { type: 'sendAIprompt' }
        case 'cutchat':
            return { type: 'cutchat', start: '', end: '' }
        case 'modifychat':
            return { type: 'modifychat', value: '', index: '' }
        case 'runAxLLM':
            return { type: 'runAxLLM', value: '', inputVar: '' }
    }
}
