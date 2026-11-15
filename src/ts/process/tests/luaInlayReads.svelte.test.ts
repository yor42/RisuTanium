// @vitest-environment node
/**
 * The Lua `LLM` and `axLLM` calls with the multimodal flag read the inlays named by `{{inlay::id}}`,
 * `{{inlayed::id}}` and `{{inlayeddata::id}}` tags into the request's multimodal parts. A video or audio
 * over the send limit is left out of the request, with one warning, and its body is never read from the
 * app store; an unreadable id still gives one empty part; an image is read at any size.
 *
 * Drives the real `scriptings.ts`, the real inlays module over an in-memory app store, and the real
 * wasmoon Lua engine (node environment). The request layer is mocked and records only the length of each
 * part's data, so nothing here says anything about a native backend. Inlays are stored as data URI
 * strings, because the node environment has no `FileReader`.
 *
 * Tests whose title starts with `guard:` pass with or without the cap.
 */
import { afterEach, describe, test, expect, vi, beforeAll, beforeEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import { writable } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'
import '../../polyfill'
import { injectAppStore } from '../../storage/store/appStore'
import { resetBusyActionsForTest } from '../memory/busyActions'
import { inlayMetaKey } from '../files/inlayKeys'
import type { InlayRecord } from '../files/inlayStore'
import { createMemoryByteStore, type MemoryByteStore } from '../files/tests/memoryByteStore'
import { setInlayAsset, type InlayAsset } from '../files/inlays'

type SeenPart = { type: string | undefined, len: number | undefined }
type SeenMessage = { role: string, content: string, multimodals: SeenPart[] | undefined }

const h = vi.hoisted(() => ({
    seen: [] as Array<{ formated: SeenMessage[] }>,
    marks: [] as string[],
}))

vi.mock('localforage', () => ({ default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}), keys: vi.fn(async () => []) }) } }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 } }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }))
vi.mock('@tauri-apps/api/path', () => ({ basename: vi.fn(async (p: string) => p.split('/').pop()) }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })) }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: class {} }))
vi.mock('dompurify', () => ({ default: { addHook() {}, sanitize: (html: string) => html } }))
vi.mock('../../platform', () => ({ isTauri: false, isNodeServer: false }))
vi.mock('../../storage/characterSaveMarks', () => ({ markCharacterForSave: (id: string) => { h.marks.push(id) } }))

