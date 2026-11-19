<script lang="ts">
    import { language } from 'src/lang'
    import { fillLang } from 'src/lang/fill'
    import { copyPlainText } from 'src/ts/chatCopy'
    import { downloadFile } from 'src/ts/downloadFile'
    import Button from '../UI/GUI/Button.svelte'

    /**
     * The dialog of a finished reply that cannot be added to its chat. The name and the reply render as text, never as
     * markup. Copy and Save as .txt leave the dialog open; Discard answers `discard` without a confirm step; Later answers
     * `later`. The copy outcome is shown inside the dialog: a toast would replace the prompt on the alert store.
     */
    interface Props {
        name: string
        text: string
        title: string
        onanswer: (message: 'discard' | 'later') => void
    }

    let { name, text, title, onanswer }: Props = $props()

    let status = $state('')

    // A character name may hold path characters; the saved file keeps a plain name.
    function fileSafe(value: string): string {
        const cleaned = value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim()
        return cleaned === '' ? 'reply' : cleaned
    }

    function copy(): void {
        copyPlainText(text, (outcome) => {
            status = 'errorName' in outcome ? `${outcome.errorName}: ${language.copyFailed}` : language.copied
        })
    }

    async function saveTxt(): Promise<void> {
        // false: the picker was cancelled, which is silent. The dialog stays open either way; a failure shows inside it.
        try {
            await downloadFile(`${fileSafe(name)}-reply.txt`, text)
        } catch (error) {
            const errorName = error instanceof Error ? error.name : 'Error'
            status = `${errorName}: ${language.parkedReplySaveTxt}`
        }
    }
</script>

<div class="flex flex-col gap-3 max-w-2xl" data-parked-reply>
    <div class="text-textcolor text-lg">{title}</div>
    <div class="text-textcolor2">{fillLang(language.parkedReplyBody, { name })}</div>
    <div class="whitespace-pre-wrap break-words max-h-64 overflow-y-auto border border-darkborderc rounded-md bg-darkbg text-textcolor p-2" data-parked-reply-text>{text}</div>
    <div class="text-textcolor2 text-sm min-h-5" role="status" data-parked-reply-status>{status}</div>
    <div class="flex flex-wrap gap-2">
        <Button styled="outlined" onclick={copy}>{language.copy}</Button>
        <Button styled="outlined" onclick={saveTxt}>{language.parkedReplySaveTxt}</Button>
        <Button styled="danger" onclick={() => onanswer('discard')}>{language.parkedReplyDiscard}</Button>
        <Button onclick={() => onanswer('later')}>{language.parkedReplyLater}</Button>
    </div>
</div>
