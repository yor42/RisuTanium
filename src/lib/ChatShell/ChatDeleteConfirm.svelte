<script lang="ts">
    import { language } from '../../lang'
    import { backCloseHandler, registerBackHandler } from '../../ts/backHandlers'
    import PatternWarning from '../Nexus/pattern/PatternWarning.svelte'
    import type { PatternAnswer, PatternWarningDef } from '../Nexus/pattern/patternWarning'
    import type { Chat } from '../../ts/storage/database.svelte'

    /**
     * The delete confirm of the This-chat sheet: a danger warning (its primary ignores input for the arm delay, Cancel
     * has first focus) that names the chat and its message count. ChatShell mounts it as a sibling after the sheet layer,
     * never inside the sheet's panel, so the sheet can stay open and inert under it. It answers once. Back answers
     * Cancel through its own handler, because the dialog shell registers none; Escape is the dialog shell's.
     */
    interface Props {
        chat: Chat
        busy: boolean
        trigger?: HTMLElement | null
        background: readonly HTMLElement[]
        onanswer: (answer: PatternAnswer) => void
    }

    let { chat, busy, trigger = null, background, onanswer }: Props = $props()
    let answered = $state(false)

    const def: PatternWarningDef = $derived({
        severity: 'danger',
        headline: language.chatShellDeleteChatConfirm(chat.name, chat.message.length),
        consequences: busy ? [language.removeChatWhileWorking] : [],
        actions: { cancel: language.cancel, primary: language.chatShellDeleteChat },
    })

    function answer(value: PatternAnswer): void {
        if (answered) return
        answered = true
        onanswer(value)
    }

    $effect(() => registerBackHandler(backCloseHandler({
        isOpen: () => !answered,
        snapshot: () => answered,
        close: () => answer('cancel'),
    })))
</script>

<PatternWarning {def} {trigger} {background} onanswer={answer} />
