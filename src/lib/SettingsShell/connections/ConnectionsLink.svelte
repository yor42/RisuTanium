<script lang="ts">
    import '../../../styles/settings-roles.css'
    import { language } from '../../../lang'
    import { SettingsMenuIndex } from '../../../ts/stores.svelte'
</script>

<button type="button" class="self-start min-h-11 text-sm text-(--settings-text-2) hover:text-(--settings-text) underline" data-part="settings-connections-link" onclick={() => SettingsMenuIndex.set(18)}>{language.connectionsManageLink}</button>
