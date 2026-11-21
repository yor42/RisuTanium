// `pnpm dev:server`: the Node server plus the Vite dev server in front of it.
// Stopping either process stops the other.
import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { devServerPlan } from './devServerNode.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))

let plan
try {
    plan = devServerPlan({ root, env: process.env, argv: process.argv.slice(2), execPath: process.execPath })
} catch (error) {
    console.error(`[dev:server] ${error.message}`)
    process.exit(1)
}
if (!existsSync(plan.serverDir) || !statSync(plan.serverDir).isDirectory()) {
    console.error(`[dev:server] RISU_DEV_SERVER_DIR is not a folder: ${plan.serverDir}`)
    process.exit(1)
}

console.log(`[dev:server] Node server data: ${plan.serverDir}`)
console.log(`[dev:server] Node routes go to ${plan.target}`)

const children = []
let exitCode = null

function stopAll(code) {
    if (exitCode === null) {
        exitCode = code
    }
    for (const child of children) {
        if (child.exitCode === null && child.signalCode === null) {
            child.kill()
        }
    }
}

function start(label, spec) {
    const child = spawn(spec.command, spec.args, { cwd: spec.cwd, env: spec.env, stdio: 'inherit', shell: false })
    child.on('error', (error) => {
        console.error(`[dev:server] ${label} failed to start: ${error.message}`)
        stopAll(1)
    })
    child.on('exit', (code, signal) => {
        if (exitCode === null) {
            console.error(`[dev:server] ${label} stopped (${signal ?? `exit ${code}`}); stopping the other process`)
        }
        stopAll(code ?? 1)
        if (children.every((c) => c.exitCode !== null || c.signalCode !== null)) {
            process.exit(exitCode ?? 0)
        }
    })
    children.push(child)
}

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => stopAll(0))
}

start('Node server', plan.node)
start('Vite', plan.vite)
