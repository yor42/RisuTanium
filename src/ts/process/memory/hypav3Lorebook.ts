import type { Chat, character, groupChat, loreBook } from "src/ts/storage/database.svelte";
import type { SerializableHypaV3Data, SerializableSummary } from "./hypav3";
import { splitLoreKeys } from "../loreKeys";
import { alertConfirm, alertNormal } from "src/ts/alert";
import { language } from "src/lang";
import { fillLang } from "src/lang/fill";
import { DBState } from "src/ts/stores.svelte";
import { markCharacterForSave } from "src/ts/storage/characterSaveMarks";

/**
 * Moves HypaV3 summaries to and from the open chat's own lorebook (`Chat.localLore`).
 *
 * Both directions only add data: an existing lorebook entry or summary is never replaced or edited, and no
 * field is introduced that upstream does not already have, so the `.bin` shape is unchanged. Both skip an
 * item whose trimmed text is already on the other side or earlier in the same batch, so export followed by
 * import (and the reverse) adds nothing.
 */

const metricKeys = [
    "lastImportantSummaries",
    "lastRecentSummaries",
    "lastSimilarSummaries",
    "lastRandomSummaries",
] as const;

function trimmedText(text: string | undefined): string {
    return typeof text === "string" ? text.trim() : "";
}

/** Trimmed, non-empty, first occurrence wins. Always a new array. */
function cleanKeywords(words: readonly string[]): string[] {
    const result: string[] = [];

    for (const word of words) {
        const trimmed = typeof word === "string" ? word.trim() : "";

        if (trimmed !== "" && !result.includes(trimmed)) {
            result.push(trimmed);
        }
    }

    return result;
}

function exportKeywords(
    summary: SerializableSummary,
    categories: SerializableHypaV3Data["categories"]
): string[] {
    const words = [...(summary.tags ?? [])];

    // The uncategorized id is "" and never names a keyword.
    if (typeof summary.categoryId === "string" && summary.categoryId !== "") {
        const category = categories?.find((c) => c.id === summary.categoryId);

        if (category) {
            words.push(category.name);
        }
    }

    return cleanKeywords(words);
}

/**
 * One new `loreBook` entry per summary not yet in `lore`. Key = the summary's tags plus its category name; an
 * entry without keywords has an empty key and `alwaysActive: false`, which the lorebook scan never activates.
 * Summaries with blank text are neither exported nor counted.
 */
export function planSummaryExport(
    data: SerializableHypaV3Data,
    lore: readonly loreBook[],
    commentOf: (n: number) => string
): { entries: loreBook[]; skipped: number } {
    const seen = new Set(lore.map((entry) => trimmedText(entry.content)));
    const entries: loreBook[] = [];
    let skipped = 0;

    data.summaries.forEach((summary, i) => {
        const text = trimmedText(summary.text);

        if (text === "") return;

        if (seen.has(text)) {
            skipped++;
            return;
        }

        seen.add(text);
        entries.push({
            key: exportKeywords(summary, data.categories).join(", "),
            secondkey: "",
            insertorder: 100,
            comment: commentOf(i + 1),
            content: summary.text,
            mode: "normal",
            alwaysActive: false,
            selective: false,
        });
    });

    return { entries, skipped };
}

function isImportableEntry(entry: loreBook): boolean {
    return (
        entry.mode !== "folder" &&
        entry.mode !== "child" &&
        trimmedText(entry.content) !== ""
    );
}

/**
 * One new summary per importable lorebook entry (folders, "active in this chat" links and entries without
 * text are not importable) whose text is not yet a summary. A new summary has no connected messages, so it
 * adds nothing to the fork's resume point. Tags come from the entry's keys; no category is assigned.
 */
export function planLoreImport(
    lore: readonly loreBook[],
    summaries: readonly SerializableSummary[]
): { summaries: SerializableSummary[]; skipped: number } {
    const seen = new Set(summaries.map((summary) => trimmedText(summary.text)));
    const result: SerializableSummary[] = [];
    let skipped = 0;

    for (const entry of lore) {
        if (!isImportableEntry(entry)) continue;

        const text = trimmedText(entry.content);

        if (seen.has(text)) {
            skipped++;
            continue;
        }

        seen.add(text);
        result.push({
            text: entry.content,
            chatMemos: [],
            isImportant: false,
            tags: cleanKeywords(
                splitLoreKeys(entry.key ?? "", entry.useRegex ?? false)
            ),
        });
    }

    return { summaries: result, skipped };
}

