import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

const transport = vi.hoisted(() => ({ android: true, stat: vi.fn() }))

vi.mock('../tauriByteTransport', () => ({
    isAndroidTransport: () => transport.android,
    statStoredSize: (key: string) => transport.stat(key),
}))

import {
    ANDROID_LIST_WHOLE_READ_BUDGET_BYTES,
    ANDROID_WHOLE_READ_URL_LIMIT_BYTES,
    androidAssetSizeVerdict,
    androidWithholdsUrl,
    assetListElement,
    assetListUse,
    createWholeReadBudget,
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

// Unit tests of the new budget: on a base without it they fail only by the missing export, so they are not reproducers.
// The reproducers are the list tests and the getFileSrc ordering test.
describe('the whole-read budget of a list', () => {
    const MIB = 1024 * 1024

    function sizes(table: Record<string, number>): void {
        transport.stat.mockImplementation(async (key: string) => table[key] ?? -1)
    }

    test('the default budget is 64 MiB', () => {
        expect(ANDROID_LIST_WHOLE_READ_BUDGET_BYTES).toBe(64 * MIB)
    })

    test('the admitted sum never exceeds the budget, and a size exactly at the budget is admitted', async () => {
        sizes({ a: 32 * MIB, b: 32 * MIB, c: 1 })
        const budget = createWholeReadBudget()

        expect(await budget.admit('a')).toBe(true)
        expect(await budget.admit('b')).toBe(true)
        expect(await budget.admit('c')).toBe(false)
    })

    test('a refused key does not use up the budget', async () => {
        sizes({ a: 40 * MIB, b: 40 * MIB, c: 24 * MIB })
        const budget = createWholeReadBudget()

        expect(await budget.admit('a')).toBe(true)
        expect(await budget.admit('b')).toBe(false)
        expect(await budget.admit('c')).toBe(true)
    })

    test('admissions are decided in call order when the sizes arrive in reverse order', async () => {
        const settle = new Map<string, (size: number) => void>()
        transport.stat.mockImplementation((key: string) => new Promise<number>((resolve) => { settle.set(key, resolve) }))
        const budget = createWholeReadBudget()

        const first = budget.admit('a')
        const second = budget.admit('b')
        settle.get('b')?.(40 * MIB)
        await new Promise((resolve) => setTimeout(resolve, 0))
        settle.get('a')?.(40 * MIB)

        expect([await first, await second]).toEqual([true, false])
    })

    test('a size over the per-file limit is refused and not counted', async () => {
        sizes({ big: LIMIT + 1, small: 60 * MIB })
        const budget = createWholeReadBudget()

        expect(await budget.admit('big')).toBe(false)
        expect(await budget.admit('small')).toBe(true)
    })

    test('a repeated key counts each time', async () => {
        sizes({ k: 40 * MIB })
        const budget = createWholeReadBudget()

        expect(await budget.admit('k')).toBe(true)
        expect(await budget.admit('k')).toBe(false)
    })

    test('an unreadable size is refused, admit never rejects, and the next admission still works', async () => {
        // 'bad' rejects; 'sync' throws before it returns a promise.
        transport.stat.mockImplementation((key: string) => {
            if (key === 'bad') {
                return Promise.reject(new Error('missing (os error 2)'))
            }
            if (key === 'sync') {
                throw new Error('thrown at once')
            }
            return Promise.resolve(10 * MIB)
        })
        const budget = createWholeReadBudget()

        await expect(budget.admit('bad')).resolves.toBe(false)
        await expect(budget.admit('sync')).resolves.toBe(false)
        await expect(budget.admit('good')).resolves.toBe(true)
    })

    test('guard: off the Android transport every key is admitted and no size is asked', async () => {
        transport.android = false
        const budget = createWholeReadBudget(1)

        expect(await budget.admit('a')).toBe(true)
        expect(await budget.admit('b')).toBe(true)
        expect(transport.stat).not.toHaveBeenCalled()
    })

    test('each budget counts for itself', async () => {
        sizes({ a: 60 * MIB })

        expect(await createWholeReadBudget().admit('a')).toBe(true)
        expect(await createWholeReadBudget().admit('a')).toBe(true)
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
