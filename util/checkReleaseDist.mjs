// Fails when a release build still contains the put-back measurement code.
// Usage: node util/checkReleaseDist.mjs [directory]   (default: dist)
//
// Invariant: only executable output is scanned (.js, .mjs, .cjs, .html, .css). Source maps are
// excluded on purpose: `vite build --sourcemap` embeds the original source text, so the markers
// appear in every map even when the measurement branch is folded out of the shipped code.
// Exit codes: 0 clean, 1 marker found, 2 missing directory or nothing to scan.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'

const FORBIDDEN_MARKERS = ['__risuPutBackMeasure', 'risu-measure-putback', 'risu-measure-tripwire', 'risu-measure-import', '__risuSweepDryRun', '__risuGcNow', '__risuCommitMeter', 'risu-measure-commit', '__risuImportPhases', '__risuChatPhases', '__risuImportBench', 'risu-measure-copy', 'writeSyncMs=', 'writeList=', 'stubEncodeMs=', 'rangeWallMs=', 'writeVia=', ' encodeMs=', ' closeMs=', 'stubAhead=', 'stubHeldMax=', 'appendSynced=']
const SCANNED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.html', '.css'])

const root = process.argv[2] ?? 'dist'

function listScannedFiles(dir) {
    const files = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) {
            files.push(...listScannedFiles(path))
        } else if (entry.isFile() && SCANNED_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
            files.push(path)
        }
    }
    return files
}

let isDirectory = false
try {
    isDirectory = statSync(root).isDirectory()
} catch {
    // Reported below with the other missing-build case.
}
if (!isDirectory) {
    console.error(`checkReleaseDist: "${root}" is not a directory; run the build first.`)
    process.exit(2)
}

const files = listScannedFiles(root)
if (files.length === 0) {
    console.error(`checkReleaseDist: no scannable files under "${root}"; the build is missing or empty.`)
    process.exit(2)
}

let hits = 0
for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const marker of FORBIDDEN_MARKERS) {
        if (text.includes(marker)) {
            console.log(`${file}: ${marker}`)
            hits++
        }
    }
}

if (hits > 0) {
    console.error(`checkReleaseDist: ${hits} forbidden marker hit(s) under "${root}".`)
    process.exit(1)
}
console.log(`checkReleaseDist: OK, ${files.length} files scanned under "${root}", no measurement markers.`)
