import { get, writable } from "svelte/store";
import { language } from "../../lang";
import { fillLang } from "../../lang/fill";
import { getCurrentCharacter, getDatabase, setDatabase, setDatabaseLite } from "../storage/database.svelte";
import { alertConfirm, alertError, alertPluginConfirm } from "../alert";
import { selectFileByDom, sleep } from "../util";
import type { OpenAIChat } from "../process/index.svelte";
import { fetchNative, globalFetch, readImage, saveAsset, toGetter } from "../globalApi.svelte";
import { DBState, hotReloading, selectedCharID } from "../stores.svelte";
import type { ScriptMode } from "../process/scripts";
import { SafeDocument, SafeIdbFactory, SafeLocalStorage } from "./pluginSafeClass";
import { loadV3Plugins } from "./apiV3/v3.svelte";
import { pluginCodeTranspiler } from "./apiV3/transpiler";
import { markCharacterForSave } from "../storage/characterSaveMarks";
import { incomingCharacterRefusal, withoutStubDowngrades } from "./stubDowngrade";
import { databaseWriteProblem, singleCharacterProblem } from "./characterWriteCheck";
import { PLUGIN_STORAGE_INDEX_KEY, PLUGIN_STORAGE_LEGACY_MAP_KEY } from "../process/pluginStorageIndex";
import {
    apiVersionRefusal,
    applyPluginChanges,
    carrySavedValues,
    classifyPluginList,
    compareVersions,
    parsePluginHeader,
    pluginEntryFromHeader,
    type PluginListClassification,
} from "./pluginListMerge";
import {
    applyPluginBatch,
    capReviewLines,
    classifyPluginBatch,
    type PluginBatchFailure,
    type PreparedPlugin,
} from "./pluginBatch";
import { clearSupaMemoryIfEmptyIn } from "../process/memory/supaResume";
import {
    fillMissingCharacterInstallIds,
    fillMissingDatabaseInstallIds,
    warnDuplicatesInDatabaseInstall,
    warnIfCharacterChaIdDuplicated,
    warnIfCharacterInstallDuplicatesChatIds,
} from "../process/chatIds";

export const customProviderStore = writable([] as string[])

interface ProviderPlugin {
    name: string
    displayName?: string
    script: string
    arguments: { [key: string]: 'int' | 'string' | string[] }
    realArg: { [key: string]: number | string }
    version?: 1 | 2 | '2.1' | '3.0'
    customLink: ProviderPluginCustomLink[]
    argMeta: { [key: string]: {[key:string]:string} }
    versionOfPlugin?: string
    updateURL?: string
    enabled?: boolean
    allowedIPC?: string[]
}
interface ProviderPluginCustomLink {
    link: string
    hoverText?: string
}

export type RisuPlugin = ProviderPlugin

export async function createBlankPlugin(){
    await importPlugin(
`
//@name New Plugin
//@display-name New Plugin Display Name
//@api 3.0
//@arg example_arg string

Risuai.log("Hello from New Plugin!");
`.trim()
    )
}

const updateCache = new Map<string, { version: string, updateURL: string } | undefined>();

export const checkPluginUpdate = async (plugin: RisuPlugin) => {
    try {
        if(!plugin.updateURL){
            return
        }

        if(updateCache.has(plugin.name)){
            const cached = updateCache.get(plugin.name)
            if(compareVersions(cached.version, plugin.versionOfPlugin || '0.0.0') === 1){
                return cached
            }
        }

        const response = (await fetch(plugin.updateURL, {
            method: 'GET',
            headers: {
                'Range': 'bytes=0-512'
            }
        }))

        if(response.status >= 200 && response.status < 300){
            const text = await response.text()
            const versioRegex = /\/\/@version\s+([^\s]+)/;
            const match = text.match(versioRegex);
            if(match && match[1]){
                const latestVersion = match[1].trim()
                if(compareVersions(latestVersion, plugin.versionOfPlugin || '0.0.0') === 1){
                    updateCache.set(plugin.name, {
                        version: latestVersion,
                        updateURL: plugin.updateURL
                    })
                    return {
                        version: latestVersion,
                        updateURL: plugin.updateURL
                    }
                }
            }
        }
    } catch (error) {
        console.warn('Failed to check plugin update:', error)
    }
}

export async function updatePlugin(plugin: RisuPlugin) {
    try {
        if(!plugin.updateURL){
            return false
        }
        const response = await fetch(plugin.updateURL)
        if(response.status >= 200 && response.status < 300){
            const jsFile = await response.text()
            await importPlugin(jsFile, {
                isUpdate: true,
                originalPluginName: plugin.name
            })
            return true
        }
    } catch (error) {
        console.error('Failed to update plugin:', error)
    }
    return false
}

export async function importPlugin(code:string|null = null, argu:{
    isUpdate?: boolean
    originalPluginName?: string
    isHotReload?: boolean
    isTypescript?: boolean
} = {}) {
    if(!code){
        return importPluginFromPicker()
    }
    return importPluginSource(code, argu.isTypescript || false, argu)
}

