// @vitest-environment node
/**
 * `server/node/ssl/Generate Certificate.sh` leaves the private keys readable by
 * their owner only (mode 600) and the certificates and request world-readable
 * (644). The script runs in a temporary copy of the `ssl` directory. It needs
 * `bash` and `openssl` and POSIX file modes, so it is skipped on Windows (Git
 * Bash emulates modes) and where `openssl` is missing.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'

const SSL_DIR = fileURLToPath(new URL('../../../../server/node/ssl/', import.meta.url))
const hasOpenssl = process.platform !== 'win32' && spawnSync('openssl', ['version']).status === 0
let workDir: string | undefined

afterAll(async () => {
    if (workDir !== undefined) {
        await rm(workDir, { recursive: true, force: true })
    }
})

describe.skipIf(!hasOpenssl)('Generate Certificate.sh', () => {
    test('S6-T1 the keys are mode 600 and the certificates and request mode 644', async () => {
        workDir = await mkdtemp(join(tmpdir(), 'risu-cert-'))
        // The files may be checked out with CRLF line endings, which bash cannot run.
        for (const name of ['ca.conf', 'server.conf', 'Generate Certificate.sh']) {
            const text = (await readFile(join(SSL_DIR, name), 'utf-8')).replace(/\r\n/g, '\n')
            await writeFile(join(workDir, name), text)
        }
        // A permissive inherited umask must not leak into the keys.
        execFileSync('bash', ['-c', 'umask 022 && bash "./Generate Certificate.sh"'], { cwd: workDir, stdio: 'pipe' })
        const mode = async (name: string) => (await stat(join(workDir!, 'certificate', name))).mode & 0o777
        expect(await mode('ca.key')).toBe(0o600)
        expect(await mode('server.key')).toBe(0o600)
        expect(await mode('ca.crt')).toBe(0o644)
        expect(await mode('server.crt')).toBe(0o644)
        expect(await mode('server.csr')).toBe(0o644)
    }, 60_000)
})
