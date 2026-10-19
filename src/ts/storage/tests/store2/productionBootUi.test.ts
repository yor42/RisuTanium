// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { get, writable } from 'svelte/store'

// MOCKED: the alert store `alertPrompts` reads for the guard constant, and the page store selection the dispatch reaches
// only through the legacy block owner it disables (the selection drags in the app's boot chain).
vi.mock(import('src/ts/stores.svelte'), () => ({
    alertStore: writable({ type: 'none', msg: '' }),
}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: async () => { throw new Error('The page store is not selected in this test.') },
    getAppStoreKind: async () => { throw new Error('The page store is not selected in this test.') },
}) as unknown as typeof import('src/ts/storage/store/appStore'))

// MOCKED: `alertSelect`, so the in-session peer prompt needs no application chain; it asks through the real prompt controller
// and builds the message as `alertSelect` does.
vi.mock(import('src/ts/alert'), async () => {
    const { askPrompt } = await import('src/ts/alertPrompts')
    return {
        alertSelect: async (msg: string[], display?: string) => await askPrompt({
            type: 'select',
            msg: display !== undefined ? `__DISPLAY__${display}||${msg.join('||')}` : msg.join('||'),
        }),
        alertMd: () => undefined,
        waitAlert: () => Promise.resolve(),
    } as unknown as typeof import('src/ts/alert')
})
// MOCKED: the export writer, which the page's export-first handler loads on demand; its own tests are in
// `drive/tests/exportThisTab.svelte.test.ts`.
const exportThisTabBackup = vi.fn(async () => ({ status: 'saved', notices: [] }) as const)
vi.mock(import('src/ts/drive/backuplocal'), () => ({
    exportThisTabBackup: () => exportThisTabBackup(),
}) as unknown as typeof import('src/ts/drive/backuplocal'))

