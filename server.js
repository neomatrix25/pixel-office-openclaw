#!/usr/bin/env node
/**
 * Pixel Office production server.
 * Serves the built static files and bridges session data from
 * OpenClaw agent session stores to the browser via GET /sessions_list.
 *
 * Environment variables:
 *   PORT                 — HTTP port (default: 3002)
 *   OPENCLAW_HOME        — OpenClaw home directory (default: ~/.openclaw)
 *   OPENCLAW_ACTIVE_MIN  — Active window in minutes for session filtering (default: 60)
 *   OPENCLAW_AGENTS      — Comma-separated agent IDs to scan (default: auto-detect)
 *
 * Usage:
 *   npm run build && node server.js
 */

import express from 'express'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { homedir } from 'os'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const PORT = parseInt(process.env.PORT || '3002', 10)
const OPENCLAW_HOME = process.env.OPENCLAW_HOME || join(homedir(), '.openclaw')
const ACTIVE_MINUTES = parseInt(process.env.OPENCLAW_ACTIVE_MIN || '60', 10)
const AGENT_IDS = process.env.OPENCLAW_AGENTS
  ? process.env.OPENCLAW_AGENTS.split(',').map((s) => s.trim())
  : null // null = auto-detect from directory listing

const app = express()
app.use(express.json())

// ── Sessions Bridge (File Store → HTTP) ──────────────────────────

/**
 * Discover agent IDs by scanning the agents directory.
 * Returns array of directory names under OPENCLAW_HOME/agents/.
 */
function discoverAgents() {
  const agentsDir = join(OPENCLAW_HOME, 'agents')
  if (!existsSync(agentsDir)) return []
  try {
    return readdirSync(agentsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return []
  }
}

/**
 * Read all sessions from an agent's session store file.
 * Returns array of session objects with agentId injected.
 */
function readAgentSessions(agentId) {
  const sessionsFile = join(OPENCLAW_HOME, 'agents', agentId, 'sessions', 'sessions.json')
  if (!existsSync(sessionsFile)) return []

  try {
    const raw = readFileSync(sessionsFile, 'utf-8')
    const data = JSON.parse(raw)

    // The file is a flat dict keyed by session key
    const sessions = []
    const now = Date.now()
    const cutoff = now - ACTIVE_MINUTES * 60 * 1000

    for (const [key, session] of Object.entries(data)) {
      const s = session
      const updatedAt = s.updatedAt || 0

      // Filter by activity window
      if (updatedAt < cutoff) continue

      sessions.push({
        sessionKey: key,
        kind: s.kind || 'agent',
        name: s.displayName || agentId,
        model: s.model || 'unknown',
        lastActivity: updatedAt,
        status: deriveStatus(s, now),
        agentId,
        lastMessage: extractLastMessage(s) || null,
      })
    }

    return sessions
  } catch (err) {
    console.error(`[bridge] Error reading ${agentId} sessions:`, err.message)
    return []
  }
}

/**
 * Derive agent status from session data.
 */
function deriveStatus(session, now) {
  // If updated within last 60 seconds, consider active
  if (session.updatedAt && (now - session.updatedAt) < 60000) {
    return 'active'
  }

  // Check last message for tool activity
  const messages = session.messages || session.last_messages
  const lastMsg = Array.isArray(messages) ? messages[0] : null
  if (lastMsg) {
    if (lastMsg.role === 'assistant') {
      const content = Array.isArray(lastMsg.content) ? lastMsg.content : []
      const hasToolCall = content.some((c) => c.type === 'toolCall' || c.type === 'tool_use')
      return hasToolCall ? 'active' : 'waiting'
    }
    return 'waiting'
  }

  return 'idle'
}

/**
 * Extract the last meaningful message from session data.
 * Returns a short summary string, or null if nothing found.
 */
function extractLastMessage(session) {
  const messages = session.messages || session.last_messages || []
  if (!Array.isArray(messages) || messages.length === 0) return null

  // Walk backwards to find last assistant message with text
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'assistant') {
      if (typeof msg.content === 'string') return msg.content.slice(0, 200)
      if (Array.isArray(msg.content)) {
        const text = msg.content.find((c) => c.type === 'text')
        if (text && text.text) return text.text.slice(0, 200)
      }
    }
  }
  return null
}

