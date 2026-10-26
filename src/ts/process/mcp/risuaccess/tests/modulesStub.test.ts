/**
 * The risuaccess module tools reach a module through `acquireModule`: a module
 * stub in the list is loaded first, the tool reads and writes the live slot the
 * loader installed, and every acquired handle is released. A load failure is the
 * tool's error text. The list tool is built from the index fields and never
 * loads. The loader is a test double that replaces the stub slot with a body.
 *
 * Titles beginning "guard:" pin behaviour that may pass before and after the
 * change.
 */
import type { RisuModule } from 'src/ts/process/modules'
import { DBState } from 'src/ts/stores.svelte'
import { alertConfirm } from 'src/ts/alert'
import { isModuleStub, MODULE_STUB_KEY, MODULE_STUB_VALUE } from 'src/ts/storage/moduleStub'
import { registerModuleLoader, unregisterModuleLoader } from 'src/ts/storage/store2/moduleAcquire'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { RPCToolCallTextContent } from '../../mcplib'
import { ModuleHandler } from '../modules'

//#region module mocks

vi.mock(import('katex'), () => ({}))
vi.mock(import('src/ts/lite'), () => ({}))

vi.mock(import('src/ts/alert'), () => ({
  alertConfirm: vi.fn(),
}))

vi.mock(import('src/ts/stores.svelte'), () => {
  return {
    DBState: {
      db: {
        characters: [],
        enabledModules: [],
        modules: [],
      },
    },
    selIdState: {
      selId: 0,
    },
  } as typeof import('src/ts/stores.svelte')
})

const acquireSpy = vi.hoisted(() => ({ releases: 0, calls: 0 }))

vi.mock(import('src/ts/storage/store2/moduleAcquire'), async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    acquireModule: async (id, signal) => {
      acquireSpy.calls++
      const acquired = await actual.acquireModule(id, signal)
      return acquired && { module: acquired.module, release: () => { acquireSpy.releases++; acquired.release() } }
    },
  } as typeof actual
})

//#endregion

type Fields = Record<string, unknown>

const fullBody = (id: string): RisuModule => ({
  id,
  name: `${id}Name`,
  description: `${id}Description`,
  lorebook: [{
    alwaysActive: false, comment: 'entry', content: 'entryContent', insertorder: 100,
    key: 'entryKey', mode: 'normal', secondkey: '', selective: false,
  }],
  regex: [{ ableFlag: true, comment: 'script', flag: '', in: 'in', out: 'out', type: 'editdisplay' }],
  trigger: [{ comment: '', conditions: [], effect: [{ code: 'print("old")', type: 'triggerlua' }], type: 'manual' }],
})

const stubOf = (id: string, extra: Fields = {}): RisuModule => ({
  id,
  name: `${id}Name`,
  description: `${id}Description`,
  hasToggle: false,
  dsp: false,
  unit: ['unit'],
  al: [],
  il: [],
  [MODULE_STUB_KEY]: MODULE_STUB_VALUE,
  ...extra,
} as unknown as RisuModule)

const text = (responses: unknown): string => ((responses as RPCToolCallTextContent[])[0]).text

let loads: string[]

