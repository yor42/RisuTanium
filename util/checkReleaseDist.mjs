// Fails when a release build still contains the put-back measurement code or the module fault switch.
// Usage: node util/checkReleaseDist.mjs [--fault-only] [directory]   (default: dist)
//
// Invariant: the measurement markers are scanned in executable output only (.js, .mjs, .cjs, .html, .css). Source
// maps are excluded for them on purpose: `vite build --sourcemap` embeds the original source text, so those markers
// appear in every map even when the measurement branch is folded out of the shipped code. The fault-switch markers are
// also scanned in .map files: no source file except the flag module holds them, so a map that carries one means the
// flag module was bundled. `--fault-only` scans the fault-switch markers alone, which is the check for an unminified
// debug build whose measurement text survives in comments.
// Exit codes: 0 clean, 1 marker found, 2 missing directory, nothing to scan or an unknown option.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'

const MEASURE_MARKERS = ['__risuPutBackMeasure', 'risu-measure-putback', 'risu-measure-tripwire', 'risu-measure-import', '__risuSweepDryRun', '__risuGcNow', '__risuCommitMeter', 'risu-measure-commit', '__risuImportPhases', '__risuChatPhases', '__risuImportBench', 'risu-measure-copy', 'writeSyncMs=', 'writeList=', 'stubEncodeMs=', 'rangeWallMs=', 'writeVia=', ' encodeMs=', ' closeMs=', 'stubAhead=', 'stubHeldMax=', 'appendSynced=', 'gcMarkMs=', 'risu-measure-export-readahead', 'risu-measure-export-holdnet', ' netHeld=', ' netTicks=', ' netTickMs=', ' residentsAtStart=', 'rangeMaxInFlight=', '__risuSavePassMeter', 'risu-measure-savepass', 'risu-measure-yield-mode', '__risuYieldGapMeter', 'yieldWaitMaxMs', 'commitBuildMs', 'peekMarks', 'splitCarriedMs', 'splitModuleReadMs', 'splitFinishShardsMs', 'splitUnitCost', 'netFound', 'ticksCommitted', 'unattributed', 'dueAfterRead', 'unsavableAbsent', 'verdictClean', 'slotMissing', 'decisionMs', 'slotPassMs', 'slotTimings', 'lockWaitMs', 'judgeMs', 'checksMs', 'unheldMs', 'stubsMs', 'unsavableMs', 'residentsMs', 'scanMs', 'pruneMs', 'findMs', 'verdictMs', 'primitiveMs', 'movedMs', 'verdictShadow', 'shadowTripwireMs', 'shadowTripwire', 'shadowTally', 'shadowSlots', 'shadowHits', 'shadowMisses', 'shadowRefused', 'shadowClears', 'shadowTripwireRuns', 'shadowDisagreements', 'dueAfterYield', 'dbChanged', 'spanAMs', 'yieldMs', 'spanBMs', '__risuNetSignals', 'signalSlots', 'signalAcks', 'signalGlobals', 'winMsgForeign', 'tagOverwritten', 'partGlobal', 'partFirst', 'watchRefused', 'residentsDelta', 'dirtyRun']
// The key and the text come from src/ts/process/moduleFaultFlag.ts; a test pins that they match.
const FAULT_MARKERS = ['risu-fault-module-load', 'module fault switch', 'moduleFaultFlag.ts']
const EXECUTABLE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.html', '.css'])
const MAP_EXTENSION = '.map'

let faultOnly = false
let root = 'dist'
for (const arg of process.argv.slice(2)) {
    if (arg === '--fault-only') {
        faultOnly = true
    } else if (arg.startsWith('--')) {
        console.error(`checkReleaseDist: unknown option "${arg}".`)
        process.exit(2)
    } else {
        root = arg
    }
}

function listScannedFiles(dir) {
    const files = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) {
            files.push(...listScannedFiles(path))
        } else if (entry.isFile()) {
            const extension = extname(entry.name).toLowerCase()
            if (EXECUTABLE_EXTENSIONS.has(extension) || extension === MAP_EXTENSION) {
                files.push(path)
            }
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
    const isMap = extname(file).toLowerCase() === MAP_EXTENSION
    const markers = isMap || faultOnly ? FAULT_MARKERS : [...MEASURE_MARKERS, ...FAULT_MARKERS]
    for (const marker of markers) {
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
console.log(`checkReleaseDist: OK, ${files.length} files scanned under "${root}", no forbidden markers.`)
