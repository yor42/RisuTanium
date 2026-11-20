<script lang="ts">
    import { backCloseHandler, registerBackHandler } from '../../../ts/backHandlers'
    import type { PatternAnswer, PatternWarningDef } from '../../Nexus/pattern/patternWarning'
    import type { LeaveOutAnswer } from '../../../ts/setting/dataSheets.svelte'
    import PatternWarning from '../../Nexus/pattern/PatternWarning.svelte'

    /**
     * The caution sheet that names what a `.bin` leaves out. Every button, Escape and Back answers once; Back answers
     * Cancel through its own handler, because the dialog shell registers none. The definition is built by the caller, so
     * a sheet that is shown always has its text.
     */
    interface Props {
        def: PatternWarningDef
        trigger?: HTMLElement | null
        background: readonly HTMLElement[]
        onanswer: (answer: LeaveOutAnswer) => void
    }

    let { def, trigger = null, background, onanswer }: Props = $props()

    let answered = $state(false)

    function answer(value: LeaveOutAnswer): void {
        if (answered) return
        answered = true
        onanswer(value)
    }

    function answerOf(value: PatternAnswer): void {
        answer(value === 'confirm' ? 'bin' : value === 'secondary' ? 'rtb' : 'cancel')
    }

    $effect(() => registerBackHandler(backCloseHandler({
        isOpen: () => !answered,
        snapshot: () => answered,
        close: () => answer('cancel'),
    })))
</script>

<PatternWarning {def} {trigger} {background} onanswer={answerOf} />
