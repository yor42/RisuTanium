// @vitest-environment node
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/process/memory/measureFlag', () => ({
    MEASURE: false,
}))

import { Sha256 } from 'src/ts/assetHash'
import { assembleDatabase, previousFrom, unitMapSource, type EncodedTree, type ListDerivation } from '../../store2/codec'
import { createKeyMint, type BuildContext } from '../../store2/commit'
import { createSaveEncoder, type SaveEncoder, type SavePassRequest } from '../../store2/saveEncoder'
import type { AcknowledgedVerdict } from '../../store2/codec'
import type { character, Database } from '../../database.svelte'
import {
    chat, dbWithCharacters, encodeWith, fakeLists, loreEntry, message, mulberry32, prosePool, seededEnv, sparseCharacter, uuidLike,
    type Obj,
} from './codecFixtures'

/**
 * The idle-net verdict waits between the stages of a shadow miss (`SaveEncoder.verdictOfYielding`, which drives the same
 * `verdictSteps` as `verdictOf`). Labels: T9 (oracle), T10 (stage trace), T11 (snapshot) and T14 (belt) are
 * compatibility guards of the new API: it does not exist on the base (erdictOfYielding is not a function there), so each runs after the change only and is killed
 * by a mutant named in the hand-back. The measurement switch is off, as a release build runs. The verdict through the save loop (`netDecision`) is in `saveLoopVerdictYield`.
 */

const NOW = 1_700_000_000_000
const CHA = 'cha-big-0001'
const FRAME_NAMES: Record<number, string> = { 4: 'core', 5: 'lore', 6: 'scripts', 7: 'chatCore', 15: 'al', 21: 'il' }

let restoreSha: (() => void) | null = null

afterEach(() => {
    restoreSha?.()
    restoreSha = null
    vi.restoreAllMocks()
})

function recordFrames(trace: string[]): void {
    const real = Sha256.prototype.update
    Sha256.prototype.update = function (this: Sha256, bytes: Uint8Array) {
        if (bytes.length > 6 && bytes[0] === 0x52 && bytes[1] === 0x53 && bytes[2] === 0x41 && bytes[3] === 0x4c) {
            const name = FRAME_NAMES[bytes[5]]
            if (name !== undefined) {
                trace.push(name)
            }
        }
        return real.call(this, bytes)
    } as typeof real
    restoreSha = () => {
        Sha256.prototype.update = real
    }
}

function recordingLists(trace: string[], calls?: { assets: number }): ListDerivation {
    return {
        ...fakeLists,
        characterAssets: (owner) => {
            trace.push('assets')
            if (calls !== undefined) {
                calls.assets += 1
            }
            return fakeLists.characterAssets(owner)
        },
        characterInlays: (owner) => {
            trace.push('inlays')
            return fakeLists.characterInlays(owner)
        },
    }
}

function fullCharacter(rng: () => number, pool: string[], chaId: string): Obj {
    const first = message(rng, pool, 0, 50)
    first.data = `see {{inlay::${uuidLike(rng)}}} here`
    const slot = sparseCharacter(rng, pool, chaId, 'Big', [chat(rng, 0, [first, message(rng, pool, 1, 50)]), chat(rng, 1, [message(rng, pool, 1, 50)])], [loreEntry(rng, pool, 0, 50)])
    slot.customscript = [{ comment: 'x', in: 'a', out: 'b', type: 'editinput' }]
    return slot
}

function slotsOf(shareId = false): Obj[] {
    const rng = mulberry32(11)
    const pool = prosePool(rng, 200, 20, 100)
    return [
        fullCharacter(rng, pool, CHA),
        sparseCharacter(rng, pool, shareId ? CHA : 'cha-small-02', 'Small', [chat(rng, 2, [message(rng, pool, 0, 20)])], []),
    ]
}

interface Fixture {
    first: EncodedTree
    /** A character list as the acknowledged tree decodes to: each slot is a fresh, equal copy per call. */
    live(): character[]
    /** An encoder over a fresh acknowledged encoding of the first tree. */
    encoder(lists?: ListDerivation): SaveEncoder
}

function fixtureOf(shareId = false): Fixture {
    const first = encodeWith(dbWithCharacters(slotsOf(shareId)))
    return {
        first,
        live: () => assembleDatabase(first.manifest, unitMapSource(first.units)).characters as unknown as character[],
        encoder: (lists = fakeLists) => createSaveEncoder({ previous: previousFrom(first), lists, env: seededEnv(77), now: () => NOW }),
    }
}

function request(extra: Partial<SavePassRequest> = {}): SavePassRequest {
    return { marked: new Set(), modules: false, whole: false, ...extra }
}

function contextOf(attempt: number): BuildContext {
    const { mint } = createKeyMint(seededEnv(900 + attempt), null)
    return { mint, seq: 2, now: NOW }
}

function asObj(slot: character): Obj {
    return slot as unknown as Obj
}

