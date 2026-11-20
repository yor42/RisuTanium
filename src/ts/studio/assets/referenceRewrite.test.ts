import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { planRewrite, spliceTextEdits, type TextEdit } from './referenceRewrite'
import { enumerateClassifiedTargets, type CharacterTargetFields } from './referenceTargets'
import { applyEditsTo, characterOwner, encodeCreatorNotes, luaTriggers, moduleOwner, v2Trigger } from './assetFixtures.test-helpers'

function plan(fields: CharacterTargetFields, kind: 'asset' | 'emotion', removed: string, kept: string) {
    return planRewrite(enumerateClassifiedTargets(characterOwner(fields)), kind, removed, kept)
}

/** A character carrying `{{image::smile}}` in every rewritable character text, shaped like an imported card. */
function everyTextCharacter(reference: string): CharacterTargetFields {
    const text = 'say ' + reference + ' now'
    return {
        desc: text,
        firstMessage: text,
        alternateGreetings: [text, 'plain', text],
        systemPrompt: text,
        replaceGlobalNote: text,
        additionalText: text,
        personality: text,
        scenario: text,
        exampleMessage: text,
        depth_prompt: { prompt: text },
        newGenData: { prompt: text, negative: text, instructions: text, emotionInstructions: text },
        backgroundHTML: text,
        defaultVariables: 'mood=happy\n' + text,
        translatorNote: text,
        creatorNotes: text,
        globalLore: [{ content: text }, { content: 'plain' }, { content: text }],
        customscript: [{ out: text }, { out: 'plain' }],
        triggerscript: [v2Trigger([{ type: 'v2SetVar', operator: '=', var: 'x', valueType: 'value', value: text, indent: 0 }])],
    }
}

describe('every syntax in every target', () => {
    test('a merge rewrites the macro in every rewritable character text, once per place', () => {
        const fields = everyTextCharacter('{{image::smile}}')
        const result = plan(fields, 'asset', 'smile', 'grin')
        const targets = enumerateClassifiedTargets(characterOwner(fields))
        const expected = targets.filter((target) => target.text.includes('{{image::smile}}')).map((target) => target.path)
        expect(new Set(result.edits.map((edit) => edit.target))).toEqual(new Set(expected))
        expect(result.edits).toHaveLength(expected.length)
        expect(expected).toEqual(expect.arrayContaining(['desc', 'firstMessage', 'alternateGreetings/0', 'alternateGreetings/2', 'backgroundHTML', 'creatorNotes', 'lore/2/content', 'regex/0/out', 'trigger/0/effect/0/value', 'newGenData/emotionInstructions']))
        for (const edit of result.edits) {
            const text = targets.find((target) => target.path === edit.target)?.text ?? ''
            expect(spliceTextEdits(text, [edit])).toBe(text.replace('{{image::smile}}', '{{image::grin}}'))
        }
        expect(result.notRewritten.filter((hit) => hit.reason !== 'defaultVariable')).toEqual([])
    })

    test('every media type, asset_prompt and img src are rewritten in one text, each at its own span', () => {
        const text = ['raw', 'path', 'img', 'image', 'video', 'audio', 'bgm', 'bg', 'asset', 'video-img']
            .map((type) => '{{' + type + '::smile}}').join(' ')
            + ' {{asset_prompt::smile}} {{assetprompt::smile}} <img src="SMILE"> <img src=\'smile\'>'
        const result = plan({ desc: text }, 'asset', 'smile', 'grin')
        expect(result.edits).toHaveLength(14)
        const rewritten = applyEditsTo(text, 'desc', result.edits)
        expect(rewritten).not.toMatch(/smile/i)
        expect(rewritten.match(/grin/g)).toHaveLength(14)
    })

    test('the edits come in apply order: targets in registry order, the highest offset first inside a target', () => {
        const result = plan({ desc: '{{img::a}} {{img::a}}', firstMessage: '{{img::a}}' }, 'asset', 'a', 'b')
        expect(result.edits.map((edit) => [edit.target, edit.offset])).toEqual([['desc', 18], ['desc', 7], ['firstMessage', 7]])
        expect(spliceTextEdits('{{img::a}} {{img::a}}', result.edits.filter((edit) => edit.target === 'desc'))).toBe('{{img::b}} {{img::b}}')
    })

    test('edits carry the text now at the span and the kept name exactly', () => {
        const result = plan({ desc: '{{image::Smile.PNG}}' }, 'asset', 'smile.png', 'Grin 2')
        expect(result.edits).toEqual([{ target: 'desc', offset: 9, from: 'Smile.PNG', to: 'Grin 2' }])
    })
})

