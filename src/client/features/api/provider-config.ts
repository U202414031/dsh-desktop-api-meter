import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'

/**
 * Per-1M-token rate card for one model. Amounts are in `currency` units per
 * one million tokens (the units providers bill in). Cache-hit input is billed
 * at `cacheHitPerM` when present, otherwise at `inputPerM`.
 */
export interface ModelPricing {
  currency: 'CNY' | 'USD'
  /** Price per 1M uncached input tokens. */
  inputPerM: number
  /** Price per 1M output tokens (reasoning output included). */
  outputPerM: number
  /** Price per 1M cached input tokens (usually much cheaper). */
  cacheHitPerM?: number
  /** Price per 1M tokens written through to cache (some providers bill it). */
  cacheWritePerM?: number
}

/** Pricing table attached to a provider, keyed by model id. */
export interface ProviderPricing {
  /** Exact per-model rates; `fallback` covers models not listed. */
  models: Record<string, ModelPricing>
  fallback?: ModelPricing
}

/** A model provider the API panel knows how to talk to. */
export interface ProviderSpec {
  /** Stable id used as a localStorage key suffix and internal routing. */
  id: string
  /** Human-facing name shown in the UI. */
  label: string
  /** Short origin note shown under the provider name. */
  hint: string
  /** Base URL for the provider's REST API (used for balance queries). */
  baseUrl: string
  /** Balance endpoint path appended to baseUrl. Empty when unsupported. */
  balancePath: string
  /** Whether the provider exposes a key-authenticated balance endpoint. */
  balanceSupported: boolean
  /** URL the user is sent to for topping up / recharging. */
  rechargeUrl: string
  /** URL for managing the provider's API keys. */
  apiKeyUrl: string
  /** Optional rate card used to estimate per-turn cost from token usage. */
  pricing?: ProviderPricing
  /**
   * Match a (provider, model) pair reported by the host. Returns true when this
   * spec applies; must tolerate undefined inputs.
   */
  match(provider: string | undefined, model: string | undefined): boolean
}

const norm = (value: string | undefined): string => (value ?? '').toLowerCase().trim()

/** Match on provider route ids and/or model id prefixes. */
function matchesAny(provider: string | undefined, model: string | undefined, providerIds: readonly string[], modelPrefixes: readonly string[]): boolean {
  const p = norm(provider)
  if (p.length > 0 && providerIds.some(id => p === id || p.includes(id))) return true
  const m = norm(model)
  if (m.length === 0) return false
  return modelPrefixes.some(prefix => m.startsWith(prefix))
}

const CNY = { currency: 'CNY' } as const

const DEEPSEEK: ProviderSpec = {
  id: 'deepseek',
  label: 'DeepSeek',
  hint: '深度求索',
  baseUrl: 'https://api.deepseek.com',
  balancePath: '/user/balance',
  balanceSupported: true,
  rechargeUrl: 'https://platform.deepseek.com/top_up',
  apiKeyUrl: 'https://platform.deepseek.com/api_keys',
  pricing: {
    models: {
      'deepseek-chat': { ...CNY, inputPerM: 2, outputPerM: 8, cacheHitPerM: 0.5 },
      'deepseek-reasoner': { ...CNY, inputPerM: 4, outputPerM: 16, cacheHitPerM: 1 },
      'deepseek-v3': { ...CNY, inputPerM: 2, outputPerM: 8, cacheHitPerM: 0.5 },
      'deepseek-v3.1': { ...CNY, inputPerM: 2, outputPerM: 8, cacheHitPerM: 0.5 },
    },
    // v4 系列（deepseek-v4-flash / deepseek-v4-pro 等）按 deepseek-chat 单价估算。
    fallback: { ...CNY, inputPerM: 2, outputPerM: 8, cacheHitPerM: 0.5 },
  },
  match: (provider, model) => matchesAny(provider, model, ['deepseek'], ['deepseek']),
}

