<script lang="ts">
    import { language } from '../../../lang'
    import { useCharImageLookups } from '../../../ts/media/charImageLookups'
    import { warnOnReject } from '../../../ts/warnOnReject'

    interface Props {
        uid: string
        name: string
        icon: string
        onname: (value: string) => void
        onpicture: () => void
        onkeydown: (event: KeyboardEvent) => void
    }

    let { uid, name, icon, onname, onpicture, onkeydown }: Props = $props()
    const lookups = useCharImageLookups()
</script>

<div class="flex flex-wrap gap-4" data-persona-builder-step="who">
    <button type="button" class="shrink-0 rounded-md min-h-11" aria-label={language.onboarding.choosePicture} onclick={onpicture}>
        {#if icon}
            {#await warnOnReject('PersonaBuilderWho: icon rejected', lookups.get('persona-builder', icon, 'css'))}
                <span class="block rounded-md h-28 w-28 bg-textcolor2"></span>
            {:then im}
                <span class="block rounded-md h-28 w-28 bg-textcolor2" style={im}></span>
            {:catch}
                <span class="block rounded-md h-28 w-28 bg-textcolor2"></span>
            {/await}
        {:else}
            <span class="block rounded-md h-28 w-28 bg-textcolor2"></span>
        {/if}
    </button>
    <div class="flex flex-col grow min-w-0 gap-1">
        <label class="text-sm text-textcolor2" for="{uid}-name">{language.settingsShellPersonaName}</label>
        <input id="{uid}-name" type="text" autocomplete="off" enterkeyhint="next" placeholder={language.settingsShellPersonaNewName} class="min-h-11 px-3 rounded-md border border-darkborderc bg-transparent text-textcolor focus:border-borderc focus:outline-hidden risu-focus-ring" value={name} oninput={(event) => onname(event.currentTarget.value)} {onkeydown} />
    </div>
</div>
