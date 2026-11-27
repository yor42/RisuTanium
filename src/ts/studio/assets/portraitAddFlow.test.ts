// @vitest-environment jsdom
// B-T7 (flow half): an add belongs to the Studio visit it started in, and every outcome that does not land reaches the user
// through the app-wide toast host, so it survives the form being gone. The dependencies are injected and deferred where a
// test needs the visit to end at a given await; the visit is the real `studioScreen` state.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

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
vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => 0 }))
vi.mock('src/lang', async () => {
    const helpers = await import('src/ts/studio/studioFixtures.test-helpers')
    return { language: helpers.studioLanguageMock() }
})

import { addRefusalNotice, refusalText } from '../edit/studioToasts'
import type { StudioRefusal, StudioResult } from '../history/ownerHistory.svelte'
import { characterOwnerKey } from '../history/ownerPhase'
import { resetStudioScreenForTests, studioScreen } from '../studioScreen.svelte'
import type { PickOutcome } from './filePicker'
import { runPortraitAdd, type PortraitAddDeps } from './portraitAddFlow'

const A = characterOwnerKey('A')

interface Gate<T> {
    promise: Promise<T>
    open(value: T): void
}

function gate<T>(): Gate<T> {
    let open!: (value: T) => void
    const promise = new Promise<T>((resolve) => { open = resolve })
    return { promise, open }
}

const picked = (name = 'a.png'): PickOutcome => ({ kind: 'picked', files: [{ name } as File], badType: [], tooLarge: [] })

interface Rig {
    deps: PortraitAddDeps
    posts: { kind?: string; text: string }[]
    calls: string[]
    landed: number[]
    busy: { began: number; ended: number }
}

function rig(over: Partial<PortraitAddDeps> = {}, add: (path: string) => StudioResult = () => ({ ok: true })): Rig {
    const posts: Rig['posts'] = []
    const calls: string[] = []
    const landed: number[] = []
    const busy = { began: 0, ended: 0 }
    const deps: PortraitAddDeps = {
        pickFiles: async () => picked(),
        readBytes: async () => new Uint8Array([1]),
        readPortraitTextChunks: async () => ({}),
        saveImage: async () => {
            calls.push('saveImage')
            return 'assets/n.png'
        },
        service: {
            portraitAdd: (_owner, path) => {
                calls.push('portraitAdd')
                return add(path)
            },
        },
        toastHost: { post: (init) => { posts.push({ kind: init.kind, text: init.text }); return 1 } },
        onLanded: (n) => { landed.push(n) },
        beginBusy: () => {
            busy.began += 1
            return { end: () => { busy.ended += 1 } }
        },
        ...over,
    }
    return { deps, posts, calls, landed, busy }
}

function openVisit(id = 'v1'): void {
    studioScreen.open = true
    studioScreen.visitId = id
    studioScreen.chaId = 'A'
}

beforeEach(() => {
    resetStudioScreenForTests()
    openVisit()
})

afterEach(() => {
    resetStudioScreenForTests()
})

describe('B-T7 (i): Studio closes while the chooser is open', () => {
    test('nothing is stored or written, and one not-added notice is posted', async () => {
        const chooser = gate<PickOutcome>()
        const r = rig({ pickFiles: () => chooser.promise })
        const running = runPortraitAdd(A, r.deps)
        studioScreen.open = false
        chooser.open(picked())
        expect(await running).toBe('not-added')
        expect(r.calls).toEqual([])
        expect(r.posts).toEqual([{ kind: 'warning', text: 'studioImportNotAdded(1)' }])
        expect(r.landed).toEqual([])
    })

    test('a new visit (Studio closed and opened again) ends the old one too', async () => {
        const chooser = gate<PickOutcome>()
        const r = rig({ pickFiles: () => chooser.promise })
        const running = runPortraitAdd(A, r.deps)
        openVisit('v2')
        chooser.open(picked())
        expect(await running).toBe('not-added')
        expect(r.calls).toEqual([])
        expect(r.posts).toHaveLength(1)
    })
})

describe('B-T7 (ii): Studio closes while the picture is stored', () => {
    test('the file is stored, no step is written, and the same notice is posted', async () => {
        const stored = gate<string>()
        const r = rig({ saveImage: async () => { r.calls.push('saveImage'); return stored.promise } })
        const running = runPortraitAdd(A, r.deps)
        await vi.waitFor(() => expect(r.calls).toEqual(['saveImage']))
        studioScreen.open = false
        stored.open('assets/n.png')
        expect(await running).toBe('not-added')
        expect(r.calls).toEqual(['saveImage'])
        expect(r.posts).toEqual([{ kind: 'warning', text: 'studioImportNotAdded(1)' }])
        expect(r.busy).toEqual({ began: 1, ended: 1 })
    })

    test('the visit ending while the bytes or notes are read skips the store', async () => {
        const reading = gate<Uint8Array>()
        const r = rig({ readBytes: () => reading.promise })
        const running = runPortraitAdd(A, r.deps)
        await Promise.resolve()
        studioScreen.open = false
        reading.open(new Uint8Array([1]))
        expect(await running).toBe('not-added')
        expect(r.calls).toEqual([])
    })
})

