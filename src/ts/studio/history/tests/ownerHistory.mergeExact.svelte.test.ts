// @vitest-environment jsdom
// The exact rule of a merge replay, through the real history service over the memory store double. A merge's text
// edit is replayed at its offset only while the scanner reads an unflagged reference there whose whole name span is
// exactly the edit's span, and the text holds the expected name. Anything else at that spot (a longer name, a plain
// word, a name list, a flagged reference, another macro) is left alone and the target is listed once in
// `notRestored`. Accepted limitation L1: a place is known by its offset and its whole name only, so a reference with
// the same whole name at the same offset counts as the same place, whichever occurrence, type word or kind it is.
// Models come from `buildMergePreview` over the live character, the real producer.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { retainedNamesOf } from 'src/ts/storage/store2/lists/assetList'
import { ASSET_RETAINED_KEY } from 'src/ts/studio/assets/assetOwnerKeys'
import { groupDuplicates } from 'src/ts/studio/assets/duplicateGroups'
import { DEFAULT_SETTINGS, groupRow } from 'src/ts/studio/assets/assetFixtures.test-helpers'
import { buildMergePreview, type MergePreview } from 'src/ts/studio/assets/mergePreview'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import type { SurvivorDeps } from '../../edit/assetSetters'
import { createOwnerHistoryService, type OwnerHistoryService, type StudioResult } from '../ownerHistory.svelte'
import { characterOwnerKey } from '../ownerPhase'
import { createFakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from './studioStoreDoubles'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: { characters: [], modules: [] } },
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        clearCharEmotionCache: () => {},
    }
})

type Row = [string, string, string]
type EmotionRow = [string, string]
type Kind = 'asset' | 'emotion'
type Place = 'lore' | 'out'

interface LiveCharacter {
    chaId: string
    desc: string
    firstMessage?: string
    exampleMessage: string
    alternateGreetings: string[]
    globalLore: { key: string; content: string }[]
    customscript: { in: string; out: string; type: string }[]
    chats: { id: string; note: string; fmIndex?: number }[]
    chatPage: number
    additionalAssets: Row[]
    emotionImages: EmotionRow[]
    [ASSET_RETAINED_KEY]?: unknown
}

const SMILE: Row = ['smile', 'assets/smile.png', 'png']
const WAVE: Row = ['wave', 'assets/wave.png', 'png']
// The same file as `smile` under another name, so removing it leaves a survivor by path.
const GRIN: Row = ['grin', 'assets/smile.png', 'png']
const GRIN2: Row = ['grin2', 'assets/smile.png', 'png']
const E_SMILE: EmotionRow = ['smile', 'assets/smile.png']
const E_GRIN: EmotionRow = ['grin', 'assets/smile.png']

function makeCharacter(over: Partial<LiveCharacter> = {}): LiveCharacter {
    return {
        chaId: 'A',
        desc: 'd0',
        exampleMessage: 'ex0',
        alternateGreetings: [],
        globalLore: [],
        customscript: [],
        chats: [{ id: 'c1', note: '', fmIndex: 0 }],
        chatPage: 0,
        additionalAssets: [[...SMILE], [...WAVE], [...GRIN]],
        emotionImages: [],
        ...over,
    }
}

function putCharacter(character: LiveCharacter): void {
    DBState.db.characters = [character] as unknown as typeof DBState.db.characters
}

const live = (): LiveCharacter => (DBState.db.characters as unknown as LiveCharacter[])[0]

const A = characterOwnerKey('A')

// A survivor check that finds one by path only: the removed row shares a path with the kept one.
const byPathOnly: SurvivorDeps = { hashOf: () => undefined }

// The merge model the preview builds from the live character, as the click-time rebuild does.
function modelOf(kind: Kind, keptName = 'smile', removedName = 'grin'): MergePreview {
    const source = live()
    const rows = kind === 'asset' ? source.additionalAssets : source.emotionImages
    const group = groupDuplicates(rows.map((row, index) => groupRow(row[0], row[1], index)))
        .find((candidate) => candidate.cls === 'sameFileDifferentNames' && [keptName, removedName].every((name) => candidate.rows.some((row) => row.name === name)))
    if (!group) {
        throw new Error('no candidate group')
    }
    return buildMergePreview({ kind: 'character', source }, kind, group, keptName, [], DEFAULT_SETTINGS)
}

