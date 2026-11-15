import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { enumerateClassifiedTargets, enumerateTargets, parseTargetPath, rewritableTextAt, type TargetClass, type TargetOwner } from './referenceTargets'
import { blankV2Triggers, characterOwner, luaTriggers, moduleOwner, v2Trigger } from './assetFixtures.test-helpers'

const REF = '{{image::smile}}'

/** The class of each enumerated field of one effect, by field name; an excluded field is absent. */
function effectClasses(effect: object, conditions: object[] = []): Record<string, TargetClass> {
    const owner = characterOwner({ triggerscript: [v2Trigger([effect], conditions)] })
    const out: Record<string, TargetClass> = {}
    for (const target of enumerateClassifiedTargets(owner)) {
        const match = /^trigger\/0\/effect\/0\/(.+)$/.exec(target.path)
        if (match) {
            out[match[1]] = target.cls
        }
    }
    return out
}

function conditionClasses(condition: object): Record<string, TargetClass> {
    const owner = characterOwner({ triggerscript: [v2Trigger([], [condition])] })
    const out: Record<string, TargetClass> = {}
    for (const target of enumerateClassifiedTargets(owner)) {
        const match = /^trigger\/0\/conditions\/0\/(.+)$/.exec(target.path)
        if (match) {
            out[match[1]] = target.cls
        }
    }
    return out
}

describe('character registry and paths', () => {
    test('lists every scanned character text with a stable path, in registry order', () => {
        const owner = characterOwner({
            desc: 'd',
            firstMessage: 'f',
            alternateGreetings: ['g0', 'g1', 'g2'],
            systemPrompt: 's',
            replaceGlobalNote: 'r',
            additionalText: 'a',
            personality: 'p',
            scenario: 'sc',
            exampleMessage: 'e',
            depth_prompt: { prompt: 'dp' },
            newGenData: { prompt: 'n1', negative: 'n2', instructions: 'n3', emotionInstructions: 'n4' },
            backgroundHTML: 'b',
            defaultVariables: 'dv',
            translatorNote: 'tn',
            creatorNotes: 'cn',
            globalLore: [{ content: 'l0' }, { content: 'l1' }],
            customscript: [{ out: 'o0' }],
        })
        expect(enumerateTargets(owner).map((pair) => pair.path)).toEqual([
            'desc', 'firstMessage', 'alternateGreetings/0', 'alternateGreetings/1', 'alternateGreetings/2',
            'systemPrompt', 'replaceGlobalNote', 'additionalText', 'personality', 'scenario', 'exampleMessage',
            'depth_prompt/prompt', 'newGenData/prompt', 'newGenData/negative', 'newGenData/instructions',
            'newGenData/emotionInstructions', 'backgroundHTML', 'defaultVariables', 'translatorNote', 'creatorNotes',
            'lore/0/content', 'lore/1/content', 'regex/0/out',
        ])
    })

    test('postHistoryInstructions, notes, regex patterns and lore keys are not scanned', () => {
        const owner = characterOwner({
            ...{ postHistoryInstructions: REF, notes: REF, backgroundCSS: REF, group_only_greetings: [REF] },
            globalLore: [{ content: 'x', ...{ key: REF, comment: REF } }],
            customscript: [{ out: 'x', ...{ in: REF, comment: REF } }],
        })
        expect(enumerateTargets(owner)).toEqual([
            { path: 'lore/0/content', text: 'x' },
            { path: 'regex/0/out', text: 'x' },
        ])
    })

    test('a module owner lists lorebook, regex, triggers and background embedding; cjs is scanned, not rewritten', () => {
        const owner = moduleOwner({
            lorebook: [{ content: 'l' }],
            regex: [{ out: 'o' }],
            trigger: luaTriggers('print(1)'),
            backgroundEmbedding: 'be',
            cjs: 'code',
        })
        expect(enumerateClassifiedTargets(owner)).toEqual([
            { path: 'lore/0/content', text: 'l', cls: 'rewritable' },
            { path: 'regex/0/out', text: 'o', cls: 'rewritable' },
            { path: 'trigger/0/effect/0/code', text: 'print(1)', cls: 'flagOnly' },
            { path: 'backgroundEmbedding', text: 'be', cls: 'rewritable' },
            { path: 'cjs', text: 'code', cls: 'flagOnly' },
        ])
    })

    test('a missing field and a non-string value are skipped, not listed as empty', () => {
        expect(enumerateTargets(characterOwner({}))).toEqual([])
        expect(enumerateTargets(characterOwner({ globalLore: [{}] }))).toEqual([])
    })
})

