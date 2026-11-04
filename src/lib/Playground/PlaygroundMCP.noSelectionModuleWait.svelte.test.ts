// @vitest-environment happy-dom
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { MODULE_STUB_KEY } from 'src/ts/storage/moduleStub'
import type { RisuModule } from 'src/ts/process/modules'

type ModuleRow = { id: string, name: string, namespace: string, mcp?: { url: string }, [MODULE_STUB_KEY]?: number }

const MCP_URL = 'http://mcp.test'

const h = vi.hoisted(() => ({
    state: { db: { modules: [] as ModuleRow[], enabledModules: ['m1'], characters: [], personas: [], moduleIntergration: '' } },
    // Every MCP entry point records, at call time, whether each enabled slot was resident.
    mcp: { init: 0, meta: 0, tools: 0, sawResident: [] as boolean[] },
    alerts: [] as string[],
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
    sleep: async () => {},
}))
vi.mock('src/ts/alert', () => ({
    alertError: (message: string) => { h.alerts.push(message) },
    alertMd: () => {},
}))
vi.mock('src/ts/process/mcp/mcp', async () => {
    const { MODULE_STUB_KEY: stubKey } = await import('src/ts/storage/moduleStub')
    // Stands in for the stub skip of the real module MCP entry list.
    const residentUrls = (): string[] => {
        const urls: string[] = []
        for(const row of h.state.db.modules as ModuleRow[]){
            if(row[stubKey] === 1) continue
            if(!h.state.db.enabledModules.includes(row.id)) continue
            if(row.mcp?.url) urls.push(row.mcp.url)
        }
        return urls
    }
    const note = () => {
        h.mcp.sawResident.push(h.state.db.enabledModules.every((id) => {
            const row = (h.state.db.modules as ModuleRow[]).find((m) => m.id === id)
            return !!row && row[stubKey] !== 1
        }))
    }
    return {
        initializeMCPs: async () => { h.mcp.init++; note() },
        getMCPMeta: async () => {
            h.mcp.meta++; note()
            return Object.fromEntries(residentUrls().map((url) => [url, { name: 'srv' }]))
        },
        getMCPTools: async () => {
            h.mcp.tools++; note()
            return residentUrls().map((url) => ({ name: 'echo', description: 'echo tool', inputSchema: {}, mcpURL: url }))
        },
        callMCPTool: async () => ({}),
    }
})
vi.mock('../UI/GUI/TextAreaInput.svelte', () => ({
    default: (anchor: Comment, props: { value?: string }) => {
        const area = document.createElement('textarea')
        anchor.before(area)
        $effect(() => { area.value = props.value ?? '' })
        area.addEventListener('input', () => { props.value = area.value })
    },
}))
vi.mock('../UI/GUI/Button.svelte', () => ({
    default: (anchor: Comment, props: { onclick?: () => void }) => {
        const button = document.createElement('button')
        anchor.before(button)
        button.addEventListener('click', () => { props.onclick?.() })
    },
}))

import { moduleLoadFailedText } from 'src/ts/process/moduleRefList'
import { registerModuleLoader, unregisterModuleLoader } from 'src/ts/storage/store2/moduleAcquire'
import PlaygroundMCP from './PlaygroundMCP.svelte'

let target: HTMLElement
let app: ReturnType<typeof mount> | null
let calls: string[]
let release: () => void
let fail: boolean

function stub(id: string, name: string): ModuleRow {
    return { id, name, namespace: 'ns', [MODULE_STUB_KEY]: 1 }
}

function resident(id: string, name: string): ModuleRow {
    return { id, name, namespace: 'ns', mcp: { url: MCP_URL } }
}

async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 20))
    flushSync()
}

async function click(): Promise<void> {
    const buttons = target.querySelectorAll('button')
    ;(buttons[buttons.length - 1] as HTMLButtonElement).click()
    await settle()
}

function metadata(): string {
    return (target.querySelectorAll('textarea')[0] as HTMLTextAreaElement).value
}

function rows(): string[] {
    return Array.from(target.querySelectorAll('h3')).map((el) => el.textContent ?? '')
}

function mcpCalls(): [number, number, number] {
    return [h.mcp.init, h.mcp.meta, h.mcp.tools]
}

async function waitLoaderCalls(expected: string[]): Promise<void> {
    await vi.waitFor(() => { expect(calls).toEqual(expected) })
}

async function waitMcp(count: number): Promise<void> {
    await vi.waitFor(() => { expect(mcpCalls()).toEqual([count, count, count]) })
    await settle()
}

async function unmountApp(): Promise<void> {
    if(app){
        const current = app
        app = null
        await unmount(current)
    }
}