/** A pause that records how often it was awaited, after a real tick so a driver that does not await it is caught. */
function countingPause(): { pause: () => Promise<void>, calls: () => number } {
    let calls = 0
    return { pause: async () => { await null; calls += 1 }, calls: () => calls }
}

// The waits of the verdict of a shadow miss: one after the read, then one before each stage after the first. None
// follows the last stage (the caller's own wait does).
const EXPECTED_VERDICT_TRACE = [
    'Y', 'core', 'Y', 'lore', 'Y', 'scripts', 'Y', 'assets', 'Y', 'al', 'Y', 'inlays', 'Y', 'il', 'Y', 'chatCore', 'Y', 'chatCore',
]

describe('the verdict waits between the stages of its emit', () => {
    test('T10 compatibility guard (new API): the trace of a shadow miss, then none for the hit that follows', async () => {
        const trace: string[] = []
        const fixture = fixtureOf()
        const encoder = fixture.encoder(recordingLists(trace))
        const live = fixture.live()
        recordFrames(trace)
        const pause = async (): Promise<void> => {
            await null
            trace.push('Y')
        }
        expect(await encoder.verdictOfYielding(live[0], pause)).toBe('clean')
        expect(trace).toEqual(EXPECTED_VERDICT_TRACE)
        trace.length = 0
        expect(await encoder.verdictOfYielding(live[0], pause)).toBe('clean')
        expect(trace, 'a shadow hit has no stage to wait in').toEqual([])
    })

    interface State {
        label: string
        shared?: boolean
        edit?: (live: character[]) => void
        /** Hides every digest of a core unit from the acknowledged encoding the encoders judge against. */
        digestless?: boolean
    }

    const STATES: State[] = [
        { label: 'clean' },
        { label: 'a core edit', edit: (live) => { asObj(live[0]).personality = 'edited' } },
        { label: 'a chat edit', edit: (live) => { ((asObj(live[0]).chats as Obj[])[0].message as Obj[])[0].data = 'edited message' } },
        { label: 'a lore edit', edit: (live) => { ((asObj(live[0]).globalLore as Obj[])[0]).content = 'edited lore' } },
        { label: 'a type change', edit: (live) => { asObj(live[0]).type = 'group' } },
        { label: 'a tags change', edit: (live) => { (asObj(live[0]).tags as string[]).push('edited') } },
        { label: 'a moved-field change', edit: (live) => { asObj(live[0]).lastInteraction = 99 } },
        { label: 'a shared chaId', shared: true },
        { label: 'a unit with no digest', digestless: true },
        { label: 'a read fault', edit: (live) => { asObj(live[0]).self = live[0] } },
    ]

    test.each(STATES)('T9 compatibility guard (oracle), $label: the yielding verdict answers and leaves the shadow as the synchronous one does, twice', async (state) => {
        const fixture = fixtureOf(state.shared === true)
        const sync = fixture.encoder()
        const waiting = fixture.encoder()
        if (state.digestless === true) {
            for (const encoder of [sync, waiting]) {
                for (const [identity, unit] of encoder.acknowledged().units) {
                    if (identity.endsWith(':core')) {
                        delete unit.digest
                    }
                }
            }
        }
        const liveSync = fixture.live()
        const liveWaiting = fixture.live()
        state.edit?.(liveSync)
        state.edit?.(liveWaiting)
        const counted = countingPause()
        for (let round = 0; round < 2; round++) {
            for (let index = 0; index < 2; index++) {
                const expected = sync.verdictOf(liveSync[index])
                const actual = await waiting.verdictOfYielding(liveWaiting[index], counted.pause)
                expect(actual, `slot ${index}, round ${round}`).toBe(expected)
                expect(waiting.shadowStats(), `slot ${index}, round ${round}`).toEqual(sync.shadowStats())
            }
        }
    })

    test('T9 the states are not vacuous: a clean slot is clean, an edited one is dirty, and a miss does wait', async () => {
        const fixture = fixtureOf()
        const counted = countingPause()
        const encoder = fixture.encoder()
        const live = fixture.live()
        expect(await encoder.verdictOfYielding(live[0], counted.pause)).toBe('clean')
        expect(counted.calls()).toBeGreaterThan(5)
        asObj(live[0]).personality = 'edited'
        expect(await encoder.verdictOfYielding(live[0], counted.pause)).toBe('dirty')
        asObj(live[1]).lastInteraction = 99
        expect(await encoder.verdictOfYielding(live[1], counted.pause)).toBe('dirty')
    })
})

/** The edits made to the live slot while the verdict waits: every field the entry reads outside the plain tree, and the tree. */
function editLive(slot: Obj): () => void {
    const saved = { desc: slot.desc, tags: [...(slot.tags as string[])], creator: slot.creator, type: slot.type, characters: slot.characters }
    slot.desc = 'edited description'
    ;(slot.tags as string[]).push('edited-tag')
    slot.creator = 'edited creator'
    slot.type = 'group'
    slot.characters = ['edited-member']
    return () => {
        slot.desc = saved.desc
        slot.tags = saved.tags
        slot.creator = saved.creator
        slot.type = saved.type
        if (saved.characters === undefined) {
            delete slot.characters
        } else {
            slot.characters = saved.characters
        }
    }
}

