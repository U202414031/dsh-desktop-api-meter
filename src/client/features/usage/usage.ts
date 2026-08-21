import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { detectProvider, type ProviderSpec } from '../api/provider-config.ts'

/** Normalized token usage for one assistant response. */
export interface TokenUsage {
  /** Billed input tokens. Matches OpenAI `prompt_tokens`: cached input is included. */
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** Input tokens served from cache (billed at the cache-hit rate). */
  cacheHitTokens?: number
  /** Input tokens written through to cache (some providers bill separately). */
  cacheWriteTokens?: number
  /** Output tokens consumed by hidden reasoning (billed as output). */
  reasoningTokens?: number
  /** Provider-reported total price, when the gateway returns one. */
  price?: string
  currency?: string
}

/** A cost figure attached to one response or an aggregated session. */
export interface CostInfo {
  /** Cost in `currency` units (e.g. 0.0035 CNY). */
  amount: number
  currency: string
  /** True when derived from our local rate card rather than the provider. */
  estimated: boolean
}

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

/**
 * Defensively read a token-usage object off an assistant node. The harness
 * stores usage as `unknown`, and different layers report different shapes:
 *
 * - Harness-internal disjoint counts: `{ inputTokens, outputTokens,
 *   cacheReadTokens?, cacheWriteTokens?, reasoningTokens? }` where `inputTokens`
 *   is UNCACHED input only (cached input is disjoint) — this is what the
 *   desktop app receives from the running harness.
 * - OpenAI/DeepSeek wire shape: `{ prompt_tokens, completion_tokens,
 *   total_tokens, prompt_cache_hit_tokens?, prompt_tokens_details?, ... }`
 *   where `prompt_tokens` ALREADY includes cache hits.
 * - CamelCase metric shape (`{ input, output, cacheRead?, ... }`).
 *
 * Any gateway that also reports a price (`total_price`/`total_cost`/`price`...)
 * keeps it as `usage.price` so the panel can show the billed amount directly.
 */
export function parseUsage(raw: unknown): TokenUsage | null {
  if (raw === null || typeof raw !== 'object') return null
  const u = raw as Record<string, unknown>

  // 1) Harness-internal disjoint shape.
  const inputTokens = num(u.inputTokens)
  const outputTokens = num(u.outputTokens)
  if (inputTokens !== undefined || outputTokens !== undefined) {
    const cacheRead = num(u.cacheReadTokens)
    const cacheWrite = num(u.cacheWriteTokens)
    const reasoning = num(u.reasoningTokens)
    const uncached = inputTokens ?? 0
    const completion = outputTokens ?? 0
    const billedInput = uncached + (cacheRead ?? 0) + (cacheWrite ?? 0)
    const usage: TokenUsage = {
      promptTokens: billedInput,
      completionTokens: completion,
      totalTokens: billedInput + completion,
    }
    if (cacheRead !== undefined) usage.cacheHitTokens = cacheRead
    if (cacheWrite !== undefined) usage.cacheWriteTokens = cacheWrite
    if (reasoning !== undefined) usage.reasoningTokens = reasoning
    attachPrice(usage, u)
    return usage
  }

  // 2) OpenAI / DeepSeek wire shape.
  const prompt = num(u.prompt_tokens)
  const completion = num(u.completion_tokens)
  const total = num(u.total_tokens)
  if (prompt !== undefined || completion !== undefined || total !== undefined) {
    const details = u.prompt_tokens_details
    const cacheHit = num(u.prompt_cache_hit_tokens)
      ?? (details !== null && typeof details === 'object' ? num((details as Record<string, unknown>).cached_tokens) : undefined)
    const completionDetails = u.completion_tokens_details
    const reasoning = completionDetails !== null && typeof completionDetails === 'object'
      ? num((completionDetails as Record<string, unknown>).reasoning_tokens)
      : undefined
    const p = prompt ?? 0
    const c = completion ?? 0
    const usage: TokenUsage = {
      promptTokens: p,
      completionTokens: c,
      totalTokens: total ?? p + c,
    }
    if (cacheHit !== undefined) usage.cacheHitTokens = cacheHit
    if (reasoning !== undefined) usage.reasoningTokens = reasoning
    attachPrice(usage, u)
    return usage
  }

  // 3) CamelCase metric shape (defensive).
  const metricInput = num(u.input)
  const metricOutput = num(u.output)
  if (metricInput !== undefined || metricOutput !== undefined) {
    const cacheRead = num(u.cacheRead)
    const cacheWrite = num(u.cacheWrite)
    const reasoning = num(u.reasoning)
    const uncached = metricInput ?? 0
    const completion = metricOutput ?? 0
    const billedInput = uncached + (cacheRead ?? 0) + (cacheWrite ?? 0)
    const usage: TokenUsage = {
      promptTokens: billedInput,
      completionTokens: completion,
      totalTokens: num(u.total) ?? billedInput + completion,
    }
    if (cacheRead !== undefined) usage.cacheHitTokens = cacheRead
    if (cacheWrite !== undefined) usage.cacheWriteTokens = cacheWrite
    if (reasoning !== undefined) usage.reasoningTokens = reasoning
    attachPrice(usage, u)
    return usage
  }

  return null
}

