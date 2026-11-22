<script lang="ts" module>
    import type { ReplyMarkKind } from "src/ts/process/replyMarks";

    /** What a character row shows of its replies: whether one is being written, and its chats' strongest mark. */
    export interface CharacterReplyState {
        writing: boolean;
        mark: ReplyMarkKind | null;
    }

    /**
     * The context key under which a screen offers the lookup from a character's id to its reply state. A list that provides
     * none (a bare mount, or a list the screen does not mark) draws names alone.
     */
    export const replyStateContext = Symbol("characterReplyState");
</script>
<script lang="ts">
    import { getContext } from "svelte";
    import { language } from "src/lang";

    interface Props {
        // The character the name belongs to; its reply state is looked up by this id.
        chaId: string;
        name: string;
    }

    let { chaId, name }: Props = $props();

    const lookup = getContext<((chaId: string) => CharacterReplyState) | undefined>(replyStateContext);
    const reply = $derived(lookup?.(chaId));
</script>
<!-- Inline, with no flex, truncation or min width, so a long name wraps exactly as the bare text did. Every listed name renders here. --><span data-part="character-name-row">{name}{#if reply?.mark === 'reply'} <span data-part="reply-new-dot" role="img" aria-label={language.chatNewReplyDot} class="inline-block align-middle size-2 rounded-full bg-selected border border-textcolor2"></span>{:else if reply?.mark === 'error'} <span data-part="reply-error-dot" role="img" aria-label={language.chatReplyErrorDot} class="inline-block align-middle size-2 rounded-full bg-draculared"></span>{/if}</span>