/** Installs the body for the stub of `id` into its slot and returns the slot read back. */
function installLoader(failWith?: Error): void {
  registerModuleLoader(async (handle) => {
    loads.push(handle)
    if (failWith) {
      throw failWith
    }
    const id = handle.slice(0, handle.lastIndexOf('#'))
    const index = DBState.db.modules.findIndex((m) => m.id === id)
    DBState.db.modules[index] = fullBody(id)
    return DBState.db.modules[index]
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  loads = []
  acquireSpy.releases = 0
  acquireSpy.calls = 0
  vi.mocked(alertConfirm).mockResolvedValue(true)
  DBState.db.enabledModules = []
})

afterEach(() => {
  unregisterModuleLoader()
})

test('risuaccess-reads-stub-body: get lorebook loads the stub and answers from its body, then releases', async () => {
  installLoader()
  DBState.db.modules = [stubOf('A')]

  const response = await new ModuleHandler().handle('risu-get-module-lorebook', { id: 'A', names: ['entry'] })

  expect(JSON.parse(text(response))[0].content).toBe('entryContent')
  expect(loads).toEqual(['A#0'])
  expect(acquireSpy.releases).toBe(1)
})

test('risuaccess-edit-persists-in-live-slot: set lorebook, regex and lua on a stub edit the live slot', async () => {
  installLoader()
  DBState.db.modules = [stubOf('A'), stubOf('B'), stubOf('C')]
  const instance = new ModuleHandler()

  await instance.handle('risu-set-module-lorebook', { id: 'A', name: 'entry', content: 'edited' })
  await instance.handle('risu-set-module-regex-script', { id: 'B', name: 'script', regexIn: undefined, in: 'editedIn' })
  await instance.handle('risu-set-module-lua-script', { id: 'C', code: 'print("new")' })

  expect(DBState.db.modules.map((m) => isModuleStub(m))).toEqual([false, false, false])
  expect(DBState.db.modules[0].lorebook?.[0].content).toBe('edited')
  expect(DBState.db.modules[1].regex?.[0].in).toBe('editedIn')
  expect((DBState.db.modules[2].trigger?.[0].effect[0] as { code: string }).code).toBe('print("new")')
  expect(acquireSpy.releases).toBe(3)
})

test('risuaccess-load-failure-is-error-text: a loader rejection is the tool error naming the module, never a throw', async () => {
  installLoader(new Error('disk gone'))
  DBState.db.modules = [stubOf('A')]
  const instance = new ModuleHandler()

  const read = await instance.handle('risu-get-module-lorebook', { id: 'A', names: ['entry'] })
  const write = await instance.handle('risu-set-module-lua-script', { id: 'A', code: 'x' })

  for (const response of [read, write]) {
    expect(text(response)).toMatch(/^Error: /)
    expect(text(response)).toContain('ID A')
    expect(text(response)).toContain('disk gone')
  }
  expect(vi.mocked(alertConfirm)).not.toHaveBeenCalled()
})

test('risuaccess-load-failure-is-error-text: a missing loader is the tool error naming id and name', async () => {
  DBState.db.modules = [stubOf('A')]

  const response = await new ModuleHandler().handle('risu-get-module-lorebook', { id: 'A', names: ['entry'] })

  expect(text(response)).toContain('AName')
  expect(text(response)).toContain('(A)')
})

test('risuaccess-handle-released-after-use: a resident module is acquired and released once per call', async () => {
  DBState.db.modules = [fullBody('A')]

  await new ModuleHandler().handle('risu-get-module-regex-scripts', { id: 'A' })
  await new ModuleHandler().handle('risu-get-module-regex-scripts', { id: 'zzz' })

  expect(acquireSpy.calls).toBe(2)
  expect(acquireSpy.releases).toBe(1)
})

test('guard: risuaccess-list-does-not-load: stubs are listed from the index fields, mcp stubs filtered, loader not called', async () => {
  installLoader()
  DBState.db.modules = [stubOf('A'), stubOf('M', { mcp: true }), fullBody('F')]
  DBState.db.enabledModules = ['A']

  const response = await new ModuleHandler().handle('risu-list-modules', {})

  expect(JSON.parse(text(response))).toEqual([
    { id: 'A', name: 'AName', description: 'ADescription', enabled: true },
    { id: 'F', name: 'FName', description: 'FDescription', enabled: false },
  ])
  expect(loads).toEqual([])
  expect(acquireSpy.calls).toBe(0)
})

test('risuaccess-mcp-module-is-not-found: a resident mcp module and an mcp stub get the not-found text, and every handle is released', async () => {
  registerModuleLoader(async () => {
    DBState.db.modules[1] = { ...fullBody('S'), mcp: { url: 'http://localhost' } } as unknown as RisuModule
    return DBState.db.modules[1]
  })
  DBState.db.modules = [{ ...fullBody('R'), mcp: { url: 'http://localhost' } } as unknown as RisuModule, stubOf('S', { mcp: true })]
  const instance = new ModuleHandler()

  for (const id of ['R', 'S']) {
    const response = await instance.handle('risu-set-module-lua-script', { id, code: 'x' })
    expect(text(response)).toBe(`Error: Module with ID ${id} not found.`)
  }

  expect(acquireSpy.calls).toBe(2)
  expect(acquireSpy.releases).toBe(2)
  expect(vi.mocked(alertConfirm)).not.toHaveBeenCalled()
})
