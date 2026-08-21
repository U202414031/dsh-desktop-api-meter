import { useEffect } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { setCurrentModelFromSnapshot } from './current-model-store.ts'

/**
 * Headless session-scoped observer. It reads the active session's most recent
 * assistant message and publishes the detected provider + token usage to the
 * shared store, so the root-scoped API panel (which cannot read session data
 * directly) can react to the model the user is currently using. Renders nothing.
 */
export function ModelMonitor({ useSession }: PropsRuntime<'desktop.model-monitor'>): JSX.Element | null {
  const snapshot = useSession((s) => s)
  useEffect(() => {
    setCurrentModelFromSnapshot(snapshot)
  }, [snapshot])
  return null
}
