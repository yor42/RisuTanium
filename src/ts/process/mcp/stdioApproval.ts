import { getAppStore } from "src/ts/storage/store/appStore";
import { alertConfirm, alertError, waitUnreadNotice } from "src/ts/alert";
import { language } from "src/lang";
import { isTauri } from "src/ts/platform";
import { formatStdioConsent, stdioSpecHash, type StdioSpec } from "./stdioSpec";

/** The approvals live only in this byte-store key: never in the database, a module, `.bin` or `.risum`. */
export const MCP_STDIO_APPROVALS_KEY = 'consent/mcp-stdio-approvals.json';

const FORMAT_VERSION = 1;

export type StdioOwner = {
    moduleId: string;
    moduleName: string;
};

type Approvals = Record<string, Record<string, { at: number }>>;

/**
 * `loaded`: the stored value was absent or readable, and approvals are persisted.
 * `unwritable`: it could not be read (it threw, did not parse, or is a newer format). The stored bytes are kept
 * as they are and never written for the rest of the page; approvals hold in memory only.
 */
type ApprovalState = {
    mode: 'loaded' | 'unwritable';
    approvals: Approvals;
    noticeShown: boolean;
};

let statePromise: Promise<ApprovalState> | null = null;
let writeChain: Promise<void> = Promise.resolve();
const asks = new Map<string, Promise<boolean>>();
const declined = new Set<string>();

/** A map without a prototype, so a module id such as `__proto__` is an ordinary key. */
function emptyMap<T>(): Record<string, T> {
    return Object.create(null) as Record<string, T>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The approvals of a v1 file, or `null` when the bytes are not a v1 file of the expected shape. */
function decodeApprovals(bytes: Uint8Array): Approvals | null {
    let data: unknown;
    try {
        data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
        return null;
    }
    if (!isRecord(data) || data.v !== FORMAT_VERSION || !isRecord(data.approvals)) {
        return null;
    }
    const approvals = emptyMap<Approvals[string]>();
    for (const [moduleId, hashes] of Object.entries(data.approvals)) {
        if (!isRecord(hashes)) {
            return null;
        }
        const entry = emptyMap<{ at: number }>();
        for (const [hash, meta] of Object.entries(hashes)) {
            if (!isRecord(meta)) {
                return null;
            }
            entry[hash] = { at: typeof meta.at === 'number' ? meta.at : 0 };
        }
        approvals[moduleId] = entry;
    }
    return approvals;
}

function loadState(): Promise<ApprovalState> {
    statePromise ??= (async (): Promise<ApprovalState> => {
        try {
            const store = await getAppStore();
            const { bytes } = await store.read(MCP_STDIO_APPROVALS_KEY);
            if (bytes === null) {
                return { mode: 'loaded', approvals: emptyMap(), noticeShown: false };
            }
            const approvals = decodeApprovals(bytes);
            if (approvals === null) {
                return { mode: 'unwritable', approvals: emptyMap(), noticeShown: false };
            }
            return { mode: 'loaded', approvals, noticeShown: false };
        } catch (error) {
            console.error('MCP: Failed to read the stdio approvals:', error);
            return { mode: 'unwritable', approvals: emptyMap(), noticeShown: false };
        }
    })();
    return statePromise;
}

function persist(state: ApprovalState) {
    if (state.mode !== 'loaded') {
        return;
    }
    writeChain = writeChain.then(async () => {
        try {
            const bytes = new TextEncoder().encode(JSON.stringify({ v: FORMAT_VERSION, approvals: state.approvals }));
            const store = await getAppStore();
            await store.write(MCP_STDIO_APPROVALS_KEY, bytes, 'unconditional');
        } catch (error) {
            console.error('MCP: Failed to save the stdio approvals:', error);
        }
    });
}

function isApprovedIn(state: ApprovalState, moduleId: string, hash: string) {
    return Object.prototype.hasOwnProperty.call(state.approvals[moduleId] ?? {}, hash);
}

export async function isStdioApproved(moduleId: string, hash: string): Promise<boolean> {
    return isApprovedIn(await loadState(), moduleId, hash);
}

async function ask(state: ApprovalState, owner: StdioOwner, spec: StdioSpec, hash: string): Promise<boolean> {
    // A prompt shown while a notice is up would replace it unseen, including the unreadable-approvals notice of an earlier ask.
    await waitUnreadNotice();
    const accepted = await alertConfirm(formatStdioConsent(owner.moduleName, spec));
    if (accepted) {
        (state.approvals[owner.moduleId] ??= emptyMap<{ at: number }>())[hash] = { at: Date.now() };
        persist(state);
    }
    // The notice follows the answered prompt; an ask started after it waits for it to be read first. An ask
    // already waiting on this prompt's answer can still cover it: the notice is informational and is lost
    // for the page only in that case.
    if (state.mode === 'unwritable' && !state.noticeShown) {
        state.noticeShown = true;
        const location = isTauri ? `${MCP_STDIO_APPROVALS_KEY} (app data folder)` : MCP_STDIO_APPROVALS_KEY;
        alertError(language.alerts.mcpStdioApprovalsUnreadable(location));
    }
    return accepted;
}

/**
 * Whether a program named by a module may start. A spec approved for any owner module (by id and spec hash)
 * is admitted; otherwise the first owner is asked once, concurrent asks share one prompt, and a decline is
 * remembered for the page. A spec with no owner is never admitted.
 */
export async function admitStdio(spec: StdioSpec, owners: readonly StdioOwner[]): Promise<boolean> {
    if (owners.length === 0) {
        return false;
    }
    const hash = await stdioSpecHash(spec);
    const state = await loadState();
    if (owners.some((owner) => isApprovedIn(state, owner.moduleId, hash))) {
        return true;
    }
    const first = owners[0];
    const askKey = `${first.moduleId}\u0000${hash}`;
    if (declined.has(askKey)) {
        return false;
    }
    let pending = asks.get(askKey);
    if (!pending) {
        pending = ask(state, first, spec, hash).then((accepted) => {
            if (!accepted) {
                declined.add(askKey);
            }
            return accepted;
        }).finally(() => {
            asks.delete(askKey);
        });
        asks.set(askKey, pending);
    }
    return await pending;
}
