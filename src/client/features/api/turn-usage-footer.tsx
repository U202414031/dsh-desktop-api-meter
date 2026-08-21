import { useMemo } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { collectTurnUsage, formatCost } from '../usage/usage.ts'
import { labelForModel } from './provider-config.ts'

/**
 * Matched share the chain selector hands this entry (see advanced-shell.ts).
 */
export interface TurnUsageFooterMatch {
  /** Engine-owned turn number the tail anchors under. */
  turnNumber: number
  /** The closing assistant's seq (unused for display; kept for identity). */
  seq: number
}

type TurnUsageFooterProps = PropsRuntime<'conversation.chat.turnTail'> & { matched: TurnUsageFooterMatch }

/**
 * Inline per-reply usage footer contributed into the upstream
 * `conversation.chat.turnTail` chain slot, so every finished reply shows its
 * token usage and estimated cost right below the message text. Renders one row
 * per assistant step that reported usage (multi-step turns show one row per
 * step); renders nothing while no usage has landed yet.
 */
export function TurnUsageFooter({ matched, useSession }: TurnUsageFooterProps): JSX.Element | null {
  const snapshot = useSession((s) => s)
  const rows = useMemo(
    () => collectTurnUsage(snapshot, matched.turnNumber),
    [snapshot, matched.turnNumber],
  )
  if (rows.length === 0) return null
  return (
    <div className="dshDesktopTurnUsage" data-turn-usage={matched.turnNumber}>
      <span className="dshDesktopTurnUsageTitle">本次回复用量</span>
      {rows.map((row) => {
        const u = row.usage
        const extras = [
          u.cacheHitTokens !== undefined ? `缓存命中 ${u.cacheHitTokens}` : null,
          u.reasoningTokens !== undefined ? `推理 ${u.reasoningTokens}` : null,
        ].filter((part): part is string => part !== null)
        return (
          <div key={row.seq} className="dshDesktopTurnUsageRow" data-seq={row.seq}>
            <span>
              {rows.length > 1 ? `第 ${row.step + 1} 步 · ` : ''}
              {row.model !== undefined ? `${labelForModel(row.model)} · ` : ''}
              输入 {u.promptTokens} · 输出 {u.completionTokens} · 合计 {u.totalTokens}
              {extras.length > 0 ? `（${extras.join('，')}）` : ''}
            </span>
            {row.cost !== null && (
              <span className="dshDesktopTurnUsageCost">
                费用 {formatCost(row.cost)}{row.cost.estimated ? '（估算）' : ''}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
