<script lang="ts">
    import { language } from '../../../lang'
    import { motionPrefs, setReduceCardEffects } from '../../../ts/chatShell/motionPrefs.svelte'
    import type { SettingContext } from '../../../ts/setting/types'
    import CheckInput from '../../UI/GUI/CheckInput.svelte'

    interface Props {
        ctx: SettingContext
    }
    let { ctx: _ctx }: Props = $props()
</script>

<!-- A device choice (MC-1529): the switch reads and writes this device's storage, never the profile. Its stored value is independent of low power, which only adds a line. -->
<div class="mt-4 flex flex-col" data-part="settings-reduce-card-effects">
    <div class="flex flex-wrap items-center gap-2">
        <CheckInput check={motionPrefs.reduceCardEffects === true} onChange={setReduceCardEffects} name={language.settingsShellReduceCardEffects} />
        <span class="rounded-md border border-(--settings-border-subtle) px-2 text-xs text-(--settings-text-2)" data-part="settings-device-chip">{language.chatShellOnThisDevice}</span>
    </div>
    <p class="mt-1 text-sm text-(--settings-text-2)">{language.settingsShellReduceCardEffectsDesc}</p>
    {#if motionPrefs.lowPower}
        <p class="mt-1 text-sm text-(--settings-text-2)" data-part="settings-reduce-card-effects-by-low-power">{language.settingsShellReduceCardEffectsByLowPower}</p>
    {/if}
</div>
