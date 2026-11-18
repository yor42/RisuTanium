// @vitest-environment jsdom
// A PC proxy measurement, not a device result: what the registry walk and the click-time rebuild of a merge preview
// cost over a character with 2,000 lorebook entries and about 2 MB of text. The design budgets are 16 ms for the walk
// and 100 ms for the rebuild; the bounds here are ten times those so a slow host does not fail the test, and the
// measured numbers are printed for the record. The replay rows below measure the exact check of a merge's text edits
// (one scan of the target's whole text per checked edit) over the same shapes.
import { describe, expect, test, vi } from 'vitest'
import { applyCharacterWrites, createLiveReader, type LiveTarget } from '../edit/studioSetters'
import { applyReplayMove, assetStepWrites, commitStep, createModelState, emptyRecord, planReplay, type Op } from '../history/historyModel'
import { characterOwnerKey } from '../history/ownerPhase'
import type { character } from 'src/ts/storage/database.svelte'
import { assetRow, DEFAULT_SETTINGS, groupRow } from './assetFixtures.test-helpers'
import { groupDuplicates } from './duplicateGroups'
import { buildMergePreview } from './mergePreview'
import { planRewrite } from './referenceRewrite'
import { enumerateClassifiedTargets, type CharacterTargetFields } from './referenceTargets'

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

const ENTRIES = 2000
const ENUMERATE_BOUND_MS = 160
const REBUILD_BOUND_MS = 1000

function fixture(): CharacterTargetFields {
    const filler = 'The quick brown fox jumps over the lazy dog. '.repeat(22)
    return {
        desc: 'D {{image::grin}}',
        firstMessage: 'Hi {{image::grin}}',
        alternateGreetings: ['A {{image::grin}}'],
        additionalAssets: [assetRow('smile', 'assets/a.png'), assetRow('grin', 'assets/a.png')],
        globalLore: Array.from({ length: ENTRIES }, (_, i) => ({ content: i % 20 === 0 ? `${filler}{{image::grin}} ${i}` : `${filler}${i}` })),
    }
}

function median(samples: number[]): number {
    return [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)]
}

function timed(work: () => unknown): number {
    const started = performance.now()
    work()
    return performance.now() - started
}

describe('T24m: a merge over 2,000 lore entries (PC proxy; the device run is owed)', () => {
    test('the registry walk and the click-time rebuild cost well under their bounds', () => {
        const source = fixture()
        const owner = { kind: 'character' as const, source }
        const group = groupDuplicates(source.additionalAssets?.map((row, index) => groupRow(row[0], row[1], index)) ?? []).find((candidate) => candidate.cls === 'sameFileDifferentNames')
        if (!group) {
            throw new Error('no candidate group')
        }
        const targets = enumerateClassifiedTargets(owner)
        const bytes = targets.reduce((sum, target) => sum + target.text.length, 0)
        expect(targets.length).toBeGreaterThanOrEqual(ENTRIES)
        expect(bytes).toBeGreaterThan(1_900_000)

        enumerateClassifiedTargets(owner)
        buildMergePreview(owner, 'asset', group, 'smile', [], DEFAULT_SETTINGS)
        const walk = median(Array.from({ length: 5 }, () => timed(() => enumerateClassifiedTargets(owner))))
        const rebuild = median(Array.from({ length: 5 }, () => timed(() => buildMergePreview(owner, 'asset', group, 'smile', [], DEFAULT_SETTINGS))))

        process.stdout.write(`T24m proxy: registry walk over ${targets.length} targets (${(bytes / 1e6).toFixed(2)} MB) took ${walk.toFixed(1)} ms, merge preview rebuild ${rebuild.toFixed(1)} ms on this host\n`)
        expect(walk).toBeLessThan(ENUMERATE_BOUND_MS)
        expect(rebuild).toBeLessThan(REBUILD_BOUND_MS)
    })
})

const REPLAY_BOUND_MS = 5000

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

