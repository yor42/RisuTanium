// Logging-only hook: records the hook input shape for workflow review. It never
// blocks, never writes to stdout and exits 0 on any error.
import { appendFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const MAX_STRING = 2000

function truncate(value) {
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? value.slice(0, MAX_STRING) + '...[truncated ' + (value.length - MAX_STRING) + ']' : value
  }
  if (Array.isArray(value)) return value.map(truncate)
  if (value && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value)) out[key] = truncate(value[key])
    return out
  }
  return value
}

const SENSITIVE = /key\.txt|keystore|\.jks|\.pfx|\.p12|\.env\b|secret|password|token/i
const MAX_RECORD = 8192

function hasSensitive(value) {
  if (typeof value === 'string') return SENSITIVE.test(value)
  if (Array.isArray(value)) return value.some(hasSensitive)
  if (value && typeof value === 'object') return Object.keys(value).some((key) => SENSITIVE.test(key) || hasSensitive(value[key]))
  return false
}

// Shape only: key, type and string length, never content.
function summarize(value) {
  if (value === null || value === undefined) return value === null ? 'null' : 'undefined'
  if (typeof value === 'string') return 'string(' + value.length + ')'
  if (Array.isArray(value)) return 'array(' + value.length + ')'
  if (typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value).sort()) out[key] = summarize(value[key])
    return out
  }
  return typeof value
}

function keysOf(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).sort() : null
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

try {
  const text = await readStdin()
  const now = new Date()
  let record
  try {
    const input = JSON.parse(text)
    record = {
      time: now.toISOString(),
      hook_event_name: input.hook_event_name ?? null,
      tool_name: input.tool_name ?? null,
      has_agent_id: input.agent_id !== undefined,
      has_agent_type: input.agent_type !== undefined,
      top_level_keys: keysOf(input),
      tool_input_keys: keysOf(input.tool_input),
      tool_response_keys: keysOf(input.tool_response),
      tool_input: hasSensitive(input.tool_input) ? { redacted: true } : truncate(input.tool_input ?? null),
      tool_response_shape: summarize(input.tool_response ?? null),
      input_shape: summarize(input),
    }
    if (JSON.stringify(record).length > MAX_RECORD) {
      record.tool_input = summarize(input.tool_input ?? null)
      record.truncated_record = true
    }
    if (JSON.stringify(record).length > MAX_RECORD) {
      record = { time: record.time, hook_event_name: record.hook_event_name, tool_name: record.tool_name, truncated_record: true }
    }
  } catch {
    record = { time: now.toISOString(), parse_error: true, raw_text_length: text.length }
  }
  const dir = join(tmpdir(), 'risu-hooklog')
  mkdirSync(dir, { recursive: true })
  const pad = (n) => String(n).padStart(2, '0')
  const localDay = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())
  appendFileSync(join(dir, localDay + '.jsonl'), JSON.stringify(record) + '\n')
} catch {
  // Fail open: a logging problem must never affect the session.
}
process.exit(0)