describe('the enumerator follows the content', () => {
    const lore = (...contents: string[]) => characterOwner({ globalLore: contents.map((content) => ({ content })) })

    test('equal content at the same paths gives an equal list, and the list is a fresh array', () => {
        const a = enumerateTargets(lore('one', 'two'))
        const b = enumerateTargets(lore('one', 'two'))
        expect(a).toEqual(b)
        expect(a).not.toBe(b)
    })

    test('appending, removing or swapping a lorebook entry changes the pair list', () => {
        const base = enumerateTargets(lore('one', 'two'))
        expect(enumerateTargets(lore('one', 'two', 'three'))).not.toEqual(base)
        expect(enumerateTargets(lore('one'))).not.toEqual(base)
        expect(enumerateTargets(lore('two', 'one'))).not.toEqual(base)
    })

    test('an appended empty entry still changes the list', () => {
        expect(enumerateTargets(lore('one', ''))).not.toEqual(enumerateTargets(lore('one')))
    })

    test('switching valueType from value to var changes the pair list; equal mode and text give an equal list', () => {
        const setVar = (valueType: string) => characterOwner({
            triggerscript: [v2Trigger([{ type: 'v2SetVar', operator: '=', var: 'x', valueType, value: REF, indent: 0 }])],
        })
        expect(enumerateTargets(setVar('value'))).toContainEqual({ path: 'trigger/0/effect/0/value', text: REF })
        expect(enumerateTargets(setVar('var'))).not.toContainEqual({ path: 'trigger/0/effect/0/value', text: REF })
        expect(enumerateTargets(setVar('value'))).not.toEqual(enumerateTargets(setVar('var')))
        expect(enumerateTargets(setVar('value'))).toEqual(enumerateTargets(setVar('value')))
    })

    test('the class changes with the mode even when the text does not', () => {
        const exists = (type2: string) => characterOwner({
            triggerscript: [v2Trigger([], [{ type: 'exists', value: REF, type2, depth: 3 }])],
        })
        expect(enumerateClassifiedTargets(exists('loose'))[0].cls).toBe('rewritable')
        expect(enumerateClassifiedTargets(exists('regex'))[0].cls).toBe('flagOnly')
        expect(enumerateTargets(exists('loose'))).toEqual(enumerateTargets(exists('regex')))
    })
})