// Lands a merge's edits of every target through the history model's own forward check, then times the commit check, the
// undo and the redo, each of which scans a target's whole text once per checked edit.
function replayTimes(lore: string[]): { commit: number; undo: number; redo: number; edits: number } {
    const holder: Holder = {
        chaId: 'A',
        desc: 'D {{image::grin}}',
        firstMessage: 'Hi {{image::grin}}',
        exampleMessage: '',
        alternateGreetings: ['A {{image::grin}}'],
        globalLore: lore.map((content) => ({ key: 'k', content })),
        customscript: [],
        additionalAssets: [],
        emotionImages: [],
    }
    const asCharacter = holder as unknown as character
    const liveTarget: LiveTarget = { character: asCharacter, chat: null }
    const reader = createLiveReader(liveTarget)
    const targets = enumerateClassifiedTargets({ kind: 'character', source: { desc: holder.desc, firstMessage: holder.firstMessage, alternateGreetings: holder.alternateGreetings, globalLore: holder.globalLore } })
    const plan = planRewrite(targets, 'asset', 'grin', 'smile')
    const ops: Op[] = plan.edits.map((edit) => ({ op: 'textEdit', target: edit.target, offset: edit.offset, from: edit.from, to: edit.to }))
    let writes: ReturnType<typeof assetStepWrites> = null
    const commit = timed(() => {
        writes = assetStepWrites(ops, reader)
    })
    if (writes === null) {
        throw new Error('the planner edits are refused at commit')
    }
    let state = commitStep(createModelState(emptyRecord(characterOwnerKey('A'), 0)), {
        id: 's1',
        at: 1,
        visitId: 'v1',
        label: { kind: 'assetMerge', from: 'grin', to: 'smile' },
        ops,
        restoreWrites: [],
        coalesceKey: null,
        replacesRestore: false,
    })
    applyCharacterWrites(asCharacter, writes, null)
    const times = { commit, undo: 0, redo: 0, edits: ops.length }
    for (const direction of ['undo', 'redo'] as const) {
        times[direction] = timed(() => {
            const replay = planReplay(state.record, direction, reader)
            if (replay.ok === false || replay.skipped !== 0) {
                throw new Error(`the ${direction} did not replay cleanly`)
            }
            applyCharacterWrites(asCharacter, replay.writes, null)
            state = applyReplayMove(state, direction, replay, 100, 'v1')
        })
    }
    return times
}

describe('replay of a merge over many targets and over one large target (PC proxy)', () => {
    test('a 2003-target merge replays within its bound, with the times printed', () => {
        const filler = 'The quick brown fox jumps over the lazy dog. '.repeat(22)
        const lore = Array.from({ length: 2000 }, (_, i) => `${filler}{{image::grin}} ${i}`)
        const times = replayTimes(lore)
        process.stdout.write(`replay cost: 2003 targets, ${times.edits} edits: commit check ${times.commit.toFixed(1)} ms, undo ${times.undo.toFixed(1)} ms, redo ${times.redo.toFixed(1)} ms on this host\n`)
        expect(times.edits).toBe(2003)
        expect(Math.max(times.commit, times.undo, times.redo)).toBeLessThan(REPLAY_BOUND_MS)
    })

    test('one target of about 200 KB with 500 occurrences replays within its bound, with the times printed', () => {
        const filler = 'The quick brown fox jumps over the lazy dog. '.repeat(8)
        const large = Array.from({ length: 500 }, (_, i) => `${filler}{{image::grin}} ${i}\n`).join('')
        const times = replayTimes([large])
        process.stdout.write(`replay cost: one ${(large.length / 1000).toFixed(0)} KB target, ${times.edits} edits: commit check ${times.commit.toFixed(1)} ms, undo ${times.undo.toFixed(1)} ms, redo ${times.redo.toFixed(1)} ms on this host\n`)
        expect(times.edits).toBe(503)
        expect(Math.max(times.commit, times.undo, times.redo)).toBeLessThan(REPLAY_BOUND_MS)
    })
})
