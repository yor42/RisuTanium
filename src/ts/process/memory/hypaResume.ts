import type { OpenAIChat } from "../index.svelte";

/**
 * Chats the summarisers never feed to a summary: example turns, the new-chat
 * markers and blank messages.
 */
export function isSkipEligibleChat(chat: OpenAIChat): boolean {
    return (
        chat.name === "example_user" ||
        chat.name === "example_assistant" ||
        chat.memo === "NewChatExample" ||
        chat.memo === "NewChat" ||
        chat.content.trim().length === 0
    );
}

/**
 * Index in `chats` of the last message any summary covers, or -1 when none is
 * covered. The resume point is the highest position of any memo of any
 * summary: neither summary order nor memo order within a set is trusted.
 *
 * The `undefined` memo is shared by every memo-less chat (greeting, example
 * turns), so a set holding it does not say which of them it covered. It counts
 * only when the first memo-less chat is one the summarisers would not skip;
 * otherwise upstream sets that cover example turns under `undefined` would
 * resume past a greeting that was never summarised.
 */
export function findResumeIndex(
    chats: OpenAIChat[],
    memoSets: Iterable<Iterable<string | undefined>>
): number {
    const positions = new Map<string | undefined, number>();

    for (let i = 0; i < chats.length; i++) {
        if (!positions.has(chats[i].memo)) {
            positions.set(chats[i].memo, i);
        }
    }

    const firstMemoless = positions.get(undefined);

    if (
        firstMemoless !== undefined &&
        isSkipEligibleChat(chats[firstMemoless])
    ) {
        positions.delete(undefined);
    }

    let resumeIndex = -1;

    for (const memos of memoSets) {
        for (const memo of memos) {
            const position = positions.get(memo);

            if (position !== undefined && position > resumeIndex) {
                resumeIndex = position;
            }
        }
    }

    return resumeIndex;
}
