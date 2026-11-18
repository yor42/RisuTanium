// @vitest-environment jsdom
// Two properties of the exact replay rule, through the real planner, history model, live reader and owner body.
// - Round trip: whatever the planner writes, the scanner reads back, so merge, undo and redo give the same texts with
//   nothing skipped. A place the planner writes and the scanner cannot read back is a planner defect.
// - Containment: after a random outside edit, an undo or redo changes only the places an independent scanning oracle
//   reads as an unflagged reference with exactly the expected name at exactly the recorded span; every other character
//   stays as the outside edit left it. The oracle scans by itself and never calls the model's own check.
import fc from 'fast-check'
import { describe, expect, test, vi } from 'vitest'
import { planRewrite, spliceTextEdits, type TextEdit } from '../../assets/referenceRewrite'
import { scanReferences, type AssetKind } from '../../assets/referenceScan'
import { applyCharacterWrites, createLiveReader, type LiveTarget } from '../../edit/studioSetters'
import {
    applyReplayMove,
    assetStepWrites,
    commitStep,
    createModelState,
    deriveRestoreWrites,
    emptyRecord,
    planReplay,
    textBeforeOf,
    type LiveReader,
    type ModelState,
    type Op,
} from '../historyModel'
import { characterOwnerKey } from '../ownerPhase'
import type { character } from 'src/ts/storage/database.svelte'

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

interface Holder {
    chaId: string
    desc: string
    firstMessage: string
    exampleMessage: string
    alternateGreetings: string[]
    globalLore: { key: string; content: string }[]
    customscript: { in: string; out: string; type: string }[]
    additionalAssets: string[][]
    emotionImages: string[][]
}

function holderWith(path: string, text: string): Holder {
    return {
        chaId: 'A',
        desc: '',
        firstMessage: '',
        exampleMessage: '',
        alternateGreetings: [],
        globalLore: path === 'lore/0/content' ? [{ key: 'k', content: text }] : [],
        customscript: path === 'regex/0/out' ? [{ in: 'a', out: text, type: 'editoutput' }] : [],
        additionalAssets: [],
        emotionImages: [],
    }
}

const textOfHolder = (holder: Holder, path: string): string => (path === 'lore/0/content' ? holder.globalLore[0].content : holder.customscript[0].out)

const A = characterOwnerKey('A')
const asCharacter = (holder: Holder): character => holder as unknown as character
const readerOf = (holder: Holder): LiveReader => {
    const target: LiveTarget = { character: asCharacter(holder), chat: null }
    return createLiveReader(target)
}

interface Form {
    label: string
    kind: AssetKind
    path: string
    text: (name: string) => string
}

const FORMS: Form[] = [
    { label: 'macro', kind: 'asset', path: 'lore/0/content', text: (n) => `x {{image::${n}}} y {{img::${n}}} z` },
    { label: 'assetPrompt', kind: 'asset', path: 'lore/0/content', text: (n) => `x {{asset_prompt::${n}}} y` },
    { label: 'srcDouble', kind: 'asset', path: 'lore/0/content', text: (n) => `x <img src="${n}"> y` },
    { label: 'srcSingle', kind: 'asset', path: 'lore/0/content', text: (n) => `x <img class='c' src='${n}'> y` },
    { label: 'emotionMacro', kind: 'emotion', path: 'lore/0/content', text: (n) => `x {{emotion::${n}}} y` },
    { label: 'emoScript', kind: 'emotion', path: 'regex/0/out', text: (n) => `@@emo ${n}` },
    { label: 'emoScriptBlanks', kind: 'emotion', path: 'regex/0/out', text: (n) => `@@emo   ${n}  ` },
    { label: 'macroInRegexOut', kind: 'asset', path: 'regex/0/out', text: (n) => `x {{image::${n}}} y` },
    { label: 'nestedInEmotion', kind: 'asset', path: 'lore/0/content', text: (n) => `x {{emotion::{{image::${n}}}}} y` },
    { label: 'nestedInPrompt', kind: 'asset', path: 'lore/0/content', text: (n) => `x {{asset_prompt::see {{image::${n}}} here}} y` },
]

