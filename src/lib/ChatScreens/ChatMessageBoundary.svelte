<script lang="ts">
    /*
        One message of the chat list. The boundary wraps the whole Chat component, not a part of its template: a
        throw from Chat's script-level effects or from its children is then handled here and never reaches the flush
        that runs every message, so the other messages keep updating.
    */
    import type { ComponentProps } from 'svelte';
    import type { StreamingDisplayOptimizationMode } from 'src/ts/storage/database.svelte';
    import { language } from '../../lang';
    import { recordCaughtError } from 'src/ts/caughtErrors';
    import Chat from './Chat.svelte';

    // Every prop goes to Chat unchanged, `message` included.
    let { ...rest }: ComponentProps<typeof Chat> = $props();

    let inner: ReturnType<typeof Chat> | undefined = $state();

    // Absent while the fallback is shown, because the Chat is gone then.
    export function updateStreamingDisplay(state: {
        isOptimizedStreamingMessage: boolean
        streamingOptimizationMode: StreamingDisplayOptimizationMode
        rawStreamingText: string
    }) {
        inner?.updateStreamingDisplay?.(state)
    }
</script>

<svelte:boundary onerror={(error) => recordCaughtError('chat.message', error)}>
    <Chat bind:this={inner} {...rest} />
    {#snippet failed(_error, reset)}
        <!-- The message text is shown as plain text interpolation, never as markup. -->
        <div class="flex flex-col gap-2 p-3 w-full text-textcolor" data-chat-failed={rest.idx}>
            <div class="whitespace-pre-wrap break-words">{rest.message}</div>
            <div class="text-xs text-textcolor2 italic" role="note">{language.messageRenderFailed}</div>
            <div>
                <button class="px-3 py-1 rounded-md bg-darkbutton hover:bg-selected text-textcolor" onclick={reset}>{language.messageRenderRetry}</button>
            </div>
        </div>
    {/snippet}
</svelte:boundary>
