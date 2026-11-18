/**
 * The lorebook tester's session: what it keeps per character, when it resets,
 * and when a result counts as edited since the test.
 *
 * The runner is a double that records its calls; the database is a `$state`
 * object, so every edit below is a real reactive write. `regression
 * reproducer` tests fail when the named session rule is removed. `diagnostic:`
 * records the Svelte mechanism the stale signal stands on.
 */
import { flushSync } from 'svelte'
import { VERSION } from 'svelte/compiler'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../storage/database.svelte'
import type { LoreTestOutcome } from './loreTest'

const h = vi.hoisted(() => ({
    run: vi.fn(),
}))

vi.mock(import('../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return { DBState: state } as unknown as typeof import('../stores.svelte')
})
vi.mock('./loreTest', () => ({ runLoreTest: h.run }))

import { DBState } from '../stores.svelte'
import { buildOwnerModel } from './ownerModel'
import { loreBody, makeCharacter, makeChat, makeInput, residentModule, stubModule } from './studioFixtures.test-helpers'
import {
    isLoreTestStale,
    loreTestDeepReadCount,
    loreTestSlot,
    resetLoreTestFor,
    runLoreTester,
    setLoreTestText,
} from './loreTestSession.svelte'

function okOutcome(): LoreTestOutcome {
    return {
        status: 'ok',
        contextChat: { name: 'ctx' },
        messageAdded: true,
        budget: { used: 0, limit: 100 },
        scanDepth: 5,
        attribution: 'ok',
        entries: [],
    }
}

interface Deferred {
    resolve: (outcome: LoreTestOutcome) => void
    reject: (error: Error) => void
}

function deferRun(): Deferred {
    const slot: Deferred = { resolve: () => {}, reject: () => {} }
    h.run.mockImplementationOnce(() => new Promise<LoreTestOutcome>((resolve, reject) => {
        slot.resolve = resolve
        slot.reject = reject
    }))
    return slot
}

interface TestChat {
    id: string
    name: string
    message: { role: string, data: string, time: number }[]
    localLore: ReturnType<typeof loreBody>[]
    bindedPersona?: string
    hypaV3Data?: { summaries: string[] }
}

function chatOf(name: string, extra: Partial<TestChat> = {}): TestChat {
    return { id: name, name, message: [{ role: 'user', data: 'hi', time: 0 }], localLore: [loreBody(`${name} lore`, 'body')], ...extra }
}

function freshDb(): void {
    const chaId = 'c1'
    DBState.db = {
        characters: [{
            type: 'character',
            chaId,
            name: 'Alice',
            chatPage: 1,
            globalLore: [loreBody('global', 'body')],
            loreSettings: { scanDepth: 5, tokenBudget: 1000, fullWordMatching: false },
            chats: [chatOf('chat0'), chatOf('ctx', { bindedPersona: 'p1', hypaV3Data: { summaries: ['s'] } }), chatOf('chat2')],
        }],
        enabledModules: [],
        moduleIntergration: '',
        loreBookDepth: 5,
        loreBookToken: 1000,
        templateDefaultVariables: '',
        username: 'User',
        personas: [{ id: 'p1', name: 'Persona', embeddedModule: { id: 'pm' } }],
        modules: [residentModule('m1', { lorebook: [{ key: 'k', secondkey: '', insertorder: 1, comment: 'm', content: 'body', mode: 'normal', alwaysActive: false, selective: false }] }), stubModule('s1')],
    } as unknown as Database
}

function modelOf() {
    return buildOwnerModel(makeInput({
        character: makeCharacter({ chaId: 'c1', chatPage: 1, chats: [makeChat({ id: 'ctx', name: 'ctx' })], modules: ['m1', 's1'] }),
        modules: [residentModule('m1'), stubModule('s1')],
    }))
}

// Every edit is a write through the reactive proxy, as the editors make it.
function liveCharacter() {
    return DBState.db.characters[0] as unknown as {
        globalLore: unknown[], loreSettings: { scanDepth: number }, chatPage: number, name: string
        chats: TestChat[]
    }
}
const liveContext = () => liveCharacter().chats[1]

beforeEach(() => {
    h.run.mockReset()
    h.run.mockImplementation(() => Promise.resolve(okOutcome()))
    resetLoreTestFor('reset-between-tests')
    freshDb()
})

