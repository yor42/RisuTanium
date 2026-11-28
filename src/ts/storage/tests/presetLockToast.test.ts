import { beforeEach, describe, expect, test, vi } from 'vitest'

// Compatibility guards for the stage 4 switch feedback: `postKeptGroupsToast` names the locked groups once and stays
// silent without a lock, and `useInChats` posts it on a real switch only. MOCKED: the stores module (a plain database),
// `changeToPreset`, the toast host (a spy) and the modules `presetListActions` imports for other actions.

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
    changeToPreset: vi.fn<(index: number) => void>(),
    post: vi.fn<(init: unknown) => string>(() => 'id'),
}))

vi.mock('../../stores.svelte', () => ({
    DBState: { get db() { return h.db } },
}))
vi.mock('../database.svelte', () => ({ changeToPreset: h.changeToPreset, copyPreset: vi.fn() }))
vi.mock('../../toast/toastHost.svelte', () => ({ toastHost: { post: h.post } }))
vi.mock('../../alert', () => ({ alertConfirm: vi.fn(), alertError: vi.fn() }))
vi.mock('../../process/templates/templates', () => ({ prebuiltPresets: {} }))
vi.mock('../../studio/history/studioHistoryService.svelte', () => ({ beginOwnerVisit: vi.fn(), loadStudioHistoryService: vi.fn() }))

import { language } from '../../../lang'
import { postKeptGroupsToast } from '../presetLockToast'
import { useInChats } from '../../studio/presetListActions'

beforeEach(() => {
    h.post.mockClear()
    h.changeToPreset.mockClear()
    h.db = { botPresetsId: 0, botPresets: [{ id: 'a' }, { id: 'b' }] }
})

describe('postKeptGroupsToast', () => {
    test('posts one info toast naming the locked groups in registry order', () => {
        const db = { doNotChangeFallbackModels: true, presetFieldLocks: ['reasoning', 'sampling'] }
        postKeptGroupsToast(db)
        expect(h.post).toHaveBeenCalledTimes(1)
        const names = [language.presetLockFallbackModels, language.presetLockSampling, language.presetLockReasoning].join(', ')
        expect(h.post).toHaveBeenCalledWith({ kind: 'info', text: language.presetLockKept(names) })
    })

    test('posts nothing when no group is locked, also with an empty or foreign list', () => {
        postKeptGroupsToast({})
        postKeptGroupsToast({ doNotChangeSeperateModels: false, presetFieldLocks: [] })
        postKeptGroupsToast({ presetFieldLocks: ['futureGroup', 7] as unknown as string[] })
        expect(h.post).not.toHaveBeenCalled()
    })

    test('uses the injected post function instead of the toast host', () => {
        const own = vi.fn()
        postKeptGroupsToast({ doNotChangeSeperateModels: true }, own)
        expect(own).toHaveBeenCalledTimes(1)
        expect(h.post).not.toHaveBeenCalled()
    })
})

describe('useInChats', () => {
    test('a real switch with a lock posts the toast once, after the switch', () => {
        h.db.doNotChangeSeperateModels = true
        const order: string[] = []
        h.changeToPreset.mockImplementation(() => { order.push('switch') })
        h.post.mockImplementation(() => { order.push('toast'); return 'id' })
        expect(useInChats('b')).toEqual({ ok: true, id: 'b' })
        expect(h.changeToPreset).toHaveBeenCalledWith(1)
        expect(h.post).toHaveBeenCalledTimes(1)
        expect(order).toEqual(['switch', 'toast'])
    })

    test('the already active preset switches nothing and posts nothing', () => {
        h.db.doNotChangeSeperateModels = true
        expect(useInChats('a')).toEqual({ ok: true, id: 'a' })
        expect(h.changeToPreset).not.toHaveBeenCalled()
        expect(h.post).not.toHaveBeenCalled()
    })

    test('a real switch without a lock posts nothing', () => {
        useInChats('b')
        expect(h.changeToPreset).toHaveBeenCalledWith(1)
        expect(h.post).not.toHaveBeenCalled()
    })

    test('an unknown preset id switches nothing and posts nothing', () => {
        h.db.doNotChangeSeperateModels = true
        expect(useInChats('zzz')).toEqual({ ok: false, reason: 'gone' })
        expect(h.post).not.toHaveBeenCalled()
    })
})
