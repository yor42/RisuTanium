import { describe, expect, test } from 'vitest'
import { closeMatch, creatorNotesLang, referenceMatchesName, scanForName, scanReferences, type CloseMatchSettings, type NameRow } from './referenceScan'
import type { ClassifiedTarget } from './referenceTargets'
import { DEFAULT_SETTINGS, encodeCreatorNotes } from './assetFixtures.test-helpers'

const MEDIA_TYPES = ['raw', 'path', 'img', 'image', 'video', 'audio', 'bgm', 'bg', 'asset', 'video-img']

function names(text: string, kind: 'asset' | 'emotion', path = 'desc'): string[] {
    return scanReferences(text, kind, path).map((reference) => reference.name)
}

function target(path: string, text: string, cls: ClassifiedTarget['cls'] = 'rewritable'): ClassifiedTarget {
    return { path, text, cls }
}

describe('media macros', () => {
    test('every media type reads a reference, with the name span at its true offset', () => {
        for (const type of MEDIA_TYPES) {
            const text = 'before {{' + type + '::Smile}} after'
            const refs = scanReferences(text, 'asset', 'desc')
            expect(refs, type).toHaveLength(1)
            expect(refs[0].syntax).toBe('macro')
            expect(text.substr(refs[0].offset, refs[0].length)).toBe('Smile')
        }
    })

    test('the type word is exact: an upper-case type is not a reference', () => {
        expect(names('{{IMAGE::smile}} {{Img::smile}}', 'asset')).toEqual([])
    })

    test('the name is lazy and spans a newline', () => {
        expect(names('{{image::sm\nile}} {{img::b}}', 'asset')).toEqual(['sm\nile', 'b'])
    })

    test('other macros are not references: source, emotion, and look-alike words', () => {
        expect(names('{{source::char}} {{emotion::happy}} {{assetlist}} {{imagex::a}} {{asset:a}}', 'asset')).toEqual([])
    })

    test('names compare ignoring case under a macro', () => {
        const [reference] = scanReferences('{{image::SMILE}}', 'asset', 'desc')
        expect(referenceMatchesName(reference, 'smile')).toBe(true)
        expect(referenceMatchesName(reference, 'smile.png')).toBe(false)
    })

    test('a dynamic name is flagged, and so is a name a regex replacement would read', () => {
        expect(scanReferences('{{image::{{getvar::x}}}}', 'asset', 'desc')[0].flag).toBe('dynamicName')
        expect(scanReferences('{{image::smile$1}}', 'asset', 'regex/0/out')[0].flag).toBe('replacementPattern')
        expect(scanReferences('{{image::smile$<n>}}', 'asset', 'regex/0/out')[0].flag).toBe('replacementPattern')
        expect(scanReferences('{{image::smile$}}', 'asset', 'desc')[0].flag).toBeUndefined()
    })

    test('the other replacement specials are flagged in a regex out only, in every syntax that reads names there', () => {
        for (const special of ['$&', '$$', '$`', "$'"]) {
            const name = 'a' + special + 'b'
            expect(scanReferences('{{image::' + name + '}}', 'asset', 'regex/0/out')[0].flag, name).toBe('replacementPattern')
            expect(scanReferences('{{asset_prompt::' + name + '}}', 'asset', 'regex/0/out')[0].flag, name).toBe('replacementPattern')
            expect(scanReferences('<img src="' + name + '">', 'asset', 'regex/0/out')[0].flag, name).toBe('replacementPattern')
            expect(scanReferences('{{emotion::' + name + '}}', 'emotion', 'regex/0/out')[0].flag, name).toBe('replacementPattern')
            expect(scanReferences('{{image::' + name + '}}', 'asset', 'desc')[0].flag, name).toBeUndefined()
            expect(scanReferences('{{image::' + name + '}}', 'asset', 'lore/0/content')[0].flag, name).toBeUndefined()
        }
    })
})

describe('asset_prompt', () => {
    test('the prefix ignores case in both spellings and the name is compared exactly', () => {
        const text = '{{ASSET_PROMPT::Smile}} {{AssetPrompt::Smile}} {{assetprompt::Smile}} {{asset_prompt::smile}}'
        const refs = scanReferences(text, 'asset', 'desc')
        expect(refs.map((reference) => reference.name)).toEqual(['Smile', 'Smile', 'Smile', 'smile'])
        expect(refs.every((reference) => reference.syntax === 'assetPrompt')).toBe(true)
        expect(refs.map((reference) => referenceMatchesName(reference, 'Smile'))).toEqual([true, true, true, false])
        expect(refs.map((reference) => text.substr(reference.offset, reference.length))).toEqual(['Smile', 'Smile', 'Smile', 'smile'])
    })
})

