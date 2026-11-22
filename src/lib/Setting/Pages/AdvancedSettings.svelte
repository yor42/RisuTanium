<script lang="ts">
    import { advancedSettingsItems } from "src/ts/setting/advancedSettingsData";
    import PrivateNetworkControls from "./Advanced/PrivateNetworkControls.svelte";
    import WorkspaceToolGrants from "./Advanced/WorkspaceToolGrants.svelte";
    import SettingRenderer from "../SettingRenderer.svelte";
    import { utilityVisible } from "../../Utility/utilityGate";
    import { pageStorageModeStore } from "src/ts/storage/pageStorageMode";
</script>

<PrivateNetworkControls />
{#if utilityVisible($pageStorageModeStore)}
    <WorkspaceToolGrants />
{/if}
<SettingRenderer items={advancedSettingsItems} />