const qwenRate = (inputPerM: number, outputPerM: number, cacheHitPerM: number): ModelPricing => ({
  ...CNY, inputPerM, outputPerM, cacheHitPerM,
})

const QWEN: ProviderSpec = {
  id: 'qwen',
  label: '通义千问 (Qwen)',
  hint: '阿里云百炼 / DashScope',
  baseUrl: 'https://dashscope.aliyuncs.com',
  balancePath: '',
  balanceSupported: false,
  rechargeUrl: 'https://bailian.console.aliyun.com/',
  apiKeyUrl: 'https://bailian.console.aliyun.com/?tab=account',
  pricing: {
    models: {
      'qwen-turbo': qwenRate(0.3, 0.6, 0.15),
      'qwen-plus': qwenRate(0.8, 2, 0.4),
      'qwen-max': qwenRate(2.4, 9.6, 1.2),
      'qwen-long': qwenRate(0.5, 2, 0.25),
    },
    fallback: qwenRate(0.8, 2, 0.4),
  },
  match: (provider, model) => matchesAny(provider, model, ['qwen', 'dashscope', 'bailian', 'aliyun'], ['qwen']),
}

const MOONSHOT: ProviderSpec = {
  id: 'moonshot',
  label: 'Moonshot (Kimi)',
  hint: '月之暗面',
  baseUrl: 'https://api.moonshot.cn',
  balancePath: '',
  balanceSupported: false,
  rechargeUrl: 'https://platform.moonshot.cn/console/balance',
  apiKeyUrl: 'https://platform.moonshot.cn/console/api-keys',
  match: (provider, model) => matchesAny(provider, model, ['moonshot', 'kimi'], ['kimi', 'moonshot']),
}

const ZHIPU: ProviderSpec = {
  id: 'zhipu',
  label: '智谱 (GLM)',
  hint: '智谱 AI 开放平台',
  baseUrl: 'https://open.bigmodel.cn',
  balancePath: '',
  balanceSupported: false,
  rechargeUrl: 'https://open.bigmodel.cn/console/overview',
  apiKeyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
  match: (provider, model) => matchesAny(provider, model, ['zhipu', 'zhipuai', 'bigmodel', 'glm'], ['glm', 'chatglm']),
}

const OPENROUTER: ProviderSpec = {
  id: 'openrouter',
  label: 'OpenRouter',
  hint: '聚合多家模型',
  baseUrl: 'https://openrouter.ai',
  balancePath: '/api/v1/credits',
  balanceSupported: true,
  rechargeUrl: 'https://openrouter.ai/settings/credits',
  apiKeyUrl: 'https://openrouter.ai/settings/keys',
  match: (provider, model) => matchesAny(provider, model, ['openrouter'], ['openrouter']),
}

const OPENAI: ProviderSpec = {
  id: 'openai',
  label: 'OpenAI',
  hint: '官方 API',
  baseUrl: 'https://api.openai.com',
  balancePath: '',
  balanceSupported: false,
  rechargeUrl: 'https://platform.openai.com/settings/organization/billing',
  apiKeyUrl: 'https://platform.openai.com/api-keys',
  match: (provider, model) => matchesAny(provider, model, ['openai'], ['gpt-', 'o1', 'o3', 'chatgpt']),
}

const ANTHROPIC: ProviderSpec = {
  id: 'anthropic',
  label: 'Anthropic (Claude)',
  hint: '官方 API',
  baseUrl: 'https://api.anthropic.com',
  balancePath: '',
  balanceSupported: false,
  rechargeUrl: 'https://console.anthropic.com/settings/billing',
  apiKeyUrl: 'https://console.anthropic.com/settings/keys',
  match: (provider, model) => matchesAny(provider, model, ['anthropic'], ['claude']),
}

/** Known providers, in display order. Extend here to support more vendors. */
export const PROVIDERS: readonly ProviderSpec[] = [DEEPSEEK, QWEN, MOONSHOT, ZHIPU, OPENROUTER, OPENAI, ANTHROPIC]

