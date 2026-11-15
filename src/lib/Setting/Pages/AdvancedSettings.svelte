<script lang="ts">
    import { advancedSettingsItems } from "src/ts/setting/advancedSettingsData";
    import PrivateNetworkControls from "./Advanced/PrivateNetworkControls.svelte";
    import SettingRenderer from "../SettingRenderer.svelte";
</script>

<PrivateNetworkControls />
<SettingRenderer items={advancedSettingsItems} />
