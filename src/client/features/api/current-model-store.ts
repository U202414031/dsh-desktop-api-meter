import { useSyncExternalStore } from 'react'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { detectCurrentModel } from './provider-config.ts'
import { collectUsage, type UsageEntry, type UsageSummary } from '../usage/usage.ts'

const EMPTY_SUMMARY: UsageSummary = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  count: 0,
  cost: null,
}

/** Snapshot of the model currently in use, shared from a session-scoped observer. */
export interface CurrentModelState {
  /** Raw provider route id reported by the host (e.g. "deepseek-official"). */
  provider: string | undefined
  /** Raw model id reported by the host (e.g. "deepseek-v4-flash"). */
  model: string | undefined
  /** Resolved provider spec id, or null when unknown / not yet detected. */
  specId: string | null
  /** Whether the active session is currently generating a reply. */
  running: boolean
  /** Per-reply usage in conversation order (real-time: appended on finalize). */
  entries: readonly UsageEntry[]
  /** Cumulative token usage and estimated cost for the detected provider. */
  summary: UsageSummary
  /** Chat row anchor key per assistant-message seq, for jump-to-reply. */
  chatKeysBySeq: Readonly<Record<number, string>>
}

let state: CurrentModelState = {
  provider: undefined,
  model: undefined,
  specId: null,
  running: false,
  entries: [],
  summary: EMPTY_SUMMARY,
  chatKeysBySeq: {},
}
let stateKey = ''
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

/**
 * Build the assistant-message seq → chat row anchor key index from the chat
 * view. The upstream `assistant-step` chat nodes carry the finalized message's
 * seq both as `anchorSeq` and inside their data; the desktop does not import
 * the upstream node types, so this reads them structurally.
 */
function collectChatKeys(snapshot: ConversationSnapshot | undefined): Record<number, string> {
  const index: Record<number, string> = {}
  if (snapshot === undefined) return index
  for (const node of snapshot.chat.nodes.values()) {
    if (node.kind !== 'assistant-step') continue
    const data = (node.data ?? {}) as { finalNode?: { seq?: number } }
    const seq = data.finalNode?.seq ?? node.anchorSeq
    if (seq > 0 && index[seq] === undefined) index[seq] = node.key
  }
  return index
}

/**
 * Push the detected model + per-reply usage from a session snapshot into the
 * store. Called on every snapshot change (including each streaming chunk), so
 * it must stay cheap: it derives a small fingerprint and only re-emits when
 * the visible facts actually changed.
 */
export function setCurrentModelFromSnapshot(snapshot: ConversationSnapshot | undefined): void {
  const { provider, model, spec } = detectCurrentModel(snapshot)
  const specId = spec?.id ?? null
  const running = snapshot?.running ?? false
  const { entries, summary } = collectUsage(snapshot, spec)
  const chatKeysBySeq = collectChatKeys(snapshot)
  const chatKeyFingerprint = Object.entries(chatKeysBySeq)
    .map(([seq, key]) => `${seq}:${key}`)
    .join('|')
  const key = [
    provider ?? '',
    model ?? '',
    specId ?? '',
    running ? '1' : '0',
    entries
      .map((entry) => `${entry.seq}:${entry.turn}:${entry.usage.promptTokens}:${entry.usage.completionTokens}:${entry.usage.totalTokens}:${entry.cost?.amount ?? ''}`)
      .join('|'),
    chatKeyFingerprint,
  ].join('~')
  if (key === stateKey) return
  stateKey = key
  state = { provider, model, specId, running, entries, summary, chatKeysBySeq }
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function getSnapshot(): CurrentModelState {
  return state
}

/** Subscribe a React component to the currently-detected model. */
export function useCurrentModel(): CurrentModelState {
  return useSyncExternalStore(subscribe, getSnapshot)
}