describe('case-only and extension-only merges', () => {
    test('case-only: case-insensitive forms are left and listed as already showing; asset_prompt and @@emo written Smile are rewritten', () => {
        const fields: CharacterTargetFields = {
            desc: '{{image::SMILE}} {{image::smile}} {{asset_prompt::Smile}} {{asset_prompt::smile}}',
        }
        const asset = plan(fields, 'asset', 'Smile', 'smile')
        expect(asset.alreadyShows.map((hit) => hit.name)).toEqual(['SMILE', 'smile'])
        expect(asset.edits.map((edit) => edit.from)).toEqual(['Smile'])
        expect(asset.edits[0].offset).toBe(fields.desc?.indexOf('{{asset_prompt::Smile}}') as number + '{{asset_prompt::'.length)

        const emotion = plan({ regex: undefined, customscript: [{ out: '@@emo Smile' }, { out: '@@emo smile' }], desc: '{{emotion::SMILE}}' } as CharacterTargetFields, 'emotion', 'Smile', 'smile')
        expect(emotion.edits).toEqual([{ target: 'regex/0/out', offset: 6, from: 'Smile', to: 'smile' }])
        expect(emotion.alreadyShows.map((hit) => [hit.path, hit.name])).toEqual([['desc', 'SMILE']])
    })

    test('extension-only: every syntax is rewritten, including a raw img src', () => {
        const fields: CharacterTargetFields = {
            desc: '{{image::smile.png}} <img src="smile.png"> {{asset_prompt::smile.png}} {{img::SMILE.PNG}}',
        }
        const result = plan(fields, 'asset', 'smile.png', 'smile')
        expect(applyEditsTo(fields.desc ?? '', 'desc', result.edits)).toBe('{{image::smile}} <img src="smile"> {{asset_prompt::smile}} {{img::smile}}')
        expect(result.alreadyShows).toEqual([])
    })

    test('a reference that does not name the removed name is untouched', () => {
        const result = plan({ desc: '{{image::grin}} {{asset_prompt::SMILE}} <img src="smile2">' }, 'asset', 'smile', 'happy')
        expect(result.edits).toEqual([])
        expect(result.notRewritten).toEqual([])
    })
})

describe('kinds never cross', () => {
    test('an emotion merge rewrites {{emotion::}} and @@emo and leaves {{image::}} alone', () => {
        const result = plan({ desc: '{{image::happy}} {{emotion::happy}}', customscript: [{ out: '@@emo happy' }] }, 'emotion', 'happy', 'glad')
        expect(result.edits.map((edit) => edit.target)).toEqual(['desc', 'regex/0/out'])
        expect(applyEditsTo('{{image::happy}} {{emotion::happy}}', 'desc', result.edits)).toBe('{{image::happy}} {{emotion::glad}}')
    })

    test('an asset merge rewrites {{image::}} and leaves {{emotion::}} and @@emo alone', () => {
        const result = plan({ desc: '{{image::happy}} {{emotion::happy}}', customscript: [{ out: '@@emo happy' }] }, 'asset', 'happy', 'glad')
        expect(result.edits).toEqual([{ target: 'desc', offset: 9, from: 'happy', to: 'glad' }])
    })
})

