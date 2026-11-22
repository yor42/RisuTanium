<script lang="ts">
    import { language } from '../../../lang'
    import type { SettingContext } from '../../../ts/setting/types'
    import { playUiSound } from '../../../ts/uiSound/uiSound'
    import { readUiSounds, uiSoundsSupported, writeUiSounds } from '../../../ts/uiSound/uiSoundPrefs'
    import CheckInput from '../../UI/GUI/CheckInput.svelte'

    interface Props {
        /** Given by the shell page; the classic Display page renders the row without it. */
        ctx?: SettingContext
    }
    let { ctx: _ctx }: Props = $props()

    const supported = uiSoundsSupported()
    let enabled = $state(readUiSounds(supported))

    // Turning sounds off is silent; turning them on confirms with the toggle cue.
    function onSwitch(on: boolean): void {
        enabled = on
        writeUiSounds(on)
        if (on) playUiSound('toggle-on')
    }
</script>

<!-- A device choice (MC-2312): the switch reads and writes this device's storage, never the profile. -->
{#if supported}
    <div class="mt-4 flex flex-col" data-part="ui-sounds">
        <div class="flex flex-wrap items-center gap-2">
            <CheckInput check={enabled} onChange={onSwitch} name={language.uiSoundsLabel} />
            <span class="rounded-md border border-darkborderc px-2 text-xs text-textcolor2" data-part="device-chip">{language.chatShellOnThisDevice}</span>
        </div>
        <p class="mt-1 text-sm text-textcolor2" data-part="ui-sounds-help">{language.uiSoundsDesc}</p>
    </div>
{/if}