function loreOf(chat: Chat): loreBook[] {
    return Array.isArray(chat.localLore) ? chat.localLore : [];
}

function commentOf(n: number): string {
    return fillLang(language.hypaV3Modal.lorebookEntryComment, { index: n });
}

function confirmText(template: string, count: number, skipped: number): string {
    const text = fillLang(template, { count });

    return skipped > 0
        ? text +
              "\n" +
              fillLang(language.hypaV3Modal.lorebookTransferSkippedNote, {
                  skipped,
              })
        : text;
}

function stillOpen(char: character | groupChat, chat: Chat): boolean {
    return DBState.db.characters.includes(char) && char.chats.includes(chat);
}

/**
 * Appends this chat's summaries to its own lorebook after one confirmation. Returns the number of entries
 * added (0 when nothing was written). The plan is computed again after the confirmation, because the
 * lorebook or the summaries can change while the dialog is open.
 */
export async function exportSummariesToChatLore(
    char: character | groupChat,
    chat: Chat | undefined
): Promise<number> {
    if (!chat?.hypaV3Data) return 0;

    const plan = planSummaryExport(chat.hypaV3Data, loreOf(chat), commentOf);

    if (plan.entries.length === 0) {
        alertNormal(language.hypaV3Modal.exportToLorebookNothing);
        return 0;
    }

    if (
        !(await alertConfirm(
            confirmText(
                language.hypaV3Modal.exportToLorebookConfirm,
                plan.entries.length,
                plan.skipped
            )
        ))
    ) {
        return 0;
    }

    if (!stillOpen(char, chat) || !chat.hypaV3Data) return 0;

    const fresh = planSummaryExport(chat.hypaV3Data, loreOf(chat), commentOf);

    if (fresh.entries.length === 0) {
        alertNormal(language.hypaV3Modal.exportToLorebookNothing);
        return 0;
    }

    if (!Array.isArray(chat.localLore)) {
        chat.localLore = [];
    }

    chat.localLore.push(...fresh.entries);
    markCharacterForSave(char.chaId);
    alertNormal(
        fillLang(language.hypaV3Modal.exportToLorebookDone, {
            count: fresh.entries.length,
        })
    );

    return fresh.entries.length;
}

/**
 * Adds this chat's lorebook entries before its existing summaries after one confirmation. Returns the number of
 * summaries added (0 when nothing was written).
 *
 * New summaries go first: upstream resumes summarization from the last memo of the last summary, so while at
 * least one existing summary has connected messages, that summary stays last and an imported one never
 * becomes the resume anchor. When there is no existing summary, the last imported summary has no memo;
 * upstream then matches the first message without a memo and starts there or at the beginning. The metrics
 * hold indices into `summaries`, so they shift by the number added and keep pointing at the same summaries.
 */
export async function importChatLoreAsSummaries(
    char: character | groupChat,
    chat: Chat | undefined
): Promise<number> {
    if (!chat?.hypaV3Data) return 0;

    const plan = planLoreImport(loreOf(chat), chat.hypaV3Data.summaries);

    if (plan.summaries.length === 0) {
        alertNormal(language.hypaV3Modal.importFromLorebookNothing);
        return 0;
    }

    if (
        !(await alertConfirm(
            confirmText(
                language.hypaV3Modal.importFromLorebookConfirm,
                plan.summaries.length,
                plan.skipped
            )
        ))
    ) {
        return 0;
    }

    if (!stillOpen(char, chat) || !chat.hypaV3Data) return 0;

    const data = chat.hypaV3Data;
    const fresh = planLoreImport(loreOf(chat), data.summaries);
    const added = fresh.summaries.length;

    if (added === 0) {
        alertNormal(language.hypaV3Modal.importFromLorebookNothing);
        return 0;
    }

    data.summaries.unshift(...fresh.summaries);

    if (data.metrics) {
        for (const key of metricKeys) {
            const indices = data.metrics[key];

            if (Array.isArray(indices)) {
                data.metrics[key] = indices.map((index) => index + added);
            }
        }
    }

    markCharacterForSave(char.chaId);
    alertNormal(fillLang(language.hypaV3Modal.importFromLorebookDone, { count: added }));

    return added;
}
