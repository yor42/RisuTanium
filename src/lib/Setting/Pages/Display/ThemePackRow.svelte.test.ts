// @vitest-environment jsdom

/**
 * The Theme pack row: the list (None, built-ins, installed packs as cards with their details, fonts and Remove in a disclosure,
 * unreadable entries with Remove only), the checked state, the broken notice, the install progress, the help text, the focus after every
 * dialog, and that mounting writes nothing. All are guards for new behaviour: the row does not exist on the base, so each
 * fails only when a scratch mutant breaks the rule it names.
 *
 * The row, the flow, the intake, the judge and the pack builder are real. MOCKED: `stores.svelte` (a real `$state` DBState),
 * the file chooser and reader, the alert dialogs (a fake dialog that takes focus like the real one and gives none back), the
 * apply status, the asset store and the install transaction (a fake that drives `verify` and `confirmReplace` in install's
 * order).
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import type { Database } from 'src/ts/storage/database.svelte'
import type { ThemePackApplyState } from 'src/ts/themePack/activePack.svelte'
import type { ThemePackRecordV1 } from 'src/ts/themePack/packRecord'
import { BUILTIN_PACKS } from 'src/ts/themePack/builtins'
import { pngBytes } from 'src/ts/themePack/fixtures/imageBuilder'
import { manifestText, validPackFiles, zipPack } from 'src/ts/themePack/fixtures/packBuilder'
import { PACK_SIZE_WARN_BYTES } from 'src/ts/themePack/packSize'
import { focusFirstControl } from 'src/ts/settingsShell/settingsArrival'

//#region module mocks

const world = vi.hoisted(() => ({
    pickFile: null as null | (() => Promise<File | null>),
    readFile: null as null | (() => Promise<Uint8Array>),
    confirm: null as null | ((message: string) => Promise<boolean>),
    /** The record install asks Replace? about, when set. */
    existing: null as ThemePackRecordV1 | null,
    intakeOverride: null as null | (() => Promise<unknown>),
    installed: 0,
    busy: false,
    /** Stored asset bytes by key, read by the tile's icon loader. */
    assets: new Map<string, Uint8Array>(),
    requestSaveNow: vi.fn(),
    alertNormal: vi.fn(),
    alertToast: vi.fn(),
}))

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => { }), removeItem: vi.fn(async () => { }) }) },
}))
vi.mock(import('src/ts/alert'), () => ({
    alertConfirm: (message: string) => world.confirm!(message),
    alertNormal: world.alertNormal,
    alertToast: world.alertToast,
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/process/memory/busyActions'), async (importOriginal) => ({
    ...await importOriginal(),
    isBusy: () => world.busy,
}))
vi.mock(import('src/ts/util'), () => ({
    selectSingleFileObject: () => world.pickFile!(),
    readPickedFileBytes: () => world.readFile!(),
}) as unknown as typeof import('src/ts/util'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    requestSaveNow: world.requestSaveNow,
    saveAsset: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: async () => ({ read: async (key: string) => ({ bytes: world.assets.get(key) ?? null }) }),
    pageStoreIsOpfsTransitional: async () => false,
}) as unknown as typeof import('src/ts/storage/store/appStore'))
vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return { DBState: state } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/themePack/activePack.svelte'), () => {
    const status: ThemePackApplyState = $state({ activeId: undefined, phase: 'none' })
    return { themePackApplyState: () => status } as unknown as typeof import('src/ts/themePack/activePack.svelte')
})
vi.mock(import('src/ts/themePack/judgeClient'), async () => {
    const { judgePackSheets } = await import('src/ts/themePack')
    return {
        createJudgeClient: () => async (sheets: Parameters<typeof judgePackSheets>[0]) => judgePackSheets(sheets),
    } as unknown as typeof import('src/ts/themePack/judgeClient')
})
vi.mock(import('src/ts/themePack/intake'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        intakePackBytes: async (bytes: Uint8Array, judge: Parameters<typeof actual.intakePackBytes>[1]) =>
            world.intakeOverride ? world.intakeOverride() : actual.intakePackBytes(bytes, judge),
    } as unknown as typeof import('src/ts/themePack/intake')
})
vi.mock(import('src/ts/themePack/install'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        installThemePack: async (request: Parameters<typeof actual.installThemePack>[0]) => {
            const verdict = await request.verify(request.bytes)
            if (verdict.ok === false) {
                return { ok: false, kind: 'refused', refusal: verdict.refusal }
            }
            if (world.existing !== null && !await request.confirmReplace(world.existing)) {
                return { ok: false, kind: 'declinedReplace' }
            }
            world.installed += 1
            return { ok: true, record: { name: verdict.manifest.name }, replaced: false }
        },
    } as unknown as typeof import('src/ts/themePack/install')
})

