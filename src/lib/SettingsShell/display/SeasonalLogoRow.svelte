<script lang="ts">
    import { language } from '../../../lang'
    import { seasonalLogoEnabled, setSeasonalLogoEnabled } from '../../../ts/seasonal/seasonalPrefs.svelte'
    import type { SettingContext } from '../../../ts/setting/types'
    import CheckInput from '../../UI/GUI/CheckInput.svelte'

    interface Props {
        ctx: SettingContext
    }
    let { ctx: _ctx }: Props = $props()
</script>

<!-- A device choice (MC-3080): the switch reads and writes this device's localStorage, never the profile. -->
<div class="mt-4 flex flex-col" data-part="settings-seasonal-logo">
    <div class="flex flex-wrap items-center gap-2">
        <CheckInput check={seasonalLogoEnabled()} onChange={setSeasonalLogoEnabled} name={language.seasonalLogoSetting} />
        <span class="rounded-md border border-(--settings-border-subtle) px-2 text-xs text-(--settings-text-2)" data-part="settings-device-chip">{language.chatShellOnThisDevice}</span>
    </div>
    <p class="mt-1 text-sm text-(--settings-text-2)" data-part="settings-seasonal-logo-help">{language.seasonalLogoHelp}</p>
</div>
