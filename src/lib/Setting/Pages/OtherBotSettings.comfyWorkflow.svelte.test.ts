// @vitest-environment jsdom

/**
 * The ComfyUI ('comfyui') workflow field of `OtherBotSettings.svelte` is a multi-line text area with an upload
 * button. An uploaded file replaces `DBState.db.comfyConfig.workflow` only when its text parses as JSON; any other
 * file shows an error and keeps the stored workflow.
 *
 * Mounts the REAL component over a real `$state` database; only the file picker and the alert functions are mocked.
 * The comment above each case marks it: a regression reproducer fails before the port (no text area, no upload
 * button); a compatibility guard pins behaviour that holds regardless.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, afterEach } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = {
        alertConfirm: vi.fn(async () => true),
        alertError: vi.fn(),
        alertStore: writable({ type: 'none', msg: '' }),
    }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    // The real TextAreaInput reads these; the highlighter stays off.
    const selIdState = $state({ selId: -1 })
    const popUpEditorStore = $state({ open: false })
    return {
        DBState: state,
        selectedCharID: writable(0),
        selIdState,
        disableHighlight: writable(true),
        popUpEditorStore,
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    saveAsset: vi.fn(),
    pickedAssetLimitBytes: vi.fn(),
    downloadFile: vi.fn(),
    globalFetch: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/util'), () => ({
    selectSingleFile: vi.fn(),
    selectSingleFileObject: vi.fn(),
    readPickedFileBytes: vi.fn(),
    sleep: vi.fn(async () => undefined),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/characters'), () => ({
    getCharImage: vi.fn(async () => ''),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/process/prompt'), () => ({
    tokenizePreset: vi.fn(async () => 0),
}) as unknown as typeof import('src/ts/process/prompt'))

vi.mock(import('src/ts/tokenizer'), () => ({
    getCharToken: vi.fn(async () => ({ persistant: 0, dynamic: 0 })),
}) as unknown as typeof import('src/ts/tokenizer'))

//#endregion

import { DBState } from 'src/ts/stores.svelte'
import { alertError } from 'src/ts/alert'
import { selectSingleFile } from 'src/ts/util'
import { language } from 'src/lang'
import OtherBotSettings from './OtherBotSettings.svelte'

//#region helpers

const STORED = '{"stored":true}'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function installDb(sdProvider: string): void {
    DBState.db = {
        sdProvider,
        comfyUiUrl: 'http://127.0.0.1:8188',
        comfyConfig: {
            workflow: STORED,
            posNodeID: '',
            posInputName: '',
            negNodeID: '',
            negInputName: '',
            timeout: 30,
        },
        hypaModel: 'MiniLM',
        hypaV3: false,
        hypav2: false,
        hanuraiEnable: false,
        supaModelType: 'none',
        useLegacyGUI: false,
        wavespeedImage: {},
        hypaV3Presets: [{ name: 'A' }],
        hypaV3PresetId: 0,
        characters: [{ chaId: 'c0', chats: [], chatPage: 0 }],
        memoryAlgorithmType: 'none',
    } as unknown as Database
}

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

async function settle(): Promise<void> {
    flushSync()
    await sleep(20)
    flushSync()
}

/** Mounts the page and opens its image generation tab. */
async function imageTab(): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(OtherBotSettings, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    await settle()
    const tab = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === language.imageGeneration)
    if (!tab) throw new Error('the image generation tab is not shown')
    tab.click()
    await settle()
    return target
}

function uploadButton(target: HTMLElement): HTMLButtonElement {
    const button = target.querySelector<HTMLButtonElement>(`button[aria-label="${language.import}"]`)
    if (!button) throw new Error('the workflow upload button is not shown')
    return button
}

function pick(text: string): void {
    vi.mocked(selectSingleFile).mockResolvedValueOnce({ name: 'workflow.json', data: new TextEncoder().encode(text) })
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
    vi.mocked(selectSingleFile).mockReset()
    vi.mocked(alertError).mockClear()
})

//#endregion

describe('the ComfyUI workflow field', () => {
    // regression reproducer
    test('is a labelled multi-line text area that shows the stored workflow', async () => {
        installDb('comfyui')
        const target = await imageTab()
        expect(target.textContent).toContain(language.comfyWorkflow)
        const area = target.querySelector('textarea')
        expect(area?.value).toBe(STORED)
    })

    // regression reproducer
    test('an uploaded JSON file replaces the workflow with the file text', async () => {
        installDb('comfyui')
        const target = await imageTab()
        const text = '{\n  "3": {"class_type": "KSampler"}\n}'
        pick(text)
        uploadButton(target).click()
        await settle()

        expect(vi.mocked(selectSingleFile)).toHaveBeenCalledWith(['json'])
        expect(DBState.db.comfyConfig.workflow).toBe(text)
        expect(target.querySelector('textarea')?.value).toBe(text)
        expect(vi.mocked(alertError)).not.toHaveBeenCalled()
    })

    // regression reproducer
    test('a file that is not JSON shows an error and keeps the stored workflow', async () => {
        installDb('comfyui')
        const target = await imageTab()
        pick('not json {')
        uploadButton(target).click()
        await settle()

        expect(vi.mocked(alertError)).toHaveBeenCalledWith(language.comfyWorkflowInvalidJson)
        expect(DBState.db.comfyConfig.workflow).toBe(STORED)
    })

    // regression reproducer
    test('a cancelled pick changes nothing', async () => {
        installDb('comfyui')
        const target = await imageTab()
        vi.mocked(selectSingleFile).mockResolvedValueOnce(null)
        uploadButton(target).click()
        await settle()

        expect(DBState.db.comfyConfig.workflow).toBe(STORED)
        expect(vi.mocked(alertError)).not.toHaveBeenCalled()
    })

    // compatibility guard: the legacy 'comfy' block keeps its single-line input and has no upload button
    test('the legacy ComfyUI block is unchanged', async () => {
        installDb('comfy')
        const target = await imageTab()
        expect(target.querySelector('textarea')).toBeNull()
        expect(target.querySelector(`button[aria-label="${language.import}"]`)).toBeNull()
        const inputs = Array.from(target.querySelectorAll('input')).map((input) => input.value)
        expect(inputs).toContain(STORED)
    })
})
