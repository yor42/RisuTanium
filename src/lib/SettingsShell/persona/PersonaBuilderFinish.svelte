<script lang="ts">
    import { language } from '../../../lang'

    interface Props {
        uid: string
        text: string
        ontext: (value: string) => void
    }

    let { uid, text, ontext }: Props = $props()
</script>

<div class="flex flex-col gap-1" data-persona-builder-step="finish">
    <label class="text-sm text-textcolor2" for="{uid}-text">{language.settingsShellPersonaDesc}</label>
    <textarea id="{uid}-text" autocomplete="off" class="w-full min-h-40 px-3 py-2 rounded-md border border-darkborderc bg-transparent text-textcolor focus:border-borderc focus:outline-hidden risu-focus-ring" value={text} oninput={(event) => ontext(event.currentTarget.value)}></textarea>
    <span class="text-xs text-textcolor2">{language.settingsShellPersonaDescCount(text.length)}</span>
    <span class="text-xs text-textcolor2" data-persona-builder-hint>{language.settingsShellPersonaBuilderUseHint}</span>
</div>
