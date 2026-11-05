<script lang="ts">
    import { language } from 'src/lang'
    import { alertNormal } from 'src/ts/alert'
    import { shellSwitch, setShellEnabled } from 'src/ts/chatShell/shellSwitch.svelte'
    import { shellFlipBlocker } from 'src/ts/chatShell/flipBlocker'
    import { hapticsSupported, readHaptics, writeHaptics } from 'src/ts/chatShell/haptics'

    const hapticsAvailable = hapticsSupported()
    let haptics = $state(readHaptics())
    // The sheet belongs to the chat screen's code, so it is loaded when the line is first used.
    let CustomizeSheet = $state.raw<typeof import('src/lib/ChatShell/CustomizeButtonsSheet.svelte').default | null>(null)
    let customizeOpen = $state(false)
    let customizeOpener = $state<HTMLElement | null>(null)

    function toggle(event: MouseEvent): void {
        const block = shellFlipBlocker()
        if (block) {
            event.preventDefault()
            alertNormal(language[block.reasonKey])
            return
        }
        setShellEnabled(!shellSwitch.enabled)
    }

    async function openCustomize(event: MouseEvent): Promise<void> {
        customizeOpener = event.currentTarget as HTMLElement
        CustomizeSheet ??= (await import('src/lib/ChatShell/CustomizeButtonsSheet.svelte')).default
        customizeOpen = true
    }

    function toggleHaptics(event: Event): void {
        haptics = (event.currentTarget as HTMLInputElement).checked
        writeHaptics(haptics)
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

<div class="flex items-center mt-2 gap-2" data-part="chat-shell-device-settings">
    <label class="flex items-center gap-2">
        <input type="checkbox" data-setting="haptics" checked={haptics && hapticsAvailable} disabled={!hapticsAvailable} onchange={toggleHaptics} />
        <span>{language.chatShellHaptics}</span>
    </label>
    <span>{language.chatShellOnThisDevice}</span>
    {#if !hapticsAvailable}<span>{language.chatShellHapticsUnavailable}</span>{/if}
</div>

<div class="flex items-center mt-2 gap-2">
    <button type="button" class="px-2 py-1 rounded-md bg-darkbutton text-textcolor" data-setting="customize-buttons" onclick={openCustomize}>{language.chatShellCustomizeButtons}</button>
    <span>{language.chatShellOnThisDevice}</span>
</div>

{#if CustomizeSheet}<CustomizeSheet open={customizeOpen} opener={customizeOpener} onclose={() => { customizeOpen = false }} />{/if}
