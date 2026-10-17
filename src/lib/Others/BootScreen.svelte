<script lang="ts">
    import { language } from 'src/lang'
    import { getBootScreen, pressBootButton } from 'src/ts/storage/store2/ui/bootScreen.svelte'

    // Names in the lists are the user's own text: they are only ever rendered as text nodes, never as markup.
    const view = $derived(getBootScreen())
    let root: HTMLElement | undefined = $state()

    // Each screen gets fresh DOM (the key block below), and initial focus goes where the model says: a button that
    // writes nothing, or the heading when every button acts.
    $effect(() => {
        const shown = view
        if (shown === null || root === undefined) {
            return
        }
        const target = shown.model.focus === null
            ? root.querySelector<HTMLElement>('[data-boot-heading]')
            : Array.from(root.querySelectorAll<HTMLElement>('[data-boot-key]')).find((element) => element.dataset.bootKey === shown.model.focus)
        target?.focus()
    })
</script>

<div bind:this={root} class="w-full h-full overflow-y-auto bg-bgcolor text-textcolor flex justify-center">
    {#if view !== null}
        {#key view.model}
            <section class="w-full max-w-2xl p-6 flex flex-col gap-4 my-auto" aria-labelledby="boot-screen-title">
                <h1 id="boot-screen-title" tabindex="-1" data-boot-heading class="text-2xl font-bold outline-hidden">{view.model.title}</h1>
                {#each view.model.paragraphs as paragraph}
                    <p class="whitespace-pre-wrap wrap-break-word">{paragraph}</p>
                {/each}
                {#each view.model.lists as list}
                    {#if list.heading !== null}
                        <h2 class="font-bold">{list.heading}</h2>
                    {/if}
                    <ul class="list-disc pl-6 max-h-64 overflow-y-auto text-textcolor2">
                        {#each list.items as item}
                            <li class="whitespace-pre-wrap wrap-break-word">{item}</li>
                        {/each}
                    </ul>
                {/each}
                {#if view.model.details !== null}
                    <p class="text-xs text-textcolor2 whitespace-pre-wrap wrap-break-word">{view.model.details}</p>
                {/if}
                {#if view.answered}
                    <p class="text-sm text-textcolor2">{language.store2Boot.working}</p>
                {/if}
                <div class="flex flex-wrap gap-2 mt-2">
                    {#each view.model.buttons as button (button.key)}
                        <button
                            type="button"
                            data-boot-key={button.key}
                            class="px-4 py-2 rounded-md border border-darkborderc bg-darkbutton hover:bg-selected disabled:opacity-50"
                            disabled={view.answered}
                            onclick={() => pressBootButton(button.key)}
                        >{button.label}</button>
                    {/each}
                </div>
            </section>
        {/key}
    {/if}
</div>