describe('the slot', () => {
    test('regression reproducer (M-U12): keeps the text and result for the same character and clears on another', async () => {
        const model = modelOf()
        resetLoreTestFor('c1')
        setLoreTestText('c1', 'a dragon')
        await runLoreTester(model)
        expect(loreTestSlot.outcome?.status).toBe('ok')
        resetLoreTestFor('c1')
        expect(loreTestSlot.text).toBe('a dragon')
        expect(loreTestSlot.outcome).not.toBeNull()
        resetLoreTestFor('c2')
        expect(loreTestSlot).toMatchObject({ chaId: 'c2', text: '', outcome: null, pending: false, error: false })
    })

    test('regression reproducer: a text typed for another character resets first, so it never lands on the old slot', async () => {
        resetLoreTestFor('c1')
        setLoreTestText('c1', 'one')
        setLoreTestText('c2', 'two')
        expect(loreTestSlot).toMatchObject({ chaId: 'c2', text: 'two' })
    })

    test('regression reproducer: the runner is called with the character and the typed text, once', async () => {
        const model = modelOf()
        resetLoreTestFor('c1')
        setLoreTestText('c1', 'a dragon')
        await runLoreTester(model)
        expect(h.run).toHaveBeenCalledTimes(1)
        expect(h.run).toHaveBeenCalledWith({ chaId: 'c1', text: 'a dragon' })
    })

    test('regression reproducer: a second Run while one is pending does nothing', async () => {
        const model = modelOf()
        const first = deferRun()
        const started = runLoreTester(model)
        await vi.waitFor(() => expect(h.run).toHaveBeenCalledTimes(1))
        expect(loreTestSlot.pending).toBe(true)
        await runLoreTester(model)
        expect(h.run).toHaveBeenCalledTimes(1)
        first.resolve(okOutcome())
        await started
        expect(loreTestSlot.pending).toBe(false)
    })

    test('regression reproducer: a result that arrives after the character changed is dropped', async () => {
        const model = modelOf()
        const first = deferRun()
        const started = runLoreTester(model)
        await vi.waitFor(() => expect(h.run).toHaveBeenCalledTimes(1))
        resetLoreTestFor('c2')
        first.resolve(okOutcome())
        await started
        expect(loreTestSlot).toMatchObject({ chaId: 'c2', outcome: null, pending: false })
    })

    test('regression reproducer: a runner failure sets the error and ends the pending state', async () => {
        const model = modelOf()
        const first = deferRun()
        const started = runLoreTester(model)
        await vi.waitFor(() => expect(h.run).toHaveBeenCalledTimes(1))
        first.reject(new Error('boom'))
        await started
        expect(loreTestSlot).toMatchObject({ error: true, pending: false, outcome: null })
    })
})