/** The plugin file picker: one file takes the single-file path, two or more are reviewed together. Nothing picked is silent. */
async function importPluginFromPicker() {
    try {
        const files = await selectFileByDom(['js','ts'], 'multiple')
        if (!files || files.length === 0) {
            return
        }
        const sources: PluginPickedSource[] = []
        for (const f of files) {
            //support utf-8 with BOM or without BOM
            const text = Buffer.from(new Uint8Array(await f.arrayBuffer())).toString('utf-8').replace(/^\uFEFF/gm, "")
            sources.push({ file: f.name, text, isTypescript: f.name.endsWith('.ts') })
        }
        if (sources.length === 1) {
            return await importPluginSource(sources[0].text, sources[0].isTypescript, {})
        }
        return await importPluginBatch(sources)
    } catch (error) {
        console.error(error)
        alertError(language.errors.noData)
    }
}

interface PluginPickedSource {
    file: string
    text: string
    isTypescript: boolean
}

/** Header, API and transpile checks for one file of a batch; a refusal names the file and the reason. */
async function preparePluginFile(source: PluginPickedSource): Promise<PreparedPlugin | PluginBatchFailure> {
    const header = parsePluginHeader(source.text)
    if ('error' in header) {
        return { file: source.file, reason: header.error }
    }
    const apiRefusal = apiVersionRefusal(header.apiVersion)
    if (apiRefusal !== null) {
        return { file: source.file, reason: apiRefusal }
    }
    let script = source.text
    if (source.isTypescript) {
        try {
            script = await pluginCodeTranspiler(script)
        } catch (error) {
            return { file: source.file, reason: language.pluginBatchTranspileFailed(error instanceof Error ? error.message : String(error)) }
        }
    }
    return { file: source.file, entry: pluginEntryFromHeader(script, header) }
}

/** Two or more files: one review for the whole pick, then one write and one reload. */
async function importPluginBatch(sources: PluginPickedSource[]) {
    const prepared: PreparedPlugin[] = []
    const failures: PluginBatchFailure[] = []
    for (const source of sources) {
        const result = await preparePluginFile(source)
        if ('entry' in result) {
            prepared.push(result)
        } else {
            failures.push(result)
        }
    }

    const classified = classifyPluginBatch(getDatabase().plugins ?? [], prepared, language.pluginBatchRepeated)
    const failed = [...failures, ...classified.failed]
    if (classified.news.length + classified.updates.length === 0) {
        const details = failed.map((item) => `${item.file}: ${item.reason}`).join('\n')
        alertError(language.importFilesNotImported(failed.length, sources.length, details))
        return
    }

    const label = (entry: RisuPlugin) => entry.displayName || entry.name
    const section = (lines: string[]) => capReviewLines(lines, language.pluginBatchMore).join('\n')
    const confirmed = await alertConfirm(language.pluginBatchReview(
        section(classified.news.map((item) => `${label(item.entry)} (${item.file})`)),
        section(classified.updates.map((item) => `${label(item.entry)} (${item.file}): ${item.fromVersion || '-'} -> ${item.toVersion || '-'}`)),
        section(failed.map((item) => `${item.file}: ${item.reason}`)),
    ))
    if (!confirmed) {
        return
    }

    // The installed list is read again here: it may have changed while the review was open.
    const db = getDatabase()
    db.plugins ??= []
    applyPluginBatch(db.plugins, [...classified.news, ...classified.updates].map((item) => item.entry))
    console.log(`Imported plugins: ${classified.news.length} new, ${classified.updates.length} updated`)
    setDatabaseLite(db)
    loadPlugins()
}

async function importPluginSource(code:string, isTypescript:boolean, argu:{
    isUpdate?: boolean
    originalPluginName?: string
    isHotReload?: boolean
}) {
    try {
        let jsFile = code
        let db = getDatabase()
        let isUpdate = argu.isUpdate || false
        let originalPluginName = argu.originalPluginName || ''

        const splitedJs = jsFile.split('\n')
        let name = ''
        for (const line of splitedJs) {
            if (line.startsWith('//@name')) {
                name = line.slice(7).trim()
                break
            }
        }

        const showError = (msg: string) => {
            if(argu.isHotReload){
                console.error(`Hot-reload plugin "${name}" error: ${msg}`)
            }
            else{
                alertError(msg)
            }
        }

        const header = parsePluginHeader(jsFile)
        if ('error' in header) {
            showError(header.error)
            return
        }

        if(isTypescript){
            try {
                jsFile = await pluginCodeTranspiler(jsFile)                
            } catch (error) {
                showError('Failed to transpile TypeScript code: ' + error.message)
            }
        }

        const apiRefusal = apiVersionRefusal(header.apiVersion)
        if(apiRefusal !== null){
            showError(apiRefusal)
            return
        }

        const pluginData: RisuPlugin = pluginEntryFromHeader(jsFile, header)

        db.plugins ??= []

        const oldPluginIndex = db.plugins.findIndex((p: RisuPlugin) => p.name === pluginData.name);

        if(originalPluginName && originalPluginName !== pluginData.name){
            showError(fillLang(language.errors.pluginNameChangeBlocked, { original: `${originalPluginName}`, new: `${pluginData.name}` }))
            return
        }


        if(!isUpdate && oldPluginIndex !== -1){
            const c = await alertConfirm(language.duplicatePluginFoundUpdateIt)
            if(!c){
                return
            }
        }

        // The installed copy is found by name here, after the prompt, because the list may have changed while it was open.
        const replaceIndex = db.plugins.findIndex((p: RisuPlugin) => p.name === pluginData.name);

        if(replaceIndex !== -1){
            // Saved values and the on/off state come from the installed copy as it is now, not as it was before the prompt. Hot reload switches the plugin on.
            const carried = carrySavedValues(db.plugins[replaceIndex], pluginData)
            db.plugins[replaceIndex] = argu.isHotReload ? { ...carried, enabled: true } : carried;
        }
        else if(!isUpdate || argu.isHotReload){
            db.plugins.push(pluginData)
        }

        if(argu.isHotReload && !hotReloading.includes(pluginData.name)){
            hotReloading.push(pluginData.name)
        }

        console.log(`Imported plugin: ${pluginData.name} (API v${header.apiVersion})`)
        setDatabaseLite(db)

        loadPlugins()
        
    } catch (error) {
        console.error(error)
        alertError(language.errors.noData)
    }
}