describe('trigger table: the pair rule', () => {
    test('a value-mode text field of each listed effect is rewritable, and a var-mode field is absent', () => {
        const cases: [object, string][] = [
            [{ type: 'v2SetVar', operator: '=', var: 'x', valueType: 'value', value: REF, indent: 0 }, 'value'],
            [{ type: 'v2ModifyChat', index: '0', indexType: 'value', value: REF, valueType: 'value', indent: 0 }, 'value'],
            [{ type: 'v2SetDisplayState', value: REF, valueType: 'value', indent: 0 }, 'value'],
            [{ type: 'v2SetCharacterDesc', value: REF, valueType: 'value', indent: 0 }, 'value'],
            [{ type: 'v2CreateLorebook', name: 'n', nameType: 'value', key: 'k', keyType: 'value', content: REF, contentType: 'value', insertOrder: '1', insertOrderType: 'value', indent: 0 }, 'content'],
            [{ type: 'v2ReplaceString', source: 's', sourceType: 'value', regex: 'r', regexType: 'value', result: 'x', resultType: 'value', replacement: REF, replacementType: 'value', flags: 'g', flagsType: 'value', outputVar: 'o', indent: 0 }, 'replacement'],
            [{ type: 'v2GetAlertSelect', display: 'd', displayType: 'value', value: REF, valueType: 'value', outputVar: 'o', indent: 0 }, 'value'],
            [{ type: 'v2ModifyLorebook', target: 't', targetType: 'value', value: REF, valueType: 'value', indent: 0 }, 'value'],
        ]
        for (const [effect, field] of cases) {
            expect(effectClasses(effect)[field], String(Reflect.get(effect, 'type'))).toBe('rewritable')
            const asVar = { ...effect, [field + 'Type']: 'var' }
            expect(effectClasses(asVar)[field], String(Reflect.get(effect, 'type')) + ' in var mode').toBeUndefined()
        }
    })

    test('a field whose sibling mode is missing is flag-only, never rewritable', () => {
        expect(effectClasses({ type: 'v2SetVar', operator: '=', var: 'x', value: REF, indent: 0 }).value).toBe('flagOnly')
    })

    test('the discriminators and the container are never scanned', () => {
        const classes = effectClasses({ type: 'v2SetVar', operator: '=', var: 'smile', valueType: 'value', value: 'x', indent: 0 })
        expect(Object.keys(classes)).toEqual(['value'])
        const owner = characterOwner({ triggerscript: [v2Trigger([{ type: 'v2SetVar', valueType: 'value', value: 'x' }])] })
        expect(enumerateClassifiedTargets(owner).some((target) => target.path.split('/').length < 5)).toBe(false)
    })
})