describe('a live edit during a wait of the verdict', () => {
    const totalWaits = EXPECTED_VERDICT_TRACE.filter(token => token === 'Y').length

    test('T11 compatibility guard (new API): the answer and the admitted shadow are the read instant\'s, whichever wait the edit falls in', async () => {
        for (let k = 1; k <= totalWaits; k++) {
            const fixture = fixtureOf()
            // The wait that edits the slot: the answer is the one for the slot as it was read, `clean`, and the shadow it
            // admits is that read's tree, so the unedited slot hits it (no derivation) afterwards.
            const calls = { assets: 0 }
            const encoder = fixture.encoder(recordingLists([], calls))
            const live = fixture.live()
            let restore: () => void = () => {}
            let waits = 0
            const verdict = await encoder.verdictOfYielding(live[0], async () => {
                await null
                waits += 1
                if (waits === k) {
                    restore = editLive(asObj(live[0]))
                }
            })
            expect(waits).toBe(totalWaits)
            expect(verdict, `an edit at wait ${k}`).toBe('clean')
            expect(encoder.shadowStats().entries).toBe(1)
            restore()
            const derivations = calls.assets
            expect(encoder.verdictOf(live[0]), `an edit at wait ${k}, restored`).toBe('clean')
            expect(calls.assets, `an edit at wait ${k}: the restored slot hits the admitted shadow`).toBe(derivations)

            const second = fixtureOf()
            const edited = second.encoder()
            const secondLive = second.live()
            let waitsSecond = 0
            await edited.verdictOfYielding(secondLive[0], async () => {
                await null
                waitsSecond += 1
                if (waitsSecond === k) {
                    editLive(asObj(secondLive[0]))
                }
            })
            expect(edited.verdictOf(secondLive[0]), `an edit at wait ${k}, kept`).toBe('dirty')
        }
    })

    test('T11 a rejected wait rejects the verdict and admits no shadow', async () => {
        const fixture = fixtureOf()
        const encoder = fixture.encoder()
        const live = fixture.live()
        let waits = 0
        await expect(encoder.verdictOfYielding(live[0], async () => {
            await null
            waits += 1
            if (waits === 3) {
                throw new Error('cut at the third wait')
            }
        })).rejects.toThrow('cut at the third wait')
        expect(encoder.shadowStats()).toEqual({ entries: 0, charged: 0 })
        expect(encoder.verdictOf(live[0])).toBe('clean')
    })
})

describe('the loop invariant is checked after the verdict', () => {
    async function verdictWhile(violate: (encoder: SaveEncoder, fixture: Fixture, live: character[]) => Promise<void>): Promise<{ verdict: AcknowledgedVerdict, encoder: SaveEncoder }> {
        const fixture = fixtureOf()
        const encoder = fixture.encoder()
        const live = fixture.live()
        let waits = 0
        let violated = false
        const verdict = await encoder.verdictOfYielding(live[0], async () => {
            await null
            waits += 1
            if (waits === 2) {
                violated = true
                await violate(encoder, fixture, live)
            }
        })
        expect(violated).toBe(true)
        return { verdict, encoder }
    }

    test('T14 compatibility guard (new rule): the acknowledged encoding moved by a fast-forward during a wait answers unknown and admits nothing', async () => {
        const other = encodeWith(dbWithCharacters(slotsOf().slice(0, 1)), { env: seededEnv(3) })
        const { verdict, encoder } = await verdictWhile(async (inner) => {
            inner.fastForward(previousFrom(other))
        })
        expect(verdict).toBe('unknown')
        expect(encoder.shadowStats()).toEqual({ entries: 0, charged: 0 })
    })

    test('T14 compatibility guard (new rule): an attempt set pending during a wait answers unknown and admits nothing', async () => {
        const fixture = fixtureOf()
        const encoder = fixture.encoder()
        const live = fixture.live()
        const plan = await encoder.plan(dbOf(fixture.first), request({ whole: true }))
        await plan.commitRequest().build(contextOf(1))
        let waits = 0
        const verdict = await encoder.verdictOfYielding(live[0], async () => {
            await null
            waits += 1
            if (waits === 2) {
                plan.keepAsPending()
            }
        })
        expect(verdict).toBe('unknown')
        expect(encoder.shadowStats()).toEqual({ entries: 0, charged: 0 })
    })

    test('T14 the control: with nothing moving the same verdict is clean and admits its shadow', async () => {
        const { verdict, encoder } = await verdictWhile(async () => {})
        expect(verdict).toBe('clean')
        expect(encoder.shadowStats().entries).toBe(1)
    })
})

function dbOf(first: EncodedTree): Database {
    return assembleDatabase(first.manifest, unitMapSource(first.units))
}