let pluginTranslator = false

export async function loadPlugins() {
    console.log('Loading plugins...')
    let db = getDatabase()


    const enabledPlugins = safeStructuredClone(db.plugins).filter((p: RisuPlugin) => p.enabled)
    const pluginV2 = enabledPlugins.filter((a: RisuPlugin) => a.version === 2)
    const pluginV3 = enabledPlugins.filter((a: RisuPlugin) => a.version === '3.0')

    await loadV2Plugin(pluginV2)
    await loadV3Plugins(pluginV3)
}

/**
 * Flips a plugin on or off from the plugin settings and reloads the plugins.
 * A V2.1 plugin never runs, so its saved `enabled` is left as it is.
 */
export async function togglePluginEnabled(plugin: RisuPlugin): Promise<void> {
    if (plugin.version === '2.1') {
        return
    }
    plugin.enabled = !plugin.enabled
    return loadPlugins()
}

export type PluginV2ProviderArgument = {
    prompt_chat: OpenAIChat[]
    frequency_penalty: number
    min_p: number
    presence_penalty: number
    repetition_penalty: number
    top_k: number
    top_p: number
    temperature: number
    mode: string
    max_tokens: number
}

export type PluginV2ProviderOptions = {
    tokenizer?: string
    tokenizerFunc?: (content: string) => number[] | Promise<number[]>
}

export type EditFunction = (content: string) => string | null | undefined | Promise<string | null | undefined>
type ReplacerFunction = (content: OpenAIChat[], type: string) => OpenAIChat[] | Promise<OpenAIChat[]>
type ChatOutputListenerArg = { char: any, chat: any, characterIndex: number, chatIndex: number, messageIndex: number }
type ChatOutputListener = (arg: ChatOutputListenerArg) => void | Promise<void>

export const pluginV2 = {
    providers: new Map<string, (arg: PluginV2ProviderArgument, abortSignal?: AbortSignal) => Promise<{ success: boolean, content: string | ReadableStream<string> }>>(),
    providerOptions: new Map<string, PluginV2ProviderOptions>(),
    editdisplay: new Set<EditFunction>(),
    editoutput: new Set<EditFunction>(),
    editprocess: new Set<EditFunction>(),
    editinput: new Set<EditFunction>(),
    replacerbeforeRequest: new Set<ReplacerFunction>(),
    replacerafterRequest: new Set<(content: string, type: string) => string | Promise<string>>(),
    chatOutput: new Set<ChatOutputListener>(),
    unload: new Set<() => void | Promise<void>>(),
    loaded: false
}

export const allowedDbKeys = [
    'characters',
    'modules',
    'enabledModules',
    'moduleIntergration',
    'pluginV2',
    'personas',
    'plugins',
    'pluginCustomStorage',
    'temperature',
    'askRemoval',
    'maxContext',
    'maxResponse',
    'frequencyPenalty',
    'PresensePenalty',
    'theme',
    'textTheme',
    'lineHeight',
    'seperateModelsForAxModels',
    'seperateModels',
    'customCSS',
    'guiHTML',
    'colorSchemeName',
    'selectedPersona',
    'characterOrder'
]

//#region plugin-list writes

/** The first line of `value`, cut to a length a prompt can show. Names and versions go into prompts and messages through this. */
function oneLine(value: unknown): string {
    const first = String(value ?? '').split(/[\r\n]/)[0]
    return first.length > 200 ? first.slice(0, 200) + '...' : first
}

/** Fills `{plugin}`, `{source}`, `{from}` and `{to}` in a prompt. A function replacer keeps `$` sequences in a value literal. */
function fillPrompt(template: string, values: { plugin?: string, source?: string, from?: string, to?: string }): string {
    return template.replace(/\{(plugin|source|from|to)\}/g, (match: string, key: 'plugin' | 'source' | 'from' | 'to') => {
        const value = values[key]
        return value === undefined ? match : oneLine(value)
    })
}

/** An error whose message carries everything the plugin needs: only the message crosses the plugin bridge. */
function pluginListFailure(parts: string[]): Error {
    return new Error(`${parts.join(' ')} The plugin list was not changed; the other data in this call was saved.`)
}

const endSentence = (text: string): string => (text.endsWith('.') ? text : `${text}.`)

