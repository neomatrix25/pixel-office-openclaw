/**
 * OpenClaw API adapter — bridges the OpenClaw sessions API to the Pixel Office
 * event bus. This is the ONLY file that knows about the OpenClaw API; everything
 * else consumes events through the shared event bus.
 *
 * Lifecycle:
 *   1. Construct with gatewayUrl + apiToken
 *   2. Call start() — waits for 'webviewReady', then begins polling
 *   3. On each poll, diffs API response against internal state and emits events
 *   4. Call stop() to halt polling and clean up
 */

import { eventBus } from './eventBus.js'
import type { OfficeLayout } from './office/types.js'

// ── OpenClaw API Response Types ─────────────────────────────────
//
// The exact shape of the sessions_list response is not fully documented yet.
// These interfaces define the fields we expect/use, with optional fields
// for anything that might or might not be present.

/** A single session entry returned by the OpenClaw API. */
export interface OpenClawSession {
  /** Unique session identifier — camelCase (OpenClaw native) or snake_case. */
  sessionKey?: string
  session_key?: string

  /** Session kind/type — e.g. "agent", "chat", "task". */
  kind?: string

  /** Agent identifier. Could be string or number. camelCase or snake_case. */
  agentId?: string | number
  agent_id?: string | number

  /** ISO 8601 timestamp or Unix epoch of last activity. camelCase or snake_case. */
  lastActivity?: string | number
  last_activity?: string | number

  /** Display name or label for this session. */
  name?: string

  /** Current status string from the API, if provided. */
  status?: string

  /** Model used in this session. */
  model?: string

  /** ISO 8601 timestamp of session creation. */
  createdAt?: string

  /** Last message content from the session. */
  lastMessage?: string | null

  /** Last messages in the session (structure TBD). */
  last_messages?: unknown[]

  /** Any additional fields the API may include. */
  [key: string]: unknown
}

/** Top-level response from GET /sessions_list. */
export interface OpenClawSessionsResponse {
  /** Array of active sessions. Field name may vary — we also check 'data'. */
  sessions?: OpenClawSession[]

  /** Alternative field name some API versions may use. */
  data?: OpenClawSession[]

  /** Total count, if provided. */
  total?: number

  /** Any additional top-level fields. */
  [key: string]: unknown
}

// ── Internal State ──────────────────────────────────────────────

interface TrackedSession {
  /** The OpenClaw session key (string). */
  sessionKey: string
  /** Numeric ID assigned for the game engine. */
  numericId: number
  /** Last known activity timestamp in milliseconds. */
  lastActivityMs: number
  /** Last emitted status so we only emit on changes. */
  lastStatus: 'active' | 'waiting'
}

// ── Activity Threshold ──────────────────────────────────────────

/** Sessions with activity within this window are considered "active". */
const ACTIVE_THRESHOLD_MS = 60_000

/** Default polling interval in milliseconds. */
const DEFAULT_POLL_INTERVAL_MS = 3_000

/** Max consecutive errors before logging a warning (avoids log spam). */
const MAX_CONSECUTIVE_ERRORS_LOG = 3

// ── Adapter Class ───────────────────────────────────────────────

export class OpenClawAdapter {
  private readonly gatewayUrl: string
  private readonly apiToken: string
  private readonly pollIntervalMs: number

  /** Map from OpenClaw session_key to tracked session state. */
  private sessions = new Map<string, TrackedSession>()

  /** Map from session_key to the raw session data (for name/model/kind lookup). */
  private sessionData = new Map<string, OpenClawSession>()

  /** Incrementing counter for assigning numeric IDs to sessions. */
  private nextId = 1

  /** Polling timer handle. */
  private pollTimer: ReturnType<typeof setInterval> | null = null

  /** Whether the first successful poll has completed. */
  private initialized = false

  /** Whether stop() has been called (prevents races). */
  private stopped = false

  /** Count of consecutive poll errors (for log throttling). */
  private consecutiveErrors = 0

  constructor(gatewayUrl: string, apiToken: string, pollIntervalMs?: number) {
    // Normalize: strip trailing slash from gateway URL
    this.gatewayUrl = gatewayUrl.replace(/\/+$/, '')
    this.apiToken = apiToken
    this.pollIntervalMs = pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  }

  /**
   * Start the adapter. Begins polling immediately — the React event
   * subscribers are already mounted by the time this is called.
   */
  start(): void {
    this.stopped = false
    console.log('[OpenClaw] Adapter starting — beginning poll loop')
    this.beginPolling()
  }

