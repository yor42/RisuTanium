import { BaseDirectory, open, readFile, writeFile } from '@tauri-apps/plugin-fs'
import { CHUNK_MAX, isDesktopTransport } from './tauriByteTransport'

/**
 * Reading and writing files the user names, outside the app's data directory
 * (an opened or picked import, an image path, a file saved to Downloads), with
 * no plugin call that carries more than `CHUNK_MAX` bytes of file payload on
 * desktop. One call that moves a whole large file makes the web view allocate
 * several times its size at once. Every other platform keeps its single call.
 *
 * Paths are used as given and stay inside the file-system scope the shell
 * grants; no path is built here.
 */

/**
 * Reads the whole file at `path`: the plugin opens it, then reads pieces of at
 * most `CHUNK_MAX` bytes until the end. A read may return fewer bytes than
 * asked, and the loop goes on from where it stopped. The handle is closed on
 * every exit. The pieces are joined into one array at the end, so a file of
 * more than one piece is held twice for a moment.
 */
export async function readUserFile(path: string): Promise<Uint8Array> {
    if (!isDesktopTransport()) {
        return await readFile(path)
    }
    const handle = await open(path, { read: true })
    try {
        const pieces: Uint8Array[] = []
        let total = 0
        for (;;) {
            const piece = new Uint8Array(CHUNK_MAX)
            const count = await handle.read(piece)
            if (count === null) {
                break
            }
            if (count === 0) {
                throw new Error(`reading ${path} returned no bytes before the end of the file`)
            }
            pieces.push(count === piece.length ? piece : piece.slice(0, count))
            total += count
        }
        if (pieces.length === 1) {
            return pieces[0]
        }
        const out = new Uint8Array(total)
        let offset = 0
        for (const piece of pieces) {
            out.set(piece, offset)
            offset += piece.length
        }
        return out
    } finally {
        // A read handle that fails to close holds nothing the caller needs, and its error must not replace a read error.
        await handle.close().catch(() => undefined)
    }
}

/**
 * Writes `data` to `name` under `baseDir`, replacing any file there. Desktop
 * writes more than `CHUNK_MAX` bytes as consecutive calls of at most that size:
 * the first creates or truncates the file and the others append. A failure
 * between calls leaves the file cut, as a failing single write does.
 */
export async function writeUserFile(name: string, data: Uint8Array, baseDir: BaseDirectory): Promise<void> {
    if (!isDesktopTransport() || data.length <= CHUNK_MAX) {
        await writeFile(name, data, { baseDir })
        return
    }
    for (let start = 0; start < data.length; start += CHUNK_MAX) {
        await writeFile(name, data.subarray(start, Math.min(start + CHUNK_MAX, data.length)), { baseDir, append: start > 0 })
    }
}
