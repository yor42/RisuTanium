import { language } from '../../lang'
import { fillLang } from '../../lang/fill'
import { pluginFileBaseName } from './pluginExport'
import type { RisuPlugin } from './plugins.svelte'

/**
 * Per-plugin settings file (fork-only `.json`): the saved values of the arguments a plugin
 * declares. Only declared, visible arguments travel in either direction; values are validated
 * against the live declaration on import, so a file can never add an undeclared key, write a
 * value the declared kind rejects, or carry `enabled`, permissions or plugin storage.
 */

const fileType = 'risutanium-plugin-settings'
const fileVersion = 1
const maxFileBytes = 1_048_576
const nameLimit = 60
const listedKeyLimit = 10
const integerPattern = /^-?\d+(\.\d+)?$/

// Keys that would reach Object.prototype when assigned onto a plain object.
const deniedKeys: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype'])

type ArgKind = RisuPlugin['arguments'][string]
type ArgValue = string | number

export type SettingsSource = Pick<RisuPlugin, 'name' | 'versionOfPlugin' | 'arguments' | 'realArg'>

export interface PluginSettingsFile {
    type: typeof fileType
    version: typeof fileVersion
    plugin: {
        name: string
        versionOfPlugin?: string
        values: Record<string, unknown>
    }
}

export type ParsedSettingsFile =
    | { ok: true, file: PluginSettingsFile }
    | { ok: false, reason: 'json' | 'type' | 'version' | 'shape' }

export interface PluginSettingsPlan {
    /** The live `realArg` with every changed key applied; the live object is never mutated. */
    merged: RisuPlugin['realArg']
    /** Keys whose value the file would change. */
    changed: string[]
    /**
     * Values in the file that were refused: the key is undeclared, hidden or prototype-named,
     * the value does not fit the declared kind, or it is blank over a non-empty live value.
     * Values equal to the live ones are neither changed nor skipped.
     */
    skipped: number
}

const hasOwn = (target: object, key: string): boolean => Object.prototype.hasOwnProperty.call(target, key)
const isHidden = (key: string): boolean => key.startsWith('hidden_')
const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

/** The value as the live declaration accepts it, or undefined when it does not conform. */
function conformingValue(kind: ArgKind | undefined, value: unknown): ArgValue | undefined {
    if (kind === 'int') {
        if (typeof value === 'number') {
            return Number.isFinite(value) ? value : undefined
        }
        return typeof value === 'string' && integerPattern.test(value) ? value : undefined
    }
    if (kind === 'string') {
        return typeof value === 'string' ? value : undefined
    }
    if (Array.isArray(kind)) {
        return typeof value === 'string' && kind.includes(value) ? value : undefined
    }
    return undefined
}

/** The stored value in the form it is exported, or undefined when it is not exportable. */
function exportableValue(kind: ArgKind | undefined, stored: unknown): ArgValue | undefined {
    if (kind === 'string' && typeof stored === 'number') {
        return Number.isFinite(stored) ? String(stored) : undefined
    }
    return conformingValue(kind, stored)
}

export function pluginSettingsFileName(name: string | undefined): string {
    return pluginFileBaseName(name) + '.settings.json'
}

export function isSettingsFileTooLarge(byteLength: number): boolean {
    return byteLength > maxFileBytes
}

/** The first plugin with this exact name; tolerates a missing list. */
export function findPluginByName(list: RisuPlugin[] | undefined, name: string): RisuPlugin | undefined {
    return (list ?? []).find((p) => p.name === name)
}

export function serializePluginSettings(plugin: SettingsSource): string {
    const values: Record<string, ArgValue> = {}
    const stored = plugin.realArg ?? {}
    for (const key of Object.keys(plugin.arguments ?? {})) {
        if (isHidden(key) || deniedKeys.has(key) || !hasOwn(stored, key)) {
            continue
        }
        const value = exportableValue(plugin.arguments[key], stored[key])
        if (value !== undefined) {
            values[key] = value
        }
    }
    const file: PluginSettingsFile = {
        type: fileType,
        version: fileVersion,
        plugin: { name: plugin.name, values },
    }
    if (typeof plugin.versionOfPlugin === 'string') {
        file.plugin.versionOfPlugin = plugin.versionOfPlugin
    }
    return JSON.stringify(file, null, 2)
}

