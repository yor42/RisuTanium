/**
 * Data Leave-Out Sheet
 *
 * The definition of the sheet that asks, once, about everything a `.bin` leaves out because upstream has no place for it.
 * The consequences are one line per source group (alternative replies, other chat data only this app uses, this app's
 * own data), so a profile holding all six kinds still shows every kind on screen without a tap. Item names stay behind
 * the sheet's disclosure.
 *
 * Component-free and engine-free: it imports the sheet's types and the shared prompt-name cut only.
 */

import { language } from '../../lang';
import { VISIBLE_CONSEQUENCES, type PatternWarningDef } from '../../lib/Nexus/pattern/patternWarning';
import type { BinLeaveOutEntry } from '../drive/binLeaveOut';
import type { ForkOnlyChatLabel } from '../drive/exportAlternatives';
import { shownPromptNames, UPSTREAM_PROMPT_NAMES_SHOWN } from '../drive/backupUpstreamSizes';

/**
 * Throws when the lines would fold behind the disclosure. A kind folded out of view would be left out without being
 * named, so a future fourth group fails here, in tests, instead of on a person's screen.
 */
export function assertAllConsequencesShown(lines: readonly string[]): void {
    if (lines.length > VISIBLE_CONSEQUENCES) {
        throw new Error(`The leave-out sheet has ${lines.length} consequences; only ${VISIBLE_CONSEQUENCES} are shown without a tap.`);
    }
}

function alternativesLine(label: ForkOnlyChatLabel): string {
    const [text] = shownPromptNames([label.text]);
    const branches = label.branches;
    return branches === undefined ? language.backupBranchesLeftOutLine(text) : language.backupBranchesLine(text, branches.chats, branches.bytes, branches.omitted);
}

function forkChatLine(label: ForkOnlyChatLabel): string {
    const [text] = shownPromptNames([label.text]);
    const kinds = label.kinds.filter((kind) => kind !== 'alternatives');
    return `${text} (${kinds.map((kind) => language.backupForkChatDataKind(kind)).join(', ')})`;
}

/** The detail line of one kind: its label and the names it holds, cut like the per-kind prompts cut them. */
function namedLine(kindLabel: string, shown: readonly string[], count: number): string {
    return language.settingsShellDataLeaveOutNamed(kindLabel, [...shown], count - shown.length);
}

export function leaveOutSheetDef(summary: readonly BinLeaveOutEntry[]): PatternWarningDef {
    const consequences: string[] = [];
    const named: string[] = [];
    const appItems: string[] = [];
    for (const entry of summary) {
        switch (entry.kind) {
            case 'alternatives': {
                consequences.push(language.settingsShellDataLeaveOutAlternatives(entry.count, entry.branchChats));
                const shown = entry.labels.slice(0, UPSTREAM_PROMPT_NAMES_SHOWN).map(alternativesLine);
                named.push(namedLine(language.settingsShellDataKindAlternatives, shown, entry.count));
                break;
            }
            case 'forkChatData': {
                consequences.push(language.settingsShellDataLeaveOutForkChat(entry.count, entry.kinds.map((kind) => language.backupForkChatDataKind(kind)).join(', ')));
                const shown = entry.labels.slice(0, UPSTREAM_PROMPT_NAMES_SHOWN).map(forkChatLine);
                named.push(namedLine(language.settingsShellDataKindForkChat, shown, entry.count));
                break;
            }
            case 'taskPresets':
                appItems.push(language.settingsShellDataLeaveOutTaskPresets(entry.count));
                named.push(namedLine(language.settingsShellDataKindTaskPresets, shownPromptNames(entry.names), entry.count));
                break;
            case 'themePacks':
                appItems.push(language.settingsShellDataLeaveOutThemePacks(entry.count));
                named.push(namedLine(language.settingsShellDataKindThemePacks, shownPromptNames(entry.names), entry.count));
                break;
            case 'usageStats':
                appItems.push(language.settingsShellDataLeaveOutUsage);
                break;
            case 'chroMemory':
                appItems.push(language.settingsShellDataKindChroMemory);
                break;
        }
    }
    if (appItems.length > 0) {
        consequences.push(language.settingsShellDataLeaveOutAppData(appItems.join(', ')));
    }
    assertAllConsequencesShown(consequences);
    return {
        severity: 'caution',
        headline: language.settingsShellDataLeaveOutTitle,
        consequences,
        detail: [language.settingsShellDataLeaveOutStays, ...named],
        actions: {
            cancel: language.cancel,
            secondary: language.settingsShellDataLeaveOutRtb,
            primary: language.settingsShellDataLeaveOutContinue,
        },
    };
}

/** The kind labels of the summary, in order, for the result line that repeats what the last `.bin` left out. */
export function leftOutKindLabels(summary: readonly BinLeaveOutEntry[]): string[] {
    return summary.map((entry) => {
        switch (entry.kind) {
            case 'alternatives': return language.settingsShellDataKindAlternatives;
            case 'forkChatData': return language.settingsShellDataKindForkChat;
            case 'taskPresets': return language.settingsShellDataKindTaskPresets;
            case 'themePacks': return language.settingsShellDataKindThemePacks;
            case 'usageStats': return language.settingsShellDataKindUsage;
            case 'chroMemory': return language.settingsShellDataKindChroMemory;
        }
    });
}
