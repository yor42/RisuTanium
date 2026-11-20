<script lang="ts">
    import { language } from 'src/lang'
    import { isImeComposing } from 'src/ts/ime/compositionGuard'

    interface Props {
        message: string
        /** Called once: the password exactly as typed, or `null` for Cancel and Escape. */
        onanswer: (password: string | null) => void
    }

    let { message, onanswer }: Props = $props()

    let value = $state('')
    let shown = $state(false)
    let answered = false
    let field: HTMLInputElement | undefined = $state()

    $effect(() => {
        field?.focus()
    })

    function answer(password: string | null) {
        if (answered) {
            return
        }
        answered = true
        onanswer(password)
    }

    // A key sent while an IME composition is live belongs to the composition: it neither submits nor cancels.
    // There is no time window after compositionend, so the Enter that follows a composition end submits the text.
    function onkeydown(event: KeyboardEvent) {
        if (isImeComposing(event)) {
            return
        }
        if (event.key === 'Escape') {
            event.preventDefault()
            answer(null)
        } else if (event.key === 'Enter' && event.target === field) {
            event.preventDefault()
            answer(value)
        }
    }
</script>

<div class="fixed inset-0 z-[60] bg-black/80 flex justify-center items-center p-4">
    <div
        class="bg-darkbg text-textcolor border border-darkborderc rounded-md p-4 max-w-md w-full flex flex-col gap-3"
        role="dialog"
        aria-modal="true"
        aria-labelledby="password-prompt-message"
        tabindex="-1"
        {onkeydown}
    >
        <p id="password-prompt-message" class="break-any whitespace-pre-wrap">{message}</p>
        <label class="flex flex-col gap-1">
            <span class="text-textcolor2 text-sm">{language.rtbRestorePasswordLabel}</span>
            <input
                bind:this={field}
                bind:value={value}
                type={shown ? 'text' : 'password'}
                autocomplete="off"
                autocapitalize="off"
                autocorrect="off"
                spellcheck="false"
                class="bg-bgcolor text-textcolor border border-darkborderc rounded-md p-2 w-full"
            />
        </label>
        <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" bind:checked={shown} />
            <span>{language.rtbRestorePasswordShow}</span>
        </label>
        <div class="flex justify-end gap-2">
            <button type="button" class="bg-darkbutton hover:bg-selected rounded-md px-4 py-2" onclick={() => answer(null)}>{language.cancel}</button>
            <button type="button" class="bg-selected rounded-md px-4 py-2" onclick={() => answer(value)}>{language.alertComp.ok}</button>
        </div>
    </div>
</div>