describe('img src', () => {
    test('double and single quotes are references with exact spans; an unquoted value is flagged', () => {
        const text = '<img src="Smile.png"> <img alt="x" src=\'Grin\'> <img src=Plain.png>'
        const refs = scanReferences(text, 'asset', 'desc')
        expect(refs.map((reference) => reference.name)).toEqual(['Smile.png', 'Grin', 'Plain.png'])
        expect(refs.map((reference) => text.substr(reference.offset, reference.length))).toEqual(['Smile.png', 'Grin', 'Plain.png'])
        expect(refs.map((reference) => reference.flag)).toEqual([undefined, undefined, 'unquotedSrc'])
    })

    test('a src with a colon or longer than 200 is never a reference, and data-src is not src', () => {
        expect(names('<img src="a:smile"> <img src="https://x/y.png">', 'asset')).toEqual([])
        expect(names('<img src="' + 'a'.repeat(201) + '">', 'asset')).toEqual([])
        expect(names('<img src="' + 'a'.repeat(200) + '">', 'asset')).toHaveLength(1)
        expect(names('<img data-src="smile">', 'asset')).toEqual([])
    })

    test('the tag and the attribute ignore case, and an empty src is nothing', () => {
        expect(names('<IMG SRC="Smile">', 'asset')).toEqual(['Smile'])
        expect(names('<img src="">', 'asset')).toEqual([])
    })
})

describe('emotion syntaxes', () => {
    test('{{emotion::}} ignores case and is read only for the emotion kind', () => {
        expect(names('{{emotion::Happy}} {{image::happy}}', 'emotion')).toEqual(['Happy'])
        expect(names('{{emotion::Happy}} {{image::happy}}', 'asset')).toEqual(['happy'])
        const [reference] = scanReferences('{{emotion::HAPPY}}', 'emotion', 'desc')
        expect(referenceMatchesName(reference, 'happy')).toBe(true)
    })

    test('@@emo reads the trimmed remainder of a regex out and compares it exactly', () => {
        const refs = scanReferences('@@emo  Smile  ', 'emotion', 'regex/2/out')
        expect(refs).toHaveLength(1)
        expect(refs[0]).toMatchObject({ syntax: 'emoScript', name: 'Smile', offset: 7, length: 5 })
        expect(referenceMatchesName(refs[0], 'smile')).toBe(false)
        expect(referenceMatchesName(refs[0], 'Smile')).toBe(true)
    })

    test('a leading space, a non-regex path or the asset kind is not an @@emo reference', () => {
        expect(names(' @@emo Smile', 'emotion', 'regex/0/out')).toEqual([])
        expect(names('@@emo Smile', 'emotion', 'desc')).toEqual([])
        expect(names('@@emo Smile', 'emotion', 'lore/0/content')).toEqual([])
        expect(names('@@emo Smile', 'asset', 'regex/0/out')).toEqual([])
        expect(names('@@emo ', 'emotion', 'regex/0/out')).toEqual([])
    })
})