vi.mock('../../stores.svelte', () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state, CharEmotion: writable({}), selectedCharID: writable(-1), selIdState: { selId: 0 },
        CurrentTriggerIdStore: writable(null), ReloadChatPointer: writable({}), ReloadGUIPointer: writable(0),
        HideIconStore: writable(false), moduleBackgroundEmbedding: writable(''),
    }
})
vi.mock('../../alert', () => ({
    alertError: vi.fn(), alertToast: vi.fn(), alertInput: vi.fn(async () => ''), alertNormal: vi.fn(), alertSelect: vi.fn(async () => ''),
    alertConfirm: vi.fn(async () => true), alertClear: vi.fn(), alertModuleSelect: vi.fn(async () => -1), alertStore: writable({ type: '', msg: '' }), alertWait: vi.fn(),
}))
vi.mock('../../globalApi.svelte', () => ({
    fetchNative: vi.fn(), globalFetch: vi.fn(), readImage: vi.fn(), aiWatermarkingLawApplies: vi.fn(() => false), getFileSrc: vi.fn(async () => ''),
    forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
    AppendableBuffer: class {}, LocalWriter: class {}, VirtualWriter: class {}, downloadFile: vi.fn(), saveAsset: vi.fn(async () => ''),
}))
vi.mock('../../tokenizer', () => ({
    ChatTokenizer: class { constructor(_a: number, _b: string) {} async tokenizeChat() { return 1 } },
    tokenize: vi.fn(async (s: string) => (s?.length ?? 0)), tokenizeNum: vi.fn(async () => [] as number[]),
}))
vi.mock('../../characters', () => ({ createBlankChar: vi.fn(() => ({ name: '', chaId: '' })), getCharImage: vi.fn() }))
vi.mock('../command', () => ({ processMultiCommand: vi.fn(async () => {}) }))
vi.mock('../../media', () => ({ compressImage: vi.fn(async (v: unknown) => v), getImageType: vi.fn() }))
vi.mock('../tts', () => ({ sayTTS: vi.fn() }))
vi.mock('../../characterCards', () => ({ exportCharacterCard: vi.fn(), importCharacterProcess: vi.fn() }))
vi.mock('../../rpack/rpack_js', () => ({ decodeRPack: vi.fn(), encodeRPack: vi.fn() }))
vi.mock('../../interchangeability', () => ({ convertCharacterToModule: vi.fn(), convertModuleToCharacter: vi.fn() }))
vi.mock('../../plugins/plugins.svelte', () => ({
    pluginV2: { editdisplay: new Set(), editoutput: new Set(), editprocess: new Set(), editinput: new Set(), chatOutput: new Set(), replacerbeforeRequest: new Set(), replacerafterRequest: new Set(), providers: new Map() },
    pluginProcess: vi.fn(),
}))
vi.mock('../mcp/mcp', () => ({ getTools: vi.fn(async () => []), callTool: vi.fn() }))
vi.mock('../transformers', () => ({ runTransformers: vi.fn(), runImageEmbedding: vi.fn() }))
vi.mock('../../model/modellist', async () => {
    const types = await import('../../model/types')
    return {
        LLMFlags: types.LLMFlags, LLMFormat: types.LLMFormat, LLMProvider: types.LLMProvider,
        getModelInfo: (id: string) => ({ id, name: id, shortName: id, internalID: id, format: types.LLMFormat.OpenAICompatible, provider: types.LLMProvider.OpenAI, tokenizer: 0, flags: [types.LLMFlags.hasFullSystemPrompt], parameters: [] }),
    }
})
vi.mock('../request/request', () => ({
    requestChatData: vi.fn(async (arg: { formated: Array<{ role: string, content: string, multimodals?: Array<{ type?: string, base64?: string }> }> }) => {
        h.seen.push({
            formated: arg.formated.map((message) => ({
                role: message.role,
                content: message.content,
                multimodals: message.multimodals?.map((part) => ({ type: part.type, len: part.base64?.length })),
            })),
        })
        return { type: 'success', result: 'ok' }
    }),
}))
vi.mock('../../storage/database.svelte', async () => {
    const stores = await import('../../stores.svelte')
    const state = stores.DBState as unknown as { db: Database }
    return { appVer: '0.0.0', presetTemplate: {}, changeToPreset: vi.fn(), setCurrentChat: vi.fn(), setDatabase: vi.fn(), getDatabase: vi.fn(() => state.db), getCurrentCharacter: vi.fn(), getCurrentChat: vi.fn() }
})

vi.mock('../memory/hypamemory', () => ({ HypaProcesser: class { async addText() {} async similaritySearch() { return [] } } }))
vi.mock('../stableDiff', () => ({ stableDiff: vi.fn(), generateAIImage: vi.fn(async () => null) }))

const MIB = 1024 * 1024
const HEAVY_TIMEOUT_MS = 30_000

const BIG_VIDEO_TEXT = 'data:video/mp4;base64,' + 'A'.repeat(28 * MIB)
const SMALL_IMAGE_TEXT = 'data:image/png;base64,' + 'A'.repeat(64)

const ID = {
    image: 'lua-image',
    videoOver: 'lua-video-over',
    gone: 'lua-gone',
}

let runLuaButtonTrigger: typeof import('../scriptings').runLuaButtonTrigger
let DBState: { db: Database }
let appStore: MemoryByteStore

function asset(data: string, extra: Record<string, unknown> = {}): InlayAsset {
    return { name: 'clip.mp4', ext: 'mp4', type: 'video', data, ...extra } as InlayAsset
}

function bodyReadsOf(id: string): string[] {
    const bytes = appStore.files.get(inlayMetaKey(id) as string)
    expect(bytes).toBeDefined()
    const body = (JSON.parse(new TextDecoder().decode(bytes)) as InlayRecord).body
    return appStore.reads.filter((key) => key === body)
}

/** The warns that name this inlay, so unrelated warns from the inlays code do not count. */
function warnsNaming(warn: { mock: { calls: unknown[][] } }, id: string): unknown[][] {
    return warn.mock.calls.filter((args) => args.some((arg) => String(arg).includes(id)))
}