type PluginListPlan =
    | { kind: 'idle' }
    | { kind: 'failed', error: Error }
    | { kind: 'changes', classified: PluginListClassification }

/**
 * Classifies the `plugins` value of a plugin's write against the installed
 * list and finds every failure that is already known, before anything is
 * asked: a value that is not an array, a refused entry, and the caller's own
 * entry with a script that is not newer than the installed one. Nothing is
 * changed here.
 */
function planPluginListWrite(value: unknown, callerName: string | undefined): PluginListPlan {
    if (!Array.isArray(value)) {
        const sender = callerName === undefined ? '' : ` sent by plugin "${oneLine(callerName)}"`
        return { kind: 'failed', error: pluginListFailure([`The plugins value${sender} is not an array.`]) }
    }
    const classified = classifyPluginList(getDatabase().plugins ?? [], value)
    const who = callerName === undefined ? 'A plugin' : `Plugin ${oneLine(callerName)}`
    for (const ignored of classified.ignored) {
        if (ignored.warning !== null) {
            console.warn(`[WARN] ${who} wrote the plugin list: ${ignored.warning}`)
        }
    }

    const problems: string[] = []
    for (const refusal of classified.refused) {
        problems.push(`Plugin "${oneLine(refusal.name)}" was refused: ${endSentence(refusal.reason)}`)
    }
    if (callerName !== undefined) {
        for (const ignored of classified.ignored) {
            if (ignored.kind === 'not-newer' && ignored.name === callerName) {
                problems.push(`Plugin "${oneLine(callerName)}" was not updated: its script is not newer than installed ${oneLine(callerName)} ${ignored.installedVersion === undefined ? '(no version)' : oneLine(ignored.installedVersion)}. A script only counts as an update when its //@version is newer than the installed version.`)
            }
        }
    }
    if (problems.length > 0) {
        return { kind: 'failed', error: pluginListFailure(problems) }
    }
    if (classified.updates.length === 0 && classified.installs.length === 0) {
        return { kind: 'idle' }
    }
    return { kind: 'changes', classified }
}

/** Asks about every update and install, in incoming order, and stops at the first decline. Returns the failure for a decline, or null. */
async function askPluginChanges(classified: PluginListClassification, callerName: string | undefined): Promise<Error | null> {
    const asks = [
        ...classified.updates.map((update) => ({
            index: update.index,
            verb: 'Updating',
            name: update.name,
            text: callerName === update.name
                ? fillPrompt(language.confirmUpdatePluginSelf, { plugin: update.name, from: update.fromVersion, to: update.toVersion })
                : callerName === undefined
                    ? fillPrompt(language.confirmUpdatePluginViaUnknownPlugin, { plugin: update.name, from: update.fromVersion, to: update.toVersion })
                    : fillPrompt(language.confirmUpdatePluginViaPlugin, { source: callerName, plugin: update.name, from: update.fromVersion, to: update.toVersion }),
        })),
        ...classified.installs.map((install) => ({
            index: install.index,
            verb: 'Installing',
            name: install.name,
            text: callerName === undefined
                ? fillPrompt(language.confirmInstallPluginViaUnknownPlugin, { plugin: install.name })
                : fillPrompt(language.confirmInstallPluginViaPlugin, { source: callerName, plugin: install.name }),
        })),
    ].sort((left, right) => left.index - right.index)

    for (const ask of asks) {
        if (!(await alertConfirm(ask.text))) {
            return pluginListFailure([`${ask.verb} plugin "${oneLine(ask.name)}" was declined by the user.`])
        }
    }
    return null
}

/**
 * Applies the accepted changes to the installed list as it is now and assigns
 * the result as a new array. Returns the failure when a change cannot be
 * applied, with the list untouched. Synchronous: callers keep it in one step
 * with the writes that follow it.
 */
function commitPluginChanges(classified: PluginListClassification): Error | null {
    const db = getDatabase()
    const applied = applyPluginChanges(db.plugins ?? [], classified)
    if (!Array.isArray(applied)) {
        return pluginListFailure(applied.failed.map((problem) => problem.reason === 'taken'
            ? `Plugin "${oneLine(problem.name)}" changed meanwhile: a plugin with that name was installed while the prompt was open.`
            : `Plugin "${oneLine(problem.name)}" changed meanwhile: it was ${problem.reason} while the prompt was open.`))
    }
    db.plugins = applied
    return null
}

/**
 * Writes every key of a plugin's write except `plugins`. `characters` is
 * reconciled against the live list at this moment, so a character restored
 * while a prompt was open is not downgraded. Returns the object that was
 * written, which is a copy when a placeholder was swapped out.
 */
