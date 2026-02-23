import { useState, useEffect, useRef, useCallback } from 'react'
import type { AgentMeta } from '../hooks/useExtensionMessages.js'

// ── Agent emoji mapping (shared with ToolOverlay) ────────────────

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

const KIND_EMOJIS: Record<string, string> = {
  coder: '\u{1F4BB}',
  developer: '\u{1F4BB}',
  engineer: '\u{1F4BB}',
  researcher: '\u{1F50D}',
  analyst: '\u{1F50D}',
  planner: '\u{1F4CB}',
  writer: '\u270D\uFE0F',
  designer: '\u{1F3A8}',
  reviewer: '\u{1F440}',
  tester: '\u{1F9EA}',
  ops: '\u2699\uFE0F',
  agent: '\u{1F916}',
}

function getAgentEmoji(meta: AgentMeta | undefined): string {
  if (!meta) return '\u{1F916}'
  if (meta.agentId && AGENT_EMOJIS[meta.agentId]) return AGENT_EMOJIS[meta.agentId]
  if (meta.kind && KIND_EMOJIS[meta.kind.toLowerCase()]) return KIND_EMOJIS[meta.kind.toLowerCase()]
  if (meta.name) {
    const lower = meta.name.toLowerCase()
    for (const [key, emoji] of Object.entries(AGENT_EMOJIS)) {
      if (lower.includes(key)) return emoji
    }
  }
  return '\u{1F916}'
}

function getAgentDisplayName(meta: AgentMeta | undefined, id: number): string {
  if (meta?.name) return meta.name.charAt(0).toUpperCase() + meta.name.slice(1)
  return `Agent ${id}`
}

function relativeTime(ms: number | undefined): string {
  if (!ms) return ''
  const ago = Date.now() - ms
  if (ago < 10_000) return 'just now'
  if (ago < 60_000) return `${Math.floor(ago / 1000)}s ago`
  if (ago < 3_600_000) return `${Math.floor(ago / 60_000)}m ago`
  if (ago < 86_400_000) return `${Math.floor(ago / 3_600_000)}h ago`
  return `${Math.floor(ago / 86_400_000)}d ago`
}

function getIdleLabel(lastActivityMs: number | undefined): string {
  if (!lastActivityMs) return 'Idle'
  const ago = Date.now() - lastActivityMs
  if (ago < 60_000) return '\u2615 Break'
  if (ago < 300_000) return '\u{1F4A4} Resting'
  return '\u{1F319} AFK'
}

// ── Chat persistence ─────────────────────────────────────────────

interface ChatMessage {
  role: 'user' | 'agent'
  text: string
  ts: number
}

function getChatKey(agentId: string | undefined): string {
  return `pixel-office-chat:${agentId || 'unknown'}`
}

