<script lang="ts">
    import { language } from 'src/lang'
    import { fillLang } from 'src/lang/fill'
    import { copyPlainText } from 'src/ts/chatCopy'
    import { downloadFile } from 'src/ts/downloadFile'

    /**
     * The dialog of a finished reply that cannot be added to its chat. The name and the reply render as text, never as
     * markup. Copy and Save as .txt leave the dialog open; Discard answers `discard` without a confirm step; Later answers
     * `later`. The copy outcome is shown inside the dialog: a toast would replace the prompt on the alert store. The title
     * carries `titleId`, so the host dialog is named by the title alone and not by the whole body.
     */
    interface Props {
        name: string
        text: string
        title: string
        titleId?: string
        onanswer: (message: 'discard' | 'later') => void
    }

    let { name, text, title, titleId, onanswer }: Props = $props()

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

<div data-part="pattern-alert-stack" data-parked-reply>
    <p id={titleId} data-part="pattern-alert-title">{title}</p>
    <p data-part="pattern-alert-text">{fillLang(language.parkedReplyBody, { name })}</p>
    <div data-part="pattern-alert-reply" data-parked-reply-text>{text}</div>
    <div data-part="pattern-alert-reply-tools">
        <button type="button" class="pattern-button" onclick={copy}>{language.copy}</button>
        <button type="button" class="pattern-button" onclick={saveTxt}>{language.parkedReplySaveTxt}</button>
        <span role="status" data-parked-reply-status>{status}</span>
    </div>
</div>
<div data-part="pattern-warn-actions" data-count="2">
    <button type="button" class="pattern-button" onclick={() => onanswer('discard')}>{language.parkedReplyDiscard}</button>
    <button type="button" class="pattern-button" data-variant="confirm" onclick={() => onanswer('later')}>{language.parkedReplyLater}</button>
</div>