  /** Stop polling and clean up all listeners. */
  stop(): void {
    this.stopped = true
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    this.sessions.clear()
    this.sessionData.clear()
    this.initialized = false
    this.nextId = 1
    this.consecutiveErrors = 0
    console.log('[OpenClaw] Adapter stopped')
  }

  // ── Polling ─────────────────────────────────────────────────

  private beginPolling(): void {
    // Run first poll immediately
    void this.poll()

    this.pollTimer = setInterval(() => {
      void this.poll()
    }, this.pollIntervalMs)
  }

  private async poll(): Promise<void> {
    if (this.stopped) return

    try {
      const sessions = await this.fetchSessions()
      this.consecutiveErrors = 0
      this.processSessions(sessions)
    } catch (err) {
      this.consecutiveErrors++
      if (this.consecutiveErrors <= MAX_CONSECUTIVE_ERRORS_LOG) {
        console.error('[OpenClaw] Poll error:', err)
      }
      if (this.consecutiveErrors === MAX_CONSECUTIVE_ERRORS_LOG) {
        console.warn('[OpenClaw] Suppressing further consecutive error logs')
      }
      // Emit an error event so the UI can display it
      eventBus.emit('openclawError', {
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // ── API Fetch ─────────────────────────────────────────────────

  private async fetchSessions(): Promise<OpenClawSession[]> {
    const url = `${this.gatewayUrl}/sessions_list`

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Accept': 'application/json',
      },
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status}: ${response.statusText}${body ? ` — ${body.slice(0, 200)}` : ''}`)
    }

    const json = await response.json() as OpenClawSessionsResponse

    // The API may return sessions under 'sessions' or 'data' — try both
    const sessions = json.sessions ?? json.data

    if (!Array.isArray(sessions)) {
      // If the response itself is an array (some APIs do this)
      if (Array.isArray(json)) {
        return json as unknown as OpenClawSession[]
      }
      throw new Error('Unexpected response shape: no sessions array found')
    }

    return sessions
  }

  // ── Diffing & Event Emission ──────────────────────────────────

  private processSessions(incoming: OpenClawSession[]): void {
    const now = Date.now()
    const incomingKeys = new Set<string>()

    // Build a quick-lookup map for incoming sessions
    for (const session of incoming) {
      const key = this.getSessionKey(session)
      incomingKeys.add(key)

      const existing = this.sessions.get(key)
      const activityMs = this.parseActivityTimestamp(session.lastActivity ?? session.last_activity, now)
      const status = this.deriveStatus(activityMs, now)

      // Store raw session data for name/model/kind lookup
      this.sessionData.set(key, session)

      if (!existing) {
        // New session
        const numericId = this.nextId++
        const tracked: TrackedSession = {
          sessionKey: key,
          numericId,
          lastActivityMs: activityMs,
          lastStatus: status,
        }
        this.sessions.set(key, tracked)

        // Only emit individual agentCreated if we've already initialized
        // (on first poll, we'll emit existingAgents instead)
        if (this.initialized) {
          eventBus.emit('agentCreated', {
            id: numericId,
            name: session.name || undefined,
            model: session.model || undefined,
            kind: session.kind || undefined,
          })
          eventBus.emit('agentStatus', { id: numericId, status })
          console.log(`[OpenClaw] Agent #${numericId} created (session: ${key})`)
        }
      } else {
        // Existing session — check for status changes
        existing.lastActivityMs = activityMs
        if (status !== existing.lastStatus) {
          existing.lastStatus = status
          eventBus.emit('agentStatus', { id: existing.numericId, status })
        }
      }
    }

    // Detect removed sessions
    for (const [key, tracked] of this.sessions) {
      if (!incomingKeys.has(key)) {
        eventBus.emit('agentClosed', { id: tracked.numericId })
        console.log(`[OpenClaw] Agent #${tracked.numericId} closed (session: ${key})`)
        this.sessions.delete(key)
        this.sessionData.delete(key)
      }
    }

    // Emit metadata updates on every poll so UI has fresh lastActivity / lastMessage
    this.emitMetaUpdate()