describe('the stale signal', () => {
    async function ran(): Promise<ReturnType<typeof modelOf>> {
        const model = modelOf()
        await runLoreTester(model)
        expect(isLoreTestStale()).toBe(false)
        return model
    }

    const edits: [string, () => void][] = [
        ['a character lore entry', () => { (liveCharacter().globalLore[0] as { content: string }).content = 'edited' }],
        ['a character lore entry added', () => { liveCharacter().globalLore.push(loreBody('new', 'body')) }],
        ['a context chat lore entry', () => { liveContext().localLore[0].content = 'edited' }],
        ['a message added to the context chat', () => { liveContext().message.push({ role: 'char', data: 'more', time: 1 }) }],
        ['a context chat message edited', () => { liveContext().message[0].data = 'edited' }],
        ['the chat page', () => { liveCharacter().chatPage = 0 }],
        ['the lorebook settings', () => { liveCharacter().loreSettings.scanDepth = 9 }],
        ['a character field the scan text can read', () => { liveCharacter().name = 'Bob' }],
        ['a module lorebook entry', () => { (DBState.db.modules[0].lorebook ?? [])[0].content = 'edited' }],
        ['the enabled modules', () => { DBState.db.enabledModules = ['m1'] }],
        ['the user name', () => { DBState.db.username = 'Other' }],
        ['the persona bound to the context chat', () => { DBState.db.personas[0].name = 'Renamed' }],
        ['the default lorebook depth', () => { DBState.db.loreBookDepth = 9 }],
        ['the template default variables', () => { DBState.db.templateDefaultVariables = 'a=1' }],
    ]

    test.each(edits)('regression reproducer (M-U7, M-U9, M-U10): %s marks the result stale', async (_name, edit) => {
        await ran()
        edit()
        expect(isLoreTestStale()).toBe(true)
    })

    test('regression reproducer: no edit leaves the result fresh, and a read without an edit stays fresh', async () => {
        await ran()
        expect(isLoreTestStale()).toBe(false)
        expect(isLoreTestStale()).toBe(false)
    })

    const unwatched: [string, () => void][] = [
        ['a message of another chat', () => { liveCharacter().chats[0].message.push({ role: 'user', data: 'elsewhere', time: 2 }) }],
        ['a lore entry of another chat', () => { liveCharacter().chats[2].localLore[0].content = 'elsewhere' }],
        ['the memory data of the context chat', () => { liveContext().hypaV3Data = { summaries: ['changed'] } }],
        ['a summary inside the memory data of the context chat', () => { liveContext().hypaV3Data?.summaries.push('x') }],
    ]

    test.each(unwatched)('regression reproducer (M-U21): %s stays fresh', async (_name, edit) => {
        await ran()
        edit()
        expect(isLoreTestStale()).toBe(false)
    })

    test('regression reproducer (M-U8b): an edit while the run is pending is stale', async () => {
        const model = modelOf()
        const pending = deferRun()
        const started = runLoreTester(model)
        await vi.waitFor(() => expect(h.run).toHaveBeenCalledTimes(1))
        liveContext().message.push({ role: 'user', data: 'during', time: 3 })
        pending.resolve(okOutcome())
        await started
        expect(isLoreTestStale()).toBe(true)
    })

    test('regression reproducer (M-U8): an edit made right after Run starts, before the import resolves, is not stale', async () => {
        const model = modelOf()
        const started = runLoreTester(model)
        liveContext().message.push({ role: 'user', data: 'before the snapshot', time: 4 })
        await started
        expect(h.run).toHaveBeenCalledTimes(1)
        expect(isLoreTestStale()).toBe(false)
    })

    test('regression reproducer: a new Run makes a stale result fresh', async () => {
        const model = await ran()
        liveContext().message.push({ role: 'user', data: 'edit', time: 5 })
        expect(isLoreTestStale()).toBe(true)
        await runLoreTester(model)
        expect(isLoreTestStale()).toBe(false)
    })

    test('regression reproducer (M-U16, M-U20): once stale the inputs are not read again, whatever changes', async () => {
        await ran()
        liveContext().message.push({ role: 'user', data: 'edit', time: 6 })
        expect(isLoreTestStale()).toBe(true)
        const reads = loreTestDeepReadCount()
        liveContext().message.push({ role: 'user', data: 'edit 2', time: 7 })
        liveCharacter().globalLore.push(loreBody('n2', 'b'))
        DBState.db.username = 'again'
        expect(isLoreTestStale()).toBe(true)
        expect(isLoreTestStale()).toBe(true)
        expect(loreTestDeepReadCount()).toBe(reads)
    })

    test('regression reproducer: the stale signal changes the database by nothing, even without scriptstate or localLore', async () => {
        delete (liveContext() as { localLore?: unknown }).localLore
        const before = $state.snapshot(DBState.db)
        const keysBefore = Object.keys(liveContext())
        const model = modelOf()
        await runLoreTester(model)
        expect(isLoreTestStale()).toBe(false)
        liveCharacter().chatPage = 1
        expect(isLoreTestStale()).toBe(false)
        expect($state.snapshot(DBState.db)).toStrictEqual(before)
        expect(Object.keys(liveContext())).toStrictEqual(keysBefore)
        expect(Object.keys(liveContext())).not.toContain('scriptstate')
    })

    test('regression reproducer: a stub module is not asked for its body', async () => {
        const stub = DBState.db.modules[1]
        const reads: string[] = []
        DBState.db.modules[1] = new Proxy(stub, {
            get(target, key, receiver) {
                if (key === 'lorebook') reads.push('lorebook')
                return Reflect.get(target, key, receiver)
            },
        })
        const model = modelOf()
        await runLoreTester(model)
        expect(isLoreTestStale()).toBe(false)
        expect(reads).toEqual([])
    })
})

describe('the mechanism', () => {
    test(`diagnostic: an unowned derived re-evaluates only after a dependency changed (svelte ${VERSION})`, () => {
        const source = $state({ n: 0 })
        let evaluations = 0
        const derived = $derived.by(() => {
            evaluations += 1
            return source.n
        })
        const value = () => derived
        expect(value()).toBe(0)
        expect(value()).toBe(0)
        expect(evaluations).toBe(1)
        source.n = 1
        expect(value()).toBe(1)
        expect(value()).toBe(1)
        expect(evaluations).toBe(2)
    })

    test('diagnostic: reading it in an effect after the baseline does not evaluate it again', () => {
        const source = $state({ n: 0 })
        let evaluations = 0
        const derived = $derived.by(() => {
            evaluations += 1
            return source.n
        })
        const value = () => derived
        const baseline = value()
        const seen: number[] = []
        const stop = $effect.root(() => {
            $effect(() => { seen.push(value()) })
        })
        flushSync()
        expect(seen).toEqual([baseline])
        expect(evaluations).toBe(1)
        source.n = 2
        flushSync()
        expect(seen).toEqual([baseline, 2])
        stop()
    })
})