function writeSetterKeys(db: ReturnType<typeof getDatabase>, newDb: any, pluginName: string | undefined) {
    db.pluginCustomStorage ??= {}
    newDb = withoutStubDowngrades(db.characters, newDb, pluginName)
    if (Array.isArray(newDb.characters)) {
        const beforeCharacters = db.characters
        fillMissingDatabaseInstallIds(newDb)
        warnDuplicatesInDatabaseInstall(newDb, beforeCharacters, pluginName)
    }
    for (const key of Object.keys(newDb)) {
        if (key === 'plugins') {
            continue
        }
        if (key === 'pluginCustomStorage') {
            db.pluginCustomStorage = keepPluginStorageInternals(db.pluginCustomStorage, newDb[key]);
        }
        else if (allowedDbKeys.includes(key)) {
            (db as any)[key] = newDb[key];
        }
        else{
            db.pluginCustomStorage[key] = newDb[key];
        }
    }
    // Cleared through the live list: the reactive proxy's set trap does not write to the raw
    // object, so the stored chats are cleared through the stored reference.
    if (Array.isArray(newDb.characters)) {
        clearSupaMemoryIfEmptyIn(db.characters)
    }
    return newDb
}

/**
 * Unit ids named by a `_coldplugin` map: only string values count.
 */
function pluginStorageUnitIds(storage: {[key:string]:any} | undefined): string[] {
    const map = storage?.[PLUGIN_STORAGE_LEGACY_MAP_KEY]
    if (!map || typeof map !== 'object' || Array.isArray(map)) {
        return []
    }
    return Object.values(map).filter((id): id is string => typeof id === 'string')
}

/**
 * The plugin storage index pointer, the `_coldplugin` slot map and the units it
 * names belong to the storage layer, not to plugins. A plugin writing back a
 * stale, edited or non-object pluginCustomStorage (or clearing it) must never
 * replace, roll back or introduce them. On a legacy page the units are separate
 * files that a later cleanup deletes once the map stops naming them; on a
 * store2 page each unit's value is the entry `pluginCustomStorage[<unit id>]`
 * next to the map, so losing an entry leaves a slot with no value and rolling
 * one back returns an older value. Protected keys are the two internals plus every unit id the CURRENT map
 * names: each keeps its current value, or stays absent. Entries at ids only the
 * INCOMING map names are dropped so a removed slot's value is not resurrected.
 * Every other key comes from the incoming object. Returns the object to assign.
 */
function keepPluginStorageInternals(current: {[key:string]:any} | undefined, incoming: unknown): {[key:string]:any} {
    const next: {[key:string]:any} = (incoming && typeof incoming === 'object' && !Array.isArray(incoming))
        ? { ...incoming }
        : {}
    const currentIds = pluginStorageUnitIds(current)
    for (const id of pluginStorageUnitIds(next)) {
        if (!currentIds.includes(id)) {
            delete next[id]
        }
    }
    for (const key of [PLUGIN_STORAGE_INDEX_KEY, PLUGIN_STORAGE_LEGACY_MAP_KEY, ...currentIds]) {
        if (current && Object.prototype.hasOwnProperty.call(current, key)) {
            next[key] = current[key]
        }
        else {
            delete next[key]
        }
    }
    return next
}

/**
 * Mark every character, don't reload. V2's
 * getDatabase() is a live wrapper over DBState.db (see getDatabase in
 * getV2PluginAPIs), so a plugin edits live elements in place and a
 * self-assignment notifies nothing -- invisible to both the
 * selected-character effect and the identity tracker. Never deletes: a
 * character this call's own `characters` array omits still keeps its block and
 * comes back on reload -- the guarantee that a save iteration without a
 * reload can never delete a block lives in `prepareSaveIteration`'s no-reload
 * filter (globalApi.svelte.ts), not here. The same reasoning applies to
 * setDatabase.
 */
function markLiteCharacters(db: ReturnType<typeof getDatabase>, written: { characters?: unknown }) {
    if (Array.isArray(written.characters)) {
        for (const char of db.characters ?? []) {
            markCharacterForSave(char?.chaId);
        }
    }
}

//#endregion

