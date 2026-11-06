import { deviceConnect } from './lib.mjs'
// node coldtap.mjs <x> <y> : one real touch tap through the forwarded CDP port (HARNESS_CDP).
const c = await deviceConnect()
await c.tap(Number(process.argv[2]), Number(process.argv[3]))
process.exit(0)