/** Resolve the provider spec for a reported (provider, model) pair. */
export function detectProvider(provider: string | undefined, model: string | undefined): ProviderSpec | null {
  for (const spec of PROVIDERS) {
    if (spec.match(provider, model)) return spec
  }
  return null
}

/** Friendly names for known model ids (display only; unknown ids fall back to the raw id). */
const MODEL_LABELS: Record<string, string> = {
  'deepseek-chat': 'DeepSeek Chat',
  'deepseek-reasoner': 'DeepSeek Reasoner',
  'deepseek-v3': 'DeepSeek V3',
  'deepseek-v3.1': 'DeepSeek V3.1',
  'deepseek-v4': 'DeepSeek V4',
  'deepseek-v4-flash': 'DeepSeek V4 Flash',
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
  'qwen-turbo': '通义千问 Turbo',
  'qwen-plus': '通义千问 Plus',
  'qwen-max': '通义千问 Max',
  'qwen-long': '通义千问 Long',
  'kimi-latest': 'Kimi Latest',
}

/** Human-friendly label for a model id, or the raw id when unknown. */
export function labelForModel(model: string | undefined): string | undefined {
  if (model === undefined) return undefined
  return MODEL_LABELS[model] ?? MODEL_LABELS[norm(model)] ?? model
}

/** Friendly labels for known provider route ids. */
const PROVIDER_LABELS: Record<string, string> = {
  'deepseek-official': 'DeepSeek',
  'deepseek': 'DeepSeek',
  'qwen-official': '通义千问',
  'qwen': '通义千问',
  'dashscope': '通义千问',
  'moonshot': 'Moonshot',
  'kimi': 'Kimi',
  'zhipu': '智谱',
  'zhipuai': '智谱',
  'bigmodel': '智谱',
  'openrouter': 'OpenRouter',
  'openai': 'OpenAI',
  'anthropic': 'Anthropic',
}

/** Human-friendly label for a provider route id, or the raw id when unknown. */
export function labelForProvider(provider: string | undefined): string | undefined {
  if (provider === undefined) return undefined
  return PROVIDER_LABELS[provider] ?? PROVIDER_LABELS[norm(provider)] ?? provider
}

interface AssistantLike {
  kind?: string
  provenance?: { provider?: string; model?: string }
  requestConfig?: { provider?: string; model?: string }
}

/** Extract the provider/model of the most recent assistant message. */
export function detectCurrentModel(snapshot: ConversationSnapshot | undefined): {
  provider: string | undefined
  model: string | undefined
  spec: ProviderSpec | null
} {
  let provider: string | undefined
  let model: string | undefined

  // 权威源：Chat 视图。每条 finalize 的回复对应一个 `assistant-step` 节点，
  // 其 data.finalNode 携带 provenance/requestConfig。按 order 顺序遍历，最后
  // 留下的即最新一条（ChatNodeStore.values() 不保证顺序，须走 order）。
  const chat = snapshot?.chat
  for (const key of chat?.order ?? []) {
    const node = chat?.nodes.get(key)
    if (node?.kind !== 'assistant-step') continue
    const finalNode = (node.data as { finalNode?: AssistantLike } | undefined)?.finalNode
    if (finalNode === undefined) continue
    const p = finalNode.provenance?.provider ?? finalNode.requestConfig?.provider
    const m = finalNode.provenance?.model ?? finalNode.requestConfig?.model
    if (p !== undefined || m !== undefined) {
      provider = p
      model = m
    }
  }

  // 兜底：legacy 顶层 nodes（部分运行环境只填充该兼容投影）。
  if (provider === undefined && model === undefined) {
    const nodes = [...(snapshot?.nodes ?? [])].reverse()
    const last = nodes.find((n) => n.kind === 'assistant') as AssistantLike | undefined
    provider = last?.provenance?.provider ?? last?.requestConfig?.provider
    model = last?.provenance?.model ?? last?.requestConfig?.model
  }
  return { provider, model, spec: detectProvider(provider, model) }
}