describe('trigger table: flag-only fields', () => {
    test('patterns, expressions, lookups and JSON operands in value mode are flag-only', () => {
        const flagged: [object, string][] = [
            [{ type: 'v2ExtractRegex', value: 'v', valueType: 'value', regex: REF, regexType: 'value', flags: 'g', flagsType: 'value', result: 'r', resultType: 'value', outputVar: 'o', indent: 0 }, 'regex'],
            [{ type: 'v2RegexTest', value: 'v', valueType: 'value', regex: REF, regexType: 'value', flags: 'g', flagsType: 'value', outputVar: 'o', indent: 0 }, 'regex'],
            [{ type: 'v2ReplaceString', source: 's', sourceType: 'value', regex: REF, regexType: 'value', result: 'x', resultType: 'value', replacement: 'y', replacementType: 'value', flags: 'g', flagsType: 'value', outputVar: 'o', indent: 0 }, 'regex'],
            [{ type: 'v2Calculate', expression: REF, expressionType: 'value', outputVar: 'o', indent: 0 }, 'expression'],
            [{ type: 'v2GetLorebookByName', name: REF, nameType: 'value', outputVar: 'o', indent: 0 }, 'name'],
            [{ type: 'v2JoinArrayVar', var: REF, varType: 'value', delimiter: ',', delimiterType: 'value', outputVar: 'o', indent: 0 }, 'var'],
            [{ type: 'v2GetDictVar', var: REF, varType: 'value', key: 'k', keyType: 'value', outputVar: 'o', indent: 0 }, 'var'],
            [{ type: 'v2IfAdvanced', condition: '∈', targetType: 'value', target: REF, sourceType: 'var', source: 's', indent: 0 }, 'target'],
            [{ type: 'v2IfAdvanced', condition: '∋', targetType: 'var', target: 't', sourceType: 'value', source: REF, indent: 0 }, 'source'],
            [{ type: 'v2QuickSearchChat', value: REF, valueType: 'value', condition: 'regex', depth: '1', depthType: 'value', outputVar: 'o', indent: 0 }, 'value'],
            [{ type: 'v2SplitString', source: 's', sourceType: 'value', delimiter: REF, delimiterType: 'regex', outputVar: 'o', indent: 0 }, 'delimiter'],
            [{ type: 'v2Future', value: REF, valueType: 'value' }, 'value'],
            [{ type: 'v2SetVar', operator: '=', var: 'x', valueType: 'value', value: 'v', mystery: REF, indent: 0 }, 'mystery'],
            [{ type: 'extractRegex', value: 'v', regex: REF, flags: 'g', result: REF, inputVar: 'i' }, 'regex'],
            [{ type: 'extractRegex', value: 'v', regex: 'r', flags: 'g', result: REF, inputVar: 'i' }, 'result'],
            [{ type: 'triggerlua', code: REF }, 'code'],
            [{ type: 'triggercode', code: REF }, 'code'],
        ]
        for (const [effect, field] of flagged) {
            expect(effectClasses(effect)[field], String(Reflect.get(effect, 'type')) + '.' + field).toBe('flagOnly')
        }
    })

    test('the same fields in var mode are excluded, and the same conditional fields under other operators follow the pair rule', () => {
        expect(effectClasses({ type: 'v2Calculate', expression: REF, expressionType: 'var', outputVar: 'o', indent: 0 }).expression).toBeUndefined()
        expect(effectClasses({ type: 'v2JoinArrayVar', var: REF, varType: 'var', delimiter: ',', delimiterType: 'value', outputVar: 'o', indent: 0 }).var).toBeUndefined()
        expect(effectClasses({ type: 'v2IfAdvanced', condition: '=', targetType: 'value', target: REF, sourceType: 'value', source: REF, indent: 0 })).toEqual({ target: 'rewritable', source: 'rewritable' })
        expect(effectClasses({ type: 'v2QuickSearchChat', value: REF, valueType: 'value', condition: 'loose', depth: '1', depthType: 'value', outputVar: 'o', indent: 0 }).value).toBe('rewritable')
        expect(effectClasses({ type: 'v2SplitString', source: 's', sourceType: 'value', delimiter: REF, delimiterType: 'value', outputVar: 'o', indent: 0 }).delimiter).toBe('rewritable')
        expect(effectClasses({ type: 'v2SplitString', source: 's', sourceType: 'value', delimiter: REF, delimiterType: 'var', outputVar: 'o', indent: 0 }).delimiter).toBeUndefined()
    })
})

