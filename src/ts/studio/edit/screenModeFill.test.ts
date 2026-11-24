// @vitest-environment jsdom
// A-T6, A-T15 and the tag defaults: the mode-switch step. The step must land exactly what classic's `updateInlayScreen`
// fills, as one step whose ops are the switch and the keys whose live reading differs from the classic string, and one
// undo must give every field back. REAL: the builder, the live reader, the character writer and the replay planner.
import { describe, expect, test, vi } from 'vitest'
import { updateInlayScreen } from 'src/ts/process/inlayScreenFill'
import { applyCharacterDefaults } from 'src/ts/storage/characterDefaults'
import type { character } from 'src/ts/storage/database.svelte'
import { emptyRecord, planReplay, type Op, type Step } from '../history/historyModel'
import { characterOwnerKey } from '../history/ownerPhase'
import { buildScreenModeSwitch, modeDefaultOf, NEW_GEN_PATHS, type NewGenPath, type ScreenModeChange } from './screenModeFill'
import { applyCharacterWrites, createLiveReader } from './studioSetters'

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

const OWNER = characterOwnerKey('c1')
type Gen = { prompt: string; negative: string; instructions: string; emotionInstructions: string }
type Bag = Record<string, unknown>
const bag = (value: character): Bag => value as unknown as Bag

function characterOf(over: Record<string, unknown> = {}): character {
    return applyCharacterDefaults({ chaId: 'c1', ...over } as unknown as character) as character
}

const seedGen = (value: character): Gen => {
    const held = bag(value).newGenData as Partial<Gen> | undefined | null
    return { prompt: held?.prompt ?? '', negative: held?.negative ?? '', instructions: held?.instructions ?? '', emotionInstructions: held?.emotionInstructions ?? '' }
}

// What classic does for the same change, on a clone.
function classicResult(value: character, change: ScreenModeChange): character {
    const copy = structuredClone(value) as character
    if ('viewScreen' in change) copy.viewScreen = change.viewScreen
    else copy.inlayViewScreen = change.inlay
    return updateInlayScreen(copy)
}

function keyOf(path: NewGenPath): keyof Gen {
    return path.slice('newGenData.'.length) as keyof Gen
}

interface Landed {
    live: character
    ops: Op[]
    step: Step
    before: character
}

function land(value: character, change: ScreenModeChange): Landed {
    const live = structuredClone(value) as character
    const before = structuredClone(value) as character
    const built = buildScreenModeSwitch(change, createLiveReader({ character: live, chat: null }))
    if (built.ok === false) {
        throw new Error(`refused: ${built.reason}`)
    }
    applyCharacterWrites(live, built.writes, null)
    expect(built.coalesceKey).toBeNull()
    expect(built.label).toEqual({ kind: 'field', field: 'viewScreen' in change ? 'viewScreen' : 'inlayViewScreen' })
    return { live, ops: built.ops, step: { id: 'p:1', at: 1, label: built.label, ops: built.ops }, before }
}

function undo(landed: Landed): void {
    const plan = planReplay({ ...emptyRecord(OWNER, 0), done: [landed.step] }, 'undo', createLiveReader({ character: landed.live, chat: null }))
    if (plan.ok === false) {
        throw new Error(`undo refused: ${plan.reason}`)
    }
    applyCharacterWrites(landed.live, plan.writes, null)
}

function setOf(op: Op): { path: string; before: unknown; after: unknown } {
    if (op.op !== 'set') throw new Error('not a set')
    return { path: op.path, before: op.before, after: op.after }
}

const FULL = (over: Partial<Gen> = {}): Gen => ({ prompt: '', negative: '', instructions: '', emotionInstructions: '', ...over })

