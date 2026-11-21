import { describe, expect, it } from 'vitest'
import { createVaultNotifier, type NoticeStorage } from '../vaultNotifier'

function memoryStorage(): NoticeStorage & { data: Map<string, string> } {
    const data = new Map<string, string>()
    return {
        data,
        getItem: (key) => data.get(key) ?? null,
        setItem: (key, value) => { data.set(key, value) },
        removeItem: (key) => { data.delete(key) },
    }
}

function make() {
    const storage = memoryStorage()
    const shown: string[] = []
    const notify = createVaultNotifier(storage, (message) => shown.push(message), {
        keepPlain: () => 'keep-plain',
        needsReentry: (names) => `reentry:${names}`,
    })
    return { storage, shown, notify }
}

describe('vault notice cadence', () => {
    it('T17 the keep-plain notice shows once until a wrap succeeds', () => {
        const { shown, notify } = make()
        notify.keepPlain()
        notify.keepPlain()
        expect(shown).toEqual(['keep-plain'])
        notify.wrapped()
        notify.keepPlain()
        expect(shown).toEqual(['keep-plain', 'keep-plain'])
    })

    it('T20 the re-entry notice shows only when the flagged set changes, and again after the set empties', () => {
        const { shown, notify } = make()
        notify.reentry([{ id: 'b', name: 'B' }, { id: 'a', name: 'A' }])
        notify.reentry([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }])
        expect(shown).toEqual(['reentry:B, A'])
        notify.reentry([{ id: 'a', name: 'A' }])
        expect(shown).toHaveLength(2)
        notify.reentry([])
        notify.reentry([{ id: 'a', name: 'A' }])
        expect(shown).toHaveLength(3)
    })

    it('storage failures never throw', () => {
        const broken: NoticeStorage = {
            getItem: () => { throw new Error('denied') },
            setItem: () => { throw new Error('denied') },
            removeItem: () => { throw new Error('denied') },
        }
        const shown: string[] = []
        const notify = createVaultNotifier(broken, (m) => shown.push(m), { keepPlain: () => 'k', needsReentry: () => 'r' })
        expect(() => { notify.keepPlain(); notify.wrapped(); notify.reentry([{ id: 'a', name: 'A' }]) }).not.toThrow()
    })
})