describe('trigger table: excluded fields', () => {
    test('names, numbers, outputs and dead lookups are not enumerated', () => {
        const excluded: [object, string][] = [
            [{ type: 'runtrigger', value: REF }, 'value'],
            [{ type: 'v2RunTrigger', target: REF, indent: 0 }, 'target'],
            [{ type: 'v2Header', code: REF, indent: 0 }, 'code'],
            [{ type: 'v2Comment', value: REF, indent: 0 }, 'value'],
            [{ type: 'v2GetLorebookIndexViaName', name: REF, nameType: 'value', outputVar: 'o', indent: 0 }, 'name'],
            [{ type: 'v2GetLorebook', target: REF, targetType: 'value', outputVar: 'o', indent: 0 }, 'target'],
            [{ type: 'v2ModifyLorebook', target: REF, targetType: 'value', value: 'v', valueType: 'value', indent: 0 }, 'target'],
            [{ type: 'v2SetDictVar', var: REF, varType: 'value', key: 'k', keyType: 'value', value: 'v', valueType: 'value', indent: 0 }, 'var'],
            [{ type: 'v2DeleteDictKey', var: REF, varType: 'value', key: 'k', keyType: 'value', indent: 0 }, 'var'],
            [{ type: 'v2Wait', value: REF, valueType: 'value', indent: 0 }, 'value'],
            [{ type: 'v2LoopNTimes', value: REF, valueType: 'value', indent: 0 }, 'value'],
            [{ type: 'v2SetRequestStateRole', value: REF, valueType: 'value', index: '0', indexType: 'value', indent: 0 }, 'value'],
            [{ type: 'v2GetRequestState', outputVar: REF, index: REF, indexType: 'value', indent: 0 }, 'outputVar'],
            [{ type: 'v2GetRequestState', outputVar: 'o', index: REF, indexType: 'value', indent: 0 }, 'index'],
            [{ type: 'v2SetVar', operator: '=', var: REF, valueType: 'value', value: 'v', indent: 0 }, 'var'],
            [{ type: 'v2If', condition: '=', targetType: 'value', target: 't', source: REF, indent: 0 }, 'source'],
            [{ type: 'v2UpdateChatAt', index: REF, indent: 0 }, 'index'],
            [{ type: 'cutchat', start: REF, end: REF }, 'start'],
            [{ type: 'modifychat', index: REF, value: 'v' }, 'index'],
            [{ type: 'extractRegex', value: 'v', regex: 'r', flags: REF, result: 'x', inputVar: REF }, 'flags'],
            [{ type: 'v2ExtractRegex', value: 'v', valueType: 'value', regex: 'r', regexType: 'value', flags: REF, flagsType: 'value', result: 'x', resultType: 'value', outputVar: 'o', indent: 0 }, 'flags'],
            [{ type: 'v2RegexTest', value: 'v', valueType: 'value', regex: 'r', regexType: 'value', flags: REF, flagsType: 'value', outputVar: 'o', indent: 0 }, 'flags'],
            [{ type: 'extractRegex', value: 'v', regex: 'r', flags: 'g', result: 'x', inputVar: REF }, 'inputVar'],
            [{ type: 'setvar', operator: '=', var: REF, value: 'v' }, 'var'],
            [{ type: 'setvar', operator: REF, var: 'x', value: 'v' }, 'operator'],
            [{ type: 'systemprompt', location: REF, value: 'v' }, 'location'],
            [{ type: 'impersonate', role: REF, value: 'v' }, 'role'],
            [{ type: 'showAlert', alertType: REF, value: 'v', inputVar: 'i' }, 'alertType'],
        ]
        for (const [effect, field] of excluded) {
            expect(effectClasses(effect)[field], String(Reflect.get(effect, 'type')) + '.' + field).toBeUndefined()
        }
    })

    test('an asset named like an effect type or mode word is never matched against the discriminators', () => {
        const classes = effectClasses({ type: 'setvar', operator: '=', var: 'v', value: 'x' })
        expect(Object.keys(classes)).toEqual(['value'])
        expect(Object.keys(conditionClasses({ type: 'exists', value: 'x', type2: 'loose', depth: 1 }))).toEqual(['value'])
    })
})

describe('v1 effects', () => {
    test('the rewritable set is rewritable; cutchat, modifychat.index and inputVar are not enumerated', () => {
        const rewritable: [object, string][] = [
            [{ type: 'setvar', operator: '=', var: 'v', value: REF }, 'value'],
            [{ type: 'systemprompt', location: 'start', value: REF }, 'value'],
            [{ type: 'impersonate', role: 'user', value: REF }, 'value'],
            [{ type: 'command', value: REF }, 'value'],
            [{ type: 'modifychat', index: '0', value: REF }, 'value'],
            [{ type: 'showAlert', alertType: 'normal', value: REF, inputVar: 'i' }, 'value'],
            [{ type: 'runLLM', value: REF, inputVar: 'i' }, 'value'],
            [{ type: 'runAxLLM', value: REF, inputVar: 'i' }, 'value'],
            [{ type: 'checkSimilarity', source: REF, value: REF, inputVar: 'i' }, 'source'],
            [{ type: 'checkSimilarity', source: REF, value: REF, inputVar: 'i' }, 'value'],
            [{ type: 'runImgGen', value: REF, negValue: REF, inputVar: 'i' }, 'value'],
            [{ type: 'runImgGen', value: REF, negValue: REF, inputVar: 'i' }, 'negValue'],
            [{ type: 'extractRegex', value: REF, regex: 'r', flags: 'g', result: 'x', inputVar: 'i' }, 'value'],
        ]
        for (const [effect, field] of rewritable) {
            expect(effectClasses(effect)[field], String(Reflect.get(effect, 'type')) + '.' + field).toBe('rewritable')
        }
    })
})

