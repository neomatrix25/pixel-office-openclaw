/**
 * Mock data provider — simulates agent events for standalone testing.
 *
 * On startup:
 *   1. Fetches and emits layoutLoaded with the default layout JSON
 *   2. Emits agentCreated for 3 mock agents
 *
 * Periodically:
 *   - Toggles agent states between active/waiting
 *   - Emits agentToolStart / agentToolDone cycles
 *
 * This proves the pixel office game engine works standalone without VS Code
 * or any real backend.
 */

import { eventBus } from './eventBus.js'
import type { OfficeLayout } from './office/types.js'

/** Tool status strings matching what the real extension sends */
const TOOL_STATUSES = [
  'Reading file: src/index.ts',
  'Writing file: src/app.tsx',
  'Editing file: src/utils.ts',
  'Running command: npm test',
  'Searching for: useEffect',
  'Globbing: **/*.tsx',
  'Fetching: https://api.example.com/data',
]

let toolIdCounter = 0

function nextToolId(): string {
  return `mock-tool-${++toolIdCounter}`
}

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

/**
 * Start the mock data provider. Call once on app startup.
 * Returns a cleanup function that stops all timers.
 */
export function startMockProvider(): () => void {
  const timers: ReturnType<typeof setTimeout>[] = []
  const intervals: ReturnType<typeof setInterval>[] = []

  // Start immediately — React event subscribers are already mounted
  // by the time the dynamic import resolves in main.tsx.
  boot()

  function boot(): void {
    // Step 1: Load the default layout
    loadDefaultLayout().then(() => {
      // Step 2: Create mock agents after a short delay
      const t1 = setTimeout(() => createMockAgents(), 400)
      timers.push(t1)

      // Step 3: Start periodic activity simulation after agents are created
      const t2 = setTimeout(() => startActivitySimulation(), 1500)
      timers.push(t2)
    })
  }

  async function loadDefaultLayout(): Promise<void> {
    try {
      const resp = await fetch('./assets/default-layout.json')
      const layout = await resp.json() as OfficeLayout
      eventBus.emit('layoutLoaded', { layout })
      console.log('[MockProvider] Layout loaded')
    } catch (err) {
      console.warn('[MockProvider] Could not load default-layout.json, using null layout:', err)
      eventBus.emit('layoutLoaded', { layout: null })
    }
  }

  function createMockAgents(): void {
    const mockAgents = [
      { id: 1, name: 'Coder', model: 'claude-opus-4', kind: 'coder' },
      { id: 2, name: 'Researcher', model: 'gpt-4o', kind: 'researcher' },
      { id: 3, name: 'Planner', model: 'claude-sonnet', kind: 'agent' },
    ]
    for (const agent of mockAgents) {
      eventBus.emit('agentCreated', { id: agent.id, name: agent.name, model: agent.model, kind: agent.kind })
      console.log(`[MockProvider] Agent #${agent.id} (${agent.name}) created`)
    }

    // Set initial statuses — agent 1 active, agent 2 active, agent 3 waiting
    eventBus.emit('agentStatus', { id: 1, status: 'active' })
    eventBus.emit('agentStatus', { id: 2, status: 'active' })
    eventBus.emit('agentStatus', { id: 3, status: 'waiting' })
  }

  function startActivitySimulation(): void {
    const agentIds = [1, 2, 3]

    // Each agent runs through tool cycles independently
    for (const id of agentIds) {
      runAgentCycle(id)
    }

    // Periodically toggle an agent between active/waiting
    const statusInterval = setInterval(() => {
      const id = randomItem(agentIds)
      const status = Math.random() > 0.3 ? 'active' : 'waiting'
      eventBus.emit('agentStatus', { id, status })
    }, 8000)
    intervals.push(statusInterval)
  }

  function runAgentCycle(agentId: number): void {
    // Random delay before starting a tool use (2-6 seconds)
    const delay = 2000 + Math.random() * 4000
    const t = setTimeout(() => {
      const toolId = nextToolId()
      const status = randomItem(TOOL_STATUSES)

      // Start tool
      eventBus.emit('agentToolStart', { id: agentId, toolId, status })
      eventBus.emit('agentStatus', { id: agentId, status: 'active' })

      // Complete tool after 1.5-4 seconds
      const doneDuration = 1500 + Math.random() * 2500
      const t2 = setTimeout(() => {
        eventBus.emit('agentToolDone', { id: agentId, toolId })

        // Clear tools after a beat, then start next cycle
        const t3 = setTimeout(() => {
          eventBus.emit('agentToolsClear', { id: agentId })
          // Continue the cycle
          runAgentCycle(agentId)
        }, 500 + Math.random() * 1000)
        timers.push(t3)
      }, doneDuration)
      timers.push(t2)
    }, delay)
    timers.push(t)
  }

  // Cleanup function
  return () => {
    for (const t of timers) clearTimeout(t)
    for (const i of intervals) clearInterval(i)
  }
}