app.get('/sessions_list', (_req, res) => {
  try {
    const agents = AGENT_IDS || discoverAgents()
    const allSessions = []

    for (const agentId of agents) {
      const sessions = readAgentSessions(agentId)
      allSessions.push(...sessions)
    }

    // Dedup: one entry per agentId, keep the most recent session
    const byAgent = new Map()
    for (const s of allSessions) {
      const key = s.agentId
      const existing = byAgent.get(key)
      if (!existing || (s.lastActivity || 0) > (existing.lastActivity || 0)) {
        byAgent.set(key, s)
      }
    }
    const dedupedSessions = [...byAgent.values()]

    res.json({ sessions: dedupedSessions })
  } catch (err) {
    const message = err.message || 'Session store read failed'
    console.error('[bridge] Error:', message)
    res.status(500).json({
      error: 'Session store read failed',
      detail: String(message).slice(0, 200),
    })
  }
})

// Also serve at /api/sessions as an alias
app.get('/api/sessions', (req, res) => {
  req.url = '/sessions_list'
  app.handle(req, res)
})

// ── Chat Bridge (Send Message → Agent) ───────────────────────────

/**
 * Get the most recent active session key for an agent.
 * Routes pixel office chat into the same session as Slack.
 */
function getActiveSessionKey(agentId) {
  const sessionsFile = join(OPENCLAW_HOME, 'agents', agentId, 'sessions', 'sessions.json')
  if (!existsSync(sessionsFile)) return null

  try {
    const raw = readFileSync(sessionsFile, 'utf-8')
    const data = JSON.parse(raw)

    let bestKey = null
    let bestTime = 0

    for (const [key, session] of Object.entries(data)) {
      const updatedAt = session.updatedAt || 0
      if (updatedAt > bestTime) {
        bestTime = updatedAt
        bestKey = key
      }
    }

    return bestKey
  } catch {
    return null
  }
}

app.post('/api/send', async (req, res) => {
  const { agentId, message } = req.body || {}
  if (!agentId || !message) {
    return res.status(400).json({ error: 'Missing agentId or message' })
  }

  const safeAgentId = String(agentId).replace(/[^a-zA-Z0-9_-]/g, '')
  const safeMessage = String(message).slice(0, 2000)

  // Use OpenClaw gateway API to send message to the agent's session
  const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'http://127.0.0.1:18789'
  const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || ''

  // Find the agent's most recent session key
  const sessionKey = getActiveSessionKey(safeAgentId)

  try {
    // Use sessions_send via the gateway API
    const payload = {
      message: safeMessage,
      ...(sessionKey ? { label: safeAgentId } : { label: safeAgentId }),
    }

    const resp = await fetch(`${GATEWAY_URL}/api/sessions/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(GATEWAY_TOKEN ? { 'Authorization': `Bearer ${GATEWAY_TOKEN}` } : {}),
      },
      body: JSON.stringify(payload),
    })

    if (!resp.ok) {
      const body = await resp.text()
      console.error(`[bridge] Gateway send failed for ${safeAgentId}: ${resp.status} ${body.slice(0, 200)}`)
      // Fallback to CLI
      try {
        execSync(
          `openclaw agent --agent ${safeAgentId} --message ${JSON.stringify(safeMessage)} --deliver`,
          { timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] }
        )
        console.log(`[bridge] Sent to ${safeAgentId} (CLI fallback): ${safeMessage.slice(0, 50)}...`)
        return res.json({ ok: true, agentId: safeAgentId })
      } catch (cliErr) {
        return res.status(500).json({ error: 'Failed to send message', detail: body.slice(0, 200) })
      }
    }

    const result = await resp.json()
    console.log(`[bridge] Sent to ${safeAgentId} via gateway: ${safeMessage.slice(0, 50)}...`)
    res.json({ ok: true, agentId: safeAgentId, reply: result.reply || result.text || null })
  } catch (err) {
    const detail = err.message || 'Send failed'
    console.error(`[bridge] Send error for ${safeAgentId}:`, detail)
    res.status(500).json({ error: 'Failed to send message', detail: detail.slice(0, 200) })
  }
})

// ── Static Files ────────────────────────────────────────────────

const distPath = join(__dirname, 'dist')
app.use(express.static(distPath))

// SPA fallback — serve index.html for all non-API routes (Express 5 syntax)
app.get('/{*path}', (_req, res) => {
  res.sendFile(join(distPath, 'index.html'))
})

// ── Start ───────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  const agents = AGENT_IDS || discoverAgents()
  console.log(`[server] Pixel Office running at http://0.0.0.0:${PORT}`)
  console.log(`[server] Session store: ${OPENCLAW_HOME}/agents/`)
  console.log(`[server] Scanning ${agents.length} agents: ${agents.join(', ')}`)
  console.log(`[server] Activity window: ${ACTIVE_MINUTES} minutes`)
})
