import { describe, expect, it } from 'vitest'
import { PROVIDERS, detectProvider } from '../src/client/features/api/provider-config.ts'
import {
  collectTurnUsage, collectUsage, estimateCost, formatCost, parseUsage,
} from '../src/client/features/usage/usage.ts'

const DEEPSEEK = PROVIDERS.find((p) => p.id === 'deepseek')!

/** Snapshot shape derived from collectUsage's signature (avoids importing the
 *  runtime types, whose /client entry conflicts with the host entry in the
 *  tests tsconfig program). */
type SnapshotLike = NonNullable<Parameters<typeof collectUsage>[0]>

const snapshotOf = (nodes: readonly unknown[]): SnapshotLike =>
  ({ nodes }) as unknown as SnapshotLike

describe('parseUsage', () => {
  it('parses the harness-internal disjoint shape (inputTokens excludes cache)', () => {
    const parsed = parseUsage({
      inputTokens: 100,
      outputTokens: 40,
      cacheReadTokens: 30,
      cacheWriteTokens: 5,
      reasoningTokens: 12,
    })
    expect(parsed).not.toBeNull()
    expect(parsed!.promptTokens).toBe(135) // 100 uncached + 30 cached + 5 written
    expect(parsed!.completionTokens).toBe(40)
    expect(parsed!.totalTokens).toBe(175)
    expect(parsed!.cacheHitTokens).toBe(30)
    expect(parsed!.cacheWriteTokens).toBe(5)
    expect(parsed!.reasoningTokens).toBe(12)
  })

  it('parses the DeepSeek wire shape (prompt_tokens already includes cache hits)', () => {
    const parsed = parseUsage({
      prompt_tokens: 135,
      completion_tokens: 40,
      total_tokens: 175,
      prompt_cache_hit_tokens: 30,
      completion_tokens_details: { reasoning_tokens: 12 },
    })
    expect(parsed).not.toBeNull()
    expect(parsed!.promptTokens).toBe(135)
    expect(parsed!.completionTokens).toBe(40)
    expect(parsed!.totalTokens).toBe(175)
    expect(parsed!.cacheHitTokens).toBe(30)
    expect(parsed!.reasoningTokens).toBe(12)
  })

  it('parses the OpenAI wire shape with prompt_tokens_details', () => {
    const parsed = parseUsage({
      prompt_tokens: 80,
      completion_tokens: 20,
      total_tokens: 100,
      prompt_tokens_details: { cached_tokens: 10 },
    })
    expect(parsed).not.toBeNull()
    expect(parsed!.promptTokens).toBe(80)
    expect(parsed!.cacheHitTokens).toBe(10)
  })

  it('keeps a provider-reported price and currency', () => {
    const parsed = parseUsage({ inputTokens: 5, outputTokens: 5, total_price: 0.0012, currency: 'USD' })
    expect(parsed!.price).toBe('0.0012')
    expect(parsed!.currency).toBe('USD')
  })

  it('returns null for garbage and for empty objects', () => {
    expect(parseUsage(null)).toBeNull()
    expect(parseUsage('nope')).toBeNull()
    expect(parseUsage({})).toBeNull()
  })
})

describe('estimateCost', () => {
  it('prefers the provider-reported price (exact, not estimated)', () => {
    const parsed = parseUsage({ inputTokens: 5, outputTokens: 5, total_price: 0.0012, currency: 'USD' })!
    const cost = estimateCost(parsed, DEEPSEEK, 'deepseek-chat')
    expect(cost).not.toBeNull()
    expect(cost!.amount).toBeCloseTo(0.0012, 6)
    expect(cost!.currency).toBe('USD')
    expect(cost!.estimated).toBe(false)
  })

  it('estimates cost from the rate card for a known model', () => {
    const parsed = parseUsage({ inputTokens: 1_000_000, outputTokens: 500_000, cacheReadTokens: 200_000 })!
    const cost = estimateCost(parsed, DEEPSEEK, 'deepseek-chat')
    // billed input 1.2M = 1M uncached (2/1M) + 200k cached (0.5/1M); output 500k * 8/1M
    expect(cost!.amount).toBeCloseTo(2 + 0.1 + 4, 6)
    expect(cost!.currency).toBe('CNY')
    expect(cost!.estimated).toBe(true)
  })

  it('falls back to the provider default rate for unknown models', () => {
    const parsed = parseUsage({ inputTokens: 1_000_000, outputTokens: 1_000_000 })!
    const cost = estimateCost(parsed, DEEPSEEK, 'deepseek-v4-flash')
    expect(cost!.amount).toBeCloseTo(2 + 8, 6)
  })

  it('returns null when no pricing is available', () => {
    const parsed = parseUsage({ inputTokens: 10, outputTokens: 10 })!
    const openrouter = PROVIDERS.find((p) => p.id === 'openrouter')!
    expect(estimateCost(parsed, openrouter, 'openrouter/auto')).toBeNull()
    expect(estimateCost(parsed, null, 'whatever')).toBeNull()
  })
})

