import { language } from "src/lang";
import { fetchNative, globalFetch, type GlobalFetchArgs, type NativeInternal } from "../globalApi.svelte";
import { getAllowPrivate } from "./privateNetworkConsent";

type NativeFetchArgs = Parameters<typeof fetchNative>[1];
type GlobalFetchOutcome = Awaited<ReturnType<typeof globalFetch>>;

const BLOCKED_MARKER = /NATIVE_DESTINATION_BLOCKED \(private\): (\S+)/;

/**
 * The only module that supplies a native destination policy. Plugins, cards and MCP import these wrappers
 * instead of `fetchNative` and `globalFetch`, so their requests cannot reach a private destination unless
 * the device-local toggle is on. The toggle is read on every request.
 */
async function currentPolicy(): Promise<NativeInternal> {
    let allowPrivate = false;
    try {
        allowPrivate = await getAllowPrivate();
    } catch (error) {
        console.error('Network: Failed to read the private-network setting:', error);
    }
    return { nativePolicy: { allowPrivate } };
}

function blockedMessage(text: string, url: string): string | null {
    const match = BLOCKED_MARKER.exec(text);
    if (match === null) {
        return null;
    }
    let host = match[1];
    if (!host) {
        try {
            host = new URL(url).hostname;
        } catch {
            host = url;
        }
    }
    return language.nativePrivateNetworkBlocked(host);
}

export async function untrustedNativeFetch(url: string, arg: NativeFetchArgs): Promise<Response> {
    const internal = await currentPolicy();
    try {
        return await fetchNative(url, arg, internal);
    } catch (error) {
        const message = blockedMessage(error instanceof Error ? error.message : String(error), url);
        if (message !== null) {
            throw new Error(message);
        }
        throw error;
    }
}

export async function untrustedGlobalFetch(url: string, arg: GlobalFetchArgs = {}): Promise<GlobalFetchOutcome> {
    const internal = await currentPolicy();
    const result = await globalFetch(url, arg, internal);
    if (!result.ok && typeof result.data === 'string') {
        const message = blockedMessage(result.data, url);
        if (message !== null) {
            return { ...result, data: message };
        }
    }
    return result;
}