const NAME_CHARS = ['a', 'b', 's', 'm', 'S', 'i', ' ', "'", '"', ':', '}', '{', '$', '.', '-', '@', '<', '>', '1', 'ü']
const nameArb = fc.array(fc.constantFrom(...NAME_CHARS), { minLength: 1, maxLength: 6 }).map((chars) => chars.join(''))
// An empty kept name is no reference in any form, so the planner must list it and write nothing.
const keptArb = fc.oneof({ weight: 5, arbitrary: nameArb }, { weight: 1, arbitrary: fc.constant('') })
const formArb = fc.constantFrom(...FORMS)

interface Landed {
    holder: Holder
    state: ModelState
    edits: TextEdit[]
    before: string
    merged: string
    form: Form
}

// Plans a merge of `removed` into `kept` over the form's text, lands it through the history model's own forward check
// and records the step. Null when the planner writes nothing for this pair.
function landMerge(form: Form, removed: string, kept: string): Landed | null {
    const before = form.text(removed)
    const plan = planRewrite([{ path: form.path, text: before, cls: 'rewritable' }], form.kind, removed, kept)
    if (plan.edits.length === 0) {
        return null
    }
    const holder = holderWith(form.path, before)
    const reader = readerOf(holder)
    const ops: Op[] = plan.edits.map((edit) => ({ op: 'textEdit', target: edit.target, offset: edit.offset, from: edit.from, to: edit.to }))
    const writes = assetStepWrites(ops, reader)
    if (writes === null) {
        throw new Error(`the planner's own edits are refused at commit: ${JSON.stringify({ form: form.label, removed, kept, before })}`)
    }
    const greetings = reader.greetings()
    const state = commitStep(createModelState(emptyRecord(A, 0)), {
        id: 's1',
        at: 1,
        visitId: 'v1',
        label: { kind: 'assetMerge', from: removed, to: kept },
        ops,
        restoreWrites: deriveRestoreWrites(ops, greetings === null ? null : [...greetings], textBeforeOf((path) => reader.field(path))),
        coalesceKey: null,
        replacesRestore: false,
    })
    applyCharacterWrites(asCharacter(holder), writes, null)
    return { holder, state, edits: plan.edits, before, merged: spliceTextEdits(before, plan.edits), form }
}

function replay(landed: Landed, state: ModelState, direction: 'undo' | 'redo'): { state: ModelState; skipped: number; ok: boolean } {
    const plan = planReplay(state.record, direction, readerOf(landed.holder))
    if (plan.ok === false) {
        return { state, skipped: -1, ok: false }
    }
    applyCharacterWrites(asCharacter(landed.holder), plan.writes, null)
    return { state: applyReplayMove(state, direction, plan, 100, 'v1'), skipped: plan.skipped, ok: true }
}