describe('@@emo and asset_prompt', () => {
    test('@@emo Smile and the trimmed span are rewritten; a leading space is no reference; smile is untouched in a Smile merge', () => {
        const fields: CharacterTargetFields = { customscript: [{ out: '@@emo Smile' }, { out: '@@emo  Smile  ' }, { out: ' @@emo Smile' }, { out: '@@emo smile' }] }
        const result = plan(fields, 'emotion', 'Smile', 'Joy')
        expect(result.edits.map((edit) => [edit.target, edit.offset, edit.from])).toEqual([['regex/0/out', 6, 'Smile'], ['regex/1/out', 7, 'Smile']])
        expect(applyEditsTo('@@emo  Smile  ', 'regex/1/out', result.edits)).toBe('@@emo  Joy  ')
    })

    test('asset_prompt compares its name exactly and an upper-case macro type is not a reference', () => {
        const result = plan({ desc: '{{ASSET_PROMPT::Smile}} {{AssetPrompt::smile}} {{IMAGE::smile}} <img src="a:smile">' }, 'asset', 'Smile', 'Grin')
        expect(result.edits.map((edit) => edit.from)).toEqual(['Smile'])
        expect(plan({ desc: '<img src="smile">' }, 'asset', 'smile', 'grin').edits).toHaveLength(1)
    })
})