describe('collectUsage', () => {
  const snapshot = snapshotOf([
    { kind: 'user', seq: 1 },
    {
      kind: 'assistant', seq: 2, turn: 1, step: 0, time: 1000,
      provenance: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      usage: { inputTokens: 10, outputTokens: 5 },
    },
    {
      kind: 'assistant', seq: 3, turn: 2, step: 0, time: 2000,
      provenance: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      usage: { inputTokens: 20, outputTokens: 10, cacheReadTokens: 4 },
    },
    {
      kind: 'assistant', seq: 4, turn: 3, step: 0, time: 3000,
      provenance: { provider: 'qwen', model: 'qwen-max' },
      usage: { inputTokens: 100, outputTokens: 50 },
    },
  ])

  it('scopes entries to the detected provider spec', () => {
    const { entries, summary } = collectUsage(snapshot, DEEPSEEK)
    expect(entries).toHaveLength(2)
    expect(entries[0]!.turn).toBe(1)
    expect(entries[1]!.model).toBe('deepseek-v4-flash')
    expect(summary.count).toBe(2)
    expect(summary.promptTokens).toBe(10 + 24) // 20 input + 4 cached
    expect(summary.completionTokens).toBe(15)
    expect(summary.totalTokens).toBe(10 + 5 + 24 + 10)
    expect(summary.cost).not.toBeNull()
    expect(summary.cost!.amount).toBeGreaterThan(0)
  })

  it('includes every reply when no spec is given', () => {
    const { entries, summary } = collectUsage(snapshot, null)
    expect(entries).toHaveLength(3)
    expect(summary.count).toBe(3)
  })

  it('skips assistant nodes without resolvable usage', () => {
    const { entries, summary } = collectUsage(snapshotOf([
      { kind: 'assistant', seq: 1, turn: 1, step: 0, time: 1, provenance: { provider: 'deepseek-official', model: 'deepseek-chat' } },
      { kind: 'assistant', seq: 2, turn: 2, step: 0, time: 2, provenance: { provider: 'deepseek-official', model: 'deepseek-chat' }, usage: { inputTokens: 3, outputTokens: 2 } },
    ]), DEEPSEEK)
    expect(entries).toHaveLength(1)
    expect(summary.count).toBe(1)
  })

  it('resolves the deepseek spec for the harness provider/model pair', () => {
    expect(detectProvider('deepseek-official', 'deepseek-v4-flash')?.id).toBe('deepseek')
  })
})

describe('collectTurnUsage', () => {
  const chatSnapshotOf = (nodes: Array<Record<string, unknown>>): SnapshotLike => ({
    chat: {
      locations: {
        getTurn: () => nodes.map((node) => node.key as string),
      },
      nodes: {
        get: (key: string) => nodes.find((node) => node.key === key),
      },
    },
  }) as unknown as SnapshotLike

  it('collects per-step usage rows for one turn in chat order', () => {
    const snapshot = chatSnapshotOf([
      {
        key: 'assistant:1:0', kind: 'assistant-step', anchorSeq: 10,
        data: {
          step: 0,
          usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10 },
          finalNode: {
            seq: 10,
            provenance: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
          },
        },
      },
      {
        key: 'user:1', kind: 'user', anchorSeq: 9,
        data: {},
      },
      {
        key: 'assistant:1:1', kind: 'assistant-step', anchorSeq: 20,
        data: {
          step: 1,
          usage: { inputTokens: 40, outputTokens: 20 },
          finalNode: {
            seq: 20,
            provenance: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
          },
        },
      },
    ])
    const rows = collectTurnUsage(snapshot, 1)
    expect(rows).toHaveLength(2)
    expect(rows[0]!.seq).toBe(10)
    expect(rows[0]!.step).toBe(0)
    expect(rows[0]!.usage.promptTokens).toBe(110) // 100 uncached + 10 cached
    expect(rows[1]!.seq).toBe(20)
    expect(rows[1]!.model).toBe('deepseek-v4-flash')
    expect(rows[1]!.cost).not.toBeNull()
    expect(rows[1]!.cost!.currency).toBe('CNY')
  })

  it('falls back to anchorSeq and skips steps without usage', () => {
    const snapshot = chatSnapshotOf([
      {
        key: 'assistant:1:0', kind: 'assistant-step', anchorSeq: 10,
        data: { step: 0, usage: { inputTokens: 5, outputTokens: 5 } },
      },
      {
        key: 'assistant:1:1', kind: 'assistant-step', anchorSeq: 20,
        data: { step: 1 },
      },
    ])
    const rows = collectTurnUsage(snapshot, 1)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.seq).toBe(10)
  })

  it('returns empty for undefined snapshots and empty turns', () => {
    expect(collectTurnUsage(undefined, 1)).toEqual([])
    expect(collectTurnUsage(chatSnapshotOf([]), 1)).toEqual([])
  })
})

describe('formatCost', () => {
  it('renders currency symbols and empty state', () => {
    expect(formatCost({ amount: 1.2345, currency: 'CNY', estimated: true })).toBe('¥1.234')
    expect(formatCost({ amount: 0.000123, currency: 'USD', estimated: false })).toBe('$0.000123')
    expect(formatCost(null)).toBe('—')
  })
})
