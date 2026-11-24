// @vitest-environment jsdom
/**
 * The Display form of a character inside the Studio detail: the three segments with their counts, the portrait switches,
 * the screen panel's mode gates, the mode-switch fill with its tag and reset, the asset beta switches and the
 * remembered segment. The history service is real on the memory doubles, so every control is a real step.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { makeCharacter, makeChat, makeInput, studioDbOf } from '../../ts/studio/studioFixtures.test-helpers'

const h = vi.hoisted(() => ({ marks: 0 }))
const db = $state({ db: {} as ReturnType<typeof studioDbOf> & { newImageHandlingBeta?: boolean } })
const selection = $state({ selId: 0 })
const ReloadGUIPointer = writable(0)
const MobileGUI = writable(false)
const settingsOpen = writable(false)
const CharConfigSubMenu = writable(0)
const SettingsMenuIndex = writable(-1)
const botMakerMode = writable(false)
const sideBarStore = writable(false)
const QuickSettings = $state({ open: true })

// Getters: the statically imported modules are evaluated before these consts are initialised.
vi.mock('../../ts/stores.svelte', () => ({
    get DBState() { return db },
    get selIdState() { return selection },
    get ReloadGUIPointer() { return ReloadGUIPointer },
    get MobileGUI() { return MobileGUI },
    get settingsOpen() { return settingsOpen },
    get CharConfigSubMenu() { return CharConfigSubMenu },
    get SettingsMenuIndex() { return SettingsMenuIndex },
    get botMakerMode() { return botMakerMode },
    get sideBarStore() { return sideBarStore },
    get QuickSettings() { return QuickSettings },
    frozenSaveKeysStore: writable([]),
    clearCharEmotionCache: () => {},
}))
vi.mock('../../ts/globalApi.svelte', () => ({
    getSaveMarkCount: () => h.marks,
    getFileSrc: async (path: string, use: string) => `blob:${use}:${path}`,
}))
vi.mock('../../ts/chatShell/shellSwitch.svelte', () => ({ shellEligible: () => false }))
vi.mock('../../ts/process/moduleRefList', () => ({ moduleListOf: () => [] }))
vi.mock('../../lang', async () => {
    const helpers = await import('../../ts/studio/studioFixtures.test-helpers')
    const base = helpers.studioLanguageMock()
    const call = (key: string) => (...args: (string | number)[]) => `${key}(${args.join(',')})`
    const table: Record<string, unknown> = { sidebarUi: { notAllowed: 'notAllowed', noAssets: 'noAssets' } }
    for (const key of ['studioAssetEmotionsElsewhere', 'studioAssetRowMenu', 'studioAssetSelectedCount', 'studioAssetFilterEmpty', 'studioAssetDeletedOne', 'studioEmotionFilterEmpty', 'studioDisplaySegPhoto', 'studioDisplaySegAssets']) table[key] = call(key)
    return { language: new Proxy(table, { get: (target, key) => (typeof key === 'symbol' ? undefined : key in target ? target[key] : base[key]) }) }
})

import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from '../../ts/storage/characterSaveMarks'
import type { toSaveType } from '../../ts/storage/risuSave'
import { resetStudioToastsForTests, retireAssetToasts } from '../../ts/studio/edit/studioToasts'
import type { SaveAck } from '../../ts/studio/edit/saveAck.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from '../../ts/studio/history/ownerPhase'
import { resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioVisitAckForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock, drainMicrotasks } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import { readDisplaySegment, writeDisplaySegment, type DisplaySegment } from '../../ts/studio/displaySegment'
import { modeDefaultOf } from '../../ts/studio/edit/screenModeFill'
import { openStudio, resetStudioScreenForTests } from '../../ts/studio/studioScreen.svelte'
import { setStudioEnabled } from '../../ts/studio/studioSwitch.svelte'
import { resetToastHostForTests } from '../../ts/toast/toastHost.svelte'
import { setSessionAssetSizeJobForTests } from './assets/StudioAssetList.svelte'
import type { AssetSizeJob, StoredSize } from '../../ts/studio/assets/assetSizes'
import StudioDetail from './StudioDetail.svelte'

const noSizes: AssetSizeJob = { peek: () => undefined, snapshot: () => new Map<string, StoredSize>(), ensure: async () => true }
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
const OWNER = characterOwnerKey('cha-1')
const pA = 'assets/' + 'a'.repeat(64) + '.png'
const pB = 'assets/' + 'b'.repeat(64) + '.png'
const displayTarget = { owner: { type: 'character', id: 'cha-1' }, kind: 'display', item: 'cha-1/display:0', from: 'chat' } as const
const emotions = [['happy', pA], ['sad', pB]]

type Live = Record<string, unknown> & { newGenData?: Record<string, string> }

let app: ReturnType<typeof mount> | undefined
let host: HTMLElement | undefined
let service: OwnerHistoryService

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
const live = (): Live => db.db.characters[0] as unknown as Live
const tab = (id: DisplaySegment) => document.querySelector<HTMLElement>(`[data-part="studio-segment"][data-seg="${id}"]`)!
const field = (path: string) => document.querySelector<HTMLElement>(`[data-part="studio-display-field"][data-path="${path}"]`)
const TEXT_PARTS: Record<string, string> = {
    'newGenData.prompt': 'studio-display-gen-prompt',
    'newGenData.negative': 'studio-display-gen-negative',
    'newGenData.instructions': 'studio-display-gen-instructions',
    'newGenData.emotionInstructions': 'studio-display-emotion-instructions',
}
const text = (path: string) => part(TEXT_PARTS[path]) as HTMLTextAreaElement | null

async function settle(): Promise<void> {
    await drainMicrotasks()
    flushSync()
    await drainMicrotasks()
}

async function show(overrides: Record<string, unknown>, segment: DisplaySegment = 'screen', beta = false): Promise<void> {
    db.db = studioDbOf(makeInput({
        character: { ...makeCharacter({ chats: [makeChat({ id: 'chat-1', name: 'First chat' })] }), name: 'Alice', ...overrides },
    }))
    db.db.newImageHandlingBeta = beta
    writeDisplaySegment('cha-1', segment)
    openStudio(displayTarget, null)
    service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock: createFakeClock(),
        pageSession: 'p1',
        registerLeaveFlush: () => () => {},
        onLanded: retireAssetToasts,
    })
    setStudioHistoryServiceForTests(service)
    await service.whenReady(OWNER)
    await remount()
}

async function remount(): Promise<void> {
    if (app) await unmount(app)
    host?.remove()
    host = document.createElement('div')
    document.body.appendChild(host)
    app = mount(StudioDetail, { target: host })
    flushSync()
    await settle()
}

function pickMode(value: string): void {
    const select = part('studio-display-view-screen') as HTMLSelectElement
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
}

function type(area: HTMLTextAreaElement, value: string): void {
    area.value = value
    area.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

const stubAck = { display: 'saved', canRetry: () => false, retry: () => false, noteEdit: () => {}, dispose: () => {} } as unknown as SaveAck

beforeEach(() => {
    localStorage.clear()
    h.marks = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    settingsOpen.set(false)
    MobileGUI.set(false)
    selection.selId = 0
    setStudioEnabled(true)
    setSessionAssetSizeJobForTests(noSizes)
    setStudioVisitAckForTests(stubAck)
})

afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    host?.remove()
    host = undefined
    setSessionAssetSizeJobForTests(undefined)
    resetStudioToastsForTests()
    resetToastHostForTests()
    resetStudioHistoryAccessorForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
    setStudioEnabled(false)
    localStorage.clear()
})

describe('A-T4: the hide-icon and large-portrait switches are in the portrait segment', () => {
    test('portrait holds the hide-icon switch, the Basic form none, and the large-portrait switch only with a main image', async () => {
        await show({ image: '' }, 'photo')
        expect(part('studio-display-hide-icon')).not.toBeNull()
        expect(part('studio-form-hide-icon')).toBeNull()
        expect(part('studio-display-large-portrait')).toBeNull()
        await show({ image: 'main.png' }, 'photo')
        expect(part('studio-display-large-portrait')).not.toBeNull()
    })

    test('the hide-icon switch writes through the service as one step and undo puts it back', async () => {
        await show({}, 'photo')
        const box = part('studio-display-hide-icon') as HTMLInputElement
        box.click()
        flushSync()
        expect(live().hideChatIcon).toBe(true)
        expect(service.view(OWNER).done).toHaveLength(1)
        expect(service.undo(OWNER).ok).toBe(true)
        expect(live().hideChatIcon).not.toBe(true)
    })

    test('the segments carry counts: portrait counts the main image and the alternates, assets the additional assets', async () => {
        await show({ image: 'main.png', ccAssets: [{ type: 'x-risu-asset', uri: 'u1', name: 'n1', ext: 'png' }], additionalAssets: [['a', 'assets/a.png', 'png'], ['b', 'assets/b.png', 'png'], ['c', 'assets/c.png', 'png']] }, 'photo')
        expect(tab('photo').textContent).toBe('studioDisplaySegPhoto(2)')
        expect(tab('assets').textContent).toBe('studioDisplaySegAssets(3)')
        expect(tab('screen').textContent).toBe('studioDisplaySegScreen')
    })
})

describe('A-T5: the screen panel gates what each mode shows', () => {
    const MODES = ['none', 'emotion', 'imggen'] as const
    const rows = MODES.flatMap((mode) => [false, true].map((inlay) => ({ mode, inlay })))

    test.each(rows)('$mode, inlay $inlay', async ({ mode, inlay }) => {
        await show({ viewScreen: mode, inlayViewScreen: inlay, newGenData: { prompt: 'p', negative: 'n', instructions: 'i', emotionInstructions: 'e' }, emotionImages: emotions, ccAssets: [], additionalAssets: [['a', 'assets/a.png', 'png']] })
        expect(part('studio-display-view-screen')).not.toBeNull()
        expect(part('studio-emotion-list') !== null, 'emotion list').toBe(mode === 'emotion')
        expect(document.querySelectorAll('[data-part="studio-display-screen"] [data-part="studio-asset-row"]').length > 0, 'emotion rows').toBe(mode === 'emotion')
        expect(part('studio-display-inlay') !== null, 'inlay switch').toBe(mode !== 'none')
        expect(text('newGenData.emotionInstructions') !== null, 'emotion instructions').toBe(mode === 'emotion' && inlay)
        for (const path of ['newGenData.prompt', 'newGenData.negative', 'newGenData.instructions']) {
            expect(text(path) !== null, path).toBe(mode === 'imggen')
        }
        if (mode === 'none') {
            const shown = Array.from(document.querySelectorAll('[data-part="studio-display-screen"] [data-part]')).map((element) => element.getAttribute('data-part'))
            expect(shown).toEqual(['studio-display-view-screen'])
        }
    })

    test('the asset list is in the assets segment, and the beta switches show only with newImageHandlingBeta', async () => {
        await show({ additionalAssets: [['a', 'assets/a.png', 'png']] }, 'assets', false)
        expect(part('studio-asset-list')?.closest('[data-seg]')?.getAttribute('data-seg')).toBe('assets')
        expect(part('studio-display-prebuilt-asset-command')).toBeNull()
        expect(part('studio-display-prebuilt-asset-style')).toBeNull()
        await show({ additionalAssets: [['a', 'assets/a.png', 'png']] }, 'assets', true)
        expect(part('studio-display-prebuilt-asset-command')).not.toBeNull()
        const style = part('studio-display-prebuilt-asset-style') as HTMLSelectElement
        style.value = 'dynamic'
        style.dispatchEvent(new Event('change', { bubbles: true }))
        flushSync()
        expect(live().prebuiltAssetStyle).toBe('dynamic')
        const command = part('studio-display-prebuilt-asset-command') as HTMLInputElement
        command.click()
        flushSync()
        expect(live().prebuiltAssetCommand).toBe(true)
        expect(service.view(OWNER).done).toHaveLength(2)
    })

    test('only the shown segment holds its panel contents; the others are hidden', async () => {
        await show({ viewScreen: 'imggen' }, 'screen')
        const panel = (id: DisplaySegment) => document.querySelector<HTMLElement>(`[data-part="studio-display-panel"][data-seg="${id}"]`)!
        expect(panel('screen').hidden).toBe(false)
        expect(panel('photo').hidden).toBe(true)
        expect(panel('assets').hidden).toBe(true)
        expect(tab('screen').getAttribute('aria-selected')).toBe('true')
    })
})

describe('A-T7: the fill tag and reset', () => {
    test('a switch to image generation tags the keys it filled, not the key that already held the default, and shows the note', async () => {
        await show({ viewScreen: 'none', newGenData: { prompt: 'best quality, {{slot}}', negative: '', instructions: '', emotionInstructions: '' } })
        pickMode('imggen')
        await settle()
        expect(live().viewScreen).toBe('imggen')
        expect(part('studio-screen-filled')).not.toBeNull()
        expect(field('newGenData.prompt')?.hasAttribute('data-default')).toBe(false)
        expect(field('newGenData.negative')?.hasAttribute('data-default')).toBe(true)
        expect(field('newGenData.instructions')?.hasAttribute('data-default')).toBe(true)
        expect(field('newGenData.negative')?.querySelector('[data-part="studio-default-tag"]')).not.toBeNull()
        expect(field('newGenData.prompt')?.querySelector('[data-part="studio-default-reset"]')).toBeNull()
        expect(service.view(OWNER).done).toHaveLength(1)
    })

    test('typing removes the tag, the reset stays, and the reset writes the default as one step', async () => {
        await show({ viewScreen: 'none', newGenData: { prompt: '', negative: '', instructions: '', emotionInstructions: '' } })
        pickMode('imggen')
        await settle()
        expect(field('newGenData.negative')?.hasAttribute('data-default')).toBe(true)
        type(text('newGenData.negative')!, 'my negatives')
        expect(live().newGenData?.negative).toBe('my negatives')
        expect(field('newGenData.negative')?.hasAttribute('data-default')).toBe(false)
        const reset = field('newGenData.negative')?.querySelector<HTMLButtonElement>('[data-part="studio-default-reset"]')
        expect(reset).not.toBeNull()
        const steps = service.view(OWNER).done.length
        reset!.click()
        flushSync()
        expect(live().newGenData?.negative).toBe(modeDefaultOf('newGenData.negative', 'imggen', false))
        expect(service.view(OWNER).done).toHaveLength(steps + 1)
        expect(field('newGenData.negative')?.hasAttribute('data-default')).toBe(true)
    })

    test('a history undo of the switch hides the tag, the reset and the note', async () => {
        await show({ viewScreen: 'none', newGenData: { prompt: '', negative: '', instructions: '', emotionInstructions: '' } })
        pickMode('imggen')
        await settle()
        expect(part('studio-default-tag')).not.toBeNull()
        expect(service.undo(OWNER).ok).toBe(true)
        await settle()
        expect(live().viewScreen).toBe('none')
        expect(part('studio-default-tag')).toBeNull()
        expect(part('studio-default-reset')).toBeNull()
        expect(part('studio-screen-filled')).toBeNull()
    })

    test('a fill of the emotion instructions with inlay off announces that they are hidden until inlay is on', async () => {
        await show({ viewScreen: 'none', inlayViewScreen: false, newGenData: { prompt: '', negative: '', instructions: '', emotionInstructions: '' } })
        pickMode('emotion')
        await settle()
        expect(text('newGenData.emotionInstructions')).toBeNull()
        expect(part('studio-screen-fill-hidden')).not.toBeNull()
        const box = part('studio-display-inlay') as HTMLInputElement
        box.click()
        await settle()
        expect(text('newGenData.emotionInstructions')).not.toBeNull()
        expect(part('studio-screen-fill-hidden')).toBeNull()
    })

    test('a fill of the emotion instructions with inlay on shows them and announces nothing hidden', async () => {
        await show({ viewScreen: 'none', inlayViewScreen: true, newGenData: { prompt: '', negative: '', instructions: '', emotionInstructions: '' } })
        pickMode('emotion')
        await settle()
        expect(live().newGenData?.emotionInstructions).not.toBe('')
        expect(text('newGenData.emotionInstructions')).not.toBeNull()
        expect(part('studio-screen-filled')).not.toBeNull()
        expect(part('studio-screen-fill-hidden')).toBeNull()
    })
})

describe('A-T15 (MC-4134): the inlay switch leaves the asset list alone', () => {
    test('turn-on with additionalAssets absent keeps it absent, and the step names only inlay and newGenData paths', async () => {
        await show({ viewScreen: 'emotion', newGenData: { prompt: '', negative: '', instructions: '', emotionInstructions: '' } })
        delete live().additionalAssets
        const box = part('studio-display-inlay') as HTMLInputElement
        box.click()
        await settle()
        expect(live().inlayViewScreen).toBe(true)
        expect('additionalAssets' in live()).toBe(false)
        const step = service.view(OWNER).done[0]
        const paths = step.ops.map((op) => (op.op === 'set' ? op.path : op.op))
        expect(paths.every((path) => path === 'inlayViewScreen' || path.startsWith('newGenData.'))).toBe(true)
    })
})

describe('A-T13: the segment is remembered per owner across a remount', () => {
    test('choosing a segment stores it for this character, and a remount shows it', async () => {
        await show({}, 'photo')
        tab('assets').click()
        flushSync()
        expect(readDisplaySegment('cha-1')).toBe('assets')
        expect(readDisplaySegment('other')).toBe('photo')
        await remount()
        expect(tab('assets').getAttribute('aria-selected')).toBe('true')
    })

    test('arrow keys move between the tabs', async () => {
        await show({}, 'photo')
        tab('photo').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
        flushSync()
        expect(tab('screen').getAttribute('aria-selected')).toBe('true')
    })
})

describe('A-T3 and D-A1: the detail title follows the name', () => {
    test('a rename through the service re-derives the title', async () => {
        await show({}, 'photo')
        expect(part('studio-detail-title')?.textContent).toBe('Alice')
        expect(service.editText(OWNER, 'name', 'Alicia', 'single').ok).toBe(true)
        await settle()
        expect(part('studio-detail-title')?.textContent).toBe('Alicia')
    })
})
