// @vitest-environment node
import { afterEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

// MOCKED: the alert modules `peerUi` imports; the loop under test never shows an alert through them.
vi.mock(import('src/ts/stores.svelte'), () => ({
    alertStore: writable({ type: 'none', msg: '' }),
}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/alert'), () => ({
    alertSelect: vi.fn(),
    alertToast: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

import { createCommitter, IMPORT_REPLACES_BASE } from '../../store2/commit'
import { runStore2SaveLoop, type Store2LoopPort } from '../../store2/saveLoop'
import type { SaveFailureClass } from '../../store2/saveFailure'
import { describeSaveFailure, saveFailureClassOf } from '../../store2/ui/peerUi'
import type { Database } from '../../database.svelte'
import type { toSaveType } from '../../risuSave'
import { until } from '../saveLoopWorld'
import { createPeerDouble, startStore2 } from '../store2SaveKit'
import { buildSmall } from './codecFixtures'

/**
 * The save loop's foreign-marker question end to end with the real report wording: while the question is up and
 * unanswered, no refusal's report carries a toast or an alert; once it settles, the reports escalate as they always did.
 * Label: new behaviour.
 */

const BULK_ROWS = 80

interface Report {
    attempts: number
    failureClass: SaveFailureClass
    toast: string | null
    alert: { msg: string, submsg: string } | null
    showRaw: boolean
}

let stopLoop: () => void = () => {}

afterEach(() => {
    stopLoop()
})

describe('the foreign-marker question is never covered by a report', () => {
    test('new behaviour: seven refusals report nothing while the question is up, and the escalated alert follows once it is answered Wait', async () => {
        const db = JSON.parse(JSON.stringify(buildSmall(BULK_ROWS))) as Database
        const peer = createPeerDouble()
        peer.foreignAnswers.push('wait')
        let release: () => void = () => {}
        peer.foreignHold = new Promise<void>((resolve) => { release = resolve })
        const kit = await startStore2({ db, kind: 'node', peer })
        const foreign = createCommitter(kit.memory, { owner: 'peer-page' })
        void foreign.commit(await foreign.readCommit(), {
            newUnits: 100,
            carry: IMPORT_REPLACES_BASE,
            label: 'bulk',
            build: () => new Promise(() => {}),
        })
        await until(async () => (await kit.commitKey()).staging !== null, 'the marker', 4000)
        kit.context.markerOwnerProbe = async () => 'unknown'

        let stopped = false
        stopLoop = () => { stopped = true }
        const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
        const reloadFlag = { state: false }
        const state = { due: false, dirty: false, saved: 0 }
        const reports: Report[] = []
        let tail: Promise<void> = Promise.resolve()
        const idle = () => new Promise<void>((resolve) => {
            if (!stopped) {
                setTimeout(resolve, 2)
            }
        })
        const port: Store2LoopPort = {
            tracker,
            reloadFlag,
            getDatabase: () => db,
            mergeBack(live, snapshot) {
                for (const chaId of snapshot.character) {
                    if (!live.character.includes(chaId)) {
                        live.character.push(chaId)
                    }
                }
            },
            liveCheck: () => {},
            sweep: () => {},
            isDue: () => state.due,
            isDirty: () => state.dirty,
            hasDrafts: () => false,
            beginIteration() {
                state.due = false
            },
            endIteration: () => {},
            snapshotTaken() {
                state.dirty = false
            },
            requestPass() {
                state.dirty = true
                state.due = true
            },
            unsavable: () => {},
            saved() {
                state.saved += 1
            },
            broadcast: () => {},
            peerHeard: () => false,
            setStopped: () => {},
            notifyTooLarge: () => {},
            reportFailure(error, attempts) {
                const report = describeSaveFailure(error, attempts, false)
                reports.push({ attempts, failureClass: saveFailureClassOf(error, false), toast: report.toast, alert: report.alert, showRaw: report.showRaw })
                return report.waitMs
            },
            reportUncountedFailure: () => 1,
            async withWriteLock(work) {
                const before = tail
                let free: () => void = () => {}
                tail = new Promise<void>((resolve) => { free = resolve })
                await before
                try {
                    return await work()
                } finally {
                    free()
                }
            },
            wait: idle,
            sleep: idle,
            sleepForever: () => new Promise<never>(() => {}),
            now: () => Date.now(),
        }
        const crashed: unknown[] = []
        runStore2SaveLoop(kit.context, port).catch((error: unknown) => {
            crashed.push(error)
        })

        for (const entry of db.characters as unknown as Array<Record<string, unknown>>) {
            entry.personality = `${String(entry.personality)} edited`
        }
        reloadFlag.state = true
        state.due = true
        state.dirty = true

        await until(() => reports.length >= 7, 'seven reports while the question is up', 8000)
        expect(reports.slice(0, 7).map((report) => report.attempts)).toEqual([1, 2, 3, 4, 5, 6, 7])
        for (const report of reports.slice(0, 7)) {
            expect(report.toast).toBeNull()
            expect(report.alert).toBeNull()
            expect(report.showRaw).toBe(false)
            expect(report.failureClass).toBe('commit-refused')
        }
        expect(peer.foreignAsked).toHaveLength(1)

        release()
        await until(() => reports.some((report) => report.alert !== null), 'the escalated alert after the question settled', 8000)
        const escalated = reports.find((report) => report.alert !== null)
        expect(escalated?.attempts).toBeGreaterThanOrEqual(8)
        expect(peer.foreignAsked).toHaveLength(1)
        expect(crashed).toEqual([])
    })
})
