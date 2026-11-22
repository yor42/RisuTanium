<script lang="ts">
    import { getContext } from "svelte";
    import { language } from "src/lang";
    import { stopRepliesOf } from "src/ts/process/chatOrigin";
    import { replyStateContext, type CharacterReplyState } from "./CharacterNameRow.svelte";
    import ReplyStopButton from "./ReplyStopButton.svelte";

    interface Props {
        // The character whose writing chats a tap stops; its reply state is looked up by this id.
        chaId: string;
        name: string;
        class?: string;
    }

    let { chaId, name, class: className = "" }: Props = $props();

    const lookup = getContext<((chaId: string) => CharacterReplyState) | undefined>(replyStateContext);
    const writing = $derived(lookup?.(chaId).writing ?? false);
</script>
{#if writing}
    <ReplyStopButton label={language.chatStopReplyFor(name)} onstop={() => stopRepliesOf(chaId)} class={className} />
{/if}