beforeEach(() => {
    calls = []
    release = () => {}
    fail = false
    h.alerts.length = 0
    h.mcp.init = 0
    h.mcp.meta = 0
    h.mcp.tools = 0
    h.mcp.sawResident.length = 0
    h.state.db.modules = [stub('m1', 'Alpha')]
    h.state.db.enabledModules = ['m1']
    registerModuleLoader(async (handle) => {
        const id = handle.slice(0, handle.lastIndexOf('#'))
        calls.push(id)
        await new Promise<void>((resolve) => { release = resolve })
        if(fail) throw new Error('load failed')
        const index = h.state.db.modules.findIndex((m) => m.id === id)
        const row = resident(id, h.state.db.modules[index].name)
        h.state.db.modules[index] = row
        return row as RisuModule
    })
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(PlaygroundMCP, { target, props: {} })
    flushSync()
})

afterEach(async () => {
    await unmountApp()
    target.remove()
    unregisterModuleLoader()
})

describe('no-selection MCP module wait', () => {
    test('C1 refresh waits for the stub load before any MCP call', async () => {
        await click()
        await waitLoaderCalls(['m1'])
        expect(mcpCalls()).toEqual([0, 0, 0])
        release()
        await waitMcp(1)
        expect(h.mcp.sawResident.every(Boolean)).toBe(true)
        expect(rows()).toEqual(['echo'])
        expect(metadata()).toContain(MCP_URL)
        expect(h.alerts).toEqual([])
    })

    test('C2 a failed load alerts once and calls no MCP entry point', async () => {
        fail = true
        await click()
        await waitLoaderCalls(['m1'])
        release()
        await vi.waitFor(() => { expect(h.alerts).toEqual([moduleLoadFailedText(['Alpha'])]) })
        await settle()
        expect(mcpCalls()).toEqual([0, 0, 0])
        expect(metadata()).toBe('')
        expect(rows()).toEqual([])
    })

    test('C3 a failure after an earlier success keeps the previous list', async () => {
        h.state.db.modules = [resident('m1', 'Alpha')]
        await click()
        await waitMcp(1)
        expect(rows()).toEqual(['echo'])
        const before = metadata()
        expect(before).toContain(MCP_URL)

        h.state.db.modules.push(stub('m2', 'Beta'))
        h.state.db.enabledModules = ['m1', 'm2']
        fail = true
        await click()
        await waitLoaderCalls(['m2'])
        release()
        await vi.waitFor(() => { expect(h.alerts).toEqual([moduleLoadFailedText(['Beta'])]) })
        await settle()
        expect(mcpCalls()).toEqual([1, 1, 1])
        expect(rows()).toEqual(['echo'])
        expect(metadata()).toBe(before)
        expect(h.state.db.modules[1][MODULE_STUB_KEY]).toBe(1)
    })

    test('C4 two clicks during a failing wait share one load and one alert', async () => {
        fail = true
        await click()
        await click()
        await waitLoaderCalls(['m1'])
        release()
        await vi.waitFor(() => { expect(h.alerts).toEqual([moduleLoadFailedText(['Alpha'])]) })
        await settle()
        expect(calls).toEqual(['m1'])
        expect(mcpCalls()).toEqual([0, 0, 0])
    })

    test('C5 two clicks during a successful wait give two refreshes', async () => {
        await click()
        await click()
        await waitLoaderCalls(['m1'])
        release()
        await waitMcp(2)
        expect(calls).toEqual(['m1'])
        expect(h.mcp.sawResident.length).toBe(6)
        expect(h.mcp.sawResident.every(Boolean)).toBe(true)
        expect(h.alerts).toEqual([])
    })

    test('C6 a click after a failure retries the load', async () => {
        fail = true
        await click()
        await waitLoaderCalls(['m1'])
        release()
        await vi.waitFor(() => { expect(h.alerts).toEqual([moduleLoadFailedText(['Alpha'])]) })
        await settle()
        expect(rows()).toEqual([])

        fail = false
        await click()
        await waitLoaderCalls(['m1', 'm1'])
        release()
        await waitMcp(1)
        expect(h.alerts).toEqual([moduleLoadFailedText(['Alpha'])])
        expect(rows()).toEqual(['echo'])
    })

    test('C7a guard passes before and after with a resident module', async () => {
        h.state.db.modules = [resident('m1', 'Alpha')]
        await click()
        await waitMcp(1)
        expect(calls).toEqual([])
        expect(rows()).toEqual(['echo'])
        expect(h.alerts).toEqual([])
    })

    test('C7b guard passes before and after with only an unreferenced stub', async () => {
        h.state.db.modules = [resident('m1', 'Alpha'), stub('m3', 'Gamma')]
        await click()
        await waitMcp(1)
        expect(calls).toEqual([])
        expect(rows()).toEqual(['echo'])
        expect(h.alerts).toEqual([])
    })

    test('C8 an unmount during the wait does not skip the refresh', async () => {
        await click()
        await waitLoaderCalls(['m1'])
        await unmountApp()
        expect(mcpCalls()).toEqual([0, 0, 0])
        release()
        await vi.waitFor(() => { expect(mcpCalls()).toEqual([1, 1, 1]) })
    })
})