let harness: { service: OwnerHistoryService }

const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

beforeEach(() => {
    h.marks = 0
    tracker.character.length = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    putCharacter(makeCharacter())
    selIdState.selId = 0
    studioScreen.chaId = 'A'
    harness = {
        service: createOwnerHistoryService({
            store: createMemoryStudioStore(),
            claim: createClaimDouble(),
            clock: createFakeClock(),
            pageSession: 'p1',
            getVisitId: () => 'v1',
            registerLeaveFlush: () => () => {},
            openModuleId: () => null,
        }),
    }
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

// ---------------------------------------------------------------- one text, three legs

interface Scenario {
    place: Place
    kind: Kind
    /** The text before the merge; the removed name is `grin`, the kept name `smile`. */
    base: string
}

interface Field {
    target: string
    get: () => string
    set: (text: string) => void
}

async function land(scenario: Scenario): Promise<Field> {
    const rows =
        scenario.kind === 'asset'
            ? { additionalAssets: [[...SMILE], [...WAVE], [...GRIN]] as Row[], emotionImages: [] }
            : { additionalAssets: [], emotionImages: [[...E_SMILE], [...E_GRIN]] as EmotionRow[] }
    putCharacter(
        makeCharacter({
            ...rows,
            globalLore: scenario.place === 'lore' ? [{ key: 'k', content: scenario.base }] : [],
            customscript: scenario.place === 'out' ? [{ in: 'a', out: scenario.base, type: 'editoutput' }] : [],
        }),
    )
    delete (live() as Partial<LiveCharacter>).firstMessage
    await harness.service.whenReady(A)
    expect(harness.service.assetMerge(A, modelOf(scenario.kind), byPathOnly).ok).toBe(true)
    return scenario.place === 'lore'
        ? { target: 'lore/0/content', get: () => live().globalLore[0].content, set: (text) => { live().globalLore[0].content = text } }
        : { target: 'regex/0/out', get: () => live().customscript[0].out, set: (text) => { live().customscript[0].out = text } }
}

// The undo leg: the kept name has been typed over by `outside`.
async function undoLeg(scenario: Scenario, outside: string): Promise<{ result: StudioResult; text: string }> {
    const field = await land(scenario)
    field.set(outside)
    const result = harness.service.undo(A)
    return { result, text: field.get() }
}

// The redo leg: a clean undo, then `outside` typed over the restored removed name.
async function redoLeg(scenario: Scenario, outside: string): Promise<{ result: StudioResult; text: string }> {
    const field = await land(scenario)
    expect(harness.service.undo(A).ok).toBe(true)
    expect(field.get()).toBe(scenario.base)
    field.set(outside)
    const result = harness.service.redo(A)
    return { result, text: field.get() }
}

// The `atTarget` leg: `outside` holds something shaped like the removed name where the undo would write it, so an
// undo that took it for "already restored" would leave the text unlisted.
async function atTargetLeg(scenario: Scenario, outside: string): Promise<{ result: StudioResult; text: string }> {
    const field = await land(scenario)
    field.set(outside)
    const result = harness.service.undo(A)
    return { result, text: field.get() }
}

// ---------------------------------------------------------------- what is left alone

interface LeftClass {
    id: string
    place?: Place
    kind?: Kind
    base: string
    /** The outside text; `%` stands for the name the leg expects at the offset (`smile` on undo, `grin` otherwise). */
    text: string
}

const LEFT: LeftClass[] = [
    // a longer name around the span
    { id: 'N1 prefix before the span', base: 'x {{image::grin}} y', text: '{{image::AB%}} y' },
    { id: 'P2 suffix after the span', base: 'x {{image::grin}} y', text: 'x {{image::%y}} y' },
    { id: 'N1n prefix and a shorter type word', base: '{{image::grin}} y', text: '{{img::my%}} y' },
    { id: 'N1p asset prompt, underscore dropped, prefix', base: '{{asset_prompt::grin}} y', text: '{{assetprompt::X%}} y' },
    { id: 'asset prompt, suffix', base: '{{asset_prompt::grin}} y', text: '{{asset_prompt::%X}} y' },
    // quotes, colons, a single brace, blanks
    { id: 'P4 apostrophe after the name', base: 'x {{image::grin}} y', text: "x {{image::%'s alt}} y" },
    { id: 'P5 double quote after the name', base: 'x {{image::grin}} y', text: 'x {{image::%"2}} y' },
    { id: 'N2a colon and blanks after the name', base: 'x {{image::grin}} y', text: 'x {{image::%: alt two}} y' },
    { id: 'double colon before the name', base: 'xxxx {{image::grin}} y', text: 'x {{image::a::%}} y' },
    { id: 'N2b a single closing brace after the name', base: 'x {{image::grin}} y', text: 'x {{image::%}x}} y' },
    { id: 'N2c trailing blanks to the end after a broken macro', base: 'x {{image::grin}} y', text: 'x {{image::%   ' },
    // a dynamic name, and an unterminated macro in front
    { id: 'dynamic name before the span', base: 'aaaaaaaaaaaaa{{image::grin}} y', text: '{{image::{{getvar::x}}%}} y' },
    { id: 'dynamic name after the span', base: '{{image::grin}} y', text: '{{image::%{{x}}}} y' },
    { id: 'P7 unterminated macro in front, a longer name', base: 'aaaaaaaaaaaaa{{image::grin}} y', text: '{{image::aaa {{image::%y}} y' },
    { id: 'A6 unterminated macro in front, the exact name', base: 'aaaaaaaaaaaaa{{image::grin}} y', text: '{{image::aaa {{image::%}} y' },
    // src
    { id: 'src double quoted, a longer name', base: 'x <img src="grin"> y', text: 'x <img src="%y"> y' },
    { id: 'src single quoted, a longer name', base: "x <img src='grin'> y", text: "x <img src='%y'> y" },
    { id: 'B5 unquoted src at the offset is flagged', base: 'x <img src="grin"> y', text: 'xy <img src=%> y' },
    // @@emo in a regex out
    { id: 'emoScript suffix', place: 'out', kind: 'emotion', base: '@@emo grin', text: '@@emo %y' },
    { id: 'emoScript prefix', place: 'out', kind: 'emotion', base: '@@emo  grin', text: '@@emo X%' },
    { id: 'emoScript text in a lore entry is no reference', kind: 'emotion', base: 'x {{emotion::grin}} y', text: 'xxxxxxx@@emo %' },
    // {{emotion::}}
    { id: 'emotion macro prefix', kind: 'emotion', base: 'x {{emotion::grin}} y', text: '{{emotion::AB%}} y' },
    { id: 'emotion macro suffix', kind: 'emotion', base: 'x {{emotion::grin}} y', text: 'x {{emotion::%y}} y' },
    { id: 'emotion macro quote', kind: 'emotion', base: 'x {{emotion::grin}} y', text: "x {{emotion::%'s}} y" },
    // text that is no reference
    { id: 'A2 a plain word', base: 'x {{image::grin}} y', text: 'She gave a % today' },
    { id: 'A3 a name list entry', base: 'x {{image::grin}} y', text: 'abcd{{ele::%,wave}} y' },
    { id: 'A4 a source macro', base: 'x {{image::grin}} y', text: 'a{{source::%}} y' },
    // a different name of the same length
    { id: 'a different name of the same length', base: 'x {{image::grin}} y', text: 'x {{image::smirk}} y' },
]

function fill(template: string, name: string): string {
    return template.replace('%', name)
}

function scenarioOf(entry: LeftClass): Scenario {
    return { place: entry.place ?? 'lore', kind: entry.kind ?? 'asset', base: entry.base }
}

describe('the matrix: a place that is no longer exactly the name is left alone and listed once', () => {
    test('every class puts the expected name at the recorded offset, so the rows probe what they claim', () => {
        for (const entry of LEFT) {
            if (entry.text.includes('%')) {
                expect(entry.text.indexOf('%'), entry.id).toBe(entry.base.indexOf('grin'))
            }
        }
    })

    test.each(LEFT.map((entry) => [entry.id, entry] as const))('undo leaves %s', async (_id, entry) => {
        const scenario = scenarioOf(entry)
        const outside = fill(entry.text, 'smile')
        const { result, text } = await undoLeg(scenario, outside)
        expect(text).toBe(outside)
        expect(result).toEqual({ ok: true, skipped: 1, notRestored: [scenario.place === 'lore' ? 'lore/0/content' : 'regex/0/out'] })
    })

    test.each(LEFT.map((entry) => [entry.id, entry] as const))('redo leaves %s', async (_id, entry) => {
        const scenario = scenarioOf(entry)
        const outside = fill(entry.text, 'grin')
        const { result, text } = await redoLeg(scenario, outside)
        expect(text).toBe(outside)
        expect(result).toEqual({ ok: true, skipped: 1, notRestored: [scenario.place === 'lore' ? 'lore/0/content' : 'regex/0/out'] })
    })

    test.each(LEFT.map((entry) => [entry.id, entry] as const))('an undo over %s shaped like the removed name does not take it for restored', async (_id, entry) => {
        const scenario = scenarioOf(entry)
        const outside = fill(entry.text, 'grin')
        const { result, text } = await atTargetLeg(scenario, outside)
        expect(text).toBe(outside)
        expect(result).toEqual({ ok: true, skipped: 1, notRestored: [scenario.place === 'lore' ? 'lore/0/content' : 'regex/0/out'] })
    })

    test('A9 two occurrences, the lower one edited to another length: both are left and the target is listed once', async () => {
        const scenario: Scenario = { place: 'lore', kind: 'asset', base: '{{image::grin}} and {{image::grin}} y' }
        const field = await land(scenario)
        expect(field.get()).toBe('{{image::smile}} and {{image::smile}} y')
        field.set('{{image::smiley}} and {{image::smile}} y')
        expect(harness.service.undo(A)).toEqual({ ok: true, skipped: 2, notRestored: ['lore/0/content'] })
        expect(field.get()).toBe('{{image::smiley}} and {{image::smile}} y')
    })
})

// ---------------------------------------------------------------- what is restored

interface RoundTrip {
    id: string
    place?: Place
    kind?: Kind
    base: string
    merged: string
}

const ROUND_TRIPS: RoundTrip[] = [
    { id: 'image macro', base: 'x {{image::grin}} y', merged: 'x {{image::smile}} y' },
    { id: 'img macro', base: 'x {{img::grin}} y', merged: 'x {{img::smile}} y' },
    { id: 'raw macro', base: 'x {{raw::grin}} y', merged: 'x {{raw::smile}} y' },
    { id: 'path macro', base: 'x {{path::grin}} y', merged: 'x {{path::smile}} y' },
    { id: 'video macro', base: 'x {{video::grin}} y', merged: 'x {{video::smile}} y' },
    { id: 'audio macro', base: 'x {{audio::grin}} y', merged: 'x {{audio::smile}} y' },
    { id: 'bgm macro', base: 'x {{bgm::grin}} y', merged: 'x {{bgm::smile}} y' },
    { id: 'bg macro', base: 'x {{bg::grin}} y', merged: 'x {{bg::smile}} y' },
    { id: 'asset macro', base: 'x {{asset::grin}} y', merged: 'x {{asset::smile}} y' },
    { id: 'video-img macro', base: 'x {{video-img::grin}} y', merged: 'x {{video-img::smile}} y' },
    { id: 'asset_prompt', base: 'x {{asset_prompt::grin}} y', merged: 'x {{asset_prompt::smile}} y' },
    { id: 'assetprompt', base: 'x {{assetprompt::grin}} y', merged: 'x {{assetprompt::smile}} y' },
    { id: 'src double quoted', base: 'x <img src="grin"> y', merged: 'x <img src="smile"> y' },
    { id: 'src single quoted', base: "x <img class='c' src='grin'> y", merged: "x <img class='c' src='smile'> y" },
    { id: 'emotion macro', kind: 'emotion', base: 'x {{emotion::grin}} y', merged: 'x {{emotion::smile}} y' },
    { id: 'emoScript', place: 'out', kind: 'emotion', base: '@@emo grin', merged: '@@emo smile' },
    { id: 'emoScript with trailing blanks', place: 'out', kind: 'emotion', base: '@@emo grin   ', merged: '@@emo smile   ' },
    { id: 'emoScript with leading blanks', place: 'out', kind: 'emotion', base: '@@emo   grin', merged: '@@emo   smile' },
    { id: 'a macro in a regex out', place: 'out', base: 'x {{image::grin}} y', merged: 'x {{image::smile}} y' },
    { id: 'two occurrences of two forms', base: '{{image::grin}} and {{img::grin}} y {{asset_prompt::grin}}', merged: '{{image::smile}} and {{img::smile}} y {{asset_prompt::smile}}' },
    { id: 'A5 a reference nested in an emotion macro', base: 'x {{emotion::{{image::grin}}}} y', merged: 'x {{emotion::{{image::smile}}}} y' },
    { id: 'A5b a reference nested in an asset prompt', base: 'x {{asset_prompt::see {{image::grin}} here}} y', merged: 'x {{asset_prompt::see {{image::smile}} here}} y' },
    { id: 'B1 a quoted src inside an asset prompt macro', base: 'x {{asset_prompt::see <img src="grin"> here}} y', merged: 'x {{asset_prompt::see <img src="smile"> here}} y' },
    { id: 'B2 a quoted src inside an emotion macro', base: 'x {{emotion::<img src="grin">}} y', merged: 'x {{emotion::<img src="smile">}} y' },
    { id: 'B4 two forms side by side and a second occurrence', base: '{{image::grin}}<img src="grin">{{asset_prompt::grin}} {{img::grin}}', merged: '{{image::smile}}<img src="smile">{{asset_prompt::smile}} {{img::smile}}' },
    { id: 'a name written in another case', base: 'x {{image::GRIN}} y', merged: 'x {{image::smile}} y' },
]

describe('a clean round trip puts every form back and nothing is skipped', () => {
    test.each(ROUND_TRIPS.map((entry) => [entry.id, entry] as const))('%s', async (_id, entry) => {
        const field = await land({ place: entry.place ?? 'lore', kind: entry.kind ?? 'asset', base: entry.base })
        expect(field.get()).toBe(entry.merged)
        expect(harness.service.undo(A)).toEqual({ ok: true })
        expect(field.get()).toBe(entry.base)
        expect(harness.service.redo(A)).toEqual({ ok: true })
        expect(field.get()).toBe(entry.merged)
    })

    test('B3 a media macro inside a quoted src is rewritten like any other, and the merge undoes cleanly', async () => {
        const scenario: Scenario = { place: 'lore', kind: 'asset', base: 'x <img src="{{image::grin}}"> y {{image::grin}}' }
        const field = await land(scenario)
        const merged = field.get()
        expect(merged).toBe('x <img src="{{image::smile}}"> y {{image::smile}}')
        expect(harness.service.undo(A)).toEqual({ ok: true })
        expect(field.get()).toBe(scenario.base)
        expect(harness.service.redo(A)).toEqual({ ok: true })
        expect(field.get()).toBe(merged)
    })

    test('A10 a name holding a quote, a colon, a single brace and blanks round-trips in a macro and in a src', async () => {
        const odd: Row = ["it's: a }b ", 'assets/smile.png', 'png']
        const base = "x {{image::it's: a }b }} <img src=\"it's: a }b \"> y"
        putCharacter(makeCharacter({ additionalAssets: [[...SMILE], [...WAVE], [...odd]], globalLore: [{ key: 'k', content: base }] }))
        delete (live() as Partial<LiveCharacter>).firstMessage
        await harness.service.whenReady(A)
        const model = modelOf('asset', 'smile', "it's: a }b ")
        expect(harness.service.assetMerge(A, model, byPathOnly).ok).toBe(true)
        const merged = live().globalLore[0].content
        expect(merged).toBe('x {{image::smile}} <img src="it\'s: a }b "> y')
        expect(harness.service.undo(A)).toEqual({ ok: true })
        expect(live().globalLore[0].content).toBe(base)
        expect(harness.service.redo(A)).toEqual({ ok: true })
        expect(live().globalLore[0].content).toBe(merged)
    })

    test('A7 the same reference moved to another type word, with more text in front, is still the same place: wanted', async () => {
        const field = await land({ place: 'lore', kind: 'asset', base: 'x {{image::grin}} y' })
        field.set('xyz {{img::smile}} y')
        expect(harness.service.undo(A)).toEqual({ ok: true })
        expect(field.get()).toBe('xyz {{img::grin}} y')
    })

    test('an emoScript name with blanks at an end is put back with its blanks, outside a regex out it is not read', async () => {
        const field = await land({ place: 'out', kind: 'emotion', base: '@@emo grin   ' })
        field.set('@@emo smile   ')
        expect(harness.service.undo(A)).toEqual({ ok: true })
        expect(field.get()).toBe('@@emo grin   ')
    })
})

// ---------------------------------------------------------------- accepted limitation L1

describe('L1: a place is known by its offset and its whole name only', () => {
    test('L1 A1: a reference of another kind with the same whole name at the offset is undone as the same place', async () => {
        const field = await land({ place: 'lore', kind: 'asset', base: 'x {{image::grin}} y' })
        field.set('{{emotion::smile}} y')
        expect(harness.service.undo(A)).toEqual({ ok: true })
        expect(field.get()).toBe('{{emotion::grin}} y')
    })

    test('L1 A8: an identical reference shifted onto the offset is undone as the same place', async () => {
        const field = await land({ place: 'lore', kind: 'asset', base: '{{image::grin}}{{image::smile}} y' })
        expect(field.get()).toBe('{{image::smile}}{{image::smile}} y')
        field.set('{{image::smile}} y')
        expect(harness.service.undo(A)).toEqual({ ok: true })
        expect(field.get()).toBe('{{image::grin}} y')
    })
})

// ---------------------------------------------------------------- MC-2218 narrowed: a rows-only step keeps its partial undo

describe('N5: a rows-only merge keeps today\'s partial undo', () => {
    test('one failing row insert is skipped and counted, the other row comes back', async () => {
        putCharacter(makeCharacter({ firstMessage: 'plain', globalLore: [{ key: 'k', content: 'x {{image::smile}} y' }], additionalAssets: [[...SMILE], [...WAVE], [...GRIN], [...GRIN2]] }))
        await harness.service.whenReady(A)
        expect(harness.service.assetMerge(A, modelOf('asset'), byPathOnly).ok).toBe(true)
        expect(harness.service.view(A).done[0].ops.map((op) => op.op)).toEqual(['assetRowRemove', 'assetRowRemove'])
        live().additionalAssets.push([...GRIN])
        expect(harness.service.undo(A)).toEqual({ ok: true, skipped: 1 })
        expect(live().additionalAssets.map((row) => row[0])).toEqual(['smile', 'wave', 'grin', 'grin2'])
        expect(retainedNamesOf(live()[ASSET_RETAINED_KEY])).toEqual(['assets/smile.png'])
    })
})

// ---------------------------------------------------------------- MC-2260: a gone file refuses a step with rows and a text

// A service that reads file states, so a replay asks whether the removed row's file is still there.
function serviceWithFiles(states: Map<string, 'present' | 'gone'>): OwnerHistoryService {
    return createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock: createFakeClock(),
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
        openModuleId: () => null,
        openAssetFileReader: async () => ({ concurrency: 1, stateOf: async (path: string) => states.get(path) ?? 'present' }),
    })
}