describe('trigger table: conditions', () => {
    test('type value rewrites var and value; type var rewrites value only', () => {
        expect(conditionClasses({ type: 'value', var: REF, value: REF, operator: '=' })).toEqual({ var: 'rewritable', value: 'rewritable' })
        expect(conditionClasses({ type: 'var', var: REF, value: REF, operator: '=' })).toEqual({ value: 'rewritable' })
    })

    test('exists rewrites for strict and loose, flags for regex, and never lists the mode word', () => {
        expect(conditionClasses({ type: 'exists', value: REF, type2: 'loose', depth: 3 })).toEqual({ value: 'rewritable' })
        expect(conditionClasses({ type: 'exists', value: REF, type2: 'strict', depth: 3 })).toEqual({ value: 'rewritable' })
        expect(conditionClasses({ type: 'exists', value: REF, type2: 'regex', depth: 3 })).toEqual({ value: 'flagOnly' })
    })

    test('a chat index operand is numeric and not enumerated', () => {
        expect(conditionClasses({ type: 'chatindex', value: '3', operator: '=' })).toEqual({})
    })

    test('condition paths use the conditions segment', () => {
        const owner = characterOwner({ triggerscript: [v2Trigger([], [{ type: 'value', var: 'a', value: 'b', operator: '=' }])] })
        expect(enumerateTargets(owner).map((pair) => pair.path)).toEqual(['trigger/0/conditions/0/var', 'trigger/0/conditions/0/value'])
    })
})

describe('a group is not an owner', () => {
    test('a character owner of type group makes the enumeration throw a TypeError, and a character does not', () => {
        expect(() => enumerateClassifiedTargets({ kind: 'character', source: { type: 'group', desc: REF } })).toThrow(TypeError)
        expect(() => enumerateTargets({ kind: 'character', source: { type: 'group', desc: REF } })).toThrow(TypeError)
        expect(enumerateTargets({ kind: 'character', source: { type: 'character', desc: REF } })).toEqual([{ path: 'desc', text: REF }])
    })
})

describe('real trigger templates', () => {
    test('a blank character has no trigger target: its header code is never scanned', () => {
        expect(enumerateTargets(characterOwner({ triggerscript: blankV2Triggers() }))).toEqual([])
    })

    test('a Lua list is one flag-only target', () => {
        expect(enumerateClassifiedTargets(characterOwner({ triggerscript: luaTriggers('x') }))).toEqual([
            { path: 'trigger/0/effect/0/code', text: 'x', cls: 'flagOnly' },
        ])
    })
})

