<script module lang="ts">
    import type { Chat, character } from '../../ts/storage/database.svelte'
    import type { PreviewEngine } from '../../ts/studio/longText/previewEngineService'

    /** What the preview reads from the open owner: the owner, its chat, and the shared global variables. */
    export type PreviewSourceInput = { owner: character | null; chat: Chat | null; globals: Readonly<Record<string, string>> }

    /** The values the author fills in. An empty `char` means the owner's own name. Chat keys have no `$` prefix. */
    export type PreviewValues = { char: string; chat: Readonly<Record<string, string>>; toggles: Readonly<Record<string, string>> }

    export type RunPreview = PreviewEngine['runPreview']

    export const NO_VALUES: PreviewValues = { char: '', chat: {}, toggles: {} }
</script>

<script lang="ts">
    import { XIcon } from '@lucide/svelte'
    import { onDestroy, untrack } from 'svelte'
    import { language } from '../../lang'
    import type { LongTextKind } from '../../ts/studio/longText/fieldWrite'
    import { createPauseScheduler } from '../../ts/studio/longText/pauseScheduler'
    import { loadPreviewEngine } from '../../ts/studio/longText/previewEngineService'
    import { registerStudioBackLayer } from '../../ts/studio/studioBack.svelte'

    // The CBS preview of one long-text field, as a modal sheet or as a pane inside the focus layer. It shows what the
    // engine makes of the field's text (and nothing else: the only markup it renders is the engine's sanitised output),
    // the values the author can fill in, and what the text would change. It writes nothing outside itself. The values
    // belong to the field that mounts it and are never stored. The engine loads on first use; a failed load shows the
    // error and no markup.
    interface Props {
        variant: 'sheet' | 'pane'
        kind: LongTextKind
        // The field's text as `onvalue` last reported it (LF).
        text: string
        // An IME composition is in progress in the field: no run starts until it ends.
        composing: boolean
        // False for a hidden tab: nothing loads or runs.
        active: boolean
        // In low power there is no automatic run; Refresh runs once.
        lowPower: boolean
        previewSource: () => PreviewSourceInput
        values: PreviewValues
        onvalues: (next: PreviewValues) => void
        // Replaces the engine's run (the engine's own runPreview by default).
        run?: RunPreview
        // The sheet's close; `refocus` is false for Back, which must not bring the keyboard up.
        onclose?: (refocus: boolean) => void
    }

    let { variant, kind, text, composing, active, lowPower, previewSource, values, onvalues, run, onclose }: Props = $props()

    type Engine = Awaited<ReturnType<typeof loadPreviewEngine>>
    type RunOk = Extract<ReturnType<RunPreview>, { ok: true }>
    type Shown = { ok: true; text: string; html: string; mediaRemoved: number; writes: RunOk['writes']; varies: boolean } | { ok: false }

    const RUN_PAUSE_MS = 400

    const titleId = $props.id()
    let engine = $state.raw<Engine | null>(null)
    let loadFailed = $state(false)
    let shown = $state.raw<Shown | null>(null)
    let rawView = $state(false)
    let dialog = $state<HTMLDivElement | undefined>()
    // The sheet's own state: Back is handled exactly when the sheet closes, so `isOpen` flips synchronously in `close`.
    let open = $state(true)

    function close(refocus: boolean): void {
        if (!open) return
        open = false
        onclose?.(refocus)
    }

    if (untrack(() => variant) === 'sheet') registerStudioBackLayer({ isOpen: () => open, close: () => close(false) })

    $effect(() => {
        if (!active || engine !== null || loadFailed) return
        let current = true
        void loadPreviewEngine().then((loaded) => {
            if (current) engine = loaded
        }, () => {
            if (current) loadFailed = true
        })
        return () => { current = false }
    })

    function runValues(sourceName: string) {
        return {
            char: values.char || sourceName,
            chat: values.chat,
            toggles: values.toggles,
            samples: { user: language.sbSampleUser, char: language.sbSampleChar },
        }
    }

    function execute(): void {
        const loaded = engine
        if (!loaded || !active) return
        try {
            const input = previewSource()
            if (!input.owner) {
                shown = { ok: false }
                return
            }
            const source = loaded.sandboxSourceOf(input.owner, input.chat)
            const result = (run ?? loaded.runPreview)(text, kind, source, runValues(source.name))
            if (!result.ok) {
                shown = { ok: false }
                return
            }
            const clean = loaded.previewHtml(result.text)
            shown = { ok: true, text: result.text, html: clean.html, mediaRemoved: clean.mediaRemoved, writes: result.writes, varies: result.varies }
        } catch {
            shown = { ok: false }
        }
    }

    const schedule = createPauseScheduler(RUN_PAUSE_MS, () => {
        if (!lowPower) execute()
    })
    onDestroy(() => schedule.cancel())

    // The composing edge drives the scheduler, so a composition that ends by blur still releases the held run.
    let wasComposing = false
    $effect(() => {
        const now = composing
        untrack(() => {
            if (now && !wasComposing) schedule.compositionStart()
            else if (!now && wasComposing) schedule.compositionEnd()
            wasComposing = now
        })
    })

    // Every change of the text or the values, and the engine becoming ready, asks for a run after the pause.
    $effect(() => {
        void text
        void values
        void kind
        void active
        void engine
        untrack(() => {
            if (active && engine !== null) schedule.touch()
        })
    })

    const keys = $derived(engine ? engine.sandboxKeysOf(text) : { chat: [], toggles: [] })

    // The name a real chat would use for `{{user}}`; absent when the engine is not there.
    const userName = $derived.by(() => {
        const loaded = engine
        if (!loaded) return null
        try {
            const input = previewSource()
            return input.owner ? loaded.sandboxUserName(loaded.sandboxSourceOf(input.owner, input.chat)) : null
        } catch {
            return null
        }
    })

    const ownerName = $derived.by(() => {
        try {
            return previewSource().owner?.name ?? ''
        } catch {
            return ''
        }
    })

    const hasChat = $derived.by(() => {
        try {
            return previewSource().chat !== null
        } catch {
            return false
        }
    })

    function setEntry(group: 'chat' | 'toggles', key: string, value: string): void {
        const next: Record<string, string> = { ...values[group] }
        if (value === '') delete next[key]
        else next[key] = value
        onvalues({ ...values, [group]: next })
    }

    function copyChat(): void {
        const loaded = engine
        if (!loaded) return
        const input = previewSource()
        const copied = loaded.copiedChatValues(input.chat, input.globals)
        if (!copied) return
        onvalues({ ...values, chat: { ...values.chat, ...copied.chat }, toggles: { ...values.toggles, ...copied.toggles } })
    }

    function onKeydown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            close(true)
            return
        }
        if (event.key !== 'Tab' || !dialog) return
        // The sheet is modal: Tab cycles inside it.
        const focusable = [...dialog.querySelectorAll<HTMLElement>('input, button')].filter((element) => !element.hasAttribute('disabled'))
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
        }
    }

    $effect(() => {
        if (variant === 'sheet') untrack(() => dialog?.querySelector<HTMLElement>('[data-part="lt-preview-close"]')?.focus())
    })

    const inputClass = 'min-w-0 flex-1 rounded-md border border-darkborderc bg-darkbg p-1 text-textcolor'
    const wordButton = 'shrink-0 rounded-md bg-darkbutton px-3 py-1.5 text-sm hover:bg-selected disabled:opacity-50 cursor-pointer'
