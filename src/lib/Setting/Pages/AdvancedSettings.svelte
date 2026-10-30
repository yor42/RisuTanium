<script lang="ts">
    import { onMount } from "svelte";
    import { language } from "src/lang";
    import { isNodeServer } from "src/ts/platform";
    import { nodeServerPrivateProxyEnabled } from "src/ts/storage/nodeStorage";
    import { advancedSettingsItems } from "src/ts/setting/advancedSettingsData";
    import SettingRenderer from "../SettingRenderer.svelte";

    // Shown only on a Node server whose proxy was confirmed to reach the local network.
    let privateProxy = $state(false);
    onMount(async () => {
        if (isNodeServer) {
            privateProxy = await nodeServerPrivateProxyEnabled();
        }
    });
</script>

{#if privateProxy}
    <span class="text-draculared mb-4">{language.nodePrivateProxyWarning}</span>
{/if}
<SettingRenderer items={advancedSettingsItems} />