describe('scanForName', () => {
    test('a rewritable target gives matches; a flagged name gives flagged hits only when it holds the name', () => {
        const scan = scanForName([
            target('desc', '{{image::smile}} {{image::{{x}}smile}} {{image::other$1}}'),
        ], 'asset', 'smile')
        expect(scan.matches.map((hit) => hit.name)).toEqual(['smile'])
        expect(scan.flagged.map((hit) => [hit.name, hit.reason])).toEqual([['{{x}}smile', 'dynamicName']])
    })

    test('a flag-only target holding the name, as a reference or as plain text, is flagged once and never a match', () => {
        const scan = scanForName([
            target('trigger/0/effect/0/code', 'print("Smile")', 'flagOnly'),
            target('cjs', 'return "other"', 'flagOnly'),
        ], 'asset', 'smile')
        expect(scan.matches).toEqual([])
        expect(scan.flagged.map((hit) => [hit.path, hit.syntax])).toEqual([['trigger/0/effect/0/code', 'flagOnlyTarget']])
    })

    test('a trigger field whose whole value is the name is flagged; surrounding text makes it a match', () => {
        const scan = scanForName([
            target('trigger/0/effect/0/value', '  Smile '),
            target('trigger/0/effect/1/value', '{{image::smile}} x'),
        ], 'asset', 'smile')
        expect(scan.flagged.map((hit) => [hit.path, hit.reason, hit.name])).toEqual([['trigger/0/effect/0/value', 'wholeValue', 'Smile']])
        expect(scan.matches.map((hit) => hit.path)).toEqual(['trigger/0/effect/1/value'])
    })

    test('a default-variable value equal to the name is flagged at the value span', () => {
        const text = 'mood=happy\nface= Smile \nsmile=other'
        const scan = scanForName([target('defaultVariables', text)], 'asset', 'smile')
        expect(scan.flagged).toHaveLength(1)
        expect(scan.flagged[0]).toMatchObject({ reason: 'defaultVariable', name: 'Smile' })
        expect(text.substr(scan.flagged[0].offset, scan.flagged[0].length)).toBe('Smile')
    })

    test('an {{ele::}} name list holding the name is reported apart', () => {
        const scan = scanForName([target('desc', '{{ele::smile::grin}} {{ele::other}}')], 'asset', 'smile')
        expect(scan.nameLists).toHaveLength(1)
        expect(scan.matches).toEqual([])
    })

    test('the kinds never cross: an emotion name finds no asset macro and an asset name finds no emotion macro', () => {
        const targets = [target('desc', '{{image::happy}} {{emotion::happy}}'), target('regex/0/out', '@@emo happy')]
        expect(scanForName(targets, 'emotion', 'happy').matches.map((hit) => hit.syntax)).toEqual(['emotionMacro', 'emoScript'])
        expect(scanForName(targets, 'asset', 'happy').matches.map((hit) => hit.syntax)).toEqual(['macro'])
    })

    test('an unquoted src holding the name is flagged, not matched', () => {
        const scan = scanForName([target('desc', '<img src=smile>')], 'asset', 'smile')
        expect(scan.matches).toEqual([])
        expect(scan.flagged[0].reason).toBe('unquotedSrc')
    })

    test('hits come in target order, then position', () => {
        const scan = scanForName([target('a', 'x {{img::s}} {{img::s}}'), target('b', '{{img::s}}')], 'asset', 's')
        expect(scan.matches.map((hit) => [hit.path, hit.offset])).toEqual([['a', 9], ['a', 20], ['b', 7]])
    })
})

describe('creator comment language', () => {
    test('a hit carries the language of its section and xx outside every section', () => {
        const text = '{{image::a}} prefix\n# `ko`\n{{image::b}}\n# `en`\n{{img::c}}'
        const scan = scanForName([target('creatorNotes', text)], 'asset', 'a')
        expect(scan.matches[0].lang).toBe('xx')
        expect(creatorNotesLang(text, text.indexOf('b}}'))).toBe('ko')
        expect(creatorNotesLang(text, text.indexOf('c}}'))).toBe('en')
        expect(creatorNotesLang(text, 0)).toBe('xx')
    })

    test('creator text stored by the real encoder is found in the prefix and in its own section', () => {
        const stored = encodeCreatorNotes({ xx: '{{image::smile}}', ko: '{{img::smile}}' })
        const scan = scanForName([target('creatorNotes', stored)], 'asset', 'smile')
        expect(scan.matches.map((hit) => hit.lang)).toEqual(['xx', 'xx', 'ko'])
    })

    test('hits in other targets carry no language', () => {
        const scan = scanForName([target('desc', '{{img::smile}}')], 'asset', 'smile')
        expect(scan.matches[0].lang).toBeUndefined()
    })
})

