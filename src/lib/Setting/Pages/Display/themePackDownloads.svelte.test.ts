/**
 * I-1: the two downloadable packs in theme-packs/ go through the real install flow (real intake, real judge, real install
 * transaction) and install: one archive write whose bytes are the pack, a record with the manifest fonts, modes and the tile
 * colours the built-in tile shows, and the skipped-areas line. A compatibility guard: the asset store is a stand-in, so a
 * mocked success is not evidence about a native store. The packs are the shipped bytes read with node:fs.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import type { Database } from 'src/ts/storage/database.svelte'
import { resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'
import { resetRestoreInProgressForTests } from 'src/ts/drive/restoreInProgress'
import { builtinPackById } from 'src/ts/themePack/builtins'
import { judgePackSheets } from 'src/ts/themePack'
import { installThemePack } from 'src/ts/themePack/install'
import { intakePackBytes, type PackJudge } from 'src/ts/themePack/intake'

//#region module mocks

const world = vi.hoisted(() => ({
    files: new Map<string, Uint8Array>(),
    log: [] as string[],
    requestSaveNow: vi.fn(),
}))

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => { }), removeItem: vi.fn(async () => { }) }) },
}))
vi.mock(import('src/ts/alert'), () => ({
    alertConfirm: vi.fn(async () => true),
    alertNormal: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/util'), () => ({
    selectSingleFileObject: vi.fn(async () => null),
    readPickedFileBytes: vi.fn(),
}) as unknown as typeof import('src/ts/util'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    requestSaveNow: world.requestSaveNow,
    saveAsset: vi.fn(async (data: Uint8Array, customId = '', fileName = '') => {
        const key = `assets/${customId}.${fileName.split('.').pop()}`
        world.log.push(`write:${key}`)
        world.files.set(key, data.slice())
        return key
    }),
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: async () => ({
        read: async (key: string) => ({ bytes: world.files.get(key) ?? null }),
    }),
    pageStoreIsOpfsTransitional: async () => false,
}) as unknown as typeof import('src/ts/storage/store/appStore'))
vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return { DBState: state } as unknown as typeof import('src/ts/stores.svelte')
})

//#endregion

import { DBState } from 'src/ts/stores.svelte'
import {
    attachRow, installFlowState, resetThemePackInstallFlowForTests, runThemePackInstall, type InstallFlowDeps,
} from './themePackInstallFlow.svelte'

const realJudge: PackJudge = async (sheets) => judgePackSheets(sheets)

const FONT_LICENSE = 'SIL Open Font License, Version 1.1 (the full text is fonts/OFL.txt)'

const PACKS = [
    { slug: 'scratch-white', file: 'scratch-white.risutheme', name: 'Scratch White', fontFiles: ['fonts/NanumPenScript-Regular.ttf'] },
    { slug: 'office-sheet', file: 'office-sheet.risutheme', name: 'Office Sheet', fontFiles: [] as string[] },
] as const

function packBytes(file: string): Uint8Array {
    // The run starts at the repository root; import.meta.url is not a file URL in this environment.
    return new Uint8Array(readFileSync(join(process.cwd(), 'theme-packs', file)))
}

function runOf(bytes: Uint8Array): { deps: Partial<InstallFlowDeps>, confirm: ReturnType<typeof vi.fn<(message: string) => Promise<boolean>>>, notify: ReturnType<typeof vi.fn<(message: string) => void>> } {
    const notify = vi.fn<(message: string) => void>()
    const confirm = vi.fn<(message: string) => Promise<boolean>>(async () => true)
    const deps: Partial<InstallFlowDeps> = {
        pickFile: async () => ({ name: 'pack.risutheme', size: bytes.length } as unknown as File),
        readFile: async () => bytes,
        intake: (verified) => intakePackBytes(verified, realJudge),
        install: installThemePack,
        confirm,
        notify,
    }
    return { deps, confirm, notify }
}

let detachRow: (() => void) | null = null

beforeEach(() => {
    DBState.db = {} as unknown as Database
    world.files.clear()
    world.log.length = 0
    world.requestSaveNow.mockClear()
    resetBusyActionsForTest()
    resetRestoreInProgressForTests()
    resetThemePackInstallFlowForTests()
    detachRow = attachRow()
})

afterEach(() => {
    detachRow?.()
    detachRow = null
    resetBusyActionsForTest()
    resetRestoreInProgressForTests()
    resetThemePackInstallFlowForTests()
})

describe('I-1 the downloadable packs install through the real install flow', () => {
    for (const pack of PACKS) {
        test(`${pack.file}: one archive write equal to the pack, the record and the outcome lines`, async () => {
            const bytes = packBytes(pack.file)
            const { deps, confirm, notify } = runOf(bytes)

            await runThemePackInstall(deps)

            const key = `assets/tp-${createHash('sha256').update(bytes).digest('hex')}.risutheme`
            expect(world.log).toEqual([`write:${key}`])
            expect(world.files.get(key)).toEqual(bytes)

            const stored = DBState.db.themePacks
            expect(Array.isArray(stored) ? stored : []).toHaveLength(1)
            const record = $state.snapshot((stored as unknown[])[0]) as Record<string, unknown>
            const builtin = builtinPackById(`builtin:${pack.slug}`)
            expect(builtin).not.toBeNull()
            expect(record).toMatchObject({
                v: 1,
                packId: `risutanium.${pack.slug}`,
                name: pack.name,
                version: '1.0.0',
                license: 'GPL-3.0',
                attribution: 'RisuTanium contributors',
                modes: ['light'],
                archive: key,
                bytes: bytes.length,
                mainColor: builtin?.mainColor,
                secondaryColor: builtin?.secondaryColor,
            })
            expect((record.fonts as { file: string, license: string }[]).map((font) => [font.file, font.license]))
                .toEqual(pack.fontFiles.map((file) => [file, FONT_LICENSE]))
            expect(installFlowState.outcome === null ? null : [...installFlowState.outcome.lines])
                .toEqual([language.themePackInstalled(pack.name), language.themePackSkippedAreas('home.css, settings.css, studio.css')])
            expect(confirm).not.toHaveBeenCalled()
            expect(notify).not.toHaveBeenCalled()
        })
    }
})