export function parsePluginSettingsFile(text: string): ParsedSettingsFile {
    let data: unknown
    try {
        data = JSON.parse(text.replace(/^\uFEFF/, ''))
    } catch {
        return { ok: false, reason: 'json' }
    }
    if (!isRecord(data)) {
        return { ok: false, reason: 'shape' }
    }
    if (data.type !== fileType) {
        return { ok: false, reason: 'type' }
    }
    if (data.version !== fileVersion) {
        return { ok: false, reason: 'version' }
    }
    const plugin = data.plugin
    if (!isRecord(plugin) || typeof plugin.name !== 'string' || !isRecord(plugin.values)) {
        return { ok: false, reason: 'shape' }
    }
    const values: Record<string, unknown> = {}
    for (const key of Object.keys(plugin.values)) {
        if (!deniedKeys.has(key)) {
            values[key] = plugin.values[key]
        }
    }
    const file: PluginSettingsFile = {
        type: fileType,
        version: fileVersion,
        plugin: { name: plugin.name, values },
    }
    if (typeof plugin.versionOfPlugin === 'string') {
        file.plugin.versionOfPlugin = plugin.versionOfPlugin
    }
    return { ok: true, file }
}

/**
 * What applying `values` to `live` would do, judged against the live declaration. A value is
 * skipped when the key is not declared or is hidden, the value does not conform to the declared
 * kind, or it is blank where the live value is not. Never mutates `live`.
 */
export function planPluginSettings(live: Pick<RisuPlugin, 'arguments' | 'realArg'>, values: Record<string, unknown>): PluginSettingsPlan {
    const declared = live.arguments ?? {}
    const stored = live.realArg ?? {}
    const merged: RisuPlugin['realArg'] = {}
    for (const key of Object.keys(stored)) {
        if (!deniedKeys.has(key)) {
            merged[key] = stored[key]
        }
    }
    const changed: string[] = []
    let skipped = 0
    for (const key of Object.keys(values)) {
        if (deniedKeys.has(key) || !hasOwn(declared, key) || isHidden(key)) {
            skipped++
            continue
        }
        const kind = declared[key]
        const value = conformingValue(kind, values[key])
        if (value === undefined) {
            skipped++
            continue
        }
        const current = hasOwn(stored, key) ? stored[key] : undefined
        if (value === '' && current !== undefined && current !== '') {
            skipped++
            continue
        }
        const same = current !== undefined && (kind === 'int' ? Number(current) === Number(value) : current === value)
        if (!same) {
            merged[key] = value
            changed.push(key)
        }
    }
    return { merged, changed, skipped }
}

/**
 * The keys to write after the replace confirmation: those the file still changes that the user
 * confirmed. A key that became changeable only while the dialog was open was never shown to the
 * user and is left alone.
 */
export function selectWriteKeys(changedNow: string[], confirmed: string[]): string[] {
    return changedNow.filter((key) => confirmed.includes(key))
}

/** Writes the chosen keys of `merged` into the live entry's `realArg` in place. */
export function applyPluginSettings(entry: Pick<RisuPlugin, 'realArg'>, merged: RisuPlugin['realArg'], keys: string[]): void {
    const next: RisuPlugin['realArg'] = { ...entry.realArg }
    for (const key of keys) {
        if (!deniedKeys.has(key) && hasOwn(merged, key)) {
            next[key] = merged[key]
        }
    }
    entry.realArg = next
}

const shorten = (text: string): string => (text.length > nameLimit ? text.slice(0, nameLimit) + '…' : text)