// The engine's own functions are private, so the expectations below are derived by hand from them:
// - macro path: getClosestMatch (parser.svelte.ts), after the exact lookup over assetPaths (character rows win a
//   collision with module rows): trimmer both names (known extensions off, then spaces and everything from space
//   to '.' out), Levenshtein distance, the first strict minimum, nothing beyond assetMaxDifference, character rows only.
// - imgSrc path: ChatBody checkImg: the exact Map over module then character rows (the character wins), a src
//   under 3 characters ends, the prefix before the last dot must start the row name, raw distance, module rows first.
describe('closeMatch against the hand-derived engine table', () => {
    const rows = (...list: string[]): NameRow[] => list.map((name) => [name, 'p', 'png'])
    const macro = (characterRows: string[], moduleRows: string[], name: string, settings: Partial<CloseMatchSettings> = {}) =>
        closeMatch(rows(...characterRows), rows(...moduleRows), name, 'macro', { ...DEFAULT_SETTINGS, ...settings })
    const imgSrc = (characterRows: string[], moduleRows: string[], name: string, settings: Partial<CloseMatchSettings> = {}) =>
        closeMatch(rows(...characterRows), rows(...moduleRows), name, 'imgSrc', { ...DEFAULT_SETTINGS, ...settings })

    test('macro: the exact lookup comes first, ignoring case, and the character beats a module', () => {
        expect(macro(['Smile'], [], 'SMILE')).toBe('Smile')
        expect(macro(['x'], ['X'], 'X')).toBe('x')
        expect(macro(['aaa'], ['smile'], 'Smile')).toBe('smile')
    })

    test('macro: the nearest character row by trimmed distance, up to assetMaxDifference 4', () => {
        expect(macro(['smile.png'], [], 'smyle')).toBe('smile.png')
        expect(macro(['abcd'], [], 'abcdefgh')).toBe('abcd')
        expect(macro(['abcd'], [], 'abcdefghi')).toBeNull()
        expect(macro(['ab'], [], 'a b')).toBe('ab')
        expect(macro(['a!b'], [], 'ab')).toBe('a!b')
        // Over assetMaxDifference untrimmed, equal once spaces, underscores and the space-to-dot range are out.
        expect(macro(['abcdef'], [], 'a_b_c_d_e_f')).toBe('abcdef')
        expect(macro(['abcdef'], [], 'a!b!c!d!e!f')).toBe('abcdef')
        expect(macro(['abcdef.webp'], [], 'abcdef.ogg')).toBe('abcdef.webp')
    })

    test('macro: the first of equally near rows wins', () => {
        expect(macro(['axc', 'ayc'], [], 'azc')).toBe('axc')
    })

    test('macro: legacyMediaFindings ends the near lookup but not the exact one', () => {
        expect(macro(['smile.png'], [], 'smyle', { legacyMediaFindings: true })).toBeNull()
        expect(macro(['Smile'], [], 'smile', { legacyMediaFindings: true })).toBe('Smile')
    })

    test('macro: module rows never fuzzy-match, even when strictly nearer than every character row', () => {
        expect(macro([], ['smile'], 'smyle')).toBeNull()
        expect(macro(['abcdef'], ['smile'], 'smile_')).toBeNull()
    })

    test('imgSrc: nothing resolves unless newImageHandlingBeta is on', () => {
        expect(imgSrc(['Smile.png'], [], 'smile.png', { newImageHandlingBeta: false })).toBeNull()
        expect(imgSrc(['Smile.png'], [], 'smile.PNG')).toBe('Smile.png')
    })

    test('imgSrc: the character beats a module on an exact hit', () => {
        expect(imgSrc(['x.png'], ['X.PNG'], 'x.png')).toBe('x.png')
    })

    test('imgSrc: a colon or more than 200 characters is no name, whatever the rows', () => {
        expect(imgSrc(['a:b'], [], 'a:b')).toBeNull()
        expect(imgSrc(['a'.repeat(201)], [], 'a'.repeat(201))).toBeNull()
    })

    test('imgSrc: a src under 3 characters never matches a near row; at 3 it can', () => {
        expect(imgSrc(['smi'], [], 'sm')).toBeNull()
        expect(imgSrc(['smi'], [], 'smx')).toBe('smi')
    })

    test('imgSrc: the prefix before the last dot must start the row name', () => {
        expect(imgSrc(['smile_m.png'], [], 'smile_n.png')).toBeNull()
        expect(imgSrc(['smile_m'], [], 'smile_n')).toBe('smile_m')
        expect(imgSrc(['smile_n.jpg'], [], 'smile_n.png')).toBe('smile_n.jpg')
    })

    test('imgSrc: module rows count, and the first minimum is taken module rows first', () => {
        expect(imgSrc([], ['smile_m'], 'smile_n')).toBe('smile_m')
        expect(imgSrc(['axc'], ['ayc'], 'azc')).toBe('ayc')
    })

    test('imgSrc: it is not gated by legacyMediaFindings, and compares raw names without trimming', () => {
        expect(imgSrc(['smile_m'], [], 'smile_n', { legacyMediaFindings: true })).toBe('smile_m')
        expect(imgSrc(['ac'], [], 'a_c')).toBe('ac')
    })

    test('imgSrc: nothing beyond assetMaxDifference', () => {
        expect(imgSrc(['abcd'], [], 'abcdefgh')).toBe('abcd')
        expect(imgSrc(['abcd'], [], 'abcdefghi')).toBeNull()
    })
})
