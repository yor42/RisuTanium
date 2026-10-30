/**
 * The byte store is loaded on first use: importing this module, and so the untrusted wrappers that
 * scripting code imports, must not run the platform detection that the store module runs at load.
 */
async function getAppStore() {
    const { getAppStore: select } = await import("src/ts/storage/store/appStore");
    return await select();
}

/** The toggle lives only in this byte-store key: never in the database, a module, `.bin` or `.risum`. */
export const NATIVE_PRIVATE_NETWORK_KEY = 'consent/native-private-network.json';

const FORMAT_VERSION = 1;

type ConsentState = {
    mode: 'loaded' | 'unwritable';
    allowPrivate: boolean;
};

/**
 * Set once a stored value could not be read (it threw, did not parse, is empty or is a newer format). The
 * stored bytes are then kept as they are and never written for the rest of the page; the choice holds in
 * memory only and defaults to off.
 */
let unwritableMemory: boolean | null = null;
let writeChain: Promise<void> = Promise.resolve();

function decodeAllowPrivate(bytes: Uint8Array): boolean | null {
    let data: unknown;
    try {
        data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
        return null;
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        return null;
    }
    const record = data as Record<string, unknown>;
    if (record.v !== FORMAT_VERSION || typeof record.allowPrivate !== 'boolean') {
        return null;
    }
    return record.allowPrivate;
}

async function readState(): Promise<ConsentState> {
    if (unwritableMemory !== null) {
        return { mode: 'unwritable', allowPrivate: unwritableMemory };
    }
    try {
        const store = await getAppStore();
        const { bytes } = await store.read(NATIVE_PRIVATE_NETWORK_KEY);
        if (bytes === null) {
            return { mode: 'loaded', allowPrivate: false };
        }
        const allowPrivate = decodeAllowPrivate(bytes);
        if (allowPrivate === null) {
            unwritableMemory = false;
            return { mode: 'unwritable', allowPrivate: false };
        }
        return { mode: 'loaded', allowPrivate };
    } catch (error) {
        console.error('Network: Failed to read the private-network setting:', error);
        unwritableMemory = false;
        return { mode: 'unwritable', allowPrivate: false };
    }
}

/**
 * Whether plugins, cards and MCP may reach private-network destinations natively. Read from the store on
 * every call, so a change made in another tab is never stale; any failure means off.
 */
export async function getAllowPrivate(): Promise<boolean> {
    return (await readState()).allowPrivate;
}

/**
 * Stores the choice. When the stored value cannot be read it is left untouched and the choice holds in
 * memory only; the return value tells whether it was persisted.
 */
export async function setAllowPrivate(allowPrivate: boolean): Promise<{ persisted: boolean }> {
    const state = await readState();
    if (state.mode !== 'loaded') {
        unwritableMemory = allowPrivate;
        return { persisted: false };
    }
    let persisted = false;
    writeChain = writeChain.then(async () => {
        try {
            const bytes = new TextEncoder().encode(JSON.stringify({ v: FORMAT_VERSION, allowPrivate }));
            const store = await getAppStore();
            await store.write(NATIVE_PRIVATE_NETWORK_KEY, bytes, 'unconditional');
            persisted = true;
        } catch (error) {
            console.error('Network: Failed to save the private-network setting:', error);
        }
    });
    await writeChain;
    return { persisted };
}
