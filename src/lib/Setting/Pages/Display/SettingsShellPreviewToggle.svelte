<script lang="ts">
    import { language } from 'src/lang'
    import { settingsShellSwitch, setSettingsShellEnabled } from 'src/ts/settingsShell/settingsShellSwitch.svelte'
</script>

<div class="flex items-center mt-2 gap-2">
    <label class="flex items-center gap-2">
        <input type="checkbox" data-setting="settings-shell-preview" checked={settingsShellSwitch.enabled} onchange={(event) => setSettingsShellEnabled(event.currentTarget.checked)} />
        <span>{language.settingsShellPreviewLabel}</span>
    </label>
    <span>{language.chatShellOnThisDevice}</span>
    <span>{language.settingsShellNextOpenHelp}</span>
</div>