describe('A-T6: the mode switch lands what classic fills, as one step with an exact op list', () => {
    const cases: { name: string; start: Record<string, unknown>; change: ScreenModeChange }[] = [
        { name: 'none to emotion, inlay off, container present', start: { newGenData: FULL() }, change: { viewScreen: 'emotion' } },
        { name: 'none to emotion, inlay on', start: { inlayViewScreen: true, newGenData: FULL() }, change: { viewScreen: 'emotion' } },
        { name: 'emotion to imggen', start: { viewScreen: 'emotion', newGenData: FULL({ emotionInstructions: 'x' }) }, change: { viewScreen: 'imggen' } },
        { name: 'imggen to none', start: { viewScreen: 'imggen', newGenData: FULL({ prompt: 'best quality, {{slot}}', negative: 'worse quality' }) }, change: { viewScreen: 'none' } },
        { name: 'a field with author text keeps it', start: { viewScreen: 'imggen', newGenData: FULL({ prompt: 'my prompt', negative: 'worse quality' }) }, change: { viewScreen: 'none' } },
        { name: 'inlay switched on under imggen swaps the instructions default', start: { viewScreen: 'imggen', newGenData: FULL({ prompt: 'best quality, {{slot}}', negative: 'worse quality' }) }, change: { inlay: true } },
        { name: 'none to imggen on an absent container', start: {}, change: { viewScreen: 'imggen' } },
        { name: 'none to emotion on an absent container', start: {}, change: { viewScreen: 'emotion' } },
        { name: 'imggen to none on an absent container (nothing to fill)', start: { viewScreen: 'imggen' }, change: { viewScreen: 'none' } },
    ]

    test.each(cases)('$name: the four keys and the switch equal updateInlayScreen on a clone, in one step', ({ start, change }) => {
        const landed = land(characterOf(start), change)
        const expected = classicResult(characterOf(start), change)
        expect(landed.live.viewScreen).toBe(expected.viewScreen)
        expect(landed.live.inlayViewScreen === true).toBe(expected.inlayViewScreen === true)
        expect(seedGen(landed.live)).toEqual(seedGen(expected))
        expect(landed.ops.length).toBeGreaterThan(0)
    })

    test.each(cases)('$name: the op list is the switch then a set for each key whose live reading differs, exactly', ({ start, change }) => {
        const original = characterOf(start)
        const landed = land(original, change)
        const expected = classicResult(characterOf(start), change)
        const switchPath = 'viewScreen' in change ? 'viewScreen' : 'inlayViewScreen'
        const container = bag(original).newGenData as Partial<Gen> | undefined
        const want: { path: string; before: unknown; after: unknown }[] = [
            { path: switchPath, before: { had: true, value: switchPath === 'viewScreen' ? original.viewScreen : (original.inlayViewScreen ?? false) }, after: { had: true, value: 'viewScreen' in change ? change.viewScreen : change.inlay } },
        ]
        // `inlayViewScreen` is absent on a defaults-built character: its before reading is absent, not false.
        if (switchPath === 'inlayViewScreen') want[0].before = original.inlayViewScreen === undefined ? { had: false } : { had: true, value: original.inlayViewScreen }
        for (const path of NEW_GEN_PATHS) {
            const key = keyOf(path)
            const read = container?.[key]
            const target = seedGen(expected)[key]
            // An absent container reads as its seed; a missing key in a present container reads as absent.
            const before = container === undefined ? { had: true, value: '' } : read === undefined ? { had: false } : { had: true, value: read }
            if (before.had === true && before.value === target) continue
            want.push({ path, before, after: { had: true, value: target } })
        }
        expect(landed.ops.map(setOf)).toEqual(want)
    })

    test('the case with a key already equal to the classic result gains no op for that key', () => {
        const start = { newGenData: FULL({ prompt: 'best quality, {{slot}}' }) }
        const landed = land(characterOf(start), { viewScreen: 'imggen' })
        expect(landed.ops.map((op) => setOf(op).path)).toEqual(['viewScreen', 'newGenData.negative', 'newGenData.instructions'])
    })

    test('none to emotion with the container present writes the switch and the emotion instructions only', () => {
        const landed = land(characterOf({ newGenData: FULL() }), { viewScreen: 'emotion' })
        expect(landed.ops.map((op) => setOf(op).path)).toEqual(['viewScreen', 'newGenData.emotionInstructions'])
    })

    test.each(cases.filter((entry) => entry.start.newGenData !== undefined))('$name: one undo returns the character deep-equal to the original', ({ start, change }) => {
        const landed = land(characterOf(start), change)
        undo(landed)
        expect(landed.live).toEqual(landed.before)
    })

    test('an absent container: the filling mode creates it from the seed, and undo leaves the seed reading (a container is never deleted)', () => {
        const landed = land(characterOf(), { viewScreen: 'emotion' })
        expect(landed.before).not.toHaveProperty('newGenData')
        expect(bag(landed.live).newGenData).toBeDefined()
        undo(landed)
        expect(landed.live.viewScreen).toBe('none')
        expect(seedGen(landed.live)).toEqual(seedGen(landed.before))
        expect(seedGen(landed.live)).toEqual(FULL())
    })

    test('an absent container with a mode that fills nothing builds no key op, and classic would create the container with empty keys', () => {
        const start = { viewScreen: 'imggen' }
        const landed = land(characterOf(start), { viewScreen: 'none' })
        expect(landed.ops.map((op) => setOf(op).path)).toEqual(['viewScreen'])
        const classic = classicResult(characterOf(start), { viewScreen: 'none' })
        expect(seedGen(landed.live)).toEqual(seedGen(classic))
        expect(landed.live).not.toHaveProperty('newGenData')
    })

    test('a container lacking a key: the missing key reads absent, the step writes it, and undo deletes it again (deep-equal)', () => {
        const container: Partial<Gen> = { prompt: '', instructions: '', emotionInstructions: '' }
        const start = { newGenData: container }
        const landed = land(characterOf(start), { viewScreen: 'imggen' })
        const negativeOp = landed.ops.map(setOf).find((op) => op.path === 'newGenData.negative')
        expect(negativeOp).toEqual({ path: 'newGenData.negative', before: { had: false }, after: { had: true, value: 'worse quality' } })
        expect(bag(landed.live).newGenData).toHaveProperty('negative', 'worse quality')
        undo(landed)
        expect(landed.live).toEqual(landed.before)
        expect(bag(landed.live).newGenData).not.toHaveProperty('negative')
    })

    test('an unchanged switch builds nothing', () => {
        const built = buildScreenModeSwitch({ viewScreen: 'none' }, createLiveReader({ character: characterOf(), chat: null }))
        expect(built).toEqual({ ok: false, reason: 'unchanged' })
        const inlay = buildScreenModeSwitch({ inlay: false }, createLiveReader({ character: characterOf({ inlayViewScreen: false }), chat: null }))
        expect(inlay).toEqual({ ok: false, reason: 'unchanged' })
    })

    test('an absent viewScreen is refused: an undo could not put the key back', () => {
        const live = characterOf()
        delete (live as Partial<character>).viewScreen
        expect(buildScreenModeSwitch({ viewScreen: 'emotion' }, createLiveReader({ character: live, chat: null }))).toEqual({ ok: false, reason: 'precondition' })
    })
})

