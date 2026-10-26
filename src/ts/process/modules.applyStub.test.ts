/**
 * `applyModule` copies the body of the module the user picked into the current character. A module stub in the
 * database is loaded through the registered module loader first; a failure applies nothing and is shown instead of the
 * success message; the acquired handle is released once the copy is taken.
 *
 * Drives the REAL `src/ts/process/modules.ts`, `moduleUse.ts` and `moduleAcquire.ts`. MOCKED: the alert module, the
 * database accessors and every module `modules.ts` imports, so nothing is read or written. The loader is a test double
 * that installs the body by replacing the stub slot. Titles beginning "guard:" pin behaviour that must be preserved;
 * every other test is a regression reproducer for the behaviour it names.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    db: { modules: [] as unknown[] } as { modules: unknown[] },
    char: { type: 'character', globalLore: [] as unknown[], customscript: [] as unknown[], triggerscript: [] as unknown[] },
    selected: '' as string,
    alertNormal: vi.fn(),
    alertError: vi.fn(),
}))

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(),
    alertError: h.alertError,
    alertModuleSelect: vi.fn(async () => h.selected),
    alertNormal: h.alertNormal,
    alertStore: { set: vi.fn(), update: vi.fn(), subscribe: vi.fn() },
    alertWait: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(() => h.char),
    getCurrentChat: vi.fn(),
    getDatabase: vi.fn(() => h.db),
    setCurrentCharacter: vi.fn(),
    setDatabase: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    AppendableBuffer: class {},
    downloadFile: vi.fn(),
    forageStorage: {},
    LocalWriter: class {},
    readImage: vi.fn(),
    saveAsset: vi.fn(),
    VirtualWriter: class {},
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/util'), () => ({
    checkPersonaBinded: vi.fn(),
    selectSingleFile: vi.fn(),
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))
vi.mock(import('src/ts/process/lorebook.svelte'), () => ({
    convertExternalLorebook: vi.fn(),
}) as unknown as typeof import('src/ts/process/lorebook.svelte'))
vi.mock(import('src/ts/media'), () => ({
    compressImage: vi.fn(),
}) as unknown as typeof import('src/ts/media'))
vi.mock(import('src/ts/rpack/rpack_js'), () => ({
    decodeRPack: vi.fn(),
    encodeRPack: vi.fn(),
}) as unknown as typeof import('src/ts/rpack/rpack_js'))
vi.mock(import('src/ts/stores.svelte'), () => ({
    get DBState() { return { db: h.db } },
    HideIconStore: { set: vi.fn() },
    moduleBackgroundEmbedding: { set: vi.fn() },
    ReloadGUIPointer: { set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/interchangeability'), () => ({
    convertCharacterToModule: vi.fn(),
    convertModuleToCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/interchangeability'))
vi.mock(import('src/ts/characterCards'), () => ({
    exportCharacterCard: vi.fn(),
    importCharacterProcess: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

import { language } from 'src/lang'
import { MODULE_STUB_KEY, MODULE_STUB_VALUE } from 'src/ts/storage/moduleStub'
import * as acquire from 'src/ts/storage/store2/moduleAcquire'
import { applyModule, type RisuModule } from './modules'

function stubOf(id: string, name: string): RisuModule {
    return { id, name, description: '', [MODULE_STUB_KEY]: MODULE_STUB_VALUE } as unknown as RisuModule
}

function bodyOf(id: string, name: string): RisuModule {
    return {
        id, name, description: '',
        lorebook: [{ key: 'k', comment: 'c', content: 'entry', mode: 'normal', insertorder: 1, alwaysActive: false, secondkey: '', selective: false }],
        regex: [{ comment: 'r', in: 'a', out: 'b', type: 'editinput' }],
        trigger: [{ comment: 't', type: 'start', conditions: [], effect: [] }],
    } as unknown as RisuModule
}

/** A loader that installs `body` into the slot of the stub it is asked for and returns that slot read back. */
function registerInstalling(body: RisuModule): ReturnType<typeof vi.fn> {
    const loader = vi.fn(async (handle: string) => {
        const id = handle.split('#')[0]
        const index = h.db.modules.findIndex((m) => (m as RisuModule).id === id)
        h.db.modules[index] = body
        return h.db.modules[index] as RisuModule
    })
    acquire.registerModuleLoader(loader)
    return loader
}

beforeEach(() => {
    h.db.modules = []
    h.char.globalLore = []
    h.char.customscript = []
    h.char.triggerscript = []
    h.alertNormal.mockClear()
    h.alertError.mockClear()
})

afterEach(() => {
    acquire.unregisterModuleLoader()
    vi.restoreAllMocks()
})

describe('applyModule', () => {
    test('guard: a resident module is copied into the character and the success message shows', async () => {
        h.db.modules = [bodyOf('m1', 'Resident')]
        h.selected = 'm1'
        await applyModule()
        expect(h.char.globalLore).toHaveLength(1)
        expect(h.alertNormal).toHaveBeenCalledWith(language.successApplyModule)
    })

    test('apply-module-loads-stub: a stub is loaded and its lorebook, regex and trigger reach the character', async () => {
        h.db.modules = [stubOf('m1', 'Stubbed')]
        h.selected = 'm1'
        registerInstalling(bodyOf('m1', 'Stubbed'))
        await applyModule()
        expect(h.char.globalLore).toHaveLength(1)
        expect(h.char.customscript).toHaveLength(1)
        expect(h.char.triggerscript).toHaveLength(1)
        expect(h.alertNormal).toHaveBeenCalledWith(language.successApplyModule)
    })

    test('a load failure applies nothing, shows the failure naming the module, and no success message', async () => {
        h.db.modules = [stubOf('m1', 'Stubbed')]
        h.selected = 'm1'
        acquire.registerModuleLoader(async () => { throw new Error('disk gone') })
        await applyModule()
        expect(h.char.globalLore).toHaveLength(0)
        expect(h.alertNormal).not.toHaveBeenCalled()
        expect(h.alertError).toHaveBeenCalledWith(language.moduleLoadFailed('Stubbed'))
    })

    test('a stub with no registered loader applies nothing and shows the failure', async () => {
        h.db.modules = [stubOf('m1', 'Stubbed')]
        h.selected = 'm1'
        await applyModule()
        expect(h.char.globalLore).toHaveLength(0)
        expect(h.alertNormal).not.toHaveBeenCalled()
        expect(h.alertError).toHaveBeenCalledWith(language.moduleLoadFailed('Stubbed'))
    })

    test('release-skipped: the acquired handle is released once the copy is taken', async () => {
        h.db.modules = [stubOf('m1', 'Stubbed')]
        h.selected = 'm1'
        const release = vi.fn()
        vi.spyOn(acquire, 'acquireModule').mockImplementation(async () => ({ module: bodyOf('m1', 'Stubbed'), release }))
        await applyModule()
        expect(release).toHaveBeenCalledTimes(1)
        expect(h.char.globalLore).toHaveLength(1)
    })
})