const rowNames = (): string[] => live().additionalAssets.map((row) => row[0])

describe('MC-2260: a merge whose removed row\'s file is gone is refused whole, a rows-only step is not', () => {
    const MERGED = 'x {{image::smile}} y'
    const BEFORE = 'x {{image::grin}} y'

    async function start(states: Map<string, 'present' | 'gone'>, content: string): Promise<void> {
        putCharacter(makeCharacter({ globalLore: [{ key: 'k', content }] }))
        harness = { service: serviceWithFiles(states) }
        await harness.service.whenReady(A)
    }

    test('an undo is refused: the texts stay on the kept name, the row stays absent, the step stays', async () => {
        const states = new Map<string, 'present' | 'gone'>()
        await start(states, BEFORE)
        expect(harness.service.assetMerge(A, modelOf('asset'), byPathOnly).ok).toBe(true)
        expect(live().globalLore[0].content).toBe(MERGED)
        const retained = retainedNamesOf(live()[ASSET_RETAINED_KEY])
        states.set('assets/smile.png', 'gone')
        expect(await harness.service.replay(A, { kind: 'undo' })).toEqual({ ok: false, reason: 'precondition' })
        expect(live().globalLore[0].content).toBe(MERGED)
        expect(rowNames()).toEqual(['smile', 'wave'])
        expect(retainedNamesOf(live()[ASSET_RETAINED_KEY])).toEqual(retained)
        expect(harness.service.view(A).done.map((step) => step.ops.map((op) => op.op))).toEqual([['assetRowRemove', 'textEdit']])
        expect(harness.service.view(A).undone).toHaveLength(0)
    })

    test('a redo is refused: a revert step undone while the file was present, then marked gone, stays undone', async () => {
        const states = new Map<string, 'present' | 'gone'>()
        await start(states, BEFORE)
        expect(harness.service.assetRename(A, 'additionalAssets', 1, 'wave2').ok).toBe(true)
        const baseId = harness.service.view(A).done[0].id
        expect(harness.service.assetMerge(A, modelOf('asset'), byPathOnly).ok).toBe(true)
        // The revert across the merge puts the row and the name back while the file is present; undoing it removes them again.
        expect((await harness.service.replay(A, { kind: 'revert', stepId: baseId })).ok).toBe(true)
        expect(live().globalLore[0].content).toBe(BEFORE)
        expect(await harness.service.replay(A, { kind: 'undo' })).toMatchObject({ ok: true })
        expect(live().globalLore[0].content).toBe(MERGED)
        expect(rowNames()).toEqual(['smile', 'wave2'])
        const retained = retainedNamesOf(live()[ASSET_RETAINED_KEY])
        states.set('assets/smile.png', 'gone')
        expect(await harness.service.replay(A, { kind: 'redo' })).toEqual({ ok: false, reason: 'precondition' })
        expect(live().globalLore[0].content).toBe(MERGED)
        expect(rowNames()).toEqual(['smile', 'wave2'])
        expect(retainedNamesOf(live()[ASSET_RETAINED_KEY])).toEqual(retained)
        expect(harness.service.view(A).undone).toHaveLength(1)
        expect(harness.service.view(A).done).toHaveLength(2)
    })

    test('a revert across the merge is refused: it stops at the merge and, with nothing older to apply, changes nothing', async () => {
        const states = new Map<string, 'present' | 'gone'>()
        await start(states, BEFORE)
        expect(harness.service.assetRename(A, 'additionalAssets', 1, 'wave2').ok).toBe(true)
        const baseId = harness.service.view(A).done[0].id
        expect(harness.service.assetMerge(A, modelOf('asset'), byPathOnly).ok).toBe(true)
        const retained = retainedNamesOf(live()[ASSET_RETAINED_KEY])
        states.set('assets/smile.png', 'gone')
        expect(await harness.service.replay(A, { kind: 'revert', stepId: baseId })).toEqual({ ok: false, reason: 'precondition' })
        expect(live().globalLore[0].content).toBe(MERGED)
        expect(rowNames()).toEqual(['smile', 'wave2'])
        expect(retainedNamesOf(live()[ASSET_RETAINED_KEY])).toEqual(retained)
        expect(harness.service.view(A).done).toHaveLength(2)
        expect(harness.service.view(A).undone).toHaveLength(0)
    })

    test('a rows-only step keeps today\'s partial result: the gone row is left out with the gone note', async () => {
        const states = new Map<string, 'present' | 'gone'>()
        await start(states, 'plain lore')
        expect(harness.service.assetMerge(A, modelOf('asset'), byPathOnly).ok).toBe(true)
        expect(harness.service.view(A).done[0].ops.map((op) => op.op)).toEqual(['assetRowRemove'])
        states.set('assets/smile.png', 'gone')
        const result = await harness.service.replay(A, { kind: 'undo' })
        expect(result).toMatchObject({ ok: true, goneRows: ['assets/smile.png'], goneName: 'grin' })
        expect(rowNames()).toEqual(['smile', 'wave'])
    })
})
