// The Studio picker port: the classic extension lists, the extension re-check after the chooser, the size split and its
// one notice, the single-file portrait pick, and the busy kind of each pick. The chooser, the limit and the notice are
// injected, so nothing here opens a real chooser.
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('../../globalApi.svelte', () => ({ pickedAssetLimitBytes: vi.fn(async () => 1000) }))
vi.mock('../../util', () => ({ readPickedFileBytes: vi.fn(), selectMultipleFileObjects: vi.fn(), selectSingleFileObject: vi.fn() }))
vi.mock('../../storage/pickedAssetLimit', () => ({ reportRefusedAssets: vi.fn(), splitByAssetLimit: (files: { size: number }[], limit: number) => ({ within: files.filter((f) => f.size <= limit), refused: files.filter((f) => f.size > limit) }) }))

import { busyKinds, resetBusyActionsForTest } from '../../process/memory/busyActions'
import { beginPickBusy, extensionOfName, pickExtensions, pickFiles, type PickDeps } from './filePicker'

const file = (name: string, size = 10): File => ({ name, size }) as unknown as File

function deps(over: Partial<PickDeps> = {}): PickDeps & { reported: { names: string[]; limit: number }[] } {
    const reported: { names: string[]; limit: number }[] = []
    return {
        chooseSingle: async () => null,
        chooseMultiple: async () => null,
        limitBytes: async () => 1000,
        reportTooLarge: (refused, limit) => {
            if (refused.length > 0) reported.push({ names: refused.map((f) => f.name), limit })
        },
        reported,
        ...over,
    }
}

afterEach(() => resetBusyActionsForTest())

describe('the extension lists are the classic pickers\'', () => {
    test('portrait, emotion and asset', () => {
        expect([...pickExtensions('portrait')]).toEqual(['png', 'webp', 'gif', 'jpg', 'jpeg'])
        expect([...pickExtensions('emotion')]).toEqual(['png', 'webp', 'gif'])
        expect([...pickExtensions('asset')]).toEqual(['png', 'webp', 'mp4', 'mp3', 'gif', 'jpeg', 'jpg', 'ttf', 'otf', 'css', 'webm', 'woff', 'woff2', 'svg', 'avif'])
    })

    test('the extension of a name is its last dot segment in lower case', () => {
        expect(extensionOfName('Photo.PNG')).toBe('png')
        expect(extensionOfName('a.b.webp')).toBe('webp')
        expect(extensionOfName('noext')).toBe('')
    })
})

describe('pickFiles', () => {
    test('a portrait pick offers one file to the single chooser and returns it', async () => {
        const single = vi.fn(async (_extensions: readonly string[]) => file('a.png'))
        const result = await pickFiles('portrait', deps({ chooseSingle: single }))
        expect(single).toHaveBeenCalledWith(pickExtensions('portrait'))
        expect(result).toMatchObject({ kind: 'picked', files: [{ name: 'a.png' }], badType: [], tooLarge: [] })
    })

    test('a cancelled chooser, single or several, is cancelled and reports nothing', async () => {
        const d = deps()
        expect(await pickFiles('portrait', d)).toEqual({ kind: 'cancelled' })
        expect(await pickFiles('emotion', d)).toEqual({ kind: 'cancelled' })
        expect(await pickFiles('asset', deps({ chooseMultiple: async () => [] }))).toEqual({ kind: 'cancelled' })
        expect(d.reported).toEqual([])
    })

    test('a file the chooser let through with another extension is refused for its type, and the rest are kept in order', async () => {
        const result = await pickFiles('emotion', deps({ chooseMultiple: async () => [file('a.png'), file('b.bmp'), file('c.GIF'), file('d')] }))
        if (result.kind !== 'picked') throw new Error('cancelled')
        expect(result.files.map((f) => f.name)).toEqual(['a.png', 'c.GIF'])
        expect(result.badType.map((f) => f.name)).toEqual(['b.bmp', 'd'])
    })

    test('a file above the limit is refused for its size and reported once with the limit; a file of exactly the limit is kept', async () => {
        const d = deps({ chooseMultiple: async () => [file('ok.png', 1000), file('big.png', 1001), file('huge.webp', 5000)] })
        const result = await pickFiles('emotion', d)
        if (result.kind !== 'picked') throw new Error('cancelled')
        expect(result.files.map((f) => f.name)).toEqual(['ok.png'])
        expect(result.tooLarge.map((f) => f.name)).toEqual(['big.png', 'huge.webp'])
        expect(d.reported).toEqual([{ names: ['big.png', 'huge.webp'], limit: 1000 }])
    })

    test('a file of a refused type is not counted against the size limit', async () => {
        const d = deps({ chooseSingle: async () => file('big.bmp', 99_999) })
        const result = await pickFiles('portrait', d)
        expect(result).toMatchObject({ kind: 'picked', files: [], tooLarge: [] })
        expect(d.reported).toEqual([])
    })
})

describe('the busy entry of a pick', () => {
    test.each([
        ['portrait', 'charImage'],
        ['emotion', 'charEmotion'],
        ['asset', 'assetAdd'],
    ] as const)('%s is registered as %s until it ends', (kind, busy) => {
        const handle = beginPickBusy(kind)
        expect(busyKinds()).toEqual([busy])
        handle.end()
        expect(busyKinds()).toEqual([])
    })
})