describe('B-T7 (iii) and (iv): a refusal while the visit is open states its own cause', () => {
    test.each<StudioRefusal>(['duplicate-id', 'restricted', 'gone'])('%s: one plain notice with that refusal text and never the closed-Studio wording', async (reason) => {
        const r = rig({}, () => ({ ok: false, reason }))
        expect(await runPortraitAdd(A, r.deps)).toBe('refused')
        expect(r.posts).toEqual([{ kind: 'warning', text: refusalText(reason) }])
        expect(r.posts.some((post) => post.text.startsWith('studioImportNotAdded'))).toBe(false)
        expect(r.landed).toEqual([])
    })

    test('not-selected with the visit still open reads as not added, as the selection moving away is what closes Studio', async () => {
        const r = rig({}, () => ({ ok: false, reason: 'not-selected' }))
        expect(await runPortraitAdd(A, r.deps)).toBe('not-added')
        expect(r.posts).toEqual([{ kind: 'warning', text: 'studioImportNotAdded(1)' }])
    })

    test('the pure decision: a closed visit or not-selected is not-added, any other reason is its own text', () => {
        expect(addRefusalNotice(false, { reason: 'gone' })).toEqual({ kind: 'not-added' })
        expect(addRefusalNotice(true, { reason: 'not-selected' })).toEqual({ kind: 'not-added' })
        expect(addRefusalNotice(true, { reason: 'gone' })).toEqual({ kind: 'refusal', text: refusalText('gone') })
        expect(addRefusalNotice(true, { reason: 'asset-other-tab-character' })).toEqual({ kind: 'refusal', text: refusalText('asset-other-tab-character') })
    })
})

describe('B-T7 (v) and (vi): a store failure and a landed add', () => {
    test('a store that throws writes nothing and posts the store-failure notice', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        const r = rig({ saveImage: async () => { r.calls.push('saveImage'); throw new Error('disk full') } })
        expect(await runPortraitAdd(A, r.deps)).toBe('store-failed')
        expect(r.calls).toEqual(['saveImage'])
        expect(r.posts).toEqual([{ kind: 'warning', text: 'studioPortraitStoreFail' }])
        expect(r.busy).toEqual({ began: 1, ended: 1 })
        error.mockRestore()
    })

    test('a landed add with two notes tells the caller how many were copied, and posts nothing', async () => {
        const r = rig({ readPortraitTextChunks: async () => ({ Title: 't', Comment: 'c' }) }, () => ({ ok: true, pngChunks: 2 }))
        expect(await runPortraitAdd(A, r.deps)).toBe('landed')
        expect(r.landed).toEqual([2])
        expect(r.posts).toEqual([])
        expect(r.calls).toEqual(['saveImage', 'portraitAdd'])
    })

    test('the notes read from the picture are the ones handed to the service', async () => {
        let handed: Readonly<Record<string, string>> | undefined
        const r = rig({ readPortraitTextChunks: async () => ({ Title: 't' }) })
        r.deps.service = { portraitAdd: (_owner, _path, chunks) => { handed = chunks; return { ok: true } } }
        await runPortraitAdd(A, r.deps)
        expect(handed).toEqual({ Title: 't' })
    })

    test('a landed add with no notes reports zero', async () => {
        const r = rig()
        await runPortraitAdd(A, r.deps)
        expect(r.landed).toEqual([0])
    })
})

describe('the picks that add nothing', () => {
    test('a cancelled chooser does nothing at all', async () => {
        const r = rig({ pickFiles: async () => ({ kind: 'cancelled' }) })
        expect(await runPortraitAdd(A, r.deps)).toBe('cancelled')
        expect(r.posts).toEqual([])
        expect(r.busy.began).toBe(0)
    })

    test('a picked file that was refused for its type or size stores nothing and posts nothing (the size notice was the picker\'s)', async () => {
        const r = rig({ pickFiles: async () => ({ kind: 'picked', files: [], badType: [{ name: 'a.bmp' } as File], tooLarge: [] }) })
        expect(await runPortraitAdd(A, r.deps)).toBe('bad-file')
        expect(r.calls).toEqual([])
        expect(r.posts).toEqual([])
    })
})