    // First successful poll: emit layout + existingAgents
    if (!this.initialized) {
      this.initialized = true
      this.emitInitialState()
    }
  }

  private emitInitialState(): void {
    // Emit existingAgents FIRST — useExtensionMessages buffers these in
    // pendingAgents, which get processed when layoutLoaded fires next.
    const agents: number[] = []
    const agentMeta: Record<number, { palette: number; hueShift: number; seatId: string | null; name?: string; model?: string; kind?: string }> = {}

    for (const tracked of this.sessions.values()) {
      agents.push(tracked.numericId)
      const sessionData = this.getSessionData(tracked.sessionKey)
      agentMeta[tracked.numericId] = {
        palette: 0,
        hueShift: 0,
        seatId: null,
        name: sessionData?.name || undefined,
        model: sessionData?.model || undefined,
        kind: sessionData?.kind || undefined,
      }
    }

    eventBus.emit('existingAgents', { agents, agentMeta })

    // THEN load layout — when layoutLoaded fires, the buffered agents
    // get added to the office state via os.addAgent().
    this.loadDefaultLayout().then(() => {
      // Emit initial statuses after layout is ready
      for (const tracked of this.sessions.values()) {
        eventBus.emit('agentStatus', {
          id: tracked.numericId,
          status: tracked.lastStatus,
        })
      }
      console.log(`[OpenClaw] Initialized with ${agents.length} agent(s)`)
    }).catch((err) => {
      console.error('[OpenClaw] Failed to load default layout:', err)
      eventBus.emit('layoutLoaded', { layout: null })
    })
  }

  private async loadDefaultLayout(): Promise<void> {
    try {
      const resp = await fetch('./assets/default-layout.json')
      const layout = await resp.json() as OfficeLayout
      eventBus.emit('layoutLoaded', { layout })
      console.log('[OpenClaw] Layout loaded')
    } catch (err) {
      console.warn('[OpenClaw] Could not load default-layout.json:', err)
      eventBus.emit('layoutLoaded', { layout: null })
    }
  }

  /** Emit agentMetaUpdate with latest metadata for all tracked sessions. */
  private emitMetaUpdate(): void {
    const meta: Record<number, {
      name?: string
      model?: string
      kind?: string
      lastActivity?: number
      lastMessage?: string | null
      agentId?: string
    }> = {}
    for (const tracked of this.sessions.values()) {
      const raw = this.sessionData.get(tracked.sessionKey)
      if (!raw) continue
      meta[tracked.numericId] = {
        name: raw.name || undefined,
        model: raw.model || undefined,
        kind: raw.kind || undefined,
        lastActivity: tracked.lastActivityMs,
        lastMessage: typeof raw.lastMessage === 'string' ? raw.lastMessage : null,
        agentId: typeof raw.agentId === 'string' ? raw.agentId : (raw.agent_id ? String(raw.agent_id) : undefined),
      }
    }
    eventBus.emit('agentMetaUpdate', { meta })
  }

  // ── Helpers ───────────────────────────────────────────────────

  /** Look up raw session data by session key. */
  private getSessionData(sessionKey: string): OpenClawSession | undefined {
    return this.sessionData.get(sessionKey)
  }

  /**
   * Extract a stable unique key for a session.
   * Uses agentId as the primary key (bridge already dedupes sessions per agent).
   * Falls back to sessionKey only if agentId is missing.
   */
  private getSessionKey(session: OpenClawSession): string {
    // Use agentId as the stable key — the bridge returns one entry per agent
    if (session.agentId !== undefined) return `agent-${session.agentId}`
    if (session.agent_id !== undefined) return `agent-${session.agent_id}`
    // Fallback to session key
    if (session.sessionKey) return String(session.sessionKey)
    if (session.session_key) return String(session.session_key)
    // Last resort: hash some fields together
    return `unknown-${JSON.stringify(session).slice(0, 64)}`
  }

  /**
   * Parse the last_activity field into a millisecond timestamp.
   * Handles ISO 8601 strings, Unix seconds, and Unix milliseconds.
   * Falls back to `fallback` if the field is missing or unparseable.
   */
  private parseActivityTimestamp(value: string | number | undefined, fallback: number): number {
    if (value === undefined || value === null) return fallback

    if (typeof value === 'number') {
      // If the number is small enough, it's probably seconds (< year 2100 in seconds)
      if (value < 4_102_444_800) {
        return value * 1000
      }
      return value
    }

    if (typeof value === 'string') {
      const ms = Date.parse(value)
      if (!isNaN(ms)) return ms
    }

    return fallback
  }

  /**
   * Determine whether a session is active or waiting based on how recently
   * it had activity relative to `now`.
   */
  private deriveStatus(activityMs: number, now: number): 'active' | 'waiting' {
    return (now - activityMs) <= ACTIVE_THRESHOLD_MS ? 'active' : 'waiting'
  }

  // ── Public Getters (for UI status display) ────────────────────

  /** Get the number of currently tracked sessions. */
  get sessionCount(): number {
    return this.sessions.size
  }

  /** Whether at least one successful poll has completed. */
  get isInitialized(): boolean {
    return this.initialized
  }
}
