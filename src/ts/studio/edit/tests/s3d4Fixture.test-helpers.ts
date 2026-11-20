// The S3d4 device fixture shape (device/scripts/make-s3d4-fixture.mjs) built in memory, with the text every rewritable
// target must hold after renaming the `mood` toggle to `mood2`. The expected texts are built beside the originals from
// the same constructor, never from the scanner: a form carries its `mood2` spelling next to its `mood` spelling, and a
// reader the update must keep (`@toggle_mood(1)`, a dynamic name, Lua code, the module that defines `mood`) has the
// same text on both sides.

const WORDS = ['amber', 'birch', 'cedar', 'dune', 'elm', 'fern', 'glen', 'heath', 'iris', 'juniper', 'kelp', 'larch', 'moss', 'nettle', 'oak', 'pine', 'quartz', 'reed', 'sage', 'thorn', 'umber', 'vale', 'willow', 'yarrow']

const FORM_NAMES = ['getglobalvar', 'when', 'calc'] as const
type FormName = typeof FORM_NAMES[number]

const FORM_BEFORE: Record<FormName, string> = {
    getglobalvar: '{{getglobalvar::toggle_mood}}',
    when: '{{#when::mood::tis::1}}calm{{/when}}',
    calc: '{{? @toggle_mood + 1}}',
}

const FORM_AFTER: Record<FormName, string> = {
    getglobalvar: '{{getglobalvar::toggle_mood2}}',
    when: '{{#when::mood2::tis::1}}calm{{/when}}',
    calc: '{{? @toggle_mood2 + 1}}',
}

const CALC_WITH_ARGUMENT = '{{? @toggle_mood(1) + 1}}'
const DYNAMIC_READER = '{{getglobalvar::toggle_{{getvar::x}}}}'
const LUA_CODE = 'listenEdit("editInput", function(triggerId, data)\n  local v = getGlobalVar(triggerId, "toggle_mood")\n  return data\nend)\n'

/** A text and the text it must hold after the update. */
export interface TextPair {
    readonly before: string
    readonly after: string
}

export interface FixtureLoreEntry {
    key: string
    secondkey: string
    comment: string
    content: string
    mode: string
    insertorder: number
    alwaysActive: boolean
    selective: boolean
    bookVersion: number
}

export interface FixtureCharacter {
    type: 'character'
    chaId: string
    name: string
    desc: string
    firstMessage: string
    notes: string
    alternateGreetings: string[]
    globalLore: FixtureLoreEntry[]
    customscript: never[]
    triggerscript: { comment: string, type: string, conditions: never[], effect: { type: string, code: string }[] }[]
    chats: { id: string, name: string, note: string, localLore: never[], message: never[] }[]
    chatPage: number
    customModuleToggle: string
}

export interface FixtureRegexScript {
    comment: string
    in: string
    type: string
    ableFlag: boolean
    flag: string
    out: string
}

export interface FixtureModule {
    id: string
    name: string
    description: string
    lorebook: FixtureLoreEntry[]
    regex: FixtureRegexScript[]
    trigger: never[]
    assets: never[]
    customModuleToggle: string
}

export interface S3d4Expected {
    readonly desc: string
    readonly firstMessage: string
    readonly alternateGreetings: readonly string[]
    readonly loreContents: readonly string[]
    /** Per module, in fixture order. */
    readonly modules: readonly { readonly loreContents: readonly string[], readonly regexOut: readonly string[] }[]
}

export interface S3d4Fixture {
    character: FixtureCharacter
    modules: FixtureModule[]
    /** The character toggle text with `mood=` renamed to `mood2=`, as after the rename in the builder. */
    renamedToggleText: string
    /** What every text holds after update all; the character, module 0-7 targets carry the `mood2` forms. */
    expected: S3d4Expected
    /** The uses the constructor placed in rewritable owners: the character, and modules 0-7 at `perModule` each. */
    useCounts: { readonly character: number, readonly modulesWithUses: number, readonly perModule: number }
}