export const getV2PluginAPIs = () => {
    return {
        risuFetch: globalFetch,
        nativeFetch: fetchNative,
        getArg: (arg: string) => {
            const db = getDatabase()
            const [name, realArg] = arg.split('::')
            for (const plugin of db.plugins) {
                if (plugin.name === name) {
                    return plugin.realArg[realArg]
                }
            }
        },
        getChar: () => {
            return getCurrentCharacter({ snapshot: true })
        },
        setChar: (char: any, pluginName?: string) => {
            if (incomingCharacterRefusal(char, pluginName)) {
                return
            }
            const db = getDatabase()
            const charid = get(selectedCharID)
            const replaced = charid >= 0 ? db.characters[charid] : undefined
            const problem = singleCharacterProblem(char, replaced)
            if (problem !== null) {
                throw new Error(problem)
            }
            fillMissingCharacterInstallIds(char)
            if (replaced) {
                warnIfCharacterChaIdDuplicated(db.characters, charid, char?.chaId, replaced?.chaId, pluginName)
                warnIfCharacterInstallDuplicatesChatIds(char?.chats, char?.chaId, db.characters, replaced?.chats, pluginName)
            }
            db.characters[charid] = char
            clearSupaMemoryIfEmptyIn([db.characters[charid]])
            setDatabaseLite(db)
        },
        addProvider: (name: string, func: (arg: PluginV2ProviderArgument, abortSignal?: AbortSignal) => Promise<{ success: boolean, content: string }>, options?: PluginV2ProviderOptions) => {
            let provs = get(customProviderStore)
            provs.push(name)
            pluginV2.providers.set(name, func)
            pluginV2.providerOptions.set(name, options ?? {})
            customProviderStore.set(provs)
        },
        addRisuScriptHandler: (name: ScriptMode, func: EditFunction) => {
            if (pluginV2['edit' + name]) {
                pluginV2['edit' + name].add(func)
            }
            else {
                throw (`script handler named ${name} not found`)
            }
        },
        removeRisuScriptHandler: (name: ScriptMode, func: EditFunction) => {
            if (pluginV2['edit' + name]) {
                pluginV2['edit' + name].delete(func)
            }
            else {
                throw (`script handler named ${name} not found`)
            }
        },
        addRisuReplacer: (name: string, func: ReplacerFunction) => {
            if (pluginV2['replacer' + name]) {
                pluginV2['replacer' + name].add(func)
            }
            else {
                throw (`replacer handler named ${name} not found`)
            }
        },
        removeRisuReplacer: (name: string, func: ReplacerFunction) => {
            if (pluginV2['replacer' + name]) {
                pluginV2['replacer' + name].delete(func)
            }
            else {
                throw (`replacer handler named ${name} not found`)
            }
        },
        addRisuChatListener: (mode: string, func: ChatOutputListener) => {
            if (mode === 'output') {
                pluginV2.chatOutput.add(func)
            }
            else {
                throw (`chat listener mode ${mode} not found`)
            }
        },
        removeRisuChatListener: (mode: string, func: ChatOutputListener) => {
            if (mode === 'output') {
                pluginV2.chatOutput.delete(func)
            }
            else {
                throw (`chat listener mode ${mode} not found`)
            }
        },
        onUnload: (func: () => void | Promise<void>) => {
            pluginV2.unload.add(func)
        },
        setArg: (arg: string, value: string | number) => {
            const db = getDatabase();
            const [name, realArg] = arg.split("::");
            for (const plugin of db.plugins) {
                if (plugin.name === name) {
                    plugin.realArg[realArg] = value;
                }
            }
        },
        safeGlobalThis: {} as any,
        getSafeGlobalThis: () => {
            if(Object.keys(globalThis.__pluginApis__.safeGlobalThis).length > 0){
                return globalThis.__pluginApis__.safeGlobalThis;
            }
            //safeGlobalThis
            const keys = Object.keys(globalThis);
            const safeGlobal: any = {};
            const allowedKeys = [
                'console',
                'TextEncoder',
                'TextDecoder',
                'URL',
                'URLSearchParams',
            ]
            for (const key of keys) {
                if(allowedKeys.includes(key)){
                    safeGlobal[key] = (globalThis as any)[key];
                }
            }

            //compatibility layer with old unsafe APIs

            //from PBV2
            safeGlobal.showDirectoryPicker = window.showDirectoryPicker

            safeGlobal.DBState = {
                db: toGetter(
                    globalThis.__pluginApis__.getDatabase
                )
            }
            safeGlobal.setInterval = (...args: any[]) => {
                //@ts-expect-error spreading any[] into setInterval params causes type mismatch with TimerHandler signature
                return globalThis.setInterval(...args);
            }
            safeGlobal.setTimeout = (...args: any[]) => {
                //@ts-expect-error spreading any[] into setTimeout params causes type mismatch with TimerHandler signature
                return globalThis.setTimeout(...args);
            }
            safeGlobal.clearInterval = (...args: any[]) => {
                //@ts-expect-error spreading any[] into clearInterval - first arg should be number | undefined
                return globalThis.clearInterval(...args);
            }
            safeGlobal.clearTimeout = (...args: any[]) => {
                //@ts-expect-error spreading any[] into clearTimeout - first arg should be number | undefined
                return globalThis.clearTimeout(...args);
            }
            safeGlobal.alert = globalThis.alert;
            safeGlobal.confirm = globalThis.confirm;
            safeGlobal.prompt = globalThis.prompt;
            safeGlobal.innerWidth = window.innerWidth;
            safeGlobal.innerHeight = window.innerHeight;
            safeGlobal.getComputedStyle = window.getComputedStyle
            safeGlobal.navigator = window.navigator;
            safeGlobal.localStorage = globalThis.__pluginApis__.safeLocalStorage;
            safeGlobal.indexedDB = globalThis.__pluginApis__.safeIdbFactory;
            safeGlobal.__pluginApis__ = globalThis.__pluginApis__
            safeGlobal.Object = Object;
            safeGlobal.Array = Array;
            safeGlobal.String = String;
            safeGlobal.Number = Number;
            safeGlobal.Boolean = Boolean;
            safeGlobal.Math = Math;
            safeGlobal.Date = Date;
            safeGlobal.RegExp = RegExp;
            safeGlobal.Error = Error;
            safeGlobal.Function = globalThis.__pluginApis__.SafeFunction;
            safeGlobal.document = globalThis.__pluginApis__.safeDocument;
            safeGlobal.addEventListener = (...args: any[]) => {
                //@ts-expect-error spreading any[] into addEventListener - expects (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions)
                window.addEventListener(...args);
            }
            safeGlobal.removeEventListener = (...args: any[]) => {
                //@ts-expect-error spreading any[] into removeEventListener - expects (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions)
                window.removeEventListener(...args);
            }
            return safeGlobal;
        },
        safeLocalStorage: new SafeLocalStorage(),
        safeIdbFactory: SafeIdbFactory,
        safeDocument: SafeDocument,
        alertStore: {
            set: (msg: string) => {}
        },
        apiVersion: "2.1",
        apiVersionCompatibleWith: ["2.0","2.1"],
        getDatabase: () => {
            const db = DBState?.db
            if(!db){
                return {}
            }
            return new Proxy(db, {
                get(target, prop) {
                    if (typeof prop === 'string' && allowedDbKeys.includes(prop)) {
                        return (target as any)[prop];
                    }
                    else if(target.pluginCustomStorage){
                        console.log('Getting custom db property', prop.toString());
                        return target.pluginCustomStorage[prop.toString()];
                    }
                    return undefined;
                },
                set(target, prop, value) {
                    if (typeof prop === 'string' && allowedDbKeys.includes(prop)) {
                        if (prop === 'characters' || prop === 'modules') {
                            const problem = databaseWriteProblem(target, { [prop]: value })
                            if (problem !== null) {
                                throw new Error(problem)
                            }
                        }
                        if (prop === 'pluginCustomStorage') {
                            target.pluginCustomStorage = keepPluginStorageInternals(target.pluginCustomStorage, value);
                            return true;
                        }
                        (target as any)[prop] = value;
                        return true;
                    }
                    else{
                        console.log('Setting custom db property', prop.toString(), value);
                        target.pluginCustomStorage ??= {}
                        target.pluginCustomStorage[prop.toString()] = value;
                        return true;
                    }
                },
                ownKeys(target) {
                    const keys = Reflect.ownKeys(target).filter(key => typeof key === 'string' && allowedDbKeys.includes(key));
                    if(target.pluginCustomStorage){
                        keys.push(...Object.keys(target.pluginCustomStorage));
                    }
                    return keys;
                },
                deleteProperty(target, prop) {
                    console.log('Attempt to delete db.' + String(prop) + ' denied in safe database proxy.');
                    return false;
                },
                getPrototypeOf(target) {
                    return Reflect.getPrototypeOf(target);
                },
            })
        },
        pluginStorage: {
            getItem: (key: string) => {
                const value = getDatabase().pluginCustomStorage?.[key];
                return value ? $state.snapshot(value) : null;
            },
            setItem: (key: string, value: string) => {
                const db = getDatabase();
                db.pluginCustomStorage ??= {}
                db.pluginCustomStorage[key] = value;
            },
            removeItem: (key: string) => {
                const db = getDatabase();
                db.pluginCustomStorage ??= {}
                delete db.pluginCustomStorage[key];
            },
            clear: () => {
                const db = getDatabase();
                db.pluginCustomStorage = keepPluginStorageInternals(db.pluginCustomStorage, {});
            },
            key: (index: number) => {
                const db = getDatabase();
                db.pluginCustomStorage ??= {}
                const keys = Object.keys(db.pluginCustomStorage);
                return keys[index] || null;
            },
            keys: () => {
                const db = getDatabase();
                db.pluginCustomStorage ??= {}
                return Object.keys(db.pluginCustomStorage);
            },
            length: () => {
                const db = getDatabase();
                db.pluginCustomStorage ??= {}
                return Object.keys(db.pluginCustomStorage).length;
            }
        },
        setDatabaseLite: (newDb: any, pluginName?: string): void | Promise<void> => {
            const refusal = databaseWriteProblem(getDatabase(), newDb)
            if (refusal !== null) {
                return Promise.reject(new Error(refusal))
            }
            const plan: PluginListPlan = Object.keys(newDb).includes('plugins')
                ? planPluginListWrite(newDb.plugins, pluginName)
                : { kind: 'idle' }
            if (plan.kind !== 'changes') {
                // Nothing to ask: the other keys are written before this returns,
                // and a plugin list that cannot be applied is a rejected promise,
                // never a synchronous throw.
                const db = getDatabase()
                newDb = writeSetterKeys(db, newDb, pluginName)
                DBState.db = db
                markLiteCharacters(db, newDb)
                return plan.kind === 'failed' ? Promise.reject(plan.error) : undefined
            }
            const classified = plan.classified
            return (async () => {
                let failure = await askPluginChanges(classified, pluginName)
                // The page may have changed while the prompt was open.
                const lateRefusal = databaseWriteProblem(getDatabase(), newDb)
                if (lateRefusal !== null) {
                    throw new Error(lateRefusal)
                }
                // From here to the key writes nothing awaits, so the list and the
                // characters are checked and assigned against the same live state.
                failure ??= commitPluginChanges(classified)
                const db = getDatabase()
                newDb = writeSetterKeys(db, newDb, pluginName)
                DBState.db = db
                markLiteCharacters(db, newDb)
                if (failure) {
                    throw failure
                }
            })()
        },
        setDatabase: async (newDb: any, pluginName?: string) => {
            const refusal = databaseWriteProblem(getDatabase(), newDb)
            if (refusal !== null) {
                throw new Error(refusal)
            }
            const plan: PluginListPlan = Object.keys(newDb).includes('plugins')
                ? planPluginListWrite(newDb.plugins, pluginName)
                : { kind: 'idle' }
            let failure: Error | null = plan.kind === 'failed' ? plan.error : null
            if (plan.kind === 'changes') {
                failure = await askPluginChanges(plan.classified, pluginName)
                // The page may have changed while the prompt was open.
                const lateRefusal = databaseWriteProblem(getDatabase(), newDb)
                if (lateRefusal !== null) {
                    throw new Error(lateRefusal)
                }
            }
            // From here to the key writes nothing awaits, so the list and the
            // characters are checked and assigned against the same live state.
            if (plan.kind === 'changes' && failure === null) {
                failure = commitPluginChanges(plan.classified)
            }
            const db = getDatabase()
            newDb = writeSetterKeys(db, newDb, pluginName)
            setDatabase(db);
            // Same reasoning as markLiteCharacters -- this setter is shared by
            // both V2 (live wrapper, in-place edits) and V3 (getDatabase()
            // returns fresh snapshots; apiV3/v3.svelte.ts's makeRisuaiAPIV3()
            // wraps this same function to pass the plugin's name through), so
            // mark unconditionally rather than special-case which API version
            // called in. V3's fresh `characters` array is also new-identity to the
            // identity tracker (dbChangeEffects.svelte.ts), so this is redundant
            // (but harmless, see appendIfAbsent) for that case specifically.
            // Never deletes: see markLiteCharacters's comment -- the
            // no-reload guarantee lives in prepareSaveIteration's filter now.
            if (Array.isArray(newDb.characters)) {
                for (const char of db.characters ?? []) {
                    markCharacterForSave(char?.chaId);
                }
            }
            if (failure) {
                throw failure
            }
        },
        SafeFunction: new Proxy(Function, {
            construct(target, args) {
                return function() {
                    return globalThis.__pluginApis__.getSafeGlobalThis();
                }
            },
            
            //call too
            apply(target, thisArg, args) {
                return function() {
                    return globalThis.__pluginApis__.getSafeGlobalThis();
                }
            }

        }),
        loadPlugins: loadPlugins,
        readImage: (path:string) => {
            if(path.startsWith('assets/')){
                //trim assets/ prefix temporarily
                path = path.slice(7);
            }
            if(path.includes('/') || path.includes('\\')){
                throw new Error("readImage path cannot contain '/' or '\\' for security reasons, except assets/ prefix.");
            }
            //re-add assets/ prefix
            return readImage('assets/' + path);
        },
        saveAsset: (data:Uint8Array) => {
            return saveAsset(data);
        },

    }
}

