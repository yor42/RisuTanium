// Reads a bundled built-in archive's bytes from the URL the build emitted for it. A missing asset answers null; a failed
// fetch or body read propagates, so the caller can tell "could not check" from "the file is not there". This is the one
// module the Vitest setup replaces, because a Vitest asset URL is a dev-server path no Node fetch can read.

/** The archive bytes at `url`, or null when the server answers a non-ok status. */
export async function readBundledArchive(url: string): Promise<Uint8Array | null> {
    const response = await fetch(url)
    if (!response.ok) {
        return null
    }
    return new Uint8Array(await response.arrayBuffer())
}
