/**
 * `repairModuleLorebook` (`src/ts/process/moduleLorebookRepair.ts`): the boot-time lorebook repair of one module body,
 * moved out of `checkNewFormat` so a loader can run it when a body enters its slot. Uses the real function and the real
 * `acquireModule`; `updateLorebooks` is replaced by a recording copy of its migration (the real module's import graph is
 * not loaded); the alert functions are deferred promises the test answers one at a
 * time. The loader in the contract tests is a test double. Titles beginning "guard:" pin behaviour that must be
 * preserved; titles beginning "contract:" document what a loader must do around the function.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { MODULE_STUB_KEY, MODULE_STUB_VALUE } from 'src/ts/storage/moduleStub'
import type { RisuModule } from 'src/ts/process/modules'

const h = vi.hoisted(() => ({
    events: [] as string[],
    waiting: [] as { kind: string, resolve: (value: boolean) => void }[],
    db: { modules: [] as unknown[] },
}))

vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn((msg: string) => { h.events.push(`error:${msg}`) }),
    alertMd: vi.fn((msg: string) => { h.events.push(`md:${msg}`) }),
    waitAlert: vi.fn(() => new Promise<void>((resolve) => {
        h.events.push('wait')
        h.waiting.push({ kind: 'wait', resolve: () => resolve() })
    })),
    alertConfirm: vi.fn((msg: string) => new Promise<boolean>((resolve) => {
        h.events.push(`confirm:${msg}`)
        h.waiting.push({ kind: 'confirm', resolve })
    })),
}) as unknown as typeof import('src/ts/alert'))

const migrate = vi.hoisted(() => vi.fn((book: { bookVersion?: number, content: string }[]) => book.map((v) => {
    if ((v.bookVersion ?? 1) >= 2) {
        return v
    }
    v.content = v.content.replace(/@@@?end/g, '@@depth 0').replace(/<(user)>/g, '{{user}}')
    v.bookVersion = 2
    return v
})))

vi.mock(import('src/ts/characters'), () => ({
    updateLorebooks: migrate,
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: h,
}) as unknown as typeof import('src/ts/stores.svelte'))

import { lorebookRepairNeed, repairModuleLorebook } from 'src/ts/process/moduleLorebookRepair'
import { acquireModule, registerModuleLoader, unregisterModuleLoader } from 'src/ts/storage/store2/moduleAcquire'
import { language } from 'src/lang'

const tick = async () => { for (let i = 0; i < 20; i++) { await Promise.resolve() } }

/** Answers the oldest pending alert (a wait resolves, a confirm takes `answer`) and lets the repair run on. */
async function answer(answer = false): Promise<string> {
    await tick()
    const next = h.waiting.shift()
    if (!next) {
        throw new Error('no alert is waiting')
    }
    next.resolve(answer)
    await tick()
    return next.kind
}

function lore(content: string, bookVersion?: number) {
    return { comment: 'c', content, key: 'k', alwaysActive: false, secondkey: '', selective: false, insertorder: 100, mode: 'normal', bookVersion }
}

function body(name: string, lorebook: unknown): RisuModule {
    return { id: `id-${name}`, name, description: '', lorebook } as unknown as RisuModule
}

const errorEvents = () => h.events.filter((e) => e.startsWith('error:'))