export async function loadV2Plugin(plugins: RisuPlugin[]) {

    if (pluginV2.loaded) {
        for (const unload of pluginV2.unload) {
            await unload()
        }

        pluginV2.providers.clear()
        pluginV2.editdisplay.clear()
        pluginV2.editoutput.clear()
        pluginV2.editprocess.clear()
        pluginV2.editinput.clear()
        pluginV2.chatOutput.clear()
    }

    pluginV2.loaded = true

    globalThis.__pluginApis__ = getV2PluginAPIs()

    for (const plugin of plugins) {
        console.log('Loading V2.0 Plugin', plugin.name)

        console.warn(`Plugin 2.0 is removed and no longer supported. Please update plugin "${plugin.name}" to API version 3.0`)
    }
}

export async function translatorPlugin(text: string, from: string, to: string) {
    return false
}

export async function pluginProcess(arg: {
    prompt_chat: OpenAIChat,
    temperature: number,
    max_tokens: number,
    presence_penalty: number
    frequency_penalty: number
    bias: { [key: string]: string }
} | {}) {
    return {
        success: false,
        content: language.pluginProviderNotFound
    }
}

/**
 * The plugins of `plugins` that the user accepts to install. Writes nothing.
 * Only an entry with a name that is not installed, whose header parses, names
 * it and declares API 3.0, is asked about. Anything else is left out with a
 * warning: an installed name is an update, which goes through the plugin list.
 * `sourcePlugin` is the plugin that asks, named in the prompt.
 */
