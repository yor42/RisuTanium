<script lang="ts">
    import { language } from 'src/lang'
    import { alertNormal } from 'src/ts/alert'
    import { studioSwitch, setStudioEnabled } from 'src/ts/studio/studioSwitch.svelte'
    import { studioFlipBlocker } from 'src/ts/studio/studioFlip'

    function toggle(event: MouseEvent): void {
        const block = studioFlipBlocker()
        if (block) {
            event.preventDefault()
            alertNormal(language[block.reasonKey])
            return
        }
        setStudioEnabled(!studioSwitch.enabled)
    }
</script>

<div class="flex items-center mt-2 gap-2">
    <label class="flex items-center gap-2">
        <input type="checkbox" checked={studioSwitch.enabled} onclick={toggle} />
        <span>{language.studioSwitchLabel}</span>
    </label>
    <span>{language.chatShellOnThisDevice}</span>
    <span>{language.studioSwitchHelp}</span>
</div>