</script>

{#snippet valueRow(group: 'chat' | 'toggles', key: string, label: string)}
    <label class="flex items-center gap-2 text-sm" data-part="lt-preview-row" data-key={key}>
        <span class="w-40 shrink-0 truncate">{label}</span>
        <input
            type="text"
            class={inputClass}
            value={values[group][key] ?? ''}
            placeholder={language.sbUnset}
            oninput={(event) => setEntry(group, key, event.currentTarget.value)}
        />
    </label>
{/snippet}

{#snippet content()}
    <div data-part="lt-preview-body" class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {#if loadFailed || (shown !== null && !shown.ok)}
            <p data-part="lt-preview-error" role="alert" class="text-sm text-draculared">{language.sbError}</p>
        {/if}
        {#if engine}
            <fieldset data-part="lt-preview-values" class="flex flex-col gap-1">
                <legend class="text-xs font-bold text-textcolor2">{language.sbValues}</legend>
                <label class="flex items-center gap-2 text-sm" data-part="lt-preview-row" data-key="char">
                    <span class="w-40 shrink-0 truncate">{language.sbCharName}</span>
                    <input
                        type="text"
                        data-part="lt-preview-char"
                        class={inputClass}
                        value={values.char}
                        placeholder={ownerName}
                        oninput={(event) => onvalues({ ...values, char: event.currentTarget.value })}
                    />
                </label>
                {#each keys.chat as key (key)}
                    {@render valueRow('chat', key, `${language.sbChatVar} · ${key}`)}
                {/each}
                {#each keys.toggles as key (key)}
                    {@render valueRow('toggles', key, `${language.sbGlobal} · ${key}`)}
                {/each}
                {#if userName !== null}
                    <p data-part="lt-preview-user" class="text-sm"><span class="font-bold">{userName}</span> <span class="text-textcolor2">{language.sbUserFrom}</span></p>
                {/if}
                <div class="flex flex-wrap items-center gap-2">
                    <button type="button" data-part="lt-preview-copy" class={wordButton} disabled={!hasChat} onclick={copyChat}>{language.sbCopyChat}</button>
                    {#if !hasChat}
                        <span data-part="lt-preview-copy-reason" class="text-xs text-textcolor2">{language.sbCopyNoChat}</span>
                    {/if}
                    {#if lowPower}
                        <button type="button" data-part="lt-preview-refresh" class={wordButton} onclick={execute}>{language.sbRefresh}</button>
                    {/if}
                </div>
            </fieldset>
        {/if}
        {#if shown !== null && shown.ok}
            {#if shown.writes.length > 0}
                <div data-part="lt-preview-writes" class="text-sm">
                    <p>{language.sbWrites(shown.writes.length)}</p>
                    <ul class="text-textcolor2">
                        {#each shown.writes as write (write.key)}
                            <li data-part="lt-preview-write">{write.key}: {write.before ?? language.sbUnset} → {write.after}</li>
                        {/each}
                    </ul>
                </div>
            {/if}
            {#if shown.varies}
                <p data-part="lt-preview-varies" class="text-xs text-textcolor2">{language.sbVaries}</p>
            {/if}
            {#if shown.mediaRemoved > 0}
                <p data-part="lt-preview-media" class="text-xs text-textcolor2">{language.sbMediaHidden(shown.mediaRemoved)}</p>
            {/if}
            <button type="button" data-part="lt-preview-raw-toggle" class="{wordButton} self-start" aria-pressed={rawView} onclick={() => { rawView = !rawView }}>{language.sbRaw}</button>
            {#if rawView}
                <pre data-part="lt-preview-raw" class="whitespace-pre-wrap break-words rounded-md bg-darkbg p-2 text-sm">{shown.text}</pre>
            {:else}
                <div data-part="lt-preview-output" class="overflow-auto break-words rounded-md bg-darkbg p-2 [contain:paint]">{@html shown.html}</div>
            {/if}
        {/if}
    </div>
{/snippet}

{#if variant === 'sheet'}
    <div class="fixed inset-0 z-50 flex items-end justify-center bg-bgcolor/60 sm:items-center" data-part="lt-preview-backdrop">
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div
            bind:this={dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabindex="-1"
            data-part="lt-preview-sheet"
            class="flex max-h-[85vh] w-full max-w-xl flex-col gap-2 rounded-t border border-darkborderc bg-bgcolor p-3 sm:rounded"
            onkeydown={onKeydown}
        >
            <div class="flex items-center justify-between gap-2">
                <h2 id={titleId} class="font-bold">{language.ltPreview}</h2>
                <button type="button" data-part="lt-preview-close" class="flex h-9 w-9 items-center justify-center rounded-md hover:bg-selected cursor-pointer" aria-label={language.sbClose} onclick={() => close(true)}>
                    <XIcon size={18} />
                </button>
            </div>
            {@render content()}
        </div>
    </div>
{:else}
    <section data-part="lt-preview-pane" aria-label={language.ltPreview} class="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        {@render content()}
    </section>
{/if}