export async function handlePluginInstallViaPlugin(plugins: RisuPlugin[], sourcePlugin?: string){

    const classified = classifyPluginList(DBState.db.plugins ?? [], plugins)

    for(const ignored of classified.ignored){
        console.warn(`Plugin ${oneLine(ignored.name ?? `at ${ignored.index}`)} is not installed via plugin: ${ignored.warning ?? 'it already exists.'}`)
    }
    for(const update of classified.updates){
        console.warn(`Plugin "${oneLine(update.name)}" already exists, so it is not installed via plugin. Installed plugins are updated through the plugin list.`)
    }
    for(const refusal of classified.refused){
        console.warn(`Plugin "${oneLine(refusal.name)}" was refused for installation via plugin: ${refusal.reason}`)
    }

    const trimmedPlugins: RisuPlugin[] = []
    for(const install of classified.installs){
        const prompt = sourcePlugin === undefined
            ? fillPrompt(language.confirmInstallPluginViaUnknownPlugin, { plugin: install.name })
            : fillPrompt(language.confirmInstallPluginViaPlugin, { source: sourcePlugin, plugin: install.name })
        const confirmation = await alertConfirm(prompt)
        if(confirmation){
            trimmedPlugins.push(plugins[install.index])
        }
    }

    return trimmedPlugins
}