function loadChatHistory(agentId: string | undefined): ChatMessage[] {
  try {
    const raw = localStorage.getItem(getChatKey(agentId))
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveChatHistory(agentId: string | undefined, messages: ChatMessage[]): void {
  try {
    localStorage.setItem(getChatKey(agentId), JSON.stringify(messages.slice(-50)))
  } catch { /* ignore */ }
}

async function sendChatMessage(agentId: string, message: string): Promise<boolean> {
  try {
    const resp = await fetch('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, message }),
    })
    return resp.ok
  } catch {
    return false
  }
}

// ── Component ────────────────────────────────────────────────────

interface ChatSidebarProps {
  agentId: number
  meta: AgentMeta | undefined
  isActive: boolean
  onClose: () => void
}

export function ChatSidebar({ agentId, meta, isActive, onClose }: ChatSidebarProps) {
  const emoji = getAgentEmoji(meta)
  const displayName = getAgentDisplayName(meta, agentId)
  const model = meta?.model || 'unknown'
  const idleLabel = getIdleLabel(meta?.lastActivity)
  const timeAgo = relativeTime(meta?.lastActivity)
  const agentKey = meta?.agentId

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => loadChatHistory(agentKey))
  const [chatInput, setChatInput] = useState('')
  const [sending, setSending] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Reload chat history when agent changes
  useEffect(() => {
    setChatMessages(loadChatHistory(agentKey))
    setChatInput('')
    // Focus input when sidebar opens
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [agentKey])

  // Scroll to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages.length])

  const handleSend = useCallback(async () => {
    const text = chatInput.trim()
    if (!text || !agentKey || sending) return

    const msg: ChatMessage = { role: 'user', text, ts: Date.now() }
    const updated = [...chatMessages, msg]
    setChatMessages(updated)
    saveChatHistory(agentKey, updated)
    setChatInput('')
    setSending(true)

    const ok = await sendChatMessage(agentKey, text)
    if (!ok) {
      const errMsg: ChatMessage = { role: 'agent', text: '(failed to deliver)', ts: Date.now() }
      const withErr = [...updated, errMsg]
      setChatMessages(withErr)
      saveChatHistory(agentKey, withErr)
    }
    setSending(false)
    inputRef.current?.focus()
  }, [chatInput, agentKey, sending, chatMessages])

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--pixel-bg)',
        borderLeft: '2px solid var(--pixel-border)',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '10px 12px',
          borderBottom: '2px solid var(--pixel-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--vscode-foreground)' }}>
            {emoji} {displayName}
          </div>
          <div style={{ fontSize: '18px', color: 'var(--pixel-text-dim)', marginTop: 2 }}>
            {model}
          </div>
          <div style={{
            fontSize: '18px',
            color: isActive ? 'var(--pixel-status-active-text, #5ac88c)' : 'var(--pixel-text-dim)',
            marginTop: 2,
          }}>
            {isActive ? '\u{1F7E2} Working' : idleLabel}
            {timeAgo ? ` \u2014 ${timeAgo}` : ''}
          </div>
        </div>
        <button
          onClick={onClose}
          title="Close chat"
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--pixel-close-text)',
            cursor: 'pointer',
            fontSize: '28px',
            lineHeight: 1,
            padding: '0 4px',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--pixel-close-hover)' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--pixel-close-text)' }}
        >
          x
        </button>
      </div>

      {/* Chat messages */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '10px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {chatMessages.length === 0 && (
          <div style={{
            color: 'var(--pixel-text-dim)',
            fontSize: '20px',
            textAlign: 'center',
            marginTop: 40,
            lineHeight: 1.5,
          }}>
            Send a message to {displayName} {emoji}
          </div>
        )}

        {chatMessages.map((msg, i) => (
          <div
            key={i}
            style={{
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
            }}
          >
            <div
              style={{
                background: msg.role === 'user'
                  ? 'var(--pixel-chat-user-bg, rgba(0, 127, 212, 0.25))'
                  : 'var(--pixel-chat-agent-bg, rgba(255, 255, 255, 0.08))',
                border: `1px solid ${msg.role === 'user' ? 'rgba(0, 127, 212, 0.4)' : 'var(--pixel-border)'}`,
                borderRadius: 0,
                padding: '6px 10px',
                fontSize: '20px',
                color: 'var(--vscode-foreground)',
                lineHeight: 1.4,
                wordBreak: 'break-word',
              }}
            >
              {msg.text}
            </div>
            <div style={{
              fontSize: '16px',
              color: 'var(--pixel-text-dim)',
              marginTop: 2,
              textAlign: msg.role === 'user' ? 'right' : 'left',
            }}>
              {msg.role === 'user' ? 'You' : displayName} \u2022 {new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div
        style={{
          padding: '8px 12px',
          borderTop: '2px solid var(--pixel-border)',
          display: 'flex',
          gap: 6,
          flexShrink: 0,
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void handleSend()
            }
            e.stopPropagation()
          }}
          placeholder={`Message ${displayName}...`}
          style={{
            flex: 1,
            background: 'var(--pixel-input-bg, rgba(255,255,255,0.08))',
            border: '2px solid var(--pixel-border)',
            borderRadius: 0,
            color: 'var(--vscode-foreground)',
            fontSize: '20px',
            padding: '6px 10px',
            outline: 'none',
          }}
        />
        <button
          onClick={() => void handleSend()}
          disabled={sending || !chatInput.trim()}
          style={{
            background: sending ? 'var(--pixel-border)' : 'var(--pixel-btn-bg, rgba(255,255,255,0.12))',
            border: '2px solid var(--pixel-border)',
            borderRadius: 0,
            color: 'var(--vscode-foreground)',
            fontSize: '22px',
            padding: '6px 14px',
            cursor: sending ? 'wait' : 'pointer',
            flexShrink: 0,
          }}
        >
          {sending ? '...' : '\u{27A4}'}
        </button>
      </div>
    </div>
  )
}