import { changeLanguage, language } from 'src/lang'
import { languageEnglish } from 'src/lang/en'
import { languageKorean } from 'src/lang/ko'
import { ANSWER_GUARD_MS, resetAlertPromptsForTests } from 'src/ts/alertPrompts'
import { alertStore } from 'src/ts/stores.svelte'
import { createMemoryByteStore, type MemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { resetPageBlockOwnerForTests } from 'src/ts/storage/pageBlockOwner'
import { resetPageStorageModeForTests } from 'src/ts/storage/pageStorageMode'
import type { Database } from 'src/ts/storage/database.svelte'
import { createMemoryBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import { resetStore2BootForTest } from 'src/ts/storage/store2/bootActive'
import { dispatchStore2Boot } from 'src/ts/storage/store2/bootDispatch'
import { classifyCommitRead, nextCommitKey } from 'src/ts/storage/store2/commitKey'
import { encodeUnit, UNIT_TYPE } from 'src/ts/storage/store2/format'
import { COMMIT_KEY } from 'src/ts/storage/store2/format/keys'
import type { LegacyDecoders } from 'src/ts/storage/store2/legacy/convert'
import { resetStore2SaveForTest } from 'src/ts/storage/store2/saveActive'
import type { Staging } from 'src/ts/storage/store2/owner'
import type { FlaggedItem } from 'src/ts/storage/store2/leafFallback'
import type { SkippedLegacyEntry } from 'src/ts/storage/store2/legacy/lenient'
import type { IncompleteItem } from 'src/ts/storage/store2/legacy/resolve'
import { getBootScreen, pressBootButton, resetBootScreenForTests, type BootScreenView } from 'src/ts/storage/store2/ui/bootScreen.svelte'
import { createProductionBootUi } from 'src/ts/storage/store2/ui/productionBootUi'
import { createClock, testEnv } from '../store2SaveKit'
import { buildSmall, fakeLists } from './codecFixtures'
import { plantTree } from './recoveryFixtures'

/**
 * The production port (`store2/ui/productionBootUi.ts`): one screen per prompt, the mapped answer, and a terminal screen
 * behind every answer that stops the boot. The second half drives the real dispatch over rows of the boot table with a
 * fake store: one screen per row, a decline writes nothing, and a stopped boot ends on a screen, not a bare spinner.
 * Labels: new behaviour. Real timers: the answer guard is a wall-clock window. MOCKED: native reload only (a spy).
 */

const text = () => language.store2Boot

const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

async function pressAfterGuard(key: string): Promise<void> {
    await sleep(ANSWER_GUARD_MS + 40)
    pressBootButton(key)
}

/** Waits for a screen other than `previous`. */
async function screenAfter(previous: BootScreenView | null): Promise<BootScreenView> {
    await vi.waitFor(() => {
        const shown = getBootScreen()
        expect(shown !== null && shown.model !== previous?.model).toBe(true)
    })
    return getBootScreen()!
}

function getAlert() {
    return get(alertStore)
}

function keys(view: BootScreenView): string[] {
    return view.model.buttons.map((button) => button.key)
}

beforeEach(() => {
    changeLanguage('en')
    resetBootScreenForTests()
    resetStore2SaveForTest()
    resetStore2BootForTest()
    resetPageBlockOwnerForTests()
    resetPageStorageModeForTests()
})

afterEach(() => {
    resetBootScreenForTests()
    resetStore2SaveForTest()
    resetStore2BootForTest()
    resetPageBlockOwnerForTests()
    resetPageStorageModeForTests()
})

describe('each prompt shows its screen and returns the answer of the button pressed', () => {
    const skipped: SkippedLegacyEntry[] = [{ name: 'cha-1', kind: 'character', reason: 'x' }]
    const incomplete: IncompleteItem[] = [{ kind: 'character', chaId: 'c1', name: 'Ann', key: 'k', reason: 'missing' }]
    const flagged: FlaggedItem[] = [{ kind: 'character-part', chaId: 'c1', part: 'core', key: 'k', why: 'damaged', name: 'Ann' }]
    const marker: Staging = { owner: 'o', prefix: 'p', startedAt: 1_700_000_000_000, label: 'convert' }

    const cases: [string, (ui: ReturnType<typeof createProductionBootUi>) => Promise<unknown>, () => string, string, unknown][] = [
        ['confirmConvert', (ui) => ui.confirmConvert(), () => text().convertTitle, 'convertYes', true],
        ['confirmConvert (Not now)', (ui) => ui.confirmConvert(), () => text().convertTitle, 'convertNo', false],
        ['declined', (ui) => ui.declined(), () => text().declinedTitle, 'declinedConvert', 'convert'],
        ['confirmFromBackup', (ui) => ui.confirmFromBackup(17_000_000_000), () => text().fromBackupTitle, 'fromBackupYes', 'convert'],
        ['confirmConvertWithout', (ui) => ui.confirmConvertWithout(skipped), () => text().withoutTitle, 'withoutNo', 'decline'],
        ['confirmIncomplete', (ui) => ui.confirmIncomplete(incomplete), () => text().incompleteTitle, 'incompleteYes', true],
        ['confirmFlaggedOpen (continue)', (ui) => ui.confirmFlaggedOpen(flagged), () => text().flaggedTitle, 'flaggedContinue', 'continue'],
        ['foreignMarker (clear)', (ui) => ui.foreignMarker(marker), () => text().foreignTitle, 'foreignClear', 'clear'],
    ]

    test.each(cases)('%s', async (_name, ask, title, key, expected) => {
        const ui = createProductionBootUi({ reload: vi.fn(), browserLanguage: 'en-US' })
        const answer = ask(ui)
        const view = await screenAfter(null)
        expect(view.model.title).toBe(title())
        await pressAfterGuard(key)
        await expect(answer).resolves.toBe(expected)
        // The screen stays up after the answer: the dispatch shows the next one or the page loads.
        expect(getBootScreen()).not.toBeNull()
        expect(getBootScreen()?.answered).toBe(true)
    })

    test('an unknown button key is a defect, not an answer', async () => {
        const ui = createProductionBootUi({ reload: vi.fn(), browserLanguage: 'en-US' })
        const answer = ui.confirmConvert()
        await screenAfter(null)
        await sleep(ANSWER_GUARD_MS + 40)
        // Answers only come from the model's own buttons; a key outside them is rejected rather than read as `undefined`.
        getBootScreen()!.onPress('nonsense')
        await expect(answer).rejects.toThrow(/unknown button/)
    })
})

describe('an answer that stops the boot leaves the "nothing was changed" screen up before the answer returns', () => {
    const flagged: FlaggedItem[] = [{ kind: 'character-part', chaId: 'c1', part: 'core', key: 'k', why: 'damaged', name: 'Ann' }]
    const marker: Staging = { owner: 'o', prefix: 'p', startedAt: 1_700_000_000_000, label: 'convert' }

    const cases: [string, (ui: ReturnType<typeof createProductionBootUi>) => Promise<unknown>, string, unknown][] = [
        ['foreignMarker wait', (ui) => ui.foreignMarker(marker), 'foreignWait', 'wait'],
        ['confirmFlaggedOpen decline', (ui) => ui.confirmFlaggedOpen(flagged), 'flaggedDecline', 'decline'],
        ['confirmFlaggedOpen earlier', (ui) => ui.confirmFlaggedOpen(flagged), 'flaggedEarlier', 'earlier'],
    ]

    test.each(cases)('%s', async (_name, ask, key, expected) => {
        const reload = vi.fn()
        const ui = createProductionBootUi({ reload, browserLanguage: 'en-US' })
        const answer = ask(ui)
        const question = await screenAfter(null)
        await sleep(ANSWER_GUARD_MS + 40)
        pressBootButton(key)
        await expect(answer).resolves.toBe(expected)

        const view = getBootScreen()!
        expect(view.model).not.toBe(question.model)
        expect(view.model.title).toBe(text().stoppedTitle)
        expect(keys(view)).toEqual(['reload'])
        expect(reload).not.toHaveBeenCalled()
        await sleep(ANSWER_GUARD_MS + 40)
        pressBootButton('reload')
        expect(reload).toHaveBeenCalledTimes(1)
        // The terminal screen is not cleared by the press.
        expect(getBootScreen()).not.toBeNull()
    })

    test('declined import (when the page can act on it) ends on the same screen', async () => {
        const ui = createProductionBootUi({ reload: vi.fn(), browserLanguage: 'en-US', importAvailable: true })
        const answer = ui.declined()
        const question = await screenAfter(null)
        expect(keys(question)).toEqual(['declinedConvert', 'declinedImport'])
        await sleep(ANSWER_GUARD_MS + 40)
        pressBootButton('declinedImport')
        await expect(answer).resolves.toBe('import')
        expect(getBootScreen()?.model.title).toBe(text().stoppedTitle)
    })

    test('guard: an answer that goes on (continue, clear, convert) shows no terminal screen', async () => {
        const ui = createProductionBootUi({ reload: vi.fn(), browserLanguage: 'en-US' })
        const answer = ui.confirmFlaggedOpen(flagged)
        const question = await screenAfter(null)
        await sleep(ANSWER_GUARD_MS + 40)
        pressBootButton('flaggedContinue')
        await expect(answer).resolves.toBe('continue')
        expect(getBootScreen()?.model).toBe(question.model)
    })
})

describe('terminal results', () => {
    test('blocked shows the reason screen with details and resolves; the reassurance follows the reason', async () => {
        const ui = createProductionBootUi({ reload: vi.fn(), browserLanguage: 'en-US' })
        await ui.blocked({ reason: 'tree-unreadable', detail: 'the disk went away', mayHaveWritten: false })
        const view = getBootScreen()!
        expect(view.model.title).toBe(text().blockedTitle)
        expect(view.model.paragraphs).toContain(text().blockedNothingChanged)
        expect(view.model.details).toContain('the disk went away')

        await ui.blocked({ reason: 'tree-unreadable', detail: 'the disk went away', mayHaveWritten: true })
        expect(getBootScreen()!.model.paragraphs).toEqual([text().blockedRead])

        await ui.blocked({ reason: 'install-failed', detail: 'x', mayHaveWritten: false })
        expect(getBootScreen()!.model.paragraphs).toEqual([text().blockedInstall])
    })

    test('offerRestoreOrImport shows the backups screen and resolves', async () => {
        const ui = createProductionBootUi({ reload: vi.fn(), browserLanguage: 'en-US' })
        await ui.offerRestoreOrImport([300, 200])
        expect(getBootScreen()?.model.title).toBe(text().offerTitle)
    })

    test('only the notice that ends the boot is a screen: too-new shows, the others change nothing', () => {
        const ui = createProductionBootUi({ reload: vi.fn(), browserLanguage: 'en-US' })
        for (const notice of [
            { name: 'seeded' }, { name: 'cleanup-blocked' }, { name: 'flush-unconfirmed' },
            { name: 'reflush-failed', detail: 'd' }, { name: 'server-capability', detail: 'd' },
            { name: 'backend-unavailable', detail: 'd' }, { name: 'converted-from-backup', backup: 1 },
        ] as const) {
            ui.notice(notice)
            expect(getBootScreen(), notice.name).toBeNull()
        }
        ui.notice({ name: 'too-new', source: 'tree', detail: 'd' })
        expect(getBootScreen()?.model.title).toBe(text().tooNewTitle)
    })
})

describe('the language', () => {
    test('it is set from the browser before a screen exists', async () => {
        const ui = createProductionBootUi({ reload: vi.fn(), browserLanguage: 'ko-KR' })
        expect(language).toBe(languageEnglish)
        void ui.confirmConvert()
        const view = await screenAfter(null)
        expect(language).not.toBe(languageEnglish)
        expect(view.model.title).toBe(languageKorean.store2Boot.convertTitle)
        expect(view.model.title).not.toBe(languageEnglish.store2Boot.convertTitle)
    })

    test('a language the app does not have falls back to English', async () => {
        const ui = createProductionBootUi({ reload: vi.fn(), browserLanguage: 'fr-FR' })
        void ui.confirmConvert()
        await screenAfter(null)
        expect(language).toBe(languageEnglish)
    })
})

describe('the real dispatch with the production port, over rows of the boot table', () => {
    const OWNER_KEY = 'store2-owner'
    const BACKUPS = [1_700_000_000_000, 1_700_000_001_000]

    function legacyStore(options: { mainFile: boolean, backups?: readonly number[] }): MemoryByteStore {
        const store = createMemoryByteStore()
        if (options.mainFile) {
            store.files.set('database/database.bin', new Uint8Array([1, 2, 3]))
        }
        for (const time of options.backups ?? []) {
            store.files.set(`database/dbbackup-${time}.bin`, new Uint8Array([1]))
        }
        return store
    }

    function run(store: MemoryByteStore, mainFile: boolean, listBackups: () => Promise<number[]>) {
        const backend = createMemoryBackend()
        const before = backend.snapshot()
        const ui = createProductionBootUi({ reload: vi.fn(), browserLanguage: 'en-US' })
        const result = dispatchStore2Boot({
            store,
            upstreamMainFile: async () => mainFile,
            listBackupTimes: listBackups,
            readColdStorageItem: async () => ({ status: 'missing' }),
        }, { ui, kind: 'indexeddb', backend: async () => backend, keyEnv: testEnv(createClock(), 9001), lists: fakeLists })
        const writes = () => ({
            backendChanged: [...backend.snapshot().entries()].some(([key, bytes]) => !before.has(key) || [...before.get(key)!].join() !== [...bytes].join()),
            store: store.writes.filter((key) => key !== OWNER_KEY),
            deletes: [...store.deletes],
        })
        return { result, writes }
    }

    test('row 1, a legacy main file: the question comes first with Not now focused; Not now writes nothing and shows the decline screen', async () => {
        const store = legacyStore({ mainFile: true, backups: BACKUPS })
        const { writes } = run(store, true, async () => [...BACKUPS])
        const question = await screenAfter(null)

        expect(question.model.title).toBe(text().convertTitle)
        expect(question.model.focus).toBe('convertNo')
        expect(writes()).toEqual({ backendChanged: false, store: [], deletes: [] })

        await sleep(ANSWER_GUARD_MS + 40)
        pressBootButton('convertNo')
        const declined = await screenAfter(question)

        expect(declined.model.title).toBe(text().declinedTitle)
        expect(keys(declined)).toEqual(['declinedConvert'])
        expect(writes()).toEqual({ backendChanged: false, store: [], deletes: [] })
    })

    test('row 1, no main file but numbered backups: the backups screen, nothing seeded, and the boot stops on it', async () => {
        const store = legacyStore({ mainFile: false, backups: BACKUPS })
        const { result, writes } = run(store, false, async () => [...BACKUPS])

        await expect(result).resolves.toEqual({ kind: 'stopped' })
        expect(getBootScreen()?.model.title).toBe(text().offerTitle)
        expect(writes()).toEqual({ backendChanged: false, store: [], deletes: [] })
    })

    test('a boot that cannot continue ends on the blocked screen with the reassurance for a read failure', async () => {
        const store = legacyStore({ mainFile: false })
        const { result, writes } = run(store, false, async () => { throw new Error('the backup listing failed') })

        await expect(result).resolves.toEqual({ kind: 'stopped' })
        const view = getBootScreen()!
        expect(view.model.title).toBe(text().blockedTitle)
        expect(view.model.paragraphs).toEqual([text().blockedRead, text().blockedNothingChanged])
        expect(view.model.details).toContain('backups-unlistable')
        expect(writes()).toEqual({ backendChanged: false, store: [], deletes: [] })
    })

    test('a screen is replaced, never cleared, between the question and the decline screen', async () => {
        const store = legacyStore({ mainFile: true })
        run(store, true, async () => [])
        const question = await screenAfter(null)
        const seen: (BootScreenView | null)[] = []
        const timer = setInterval(() => seen.push(getBootScreen()), 1)
        await sleep(ANSWER_GUARD_MS + 40)
        pressBootButton('convertNo')
        await screenAfter(question)
        clearInterval(timer)
        expect(seen.length).toBeGreaterThan(0)
        expect(seen.every((view) => view !== null)).toBe(true)
    })
})

describe('the real dispatch with the production port, over a damaged commit key (the recovery screen)', () => {
    const DAMAGED_COMMIT = Uint8Array.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 62, 63])
    const decoders: LegacyDecoders = {
        async strict() { return JSON.parse(JSON.stringify(buildSmall(2))) as Database },
        async lenient() { throw new Error('The file does not decode, even leniently.') },
    }

    async function recoveryRig(options: { mainFile: boolean }) {
        const clock = createClock()
        const memory = createMemoryBackend()
        const planted = await plantTree(memory, testEnv(clock, 100), { seq: 5 })
        memory.poke(COMMIT_KEY, DAMAGED_COMMIT)
        const store = createMemoryByteStore()
        if (options.mainFile) {
            store.files.set('database/database.bin', new Uint8Array([1, 2, 3]))
        }
        let commitWrites = 0
        const backend: Store2Backend = {
            ...memory,
            casCommit: (expected, next) => { commitWrites += 1; return memory.casCommit(expected, next) },
        }
        const reload = vi.fn()
        const ui = createProductionBootUi({ reload, browserLanguage: 'en-US' })
        let settled = false
        const result = dispatchStore2Boot({
            store,
            upstreamMainFile: async () => options.mainFile,
            listBackupTimes: async () => [],
            readColdStorageItem: async () => ({ status: 'missing' }),
        }, { ui, kind: 'indexeddb', backend: async () => backend, keyEnv: testEnv(clock, 9001), lists: fakeLists, decoders })
        void result.then(() => { settled = true })
        return { memory, planted, reload, commitWrites: () => commitWrites, settled: () => settled }
    }

    test('the recovery screen lists the saved versions, writes nothing and keeps the boot waiting', async () => {
        const t = await recoveryRig({ mainFile: false })
        const view = await screenAfter(null)
        expect(view.model.title).toBe(text().recoveryTitle)
        expect(view.model.rows).toHaveLength(1)
        expect(view.model.rows?.[0].key).toBe(`pick:${t.planted.manifestKey}`)
        expect(t.commitWrites()).toBe(0)
        await sleep(60)
        expect(t.settled()).toBe(false)
        expect(getBootScreen()?.model).toBe(view.model)
    })

    test('a conversion pressed twice runs once: the second press finds the question already answered', async () => {
        const t = await recoveryRig({ mainFile: true })
        const offers = await screenAfter(null)
        expect(keys(offers)).toContain('recoveryConvertOffer')
        await sleep(ANSWER_GUARD_MS + 40)
        pressBootButton('recoveryConvertOffer')
        const confirm = await screenAfter(offers)
        expect(confirm.model.title).toBe(text().convertTitle)
        await sleep(ANSWER_GUARD_MS + 40)
        pressBootButton('convertYes')
        pressBootButton('convertYes')
        await vi.waitFor(() => expect(t.reload).toHaveBeenCalledTimes(1), { timeout: 5000 })
        // The marker and the final write: a second conversion would add two more.
        expect(t.commitWrites()).toBe(2)
        expect(getBootScreen()?.model.title).toBe(text().recoveryInstalledTitle)
        expect(t.settled()).toBe(false)
    })

    test('an ended screen stays: a change made elsewhere before the install stops the screen, Reload reloads, and the boot never settles', async () => {
        const t = await recoveryRig({ mainFile: false })
        const offers = await screenAfter(null)
        await sleep(ANSWER_GUARD_MS + 40)
        pressBootButton(`pick:${t.planted.manifestKey}`)
        const confirm = await screenAfter(offers)
        await sleep(ANSWER_GUARD_MS + 40)
        pressBootButton('recoveryPickGo')
        await vi.waitFor(() => expect(getBootScreen()?.model.title).toBe(text().recoveryInstallTitle), { timeout: 5000 })
        expect(getBootScreen()?.model).not.toBe(confirm.model)

        // Another tab clears the marker: the install's compare-and-write finds the key changed.
        const cleared = classifyCommitRead(await t.memory.readCommit())
        if (cleared.status !== 'parsed') {
            throw new Error('The screen did not write its marker.')
        }
        t.memory.poke(COMMIT_KEY, encodeUnit(UNIT_TYPE.commit, nextCommitKey(cleared.value, { current: null, retained: [], pins: [], staging: null }, testEnv(createClock(), 4040))))
        await sleep(ANSWER_GUARD_MS + 40)
        pressBootButton('recoveryInstallGo')
        await vi.waitFor(() => expect(getBootScreen()?.model.title).toBe(text().recoveryStoppedTitle), { timeout: 5000 })
        expect(getBootScreen()?.model.paragraphs).toEqual([text().recoveryChanged])
        expect(keys(getBootScreen()!)).toEqual(['reload'])

        await sleep(ANSWER_GUARD_MS + 40)
        pressBootButton('reload')
        expect(t.reload).toHaveBeenCalledTimes(1)
        expect(getBootScreen()).not.toBeNull()
        expect(t.settled()).toBe(false)
    })
})