function attachPrice(usage: TokenUsage, u: Record<string, unknown>): void {
  for (const key of ['total_price', 'totalPrice', 'total_cost', 'totalCost', 'price', 'cost'] as const) {
    const value = u[key]
    if (typeof value === 'number' || typeof value === 'string') {
      usage.price = String(value)
      break
    }
  }
  const currency = str(u.currency)
  if (currency !== undefined) usage.currency = currency
}

/**
 * Attach a cost figure to parsed usage. Prefers the provider-reported price
 * (`usage.price`, exact) and falls back to the local rate card of `spec`
 * (marked as an estimate). Returns null when neither source is available.
 */
export function estimateCost(usage: TokenUsage, spec: ProviderSpec | null, model: string | undefined): CostInfo | null {
  if (usage.price !== undefined) {
    const amount = Number(usage.price)
    if (Number.isFinite(amount)) return { amount, currency: usage.currency ?? 'CNY', estimated: false }
  }
  const pricing = spec?.pricing
  if (pricing === undefined) return null
  const rate = pricing.models[model ?? ''] ?? pricing.fallback
  if (rate === undefined) return null
  const cacheHit = usage.cacheHitTokens ?? 0
  const cacheWrite = usage.cacheWriteTokens ?? 0
  const uncachedInput = Math.max(0, usage.promptTokens - cacheHit - cacheWrite)
  const amount = (
    uncachedInput * rate.inputPerM
    + usage.completionTokens * rate.outputPerM
    + cacheHit * (rate.cacheHitPerM ?? rate.inputPerM)
    + cacheWrite * (rate.cacheWritePerM ?? rate.inputPerM)
  ) / 1_000_000
  return { amount, currency: rate.currency, estimated: true }
}

/** One assistant response with resolvable usage, in conversation order. */
export interface UsageEntry {
  seq: number
  turn: number
  step: number
  /** Unix epoch ms of the finalized reply. */
  time: number
  provider: string | undefined
  model: string | undefined
  usage: TokenUsage
  cost: CostInfo | null
}

/** Cumulative token usage across assistant messages, optionally scoped to one provider. */
export interface UsageSummary {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  count: number
  /** Summed session cost, or null when no entry has a resolvable price. */
  cost: CostInfo | null
}

/**
 * Collect per-reply usage from a conversation snapshot and aggregate it. When
 * `spec` is provided, only assistant messages belonging to that provider
 * (matched by provider/model) are counted, so the panel can attribute usage to
 * the model currently in use; when `spec` is null, every reply with usage is
 * included.
 *
 * Reads the authoritative Chat view (`assistant-step` nodes) first and falls
 * back to the legacy top-level `nodes` projection when the Chat view is empty.
 */