beforeAll(async () => {
    const { readFile } = await import('node:fs/promises')
    const jsonLua = await readFile(fileURLToPath(new URL('../../../../public/lua/json.lua', import.meta.url)), 'utf8')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(jsonLua, { status: 200 })))
    resetBusyActionsForTest()
    appStore = createMemoryByteStore({})
    injectAppStore(appStore)
    await setInlayAsset(ID.image, asset(SMALL_IMAGE_TEXT, { name: 'pic.png', ext: 'png', type: 'image' }))
    await setInlayAsset(ID.videoOver, asset(BIG_VIDEO_TEXT))
    runLuaButtonTrigger = (await import('../scriptings')).runLuaButtonTrigger
    DBState = (await import('../../stores.svelte')).DBState as unknown as { db: Database }
}, HEAVY_TIMEOUT_MS)

beforeEach(() => {
    h.seen.length = 0
    h.marks.length = 0
    appStore.reads.length = 0
})

afterEach(() => {
    vi.restoreAllMocks()
})

function chat(id: string) {
    return { id, note: '', name: '', localLore: [], fmIndex: -1, message: [], scriptstate: {}, GLGlobalVariables: {}, modules: [] }
}
function luaTrig(code: string) { return { comment: 'lua', type: 'start', conditions: [], effect: [{ type: 'triggerlua', code }] } }
function installLuaCharacter(code: string): unknown {
    const character = { chaId: 'a', name: 'Alice', type: 'character', chatPage: 0, chats: [chat('c1')], triggerscript: [luaTrig(code)], modules: [], customscript: [], globalLore: [], lowLevelAccess: true, defaultVariables: '' }
    DBState.db = { characters: [character], enabledModules: [], modules: [], templateDefaultVariables: '', fallbackModels: {}, requestRetrys: 2, banCharacterset: [],
        aiModel: 'gpt-3.5-turbo', subModel: 'gpt-3.5-turbo', maxResponse: 100, temperature: 80, username: 'U', personas: [], selectedPersona: 0, seperateModelsForAxModels: false, seperateModels: {}, globalChatVariables: {} } as unknown as Database
    return DBState.db.characters[0]
}

/** Lua that sends one user message holding a tag for each id; the tags are built by concatenation. */
function luaCall(fn: 'LLM' | 'axLLM', ids: string[], multimodal: boolean): string {
    const tags = ids.map((id) => `'{' .. '{inlayed::${id}' .. '}' .. '}'`).join(' .. ')
    return `function onButtonClick(id, data)
        ${fn}(id, {{role="user", content="look " .. ${tags}}}, ${multimodal ? 'true' : 'false'})
    end`
}

/** The Lua call can return before its model request is made, so the request is waited for here. */
async function modelCalledOnce(): Promise<void> {
    await vi.waitFor(() => expect(h.seen.length, 'the model was called once').toBe(1), { timeout: 15_000 })
}

describe('the multimodal parts of a Lua model call', () => {
    for (const fn of ['LLM', 'axLLM'] as const) {
        test(`${fn} leaves out a video over the limit with one warning, keeps an unreadable id as an empty part and never reads the video body`, async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
            const character = installLuaCharacter(luaCall(fn, [ID.image, ID.videoOver, ID.gone], true))

            await runLuaButtonTrigger(character as never, 'btn')

            await modelCalledOnce()
            const parts = h.seen[0].formated[0].multimodals
            expect(parts?.map((part) => part.type)).toEqual(['image', undefined])
            expect(parts?.[0].len).toBe(SMALL_IMAGE_TEXT.length)
            expect(parts?.[1].len).toBeUndefined()
            expect(bodyReadsOf(ID.videoOver)).toEqual([])
            expect(warnsNaming(warn, ID.videoOver)).toHaveLength(1)
            expect(warnsNaming(warn, ID.image)).toHaveLength(0)
        }, HEAVY_TIMEOUT_MS)
    }

    test('guard: LLM without the multimodal flag reads no inlay and keeps the tags in the content', async () => {
        const character = installLuaCharacter(luaCall('LLM', [ID.image, ID.videoOver], false))

        await runLuaButtonTrigger(character as never, 'btn')

        await modelCalledOnce()
        const message = h.seen[0].formated[0]
        expect(message.multimodals).toBeUndefined()
        expect(message.content).toContain(`{{inlayed::${ID.videoOver}}}`)
        expect(bodyReadsOf(ID.videoOver)).toEqual([])
        expect(bodyReadsOf(ID.image)).toEqual([])
    })
})