describe('parseTargetPath: one parse of a registry path', () => {
    test('a __proto__ segment, a non-canonical index and a shape the stored target refuses give null for both owner kinds', () => {
        for (const kind of ['character', 'module'] as const) {
            expect(parseTargetPath(kind, 'trigger/0/effect/0/__proto__'), kind).toBeNull()
            expect(parseTargetPath(kind, '__proto__'), kind).toBeNull()
            expect(parseTargetPath(kind, 'lore/01/content'), kind).toBeNull()
            expect(parseTargetPath(kind, 'trigger/00/effect/0/value'), kind).toBeNull()
            expect(parseTargetPath(kind, 'trigger/0/effect/1e1/value'), kind).toBeNull()
            expect(parseTargetPath(kind, 'trigger/0/effect/0/a-b'), kind).toBeNull()
            expect(parseTargetPath(kind, 'lore/0/content/'), kind).toBeNull()
            expect(parseTargetPath(kind, 'lore//content'), kind).toBeNull()
            expect(parseTargetPath(kind, 'lore/0/key'), kind).toBeNull()
            expect(parseTargetPath(kind, 'name'), kind).toBeNull()
        }
        expect(parseTargetPath('character', 'alternateGreetings/01')).toBeNull()
        expect(parseTargetPath('character', 'alternateGreetings/-1')).toBeNull()
    })

    test('a canonical path parses by owner kind', () => {
        expect(parseTargetPath('character', 'alternateGreetings/12')).toEqual({ greeting: 12 })
        expect(parseTargetPath('character', 'desc')).toEqual({ field: 'desc' })
        expect(parseTargetPath('character', 'depth_prompt/prompt')).toEqual({ nested: 'depth_prompt', field: 'prompt' })
        expect(parseTargetPath('character', 'lore/3/content')).toEqual({ entry: 'lore', index: 3, field: 'content' })
        expect(parseTargetPath('module', 'regex/0/out')).toEqual({ entry: 'regex', index: 0, field: 'out' })
        expect(parseTargetPath('module', 'trigger/2/conditions/10/value')).toEqual({ trigger: 2, section: 'conditions', entry: 10, field: 'value' })
        expect(parseTargetPath('module', 'backgroundEmbedding')).toEqual({ field: 'backgroundEmbedding' })
        expect(parseTargetPath('module', 'desc')).toBeNull()
        expect(parseTargetPath('module', 'alternateGreetings/0')).toBeNull()
        expect(parseTargetPath('character', 'backgroundEmbedding')).toBeNull()
    })
})