export function collectUsage(snapshot: ConversationSnapshot | undefined, spec: ProviderSpec | null): {
  entries: UsageEntry[]
  summary: UsageSummary
} {
  const acc: { entries: UsageEntry[]; prompt: number; completion: number; total: number; count: number; cost: CostInfo | null } = {
    entries: [], prompt: 0, completion: 0, total: 0, count: 0, cost: null,
  }
  const addEntry = (entry: UsageEntry): void => {
    acc.entries.push(entry)
    acc.prompt += entry.usage.promptTokens
    acc.completion += entry.usage.completionTokens
    acc.total += entry.usage.totalTokens
    acc.count += 1
    if (entry.cost !== null) {
      if (acc.cost === null) {
        acc.cost = { amount: 0, currency: entry.cost.currency, estimated: entry.cost.estimated }
      } else if (acc.cost.currency !== entry.cost.currency) {
        // Mixed currencies across replies: keep the first, mark as an estimate.
        acc.cost.estimated = true
      }
      acc.cost.amount += entry.cost.amount
    }
  }

  // 权威源：Chat 视图的 assistant-step 节点（data.usage 在回复 finalize 后出现）。
  const chat = snapshot?.chat
  let fromChat = false
  for (const key of chat?.order ?? []) {
    const node = chat?.nodes.get(key)
    if (node?.kind !== 'assistant-step') continue
    fromChat = true
    const data = (node.data ?? {}) as AssistantStepChatData
    const parsed = parseUsage(data.usage)
    if (parsed === null) continue
    const provider = data.finalNode?.provenance?.provider ?? data.finalNode?.requestConfig?.provider
    const model = data.finalNode?.provenance?.model ?? data.finalNode?.requestConfig?.model
    if (spec !== null && !spec.match(provider, model)) continue
    const entryCost = estimateCost(parsed, spec, model)
    addEntry({
      seq: data.finalNode?.seq ?? node.anchorSeq,
      turn: data.turn ?? 0,
      step: data.step ?? 0,
      time: data.time ?? 0,
      provider,
      model,
      usage: parsed,
      cost: entryCost,
    })
  }

  // 兜底：legacy 顶层 nodes 投影。
  if (!fromChat) {
    for (const node of snapshot?.nodes ?? []) {
      if (node.kind !== 'assistant') continue
      const provider = node.provenance?.provider ?? node.requestConfig?.provider
      const model = node.provenance?.model ?? node.requestConfig?.model
      if (spec !== null && !spec.match(provider, model)) continue
      const parsed = parseUsage(node.usage)
      if (parsed === null) continue
      const entryCost = estimateCost(parsed, spec, model)
      addEntry({
        seq: node.seq,
        turn: node.turn,
        step: node.step,
        time: node.time,
        provider,
        model,
        usage: parsed,
        cost: entryCost,
      })
    }
  }

  return {
    entries: acc.entries,
    summary: { promptTokens: acc.prompt, completionTokens: acc.completion, totalTokens: acc.total, count: acc.count, cost: acc.cost },
  }
}

/** Backward-compatible alias for the cumulative summary only. */
export function sumUsage(snapshot: ConversationSnapshot | undefined, spec: ProviderSpec | null): UsageSummary {
  return collectUsage(snapshot, spec).summary
}

/**
 * Data shape published by the upstream `assistant-step` chat node (a structural
 * mirror of the trajectory projection — the desktop does not import it).
 */
interface AssistantStepChatData {
  status?: string
  turn?: number
  step?: number
  blocks?: unknown
  time?: number
  /** Harness-internal disjoint usage, present once the reply finalizes. */
  usage?: unknown
  /** The finalized assistant message node, when the step settled. */
  finalNode?: {
    seq?: number
    provenance?: { provider?: string; model?: string }
    requestConfig?: { provider?: string; model?: string }
  }
}

/** One reply's usage row for the inline turn-tail footer. */
export interface TurnUsageRow {
  /** Assistant-message seq — the anchor for jump-to-reply. */
  seq: number
  step: number
  model: string | undefined
  usage: TokenUsage
  cost: CostInfo | null
}

/**
 * Collect per-reply usage rows for one turn from the chat view (used by the
 * inline usage footer rendered under each reply via the turn-tail chain slot).
 * Rows appear in chat order; steps without resolvable usage are skipped.
 */
export function collectTurnUsage(snapshot: ConversationSnapshot | undefined, turnNumber: number): TurnUsageRow[] {
  if (snapshot === undefined) return []
  const rows: TurnUsageRow[] = []
  for (const key of snapshot.chat.locations.getTurn(turnNumber)) {
    const node = snapshot.chat.nodes.get(key)
    if (node?.kind !== 'assistant-step') continue
    const data = (node.data ?? {}) as AssistantStepChatData
    const parsed = parseUsage(data.usage)
    if (parsed === null) continue
    const provider = data.finalNode?.provenance?.provider ?? data.finalNode?.requestConfig?.provider
    const model = data.finalNode?.provenance?.model ?? data.finalNode?.requestConfig?.model
    const spec = detectProvider(provider, model)
    rows.push({
      seq: data.finalNode?.seq ?? node.anchorSeq,
      step: data.step ?? 0,
      model,
      usage: parsed,
      cost: estimateCost(parsed, spec, model),
    })
  }
  return rows
}

/** Render a cost figure with its currency symbol. */
export function formatCost(cost: CostInfo | null): string {
  if (cost === null) return '—'
  const symbol = cost.currency === 'CNY' ? '¥' : cost.currency === 'USD' ? '$' : ''
  const amount = formatAmount(cost.amount)
  return symbol.length > 0 ? `${symbol}${amount}` : `${amount} ${cost.currency}`
}

function formatAmount(value: number): string {
  if (value >= 100) return value.toFixed(2)
  if (value >= 1) return value.toFixed(3)
  if (value >= 0.01) return value.toFixed(4)
  return value.toFixed(6)
}

/** Parse a balance string (may contain thousands separators) into a number. */
export function parseBalanceAmount(value: string): number | null {
  const cleaned = value.replace(/[,，\s]/g, '')
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}
