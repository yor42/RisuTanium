// @vitest-environment happy-dom
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { MODULE_STUB_KEY } from 'src/ts/storage/moduleStub'
import type { RisuModule } from 'src/ts/process/modules'

const h = vi.hoisted(() => ({
    state: { db: { modules: [] as Array<Record<string, string | number>>, enabledModules: ['m1'], characters: [], personas: [], moduleIntergration: '' } },
    alerts: [] as string[],
    requests: vi.fn(async () => ({ type: 'success', result: '[]' })),
    pick: vi.fn(async () => ({ data: new Uint8Array([1]) })),
}))
vi.mock('src/ts/stores.svelte', () => ({
    DBState: h.state,
    selectedCharID: writable(-1),
    ReloadGUIPointer: writable(0),
}))
vi.mock('src/ts/storage/database.svelte', () => ({
    getDatabase: () => h.state.db,
    getCurrentCharacter: () => null,
    getCurrentChat: () => null,
}))
vi.mock('src/ts/util', () => ({
    checkPersonaBinded: () => false,
    jsonOutputTrimmer: (value: string) => value,
    selectSingleFile: h.pick,
}))
vi.mock('src/ts/alert', () => ({
    alertError: (value: string) => { h.alerts.push(value) },
}))
vi.mock('src/ts/process/request/request', () => ({
    requestChatData: h.requests,
}))
vi.mock('../UI/GUI/TextAreaInput.svelte', () => ({ default: () => {} }))

import { language } from 'src/lang'
import { moduleLoadFailedText } from 'src/ts/process/moduleRefList'
import { registerModuleLoader, unregisterModuleLoader } from 'src/ts/storage/store2/moduleAcquire'
import PlaygroundImageTrans from './PlaygroundImageTrans.svelte'

let target: HTMLElement
let app: ReturnType<typeof mount>
let calls: string[]
let release: () => void
let fail: (id: string) => boolean
const originalContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext')
const originalDataURL = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'toDataURL')
const originalObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')

class DecodedImage {
    src = ''
    width = 2
    height = 2
    async decode(): Promise<void> {}
}
function stub(id: string, name: string): Record<string, string | number> {
    return { id, name, [MODULE_STUB_KEY]: 1 }
}
async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 20))
    flushSync()
}
function button(): HTMLButtonElement {
    return Array.from(target.querySelectorAll('button')).at(-1) as HTMLButtonElement
}
beforeEach(() => {
    calls = []
    release = () => {}
    fail = () => false
    h.alerts.length = 0
    h.requests.mockClear()
    h.pick.mockClear()
    h.state.db.modules = [stub('m1', 'Alpha')]
    h.state.db.enabledModules = ['m1']
    vi.stubGlobal('Image', DecodedImage)
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { value: () => ({ clearRect() {}, drawImage() {}, fillRect() {} }), configurable: true, writable: true })
    Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', { value: () => 'data:image/png;base64,AA', configurable: true, writable: true })
    Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:image', configurable: true, writable: true })
    registerModuleLoader(async (handle) => {
        const id = handle.slice(0, handle.lastIndexOf('#'))
        calls.push(id)
        await new Promise<void>((resolve) => { release = resolve })
        if(fail(id)) throw new Error('load failed')
        const row = h.state.db.modules.find((item) => item.id === id)
        if(!row) throw new Error('missing row')
        const loaded = { id, name: row.name }
        h.state.db.modules[h.state.db.modules.indexOf(row)] = loaded
        return loaded as RisuModule
    })
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(PlaygroundImageTrans, { target, props: {} })
    flushSync()
})
afterEach(async () => {
    await unmount(app)
    target.remove()
    unregisterModuleLoader()
    vi.unstubAllGlobals()
    if(originalContext) Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', originalContext)
    else Reflect.deleteProperty(HTMLCanvasElement.prototype, 'getContext')
    if(originalDataURL) Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', originalDataURL)
    else Reflect.deleteProperty(HTMLCanvasElement.prototype, 'toDataURL')
    if(originalObjectURL) Object.defineProperty(URL, 'createObjectURL', originalObjectURL)
    else Reflect.deleteProperty(URL, 'createObjectURL')
})
describe('no-selection image translation module wait', () => {
    test('I1 loads before requesting', async () => {
        button().click()
        await settle()
        expect(calls).toEqual(['m1'])
        expect(h.requests).not.toHaveBeenCalled()
        release()
        await settle()
        expect(h.requests).toHaveBeenCalledTimes(1)
        expect(h.alerts).toEqual([])
    })
    test('I2 a failed load stops the request and clears busy state', async () => {
        fail = () => true
        button().click()
        await settle()
        release()
        await settle()
        expect(h.requests).not.toHaveBeenCalled()
        expect(h.alerts).toEqual([moduleLoadFailedText(['Alpha'])])
        expect(button().textContent?.trim()).toBe(language.imageTranslation)
    })
    test('I3 a second click shares the busy run', async () => {
        button().click()
        button().click()
        await settle()
        expect(calls).toEqual(['m1'])
        expect(h.requests).not.toHaveBeenCalled()
        release()
        await settle()
        expect(h.requests).toHaveBeenCalledTimes(1)
    })
    test('I4 a later click retries a failed slot', async () => {
        fail = () => true
        button().click()
        await settle()
        release()
        await settle()
        expect(h.requests).not.toHaveBeenCalled()
        fail = () => false
        button().click()
        await settle()
        release()
        await settle()
        expect(calls).toEqual(['m1', 'm1'])
        expect(h.requests).toHaveBeenCalledTimes(1)
    })
    test('I6 partial install stops and names only the failure', async () => {
        h.state.db.modules.push(stub('m2', 'Beta'))
        h.state.db.enabledModules = ['m1', 'm2']
        fail = (id) => id === 'm2'
        button().click()
        await settle()
        release()
        await settle()
        expect(calls).toEqual(['m1', 'm2'])
        release()
        await settle()
        expect(h.requests).not.toHaveBeenCalled()
        expect(h.alerts).toEqual([moduleLoadFailedText(['Beta'])])
        expect(h.state.db.modules[0][MODULE_STUB_KEY]).toBeUndefined()
        expect(h.state.db.modules[1][MODULE_STUB_KEY]).toBe(1)
        expect(button().textContent?.trim()).toBe(language.imageTranslation)
    })
    test('I5 guard passes before and after with a resident module', async () => {
        h.state.db.modules = [{ id: 'm1', name: 'Alpha' }]
        button().click()
        await settle()
        expect(calls).toEqual([])
        expect(h.requests).toHaveBeenCalledTimes(1)
    })
})
