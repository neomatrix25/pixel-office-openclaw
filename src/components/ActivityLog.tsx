import { useState, useEffect, useRef } from 'react'
import { eventBus } from '../eventBus.js'
import type { AgentMeta } from '../hooks/useExtensionMessages.js'

// ── Agent emoji mapping (shared) ────────────────────────────────

const AGENT_EMOJIS: Record<string, string> = {
  main: '\u{1F99E}',
  researcher: '\u{1F50D}',
  'coder-1': '\u{1F4BB}',
  'coder-2': '\u{1F4BB}',
  writer: '\u270D\uFE0F',
  planner: '\u{1F4CB}',
  ops: '\u2699\uFE0F',
  edu: '\u{1F4DA}',
}

function getEmoji(meta: AgentMeta | undefined): string {
  if (!meta) return '\u{1F916}'
  if (meta.agentId && AGENT_EMOJIS[meta.agentId]) return AGENT_EMOJIS[meta.agentId]
  return '\u{1F916}'
}

function getName(meta: AgentMeta | undefined, id?: number): string {
  if (meta?.name) return meta.name.charAt(0).toUpperCase() + meta.name.slice(1)
  if (id !== undefined) return `Agent ${id}`
  return 'Agent'
}

// ── Log entry types ─────────────────────────────────────────────

interface LogEntry {
  id: number
  ts: number
  emoji: string
  agent: string
  text: string
  color: string
}

const EVENT_COLORS: Record<string, string> = {
  created: '#5ac88c',
  closed: '#e55',
  active: '#4ea8de',
  idle: 'var(--pixel-text-dim)',
  tool: '#d4a037',
  done: '#8b8b8b',
  meta: 'var(--pixel-text-dim)',
}

const MAX_ENTRIES = 200

// ── Component ───────────────────────────────────────────────────

interface ActivityLogProps {
  agentMeta: Record<number, AgentMeta>
}

export function ActivityLog({ agentMeta }: ActivityLogProps) {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const idRef = useRef(0)
  const metaRef = useRef(agentMeta)
  metaRef.current = agentMeta

  useEffect(() => {
    const add = (emoji: string, agent: string, text: string, color: string) => {
      const entry: LogEntry = { id: ++idRef.current, ts: Date.now(), emoji, agent, text, color }
      setEntries((prev) => [...prev.slice(-(MAX_ENTRIES - 1)), entry])
    }

    const unsubs = [
      eventBus.on('agentCreated', (data) => {
        const name = (data.name as string) || `Agent ${data.id}`
        const kind = (data.kind as string) || ''
        const meta = metaRef.current[data.id as number]
        const emoji = getEmoji(meta) || '\u{1F916}'
        add(emoji, name, `joined the office${kind ? ` (${kind})` : ''}`, EVENT_COLORS.created)
      }),

      eventBus.on('agentClosed', (data) => {
        const meta = metaRef.current[data.id as number]
        const emoji = getEmoji(meta)
        const name = getName(meta, data.id as number)
        add(emoji, name, 'left the office', EVENT_COLORS.closed)
      }),

      eventBus.on('agentStatus', (data) => {
        const meta = metaRef.current[data.id as number]
        const emoji = getEmoji(meta)
        const name = getName(meta, data.id as number)
        const status = data.status as string
        if (status === 'active') {
          add(emoji, name, 'started working', EVENT_COLORS.active)
        } else if (status === 'waiting' || status === 'idle') {
          add(emoji, name, 'is now idle', EVENT_COLORS.idle)
        }
      }),

      eventBus.on('agentToolStart', (data) => {
        const meta = metaRef.current[data.id as number]
        const emoji = getEmoji(meta)
        const name = getName(meta, data.id as number)
        const status = (data.status as string) || 'using a tool'
        add(emoji, name, status, EVENT_COLORS.tool)
      }),

      eventBus.on('agentToolDone', (data) => {
        const meta = metaRef.current[data.id as number]
        const emoji = getEmoji(meta)
        const name = getName(meta, data.id as number)
        add(emoji, name, 'finished tool use', EVENT_COLORS.done)
      }),
    ]

    return () => unsubs.forEach((u) => u())
  }, [])

  // Auto-scroll to bottom
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [entries.length])

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--pixel-bg)',
        borderTop: '2px solid var(--pixel-border)',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '4px 10px',
          borderBottom: '1px solid var(--pixel-border)',
          fontSize: '20px',
          color: 'var(--pixel-text-dim)',
          flexShrink: 0,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>Activity Log</span>
        <span style={{ fontSize: '18px' }}>{entries.length} events</span>
      </div>

      {/* Scrollable log */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '4px 10px',
          fontSize: '20px',
          lineHeight: 1.6,
        }}
      >
        {entries.length === 0 && (
          <div style={{ color: 'var(--pixel-text-dim)', textAlign: 'center', marginTop: 12 }}>
            Waiting for agent activity...
          </div>
        )}
        {entries.map((e) => (
          <div key={e.id} style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
            <span style={{ color: 'var(--pixel-text-dim)', fontSize: '18px', flexShrink: 0 }}>
              {formatTime(e.ts)}
            </span>
            <span>{e.emoji}</span>
            <span style={{ fontWeight: 'bold', color: 'var(--vscode-foreground)' }}>{e.agent}</span>
            <span style={{ color: e.color }}>{e.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
