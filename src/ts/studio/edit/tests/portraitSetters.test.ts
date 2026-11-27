// @vitest-environment happy-dom

/**
 * The portrait builders against the classic panel: for each intent the real classic code (`selectCharImg` with
 * `dumpCharImage`, `changeCharImage`, and the two removals of the panel) runs on one character, and the builder's op, applied
 * to a copy of the same character, leaves the same `image`, `ccAssets` and `extentions`. The classic module runs with every
 * other module mocked, following `characters.imageWriters.svelte.test.ts`; the character is a plain object here, and the
 * application's own `$state` proxy is exercised by the service test. The builders' own refusals are checked on plain values.
 */
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) }) },
}))
vi.mock(import('src/ts/platform'), () => ({ isTauri: false, isNodeServer: false }) as unknown as typeof import('src/ts/platform'))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 } }))

const hoisted = vi.hoisted(() => ({ testDb: { db: {} as unknown as Database }, notes: [] as { key: string; value: string }[] }))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: hoisted.testDb,
    selectedCharID: writable(0),
    CharEmotion: writable({}),
    MobileGUIStack: writable([]),
    OpenRealmStore: writable(null),
}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    AppendableBuffer: class {},
    changeChatTo: vi.fn(),
    checkCharOrder: vi.fn(),
    downloadFile: vi.fn(),
    getFileSrc: vi.fn(async (loc: string) => `blob:${loc}`),
    pickedAssetLimitBytes: vi.fn(async () => 1024 * 1024),
    requiresFullEncoderReload: { state: false },
    forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/alert'), () => ({
    alertAddCharacter: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertStore: { set: vi.fn(), update: vi.fn(), subscribe: vi.fn() },
    alertWait: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => hoisted.testDb.db),
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    saveImage: vi.fn(),
    defaultSdDataFunc: vi.fn(() => ({})),
    getCharacterByIndex: vi.fn(),
    setCharacterByIndex: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/util'), () => ({
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    findCharacterbyId: vi.fn(),
    findCharacterIndexbyId: vi.fn(() => -1),
    getUserName: vi.fn(() => 'User'),
    readPickedFileBytes: vi.fn(async (file: { data: Uint8Array }) => file.data),
    selectMultipleFileObjects: vi.fn(),
    selectSingleFileObject: vi.fn(),
}) as unknown as typeof import('src/ts/util'))
vi.mock(import('src/ts/media'), () => ({ getImageType: vi.fn(() => 'PNG') }) as unknown as typeof import('src/ts/media'))
vi.mock(import('src/ts/media/imageType'), () => ({ getImageType: vi.fn(() => 'PNG') }) as unknown as typeof import('src/ts/media/imageType'))
vi.mock(import('src/ts/process/inlayScreen'), () => ({ updateInlayScreen: vi.fn() }) as unknown as typeof import('src/ts/process/inlayScreen'))
vi.mock(import('src/ts/parser/parser.svelte'), () => ({ parseMarkdownSafe: vi.fn(), hasher: vi.fn((s: string) => s) }) as unknown as typeof import('src/ts/parser/parser.svelte'))
vi.mock(import('src/ts/translator/translator'), () => ({ translateHTML: vi.fn() }) as unknown as typeof import('src/ts/translator/translator'))
vi.mock(import('src/ts/process/index.svelte'), () => ({ doingChat: writable(false) }) as unknown as typeof import('src/ts/process/index.svelte'))
vi.mock(import('src/ts/characterCards'), () => ({ importCharacter: vi.fn() }) as unknown as typeof import('src/ts/characterCards'))
// The picture's notes, read the same way by the classic reader and by `readPortraitTextChunks`.
vi.mock(import('src/ts/pngChunk'), () => ({
    PngChunk: {
        readGenerator: async function* () {
            for (const note of hoisted.notes) {
                yield note
            }
        },
    },
}) as unknown as typeof import('src/ts/pngChunk'))
vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({ getColdStorageItem: vi.fn() }) as unknown as typeof import('src/ts/process/coldstorage.svelte'))
vi.mock(import('src/ts/media/avatarThumb'), () => ({ getAvatarThumbSrc: vi.fn(), isThumbEligible: vi.fn(() => false) }) as unknown as typeof import('src/ts/media/avatarThumb'))
vi.mock(import('src/ts/storage/characterSaveMarks'), () => ({ markCharacterForSave: vi.fn() }) as unknown as typeof import('src/ts/storage/characterSaveMarks'))

//#endregion