/** Everything the dialogs and file operations need, injected so the flows are testable. */
export interface PluginSettingsDeps {
    plugins: () => RisuPlugin[] | undefined
    select: (items: string[]) => Promise<string>
    confirm: (message: string) => Promise<boolean>
    notify: (message: string) => void
    fail: (message: string) => void
    pickFile: () => Promise<{ name: string, data: Uint8Array } | null>
    download: (fileName: string, content: string) => Promise<void>
    reload: () => Promise<void>
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * Menu behind a plugin row's settings-file button. `name` is read from the clicked row before
 * anything is awaited; the list is unkeyed, so a row object read later may be a different plugin.
 * The plugin is re-found by name after every dialog.
 */
export async function openPluginSettingsMenu(name: string, deps: PluginSettingsDeps): Promise<void> {
    const text = language.pluginSettingsFile
    const choice = parseInt(await deps.select([text.exportAction, text.importAction, language.cancel]))
    if (choice === 0) {
        await exportPluginSettings(name, deps)
    } else if (choice === 1) {
        await importPluginSettings(name, deps)
    }
}

export async function exportPluginSettings(name: string, deps: PluginSettingsDeps): Promise<void> {
    const text = language.pluginSettingsFile
    if (!(await deps.confirm(text.exportWarn))) {
        return
    }
    const fresh = findPluginByName(deps.plugins(), name)
    if (!fresh) {
        deps.fail(text.pluginGone)
        return
    }
    const content = serializePluginSettings(fresh)
    const fileName = pluginSettingsFileName(fresh.name)
    try {
        await deps.download(fileName, content)
    } catch (error) {
        deps.fail(fillLang(text.exportFailed, { error: errorText(error) }))
    }
}

export async function importPluginSettings(name: string, deps: PluginSettingsDeps): Promise<void> {
    const text = language.pluginSettingsFile
    const picked = await deps.pickFile()
    if (!picked) {
        return
    }
    if (isSettingsFileTooLarge(picked.data.length)) {
        deps.fail(text.badFile)
        return
    }
    const parsed = parsePluginSettingsFile(new TextDecoder('utf-8').decode(picked.data))
    if (!parsed.ok) {
        deps.fail(text.badFile)
        return
    }
    const { values } = parsed.file.plugin
    let fresh = findPluginByName(deps.plugins(), name)
    if (!fresh) {
        deps.fail(text.pluginGone)
        return
    }
    if (parsed.file.plugin.name !== name) {
        const proceed = await deps.confirm(fillLang(text.nameMismatch, {
            file: shorten(parsed.file.plugin.name),
            plugin: shorten(name),
        }))
        if (!proceed) {
            return
        }
        fresh = findPluginByName(deps.plugins(), name)
        if (!fresh) {
            deps.fail(text.pluginGone)
            return
        }
    }
    const shown = fresh
    const first = planPluginSettings(shown, values)
    if (first.changed.length === 0) {
        deps.notify(fillLang(text.nothingChanged, { plugin: shorten(name) }))
        return
    }
    const confirmedKeys = first.changed
    const labels = confirmedKeys.map((key) => shorten(shown.argMeta?.[key]?.name || key))
    const listed = labels.slice(0, listedKeyLimit)
    if (labels.length > listedKeyLimit) {
        listed.push(fillLang(text.moreNames, { count: labels.length - listedKeyLimit }))
    }
    const accepted = await deps.confirm(fillLang(text.replaceConfirm, {
        count: confirmedKeys.length,
        plugin: shorten(name),
        names: listed.join('\n'),
    }))
    if (!accepted) {
        return
    }

    // No await from here to the write: the plugin may have changed its own values while the
    // dialog was open, and the write must judge the entry as it is now.
    const target = findPluginByName(deps.plugins(), name)
    if (!target) {
        deps.fail(text.pluginGone)
        return
    }
    const plan = planPluginSettings(target, values)
    const writeKeys = selectWriteKeys(plan.changed, confirmedKeys)
    if (writeKeys.length === 0) {
        deps.notify(fillLang(text.nothingChanged, { plugin: shorten(name) }))
        return
    }
    applyPluginSettings(target, plan.merged, writeKeys)

    if (target.enabled) {
        try {
            await deps.reload()
        } catch (error) {
            deps.fail(fillLang(text.reloadFailed, { error: errorText(error) }))
            return
        }
    }
    deps.notify(fillLang(text.result, {
        applied: writeKeys.length,
        plugin: shorten(name),
        skipped: plan.skipped + (plan.changed.length - writeKeys.length),
    }))
}