describe('A-T15 (MC-4134): the inlay switch writes nothing outside inlayViewScreen and the newGenData keys', () => {
    test('turn-on with additionalAssets absent leaves the key absent, and turn-off with [] leaves []', () => {
        const absent = characterOf({ viewScreen: 'emotion', newGenData: FULL() })
        delete (absent as Partial<character>).additionalAssets
        const on = land(absent, { inlay: true })
        expect('additionalAssets' in on.live).toBe(false)
        const empty = characterOf({ viewScreen: 'emotion', inlayViewScreen: true, additionalAssets: [], newGenData: FULL() })
        const off = land(empty, { inlay: false })
        expect(off.live.additionalAssets).toEqual([])
        for (const landed of [on, off]) {
            for (const op of landed.ops) {
                expect(['inlayViewScreen', ...NEW_GEN_PATHS]).toContain(setOf(op).path)
            }
        }
    })
})

describe('modeDefaultOf: the wording the fill writes into an empty key', () => {
    test('equals the classic result for an empty container, per mode and inlay setting', () => {
        for (const viewScreen of ['none', 'emotion', 'imggen'] as const) {
            for (const inlay of [false, true]) {
                const classic = updateInlayScreen(characterOf({ viewScreen, inlayViewScreen: inlay, newGenData: FULL() }))
                for (const path of NEW_GEN_PATHS) {
                    expect(modeDefaultOf(path, viewScreen, inlay), `${viewScreen} ${inlay} ${path}`).toBe(seedGen(classic)[keyOf(path)])
                }
            }
        }
        expect(modeDefaultOf('newGenData.prompt', 'imggen', false)).toBe('best quality, {{slot}}')
        expect(modeDefaultOf('newGenData.negative', 'imggen', true)).toBe('worse quality')
        expect(modeDefaultOf('newGenData.prompt', 'none', false)).toBe('')
    })
})
