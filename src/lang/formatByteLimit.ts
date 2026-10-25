export const BYTES_PER_MIB = 1024 * 1024
export const BYTES_PER_GIB = 1024 * BYTES_PER_MIB

/** A byte limit as MiB below 1 GiB and as GiB from 1 GiB up, so the limits in use read 100 MiB, 200 MiB and 1 GiB. */
export function formatByteLimit(bytes: number): string {
    return bytes >= BYTES_PER_GIB ? `${bytes / BYTES_PER_GIB} GiB` : `${bytes / BYTES_PER_MIB} MiB`
}
