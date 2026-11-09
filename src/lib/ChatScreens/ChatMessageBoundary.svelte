<script lang="ts">
    /*
        One message of the chat list. The boundary wraps the whole Chat component, not a part of its template: a
        throw from Chat's script-level effects or from its children is then handled here and never reaches the flush
        that runs every message, so the other messages keep updating.
    */
    import { untrack, type ComponentProps } from 'svelte';
    import type { StreamingDisplayOptimizationMode } from 'src/ts/storage/database.svelte';
    import { language } from '../../lang';
    import { recordCaughtError } from 'src/ts/caughtErrors';
    import Chat from './Chat.svelte';

    // Every prop goes to Chat unchanged, except `message` and `translationHold`, which follow the caller's updates for the
    // streaming tail that the list carries in place, and `expectedId`, which follows the id stamped onto a row that mounted
    // without one. For every other row they keep their mount-time values.
    let { ...rest }: ComponentProps<typeof Chat> = $props();

    let inner: ReturnType<typeof Chat> | undefined = $state();

    // The live text and translation hold of this row, each with a plain shadow of what was last written. The caller's
    // update compares against the shadow and writes the state only on a change, so it never reads reactive state.
    let liveMessage = $state(untrack(() => rest.message));
    let liveHold = $state(untrack(() => rest.translationHold ?? false));
    let sentMessage = untrack(() => rest.message);
    let sentHold = untrack(() => rest.translationHold ?? false);
    let liveExpectedId = $state(untrack(() => rest.expectedId));
    let sentExpectedId = untrack(() => rest.expectedId);

    // What the current Chat last holds of the streaming state, and which Chat that is. Plain bookkeeping, never read
    // reactively: an unchanged update is dropped here, because Chat ignores an equal value anyway.
    let sentChat: ReturnType<typeof Chat> | undefined;
    let sentOptimized = false;
    let sentMode: StreamingDisplayOptimizationMode = 'off';
    let sentRaw = '';

    // Absent while the fallback is shown, because the Chat is gone then. The read of `inner` is reactive on purpose:
    // the caller's effect re-runs when the Chat is re-mounted after a Retry, and a Chat that is new to this record starts
    // from its mount-time state, so the new Chat gets the current streaming state. The text and the hold are props of
    // the Chat, so a re-mounted Chat reads their current values and needs no record.
    export function updateStreamingDisplay(state: {
        isOptimizedStreamingMessage: boolean
        streamingOptimizationMode: StreamingDisplayOptimizationMode
        rawStreamingText: string
        message?: string
        translationHold?: boolean
    }) {
        const chat = inner;
        if(state.message !== undefined && state.message !== sentMessage){
            sentMessage = state.message;
            liveMessage = state.message;
        }
        if(state.translationHold !== undefined && state.translationHold !== sentHold){
            sentHold = state.translationHold;
            liveHold = state.translationHold;
        }
        if(!chat){
            return
        }
        if(chat !== sentChat){
            sentChat = chat;
            untrack(() => {
                sentOptimized = rest.isOptimizedStreamingMessage ?? false;
                sentMode = rest.streamingOptimizationMode ?? 'off';
                sentRaw = rest.rawStreamingText ?? rest.message ?? '';
            });
        }
        if(state.isOptimizedStreamingMessage === sentOptimized
            && state.streamingOptimizationMode === sentMode
            && state.rawStreamingText === sentRaw){
            return
        }
        sentOptimized = state.isOptimizedStreamingMessage;
        sentMode = state.streamingOptimizationMode;
        sentRaw = state.rawStreamingText;
        chat.updateStreamingDisplay?.({
            isOptimizedStreamingMessage: state.isOptimizedStreamingMessage,
            streamingOptimizationMode: state.streamingOptimizationMode,
            rawStreamingText: state.rawStreamingText,
        })
    }

    // The caller's stamp of a message id onto a mounted row. Compares against the plain shadow and never reads the state.
    export function updateExpectedId(id: string | undefined) {
        if(id !== sentExpectedId){
            sentExpectedId = id;
            liveExpectedId = id;
        }
    }

    // Whether the Chat shows the translated view; false while the fallback is shown. Untracked, so the caller's effect
    // gains no dependency from asking.
    export function isTranslatedView(): boolean {
        return untrack(() => inner?.isTranslatedView?.() ?? false)
    }
</script>

<svelte:boundary onerror={(error) => recordCaughtError('chat.message', error)}>
    <Chat bind:this={inner} {...rest} message={liveMessage} translationHold={liveHold} expectedId={liveExpectedId} />
    {#snippet failed(_error, reset)}
        <!-- The message text is shown as plain text interpolation, never as markup. -->
        <div class="flex flex-col gap-2 p-3 w-full text-textcolor" data-chat-failed={rest.idx}>
            <div class="whitespace-pre-wrap break-words">{liveMessage}</div>
            <div class="text-xs text-textcolor2 italic" role="note">{language.messageRenderFailed}</div>
            <div>
                <button class="px-3 py-1 rounded-md bg-darkbutton hover:bg-selected text-textcolor" onclick={reset}>{language.messageRenderRetry}</button>
            </div>
        </div>
    {/snippet}
</svelte:boundary>
