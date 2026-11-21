import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

// The reader imports the database module for its preset helpers; the stand-ins keep its reactive stores and the global
// API out of this guard, which reads a frozen file and writes nothing.
vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    selectedCharID: writable(-1),
    selIdState: { selId: -1 },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
    saveAsset: vi.fn(),
    readImage: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

import { classifyRtb } from 'src/ts/drive/rtb/rtbClassify'
import { verifyRtb } from 'src/ts/drive/rtb/rtbVerify'
import { readSettingsPayload } from 'src/ts/drive/rtb/settingsPayload'
import { rangeSourceOfBytes } from './sparseSource'
import { SETTINGS_GOLDEN_RECORDS, SETTINGS_GOLDEN_UI_PREFS } from './settingsGoldenInput'

// The run command's working directory is the repo root; RTB_GOLDENS_DIR points the guard at another directory of the same file names.
const GOLDEN_DIR = path.resolve(process.env.RTB_GOLDENS_DIR ?? path.join(process.cwd(), 'src/ts/drive/tests/rtbGoldens'))
const FILE = 'v1-settings-small.rtb'
const SHA256 = 'c0df5bc8e15ae80e51c2429987d9f1ac11c4a81b4f341500c0a8e4cc34ed2f23'
const SIZE = 1269

const golden = () => fs.readFileSync(path.join(GOLDEN_DIR, FILE))

describe('T16 (compatibility guard): the frozen settings-only golden', () => {
    test('the file equals the pinned SHA-256 and size, and the README repeats them, also from a CRLF copy', () => {
        const bytes = golden()
        expect(bytes.length).toBe(SIZE)
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(SHA256)
        const text = fs.readFileSync(path.join(GOLDEN_DIR, 'README.md'), 'utf8')
        for (const variant of [text, text.replace(/\r?\n/g, '\r\n')]) {
            expect(variant.split(/\r?\n/)).toContain(`SHA-256 ${FILE}: ${SHA256}`)
            expect(variant.split(/\r?\n/)).toContain(`Size ${FILE}: ${SIZE} bytes`)
        }
    })

    test('it classifies and verifies as settings, never as a whole backup', async () => {
        const source = rangeSourceOfBytes(golden())
        expect((await classifyRtb(source)).kind).toBe('settings')
        const verdict = await verifyRtb(source)
        expect(verdict.kind).toBe('settings')
        if (verdict.kind !== 'settings') {
            return
        }
        expect(verdict.verified.values).toEqual(SETTINGS_GOLDEN_RECORDS.map((record) => ({ key: record.key, value: record.value })))
        expect(verdict.verified.uiPrefs).toEqual(SETTINGS_GOLDEN_UI_PREFS.map((record) => ({ key: record.key, value: record.value })))
        expect(verdict.verified.taggedLines).toEqual([])
    })

    test('the reader carries the pinned values with nothing dropped', async () => {
        const verdict = await verifyRtb(rangeSourceOfBytes(golden()))
        if (verdict.kind !== 'settings') {
            throw new Error('the golden is not a settings file')
        }
        const read = readSettingsPayload(verdict.verified)
        if ('refused' in read) {
            throw new Error(read.refused)
        }
        expect(read.dropped).toBe(0)
        expect(read.fields).toMatchObject({ theme: 'waifu', zoomsize: 100, language: 'en', sendWithEnter: true, textTheme: 'standard' })
        expect(read.counts).toEqual({ fields: 6, presets: 2, memoryPresets: 1, translatorPresets: 1 })
        expect(read.selectionId).toBe('golden-b')
        expect(read.hypaSelectionId).toBe('golden-mem')
        expect(read.translatorSelection?.name).toBe('Golden translator')
        expect(read.uiPrefs).toEqual([{ key: 'risutanium.grid.sort', value: 'name' }])
    })
})