describe('replay exactness properties', () => {
    test('round trip: every planned merge of generated names and forms undoes and redoes to the same texts with nothing skipped', () => {
        let landedCount = 0
        fc.assert(
            fc.property(formArb, nameArb, keptArb, (form, removed, kept) => {
                fc.pre(removed !== kept)
                const landed = landMerge(form, removed, kept)
                if (landed === null) {
                    return
                }
                expect(kept).not.toBe('')
                landedCount += 1
                const path = form.path
                expect(textOfHolder(landed.holder, path)).toBe(landed.merged)
                const undone = replay(landed, landed.state, 'undo')
                expect(undone.ok).toBe(true)
                expect(undone.skipped).toBe(0)
                expect(textOfHolder(landed.holder, path)).toBe(landed.before)
                const redone = replay(landed, undone.state, 'redo')
                expect(redone.ok).toBe(true)
                expect(redone.skipped).toBe(0)
                expect(textOfHolder(landed.holder, path)).toBe(landed.merged)
            }),
            { numRuns: 1500 },
        )
        expect(landedCount).toBeGreaterThan(300)
    })

    // The oracle: replays the recorded edits itself, from the highest recorded step to the lowest, on the text as an
    // outside edit left it. A place is changed only where the scanner reads an unflagged reference of either kind whose
    // name span is exactly the edit's span and whose name is the expected one.
    function oracleReplay(text: string, path: string, edits: readonly TextEdit[], direction: 'undo' | 'redo'): string {
        const ordered = direction === 'undo' ? edits.slice().reverse() : edits.slice()
        let running = text
        for (const edit of ordered) {
            const expected = direction === 'undo' ? edit.to : edit.from
            const written = direction === 'undo' ? edit.from : edit.to
            const reads = (['asset', 'emotion'] as const).some((kind) =>
                scanReferences(running, kind, path).some(
                    (reference) => reference.flag === undefined && reference.offset === edit.offset && reference.length === expected.length && reference.name === expected,
                ),
            )
            if (reads) {
                running = running.slice(0, edit.offset) + written + running.slice(edit.offset + expected.length)
            }
        }
        return running
    }

    const TOKENS = ['smile', 'grin', 'smiley', '{{', '}}', '"', "'", ':', 'x', ' ', '<img src=', '@@emo ', '{{image::', 'AB', '\n']
    const outsideArb = fc.record({
        kind: fc.constantFrom('insert', 'delete', 'replace'),
        at: fc.double({ min: 0, max: 1, noNaN: true }),
        length: fc.integer({ min: 0, max: 6 }),
        token: fc.constantFrom(...TOKENS),
    })

    function outsideEdit(text: string, edit: { kind: string; at: number; length: number; token: string }): string {
        const position = Math.floor(edit.at * text.length)
        if (edit.kind === 'insert') {
            return text.slice(0, position) + edit.token + text.slice(position)
        }
        if (edit.kind === 'delete') {
            return text.slice(0, position) + text.slice(position + edit.length)
        }
        return text.slice(0, position) + edit.token + text.slice(position + edit.length)
    }

    test('containment: after an outside edit an undo and then a redo change only what the independent oracle reads as the expected reference', () => {
        let changedSomething = 0
        let leftSomething = 0
        fc.assert(
            fc.property(formArb, fc.constantFrom('smile', 'grin', 'a b', "it's"), fc.constantFrom('smile', 'grin', 'a b', "it's"), outsideArb, outsideArb, (form, removed, kept, first, second) => {
                fc.pre(removed !== kept)
                const landed = landMerge(form, removed, kept)
                if (landed === null) {
                    return
                }
                const path = form.path
                const outside = outsideEdit(landed.merged, first)
                landed.holder.globalLore.forEach((entry) => {
                    if (path === 'lore/0/content') {
                        entry.content = outside
                    }
                })
                landed.holder.customscript.forEach((entry) => {
                    if (path === 'regex/0/out') {
                        entry.out = outside
                    }
                })
                const expectedUndo = oracleReplay(outside, path, landed.edits, 'undo')
                const undone = replay(landed, landed.state, 'undo')
                if (!undone.ok) {
                    // A step whose every text edit fails is refused whole: the oracle changes nothing either.
                    expect(textOfHolder(landed.holder, path)).toBe(outside)
                    expect(expectedUndo).toBe(outside)
                    leftSomething += 1
                    return
                }
                expect(textOfHolder(landed.holder, path)).toBe(expectedUndo)
                if (expectedUndo !== outside) {
                    changedSomething += 1
                } else {
                    leftSomething += 1
                }
                const outsideAgain = outsideEdit(textOfHolder(landed.holder, path), second)
                if (path === 'lore/0/content') {
                    landed.holder.globalLore[0].content = outsideAgain
                } else {
                    landed.holder.customscript[0].out = outsideAgain
                }
                const expectedRedo = oracleReplay(outsideAgain, path, landed.edits, 'redo')
                const redone = replay(landed, undone.state, 'redo')
                if (!redone.ok) {
                    expect(textOfHolder(landed.holder, path)).toBe(outsideAgain)
                    expect(expectedRedo).toBe(outsideAgain)
                    return
                }
                expect(textOfHolder(landed.holder, path)).toBe(expectedRedo)
            }),
            { numRuns: 3000 },
        )
        expect(changedSomething).toBeGreaterThan(50)
        expect(leftSomething).toBeGreaterThan(50)
    })
})