describe('flagged places are listed and never rewritten', () => {
    test('a dynamic name, a replacement pattern and an unquoted src are listed with their reason', () => {
        const fields: CharacterTargetFields = {
            desc: '{{image::{{getvar::smile}}}} <img src=smile> {{image::smile}}',
            customscript: [{ out: '{{image::smile$1}}' }],
        }
        const result = plan(fields, 'asset', 'smile', 'grin')
        expect(result.edits).toHaveLength(1)
        expect(result.notRewritten.map((hit) => hit.reason).sort()).toEqual(['dynamicName', 'replacementPattern', 'unquotedSrc'].sort())
    })

    test('Lua, trigger code and cjs holding the name are listed, never edited', () => {
        const luaOwner = characterOwner({ triggerscript: luaTriggers('local n = "{{image::smile}}"') })
        const lua = planRewrite(enumerateClassifiedTargets(luaOwner), 'asset', 'smile', 'grin')
        expect(lua.edits).toEqual([])
        expect(lua.notRewritten.map((hit) => [hit.path, hit.reason])).toEqual([['trigger/0/effect/0/code', 'flagOnlyTarget']])
        const mod = planRewrite(enumerateClassifiedTargets(moduleOwner({ cjs: 'x("smile")', lorebook: [{ content: '{{image::smile}}' }] })), 'asset', 'smile', 'grin')
        expect(mod.edits.map((edit) => edit.target)).toEqual(['lore/0/content'])
        expect(mod.notRewritten.map((hit) => hit.path)).toEqual(['cjs'])
    })

    test('a default-variable value equal to the name is listed; a macro in the same text is rewritten', () => {
        const result = plan({ defaultVariables: 'face=smile\nshow={{image::smile}}' }, 'asset', 'smile', 'grin')
        expect(result.notRewritten.map((hit) => hit.reason)).toEqual(['defaultVariable'])
        expect(result.edits).toHaveLength(1)
    })

    test('a kept name that the place would read as syntax is listed instead of written', () => {
        expect(plan({ desc: '{{image::smile}}' }, 'asset', 'smile', 'a}}b').notRewritten.map((hit) => hit.reason)).toEqual(['unsafeKeptName'])
        expect(plan({ customscript: [{ out: '{{image::smile}}' }] }, 'asset', 'smile', 'a$1').edits).toEqual([])
        expect(plan({ desc: '<img src="smile">' }, 'asset', 'smile', 'a"b').notRewritten.map((hit) => hit.reason)).toEqual(['unsafeKeptName'])
        expect(plan({ desc: '<img src="smile">' }, 'asset', 'smile', "it's").edits).toHaveLength(1)
        expect(plan({ desc: '<img src=\'smile\'>' }, 'asset', 'smile', "it's").edits).toEqual([])
    })

    test('a kept name holding > is listed in an img src, where it would end the tag, and written elsewhere', () => {
        const inSrc = plan({ desc: '<img src="smile">' }, 'asset', 'smile', 'a>b')
        expect(inSrc.edits).toEqual([])
        expect(inSrc.notRewritten.map((hit) => hit.reason)).toEqual(['unsafeKeptName'])
        expect(plan({ desc: '{{image::smile}}' }, 'asset', 'smile', 'a>b').edits).toHaveLength(1)
    })

    test('a kept name ending in a single } is listed, because the lazy macro pattern would take it for the closing braces', () => {
        for (const text of ['{{image::smile}}', '{{asset_prompt::smile}}']) {
            const result = plan({ desc: text }, 'asset', 'smile', 'x}')
            expect(result.edits, text).toEqual([])
            expect(result.notRewritten.map((hit) => hit.reason), text).toEqual(['unsafeKeptName'])
        }
        expect(plan({ desc: '{{emotion::smile}}' }, 'emotion', 'smile', 'x}').notRewritten.map((hit) => hit.reason)).toEqual(['unsafeKeptName'])
        expect(plan({ desc: '{{image::smile}}' }, 'asset', 'smile', 'x}y').edits).toHaveLength(1)
    })

    test('a kept name with a blank at either end is listed for @@emo, whose name the engine trims, and written in the other syntaxes', () => {
        for (const kept of ['smile ', ' smile', ' smile ']) {
            const inOut = plan({ customscript: [{ out: '@@emo grin' }] }, 'emotion', 'grin', kept)
            expect(inOut.edits, JSON.stringify(kept)).toEqual([])
            expect(inOut.notRewritten.map((hit) => [hit.path, hit.syntax, hit.reason]), JSON.stringify(kept)).toEqual([['regex/0/out', 'emoScript', 'unsafeKeptName']])
            expect(plan({ desc: '{{emotion::grin}}' }, 'emotion', 'grin', kept).edits, JSON.stringify(kept)).toHaveLength(1)
            expect(plan({ customscript: [{ out: '{{asset_prompt::grin}}' }] }, 'asset', 'grin', kept).edits, JSON.stringify(kept)).toHaveLength(1)
        }
        expect(plan({ customscript: [{ out: '@@emo grin' }] }, 'emotion', 'grin', 'sm ile').edits).toHaveLength(1)
    })

    test('an empty kept name is listed in every reference form and never written, because no pattern reads an empty name', () => {
        const cases: Array<[CharacterTargetFields, 'asset' | 'emotion', string]> = [
            [{ desc: '{{image::smile}}' }, 'asset', 'desc'],
            [{ desc: '{{asset_prompt::smile}}' }, 'asset', 'desc'],
            [{ desc: '<img src="smile">' }, 'asset', 'desc'],
            [{ desc: '{{emotion::smile}}' }, 'emotion', 'desc'],
            [{ customscript: [{ out: '@@emo smile' }] }, 'emotion', 'regex/0/out'],
        ]
        for (const [fields, kind, path] of cases) {
            const result = plan(fields, kind, 'smile', '')
            expect(result.edits, path + JSON.stringify(fields)).toEqual([])
            expect(result.notRewritten.map((hit) => [hit.path, hit.reason]), JSON.stringify(fields)).toEqual([[path, 'unsafeKeptName']])
        }
    })

    test('a kept name that the image lookup never takes for a name is listed in an img src: a colon, or more than 200 characters', () => {
        for (const kept of ['a:b', 'x'.repeat(201)]) {
            const result = plan({ desc: '<img src="smile">' }, 'asset', 'smile', kept)
            expect(result.edits, kept).toEqual([])
            expect(result.notRewritten.map((hit) => hit.reason), kept).toEqual(['unsafeKeptName'])
            expect(plan({ desc: '{{image::smile}}' }, 'asset', 'smile', kept).edits, kept).toHaveLength(1)
        }
        expect(plan({ desc: '<img src="smile">' }, 'asset', 'smile', 'x'.repeat(200)).edits).toHaveLength(1)
    })

    test('a kept name that a regex replacement substitutes is listed in a regex out and written in other texts', () => {
        for (const kept of ['a$&b', 'a$$b', 'a$`b', "a$'b"]) {
            const inOut = plan({ customscript: [{ out: '{{image::smile}}' }] }, 'asset', 'smile', kept)
            expect(inOut.edits, kept).toEqual([])
            expect(inOut.notRewritten.map((hit) => [hit.path, hit.reason]), kept).toEqual([['regex/0/out', 'unsafeKeptName']])
            expect(plan({ desc: '{{image::smile}}' }, 'asset', 'smile', kept).edits, kept).toHaveLength(1)
        }
    })

    test('a removed name that a regex replacement would substitute is listed, not edited, in a regex out', () => {
        const result = plan({ customscript: [{ out: '{{image::a$&b}}' }], desc: '{{image::a$&b}}' }, 'asset', 'a$&b', 'grin')
        expect(result.edits.map((edit) => edit.target)).toEqual(['desc'])
        expect(result.notRewritten.map((hit) => [hit.path, hit.reason])).toEqual([['regex/0/out', 'replacementPattern']])
    })

    test('{{ele::}} name lists are reported apart', () => {
        const result = plan({ desc: '{{ele::smile::grin}}' }, 'asset', 'smile', 'happy')
        expect(result.nameLists).toHaveLength(1)
        expect(result.edits).toEqual([])
    })
})

