import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

const transport = vi.hoisted(() => ({ android: true, stat: vi.fn() }))

vi.mock('../tauriByteTransport', () => ({
    isAndroidTransport: () => transport.android,
    statStoredSize: (key: string) => transport.stat(key),
}))

import {
    ANDROID_WHOLE_READ_URL_LIMIT_BYTES,
    androidAssetSizeVerdict,
    androidWithholdsUrl,
    assetListElement,
    assetListUse,
    forgetStoredAssetSizes,
    resetAssetUrlGateForTest,
    rowAssetUrl,
    storeRowAssetUrl,
} from '../assetUrlGate'

const LIMIT = ANDROID_WHOLE_READ_URL_LIMIT_BYTES

beforeEach(() => {
    transport.android = true
    transport.stat.mockReset()
    resetAssetUrlGateForTest()
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('the size decision', () => {
    test('the limit is 64 MiB, and only a size above it is over', async () => {
        expect(LIMIT).toBe(64 * 1024 * 1024)
        transport.stat.mockImplementation(async (key: string) => ({ zero: 0, one: 1, edge: LIMIT, over: LIMIT + 1 })[key] ?? -1)

        expect(await androidAssetSizeVerdict('zero')).toBe('within')
        expect(await androidAssetSizeVerdict('one')).toBe('within')
        expect(await androidAssetSizeVerdict('edge')).toBe('within')
        expect(await androidAssetSizeVerdict('over')).toBe('over')
    })

    test('a media use is never withheld and asks no size; a whole use over the limit is withheld', async () => {
        transport.stat.mockResolvedValue(1024 * 1024 * 1024)

        expect(await androidWithholdsUrl('big', 'media')).toBe(false)
        expect(transport.stat).not.toHaveBeenCalled()
        expect(await androidWithholdsUrl('big', 'whole')).toBe(true)
    })

    test('guard: off the Android transport nothing is withheld and no size is asked', async () => {
        transport.android = false
        transport.stat.mockResolvedValue(1024 * 1024 * 1024)

        expect(await androidAssetSizeVerdict('big')).toBe('within')
        expect(await androidWithholdsUrl('big', 'whole')).toBe(false)
        expect(transport.stat).not.toHaveBeenCalled()
    })
})

describe('the size cache', () => {
    test('concurrent callers share one probe, and the size is kept afterwards', async () => {
        let resolveSize: (size: number) => void = () => {}
        transport.stat.mockReturnValue(new Promise<number>((resolve) => { resolveSize = resolve }))

        const first = androidAssetSizeVerdict('k')
        const second = androidAssetSizeVerdict('k')
        resolveSize(LIMIT + 1)

        expect(await first).toBe('over')
        expect(await second).toBe('over')
        expect(await androidAssetSizeVerdict('k')).toBe('over')
        expect(transport.stat).toHaveBeenCalledTimes(1)
    })

    test('a release makes the next call probe again', async () => {
        transport.stat.mockResolvedValueOnce(1)
        transport.stat.mockResolvedValueOnce(LIMIT + 1)

        expect(await androidAssetSizeVerdict('k')).toBe('within')
        forgetStoredAssetSizes(['k'])

        expect(await androidAssetSizeVerdict('k')).toBe('over')
        expect(transport.stat).toHaveBeenCalledTimes(2)
    })

    test('a probe still running when its key is released does not write its stale size back', async () => {
        let resolveOld: (size: number) => void = () => {}
        transport.stat.mockReturnValueOnce(new Promise<number>((resolve) => { resolveOld = resolve }))
        transport.stat.mockResolvedValueOnce(LIMIT + 1)

        const old = androidAssetSizeVerdict('k')
        forgetStoredAssetSizes(['k'])
        resolveOld(1)
        expect(await old).toBe('within')

        expect(await androidAssetSizeVerdict('k')).toBe('over')
        expect(transport.stat).toHaveBeenCalledTimes(2)
    })
})

describe('a probe failure', () => {
    test('withholds a whole use, is not cached, and is probed again', async () => {
        transport.stat.mockRejectedValueOnce(new Error('missing (os error 2)'))
        transport.stat.mockRejectedValueOnce(new Error('missing (os error 2)'))
        transport.stat.mockResolvedValue(LIMIT + 1)

        expect(await androidAssetSizeVerdict('k')).toBe('unknown')
        expect(await androidWithholdsUrl('k', 'whole')).toBe(true)
        expect(await androidWithholdsUrl('k', 'whole')).toBe(true)
        expect(transport.stat).toHaveBeenCalledTimes(3)
    })

    test('is logged once per key, and again for another key', async () => {
        transport.stat.mockRejectedValue(new Error('refused'))

        await androidAssetSizeVerdict('k')
        await androidAssetSizeVerdict('k')
        await androidAssetSizeVerdict('k')
        expect(console.error).toHaveBeenCalledTimes(1)

        await androidAssetSizeVerdict('other')
        expect(console.error).toHaveBeenCalledTimes(2)
    })

    test('a file missing at first and small later gets a within verdict later', async () => {
        transport.stat.mockRejectedValueOnce(new Error('missing (os error 2)'))
        transport.stat.mockResolvedValue(10)

        expect(await androidAssetSizeVerdict('k')).toBe('unknown')
        expect(await androidAssetSizeVerdict('k')).toBe('within')
    })
})

describe('what a list row renders', () => {
    test.each([
        ['mp4', 'video', 'media'],
        ['MP4', 'video', 'media'],
        ['mp3', 'audio', 'media'],
        ['Mp3', 'audio', 'media'],
        ['mov', 'icon', null],
        ['WAV', 'icon', null],
        ['webm', 'icon', null],
        ['ogg', 'icon', null],
        ['png', 'image', 'whole'],
        ['PNG', 'image', 'whole'],
        ['avif', 'image', 'whole'],
        ['svg', 'image', 'whole'],
        ['', 'image', 'whole'],
        [undefined, 'image', 'whole'],
    ] as const)('%s renders as %s and requests a %s URL', (ext, element, use) => {
        expect(assetListElement(ext)).toBe(element)
        expect(assetListUse(assetListElement(ext))).toBe(use)
    })

    test.each([
        ['png', 'image'],
        ['JPG', 'image'],
        ['webp', 'image'],
        ['avif', 'none'],
        ['mov', 'none'],
        ['mp4', 'video'],
        ['MP3', 'audio'],
    ] as const)('with known images only, %s renders as %s', (ext, element) => {
        expect(assetListElement(ext, { knownImagesOnly: true })).toBe(element)
        expect(assetListUse('none')).toBeNull()
    })
})

describe('the URL of a list row', () => {
    const entry = { path: 'assets/a', use: 'whole' as const, url: 'src:a' }

    test('is shown only for the path and use it was made for', () => {
        expect(rowAssetUrl(entry, 'assets/a', 'whole')).toBe('src:a')
        expect(rowAssetUrl(entry, 'assets/b', 'whole')).toBeUndefined()
        expect(rowAssetUrl(entry, 'assets/a', 'media')).toBeUndefined()
        expect(rowAssetUrl(entry, 'assets/a', null)).toBeUndefined()
        expect(rowAssetUrl(entry, undefined, 'whole')).toBeUndefined()
        expect(rowAssetUrl(undefined, 'assets/a', 'whole')).toBeUndefined()
    })

    test('a withheld URL (empty) is kept distinct from none', () => {
        expect(rowAssetUrl({ ...entry, url: '' }, 'assets/a', 'whole')).toBe('')
    })

    test('a late resolution is stored only while the row still names its path and use', () => {
        const entries: (typeof entry | undefined)[] = []

        storeRowAssetUrl(entries, 0, entry, 'assets/b', 'whole')
        storeRowAssetUrl(entries, 0, entry, 'assets/a', 'media')
        expect(entries[0]).toBeUndefined()

        storeRowAssetUrl(entries, 0, entry, 'assets/a', 'whole')
        expect(entries[0]).toBe(entry)
    })
})