describe('rewritableTextAt agrees with the enumerator', () => {
    const word = fc.constantFrom('', 'a', 'smile', 'x y', 'lo')
    const effectArb = fc.oneof(
        fc.record({ type: fc.constant('v2SetVar'), var: word, varType: fc.constantFrom('var', 'value'), operator: fc.constant('='), valueType: fc.constantFrom('value', 'var'), value: word }),
        fc.record({ type: fc.constant('setvar'), var: word, operator: fc.constant('='), value: word }),
        fc.record({ type: fc.constant('triggerlua'), code: word }),
        fc.record({ type: fc.constant('extractRegex'), regex: word, result: word, flags: word, value: word, inputVar: word }),
        fc.record({ type: fc.constant('v2ExtractRegex'), regex: word, regexType: fc.constantFrom('value', 'var'), result: word, outputVar: word, value: word, valueType: fc.constantFrom('value', 'var') }),
        fc.record({ type: fc.constant('v2Header'), code: word, indent: fc.nat(3) }),
        fc.record({ type: fc.constant('v2If'), source: word, sourceType: fc.constantFrom('value', 'var'), condition: fc.constant('='), target: word, targetType: fc.constantFrom('value', 'var') }),
    )
    const conditionArb = fc.oneof(
        fc.record({ type: fc.constant('var'), var: word, operator: fc.constant('='), value: word }),
        fc.record({ type: fc.constant('value'), var: word, operator: fc.constant('='), value: word }),
        fc.record({ type: fc.constant('exists'), type2: fc.constantFrom('strict', 'loose', 'regex'), value: word, depth: fc.nat(5) }),
        fc.record({ type: fc.constant('chatindex'), value: fc.nat(5).map(String), operator: fc.constant('=') }),
    )
    const triggerArb = fc.record({
        comment: word,
        type: fc.constant('manual'),
        conditions: fc.array(conditionArb, { maxLength: 2 }),
        effect: fc.array(effectArb, { maxLength: 3 }),
    })
    const characterArb = fc.record({
        desc: word,
        firstMessage: word,
        alternateGreetings: fc.array(word, { maxLength: 3 }),
        systemPrompt: word,
        exampleMessage: word,
        depth_prompt: fc.record({ depth: fc.nat(10), prompt: word }),
        newGenData: fc.record({ prompt: word, negative: word, instructions: word, emotionInstructions: word }),
        creatorNotes: word,
        replaceGlobalNote: word,
        additionalText: word,
        personality: word,
        scenario: word,
        backgroundHTML: word,
        defaultVariables: word,
        translatorNote: word,
        // Strings the registry never scans.
        name: word,
        nickname: word,
        postHistoryInstructions: word,
        backgroundCSS: word,
        globalLore: fc.array(fc.record({ key: word, content: word }), { maxLength: 3 }),
        customscript: fc.array(fc.record({ in: word, out: word }), { maxLength: 3 }),
        triggerscript: fc.array(triggerArb, { maxLength: 2 }),
    })
    const moduleArb = fc.record({
        lorebook: fc.array(fc.record({ key: word, content: word }), { maxLength: 3 }),
        regex: fc.array(fc.record({ in: word, out: word }), { maxLength: 3 }),
        trigger: fc.array(triggerArb, { maxLength: 2 }),
        backgroundEmbedding: word,
        cjs: word,
        name: word,
    })

    const REGISTRY_NAMES = [
        'desc', 'firstMessage', 'exampleMessage', 'systemPrompt', 'replaceGlobalNote', 'additionalText', 'personality', 'scenario',
        'backgroundHTML', 'defaultVariables', 'translatorNote', 'creatorNotes', 'depth_prompt/prompt', 'newGenData/prompt',
        'backgroundEmbedding', 'cjs', 'name', 'nickname', 'postHistoryInstructions', 'backgroundCSS', 'constructor', 'toString',
    ]

    // Every own string leaf of the owner at the path its list would give it, the registry names, and mutations of
    // every candidate: out of range, a non-canonical index and an unknown field.
    function candidatesOf(owner: TargetOwner): string[] {
        const out = new Set<string>(REGISTRY_NAMES)
        for (const target of enumerateClassifiedTargets(owner)) {
            out.add(target.path)
            out.add(target.path + 'x')
            out.add(target.path.replace(/\/(\d+)\//, '/0$1/'))
            out.add(target.path.replace(/\/(\d+)(\/|$)/, (_, index: string, tail: string) => '/' + (Number(index) + 50) + tail))
        }
        const triggers = (owner.kind === 'character' ? owner.source.triggerscript : owner.source.trigger) ?? []
        triggers.forEach((list, i) => {
            for (const section of ['conditions', 'effect'] as const) {
                ;(list[section] ?? []).forEach((entry, j) => {
                    for (const key of Object.keys(entry)) {
                        out.add(`trigger/${i}/${section}/${j}/${key}`)
                    }
                    out.add(`trigger/${i}/${section}/${j}/missing`)
                })
            }
        })
        return [...out]
    }

    function checkOwner(owner: TargetOwner): void {
        const rewritable = new Map(enumerateClassifiedTargets(owner).filter((target) => target.cls === 'rewritable').map((target) => [target.path, target.text]))
        for (const path of candidatesOf(owner)) {
            expect(rewritableTextAt(owner, path), path).toBe(rewritable.get(path) ?? null)
        }
    }

    test('a character: a path resolves to its text exactly when the enumerator lists it as rewritable', () => {
        fc.assert(fc.property(characterArb, (source) => checkOwner({ kind: 'character', source })), { numRuns: 150 })
    })

    test('a module: a path resolves to its text exactly when the enumerator lists it as rewritable', () => {
        fc.assert(fc.property(moduleArb, (source) => checkOwner({ kind: 'module', source })), { numRuns: 150 })
    })

    test('a group resolves nothing, and a missing owner entry is null, not an empty text', () => {
        expect(rewritableTextAt({ kind: 'character', source: { type: 'group', desc: 'd' } }, 'desc')).toBeNull()
        expect(rewritableTextAt({ kind: 'character', source: {} }, 'lore/0/content')).toBeNull()
        expect(rewritableTextAt({ kind: 'module', source: { lorebook: [{}] } }, 'lore/0/content')).toBeNull()
        expect(rewritableTextAt({ kind: 'module', source: { lorebook: [{ content: '' }] } }, 'lore/0/content')).toBe('')
    })
})
