<script lang="ts">
    import { onMount } from "svelte";
    import { language } from "src/lang";
    import { isNodeServer, isTauri } from "src/ts/platform";
    import { nodeServerPrivateProxyEnabled } from "src/ts/storage/nodeStorage";
    import { advancedSettingsItems } from "src/ts/setting/advancedSettingsData";
    import Check from "src/lib/UI/GUI/CheckInput.svelte";
    import SettingRenderer from "../SettingRenderer.svelte";

    // Shown only on a Node server whose proxy was confirmed to reach the local network.
    let privateProxy = $state(false);
    // Device-local, not a database field: read from and written to its own byte-store key.
    let allowPrivateNative = $state(false);
    onMount(async () => {
        if (isNodeServer) {
            privateProxy = await nodeServerPrivateProxyEnabled();
        }
        if (isTauri) {
            // Loaded on demand: only Tauri builds show the toggle, so other builds never pull in the store.
            const { getAllowPrivate } = await import("src/ts/network/privateNetworkConsent");
            allowPrivateNative = await getAllowPrivate();
        }
    });

    async function changeAllowPrivateNative(enabled: boolean) {
        const { alertConfirm } = await import("src/ts/alert");
        const { setAllowPrivate } = await import("src/ts/network/privateNetworkConsent");
        // Enabling needs the warning accepted; disabling never asks.
        if (enabled && !(await alertConfirm(language.allowPrivateNetworkNativeWarning))) {
            allowPrivateNative = false;
            return;
        }
        await setAllowPrivate(enabled);
    }
</script>

{#if privateProxy}
    <span class="text-draculared mb-4">{language.nodePrivateProxyWarning}</span>
{/if}
{#if isTauri}
    <div class="mb-4">
        <Check bind:check={allowPrivateNative} onChange={changeAllowPrivateNative} name={language.allowPrivateNetworkNative} />
        <span class="text-textcolor2 text-sm">{language.allowPrivateNetworkNativeHelp}</span>
    </div>
{/if}
<SettingRenderer items={advancedSettingsItems} />