import { changeCharImage, selectCharImg } from 'src/ts/characters'
import { saveImage } from 'src/ts/storage/database.svelte'
import { selectSingleFileObject } from 'src/ts/util'
import { resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'
import { readPortraitTextChunks } from '../../assets/portraitTextChunks'
import type { ExifValue, LiveReader, PortraitOp, PortraitValue } from '../../history/historyModel'
import type { AssetBuildResult } from '../assetSetters'
import { buildPortraitAdd, buildPortraitMakeMain, buildPortraitRemove, type PortraitAddBuild } from '../portraitSetters'

type Slot = Database['characters'][number]
interface Photo { type: string; uri: string; name: string; ext: string }
interface Subject { chaId: string; type: 'character'; name: string; image?: string; ccAssets?: Photo[]; extentions?: Record<string, unknown> }

const hash = (letter: string): string => `assets/${letter.repeat(64)}.png`
const M = hash('m')
const N = hash('n')
const P = hash('p')
const Q = hash('q')
const row = (uri: string, name = 'iconx'): Photo => ({ type: 'icon', name, uri, ext: 'png' })

function makeSubject(over: Partial<Subject> = {}): Subject {
    return {
        chaId: 'X',
        type: 'character',
        name: 'X',
        image: M,
        ccAssets: [row(P, 'second'), row(Q, 'third')],
        extentions: { pngExif: { Title: 'old', Author: 'kept' }, folder: { keep: 'me' }, other: 1 },
        ...over,
    }
}

function installSubject(subject: Subject): Subject {
    hoisted.testDb.db = { characters: [subject as unknown as Slot] } as unknown as Database
    return subject
}

// The reader a builder runs on, over any subject value.
function readerOf(subject: Subject): LiveReader {
    return {
        field: () => ({ had: false }),
        greetings: () => null,
        fmIndex: () => null,
        portrait(): PortraitValue | null {
            return {
                image: subject.image === undefined ? { had: false } : { had: true, value: subject.image },
                alternates: subject.ccAssets === undefined ? { had: false } : { had: true, rows: subject.ccAssets.map((r) => ({ type: r.type, uri: r.uri, name: r.name, ext: r.ext })) },
            }
        },
        pngExif(): ExifValue | null {
            const exif = subject.extentions?.pngExif
            return exif === undefined ? { had: false } : { had: true, value: JSON.parse(JSON.stringify(exif)) }
        },
    }
}

// The write of one op on a plain copy of the subject.
function applyTo(subject: Subject, op: PortraitOp): Subject {
    const next = JSON.parse(JSON.stringify(subject)) as Subject
    if (op.after.image.had) next.image = op.after.image.value
    else delete next.image
    if (op.after.alternates.had) next.ccAssets = op.after.alternates.rows.map((r) => ({ ...r }))
    else delete next.ccAssets
    if (op.pngExif !== undefined) {
        next.extentions ??= {}
        if (op.pngExif.after.had) next.extentions.pngExif = op.pngExif.after.value
        else delete next.extentions.pngExif
    }
    return next
}

const plain = (subject: Subject): Subject => JSON.parse(JSON.stringify(subject)) as Subject

const NOTES = [
    { key: 'Title', value: 'new title' },
    { key: 'Comment', value: 'a comment' },
    { key: 'NotAllowed', value: 'dropped' },
    { key: 'Description', value: 'x'.repeat(20_001) },
]

function build(result: PortraitAddBuild | AssetBuildResult): PortraitOp {
    if (result.ok === false) throw new Error(`refused: ${result.reason}`)
    return result.ops[0] as PortraitOp
}

beforeEach(() => {
    resetBusyActionsForTest()
    hoisted.notes.length = 0
    vi.mocked(saveImage).mockReset().mockResolvedValue(N)
    vi.mocked(selectSingleFileObject).mockReset()
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('B-T1: an add equals what the classic picker leaves', () => {
    for (const [name, subject] of [
        ['an old main, alternates and a map', makeSubject()],
        ['an old main and no alternates list', makeSubject({ ccAssets: undefined })],
        ['no main and no exif', makeSubject({ image: '', ccAssets: undefined, extentions: {} })],
        ['no extentions at all', makeSubject({ extentions: undefined })],
    ] as const) {
        test(`${name}: image, ccAssets and extentions are the same as selectCharImg's`, async () => {
            hoisted.notes.push(...NOTES)
            const bytes = new Uint8Array([1, 2, 3])
            const mine = applyTo(subject, build(buildPortraitAdd(N, await readPortraitTextChunks(bytes), readerOf(subject))))
            const classic = installSubject(plain(subject))
            vi.mocked(selectSingleFileObject).mockResolvedValue({ name: 'new.png', size: 3, data: bytes } as never)
            await selectCharImg(0)
            expect(plain(mine)).toEqual(plain(classic))
        })
    }

    test('only the allowed notes under the cap are read, once per key', async () => {
        hoisted.notes.push(...NOTES, { key: 'Title', value: 'second title' })
        expect(await readPortraitTextChunks(new Uint8Array([1]))).toEqual({ Title: 'second title', Comment: 'a comment' })
    })

    test('an exif map that cannot be written into makes the add land without the notes', () => {
        const subject = makeSubject({ extentions: { pngExif: 'not a map' } })
        const reader = readerOf(subject)
        reader.pngExif = () => null
        const built = buildPortraitAdd(N, { Title: 't' }, reader)
        if (built.ok === false) throw new Error('refused')
        expect(built.chunkCount).toBe(0)
        expect((built.ops[0] as PortraitOp).pngExif).toBeUndefined()
        expect((built.ops[0] as PortraitOp).after.image).toEqual({ had: true, value: N })
    })
})

describe('B-T3: make main equals changeCharImage', () => {
    test.each([0, 1])('alternate %i becomes main, the old main is appended, the alternates list is rebuilt as classic does', (index) => {
        const subject = makeSubject()
        const mine = applyTo(subject, build(buildPortraitMakeMain(index, readerOf(subject))))
        const classic = installSubject(plain(subject))
        changeCharImage(0, index)
        expect(plain(mine)).toEqual(plain(classic))
    })

    test('with an empty main nothing is appended', () => {
        const subject = makeSubject({ image: '' })
        const mine = applyTo(subject, build(buildPortraitMakeMain(0, readerOf(subject))))
        const classic = installSubject(plain(subject))
        changeCharImage(0, 0)
        expect(plain(mine)).toEqual(plain(classic))
    })
})

describe('B-T4: the removals equal the classic panel\'s', () => {
    // The classic panel's own removals: the main empties and the first alternate is promoted; an alternate is spliced.
    function classicRemoveMain(subject: Subject): Subject {
        const live = installSubject(plain(subject))
        live.image = ''
        if (live.ccAssets && live.ccAssets.length > 0) changeCharImage(0, 0)
        return plain(live)
    }

    test('remove main with alternates promotes the first one', () => {
        const subject = makeSubject()
        expect(plain(applyTo(subject, build(buildPortraitRemove('main', readerOf(subject)))))).toEqual(classicRemoveMain(subject))
    })

    test.each([
        ['no alternates list', makeSubject({ ccAssets: undefined })],
        ['an empty alternates list', makeSubject({ ccAssets: [] })],
    ])('remove main with %s leaves an empty main and the list as it was', (_name, subject) => {
        expect(plain(applyTo(subject, build(buildPortraitRemove('main', readerOf(subject)))))).toEqual(classicRemoveMain(subject))
    })

    test('remove an alternate takes only that row', () => {
        const subject = makeSubject()
        const mine = applyTo(subject, build(buildPortraitRemove(0, readerOf(subject))))
        const classic = installSubject(plain(subject))
        classic.ccAssets?.splice(0, 1)
        expect(plain(mine)).toEqual(plain(classic))
    })
})

describe('refusals of the builders', () => {
    const subject = makeSubject()
    const refused = (result: { ok: boolean }): boolean => result.ok === false

    test('an unreadable portrait or a reader without a portrait refuses every intent', () => {
        const noPortrait: LiveReader = { field: () => ({ had: false }), greetings: () => null, fmIndex: () => null }
        const unreadable: LiveReader = { ...readerOf(subject), portrait: () => null }
        for (const reader of [noPortrait, unreadable]) {
            expect(refused(buildPortraitAdd(N, {}, reader))).toBe(true)
            expect(refused(buildPortraitMakeMain(0, reader))).toBe(true)
            expect(refused(buildPortraitRemove('main', reader))).toBe(true)
            expect(refused(buildPortraitRemove(0, reader))).toBe(true)
        }
    })

    test('an index outside the alternates, a make-main with none and a remove-main of an empty main refuse', () => {
        expect(refused(buildPortraitMakeMain(2, readerOf(subject)))).toBe(true)
        expect(refused(buildPortraitMakeMain(-1, readerOf(subject)))).toBe(true)
        expect(refused(buildPortraitMakeMain(0, readerOf(makeSubject({ ccAssets: undefined }))))).toBe(true)
        expect(refused(buildPortraitRemove(2, readerOf(subject)))).toBe(true)
        expect(refused(buildPortraitRemove('main', readerOf(makeSubject({ image: '' }))))).toBe(true)
        expect(refused(buildPortraitAdd('', {}, readerOf(subject)))).toBe(true)
    })

    test('every build is one portraitSet op with its own label', () => {
        expect(buildPortraitAdd(N, {}, readerOf(subject))).toMatchObject({ ok: true, label: { kind: 'portraitAdd' } })
        expect(buildPortraitMakeMain(0, readerOf(subject))).toMatchObject({ ok: true, label: { kind: 'portraitMain' } })
        expect(buildPortraitRemove('main', readerOf(subject))).toMatchObject({ ok: true, label: { kind: 'portraitRemove' } })
        expect(buildPortraitRemove(1, readerOf(subject))).toMatchObject({ ok: true, label: { kind: 'portraitRemove' } })
    })
})
