<script lang="ts">
    import { language } from 'src/lang'
    import { alertNormal } from 'src/ts/alert'
    import { shellSwitch, setShellEnabled } from 'src/ts/chatShell/shellSwitch.svelte'
    import { shellFlipBlocker } from 'src/ts/chatShell/flipBlocker'

    function toggle(event: MouseEvent): void {
        const block = shellFlipBlocker()
        if (block) {
            event.preventDefault()
            alertNormal(language[block.reasonKey])
            return
        }
        setShellEnabled(!shellSwitch.enabled)
    }
</script>

<div class="flex items-center mt-2 gap-2">
    <label class="flex items-center gap-2">
        <input type="checkbox" checked={shellSwitch.enabled} onclick={toggle} />
        <span>{language.chatShellPreviewLabel}</span>
    </label>
    <span>{language.chatShellOnThisDevice}</span>
    <span>{language.chatShellOnThisDeviceHelp}</span>
</div>
