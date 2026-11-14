<script lang="ts">
    import { onMount } from "svelte";
    import { language } from "src/lang";
    import { isNodeServer, isTauri } from "src/ts/platform";
    import { nodeServerPrivateProxyEnabled } from "src/ts/storage/nodeStorage";
    import Check from "src/lib/UI/GUI/CheckInput.svelte";
    import type { SettingContext } from "src/ts/setting/types";

    // The shell Advanced page hands every shell row the same props; the controls read no context.
    let { ctx: _ctx }: { ctx?: SettingContext } = $props();

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
        const { alertConfirm, alertError } = await import("src/ts/alert");
        const { getAllowPrivate, setAllowPrivate } = await import("src/ts/network/privateNetworkConsent");
        // Enabling needs the warning accepted; disabling never asks.
        if (enabled && !(await alertConfirm(language.allowPrivateNetworkNativeWarning))) {
            allowPrivateNative = false;
            return;
        }
        const { persisted } = await setAllowPrivate(enabled);
        if (!persisted) {
            // A failed write leaves the stored value as it was, while an unreadable store holds the choice in
            // memory for this session; re-reading shows which one is in effect.
            allowPrivateNative = await getAllowPrivate();
            alertError(language.allowPrivateNetworkNativeNotSaved);
        }
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