describe('trigger fields', () => {
    const REF = '{{image::smile}}'
    const effects = [
        { type: 'v2SetVar', operator: '=', var: 'x', valueType: 'value', value: REF, indent: 0 },
        { type: 'v2SetVar', operator: '=', var: 'x', valueType: 'var', value: REF, indent: 0 },
        { type: 'v2Calculate', expression: REF, expressionType: 'value', outputVar: 'o', indent: 0 },
        { type: 'v2RegexTest', value: 'v', valueType: 'value', regex: 'smile', regexType: 'value', flags: 'g', flagsType: 'value', outputVar: 'o', indent: 0 },
        { type: 'v2Future', value: REF, valueType: 'value' },
        { type: 'extractRegex', value: 'v', regex: REF, flags: 'g', result: REF, inputVar: 'i' },
        { type: 'v2Comment', value: REF, indent: 0 },
        { type: 'runtrigger', value: REF },
        { type: 'setvar', operator: '=', var: 'smile', value: ' smile ' },
        { type: 'v2SetVar', operator: '=', var: 'x', valueType: 'value', value: 'Smile', indent: 0 },
        { type: 'v2SetVar', operator: '=', var: 'x', valueType: 'value', value: REF + ' x', indent: 0 },
    ]

    test('rewritable fields get edits; flag-only fields are listed with no edit; excluded fields are neither', () => {
        const result = plan({ triggerscript: [v2Trigger(effects)] }, 'asset', 'smile', 'grin')
        expect(result.edits.map((edit) => edit.target).sort()).toEqual(['trigger/0/effect/0/value', 'trigger/0/effect/10/value'])
        expect(result.notRewritten.map((hit) => [hit.path, hit.reason ?? hit.syntax]).sort()).toEqual([
            ['trigger/0/effect/2/expression', 'flagOnlyTarget'],
            ['trigger/0/effect/3/regex', 'flagOnlyTarget'],
            ['trigger/0/effect/4/value', 'flagOnlyTarget'],
            ['trigger/0/effect/5/regex', 'flagOnlyTarget'],
            ['trigger/0/effect/5/result', 'flagOnlyTarget'],
            ['trigger/0/effect/8/value', 'wholeValue'],
            ['trigger/0/effect/9/value', 'wholeValue'],
        ])
    })

    test('a condition var of type value is rewritten, of type var is not, and an asset named loose does not hit type2', () => {
        const owner = characterOwner({
            triggerscript: [v2Trigger([], [
                { type: 'value', var: REF, value: 'x', operator: '=' },
                { type: 'var', var: REF, value: 'x', operator: '=' },
                { type: 'exists', value: REF, type2: 'loose', depth: 3 },
            ])],
        })
        const result = planRewrite(enumerateClassifiedTargets(owner), 'asset', 'smile', 'grin')
        expect(result.edits.map((edit) => edit.target).sort()).toEqual(['trigger/0/conditions/0/var', 'trigger/0/conditions/2/value'])
        expect(planRewrite(enumerateClassifiedTargets(owner), 'asset', 'loose', 'x')).toMatchObject({ edits: [], notRewritten: [] })
    })

    test('an asset named like an effect type never hits the type field', () => {
        const owner = characterOwner({ triggerscript: [v2Trigger([{ type: 'setvar', operator: '=', var: 'v', value: 'x' }])] })
        const result = planRewrite(enumerateClassifiedTargets(owner), 'asset', 'setvar', 'other')
        expect(result.edits).toEqual([])
        expect(result.notRewritten).toEqual([])
    })
})

