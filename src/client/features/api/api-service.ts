import type { ProviderSpec } from './provider-config.ts'
import { proxyFetch } from '../../http-proxy.ts'

/**
 * Local storage of user-owned API keys, kept per provider so the panel can show
 * the right key for whichever model the user is currently running. Keys live
 * only in the renderer's localStorage — this is a local desktop client.
 */
const API_KEY_PREFIX = 'dsh-desktop-api-key'

/** @returns the saved API key for a provider, or an empty string when none is stored. */
export function getApiKey(providerId: string): string {
  try {
    return localStorage.getItem(`${API_KEY_PREFIX}:${providerId}`) ?? ''
  } catch {
    return ''
  }
}

/** Persist the API key for a provider (empty input clears it). */
export function setApiKey(providerId: string, key: string): void {
  try {
    const trimmed = key.trim()
    if (trimmed.length === 0) localStorage.removeItem(`${API_KEY_PREFIX}:${providerId}`)
    else localStorage.setItem(`${API_KEY_PREFIX}:${providerId}`, trimmed)
  } catch {
    /* storage unavailable — ignore */
  }
}

/** Remove any stored API key for a provider. */
export function clearApiKey(providerId: string): void {
  try {
    localStorage.removeItem(`${API_KEY_PREFIX}:${providerId}`)
  } catch {
    /* ignore */
  }
}

/** One currency-denominated balance line returned by a provider's balance API. */
export interface BalanceInfo {
  currency: string
  totalBalance: string
  grantedBalance: string
  toppedUpBalance: string
}

/** Normalized balance response for a specific provider. */
export interface BalanceResult {
  providerId: string
  available: boolean
  infos: BalanceInfo[]
}

/**
 * Query a provider's account balance for the given key.
 * @throws when the provider has no key-authenticated balance endpoint, the
 *         request fails, or it returns a non-OK status.
 */
export async function fetchBalance(spec: ProviderSpec, apiKey: string): Promise<BalanceResult> {
  if (!spec.balanceSupported || spec.balancePath.length === 0) {
    throw new Error(`${spec.label} 暂不支持通过 API Key 直接查询余额，请前往其控制台查看与充值。`)
  }
  const response = await proxyFetch(`${spec.baseUrl}${spec.balancePath}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey.trim()}` },
  })
  if (!response.ok) {
    throw new Error(`查询余额失败：HTTP ${response.status}${response.status === 401 ? '（密钥无效或无权限）' : ''}`)
  }
  const data = await response.json() as {
    is_available?: boolean
    balance_infos?: Array<{
      currency?: string
      total_balance?: string | number
      granted_balance?: string | number
      topped_up_balance?: string | number
    }>
    // OpenRouter `/api/v1/credits` shape.
    credits?: number
    usage?: number
  }
  const infos: BalanceInfo[] = (data.balance_infos ?? []).map((b) => ({
    currency: b.currency ?? '',
    totalBalance: String(b.total_balance ?? ''),
    grantedBalance: String(b.granted_balance ?? ''),
    toppedUpBalance: String(b.topped_up_balance ?? ''),
  }))
  if (infos.length === 0 && typeof data.credits === 'number') {
    infos.push({
      currency: 'USD',
      totalBalance: String(data.credits),
      grantedBalance: '',
      toppedUpBalance: '',
    })
  }
  return { providerId: spec.id, available: data.is_available ?? infos.length > 0, infos }
}