describe('the in-session peer port', () => {
    const peerPrompt = { reason: 'peer-commit', unsaved: true, offers: ['reload', 'save-mine'] } as const

    beforeEach(() => {
        resetAlertPromptsForTests()
        alertStore.set({ type: 'none', msg: '' })
    })

    afterEach(() => {
        resetAlertPromptsForTests()
        alertStore.set({ type: 'none', msg: '' })
    })

    test('decide asks through the alert prompt and returns the offer of the button pressed', async () => {
        const ui = createProductionBootUi({ reload: vi.fn(), browserLanguage: 'en-US' })
        const answer = ui.peer.decide({ ...peerPrompt })
        await vi.waitFor(() => expect(getAlert().type).toBe('select'))
        expect(getAlert().msg).toContain(text().peerSaveMine)
        await sleep(ANSWER_GUARD_MS + 40)
        alertStore.set({ type: 'none', msg: '1' })
        await expect(answer).resolves.toBe('save-mine')
    })

    // New behaviour: the offer was hidden for lack of an export (mutant: exportAvailable left false).
    test('new behaviour: the Node prompt shows "export this tab first" and answers export-first', async () => {
        const ui = createProductionBootUi({ reload: vi.fn(), browserLanguage: 'en-US' })
        const answer = ui.peer.decide({ reason: 'peer-commit', unsaved: true, offers: ['reload', 'export-first'], saveMineUnavailable: 'node' })
        await vi.waitFor(() => expect(getAlert().type).toBe('select'))
        expect(getAlert().msg).toContain(text().peerExportFirst)
        await sleep(ANSWER_GUARD_MS + 40)
        alertStore.set({ type: 'none', msg: '1' })
        await expect(answer).resolves.toBe('export-first')
    })

    test('the export-first handler runs the tab export writer and resolves declined when it declines', async () => {
        exportThisTabBackup.mockClear()
        exportThisTabBackup.mockResolvedValueOnce({ status: 'declined' } as never)
        const ui = createProductionBootUi({ reload: vi.fn(), browserLanguage: 'en-US' })
        await expect(ui.peer.exportThisTab('manifest')).resolves.toBe('declined')
        expect(exportThisTabBackup).toHaveBeenCalledTimes(1)
    })

    test('the page reload is the port\'s reload', () => {
        const reload = vi.fn()
        const ui = createProductionBootUi({ reload, browserLanguage: 'ko-KR' })
        ui.peer.reload()
        expect(reload).toHaveBeenCalledTimes(1)
    })

    test('the peer prompts do not touch the boot language: decide and parkedClean leave the database language as it is', async () => {
        changeLanguage('en')
        const ui = createProductionBootUi({ reload: vi.fn(), browserLanguage: 'ko-KR' })
        void ui.peer.decide({ ...peerPrompt })
        await vi.waitFor(() => expect(getAlert().type).toBe('select'))
        expect(language).toBe(languageEnglish)
        expect(language).not.toBe(languageKorean)
        expect(getAlert().msg).toContain(text().peerSaveMine)
        await sleep(ANSWER_GUARD_MS + 40)
        alertStore.set({ type: 'none', msg: '0' })

        await vi.waitFor(() => expect(getAlert().type).toBe('none'))
        ui.peer.parkedClean({ reason: 'peer-commit', unsaved: false, offers: ['reload'] }, () => ({ parked: true, dirty: false, drafts: false }))
        await vi.waitFor(() => expect(getAlert().type).toBe('select'))
        expect(language).toBe(languageEnglish)
        expect(getAlert().msg).toContain(text().peerKeepReading)
    })
})
