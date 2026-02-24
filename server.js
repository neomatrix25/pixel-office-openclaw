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
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync, unlinkSync } from 'fs'
import { execFileSync, execSync, spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { homedir } from 'os'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const PORT = parseInt(process.env.PORT || '3002', 10)
const HOST = process.env.PIXEL_OFFICE_HOST || '127.0.0.1'
const OPENCLAW_HOME = process.env.OPENCLAW_HOME || join(homedir(), '.openclaw')
const ACTIVE_MINUTES = parseInt(process.env.OPENCLAW_ACTIVE_MIN || '60', 10)
const CHAT_DISABLED = process.env.PIXEL_OFFICE_NO_CHAT === '1'
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
    // Guard against oversized files (max 10MB)
    const fstat = statSync(sessionsFile)
    if (fstat.size > 10 * 1024 * 1024) {
      console.warn(`[bridge] Skipping ${agentId} — sessions.json too large (${fstat.size} bytes)`)
      return []
    }
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

// Simple in-memory cache for session list (avoid I/O spam from rapid polling)
let sessionCache = { data: null, ts: 0 }
const CACHE_TTL_MS = 3000

app.get('/sessions_list', (_req, res) => {
  try {
    // Return cached result if fresh
    const now = Date.now()
    if (sessionCache.data && (now - sessionCache.ts) < CACHE_TTL_MS) {
      return res.json(sessionCache.data)
    }

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

    const result = { sessions: dedupedSessions }
    sessionCache = { data: result, ts: Date.now() }
    res.json(result)
  } catch (err) {
    console.error('[bridge] Error:', err.message || err)
    res.status(500).json({ error: 'Session store read failed' })
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
  if (CHAT_DISABLED) {
    return res.status(403).json({ error: 'Chat is disabled. Start with --no-chat removed to enable.' })
  }
  const { agentId, message } = req.body || {}
  if (!agentId || !message) {
    return res.status(400).json({ error: 'Missing agentId or message' })
  }

  const safeAgentId = String(agentId).replace(/[^a-zA-Z0-9_-]/g, '')
  const safeMessage = String(message).slice(0, 2000)

  // Send via OpenClaw CLI (gateway is WebSocket-only, no REST endpoint)
  try {
    console.log(`[bridge] Sending to ${safeAgentId} via CLI: ${safeMessage.slice(0, 50)}...`)
    // Use env -i with essential vars to get a clean process, avoiding npx inheritance
    const essential = ['HOME', 'PATH', 'USER', 'SHELL', 'LANG', 'TERM', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS']
    const envArgs = essential.filter(k => process.env[k]).map(k => `${k}=${process.env[k]}`)
    // Find openclaw binary dynamically (works on Linux, Mac, any install location)
    let openclawBin
    try { openclawBin = execFileSync('which', ['openclaw'], { encoding: 'utf-8' }).trim() } catch { openclawBin = 'openclaw' }
    const cliResult = execFileSync('/usr/bin/env', ['-i', ...envArgs, openclawBin, 'agent', '--agent', safeAgentId, '--message', safeMessage, '--json'],
      { timeout: 120000, encoding: 'utf-8', cwd: homedir(), stdio: ['pipe', 'pipe', 'pipe'] }
    )
    console.log(`[bridge] Sent to ${safeAgentId} (CLI OK)`)
    try {
      const parsed = JSON.parse(cliResult)
      const reply = parsed.result?.payloads?.[0]?.text
        || parsed.reply || parsed.text || parsed.result || cliResult.trim()
      return res.json({ ok: true, agentId: safeAgentId, reply })
    } catch {
      return res.json({ ok: true, agentId: safeAgentId, reply: cliResult.trim() })
    }
  } catch (cliErr) {
    console.error(`[bridge] CLI send failed for ${safeAgentId}:`, cliErr.message?.slice(0, 200))
    return res.status(500).json({ error: 'Failed to send message', detail: cliErr.message?.slice(0, 200) || 'CLI error' })
  }
})

// ── Layout Persistence (Save/Load to Disk) ──────────────────────

const LAYOUT_DIR = join(OPENCLAW_HOME, 'pixel-office')
const LAYOUT_FILE = join(LAYOUT_DIR, 'layout.json')

app.get('/api/layout', (_req, res) => {
  // If ?reset query param, skip saved layout entirely
  if (_req.query.reset === 'true') {
    return res.status(404).json({ error: 'Reset requested' })
  }
  try {
    if (!existsSync(LAYOUT_FILE)) {
      return res.status(404).json({ error: 'No saved layout' })
    }
    const raw = readFileSync(LAYOUT_FILE, 'utf-8')
    const layout = JSON.parse(raw)
    // Sanity check: reject corrupted layouts (too many rows)
    if (layout.rows > 30) {
      console.warn(`[bridge] Rejecting corrupted layout (${layout.rows} rows), falling back to default`)
      unlinkSync(LAYOUT_FILE)
      return res.status(404).json({ error: 'Corrupted layout removed' })
    }
    res.json({ layout })
  } catch (err) {
    console.error('[bridge] Error reading layout:', err.message)
    res.status(500).json({ error: 'Failed to read layout' })
  }
})

app.post('/api/layout', (req, res) => {
  const { layout } = req.body || {}
  if (!layout || !layout.version || !Array.isArray(layout.tiles)) {
    return res.status(400).json({ error: 'Invalid layout' })
  }

  try {
    if (!existsSync(LAYOUT_DIR)) {
      mkdirSync(LAYOUT_DIR, { recursive: true })
    }
    writeFileSync(LAYOUT_FILE, JSON.stringify(layout, null, 2), 'utf-8')
    console.log(`[bridge] Layout saved (${layout.cols}x${layout.rows}, ${layout.furniture?.length || 0} items)`)
    res.json({ ok: true })
  } catch (err) {
    console.error('[bridge] Error saving layout:', err.message)
    res.status(500).json({ error: 'Failed to save layout' })
  }
})

// ── Static Files ────────────────────────────────────────────────

const distPath = join(__dirname, 'dist')
app.use(express.static(distPath, {
  setHeaders: (res, path) => {
    // Prevent caching of HTML so new JS hashes always load
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    }
  }
}))

// SPA fallback — serve index.html for all non-API routes (Express 5 syntax)
app.get('/{*path}', (_req, res) => {
  res.sendFile(join(distPath, 'index.html'))
})

// ── Start ───────────────────────────────────────────────────────

app.listen(PORT, HOST, () => {
  const agents = AGENT_IDS || discoverAgents()
  console.log(`[server] Pixel Office running at http://${HOST}:${PORT}`)
  console.log(`[server] Session store: ${OPENCLAW_HOME}/agents/`)
  console.log(`[server] Scanning ${agents.length} agents: ${agents.join(', ')}`)
  console.log(`[server] Activity window: ${ACTIVE_MINUTES} minutes`)
})