function mulberry32(seed: number): () => number {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6D2B79F5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

export function buildS3d4Fixture(): S3d4Fixture {
    const rnd = mulberry32(3404)
    const pool = Array.from({ length: 256 }, () => {
        const n = 40 + Math.floor(rnd() * 40)
        return Array.from({ length: n }, () => WORDS[Math.floor(rnd() * WORDS.length)]).join(' ') + '.\n'
    })
    const filler = (bytes: number): string => {
        const parts: string[] = []
        let size = 0
        while (size < bytes) {
            const piece = pool[Math.floor(rnd() * pool.length)]
            parts.push(piece)
            size += piece.length
        }
        return parts.join('')
    }
    let formCursor = 0
    const nextForm = (): FormName => FORM_NAMES[formCursor++ % FORM_NAMES.length]
    // `rewritten` is false for text whose owner the update skips: its expected text is its original.
    const withUses = (bytes: number, uses: number, rewritten: boolean): TextPair => {
        if (uses === 0) {
            const text = filler(bytes)
            return { before: text, after: text }
        }
        const seg = Math.max(1, Math.floor(bytes / (uses + 1)))
        let before = ''
        let after = ''
        for (let u = 0; u < uses; u++) {
            const form = nextForm()
            const part = filler(seg)
            before += part + ' ' + FORM_BEFORE[form] + ' '
            after += part + ' ' + (rewritten ? FORM_AFTER[form] : FORM_BEFORE[form]) + ' '
        }
        const tail = filler(seg)
        return { before: before + tail, after: after + tail }
    }
    const loreEntry = (tag: string, e: number, content: string): FixtureLoreEntry => ({
        key: `${tag}-k${e}`, secondkey: '', comment: `${tag}-c${e}`, content, mode: 'normal', insertorder: 100, alwaysActive: false, selective: false, bookVersion: 2,
    })

    const desc = withUses(1500000, 24, true)
    const firstMessageUses = withUses(600, 3, true)
    const firstMessage: TextPair = { before: firstMessageUses.before + ' ' + CALC_WITH_ARGUMENT, after: firstMessageUses.after + ' ' + CALC_WITH_ARGUMENT }
    const alternateGreetings = Array.from({ length: 12 }, () => withUses(100000, 2, true))
    const globalLore = Array.from({ length: 300 }, (_, e) => withUses(4000, e < 36 ? 1 : 0, true))

    const character: FixtureCharacter = {
        type: 'character', chaId: 'cha-1', name: 'S3d4 Large Synthetic', desc: desc.before, firstMessage: firstMessage.before, notes: '',
        alternateGreetings: alternateGreetings.map((pair) => pair.before),
        globalLore: globalLore.map((pair, e) => loreEntry('c', e, pair.before)),
        customscript: [],
        triggerscript: [{ comment: 's3d4-lua', type: 'start', conditions: [], effect: [{ type: 'triggerlua', code: LUA_CODE }] }],
        chats: [{ id: 'chat1', name: 'S3d4 chat', note: '', localLore: [], message: [] }],
        chatPage: 0,
        customModuleToggle: ['mood=Mood', 'energy=Energy', 'weather=Weather=select=sunny,rain,fog', 'notes=Notes=text', 'verbose=Verbose', 'gloss=Gloss'].join('\n'),
    }
    const renamedToggleText = character.customModuleToggle.replace('mood=', 'mood2=')

    const modules: FixtureModule[] = []
    const expectedModules: { loreContents: string[], regexOut: string[] }[] = []
    for (let m = 0; m < 20; m++) {
        const carries = m <= 7
        const defines = m === 8
        const loreUses = carries ? 8 : defines ? 10 : 0
        const regexUses = carries ? 6 : defines ? 2 : 0
        const lorePairs: TextPair[] = Array.from({ length: 25 }, (_, e) => {
            if (e < loreUses) {
                return withUses(1500, 1, carries)
            }
            const text = filler(1500)
            return { before: text, after: text }
        })
        if (m >= 2 && m <= 6) {
            for (let e = 10; e < 21; e++) {
                lorePairs[e] = { before: lorePairs[e].before + ' ' + CALC_WITH_ARGUMENT, after: lorePairs[e].after + ' ' + CALC_WITH_ARGUMENT }
            }
        }
        if (m === 1) {
            lorePairs[24] = { before: lorePairs[24].before + ' ' + DYNAMIC_READER, after: lorePairs[24].after + ' ' + DYNAMIC_READER }
        }
        const regexOut: TextPair[] = Array.from({ length: 6 }, (_, r) => {
            if (r < regexUses) {
                const form = nextForm()
                return { before: '$& ' + FORM_BEFORE[form], after: '$& ' + (carries ? FORM_AFTER[form] : FORM_BEFORE[form]) }
            }
            return { before: '$&', after: '$&' }
        })
        modules.push({
            id: `mod-${m}`, name: `S3d4 Module ${m}`, description: filler(300),
            lorebook: lorePairs.map((pair, e) => loreEntry(`m${m}`, e, pair.before)),
            regex: regexOut.map((pair, r) => ({ comment: `m${m}-r${r}`, in: `\\b${WORDS[r]}\\b`, type: 'editoutput', ableFlag: true, flag: 'g', out: pair.before })),
            trigger: [], assets: [],
            customModuleToggle: defines ? 'mood=Module mood\nmodopt=Module option' : `m${m}opt=Module ${m} option`,
        })
        expectedModules.push({ loreContents: lorePairs.map((pair) => pair.after), regexOut: regexOut.map((pair) => pair.after) })
    }

    return {
        character,
        modules,
        renamedToggleText,
        expected: {
            desc: desc.after,
            firstMessage: firstMessage.after,
            alternateGreetings: alternateGreetings.map((pair) => pair.after),
            loreContents: globalLore.map((pair) => pair.after),
            modules: expectedModules,
        },
        useCounts: { character: 24 + 3 + 24 + 36, modulesWithUses: 8, perModule: 14 },
    }
}
