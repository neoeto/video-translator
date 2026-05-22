import { ProxyAgent, Agent } from 'undici'
import type { AppConfig } from './types.js'

function shouldBypass(bypassList: string, targetUrl: string): boolean {
  if (!bypassList.trim()) return false
  let hostname: string
  try {
    hostname = new URL(targetUrl).hostname.toLowerCase()
  } catch {
    return false
  }
  return bypassList.split(',').some((pattern) => {
    const p = pattern.trim().toLowerCase()
    if (!p) return false
    if (p.startsWith('*.')) {
      const suffix = p.slice(1) // ".example.com"
      return hostname.endsWith(suffix) || hostname === p.slice(2)
    }
    return hostname === p
  })
}

/**
 * undici v7+ 默认使用 EnvHttpProxyAgent，会自动读取 HTTP_PROXY 等环境变量。
 * 当用户未在应用中启用代理时，需显式指定 Agent() 以绕过系统代理。
 * 当目标地址在白名单中时也直连。
 */
export function getDispatcher(config: AppConfig, targetUrl?: string): Agent | ProxyAgent {
  if (!config.proxyEnabled || !config.proxyUrl) {
    return new Agent()
  }
  if (targetUrl && shouldBypass(config.proxyBypass ?? '', targetUrl)) {
    return new Agent()
  }
  return new ProxyAgent(config.proxyUrl)
}
