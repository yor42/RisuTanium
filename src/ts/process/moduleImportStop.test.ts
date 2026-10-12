/**
 * `ModuleImportStopped` and `confirmRisumLowLevel` in `src/ts/process/moduleImportStop.ts`: the leaf that
 * `dropImport.ts`, `characterCards.ts` and `modules.ts` share. Feature tests: the leaf did not exist before.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    prompts: [] as string[],
    answer: true,
}))

vi.mock(import('src/ts/alert'), () => ({
    alertConfirm: vi.fn(async (msg: string) => { h.prompts.push(msg); return h.answer }),
}) as unknown as typeof import('src/ts/alert'))

import { ModuleImportStopped, confirmRisumLowLevel } from 'src/ts/process/moduleImportStop'
import { language } from 'src/lang'

beforeEach(() => {
    h.prompts = []
    h.answer = true
})

describe('ModuleImportStopped', () => {
    test('is an Error that carries its reason and its class name', () => {
        const stop = new ModuleImportStopped('skipped')
        expect(stop).toBeInstanceOf(Error)
        expect(stop.name).toBe('ModuleImportStopped')
        expect(stop.reason).toBe('skipped')
        expect(new ModuleImportStopped('declined').reason).toBe('declined')
    })
})

describe('confirmRisumLowLevel', () => {
    test('a module without low-level access asks nothing', async () => {
        await expect(confirmRisumLowLevel({ name: 'M' })).resolves.toBeUndefined()
        await expect(confirmRisumLowLevel({ name: 'M', lowLevelAccess: false })).resolves.toBeUndefined()
        expect(h.prompts).toEqual([])
    })

    test('a module with low-level access asks once, naming the module, and resolves when confirmed', async () => {
        await expect(confirmRisumLowLevel({ name: 'M', lowLevelAccess: true })).resolves.toBeUndefined()
        expect(h.prompts).toEqual([`${language.moduleLowLevelNamed('M')}\n${language.lowLevelAccessConfirm}`])
    })

    test('the prompt also names the file when one is given', async () => {
        await confirmRisumLowLevel({ name: 'M', lowLevelAccess: true }, 'm.risum')
        expect(h.prompts).toEqual([`${language.moduleLowLevelNamed('M', 'm.risum')}\n${language.lowLevelAccessConfirm}`])
    })

    test('a declined prompt throws a declined stop', async () => {
        h.answer = false
        const thrown = await confirmRisumLowLevel({ name: 'M', lowLevelAccess: true }).catch((e: unknown) => e)
        expect(thrown).toBeInstanceOf(ModuleImportStopped)
        expect((thrown as ModuleImportStopped).reason).toBe('declined')
    })

    test('a nameless module with low-level access still asks and does not throw on the missing name', async () => {
        await confirmRisumLowLevel({ lowLevelAccess: true })
        expect(h.prompts).toHaveLength(1)
    })
})