beforeEach(() => {
    h.events.length = 0
    h.waiting.length = 0
    migrate.mockClear()
    h.db.modules = []
    unregisterModuleLoader()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('repairModuleLorebook migration', () => {
    test('repair-no-assign-when-clean: an already migrated lorebook is left as the same array and reported unchanged', async () => {
        const book = [lore('a', 2), lore('b', 3)]
        const module = body('M', book)
        const result = await repairModuleLorebook(module)
        expect(result).toEqual({ changed: false })
        expect(module.lorebook).toBe(book)
        expect(migrate).not.toHaveBeenCalled()
    })

    test('repair-no-assign-when-clean: an empty lorebook, a missing lorebook and a missing body are unchanged', async () => {
        const empty = body('E', [])
        const emptyBook = empty.lorebook
        expect(await repairModuleLorebook(empty)).toEqual({ changed: false })
        expect(empty.lorebook).toBe(emptyBook)
        expect(await repairModuleLorebook(body('N', undefined))).toEqual({ changed: false })
        expect(await repairModuleLorebook(null)).toEqual({ changed: false })
    })

    test('repair-migrates-when-needed: an entry below version 2 is migrated through updateLorebooks and assigned', async () => {
        const entries = [lore('<user> @@end', undefined), lore('kept', 2)]
        const module = body('M', entries)
        const result = await repairModuleLorebook(module)
        expect(result).toEqual({ changed: true })
        expect(migrate).toHaveBeenCalledTimes(1)
        expect(migrate).toHaveBeenCalledWith(entries)
        expect(module.lorebook).toBe(migrate.mock.results[0].value)
        expect(module.lorebook).toEqual([
            expect.objectContaining({ content: '{{user}} @@depth 0', bookVersion: 2 }),
            expect.objectContaining({ content: 'kept', bookVersion: 2 }),
        ])
    })

    test('guard: a migration that throws rejects and leaves the lorebook as it was', async () => {
        const entries = [lore('a', 1)]
        const module = body('M', entries)
        migrate.mockImplementationOnce(() => { throw new Error('entry is not an object') })
        await expect(repairModuleLorebook(module)).rejects.toThrow('entry is not an object')
        expect(module.lorebook).toBe(entries)
    })
})

describe('repairModuleLorebook corrupted lorebook', () => {
    test('guard: repair-texts-and-answers-unchanged: yes resets to an empty list and reports changed', async () => {
        const module = body('Broken', 'text')
        const pending = repairModuleLorebook(module)
        await tick()
        expect(h.events[0]).toBe(`error:${language.bootstrap.dataCorruptionDetected('Broken', 'string')}`)
        expect(await answer()).toBe('wait')
        expect(h.events[2]).toBe(`confirm:${language.bootstrap.reportErrorQuestion}`)
        expect(await answer(false)).toBe('confirm')
        expect(h.events[3]).toBe(`confirm:${language.bootstrap.resetLorebookQuestion}`)
        expect(await answer(true)).toBe('confirm')
        expect(await pending).toEqual({ changed: true })
        expect(module.lorebook).toEqual([])
    })

    test('guard: repair-texts-and-answers-unchanged: no keeps the value and reports unchanged', async () => {
        const module = body('Broken', { a: 1 })
        const pending = repairModuleLorebook(module)
        await answer()
        await answer(false)
        await answer(false)
        expect(await pending).toEqual({ changed: false })
        expect(module.lorebook).toEqual({ a: 1 })
    })

    test('guard: repair-texts-and-answers-unchanged: the report path shows the diagnostics', async () => {
        const module = body('', 'text')
        const pending = repairModuleLorebook(module)
        await answer()
        await answer(true)
        const md = h.events.find((e) => e.startsWith('md:'))
        expect(md).toBeDefined()
        expect(md).toContain('"moduleName": "Unknown"')
        expect(md).toContain('"lorebookType": "string"')
        await answer()
        await answer(false)
        expect(await pending).toEqual({ changed: false })
    })

    test('guard: the diagnostics carry the passed format version, and Unknown without one', async () => {
        for (const [context, shown] of [[{ formatVersion: 7 }, '"formatVersion": 7'], [undefined, '"formatVersion": "Unknown"']] as const) {
            h.events.length = 0
            const pending = repairModuleLorebook(body('M', 'text'), context)
            await answer()
            await answer(true)
            expect(h.events.find((e) => e.startsWith('md:'))).toContain(shown)
            await answer()
            await answer(false)
            await pending
        }
    })

    test('repair-asks-serialised: the second module is not asked about until the first module is answered', async () => {
        const first = body('First', 'text')
        const second = body('Second', 'text')
        const pendingFirst = repairModuleLorebook(first)
        const pendingSecond = repairModuleLorebook(second)
        await tick()
        expect(errorEvents()).toHaveLength(1)
        await answer()
        await answer(false)
        expect(errorEvents()).toHaveLength(1)
        await answer(true)
        await pendingFirst
        await tick()
        expect(errorEvents()).toHaveLength(2)
        expect(errorEvents()[1]).toContain('Second')
        expect(first.lorebook).toEqual([])
        expect(second.lorebook).toBe('text')
        await answer()
        await answer(false)
        await answer(false)
        expect(await pendingSecond).toEqual({ changed: false })
    })
})

describe('what a loader must do around repairModuleLorebook', () => {
    function stubSlot(id: string): RisuModule {
        return { id, name: `${id} name`, unit: [`unit-${id}`], al: [], il: [], [MODULE_STUB_KEY]: MODULE_STUB_VALUE } as unknown as RisuModule
    }

    const slotIsStub = () => Object.hasOwn(h.db.modules[0] as object, MODULE_STUB_KEY)

    /** The loader double: judges the body, then installs it. */
    function installLoader(): void {
        registerModuleLoader(async () => {
            const loaded = body('Broken', 'text')
            loaded.id = 'A'
            await repairModuleLorebook(loaded)
            h.db.modules[0] = loaded
            return loaded
        })
    }

    test('contract: slot-stays-stub-during-ask: the slot is a stub while the ask is pending', async () => {
        h.db.modules = [stubSlot('A')]
        installLoader()
        const acquiring = acquireModule('A')
        await tick()
        expect(errorEvents()).toHaveLength(1)
        expect(slotIsStub()).toBe(true)
        await answer()
        await answer(false)
        expect(slotIsStub()).toBe(true)
        await answer(false)
        const acquired = await acquiring
        expect(acquired?.module.lorebook).toBe('text')
        expect(slotIsStub()).toBe(false)
    })

    test('contract: acquire-resolves-after-judgement: acquireModule resolves only after the last answer', async () => {
        h.db.modules = [stubSlot('A')]
        installLoader()
        let resolved = false
        const acquiring = acquireModule('A').then((value) => { resolved = true; return value })
        await tick()
        await answer()
        await answer(false)
        await tick()
        expect(resolved).toBe(false)
        await answer(true)
        const acquired = await acquiring
        expect(resolved).toBe(true)
        expect(acquired?.module.lorebook).toEqual([])
    })
})

describe('lorebookRepairNeed judges from the body alone, and the repair follows the same decision', () => {
    const bodies: Array<[label: string, make: () => RisuModule | null | undefined, need: 'none' | 'migrate' | 'ask']> = [
        ['no body', () => null, 'none'],
        ['no lorebook', () => body('N', undefined), 'none'],
        ['an empty list', () => body('E', []), 'none'],
        ['a current list', () => body('C', [lore('a', 2), lore('b', 3)]), 'none'],
        ['a list with an entry below version 2', () => body('M', [lore('a', 2), lore('b', undefined)]), 'migrate'],
        ['a string', () => body('S', 'text'), 'ask'],
        ['an object', () => body('O', { a: 1 }), 'ask'],
        ['a number', () => body('Q', 7), 'ask'],
    ]

    test.each(bodies)('contract: judge-names-the-repair: %s', async (_label, make, need) => {
        const module = make()
        expect(lorebookRepairNeed(module)).toBe(need)
    })

    test.each(bodies)('contract: judge-is-pure: %s is judged without a notice, a prompt or a change', async (_label, make) => {
        const module = make()
        const before = JSON.stringify(module)
        lorebookRepairNeed(module)
        expect(h.events).toEqual([])
        expect(migrate).not.toHaveBeenCalled()
        expect(JSON.stringify(module)).toBe(before)
    })

    test('contract: repair-follows-judge: only a body judged ask shows a notice, and only a body judged migrate migrates', async () => {
        for (const [, make, need] of bodies) {
            h.events.length = 0
            h.waiting.length = 0
            migrate.mockClear()
            const module = make()
            const pending = repairModuleLorebook(module)
            await tick()
            expect(h.events.some((event) => event.startsWith('error:')), `${need} shows a notice`).toBe(need === 'ask')
            expect(migrate.mock.calls.length, `${need} migrates`).toBe(need === 'migrate' ? 1 : 0)
            if (need === 'ask') {
                await answer()
                await answer(false)
                await answer(false)
            }
            expect(await pending).toEqual({ changed: need === 'migrate' })
        }
    })
})