describe('background HTML', () => {
    test('{{bg::Smile}} and {{audio::Smile}} are both planned at the backgroundHTML path', () => {
        const result = plan({ backgroundHTML: '<div>{{bg::Smile}}</div>{{audio::Smile}}' }, 'asset', 'Smile', 'smile_bg')
        expect(result.edits.map((edit) => edit.target)).toEqual(['backgroundHTML', 'backgroundHTML'])
        expect(applyEditsTo('<div>{{bg::Smile}}</div>{{audio::Smile}}', 'backgroundHTML', result.edits)).toBe('<div>{{bg::smile_bg}}</div>{{audio::smile_bg}}')
    })

    test('a module background embedding is rewritten at its own path', () => {
        const result = planRewrite(enumerateClassifiedTargets(moduleOwner({ backgroundEmbedding: '{{bg::Smile}}' })), 'asset', 'Smile', 'x')
        expect(result.edits.map((edit) => edit.target)).toEqual(['backgroundEmbedding'])
    })
})

describe('creator comments', () => {
    test('every language section and the untagged prefix is rewritten, each hit carrying its language', () => {
        const text = '{{image::smile}} untagged\n# `ko`\n{{image::smile}}\n# `en`\n{{img::smile}}'
        const result = plan({ creatorNotes: text }, 'asset', 'smile', 'grin')
        expect(result.rewritten.map((hit) => hit.lang)).toEqual(['en', 'ko', 'xx'])
        expect(result.edits.map((edit) => edit.target)).toEqual(['creatorNotes', 'creatorNotes', 'creatorNotes'])
        expect(applyEditsTo(text, 'creatorNotes', result.edits)).toBe(text.replaceAll('smile', 'grin'))
    })

    test('text stored by the encoder holds an untagged name twice: both hits are rewritten', () => {
        const stored = encodeCreatorNotes({ xx: '{{image::smile}}' })
        const result = plan({ creatorNotes: stored }, 'asset', 'smile', 'grin')
        expect(result.rewritten.map((hit) => hit.lang)).toEqual(['xx', 'xx'])
        expect(applyEditsTo(stored, 'creatorNotes', result.edits)).not.toContain('smile')
    })

    test('the merge plans no write to removedQuotes and leaves the owner as it found it', () => {
        const fields: CharacterTargetFields & { removedQuotes?: boolean } = { creatorNotes: '{{image::smile}}', removedQuotes: true }
        const snapshot = JSON.stringify(fields)
        const result = plan(fields, 'asset', 'smile', 'grin')
        expect(result.edits.every((edit) => edit.target === 'creatorNotes')).toBe(true)
        expect(fields.removedQuotes).toBe(true)
        expect(JSON.stringify(fields)).toBe(snapshot)
    })

    test('postHistoryInstructions holding a macro is not enumerated', () => {
        const fields: CharacterTargetFields & { postHistoryInstructions?: string } = { postHistoryInstructions: '{{image::smile}}' }
        expect(plan(fields, 'asset', 'smile', 'grin').edits).toEqual([])
    })
})

describe('pre-write text and overlap', () => {
    test('desc and greeting targets return their pre-write text; other targets do not', () => {
        const result = plan({ desc: '{{img::a}}', alternateGreetings: ['x', '{{img::a}}'], firstMessage: '{{img::a}}' }, 'asset', 'a', 'b')
        expect(result.preWrite).toEqual([{ target: 'desc', text: '{{img::a}}' }, { target: 'alternateGreetings/1', text: '{{img::a}}' }])
    })

    test('merging a name into itself plans nothing and lists its matches as not rewritten', () => {
        const result = plan({ desc: '{{img::a}}' }, 'asset', 'a', 'a')
        expect(result.edits).toEqual([])
        expect(result.notRewritten).toHaveLength(1)
    })
})

