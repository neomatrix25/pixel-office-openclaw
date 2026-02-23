import { useState, useEffect } from 'react'
import type { ToolActivity } from '../types.js'
import type { OfficeState } from '../engine/officeState.js'
import type { SubagentCharacter, AgentMeta } from '../../hooks/useExtensionMessages.js'
import { TILE_SIZE, CharacterState } from '../types.js'
import { TOOL_OVERLAY_VERTICAL_OFFSET, CHARACTER_SITTING_OFFSET_PX } from '../../constants.js'

interface ToolOverlayProps {
  officeState: OfficeState
  agents: number[]
  agentTools: Record<number, ToolActivity[]>
  agentMeta: Record<number, AgentMeta>
  subagentCharacters: SubagentCharacter[]
  containerRef: React.RefObject<HTMLDivElement | null>
  zoom: number
  panRef: React.RefObject<{ x: number; y: number }>
  onCloseAgent: (id: number) => void
}

// ── Agent emoji mapping ──────────────────────────────────────────

const AGENT_EMOJIS: Record<string, string> = {
  main: '\u{1F99E}',       // lobster
  researcher: '\u{1F50D}', // magnifying glass
  'coder-1': '\u{1F4BB}',  // laptop
  'coder-2': '\u{1F4BB}',  // laptop
  writer: '\u270D\uFE0F',  // writing hand
  planner: '\u{1F4CB}',    // clipboard
  ops: '\u2699\uFE0F',     // gear
  edu: '\u{1F4DA}',        // books
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
  if (!meta) return '\u{1F916}' // robot
  // Try agentId-based emoji first (most specific)
  if (meta.agentId && AGENT_EMOJIS[meta.agentId]) return AGENT_EMOJIS[meta.agentId]
  // Try kind-based emoji
  if (meta.kind && KIND_EMOJIS[meta.kind.toLowerCase()]) return KIND_EMOJIS[meta.kind.toLowerCase()]
  // Try name-based match
  if (meta.name) {
    const lower = meta.name.toLowerCase()
    for (const [key, emoji] of Object.entries(AGENT_EMOJIS)) {
      if (lower.includes(key)) return emoji
    }
  }
  return '\u{1F916}' // robot fallback
}

function getAgentDisplayName(meta: AgentMeta | undefined, id: number): string {
  if (meta?.name) {
    // Capitalize first letter
    return meta.name.charAt(0).toUpperCase() + meta.name.slice(1)
  }
  return `Agent ${id}`
}

// ── Relative time formatting ─────────────────────────────────────

function relativeTime(ms: number | undefined): string {
  if (!ms) return ''
  const ago = Date.now() - ms
  if (ago < 0) return 'just now'
  if (ago < 10_000) return 'just now'
  if (ago < 60_000) return `${Math.floor(ago / 1000)}s ago`
  if (ago < 3_600_000) return `${Math.floor(ago / 60_000)}m ago`
  if (ago < 86_400_000) return `${Math.floor(ago / 3_600_000)}h ago`
  return `${Math.floor(ago / 86_400_000)}d ago`
}

// ── Fun idle status labels ───────────────────────────────────────

function getIdleLabel(lastActivityMs: number | undefined): string {
  if (!lastActivityMs) return 'Idle'
  const ago = Date.now() - lastActivityMs
  if (ago < 60_000) return '\u2615 Break'       // coffee
  if (ago < 300_000) return '\u{1F4A4} Resting'  // zzz
  return '\u{1F319} AFK'                          // crescent moon
}

/** Derive a short human-readable activity string from tools/status */
function getActivityText(
  agentId: number,
  agentTools: Record<number, ToolActivity[]>,
  isActive: boolean,
): string {
  const tools = agentTools[agentId]
  if (tools && tools.length > 0) {
    // Find the latest non-done tool
    const activeTool = [...tools].reverse().find((t) => !t.done)
    if (activeTool) {
      if (activeTool.permissionWait) return 'Needs approval'
      return activeTool.status
    }
    // All tools done but agent still active (mid-turn) — keep showing last tool status
    if (isActive) {
      const lastTool = tools[tools.length - 1]
      if (lastTool) return lastTool.status
    }
  }

  return isActive ? 'Working...' : ''
}

// ── Main Overlay ─────────────────────────────────────────────────

