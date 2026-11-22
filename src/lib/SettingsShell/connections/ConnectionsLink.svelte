<script lang="ts">
    import { language } from '../../../lang'
    import { SettingsMenuIndex } from '../../../ts/stores.svelte'
</script>

<button type="button" class="self-start min-h-11 text-sm text-textcolor2 hover:text-textcolor underline" data-part="settings-connections-link" onclick={() => SettingsMenuIndex.set(18)}>{language.connectionsManageLink}</button>
