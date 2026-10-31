<script lang="ts">
    import { untrack } from "svelte";
    import { ParseMarkdown, risuChatParser } from "src/ts/parser/parser.svelte";
    import { getCurrentChat, getCurrentCharacter, type character, type groupChat } from "src/ts/storage/database.svelte";
    import { DBState, selectedCharID } from 'src/ts/stores.svelte';
    import { moduleBackgroundEmbedding, ReloadGUIPointer, selIdState } from "src/ts/stores.svelte";
    import { moduleRunVersion, selectedModulesPending } from "src/ts/process/moduleEnsure";
    import { BACKGROUND_SLOT, lookup, record, scopeOf, type RenderFingerprint } from "./chatBodyRenderCache";

    let backgroundHTML = $derived(DBState.db?.characters?.[selIdState.selId]?.backgroundHTML)
    let currentChar:character|groupChat = $derived(DBState.db?.characters?.[selIdState.selId])

    // The same gate as ChatBody: the selection and the run version are read first, so the derived re-evaluates when the
    // chat changes or a module load ends.
    let gatePending = $derived.by(() => {
        $selectedCharID
        $moduleRunVersion
        return selectedModulesPending()
    })

    // The last committed look and the chat it belongs to. It is replaced only by a newer result, and cleared only when
    // the background source is empty or the chat changed, so a bump or a rejected parse never blanks the background.
    let shown = $state.raw<{ scope: string | null, html: string } | null>(null)

    // Untracked: the cache scope is captured per run and never re-runs the parse.
    const captureScope = () => untrack(() => {
        try {
            const owner = getCurrentCharacter()
            const chat = getCurrentChat()
            if(owner && chat){
                return scopeOf(owner.chaId, chat.id, owner.chatPage)
            }
        } catch (error) {}
        return null
    })

    $effect(() => {
        $ReloadGUIPointer
        const pending = gatePending
        const source = backgroundHTML
        const embedding = $moduleBackgroundEmbedding
        const chara = currentChar
        const selId = selIdState.selId
        const scope = captureScope()

        if((!source && !embedding) || selId <= -1){
            shown = null
            return
        }
        // Another chat's look is never kept. An unknown scope neither clears nor caches.
        const current = untrack(() => shown)
        if(current && scope !== null && current.scope !== scope){
            shown = null
        }
        // No CBS and no parse while the selected modules load; the background stays as it is.
        if(pending){
            return
        }

        let input: string
        try {
            input = risuChatParser((source || '') + '\n' + (embedding || ''), {chara})
        } catch (error) {
            console.error(error)
            return
        }
        const fingerprint: RenderFingerprint | null = scope === null ? null : {
            scope,
            slot: BACKGROUND_SLOT,
            source: input,
            role: null,
            charArg: null,
        }
        if(fingerprint && untrack(() => shown) === null){
            const seen = lookup(fingerprint)
            if(seen.kind === 'html'){
                shown = { scope, html: seen.html }
            }
        }

        // The teardown marks this run dead, so only the latest run of a live instance commits.
        let live = true
        ParseMarkdown(input, chara, 'back').then((md) => {
            if(!live){
                return
            }
            shown = { scope, html: md }
            if(fingerprint){
                record(fingerprint, md)
            }
        }, (error) => {
            console.error(error)
        })
        return () => {
            live = false
        }
    })

</script>


{#if shown && selIdState.selId > -1}
    <div class="absolute top-0 left-0 w-full h-full">
        {@html shown.html}
    </div>
{/if}