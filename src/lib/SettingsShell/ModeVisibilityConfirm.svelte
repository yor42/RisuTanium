<script lang="ts">
    import { language } from '../../lang'
    import { backCloseHandler, registerBackHandler } from '../../ts/backHandlers'
    import PatternWarning from '../Nexus/pattern/PatternWarning.svelte'
    import type { PatternAnswer, PatternWarningDef } from '../Nexus/pattern/patternWarning'
    import type { HomeMode } from '../../ts/storage/homeModes'
    import { modeNames } from './ModeVisibilityGroup.svelte'

    /**
     * The confirm of Show all modes. The host mounts it outside the scroll column and the keyed view, because the
     * dialog layer is fixed and an animated or inerted ancestor would break it. It answers once. Back answers Cancel
     * through its own handler, because the dialog shell registers none; Escape is the dialog shell's.
     */
    interface Props {
        hidden: readonly HomeMode[]
        trigger?: HTMLElement | null
        background: readonly HTMLElement[]
        onanswer: (answer: PatternAnswer) => void
    }

    let { hidden, trigger = null, background, onanswer }: Props = $props()
    let answered = $state(false)

    const def: PatternWarningDef = $derived({
        severity: 'confirm',
        headline: language.settingsShellModesConfirmTitle,
        consequences: [language.settingsShellModesConfirmBody(modeNames(hidden))],
        actions: { cancel: language.cancel, primary: language.settingsShellModesConfirmDo },
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
