// @vitest-environment jsdom
/**
 * The two live forms over a real history service on the memory doubles, a real save ack with injected
 * dependencies and a toast host on a fake clock. Time only moves when the test says so: the service and the ack
 * use one fake clock, and "drain" awaits resolved promises without moving it.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))

const db = $state({ db: { characters: [] as LiveCharacter[] } })
const selection = $state({ selId: 0 })

// Getters: the statically imported modules are evaluated before these consts are initialised.
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        get DBState() { return db },
        get selIdState() { return selection },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        frozenSaveKeysStore: writable([]),
    }
})
// No prompt is ever on screen in these suites; the real one would read the alert store this mock leaves out.
vi.mock('src/ts/alertPrompts', async (importOriginal) => ({ ...(await importOriginal<typeof import('src/ts/alertPrompts')>()), pageCovered: () => false }))
vi.mock('src/lang', async () => {
    const helpers = await import('src/ts/studio/studioFixtures.test-helpers')
    return { language: helpers.studioLanguageMock() }
})

import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { createSaveAck, PENDING_DELAY_MS, type SaveAck, type SaveAckDeps } from 'src/ts/studio/edit/saveAck.svelte'
import { refusalText } from 'src/ts/studio/edit/studioToasts'
import { backCloseHandler } from 'src/ts/backHandlers'
import { studioOpen } from 'src/ts/studio/studioOpen'
import { closeStudio, resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { DEFAULT_TOAST_CONFIG, createToastHost, type ToastClock, type ToastHost } from 'src/ts/toast/toastHost.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey, chatOwnerKey, SAVE_DEBOUNCE_MS, READY_DEADLINE_MS } from '../../ts/studio/history/ownerPhase'
import { ensureStudioHistory, resetStudioHistoryAccessorForTests, setStudioHistoryLoaderForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks, type FakeClock } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { asideMarkKey, headerKey } from '../../ts/studio/history/studioHistoryStore'
import { createClaimDouble, createGate, createMemoryStudioStore, type ClaimDouble, type MemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import StudioCharacterForm from './StudioCharacterForm.svelte'
import StudioChatNoteForm from './StudioChatNoteForm.svelte'
import StudioStatusChip from './StudioStatusChip.svelte'

interface LiveChat {
    id?: string
    note: string
    fmIndex?: number
}

interface LiveCharacter {
    chaId: string
    type: string
    license?: string
    desc: string
    hideChatIcon?: boolean
    alternateGreetings: string[]
    chats: LiveChat[]
    chatPage: number
}

function makeCharacter(overrides: Partial<LiveCharacter> = {}): LiveCharacter {
    return {
        chaId: 'A',
        type: 'character',
        desc: 'd0',
        alternateGreetings: ['g0', 'g1', 'g2'],
        chats: [{ id: 'c1', note: 'n0', fmIndex: 2 }],
        chatPage: 0,
        ...overrides,
    }
}

const A = characterOwnerKey('A')
const CHAT = chatOwnerKey('A', 'c1')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

// ---------------------------------------------------------------- rigs

interface AckControls {
    commit(): void
}

interface Rig {
    clock: FakeClock
    store: MemoryStudioStore
    claim: ClaimDouble
    service: OwnerHistoryService
    ack: SaveAck
    ackControls: AckControls
}

function makeAck(clock: FakeClock): { ack: SaveAck; controls: AckControls } {
    let committed = 0
    const commitCallbacks = new Set<() => void>()
    const deps: SaveAckDeps = {
        getMarkCount: () => h.marks,
        getCommittedMarkCount: () => committed,
        afterNextCommit: (callback) => {
            commitCallbacks.add(callback)
        },
        requestSaveNow: () => {},
        getPeerSaveCount: () => 0,
        onStopped: () => () => {},
        isStopped: () => false,
        subscribeFailure: () => () => {},
        currentFailure: () => null,
        frozenKeys: () => new Set<string>(),
        isCharacterUnsavable: () => false,
        onPassStart: () => () => {},
        visible: () => true,
        onVisibilityChange: () => () => {},
        clock,
    }
    return {
        ack: createSaveAck(deps),
        controls: {
            commit() {
                committed = h.marks
                const callbacks = [...commitCallbacks]
                commitCallbacks.clear()
                for (const callback of callbacks) callback()
            },
        },
    }
}

function makeRig(shared?: Map<string, string>): Rig {
    const clock = createFakeClock()
    const store = createMemoryStudioStore({ shared })
    const claim = createClaimDouble()
    const service = createOwnerHistoryService({
        store,
        claim,
        clock,
        pageSession: 'p1',
        registerLeaveFlush: () => () => {},
    })
    const { ack, controls } = makeAck(clock)
    setStudioHistoryServiceForTests(service)
    setStudioVisitAckForTests(ack)
    return { clock, store, claim, service, ack, ackControls: controls }
}

interface ToastRig {
    host: ToastHost
    // Moves the host's time; timers due within the step fire in order.
    advance(ms: number): void
}

function makeToastHost(): ToastRig {
    let time = 0
    let nextKey = 1
    const timers = new Map<number, { at: number; run: () => void }>()
    const clock: ToastClock = {
        now: () => time,
        after(ms, run) {
            const key = nextKey++
            timers.set(key, { at: time + ms, run })
            return () => {
                timers.delete(key)
            }
        },
    }
    return {
        host: createToastHost({ clock }),
        advance(ms) {
            const target = time + ms
            for (;;) {
                let next: [number, { at: number; run: () => void }] | null = null
                for (const entry of timers) {
                    if (entry[1].at <= target && (next === null || entry[1].at < next[1].at)) next = entry
                }
                if (next === null) break
                timers.delete(next[0])
                time = next[1].at
                next[1].run()
            }
            time = target
        },
    }
}

// ---------------------------------------------------------------- dom helpers

let mounted: { app: ReturnType<typeof mount>; host: HTMLElement }[] = []

function mountInto(component: Parameters<typeof mount>[0], props: Record<string, unknown>): HTMLElement {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const app = mount(component, { target: host, props })
    mounted.push({ app, host })
    flushSync()
    return host
}

async function unmountAll(): Promise<void> {
    for (const entry of mounted.splice(0)) {
        await unmount(entry.app)
        entry.host.remove()
    }
}

async function settle(): Promise<void> {
    await drainMicrotasks()
    flushSync()
}

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
const parts = (name: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-part="${name}"]`))
const desc = () => part('studio-form-desc') as HTMLTextAreaElement
const note = () => part('studio-form-note') as HTMLTextAreaElement
const hideIcon = () => part('studio-form-hide-icon') as HTMLInputElement
const greetingInputs = () => parts('studio-greeting-input') as HTMLTextAreaElement[]

function type(field: HTMLTextAreaElement, value: string): void {
    field.value = value
    field.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

function live(): LiveCharacter {
    return db.db.characters[0]
}

beforeEach(() => {
    h.marks = 0
    tracker.character.length = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    db.db.characters = [makeCharacter()]
    selection.selId = 0
    studioScreen.chaId = 'A'
    studioScreen.visitId = 'v1'
    studioScreen.open = true
})

afterEach(async () => {
    await unmountAll()
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

// ---------------------------------------------------------------- L1: read-only while loading

describe('T-UI11 the form is read-only while the owner loads', () => {
    test('with the claim pending the fields are read-only and busy, typing changes nothing, then it opens up', async () => {
        const rig = makeRig()
        const gate = createGate()
        rig.claim.hook = () => gate.promise
        mountInto(StudioCharacterForm, { chaId: 'A' })
        await settle()
        expect(desc().readOnly).toBe(true)
        expect(desc().getAttribute('aria-busy')).toBe('true')
        expect(part('studio-form-loading')?.textContent).toBe('studioFormLoading')
        expect(hideIcon().disabled).toBe(true)
        expect((part('studio-greeting-add') as HTMLButtonElement).disabled).toBe(true)
        expect(greetingInputs()[0].readOnly).toBe(true)

        type(desc(), 'typed while loading')
        expect(live().desc).toBe('d0')
        expect(desc().value).toBe('d0')
        expect(h.marks).toBe(0)

        gate.release()
        await settle()
        expect(desc().readOnly).toBe(false)
        expect(desc().hasAttribute('aria-busy')).toBe(false)
        expect(part('studio-form-loading')).toBeNull()
        type(desc(), 'typed after ready')
        expect(live().desc).toBe('typed after ready')
        expect(h.marks).toBe(1)
    })

    test('with the open never answering, the form is editable with the unavailable banner at the deadline (M71)', async () => {
        const rig = makeRig()
        rig.store.hooks.open = () => new Promise<void>(() => {})
        mountInto(StudioCharacterForm, { chaId: 'A' })
        await settle()
        await rig.clock.advance(READY_DEADLINE_MS - 1)
        flushSync()
        expect(desc().readOnly).toBe(true)
        await rig.clock.advance(1)
        flushSync()
        expect(desc().readOnly).toBe(false)
        expect(desc().hasAttribute('aria-busy')).toBe(false)
        expect(part('studio-form-banner')?.getAttribute('data-banner')).toBe('unavailable')
        expect(part('studio-form-banner')?.textContent).toBe('studioBannerUnavailable')
        type(desc(), 'typed')
        expect(live().desc).toBe('typed')
        await rig.clock.advance(SAVE_DEBOUNCE_MS)
        expect(rig.store.counts.save).toBe(0)
    })

    test('the chat note form is read-only and busy while loading too', async () => {
        const rig = makeRig()
        const gate = createGate()
        rig.claim.hook = () => gate.promise
        mountInto(StudioChatNoteForm, { chaId: 'A', chatId: 'c1' })
        await settle()
        expect(note().readOnly).toBe(true)
        expect(note().getAttribute('aria-busy')).toBe('true')
        type(note(), 'typed while loading')
        expect(live().chats[0].note).toBe('n0')
        gate.release()
        await settle()
        expect(note().readOnly).toBe(false)
        type(note(), 'typed after ready')
        expect(live().chats[0].note).toBe('typed after ready')
    })
})

describe('I11 the history service itself cannot be loaded', () => {
    // The service is not injected here: the accessor builds it through a loader that fails once, and the rig's
    // service stands for the build the retry delivers.
    function failOnce(rig: Rig): () => number {
        setStudioHistoryServiceForTests(null)
        let attempts = 0
        setStudioHistoryLoaderForTests(async () => {
            attempts += 1
            if (attempts === 1) throw new Error('the service chunk could not be loaded')
            return { service: rig.service, createAck: () => rig.ack }
        })
        return () => attempts
    }

    test('the character form shows the failed banner and Retry, not the loading note; Retry builds the service and the fields open up', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const attempts = failOnce(makeRig())
        mountInto(StudioCharacterForm, { chaId: 'A' })
        await settle()
        expect(attempts()).toBe(1)
        expect(part('studio-form-banner')?.getAttribute('data-banner')).toBe('failed')
        expect(part('studio-form-banner')?.textContent).toBe('studioBannerFailed')
        expect(part('studio-history-retry')?.textContent).toBe('studioChipRetry')
        expect(part('studio-form-loading')).toBeNull()
        expect(desc().readOnly).toBe(true)
        type(desc(), 'typed with no service')
        expect(live().desc).toBe('d0')

        part('studio-history-retry')?.click()
        await settle()
        await settle()
        expect(attempts()).toBe(2)
        expect(part('studio-history-retry')).toBeNull()
        expect(part('studio-form-banner')).toBeNull()
        expect(desc().readOnly).toBe(false)
        type(desc(), 'typed after retry')
        expect(live().desc).toBe('typed after retry')
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    test('the chat note form shows the same banner and Retry', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const attempts = failOnce(makeRig())
        mountInto(StudioChatNoteForm, { chaId: 'A', chatId: 'c1' })
        await settle()
        expect(attempts()).toBe(1)
        expect(part('studio-form-banner')?.getAttribute('data-banner')).toBe('failed')
        expect(part('studio-history-retry')).not.toBeNull()
        expect(part('studio-form-loading')).toBeNull()
        expect(note().readOnly).toBe(true)
        part('studio-history-retry')?.click()
        await settle()
        await settle()
        expect(part('studio-history-retry')).toBeNull()
        expect(note().readOnly).toBe(false)
    })

    // T-UI-R1: the Retry button unmounts when the build starts, so focus moves to the form's root first.
    test('T-UI-R1 after a Retry click focus is on the form root, never on the body', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        failOnce(makeRig())
        mountInto(StudioCharacterForm, { chaId: 'A' })
        await settle()
        await settle()
        const retry = part('studio-history-retry') as HTMLButtonElement
        retry.focus()
        expect(document.activeElement).toBe(retry)
        retry.click()
        await settle()
        await settle()
        expect(part('studio-history-retry')).toBeNull()
        expect(document.activeElement).not.toBe(document.body)
        expect(document.activeElement).toBe(part('studio-character-form'))
    })

    test('T-UI-R1 the chat note form moves focus to its root too', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        failOnce(makeRig())
        mountInto(StudioChatNoteForm, { chaId: 'A', chatId: 'c1' })
        await settle()
        await settle()
        const retry = part('studio-history-retry') as HTMLButtonElement
        retry.focus()
        retry.click()
        await settle()
        await settle()
        expect(part('studio-history-retry')).toBeNull()
        expect(document.activeElement).not.toBe(document.body)
        expect(document.activeElement).toBe(part('studio-chat-note-form'))
    })

    // T-UI-R2: a retry that fails again puts Retry back; focus follows it only when the click had put it on the root.
    test('T-UI-R2 when Retry fails twice the banner and Retry return and focus lands on Retry; a build nobody asked for steals nothing', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        setStudioHistoryServiceForTests(null)
        let attempts = 0
        setStudioHistoryLoaderForTests(async () => {
            attempts += 1
            throw new Error('the service chunk could not be loaded')
        })
        mountInto(StudioCharacterForm, { chaId: 'A' })
        await settle()
        await settle()
        expect(attempts).toBe(1)
        expect(part('studio-form-banner')?.getAttribute('data-banner')).toBe('failed')
        // The first failure was nobody's click: focus is not moved.
        expect(document.activeElement).toBe(document.body)

        for (const expected of [2, 3]) {
            const retry = part('studio-history-retry') as HTMLButtonElement
            retry.focus()
            retry.click()
            await settle()
            await settle()
            expect(attempts).toBe(expected)
            expect(part('studio-form-banner')?.getAttribute('data-banner')).toBe('failed')
            expect(part('studio-history-retry')).not.toBeNull()
            expect(document.activeElement).toBe(part('studio-history-retry'))
        }

        // A build started some other way fails while focus sits on the root: the flag of the earlier click is spent.
        const root = part('studio-character-form') as HTMLElement
        root.focus()
        ensureStudioHistory()
        await settle()
        await settle()
        expect(attempts).toBe(4)
        expect(document.activeElement).toBe(root)
    })

    test('T-UI-R2 the chat note form: Retry that fails twice returns with focus on Retry; a build nobody asked for steals nothing', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        setStudioHistoryServiceForTests(null)
        let attempts = 0
        setStudioHistoryLoaderForTests(async () => {
            attempts += 1
            throw new Error('the service chunk could not be loaded')
        })
        mountInto(StudioChatNoteForm, { chaId: 'A', chatId: 'c1' })
        await settle()
        await settle()
        expect(attempts).toBe(1)
        expect(part('studio-form-banner')?.getAttribute('data-banner')).toBe('failed')
        expect(document.activeElement).toBe(document.body)

        for (const expected of [2, 3]) {
            const retry = part('studio-history-retry') as HTMLButtonElement
            retry.focus()
            retry.click()
            await settle()
            await settle()
            expect(attempts).toBe(expected)
            expect(part('studio-form-banner')?.getAttribute('data-banner')).toBe('failed')
            expect(part('studio-history-retry')).not.toBeNull()
            expect(document.activeElement).toBe(part('studio-history-retry'))
        }

        const root = part('studio-chat-note-form') as HTMLElement
        root.focus()
        ensureStudioHistory()
        await settle()
        await settle()
        expect(attempts).toBe(4)
        expect(document.activeElement).toBe(root)
    })

    test('T-UI-R2 the chat note form: a Retry whose build succeeds spends the flag, so a later unrelated failed build steals no focus', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const rig = makeRig()
        setStudioHistoryServiceForTests(null)
        let attempts = 0
        setStudioHistoryLoaderForTests(async () => {
            attempts += 1
            if (attempts === 2) return { service: rig.service, createAck: () => rig.ack }
            throw new Error('the service chunk could not be loaded')
        })
        mountInto(StudioChatNoteForm, { chaId: 'A', chatId: 'c1' })
        await settle()
        await settle()
        expect(attempts).toBe(1)

        const retry = part('studio-history-retry') as HTMLButtonElement
        retry.focus()
        retry.click()
        await settle()
        await settle()
        expect(attempts).toBe(2)
        expect(part('studio-history-retry')).toBeNull()

        // The built service is forgotten and a build nobody asked for fails while focus sits on the root.
        const root = part('studio-chat-note-form') as HTMLElement
        root.focus()
        resetStudioHistoryAccessorForTests()
        setStudioHistoryLoaderForTests(async () => {
            attempts += 1
            throw new Error('the service chunk could not be loaded')
        })
        ensureStudioHistory()
        await settle()
        await settle()
        expect(attempts).toBe(3)
        expect(part('studio-form-banner')?.getAttribute('data-banner')).toBe('failed')
        expect(document.activeElement).toBe(root)
    })

    test('T-UI-R2 the chat note form: when the user moves focus away between the Retry click and the failure, focus is not pulled back to Retry', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        setStudioHistoryServiceForTests(null)
        const gate = createGate()
        let attempts = 0
        setStudioHistoryLoaderForTests(async () => {
            attempts += 1
            if (attempts > 1) await gate.promise
            throw new Error('the service chunk could not be loaded')
        })
        mountInto(StudioChatNoteForm, { chaId: 'A', chatId: 'c1' })
        await settle()
        await settle()
        expect(attempts).toBe(1)

        const elsewhere = document.createElement('button')
        document.body.appendChild(elsewhere)
        try {
            const retry = part('studio-history-retry') as HTMLButtonElement
            retry.focus()
            retry.click()
            await settle()
            expect(attempts).toBe(2)
            expect(document.activeElement).toBe(part('studio-chat-note-form'))
            elsewhere.focus()
            gate.release()
            await settle()
            await settle()
            expect(part('studio-history-retry')).not.toBeNull()
            expect(document.activeElement).toBe(elsewhere)
        } finally {
            elsewhere.remove()
        }
    })
})

describe('the chat note form root has an accessible name', () => {
    test('aria-labelledby names the root after the visible Note label', async () => {
        makeRig()
        mountInto(StudioChatNoteForm, { chaId: 'A', chatId: 'c1' })
        await settle()
        const labelledBy = part('studio-chat-note-form')?.getAttribute('aria-labelledby')
        expect(labelledBy).toBeTruthy()
        const label = document.getElementById(labelledBy as string)
        expect(label?.textContent).toBe('note')
    })
})

// ---------------------------------------------------------------- L5: private and groups

describe('L5 nothing is rendered for a private owner, re-checked at every render', () => {
    test('a private character shows neither form', async () => {
        makeRig()
        live().license = 'private'
        mountInto(StudioCharacterForm, { chaId: 'A' })
        mountInto(StudioChatNoteForm, { chaId: 'A', chatId: 'c1' })
        await settle()
        expect(part('studio-character-form')).toBeNull()
        expect(part('studio-chat-note-form')).toBeNull()
        expect(document.body.textContent).not.toContain('d0')
    })

    test('a group shows neither form', async () => {
        makeRig()
        live().type = 'group'
        mountInto(StudioCharacterForm, { chaId: 'A' })
        mountInto(StudioChatNoteForm, { chaId: 'A', chatId: 'c1' })
        await settle()
        expect(part('studio-character-form')).toBeNull()
        expect(part('studio-chat-note-form')).toBeNull()
    })

    test('a character that becomes private while the forms are open loses them at once, and edits are refused', async () => {
        const rig = makeRig()
        mountInto(StudioCharacterForm, { chaId: 'A' })
        mountInto(StudioChatNoteForm, { chaId: 'A', chatId: 'c1' })
        await settle()
        expect(part('studio-character-form')).not.toBeNull()
        expect(part('studio-chat-note-form')).not.toBeNull()
        live().license = 'private'
        flushSync()
        expect(part('studio-character-form')).toBeNull()
        expect(part('studio-chat-note-form')).toBeNull()
        expect(rig.service.editField(A, 'desc', 'x')).toEqual({ ok: false, reason: 'restricted' })
        expect(live().desc).toBe('d0')
    })
})

// ---------------------------------------------------------------- the character form

describe('the character form edits through the history service', () => {
    test('focusing and blurring fields writes, marks and records nothing, and leaves an absent key absent', async () => {
        const rig = makeRig()
        mountInto(StudioCharacterForm, { chaId: 'A' })
        await settle()
        for (const field of [desc(), ...greetingInputs()]) {
            field.focus()
            expect(field.dataset.studioFocusValue).toBe(field.value)
            field.blur()
        }
        hideIcon().focus()
        hideIcon().blur()
        flushSync()
        expect(h.marks).toBe(0)
        expect(rig.service.view(A).done).toHaveLength(0)
        expect('hideChatIcon' in live()).toBe(false)
        expect(live().alternateGreetings).toEqual(['g0', 'g1', 'g2'])
    })

    test('typing lands in the character, marks it, records a step and moves the chip through pending to saved (T-UI2)', async () => {
        const rig = makeRig()
        mountInto(StudioCharacterForm, { chaId: 'A' })
        const chipHost = mountInto(StudioStatusChip, { ack: rig.ack })
        await settle()
        const chip = () => chipHost.querySelector('[data-part="studio-chip"]')?.getAttribute('data-state')
        expect(chip()).toBe('idle')
        type(desc(), 'typed')
        expect(live().desc).toBe('typed')
        expect(h.marks).toBe(1)
        expect(rig.service.view(A).done).toHaveLength(1)
        expect(chip()).toBe('idle')
        rig.clock.tick(PENDING_DELAY_MS)
        flushSync()
        expect(chip()).toBe('pending')
        rig.ackControls.commit()
        flushSync()
        expect(chip()).toBe('saved')
    })

    test('typing coalesces into one step until blur closes it (M: no close at blur)', async () => {
        const rig = makeRig()
        mountInto(StudioCharacterForm, { chaId: 'A' })
        await settle()
        type(desc(), 'a')
        rig.clock.set(100)
        type(desc(), 'ab')
        expect(rig.service.view(A).done).toHaveLength(1)
        desc().dispatchEvent(new FocusEvent('blur'))
        rig.clock.set(200)
        type(desc(), 'abc')
        expect(rig.service.view(A).done).toHaveLength(2)
    })

    test('closing the visit (the form is destroyed) closes the open step', async () => {
        const rig = makeRig()
        mountInto(StudioCharacterForm, { chaId: 'A' })
        await settle()
        type(desc(), 'a')
        await unmountAll()
        rig.clock.set(100)
        expect(rig.service.editField(A, 'desc', 'ab').ok).toBe(true)
        expect(rig.service.view(A).done).toHaveLength(2)
    })

    test('the hide-icon checkbox writes true, then false, through the service', async () => {
        const rig = makeRig()
        mountInto(StudioCharacterForm, { chaId: 'A' })
        await settle()
        expect(hideIcon().checked).toBe(false)
        hideIcon().click()
        flushSync()
        expect(live().hideChatIcon).toBe(true)
        hideIcon().click()
        flushSync()
        expect(live().hideChatIcon).toBe(false)
        expect(h.marks).toBe(2)
        expect(rig.service.view(A).done).toHaveLength(2)
    })

    test('the field follows the live value when the service changes it (undo)', async () => {
        const rig = makeRig()
        mountInto(StudioCharacterForm, { chaId: 'A' })
        await settle()
        type(desc(), 'typed')
        expect(rig.service.undo(A).ok).toBe(true)
        flushSync()
        expect(desc().value).toBe('d0')
    })

    test('a refused edit shows its reason, changes nothing and restores the field', async () => {
        makeRig()
        mountInto(StudioCharacterForm, { chaId: 'A' })
        await settle()
        studioScreen.chaId = 'B'
        type(desc(), 'typed')
        expect(live().desc).toBe('d0')
        expect(desc().value).toBe('d0')
        expect(h.marks).toBe(0)
        expect(part('studio-form-refusal')?.textContent).toBe(refusalText('not-selected'))
    })

    test('editing a first message and adding one go through the service', async () => {
        const rig = makeRig()
        mountInto(StudioCharacterForm, { chaId: 'A' })
        await settle()
        type(greetingInputs()[1], 'g1 edited')
        expect(live().alternateGreetings).toEqual(['g0', 'g1 edited', 'g2'])
        ;(part('studio-greeting-add') as HTMLButtonElement).click()
        await settle()
        expect(live().alternateGreetings).toEqual(['g0', 'g1 edited', 'g2', ''])
        expect(greetingInputs()).toHaveLength(4)
        expect(document.activeElement).toBe(greetingInputs()[3])
        expect(rig.service.view(A).done).toHaveLength(2)
    })
})

describe('T-UI4 deleting a first message', () => {
    function deleteRow(index: number): void {
        ;(parts('studio-greeting-delete')[index] as HTMLButtonElement).click()
    }

    test('posts one Undo toast per delete and moves focus to the next row, else the previous, else Add', async () => {
        const rig = makeRig()
        const { host } = makeToastHost()
        mountInto(StudioCharacterForm, { chaId: 'A', host })
        await settle()

        deleteRow(1)
        await settle()
        expect(live().alternateGreetings).toEqual(['g0', 'g2'])
        expect(host.visible.map((toast) => toast.kind)).toEqual(['undo'])
        expect(document.activeElement).toBe(greetingInputs()[1])

        deleteRow(1)
        await settle()
        expect(live().alternateGreetings).toEqual(['g0'])
        expect(host.visible).toHaveLength(2)
        expect(document.activeElement).toBe(greetingInputs()[0])

        deleteRow(0)
        await settle()
        expect(live().alternateGreetings).toEqual([])
        expect(host.visible).toHaveLength(3)
        expect(document.activeElement).toBe(part('studio-greeting-add'))
        expect(rig.service.view(A).deleted).toHaveLength(3)
    })

    test('the toast action restores through the service and the field list shows it again', async () => {
        makeRig()
        const { host, advance } = makeToastHost()
        mountInto(StudioCharacterForm, { chaId: 'A', host })
        await settle()
        deleteRow(1)
        await settle()
        // The Undo is still offered at the end of its window.
        advance(DEFAULT_TOAST_CONFIG.undoMs - 1)
        expect(host.visible).toHaveLength(1)
        await host.activate(host.visible[0].id)
        await settle()
        expect(live().alternateGreetings).toEqual(['g0', 'g1', 'g2'])
        expect(greetingInputs().map((field) => field.value)).toEqual(['g0', 'g1', 'g2'])
        expect(host.visible[0].kind).toBe('success')
    })

    test('a refused delete posts no toast', async () => {
        makeRig()
        const { host } = makeToastHost()
        mountInto(StudioCharacterForm, { chaId: 'A', host })
        await settle()
        studioScreen.chaId = 'B'
        deleteRow(0)
        await settle()
        expect(host.visible).toHaveLength(0)
        expect(live().alternateGreetings).toEqual(['g0', 'g1', 'g2'])
    })
})

// ---------------------------------------------------------------- banners

describe('the banner names why history is not kept', () => {
    const bannerOf = () => part('studio-form-banner')

    async function expectBanner(reason: string, key: string): Promise<void> {
        expect(bannerOf()?.getAttribute('data-banner')).toBe(reason)
        expect(bannerOf()?.textContent).toBe(key)
    }

    test('otherTab: another page holds the character', async () => {
        const rig = makeRig()
        rig.claim.forced = 'held'
        mountInto(StudioCharacterForm, { chaId: 'A' })
        await settle()
        await expectBanner('otherTab', 'studioBannerOtherTab')
        expect(desc().readOnly).toBe(false)
    })

    test('noLocks: the page has no Web Locks', async () => {
        const rig = makeRig()
        rig.claim.unsupported = true
        mountInto(StudioCharacterForm, { chaId: 'A' })
        await settle()
        await expectBanner('noLocks', 'studioBannerNoLocks')
    })

    test('failed: the claim failed', async () => {
        const rig = makeRig()
        rig.claim.forced = 'failed'
        mountInto(StudioCharacterForm, { chaId: 'A' })
        await settle()
        await expectBanner('failed', 'studioBannerFailed')
    })

    test('unavailable: the store connection was closed', async () => {
        const rig = makeRig()
        rig.store.simulateClose()
        mountInto(StudioCharacterForm, { chaId: 'A' })
        await settle()
        await expectBanner('unavailable', 'studioBannerUnavailable')
    })

    test('unwritable: a save could not be written, and a later good save clears the banner', async () => {
        const rig = makeRig()
        rig.store.forcedSave = { kind: 'unwritable' }
        mountInto(StudioCharacterForm, { chaId: 'A' })
        await settle()
        expect(bannerOf()).toBeNull()
        type(desc(), 'typed')
        await rig.clock.advance(SAVE_DEBOUNCE_MS)
        flushSync()
        await expectBanner('unwritable', 'studioBannerUnwritable')
        rig.store.forcedSave = null
        type(desc(), 'typed more')
        await rig.clock.advance(SAVE_DEBOUNCE_MS)
        flushSync()
        expect(bannerOf()).toBeNull()
    })

    test('trimmed: the stored copy was trimmed to the cap', async () => {
        const rig = makeRig()
        rig.store.forcedSave = { kind: 'ok', asided: false, trimmed: true }
        mountInto(StudioCharacterForm, { chaId: 'A' })
        await settle()
        type(desc(), 'typed')
        await rig.clock.advance(SAVE_DEBOUNCE_MS)
        flushSync()
        await expectBanner('trimmed', 'studioBannerTrimmed')
    })

    test('unreadable: stored bytes could not be read and were set aside by the first save', async () => {
        // Hand-written: stands for a header written by a later producer.
        const shared = new Map<string, string>([[headerKey(A), '{"v":2}']])
        const rig = makeRig(shared)
        mountInto(StudioCharacterForm, { chaId: 'A' })
        await settle()
        type(desc(), 'typed')
        await rig.clock.advance(SAVE_DEBOUNCE_MS)
        flushSync()
        await expectBanner('unreadable', 'studioBannerUnreadable')
        expect(shared.get(asideMarkKey(A))).toBe('{"v":2}')
    })

    test('keptUnreadable: unreadable bytes already have a copy aside, so history stays in memory', async () => {
        const shared = new Map<string, string>([
            [headerKey(A), '{"v":2}'],
            [asideMarkKey(A), 'an earlier copy'],
        ])
        const before = new Map(shared)
        makeRig(shared)
        mountInto(StudioCharacterForm, { chaId: 'A' })
        await settle()
        await expectBanner('keptUnreadable', 'studioBannerKeptUnreadable')
        expect(desc().readOnly).toBe(false)
        expect(shared).toEqual(before)
    })

    test('a healthy owner shows no banner', async () => {
        makeRig()
        mountInto(StudioCharacterForm, { chaId: 'A' })
        await settle()
        expect(bannerOf()).toBeNull()
        expect(part('studio-form-loading')).toBeNull()
    })
})

// ---------------------------------------------------------------- the chat note form

describe('the chat note form', () => {
    test('typing edits the note through the service, marks the character and records a step', async () => {
        const rig = makeRig()
        mountInto(StudioChatNoteForm, { chaId: 'A', chatId: 'c1' })
        await settle()
        expect(note().value).toBe('n0')
        type(note(), 'n1')
        expect(live().chats[0].note).toBe('n1')
        expect(h.marks).toBe(1)
        expect(rig.service.view(CHAT).done).toHaveLength(1)
        note().focus()
        expect(note().dataset.studioFocusValue).toBe('n1')
    })

    test('a chat without a unique id shows its note read-only with the reason and gets no history', async () => {
        const rig = makeRig()
        live().chats = [{ note: 'n0' }]
        mountInto(StudioChatNoteForm, { chaId: 'A', chatId: '0' })
        await settle()
        expect(note().readOnly).toBe(true)
        expect(note().value).toBe('n0')
        expect(part('studio-form-readonly-reason')?.textContent).toBe('studioRefusalNoUniqueChat')
        type(note(), 'typed')
        expect(live().chats[0].note).toBe('n0')
        expect(h.marks).toBe(0)
        expect(rig.service.view(chatOwnerKey('A', '0')).phase).toBe('unused')
    })

    test('two chats with one id are not edited either', async () => {
        makeRig()
        live().chats = [{ id: 'c1', note: 'n0' }, { id: 'c1', note: 'other' }]
        mountInto(StudioChatNoteForm, { chaId: 'A', chatId: 'c1' })
        await settle()
        expect(note().readOnly).toBe(true)
        expect(part('studio-form-readonly-reason')).not.toBeNull()
    })
})

// ---------------------------------------------------------------- first-message rows keep their node

describe('first-message rows are keyed by identity', () => {
    interface ValueWriteSpy {
        // Every node whose `value` was assigned since the last reset, in order.
        writes: HTMLTextAreaElement[]
        reset(): void
        restore(): void
    }

    let activeSpy: ValueWriteSpy | null = null

    // Wraps the `value` setter of HTMLTextAreaElement.prototype, where the framework's value binding writes.
    function installValueWriteSpy(): ValueWriteSpy {
        const original = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
        if (!original || !original.set || !original.get) throw new Error('the textarea value accessor is missing')
        const setValue = original.set
        const writes: HTMLTextAreaElement[] = []
        Object.defineProperty(HTMLTextAreaElement.prototype, 'value', {
            configurable: true,
            enumerable: original.enumerable,
            get: original.get,
            set(this: HTMLTextAreaElement, next: string) {
                writes.push(this)
                setValue.call(this, next)
            },
        })
        const spy: ValueWriteSpy = {
            writes,
            reset() {
                writes.length = 0
            },
            restore() {
                Object.defineProperty(HTMLTextAreaElement.prototype, 'value', original)
                activeSpy = null
            },
        }
        activeSpy = spy
        return spy
    }

    afterEach(() => {
        activeSpy?.restore()
    })

    // Distinct strings with a unique leading tag and filler, shaped like long first messages.
    function messages(count: number, tag = 'g'): string[] {
        return Array.from({ length: count }, (_unused, i) => `${tag}${i}:${'x'.repeat(200)}`)
    }

    const valuesOf = () => greetingInputs().map((field) => field.value)
    const deleteButton = (index: number) => parts('studio-greeting-delete')[index] as HTMLButtonElement

    async function mountList(list: string[]): Promise<{ rig: Rig; host: ToastRig }> {
        const rig = makeRig()
        const host = makeToastHost()
        live().alternateGreetings = list
        mountInto(StudioCharacterForm, { chaId: 'A', host: host.host })
        await settle()
        return { rig, host }
    }

    function writesOn(nodes: readonly HTMLTextAreaElement[], spy: ValueWriteSpy): number {
        return spy.writes.filter((node) => nodes.includes(node)).length
    }

    test('R1 deleting slot 0 keeps the other nodes and writes none of them', async () => {
        const list = messages(3)
        await mountList(list)
        const before = greetingInputs()
        const spy = installValueWriteSpy()
        deleteButton(0).click()
        await settle()
        const after = greetingInputs()
        expect(after).toHaveLength(2)
        expect(after[0]).toBe(before[1])
        expect(after[1]).toBe(before[2])
        expect(writesOn(before, spy)).toBe(0)
        expect(valuesOf()).toEqual(list.slice(1))
    })

    test('R2 deleting a middle row keeps the other nodes and writes none of them', async () => {
        const list = messages(4)
        await mountList(list)
        const before = greetingInputs()
        const spy = installValueWriteSpy()
        deleteButton(1).click()
        await settle()
        const after = greetingInputs()
        expect(after).toHaveLength(3)
        expect(after[0]).toBe(before[0])
        expect(after[1]).toBe(before[2])
        expect(after[2]).toBe(before[3])
        expect(writesOn(before, spy)).toBe(0)
        expect(valuesOf()).toEqual([list[0], list[2], list[3]])
    })

    test('R3 undo of a delete mounts one node and leaves the others unwritten', async () => {
        const list = messages(3)
        const { rig } = await mountList(list)
        expect(rig.service.greetingDelete(A, 0).ok).toBe(true)
        await settle()
        const before = greetingInputs()
        const spy = installValueWriteSpy()
        expect(rig.service.undo(A).ok).toBe(true)
        await settle()
        const after = greetingInputs()
        expect(after).toHaveLength(3)
        expect(after[1]).toBe(before[0])
        expect(after[2]).toBe(before[1])
        expect(before).not.toContain(after[0])
        expect(writesOn(before, spy)).toBe(0)
        expect(valuesOf()).toEqual(list)
    })

    test('R4 redo of a delete removes one node and leaves the others unwritten', async () => {
        const list = messages(3)
        const { rig } = await mountList(list)
        expect(rig.service.greetingDelete(A, 0).ok).toBe(true)
        expect(rig.service.undo(A).ok).toBe(true)
        await settle()
        const before = greetingInputs()
        const spy = installValueWriteSpy()
        expect(rig.service.redo(A).ok).toBe(true)
        await settle()
        const after = greetingInputs()
        expect(after).toHaveLength(2)
        expect(after[0]).toBe(before[1])
        expect(after[1]).toBe(before[2])
        expect(writesOn(before, spy)).toBe(0)
        expect(valuesOf()).toEqual(list.slice(1))
    })

    test('R5 Restore deleted after an unrelated step mounts one node and leaves the others unwritten', async () => {
        const list = messages(3)
        const { rig, host } = await mountList(list)
        deleteButton(0).click()
        await settle()
        expect(rig.service.editField(A, 'desc', 'unrelated').ok).toBe(true)
        rig.service.closeOpenStep(A)
        const before = greetingInputs()
        const spy = installValueWriteSpy()
        await host.host.activate(host.host.visible[0].id)
        await settle()
        const after = greetingInputs()
        expect(after).toHaveLength(3)
        expect(after[1]).toBe(before[0])
        expect(after[2]).toBe(before[1])
        expect(writesOn(before, spy)).toBe(0)
        expect(valuesOf()).toEqual(list)
    })

    test('R6 reverting past a front delete mounts one node and leaves the others unwritten', async () => {
        const list = messages(3)
        const { rig } = await mountList(list)
        expect(rig.service.editField(A, 'desc', 'earlier').ok).toBe(true)
        rig.service.closeOpenStep(A)
        expect(rig.service.greetingDelete(A, 0).ok).toBe(true)
        await settle()
        const target = rig.service.view(A).done[0].id
        const before = greetingInputs()
        const spy = installValueWriteSpy()
        const greetingSelector = '[data-part="studio-greeting-input"]'
        const holdsGreetingInput = (node: Node): boolean =>
            node instanceof Element && (node.matches(greetingSelector) || node.querySelector(greetingSelector) !== null)
        const added: Node[] = []
        const removed: Node[] = []
        const collect = (records: MutationRecord[]) => {
            for (const record of records) {
                added.push(...Array.from(record.addedNodes).filter(holdsGreetingInput))
                removed.push(...Array.from(record.removedNodes).filter(holdsGreetingInput))
            }
        }
        const observer = new MutationObserver(collect)
        observer.observe(document.body, { childList: true, subtree: true })
        expect(rig.service.revertTo(A, target).ok).toBe(true)
        await settle()
        collect(observer.takeRecords())
        observer.disconnect()
        // The revert of one delete is a single insert at the front, not positional rewrites;
        // the tail listInsert/listRemove pair at |L1| is the MC-1339 lifecycle encoding and cancels out.
        const revertListOps = (rig.service.view(A).done.at(-1)?.ops ?? []).filter((op) => op.op === 'listInsert' || op.op === 'listSet' || op.op === 'listRemove')
        expect(revertListOps.map((op) => [op.op, op.index])).toEqual([['listInsert', 0], ['listInsert', 3], ['listRemove', 3]])
        expect(revertListOps[0]).not.toHaveProperty('deletedId')
        expect(revertListOps[1]).toMatchObject({ deletedId: expect.any(String) })
        expect(revertListOps[2]).toMatchObject({ deletedId: null })
        const after = greetingInputs()
        expect(added).toHaveLength(1)
        expect(removed).toHaveLength(0)
        expect(added[0].contains(after[0])).toBe(true)
        expect(after).toHaveLength(3)
        expect(after[1]).toBe(before[0])
        expect(after[2]).toBe(before[1])
        expect(writesOn(before, spy)).toBe(0)
        expect(valuesOf()).toEqual(list)
    })

    test('R7 a focused row keeps its focus on the same text when another row is inserted or removed', async () => {
        const list = messages(3)
        const { rig } = await mountList(list)
        expect(rig.service.greetingDelete(A, 0).ok).toBe(true)
        await settle()
        const focused = greetingInputs()[0]
        focused.focus()
        expect(focused.value).toBe(list[1])
        expect(rig.service.undo(A).ok).toBe(true)
        await settle()
        expect(document.activeElement).toBe(focused)
        expect(focused.value).toBe(list[1])
        expect(greetingInputs()[1]).toBe(focused)
        expect(rig.service.redo(A).ok).toBe(true)
        await settle()
        expect(document.activeElement).toBe(focused)
        expect(focused.value).toBe(list[1])
        expect(greetingInputs()[0]).toBe(focused)
    })

    test('G2 add focuses the new last row and writes no existing node', async () => {
        const list = messages(3)
        await mountList(list)
        const before = greetingInputs()
        const spy = installValueWriteSpy()
        ;(part('studio-greeting-add') as HTMLButtonElement).click()
        await settle()
        const after = greetingInputs()
        expect(after).toHaveLength(4)
        expect(after.slice(0, 3)).toEqual(before)
        expect(document.activeElement).toBe(after[3])
        expect(writesOn(before, spy)).toBe(0)
        expect(valuesOf()).toEqual([...list, ''])
    })

    test('G3 the part names and positional labels follow the list after a front delete', async () => {
        await mountList(messages(3))
        deleteButton(0).click()
        await settle()
        expect(parts('studio-greeting-row')).toHaveLength(2)
        expect(greetingInputs().map((field) => field.dataset.index)).toEqual(['0', '1'])
        expect(greetingInputs().map((field) => field.getAttribute('aria-label'))).toEqual(['altGreet 1', 'altGreet 2'])
        expect(parts('studio-greeting-delete').map((button) => button.getAttribute('aria-label'))).toEqual(['studioGreetingDelete 1', 'studioGreetingDelete 2'])
    })

    test('G4 typing keeps the node, the focus and the caret and writes no value back', async () => {
        const list = messages(3)
        const { rig } = await mountList(list)
        const before = greetingInputs()
        const field = before[1]
        field.focus()
        field.value = `${list[1]}Z`
        field.setSelectionRange(7, 7)
        const spy = installValueWriteSpy()
        field.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        await settle()
        expect(greetingInputs()[1]).toBe(field)
        expect(document.activeElement).toBe(field)
        expect(field.selectionStart).toBe(7)
        expect(spy.writes).toHaveLength(0)
        expect(live().alternateGreetings[1]).toBe(`${list[1]}Z`)
        expect(rig.service.view(A).done).toHaveLength(1)
    })

    test('G5 after a front delete typing and deleting hit the rows at their current positions', async () => {
        const list = messages(4)
        await mountList(list)
        deleteButton(0).click()
        await settle()
        type(greetingInputs()[0], 'first now')
        expect(live().alternateGreetings).toEqual(['first now', list[2], list[3]])
        deleteButton(1).click()
        await settle()
        expect(live().alternateGreetings).toEqual(['first now', list[3]])
        expect(valuesOf()).toEqual(['first now', list[3]])
    })

    test('G6 undo of a first-message edit puts the old text back in the field', async () => {
        const list = messages(3)
        const { rig } = await mountList(list)
        type(greetingInputs()[1], 'edited')
        expect(rig.service.undo(A).ok).toBe(true)
        await settle()
        expect(valuesOf()).toEqual(list)
    })

    test('G7 deleting every row shows the empty note and focuses Add; adding from empty gives one row', async () => {
        await mountList(messages(2))
        deleteButton(0).click()
        await settle()
        deleteButton(0).click()
        await settle()
        expect(greetingInputs()).toHaveLength(0)
        expect(part('studio-character-form')?.textContent).toContain('studioGreetingsEmpty')
        expect(document.activeElement).toBe(part('studio-greeting-add'))
        ;(part('studio-greeting-add') as HTMLButtonElement).click()
        await settle()
        expect(valuesOf()).toEqual([''])
        expect(part('studio-character-form')?.textContent).not.toContain('studioGreetingsEmpty')
    })

    test.each([0, 1])('G8 equal strings: deleting row %i leaves the right values and count', async (at) => {
        await mountList(['x', 'x', 'y'])
        deleteButton(at).click()
        await settle()
        expect(valuesOf()).toEqual(['x', 'y'])
        expect(live().alternateGreetings).toEqual(['x', 'y'])
    })

    test('G9 two empty rows: deleting the first leaves one empty row with the focus', async () => {
        await mountList([])
        ;(part('studio-greeting-add') as HTMLButtonElement).click()
        await settle()
        ;(part('studio-greeting-add') as HTMLButtonElement).click()
        await settle()
        expect(valuesOf()).toEqual(['', ''])
        deleteButton(0).click()
        await settle()
        expect(valuesOf()).toEqual([''])
        expect(document.activeElement).toBe(greetingInputs()[0])
    })

    test('G10 replacing the live list by an equal-content copy keeps every node and writes none', async () => {
        const list = messages(3)
        await mountList(list)
        const before = greetingInputs()
        const spy = installValueWriteSpy()
        // Re-joined halves: equal content, but not the same string objects.
        const copy = list.map((text) => text.slice(0, 5) + text.slice(5))
        live().alternateGreetings = copy
        await settle()
        expect(greetingInputs()).toEqual(before)
        expect(spy.writes).toHaveLength(0)
        expect(valuesOf()).toEqual(list)
    })

    test('G11 replacing the list by different content shows the new list, same length and shorter', async () => {
        await mountList(messages(3))
        live().alternateGreetings = messages(3, 'n')
        await settle()
        expect(valuesOf()).toEqual(messages(3, 'n'))
        live().alternateGreetings = messages(2, 'm')
        await settle()
        expect(valuesOf()).toEqual(messages(2, 'm'))
        expect(parts('studio-greeting-row')).toHaveLength(2)
    })

    test('G12 a form mounted for another character builds its own nodes with that list', async () => {
        await mountList(messages(2))
        const first = greetingInputs()
        await unmountAll()
        db.db.characters = [makeCharacter({ chaId: 'B', alternateGreetings: messages(3, 'b') })]
        studioScreen.chaId = 'B'
        mountInto(StudioCharacterForm, { chaId: 'B' })
        await settle()
        expect(valuesOf()).toEqual(messages(3, 'b'))
        expect(greetingInputs().some((node) => first.includes(node))).toBe(false)
    })
})

// ---------------------------------------------------------------- B1: the long-text write path

type EolFixture = 'plain' | 'crlf' | 'mixed' | 'lonecr'

const FIXTURE_TEXT: Record<EolFixture, { desc: string; greeting: string; note: string }> = {
    plain: { desc: 'd0', greeting: 'g1', note: 'n0' },
    crlf: { desc: 'd0\r\nx', greeting: 'g1\r\ny', note: 'n0\r\nz' },
    mixed: { desc: 'a\r\nb\nc', greeting: 'g\r\nh\ni', note: 'n\r\no\np' },
    lonecr: { desc: 'a\rb', greeting: 'g\rh', note: 'n\ro' },
}

interface LongTarget {
    name: 'desc' | 'greeting 1' | 'note'
    owner: typeof A
    mountForm(): void
    field(): HTMLTextAreaElement
    stored(): string
    // Replaces the stored text before the form is mounted.
    seed(text: string): void
    // The same edit the form would make, through the service.
    edit(service: OwnerHistoryService, text: string): void
    textOf(fixture: EolFixture): string
}

const LONG_TARGETS: LongTarget[] = [
    {
        name: 'desc',
        owner: A,
        mountForm: () => { mountInto(StudioCharacterForm, { chaId: 'A' }) },
        field: desc,
        stored: () => live().desc,
        seed: (text) => { live().desc = text },
        edit: (service, text) => { service.editField(A, 'desc', text) },
        textOf: (fixture) => FIXTURE_TEXT[fixture].desc,
    },
    {
        name: 'greeting 1',
        owner: A,
        mountForm: () => { mountInto(StudioCharacterForm, { chaId: 'A' }) },
        field: () => greetingInputs()[1],
        stored: () => live().alternateGreetings[1],
        seed: (text) => { live().alternateGreetings = ['g0', text, 'g2'] },
        edit: (service, text) => { service.greetingEdit(A, 1, text) },
        textOf: (fixture) => FIXTURE_TEXT[fixture].greeting,
    },
    {
        name: 'note',
        owner: CHAT,
        mountForm: () => { mountInto(StudioChatNoteForm, { chaId: 'A', chatId: 'c1' }) },
        field: note,
        stored: () => live().chats[0].note,
        seed: (text) => { live().chats[0].note = text },
        edit: (service, text) => { service.editField(CHAT, 'note', text) },
        textOf: (fixture) => FIXTURE_TEXT[fixture].note,
    },
]

const lfOf = (text: string): string => text.replace(/\r\n?/g, '\n')

function composeInto(field: HTMLTextAreaElement, value: string): void {
    field.value = value
    field.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertCompositionText' }))
    flushSync()
}

function compositionStart(field: HTMLTextAreaElement): void {
    field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
}

function compositionEnd(field: HTMLTextAreaElement): void {
    field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    flushSync()
}

function setVisibility(state: 'hidden' | 'visible'): void {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
}

// The page hides: `visibilitychange` at the document with the state stubbed, as a browser fires it.
function hidePage(): void {
    setVisibility('hidden')
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
}

async function mountTarget(target: LongTarget, fixture: EolFixture = 'plain'): Promise<Rig> {
    target.seed(target.textOf(fixture))
    const rig = makeRig()
    target.mountForm()
    await settle()
    return rig
}

const stepsOf = (service: OwnerHistoryService, owner: typeof A): number => service.view(owner).done.length
const refusalLine = (): string | undefined => part('studio-form-refusal')?.textContent ?? undefined

describe('B1 the long-text write path', () => {
    afterEach(() => {
        setVisibility('visible')
    })

    describe.each(LONG_TARGETS)('$name', (target) => {
        test('B1-R1 a composing input is held: nothing is written, marked or recorded', async () => {
            const { service } = await mountTarget(target)
            const before = target.stored()
            compositionStart(target.field())
            composeInto(target.field(), `${before}ㅎ`)
            expect(target.stored()).toBe(before)
            expect(h.marks).toBe(0)
            expect(stepsOf(service, target.owner)).toBe(0)
        })

        test('B1-R2 compositionend writes once, in Chrome order and in Firefox order', async () => {
            const { service } = await mountTarget(target)
            const before = target.stored()
            const field = target.field()
            compositionStart(field)
            composeInto(field, `${before}ㅎ`)
            composeInto(field, `${before}하`)
            composeInto(field, `${before}한`)
            compositionEnd(field)
            expect(target.stored()).toBe(`${before}한`)
            expect(h.marks).toBe(1)
            expect(stepsOf(service, target.owner)).toBe(1)
            // Firefox: a trailing non-composing input with the same text follows compositionend.
            type(field, `${before}한`)
            expect(h.marks).toBe(1)
            expect(stepsOf(service, target.owner)).toBe(1)
        })

        test('B1-R3 a refusal during composition leaves the composition alone; compositionend resets and shows it', async () => {
            await mountTarget(target)
            const before = target.stored()
            studioScreen.chaId = 'B'
            const field = target.field()
            compositionStart(field)
            composeInto(field, `${before}한`)
            expect(field.value).toBe(`${before}한`)
            expect(refusalLine()).toBeUndefined()
            compositionEnd(field)
            expect(field.value).toBe(before)
            expect(refusalLine()).toBe(refusalText('not-selected'))
            expect(h.marks).toBe(0)
        })

        test('B1-R4 a hide flush that is refused while composing keeps the text; compositionend resets', async () => {
            await mountTarget(target)
            const before = target.stored()
            studioScreen.chaId = 'B'
            const field = target.field()
            compositionStart(field)
            composeInto(field, `${before}한`)
            hidePage()
            flushSync()
            expect(field.value).toBe(`${before}한`)
            expect(refusalLine()).toBe(refusalText('not-selected'))
            compositionEnd(field)
            expect(field.value).toBe(before)
        })

        test('B1-R5 a real edit keeps the stored CRLF endings', async () => {
            await mountTarget(target, 'crlf')
            const field = target.field()
            const shown = lfOf(target.textOf('crlf'))
            expect(field.value).toBe(shown)
            type(field, `${shown}Y`)
            expect(target.stored()).toBe(`${target.textOf('crlf')}Y`)
        })

        test.each(['mixed', 'lonecr'] as const)('B1-R6 a net-zero composition on a %s text rewrites no endings', async (fixture) => {
            const { service } = await mountTarget(target, fixture)
            const stored = target.stored()
            const field = target.field()
            const shown = lfOf(stored)
            compositionStart(field)
            composeInto(field, `${shown}X`)
            composeInto(field, shown)
            compositionEnd(field)
            expect(target.stored()).toBe(stored)
            expect(h.marks).toBe(0)
            expect(stepsOf(service, target.owner)).toBe(0)
        })

        test('B1-G1 blur writes held text; typing after the pause makes a second step', async () => {
            const { service, clock } = await mountTarget(target)
            const before = target.stored()
            const field = target.field()
            compositionStart(field)
            composeInto(field, `${before}한`)
            field.dispatchEvent(new FocusEvent('blur'))
            flushSync()
            expect(target.stored()).toBe(`${before}한`)
            expect(h.marks).toBe(1)
            expect(stepsOf(service, target.owner)).toBe(1)
            clock.set(100)
            type(field, `${before}한x`)
            expect(stepsOf(service, target.owner)).toBe(2)
        })

        test('B1-G3 Back while composing records the held text', async () => {
            await mountTarget(target)
            const before = target.stored()
            const field = target.field()
            field.focus()
            compositionStart(field)
            composeInto(field, `${before}한`)
            let recorded: string | null = null
            const handler = backCloseHandler({ isOpen: () => true, snapshot: () => target.stored(), close: () => { recorded = target.stored() } })
            handler()
            expect(recorded).toBe(`${before}한`)
        })

        describe('B1-G6 no input means no write', () => {
            const cells: [string, (field: HTMLTextAreaElement) => void][] = [
                ['focus and blur', (field) => { field.focus(); field.blur() }],
                ['focus and hide', (field) => { field.focus(); hidePage() }],
                ['focus and closeStudio', (field) => { field.focus(); studioOpen.set(true); closeStudio() }],
                ['focus and a composition with no input', (field) => { field.focus(); compositionStart(field); compositionEnd(field) }],
            ]
            test.each(['plain', 'crlf', 'mixed', 'lonecr'] as const)('(a) positive controls on %s text', async (fixture) => {
                for (const [, act] of cells) {
                    setVisibility('visible')
                    await unmountAll()
                    db.db.characters = [makeCharacter()]
                    const { service } = await mountTarget(target, fixture)
                    const stored = target.stored()
                    expect(target.field().value).toBe(lfOf(stored))
                    act(target.field())
                    flushSync()
                    expect(target.stored()).toBe(stored)
                    expect(h.marks).toBe(0)
                    expect(stepsOf(service, target.owner)).toBe(0)
                }
                await unmountAll()
                db.db.characters = [makeCharacter()]
                const { service } = await mountTarget(target, fixture)
                const stored = target.stored()
                target.field().focus()
                await unmountAll()
                expect(target.stored()).toBe(stored)
                expect(h.marks).toBe(0)
                expect(stepsOf(service, target.owner)).toBe(0)
            })

            test.each(cells.map(([name]) => name))('(b) stale surface after an owner change: %s', async (cellName) => {
                const { service } = await mountTarget(target)
                const field = target.field()
                field.focus()
                target.edit(service, 'new text')
                const act = cells.find(([name]) => name === cellName)?.[1]
                act?.(field)
                flushSync()
                expect(target.stored()).toBe('new text')
                expect(h.marks).toBe(1)
                expect(stepsOf(service, target.owner)).toBe(1)
                expect(refusalLine()).toBeUndefined()
            })
        })
    })
})

describe('B1 greeting rows keep held text with their row', () => {
    test('B1-G8 a removal before the held row, after a render, still writes the held row', async () => {
        const rig = makeRig()
        mountInto(StudioCharacterForm, { chaId: 'A' })
        await settle()
        compositionStart(greetingInputs()[1])
        composeInto(greetingInputs()[1], 'g1ㅎ')
        expect(rig.service.greetingDelete(A, 0).ok).toBe(true)
        await settle()
        composeInto(greetingInputs()[0], 'g1한')
        compositionEnd(greetingInputs()[0])
        expect(live().alternateGreetings).toEqual(['g1한', 'g2'])
    })

    test('B1-G8b a removal before the held row in the same tick: the hide flush writes into the right row', async () => {
        const rig = makeRig()
        mountInto(StudioCharacterForm, { chaId: 'A' })
        await settle()
        compositionStart(greetingInputs()[1])
        composeInto(greetingInputs()[1], 'g1ㅎ')
        expect(rig.service.greetingDelete(A, 0).ok).toBe(true)
        hidePage()
        expect(live().alternateGreetings).toEqual(['g1ㅎ', 'g2'])
        expect(refusalLine()).toBeUndefined()
        setVisibility('visible')
    })

    test('B1-T1 a row removed while its text is held writes nothing at teardown', async () => {
        const rig = makeRig()
        const writes = vi.spyOn(rig.service, 'greetingEdit')
        mountInto(StudioCharacterForm, { chaId: 'A' })
        await settle()
        compositionStart(greetingInputs()[1])
        composeInto(greetingInputs()[1], 'g1ㅎ')
        expect(rig.service.greetingDelete(A, 1).ok).toBe(true)
        const marksAfterDelete = h.marks
        await settle()
        expect(writes).not.toHaveBeenCalled()
        expect(h.marks).toBe(marksAfterDelete)
        expect(marksAfterDelete).toBe(1)
        expect(live().alternateGreetings).toEqual(['g0', 'g2'])
        const last = greetingInputs()[1]
        expect(rig.service.greetingEdit(A, 1, 'g2x').ok).toBe(true)
        await settle()
        expect(greetingInputs()[1]).toBe(last)
        expect(greetingInputs().map((node) => node.value)).toEqual(['g0', 'g2x'])
    })

    test('B1-T2 a whole-array replacement under held text writes nothing and the rows follow', async () => {
        const rig = makeRig()
        const edits = vi.spyOn(rig.service, 'greetingEdit')
        mountInto(StudioCharacterForm, { chaId: 'A' })
        await settle()
        compositionStart(greetingInputs()[1])
        composeInto(greetingInputs()[1], 'g1ㅎ')
        live().alternateGreetings = ['g0', 'g2']
        await settle()
        const marks = h.marks
        live().alternateGreetings = ['g0', 'g2x', 'g9']
        await settle()
        expect(greetingInputs().map((node) => node.value)).toEqual(['g0', 'g2x', 'g9'])
        expect(edits).not.toHaveBeenCalled()
        expect(h.marks).toBe(marks)
    })

    test('B1-T3 a description whose character turns private writes nothing', async () => {
        const rig = makeRig()
        const edits = vi.spyOn(rig.service, 'editField')
        mountInto(StudioCharacterForm, { chaId: 'A' })
        await settle()
        compositionStart(desc())
        composeInto(desc(), 'd0ㅎ')
        live().license = 'private'
        await settle()
        expect(desc()).toBeNull()
        expect(edits).not.toHaveBeenCalled()
        expect(h.marks).toBe(0)
        expect(live().desc).toBe('d0')
    })
})

describe('B1 a flush finds the owner no longer editable or the row gone', () => {
    afterEach(() => {
        setVisibility('visible')
    })

    // The character turns private between the held input and the flush, before any render: the write path must
    // answer null itself, not reach the service.
    test('B1-X1 held description: a hide flush after the owner stopped being editable makes no service write', async () => {
        const rig = makeRig()
        const edits = vi.spyOn(rig.service, 'editField')
        mountInto(StudioCharacterForm, { chaId: 'A' })
        await settle()
        compositionStart(desc())
        composeInto(desc(), 'd0ㅎ')
        live().license = 'private'
        hidePage()
        expect(edits).not.toHaveBeenCalled()
        expect(h.marks).toBe(0)
        expect(live().desc).toBe('d0')
    })

    test('B1-X2 held first message: a hide flush after the owner stopped being editable makes no service write', async () => {
        const rig = makeRig()
        const edits = vi.spyOn(rig.service, 'greetingEdit')
        mountInto(StudioCharacterForm, { chaId: 'A' })
        await settle()
        compositionStart(greetingInputs()[1])
        composeInto(greetingInputs()[1], 'g1ㅎ')
        live().license = 'private'
        hidePage()
        expect(edits).not.toHaveBeenCalled()
        expect(h.marks).toBe(0)
        expect(live().alternateGreetings).toEqual(['g0', 'g1', 'g2'])
    })

    test('B1-X3 a row removed while its text is held: a hide flush before any render shows no refusal and writes nothing', async () => {
        const rig = makeRig()
        const edits = vi.spyOn(rig.service, 'greetingEdit')
        mountInto(StudioCharacterForm, { chaId: 'A' })
        await settle()
        compositionStart(greetingInputs()[1])
        composeInto(greetingInputs()[1], 'g1ㅎ')
        expect(rig.service.greetingDelete(A, 1).ok).toBe(true)
        hidePage()
        flushSync()
        expect(refusalLine()).toBeUndefined()
        expect(edits).not.toHaveBeenCalled()
        expect(live().alternateGreetings).toEqual(['g0', 'g2'])
    })

    // A null result means there was no write path; the note clears its refusal line like an accepted write.
    test('B1-X4 the note clears a shown refusal when a later flush finds no write path', async () => {
        const rig = makeRig()
        const edits = vi.spyOn(rig.service, 'editField')
        mountInto(StudioChatNoteForm, { chaId: 'A', chatId: 'c1' })
        await settle()
        studioScreen.chaId = 'B'
        compositionStart(note())
        composeInto(note(), 'n0한')
        hidePage()
        flushSync()
        expect(refusalLine()).toBe(refusalText('not-selected'))
        const refused = edits.mock.calls.length
        // A second chat with the same id: the note has no unique chat, so its write path is gone.
        live().chats.push({ ...live().chats[0] })
        hidePage()
        flushSync()
        expect(edits.mock.calls.length).toBe(refused)
        expect(refusalLine()).toBeUndefined()
        expect(note().value).toBe('n0한')
    })
})