export function ToolOverlay({
  officeState,
  agents,
  agentTools,
  agentMeta,
  subagentCharacters,
  containerRef,
  zoom,
  panRef,
  onCloseAgent,
}: ToolOverlayProps) {
  const [, setTick] = useState(0)
  useEffect(() => {
    let rafId = 0
    const tick = () => {
      setTick((n) => n + 1)
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])

  const el = containerRef.current
  if (!el) return null
  const rect = el.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  const canvasW = Math.round(rect.width * dpr)
  const canvasH = Math.round(rect.height * dpr)
  const layout = officeState.getLayout()
  const mapW = layout.cols * TILE_SIZE * zoom
  const mapH = layout.rows * TILE_SIZE * zoom
  const deviceOffsetX = Math.floor((canvasW - mapW) / 2) + Math.round(panRef.current.x)
  const deviceOffsetY = Math.floor((canvasH - mapH) / 2) + Math.round(panRef.current.y)

  const selectedId = officeState.selectedAgentId
  const hoveredId = officeState.hoveredAgentId

  // All character IDs
  const allIds = [...agents, ...subagentCharacters.map((s) => s.id)]

  return (
    <>
      {allIds.map((id) => {
        const ch = officeState.characters.get(id)
        if (!ch) return null

        const isSelected = selectedId === id
        const isHovered = hoveredId === id
        const isSub = ch.isSubagent

        // Only show for hovered or selected agents
        if (!isSelected && !isHovered) return null

        // Position above character
        const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0
        const screenX = (deviceOffsetX + ch.x * zoom) / dpr
        const screenY = (deviceOffsetY + (ch.y + sittingOffset - TOOL_OVERLAY_VERTICAL_OFFSET) * zoom) / dpr

        const meta = agentMeta[id]
        const emoji = getAgentEmoji(meta)
        const displayName = getAgentDisplayName(meta, id)

        // Get activity text
        const subHasPermission = isSub && ch.bubbleType === 'permission'
        let hoverText: string
        if (isSub) {
          if (subHasPermission) {
            hoverText = 'Needs approval'
          } else {
            const sub = subagentCharacters.find((s) => s.id === id)
            hoverText = sub ? sub.label : 'Subtask'
          }
        } else {
          const toolText = getActivityText(id, agentTools, ch.isActive)
          if (toolText) {
            // Has specific tool activity or "Working..."
            hoverText = `${displayName} ${emoji} \u2014 ${toolText}`
          } else {
            // Idle — show fun label + relative time
            const idleLabel = getIdleLabel(meta?.lastActivity)
            const timeAgo = relativeTime(meta?.lastActivity)
            hoverText = `${displayName} ${emoji} \u2014 ${idleLabel}${timeAgo ? ` (${timeAgo})` : ''}`
          }
        }

        // Determine dot color
        const tools = agentTools[id]
        const hasPermission = subHasPermission || tools?.some((t) => t.permissionWait && !t.done)
        const hasActiveTools = tools?.some((t) => !t.done)
        const isActive = ch.isActive

        let dotColor: string | null = null
        if (hasPermission) {
          dotColor = 'var(--pixel-status-permission)'
        } else if (isActive && hasActiveTools) {
          dotColor = 'var(--pixel-status-active)'
        } else if (isActive) {
          dotColor = 'var(--pixel-status-active)'
        }

        return (
          <div
            key={id}
            style={{
              position: 'absolute',
              left: screenX,
              top: screenY - 24,
              transform: 'translateX(-50%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              pointerEvents: isSelected ? 'auto' : 'none',
              zIndex: isSelected ? 'var(--pixel-overlay-selected-z)' : 'var(--pixel-overlay-z)',
            }}
          >
            {/* Hover/selected label */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                background: 'var(--pixel-bg)',
                border: isSelected
                  ? '2px solid var(--pixel-border-light)'
                  : '2px solid var(--pixel-border)',
                borderRadius: 0,
                padding: isSelected ? '3px 6px 3px 8px' : '3px 8px',
                boxShadow: 'var(--pixel-shadow)',
                whiteSpace: 'nowrap',
                maxWidth: 300,
              }}
            >
              {dotColor && (
                <span
                  className={isActive && !hasPermission ? 'pixel-agents-pulse' : undefined}
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: dotColor,
                    flexShrink: 0,
                  }}
                />
              )}
              <span
                style={{
                  fontSize: isSub ? '20px' : '22px',
                  fontStyle: isSub ? 'italic' : undefined,
                  color: 'var(--vscode-foreground)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {hoverText}
              </span>
              {isSelected && !isSub && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onCloseAgent(id)
                  }}
                  title="Close agent"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--pixel-close-text)',
                    cursor: 'pointer',
                    padding: '0 2px',
                    fontSize: '26px',
                    lineHeight: 1,
                    marginLeft: 2,
                    flexShrink: 0,
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.color = 'var(--pixel-close-hover)'
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.color = 'var(--pixel-close-text)'
                  }}
                >
                  x
                </button>
              )}
            </div>
          </div>
        )
      })}
    </>
  )
}
