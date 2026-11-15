<script lang="ts">
    import { DownloadIcon, LinkIcon, Settings2Icon, TrashIcon } from '@lucide/svelte'
    import { language } from '../../../lang'
    import { fillLang } from '../../../lang/fill'
    import { alertConfirm, alertError, alertNormal, alertSelect } from '../../../ts/alert'
    import { loadPlugins, togglePluginEnabled, updatePlugin, type RisuPlugin } from '../../../ts/plugins/plugins.svelte'
    import { pluginExportFile } from '../../../ts/plugins/pluginExport'
    import { openPluginSettingsMenu, undoPluginSettings, type PluginSettingsUndo } from '../../../ts/plugins/pluginSettingsFile'
    import { pluginAccess, pluginSwitchMode, pluginVersionLine } from '../../../ts/setting/pluginAccess'
    import { pluginRemovalUndoAction, removePluginEntry } from '../../../ts/setting/pluginRemoval'
    import { DBState, hotReloading } from '../../../ts/stores.svelte'
    import { postToast, postUndoToast } from '../../../ts/toast/toastHost.svelte'
    import PluginArgsPanel from './PluginArgsPanel.svelte'

    /**
     * One installed plugin. A plugin that cannot run (any API other than 3.0) is data only: it names the API it
     * needs, its switch is disabled and shows Off whatever is saved, and export, update and remove still work.
     */
    interface Props {
        plugin: RisuPlugin
        /** The newer version found by the last update check, or null. */
        updateVersion: string | null
    }

    let { plugin, updateVersion }: Props = $props()

    const uid = $props.id()
    let open = $state(false)

    const label = $derived(plugin.displayName ?? plugin.name)
    const access = $derived(pluginAccess(plugin))
    const mode = $derived(pluginSwitchMode(plugin))
    const on = $derived(mode === 'direct' && plugin.enabled === true)
    const versionLine = $derived(pluginVersionLine(plugin, language.pluginsPage))
    const hasArgs = $derived(Object.keys(plugin.arguments ?? {}).some((key) => !key.startsWith('hidden_')))
    const runnable = $derived(access.kind === 'limited')

    async function toggle(): Promise<void> {
        if (mode !== 'direct') return
        await togglePluginEnabled(plugin)
        // The list entry is written back through the database proxy so the plugins block is marked changed.
        const at = DBState.db.plugins.indexOf(plugin)
        if (at !== -1) DBState.db.plugins[at] = plugin
    }

    async function remove(): Promise<void> {
        const target = plugin
        const name = target.displayName ?? target.name
        if (!(await alertConfirm(fillLang(language.pluginsPage.removeConfirm, { name })))) return
        const removed = removePluginEntry(target)
        if (!removed) return
        void loadPlugins()
        postUndoToast({
            text: fillLang(language.pluginsPage.removed, { name }),
            actionLabel: language.uiCommon.undo,
            action: pluginRemovalUndoAction(removed, loadPlugins),
        })
    }

    async function update(): Promise<void> {
        if (!(await alertConfirm(language.pluginUpdateFoundInstallIt))) return
        if (!(await updatePlugin(plugin))) {
            postToast({ kind: 'error', text: fillLang(language.pluginsPage.updateFailed, { name: label }) })
        }
    }

    async function exportScript(): Promise<void> {
        const file = pluginExportFile(plugin)
        const { downloadFile } = await import('../../../ts/globalApi.svelte')
        await downloadFile(file.fileName, file.content)
    }

    function offerSettingsUndo(text: string, undo: PluginSettingsUndo): void {
        postUndoToast({
            text,
            actionLabel: language.uiCommon.undo,
            action: {
                id: 'plugin-settings:' + undo.name,
                failedText: language.pluginsPage.settingsUndoFailed,
                async run() {
                    const outcome = undoPluginSettings(DBState.db.plugins, undo)
                    if (outcome === 'gone') {
                        return { ok: false, text: language.pluginSettingsFile.pluginGone }
                    }
                    if (outcome === 'changed') {
                        return { ok: false, text: fillLang(language.pluginsPage.settingsUndoChanged, { plugin: undo.name }) }
                    }
                    if (DBState.db.plugins.find((entry) => entry.name === undo.name)?.enabled) {
                        await loadPlugins()
                    }
                    return { ok: true, text: fillLang(language.pluginsPage.settingsRestored, { plugin: undo.name }) }
                },
            },
        })
    }

    async function openSettingsFile(): Promise<void> {
        // Only the name is kept: the plugin is looked up again after every dialog.
        const name = plugin.name
        await openPluginSettingsMenu(name, {
            plugins: () => DBState.db.plugins,
            select: alertSelect,
            confirm: alertConfirm,
            notify: alertNormal,
            fail: alertError,
            pickFile: async () => (await import('../../../ts/util')).selectSingleFile(['json']),
            download: async (fileName, content) => {
                const { downloadFile } = await import('../../../ts/globalApi.svelte')
                await downloadFile(fileName, content)
            },
            reload: loadPlugins,
            offerUndo: offerSettingsUndo,
        })
    }

    const iconButton = 'inline-flex items-center justify-center min-h-11 min-w-11 rounded-md text-textcolor2 hover:text-textcolor'
