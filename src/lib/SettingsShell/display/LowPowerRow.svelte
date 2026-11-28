<script lang="ts">
    import { language } from '../../../lang'
    import { motionPrefs, setLowPower } from '../../../ts/chatShell/motionPrefs.svelte'
    import type { SettingContext } from '../../../ts/setting/types'
    import CheckInput from '../../UI/GUI/CheckInput.svelte'

    interface Props {
        ctx: SettingContext
    }
    let { ctx: _ctx }: Props = $props()
</script>

<!-- A device choice (MC-1529): the switch reads and writes this device's storage, never the profile. -->
<div class="mt-4 flex flex-col" data-part="settings-low-power">
    <div class="flex flex-wrap items-center gap-2">
        <CheckInput check={motionPrefs.lowPower} onChange={setLowPower} name={language.settingsShellLowPower} />
        <span class="rounded-md border border-(--settings-border-subtle) px-2 text-xs text-(--settings-text-2)" data-part="settings-device-chip">{language.chatShellOnThisDevice}</span>
    </div>
    <p class="mt-1 text-sm text-(--settings-text-2)">{language.settingsShellLowPowerDesc}</p>
</div>