//#endregion

import { DBState } from 'src/ts/stores.svelte'
import { themePackApplyState } from 'src/ts/themePack/activePack.svelte'
import { installFlowState, resetThemePackInstallFlowForTests } from './themePackInstallFlow.svelte'
import ThemePackRow from './ThemePackRow.svelte'

const mounted: Array<ReturnType<typeof mount>> = []

const harness = {
    duringDialog: [] as Array<Element | null>,
    asked: [] as string[],
    answers: [] as Array<boolean | (() => boolean)>,
    pickReturned: false,
}

function status(): ThemePackApplyState {
    return themePackApplyState() as ThemePackApplyState
}

async function settle(): Promise<void> {
    for (let round = 0; round < 4; round++) {
        flushSync()
        await tick()
        await new Promise((resolve) => setTimeout(resolve, 5))
    }
}

/** A dialog that takes focus like the real one, lets the answer run, and closes without giving focus back. */
async function fakeDialog(answer: () => boolean): Promise<boolean> {
    const button = document.createElement('button')
    button.dataset.fakeDialog = ''
    document.body.appendChild(button)
    button.focus()
    harness.duringDialog.push(document.activeElement)
    await Promise.resolve()
    const result = answer()
    button.blur()
    button.remove()
    return result
}

function nextAnswer(): () => boolean {
    const next = harness.answers.shift() ?? true
    return typeof next === 'function' ? next : () => next
}

const PACK_BYTES = zipPack(validPackFiles())

function recordOf(id: string, overrides: Partial<ThemePackRecordV1> = {}): ThemePackRecordV1 {
    return {
        v: 1,
        id,
        name: `Pack ${id}`,
        version: '1.2.3',
        license: 'MIT',
        attribution: 'An author',
        modes: ['dark'],
        fonts: [],
        archive: `assets/tp-${'ab'.repeat(32)}.risutheme`,
        bytes: 2048,
        installedAt: 1,
        ...overrides,
    }
}

function setPacks(themePacks: unknown[], activeThemePack?: string): void {
    DBState.db = (activeThemePack === undefined ? { themePacks } : { themePacks, activeThemePack }) as unknown as Database
}

function show(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(ThemePackRow, { target }))
    flushSync()
    return target
}

function installButton(target: HTMLElement): HTMLButtonElement {
    return target.querySelector<HTMLButtonElement>('[data-part="theme-pack-install"]')!
}

