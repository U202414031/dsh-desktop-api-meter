/**
 * Client-side carrier for the Host HTTP proxy (`/desktop/proxy`).
 *
 * Every cross-origin call from the sandboxed renderer should go through
 * `proxyFetch` instead of `fetch`: it tunnels the request to the Host process,
 * which performs the real `fetch` (Node, no CORS) and streams the response back.
 * The route is same-origin (the renderer is served from the loopback web server),
 * so even the tunnel request itself is CORS-free.
 *
 * If the proxy route is unreachable for any reason, it transparently falls back
 * to a direct `fetch` (which matches the pre-proxy behavior).
 */

const PROXY_PATH = '/desktop/proxy'

/** Collect request headers into a plain string map, tolerant of HeadersInit shapes. */
function collectHeaders(init: RequestInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  const src = init?.headers
  if (src === undefined) return out
  if (Array.isArray(src)) {
    for (const [key, value] of src) out[key] = value
  } else if (typeof Headers !== 'undefined' && src instanceof Headers) {
    src.forEach((value, key) => { out[key] = value })
  } else {
    for (const [key, value] of Object.entries(src as Record<string, string>)) {
      if (typeof value === 'string') out[key] = value
    }
  }
  return out
}

/**
 * Perform an HTTP request through the Host proxy.
 * @param input - absolute upstream URL (http/https).
 * @param init - standard fetch init; the real method/headers/body are forwarded.
 *
 * 失败策略：主进程代理优先。GET/HEAD 幂等，回环请求失败时重试一次（瞬时网络抖动常见）；
 * 重试仍失败再退到直连（跨域通常会被 CORS 拦截）。两路都失败时抛出带具体原因的
 * 错误，避免只留下 Chromium 笼统的 "Failed to fetch"。
 */
export async function proxyFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input.toString()
  const method = init?.method ?? 'GET'
  const headers = collectHeaders(init)
  const proxyInit: RequestInit = {
    method: 'POST',
    headers: { ...headers, 'x-proxy-url': url, 'x-proxy-method': method },
  }
  if (init?.body !== undefined) proxyInit.body = init.body
  // Forward the caller's abort signal so long-running upstream calls (workflow
  // agent nodes, for example) can actually be cancelled from the UI.
  if (init?.signal !== undefined && init.signal !== null) proxyInit.signal = init.signal

  // 幂等方法允许重试一次；POST 等非幂等请求不重试，避免上游重复执行。
  const attempts = method === 'GET' || method === 'HEAD' ? 2 : 1
  let lastProxyError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetch(PROXY_PATH, proxyInit)
    } catch (cause) {
      // 调用方已主动取消（例如竞速中"先成功者取消其他源"）：立即透传
      // 原始 AbortError，不再重试、也不回退直连（都是徒劳，只会产生
      // "signal is aborted without reason" 这类误导性信息）。
      if (init?.signal?.aborted === true) throw cause
      lastProxyError = cause
    }
  }
  // Proxy route unreachable — fall back to a direct request (may be blocked by CORS).
  try {
    return await fetch(input, init)
  } catch (fallbackError) {
    const proxyDetail = lastProxyError instanceof Error ? lastProxyError.message : String(lastProxyError)
    const fallbackDetail = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
    throw new Error(`[代理诊断v4] 请求失败：主进程代理不可用（${proxyDetail}），直连回退也被拦截（${fallbackDetail}）`)
  }
}