describe('spliceTextEdits equals applying the edits one by one', () => {
    // Compatibility guard (passes before and after the one-pass assembly): the reference is the edit-by-edit loop.
    function oneByOne(text: string, edits: readonly TextEdit[]): string {
        let result = text
        for (const edit of edits) {
            result = result.slice(0, edit.offset) + edit.to + result.slice(edit.offset + edit.from.length)
        }
        return result
    }

    // The inputs the one-pass assembly is allowed to take: every edit in range and every span ends at or before the
    // previous edit's offset.
    function isDescendingInRange(text: string, edits: readonly TextEdit[]): boolean {
        let limit = text.length
        for (const edit of edits) {
            if (!Number.isInteger(edit.offset) || edit.offset < 0 || edit.offset + edit.from.length > limit) {
                return false
            }
            limit = edit.offset
        }
        return true
    }

    const textArb = fc.array(fc.constantFrom('a', 'b', '{', '}'), { maxLength: 30 }).map((chars) => chars.join(''))
    const replacementArb = fc.array(fc.constantFrom('x', 'y', '{', '}'), { maxLength: 4 }).map((chars) => chars.join(''))

    // Descending, non-overlapping edits cut from consecutive sorted points; zero-length spans and equal offsets occur.
    const validArb = textArb.chain((text) => fc.record({
        text: fc.constant(text),
        cuts: fc.array(fc.nat(text.length), { maxLength: 12 }).map((cuts) => cuts.slice(0, cuts.length - (cuts.length % 2)).sort((a, b) => a - b)),
        replacements: fc.array(replacementArb, { minLength: 6, maxLength: 6 }),
    })).map(({ text, cuts, replacements }) => {
        const edits: TextEdit[] = []
        for (let i = 0; i < cuts.length; i += 2) {
            edits.push({ target: 'desc', offset: cuts[i], from: text.slice(cuts[i], cuts[i + 1]), to: replacements[i / 2] })
        }
        return { text, edits: edits.reverse() }
    })

    // Any order, overlap or range, including negative, past-the-end and fractional offsets.
    const arbitraryArb = fc.record({
        text: textArb,
        edits: fc.array(fc.record({
            target: fc.constant('desc'),
            offset: fc.oneof(fc.integer({ min: -3, max: 34 }), fc.double({ min: -1, max: 5, noNaN: true })),
            from: replacementArb,
            to: replacementArb,
        }), { maxLength: 6 }),
    })

    test('for descending in-range lists and for arbitrary lists alike', () => {
        let fast = 0
        let other = 0
        fc.assert(
            fc.property(fc.oneof(validArb, arbitraryArb), ({ text, edits }) => {
                if (isDescendingInRange(text, edits)) {
                    fast += 1
                } else {
                    other += 1
                }
                expect(spliceTextEdits(text, edits)).toBe(oneByOne(text, edits))
            }),
            { seed: 3404, numRuns: 2000 },
        )
        // Both paths are exercised: the check is not vacuous.
        expect(fast).toBeGreaterThan(200)
        expect(other).toBeGreaterThan(200)
    })

    test('equal-offset inserts apply later edit first, as one by one', () => {
        const edits: TextEdit[] = [
            { target: 'desc', offset: 2, from: '', to: 'A' },
            { target: 'desc', offset: 2, from: '', to: 'B' },
        ]
        expect(spliceTextEdits('abcd', edits)).toBe('abBAcd')
        expect(spliceTextEdits('abcd', edits)).toBe(oneByOne('abcd', edits))
    })

    test('a long text with many descending edits matches one by one', () => {
        const text = 'x'.repeat(5000)
        const edits: TextEdit[] = []
        for (let offset = 4990; offset >= 0; offset -= 10) {
            edits.push({ target: 'desc', offset, from: 'xx', to: 'longer' })
        }
        expect(isDescendingInRange(text, edits)).toBe(true)
        expect(spliceTextEdits(text, edits)).toBe(oneByOne(text, edits))
    })
})