function radios(target: HTMLElement): HTMLInputElement[] {
    return [...target.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
}

function removeButtons(target: HTMLElement): HTMLButtonElement[] {
    return [...target.querySelectorAll<HTMLButtonElement>('[data-part="theme-pack-remove"]')]
}

function entryOf(target: HTMLElement, id: string): HTMLElement {
    return target.querySelector<HTMLElement>(`[data-pack-id="${id}"]`)!
}

function snapshotDb(): string {
    return JSON.stringify($state.snapshot(DBState.db))
}

/** The state after an install click: the chooser answered, the latch released, and the row has had time to move focus. */
async function finishInstall(): Promise<void> {
    await vi.waitFor(() => expect(harness.pickReturned).toBe(true))
    for (let round = 0; round < 3; round++) await Promise.resolve()
    await vi.waitFor(() => expect(installFlowState.pending).toBe(false))
    await settle()
}

beforeEach(() => {
    harness.duringDialog.length = 0
    harness.asked.length = 0
    harness.answers.length = 0
    harness.pickReturned = false
    world.existing = null
    world.intakeOverride = null
    world.installed = 0
    world.busy = false
    world.assets.clear()
    world.requestSaveNow.mockClear()
    world.alertNormal.mockClear()
    world.alertToast.mockClear()
    world.pickFile = async () => {
        await fakeDialog(() => true)
        harness.pickReturned = true
        return { name: 'pack.risutheme', size: PACK_BYTES.length } as unknown as File
    }
    world.readFile = async () => PACK_BYTES
    world.confirm = async (message) => {
        harness.asked.push(message)
        return fakeDialog(nextAnswer())
    }
    Object.assign(status(), { activeId: undefined, phase: 'none', reason: undefined, refusals: undefined })
    resetThemePackInstallFlowForTests()
    setPacks([])
})

afterEach(() => {
    for (const component of mounted.splice(0)) unmount(component)
    document.body.replaceChildren()
    resetThemePackInstallFlowForTests()
})

describe('T4-3 the list', () => {
    test('None, the two built-ins and the readable installed packs are radios; an unreadable entry has Remove and no radio', () => {
        setPacks([
            recordOf('light', { modes: ['light'] }),
            recordOf('dark', { modes: ['dark'], fonts: [{ file: 'fonts/a.woff2', license: 'OFL' }] }),
            recordOf('both', { modes: ['light', 'dark'] }),
            { v: 99, id: 'future' },
        ])
        const target = show()
        expect(radios(target)).toHaveLength(1 + BUILTIN_PACKS.length + 3)
        expect(radios(target)[0].value).toBe('')
        const unreadable = target.querySelector<HTMLElement>('[data-part="theme-pack-unreadable"]')!
        expect(unreadable.querySelector('input')).toBeNull()
        expect(unreadable.querySelector('[data-part="theme-pack-remove"]')).not.toBeNull()
        expect(unreadable.textContent).toContain(language.themePackUnreadableDetail)
        expect(removeButtons(target)).toHaveLength(3 + 1)
        expect(entryOf(target, 'light').textContent).toContain(language.themePackModesLight)
        expect(entryOf(target, 'dark').textContent).toContain(language.themePackModesDark)
        expect(entryOf(target, 'both').textContent).toContain(language.themePackModesBoth)
        expect(entryOf(target, 'light').textContent).toContain(language.themePackVersion('1.2.3'))
        expect(entryOf(target, 'light').textContent).toContain(language.themePackSize('2.0 KiB'))
        expect(entryOf(target, 'light').textContent).toContain(language.themePackLicense('MIT'))
        expect(entryOf(target, 'light').textContent).toContain(language.themePackAttribution('An author'))
        const builtin = entryOf(target, BUILTIN_PACKS[0].id)
        expect(builtin.querySelector('[data-part="theme-pack-remove"]')).toBeNull()
        expect(builtin.textContent).toContain(language.themePackBuiltIn)
        expect(builtin.textContent).not.toContain(language.themePackSize('0.0 KiB'))
    })

    test('T1-2 the details, the font licenses and Remove sit inside one disclosure per installed pack; a built-in has no Remove', () => {
        setPacks([
            recordOf('dark', { fonts: [{ file: 'fonts/a.woff2', license: 'OFL', attribution: 'A foundry' }, { file: 'fonts/b.woff2', license: 'MIT' }] }),
            recordOf('plain'),
        ])
        const target = show()
        for (const id of ['dark', 'plain']) {
            const entry = entryOf(target, id)
            const all = entry.querySelectorAll('details')
            expect(all).toHaveLength(1)
            const details = entry.querySelector('[data-part="theme-pack-details"]')!
            expect(details).toBe(all[0])
            expect(details.querySelector('summary')!.textContent).toBe(language.themePackDetails)
            expect(details.textContent).toContain(language.themePackVersion('1.2.3'))
            expect(details.textContent).toContain(language.themePackLicense('MIT'))
            expect(details.querySelector('[data-part="theme-pack-remove"]')).not.toBeNull()
            expect(entry.querySelectorAll('[data-part="theme-pack-remove"]')).toHaveLength(1)
        }
        const fonts = entryOf(target, 'dark').querySelector('[data-part="theme-pack-details"]')!
        expect(fonts.textContent).toContain(language.themePackFonts)
        expect(fonts.textContent).toContain(language.themePackFontLicense('fonts/a.woff2', 'OFL'))
        expect(fonts.textContent).toContain(language.themePackFontLicense('fonts/b.woff2', 'MIT'))
        expect(fonts.textContent).toContain(language.themePackAttribution('A foundry'))
        expect(fonts.querySelectorAll('li')).toHaveLength(2)
        expect(entryOf(target, 'plain').textContent).not.toContain(language.themePackFonts)

        const builtin = entryOf(target, BUILTIN_PACKS[0].id)
        expect(builtin.querySelectorAll('[data-part="theme-pack-details"]')).toHaveLength(1)
        expect(builtin.querySelector('[data-part="theme-pack-remove"]')).toBeNull()
        expect(target.querySelector('[data-part="theme-pack-none"] details')).toBeNull()
    })

    test('T1-1 every card has a tile; the unreadable card has a tile and Remove but no radio', () => {
        setPacks([recordOf('a'), { v: 99, id: 'future' }])
        const target = show()
        const cards = [
            target.querySelector<HTMLElement>('[data-part="theme-pack-none"]')!,
            ...BUILTIN_PACKS.map((pack) => entryOf(target, pack.id)),
            entryOf(target, 'a'),
            target.querySelector<HTMLElement>('[data-part="theme-pack-unreadable"]')!,
        ]
        for (const card of cards) {
            expect(card.querySelectorAll('svg[data-part="theme-pack-tile"]')).toHaveLength(1)
        }
        const unreadable = cards[cards.length - 1]
        expect(unreadable.querySelector('input')).toBeNull()
        expect(unreadable.querySelector('[data-part="theme-pack-remove"]')).not.toBeNull()
    })

    test('T2b-10 an installed pack draws its record colours on the tile, a pack without colours a neutral one, and no pack colour leaves the svg', () => {
        setPacks([recordOf('a', { mainColor: '#3366ff', secondaryColor: '#101820' }), recordOf('b')])
        const target = show()
        const ground = (id: string): Element => entryOf(target, id).querySelector('[data-part="tile-ground"]')!
        expect(ground('a').getAttribute('fill')).toBe('#101820')
        expect(ground('b').getAttribute('fill')).toBeNull()
        expect(ground('b').getAttribute('class')).toBe('fill-darkbg')
        // The built-ins draw the colours their literals carry.
        for (const pack of BUILTIN_PACKS) {
            expect(ground(pack.id).getAttribute('fill')).toBe(pack.secondaryColor)
        }
        for (const element of target.querySelectorAll<HTMLElement>('*')) {
            if (element.closest('svg') === null) {
                expect(element.getAttribute('style') ?? '', element.outerHTML.slice(0, 80)).not.toMatch(/#[0-9a-f]{3,6}/i)
                expect(element.className.toString()).not.toMatch(/#[0-9a-f]{6}/i)
            }
        }
        const name = entryOf(target, 'a').querySelector('label span[id]')!
        expect(name.getAttribute('style')).toBeNull()
    })

    test('T3-6 an installed pack with a stored icon shows it with the pack name as alt text, the radio keeps its one accessible name, and the other cards keep their pattern', async () => {
        const key = `assets/tp-${'ab'.repeat(32)}.png`
        world.assets.set(key, pngBytes(24, 16))
        const urls: string[] = []
        URL.createObjectURL = vi.fn(() => { urls.push(`blob:row-${urls.length + 1}`); return urls[urls.length - 1] })
        URL.revokeObjectURL = vi.fn()
        setPacks([recordOf('a', { icon: key }), recordOf('b')])
        const target = show()

        await settle()

        const card = entryOf(target, 'a')
        const img = card.querySelector('img')!
        expect(img.getAttribute('alt')).toBe('Pack a')
        expect(img.getAttribute('src')).toBe(urls[0])
        const radio = card.querySelector<HTMLInputElement>('input[type="radio"]')!
        expect(radio.getAttribute('aria-label')).toBe('Pack a')
        expect(entryOf(target, 'b').querySelector('img')).toBeNull()
        expect(urls).toHaveLength(1)
    })

    test('T1-3 all radios share one name, and a busy select puts the radio back', async () => {
        setPacks([recordOf('a'), recordOf('b')], 'a')
        const target = show()
        expect(new Set(radios(target).map((radio) => radio.name)).size).toBe(1)
        expect(radios(target)[0].name).not.toBe('')
        world.busy = true
        radios(target).find((radio) => radio.value === 'b')!.click()
        await settle()
        expect(DBState.db.activeThemePack).toBe('a')
        expect(radios(target).filter((radio) => radio.checked).map((radio) => radio.value)).toEqual(['a'])
    })

    test('T1-12 each radio is named through aria-label by the visible name, and the summary label starts with its text', () => {
        setPacks([recordOf('a')])
        const target = show()
        const names = new Map<string, string>([['', language.themePackNone], ['a', 'Pack a'], [BUILTIN_PACKS[0].id, BUILTIN_PACKS[0].name]])
        for (const [value, name] of names) {
            const radio = radios(target).find((candidate) => candidate.value === value)!
            expect(radio.getAttribute('aria-label')).toBe(name)
        }
        const summary = entryOf(target, 'a').querySelector('summary')!
        expect(summary.getAttribute('aria-label')).toBe(language.themePackDetailsFor('Pack a'))
        expect(summary.getAttribute('aria-label')!.startsWith(summary.textContent!)).toBe(true)
    })

    test('the card state classes sit on siblings of the radio inside one label', () => {
        setPacks([recordOf('a')])
        const target = show()
        const radio = radios(target).find((candidate) => candidate.value === 'a')!
        expect(radio.className).toContain('peer')
        const label = radio.closest('label')!
        const siblings = [...label.children].filter((child) => child !== radio)
        const frame = siblings.find((child) => child.querySelector('svg'))!
        expect(frame.className).toContain('peer-checked:outline-2')
        expect(frame.className).toContain('peer-checked:outline-textcolor')
        expect(frame.className).toContain('peer-focus-visible:ring-2')
        expect(frame.className).toContain('peer-focus-visible:forced-colors:outline-2')
        const badge = siblings.find((child) => child.className.includes('peer-checked:flex'))!
        expect(badge.className).toContain('hidden')
        expect(badge.querySelector('svg')).not.toBeNull()
        expect(label.querySelector('span[id]')!.className).toContain('peer-checked:font-semibold')
    })

    test('the checked radio follows the stored id: None when no id is stored, the pack otherwise, whatever the apply status says', async () => {
        setPacks([recordOf('a'), recordOf('b')])
        let target = show()
        expect(radios(target).filter((radio) => radio.checked).map((radio) => radio.value)).toEqual([''])
        unmount(mounted.pop()!)
        target.remove()

        setPacks([recordOf('a'), recordOf('b')], 'b')
        // Safe Mode reads "none" while the stored id stays.
        Object.assign(status(), { activeId: undefined, phase: 'none' })
        target = show()
        await settle()
        expect(radios(target).filter((radio) => radio.checked).map((radio) => radio.value)).toEqual(['b'])
        expect(radios(target)[0].checked).toBe(false)
    })

    test('choosing a radio stores its id and None clears it', () => {
        setPacks([recordOf('a')])
        const target = show()
        radios(target).find((radio) => radio.value === 'a')!.click()
        flushSync()
        expect(DBState.db.activeThemePack).toBe('a')
        expect(world.requestSaveNow).toHaveBeenCalledTimes(1)
        radios(target)[0].click()
        flushSync()
        expect('activeThemePack' in DBState.db).toBe(false)
    })
})

describe('T4-7 the help text', () => {
    test('it is the composed sentence naming both toggle paths', () => {
        const target = show()
        const help = target.querySelector('[data-part="theme-pack-help"]')!.textContent
        expect(help).toBe(language.themePackRowHelp(language.chatShellPreviewLabel, language.accessibility, language.settingsShellPageInput, language.settingsShellInputPreview))
        for (const part of [language.chatShellPreviewLabel, language.accessibility, language.settingsShellPageInput, language.settingsShellInputPreview]) {
            expect(help).toContain(part)
        }
    })
})

describe('T4-11 the broken notice', () => {
    test('a refused pack shows its name, the refusal lines and a Remove that removes it', async () => {
        setPacks([recordOf('bad')], 'bad')
        Object.assign(status(), { activeId: 'bad', phase: 'broken', reason: 'refused', refusals: [{ code: 'noArea' }, { code: 'notAPack' }] })
        const target = show()
        await settle()
        const notice = target.querySelector<HTMLElement>('[data-part="theme-pack-broken"]')!
        expect(notice.textContent).toContain(language.themePackBroken('Pack bad', language.themePackBrokenRefused))
        expect(notice.textContent).toContain(language.themePackRefuseNoArea)
        expect(notice.textContent).toContain(language.themePackRefuseNotAPack)
        // Nothing is alerted or toasted on mount, not even after the row has had time to run its effects and imports.
        expect(world.alertNormal).not.toHaveBeenCalled()
        expect(world.alertToast).not.toHaveBeenCalled()

        notice.querySelector<HTMLButtonElement>('[data-part="theme-pack-remove"]')!.click()
        await settle()
        expect(harness.asked).toEqual([language.themePackRemoveConfirm('Pack bad')])
        expect(DBState.db.themePacks).toEqual([])
        expect('activeThemePack' in DBState.db).toBe(false)
    })

    test('a broken built-in has no Remove', () => {
        setPacks([], BUILTIN_PACKS[0].id)
        Object.assign(status(), { activeId: BUILTIN_PACKS[0].id, phase: 'broken', reason: 'files' })
        const notice = show().querySelector<HTMLElement>('[data-part="theme-pack-broken"]')!
        expect(notice.textContent).toContain(language.themePackBroken(BUILTIN_PACKS[0].name, language.themePackBrokenFiles))
        expect(notice.querySelector('[data-part="theme-pack-remove"]')).toBeNull()
    })

    test('an unreadable active entry shows the notice with Remove', () => {
        setPacks([{ v: 99, id: 'future' }], 'future')
        Object.assign(status(), { activeId: 'future', phase: 'broken', reason: 'unreadable' })
        const notice = show().querySelector<HTMLElement>('[data-part="theme-pack-broken"]')!
        expect(notice.textContent).toContain(language.themePackBroken(language.themePackUnreadableName, language.themePackBrokenUnreadable))
        expect(notice.querySelector('[data-part="theme-pack-remove"]')).not.toBeNull()
    })

    test('a status for a pack that is not the chosen one shows no notice', () => {
        setPacks([recordOf('a')], 'a')
        Object.assign(status(), { activeId: 'other', phase: 'broken', reason: 'files' })
        expect(show().querySelector('[data-part="theme-pack-broken"]')).toBeNull()
    })

    test('an applied or pending status shows no notice and nothing is alerted', () => {
        setPacks([recordOf('a')], 'a')
        Object.assign(status(), { activeId: 'a', phase: 'applied' })
        expect(show().querySelector('[data-part="theme-pack-broken"]')).toBeNull()
        expect(world.alertNormal).not.toHaveBeenCalled()
    })
})

describe('T4-13 and T4-2e progress and the latch', () => {
    test('while checking, the status line shows with no spinner, and Install is disabled', async () => {
        let release: () => void = () => {}
        const gate = new Promise<void>((resolve) => { release = resolve })
        world.readFile = async () => {
            await gate
            return PACK_BYTES
        }
        const target = show()
        installButton(target).click()
        await vi.waitFor(() => expect(installFlowState.pending).toBe(true))
        flushSync()
        expect(target.textContent).toContain(language.themePackChecking)
        expect(target.querySelector('.loadmove, .animate-spin')).toBeNull()
        expect(installButton(target).disabled).toBe(true)
        release()
        await finishInstall()
        expect(installButton(target).disabled).toBe(false)
        expect(target.textContent).not.toContain(language.themePackChecking)
    })

    test('a row mounted again while an install runs shows Install disabled until it ends', async () => {
        let release: () => void = () => {}
        const gate = new Promise<void>((resolve) => { release = resolve })
        world.readFile = async () => {
            await gate
            return PACK_BYTES
        }
        const first = show()
        installButton(first).click()
        await vi.waitFor(() => expect(installFlowState.pending).toBe(true))
        unmount(mounted.pop()!)
        first.remove()
        const second = show()
        expect(installButton(second).disabled).toBe(true)
        release()
        await finishInstall()
        expect(installButton(second).disabled).toBe(false)
    })
})

describe('T4-12 focus after every dialog', () => {
    function assertDialogHadFocus(count: number): void {
        expect(harness.duringDialog).toHaveLength(count)
        for (const element of harness.duringDialog) {
            expect(element).toBeInstanceOf(HTMLElement)
            expect((element as HTMLElement).dataset.fakeDialog).toBe('')
        }
    }

    test('a declined Replace', async () => {
        world.existing = recordOf('old')
        harness.answers.push(false)
        const target = show()
        installButton(target).click()
        await finishInstall()
        expect(harness.asked).toEqual([language.themePackReplaceConfirm('Pack old')])
        assertDialogHadFocus(2)
        expect(document.activeElement).toBe(installButton(target))
    })

    test('a declined 20 MiB question', async () => {
        const real = await vi.importActual<typeof import('src/ts/themePack/intake')>('src/ts/themePack/intake')
        const pack = await real.intakePackBytes(PACK_BYTES, async (sheets) => (await import('src/ts/themePack')).judgePackSheets(sheets))
        if (!pack.ok) throw new Error('the fixture pack was refused')
        world.intakeOverride = async () => ({ ok: true, pack: { ...pack.pack, totalBytes: 21 * 1024 * 1024, size: { warn: true, limitBytes: PACK_SIZE_WARN_BYTES } } })
        harness.answers.push(false)
        const target = show()
        installButton(target).click()
        await finishInstall()
        expect(harness.asked).toEqual([language.themePackLargeConfirm('21.0 MiB')])
        expect(world.installed).toBe(0)
        expect(installFlowState.outcome).toBeNull()
        assertDialogHadFocus(2)
        expect(document.activeElement).toBe(installButton(target))
    })

    test('a success and a refusal, with the chooser taking focus', async () => {
        const target = show()
        installButton(target).click()
        await finishInstall()
        expect(world.installed).toBe(1)
        expect(target.querySelector('[data-part="theme-pack-outcome"]')!.textContent).toContain(language.themePackInstalled('Test Pack'))
        assertDialogHadFocus(1)
        expect(document.activeElement).toBe(installButton(target))

        harness.duringDialog.length = 0
        harness.pickReturned = false
        world.readFile = async () => new TextEncoder().encode('not a zip file, but long enough to be looked at as one')
        installButton(target).click()
        await finishInstall()
        expect(target.querySelector('[data-part="theme-pack-outcome"]')!.textContent).toContain(language.themePackRefuseNotAPack)
        assertDialogHadFocus(1)
        expect(document.activeElement).toBe(installButton(target))
    })

    test('a confirmed Remove from the list and from the notice', async () => {
        setPacks([recordOf('a'), recordOf('b')], 'b')
        Object.assign(status(), { activeId: 'b', phase: 'broken', reason: 'files' })
        const target = show()
        removeButtons(target)[0].click()
        await settle()
        assertDialogHadFocus(1)
        expect(DBState.db.themePacks).toHaveLength(1)
        expect(document.activeElement).toBe(installButton(target))

        harness.duringDialog.length = 0
        target.querySelector<HTMLButtonElement>('[data-part="theme-pack-broken"] [data-part="theme-pack-remove"]')!.click()
        await settle()
        assertDialogHadFocus(1)
        expect(DBState.db.themePacks).toEqual([])
        expect(document.activeElement).toBe(installButton(target))
    })

    test('a declined Remove leaves focus on that Remove button', async () => {
        setPacks([recordOf('a')])
        harness.answers.push(false)
        const target = show()
        const remove = removeButtons(target)[0]
        remove.click()
        await settle()
        assertDialogHadFocus(1)
        expect(DBState.db.themePacks).toHaveLength(1)
        expect(document.activeElement).toBe(remove)
    })

    test('a Remove whose list changed while asking: focus returns to Install when the button is gone, and stays on it when it is still there', async () => {
        setPacks([recordOf('a')])
        harness.answers.push(() => {
            DBState.db.themePacks = []
            return true
        })
        const target = show()
        removeButtons(target)[0].click()
        await settle()
        expect(target.querySelector('[data-part="theme-pack-outcome"]')!.textContent).toContain(language.themePackRemoveChanged)
        expect(removeButtons(target)).toHaveLength(0)
        expect(document.activeElement).toBe(installButton(target))

        setPacks([recordOf('a')])
        harness.answers.push(() => {
            DBState.db.themePacks = [recordOf('a')]
            return true
        })
        const second = show()
        const remove = removeButtons(second)[0]
        remove.click()
        await settle()
        expect(remove.isConnected).toBe(true)
        expect(document.activeElement).toBe(remove)
    })

    test('focus the person moved outside the row while the dialog was open is kept', async () => {
        setPacks([recordOf('a')])
        const outside = document.createElement('button')
        document.body.appendChild(outside)
        harness.answers.push(() => {
            outside.focus()
            return false
        })
        const target = show()
        removeButtons(target)[0].click()
        await settle()
        expect(document.activeElement).toBe(outside)
    })

    test('a select does not move focus', async () => {
        setPacks([recordOf('a')])
        const target = show()
        const radio = radios(target).find((candidate) => candidate.value === 'a')!
        radio.focus()
        radio.click()
        await settle()
        expect(document.activeElement).toBe(radio)
    })
})

describe('T4-15 the first control of the row is the None radio', () => {
    test('with nothing else, with a broken notice and with an outcome shown', async () => {
        const target = show()
        focusFirstControl(target)
        expect(document.activeElement).toBe(radios(target)[0])
        expect(radios(target)[0].value).toBe('')

        setPacks([recordOf('bad')], 'bad')
        Object.assign(status(), { activeId: 'bad', phase: 'broken', reason: 'files' })
        installFlowState.outcome = { tone: 'error', lines: ['something'] }
        await settle()
        expect(target.querySelector('[data-part="theme-pack-broken"]')).not.toBeNull()
        ;(document.activeElement as HTMLElement | null)?.blur()
        focusFirstControl(target)
        expect(document.activeElement).toBe(radios(target)[0])
    })
})

describe('T4-17 mounting writes nothing', () => {
    test('the stored data is identical after mount, a flush and a tick', async () => {
        setPacks([recordOf('a'), { v: 99, id: 'future' }], 'a')
        Object.assign(status(), { activeId: 'a', phase: 'broken', reason: 'refused', refusals: [{ code: 'noArea' }] })
        const before = snapshotDb()
        show()
        flushSync()
        await tick()
        expect(snapshotDb()).toBe(before)
        expect(world.requestSaveNow).not.toHaveBeenCalled()
    })
})
