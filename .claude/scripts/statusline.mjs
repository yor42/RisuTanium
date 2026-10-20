// Status line: display only. Missing fields are skipped; any error prints a short
// fallback and exits 0.
const HANDOFF_TOKENS = 300000

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function contextTokens(usage) {
  if (!usage || typeof usage !== 'object') return null
  const parts = [usage.input_tokens, usage.cache_creation_input_tokens, usage.cache_read_input_tokens]
  const values = parts.map(num).filter((v) => v !== null)
  return values.length ? values.reduce((a, b) => a + b, 0) : null
}

try {
  const input = JSON.parse(await readStdin())
  const parts = []
  const model = input?.model?.display_name
  if (typeof model === 'string' && model) parts.push(model)

  const cw = input?.context_window
  let tokens = num(cw?.total_input_tokens)
  if (tokens === null) tokens = contextTokens(cw?.current_usage)
  let pct = num(cw?.used_percentage)
  const size = num(cw?.context_window_size)
  if (pct === null && tokens !== null && size) pct = (tokens / size) * 100
  if (tokens !== null) {
    parts.push('ctx ' + Math.round(tokens / 1000) + 'k' + (pct !== null ? ' (' + Math.round(pct) + '%)' : ''))
  } else if (pct !== null) {
    parts.push('ctx ' + Math.round(pct) + '%')
  }

  const cost = num(input?.cost?.total_cost_usd)
  if (cost !== null) parts.push('$' + cost.toFixed(2) + ' list')

  const week = num(input?.rate_limits?.seven_day?.used_percentage)
  if (week !== null) parts.push('7d ' + Math.round(week) + '%')

  if (tokens !== null && tokens >= HANDOFF_TOKENS) parts.push('HANDOFF DUE')
  process.stdout.write((parts.length ? parts.join(' | ') : 'claude') + '\n')
} catch {
  process.stdout.write('status unavailable\n')
}
process.exit(0)
