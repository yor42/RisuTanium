<script lang="ts">
    import { language } from 'src/lang'
    import { DBState } from 'src/ts/stores.svelte'
    import { hasLiveCharacter } from './homeEmpties'
    import { createCharacterFromHome, importCharacterFromHome } from './homeEmptyActions'

    interface Props {
        // Called after a Create or Import that selected a character, for a host that must close itself.
        // The landing passes nothing: its own view follows the selection.
        onselected?: () => void
    }

    let { onselected }: Props = $props()

    const headingId = $props.id()

    // Reads `DBState.db` on every evaluation, so it follows a wholesale database swap as well as a
    // trash or restore of the last live character.
    const empty = $derived(!hasLiveCharacter(DBState.db.characters))

    // Each action guards only its own button: a picker that never reports back must not block Create.
    // The flag is checked and set before the first await, so a second synchronous tap returns early;
    // `disabled` is presentation only.
    let creating = $state(false)
    let importing = $state(false)

    async function create(): Promise<void> {
        if (creating) {
            return
        }
        creating = true
        try {
            if (await createCharacterFromHome()) {
                onselected?.()
            }
        } finally {
            creating = false
        }
    }

    async function importFile(): Promise<void> {
        if (importing) {
            return
        }
        importing = true
        try {
            if (await importCharacterFromHome()) {
                onselected?.()
            }
        } finally {
            importing = false
        }
    }
</script>

{#if empty}
    <section data-part="home-empty-hero" aria-labelledby={headingId} class="mt-4 w-full max-w-4xl px-6">
        <div class="rounded-2xl border border-borderc/10 bg-darkbg p-6 text-center">
            <h2 id={headingId} class="text-2xl font-bold tracking-tight text-textcolor break-keep">{language.homeEmptyHeading}</h2>
            <p class="mt-2 text-textcolor2">{language.homeEmptyBody}</p>
            <div class="mt-4 flex flex-wrap justify-center gap-2">
                <button
                    type="button"
                    class="min-h-11 max-w-full break-keep rounded-md bg-selected px-4 py-2 text-textcolor hover:bg-selected/80"
                    disabled={creating}
                    onclick={create}
                >
                    {language.homeEmptyCreate}
                </button>
                <button
                    type="button"
                    class="min-h-11 max-w-full break-keep rounded-md border border-borderc/10 bg-darkbutton px-4 py-2 text-textcolor hover:bg-selected/50"
                    disabled={importing}
                    onclick={importFile}
                >
                    {language.homeEmptyImport}
                </button>
            </div>
        </div>
    </section>
{/if}