</script>

<div class="flex flex-col gap-2 px-3 py-3 rounded-md bg-darkbutton text-textcolor" role="group" aria-labelledby="{uid}-name" data-part="plugins-item" data-plugin={plugin.name}>
    <div class="flex items-start gap-3">
        <div class="flex flex-col grow min-w-0">
            <span class="flex flex-wrap items-center gap-2">
                <span id="{uid}-name" class="font-semibold break-words" data-part="plugin-name">{label}</span>
                {#if hotReloading.includes(plugin.name)}
                    <span class="text-sm rounded bg-amber-700 px-2 py-1 text-white">{language.settingsPage.hotBadge}</span>
                {/if}
            </span>
            <span class="text-sm text-textcolor2" data-part="plugin-version">{versionLine}</span>
            <span id="{uid}-access" class="text-sm" class:text-textcolor2={runnable} class:text-draculared={!runnable} data-part="plugin-access">
                {#if access.kind === 'limited'}
                    {language.pluginsPage.accessLimited}
                {:else}
                    {language.pluginVersionWarn
                        .replace('{{plugin_version}}', 'API V' + access.apiLabel)
                        .replace('{{required_version}}', 'API V3')}
                {/if}
            </span>
            {#if access.kind === 'limited' && access.ipcCount > 0}
                <span class="text-sm text-textcolor2" data-part="plugin-ipc">{fillLang(language.pluginsPage.accessIpc, { count: access.ipcCount })}</span>
            {/if}
        </div>
        <button
            type="button"
            role="switch"
            class="flex items-center gap-2 min-h-11 px-2 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
            aria-checked={on}
            aria-label={label}
            aria-describedby={mode === 'disabled' ? `${uid}-access` : undefined}
            disabled={mode === 'disabled'}
            data-part="plugin-switch"
            onclick={toggle}
        >
            <span class="text-sm">{on ? language.pluginsPage.switchOn : language.pluginsPage.switchOff}</span>
            <span class="w-10 h-6 rounded-full border border-borderc flex items-center px-0.5" class:bg-selected={on} class:justify-end={on} aria-hidden="true">
                <span class="w-5 h-5 rounded-full bg-textcolor"></span>
            </span>
        </button>
    </div>

    <div class="flex flex-wrap items-center gap-1">
        {#each plugin.customLink ?? [] as link}
            {#if typeof link.link === 'string' && (link.link.startsWith('http://') || link.link.startsWith('https://'))}
                <a
                    href={link.link}
                    target="_blank"
                    rel="nofollow noopener noreferrer"
                    class={iconButton}
                    title={link.hoverText}
                    aria-label={link.hoverText || link.link}
                ><LinkIcon aria-hidden="true" /></a>
            {/if}
        {/each}
        <button type="button" class={iconButton} aria-label={language.export} title={language.export} data-part="plugin-export" onclick={exportScript}>
            <DownloadIcon aria-hidden="true" />
        </button>
        {#if runnable && hasArgs}
            <button type="button" class={iconButton} aria-label={language.pluginSettingsFile.button} title={language.pluginSettingsFile.button} data-part="plugin-settings-file" onclick={openSettingsFile}>
                <Settings2Icon aria-hidden="true" />
            </button>
        {/if}
        {#if updateVersion}
            <span class="text-sm text-textcolor px-2" data-part="plugin-update-chip">{fillLang(language.pluginsPage.updateChip, { version: updateVersion })}</span>
            <button type="button" class="px-3 min-h-11 rounded-md bg-selected text-textcolor" data-part="plugin-update" onclick={update}>{language.pluginsPage.updateAction}</button>
        {/if}
        <span class="grow"></span>
        {#if runnable && hasArgs}
            <button
                type="button"
                class="px-3 min-h-11 rounded-md text-textcolor2 hover:text-textcolor"
                aria-expanded={open}
                aria-controls="{uid}-args"
                data-part="plugin-settings-toggle"
                onclick={() => { open = !open }}
            >{language.pluginsPage.settings}</button>
        {/if}
        <button type="button" class={iconButton} aria-label={language.remove} title={language.remove} data-part="plugin-remove" onclick={remove}>
            <TrashIcon aria-hidden="true" />
        </button>
    </div>

    {#if open && runnable && hasArgs}
        <div id="{uid}-args">
            <PluginArgsPanel {plugin} />
        </div>
    {/if}
</div>
