<script lang="ts">
    import { language } from 'src/lang'
    import { fillLang } from 'src/lang/fill'
    import type { character as Character, groupChat as GroupChat } from 'src/ts/storage/database.svelte'
    import { runningReplyInChat } from 'src/ts/nativeReply/runningReplies.svelte'

    // The shown character comes from the host, which already tracks the selection.
    let { character }: { character: Character | GroupChat | undefined } = $props()

    // A reply for the shown chat that the native side is still receiving and whose message is not in the chat yet.
    // A reply whose message exists is shown on that message instead, so one reply never shows both.
    let chat = $derived(character?.chats?.[character.chatPage])
    let running = $derived(
        character && character.type !== 'group'
            ? runningReplyInChat(character.chaId, chat?.id, chat?.message)
            : null,
    )
</script>

{#if running}
    <div
        role="status"
        data-part="reply-running-notice"
        class="mx-4 mt-2 mb-2 p-2 rounded-md border border-darkborderc bg-darkbg text-textcolor2 text-sm italic wrap-anywhere"
    >{fillLang(language.chatReplyRunning, { name: running.name })}</div>
{/if}
