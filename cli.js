#!/usr/bin/env node
/**
 * Pixel Office CLI — visualize OpenClaw agents in a pixel-art office.
 *
 * Usage:
 *   pixel-office [options]
 *
 * Options:
 *   -p, --port <number>       Port to listen on (default: 3002)
 *   -h, --host <address>      Bind address (default: 127.0.0.1)
 *   --openclaw-home <path>    OpenClaw home directory (default: ~/.openclaw)
 *   --gateway-url <url>       Gateway URL (auto-detected from config)
 *   --gateway-token <token>   Gateway token (auto-detected from config)
 *   --no-chat                 Disable chat send endpoint
 *   --mock                    Start with mock mode (no OpenClaw needed)
 *   --open                    Open browser after starting
 *   -v, --version             Show version
 *   --help                    Show this help
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { execSync } from 'child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// ── Argument Parsing ────────────────────────────────────────────

const args = process.argv.slice(2)

function getArg(flags, defaultValue = undefined) {
  for (let i = 0; i < args.length; i++) {
    if (flags.includes(args[i]) && i + 1 < args.length) {
      return args[i + 1]
    }
  }
  return defaultValue
}

function hasFlag(flags) {
  return args.some(a => flags.includes(a))
}

if (hasFlag(['--help'])) {
  console.log(`
  Pixel Office — Watch your OpenClaw agents work in a pixel-art office 🦞

  Usage: pixel-office [options]

  Options:
    -p, --port <number>       Port to listen on (default: 3002)
    --host <address>          Bind address (default: 127.0.0.1)
    --openclaw-home <path>    OpenClaw home dir (default: ~/.openclaw)
    --gateway-url <url>       Gateway URL (auto-detected)
    --gateway-token <token>   Gateway token (auto-detected)
    --no-chat                 Disable chat/send endpoint
    --mock                    Mock mode (no OpenClaw needed)
    --no-open                 Don't open browser after starting
    -v, --version             Show version
    --help                    Show this help

  Examples:
    pixel-office                        # Auto-detect local OpenClaw
    pixel-office --port 8080            # Custom port
    pixel-office --host 0.0.0.0         # Expose to network
    pixel-office --mock                 # Demo without OpenClaw
  `)
  process.exit(0)
}

if (hasFlag(['-v', '--version'])) {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'))
    console.log(`pixel-office v${pkg.version}`)
  } catch {
    console.log('pixel-office (unknown version)')
  }
  process.exit(0)
}

// ── Configuration ───────────────────────────────────────────────

const PORT = parseInt(getArg(['-p', '--port'], '3002'), 10)
const HOST = getArg(['--host'], '127.0.0.1')
const OPENCLAW_HOME = getArg(['--openclaw-home'], join(homedir(), '.openclaw'))
const CHAT_DISABLED = hasFlag(['--no-chat'])
const MOCK_MODE = hasFlag(['--mock'])
const OPEN_BROWSER = !hasFlag(['--no-open'])

// ── Auto-detect Gateway ─────────────────────────────────────────

function autoDetectGateway() {
  const configPath = join(OPENCLAW_HOME, 'openclaw.json')
  if (!existsSync(configPath)) return { url: null, token: null }

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'))
    const gw = config.gateway || {}
    const port = gw.port || 18789
    const token = gw.auth?.token || null
    const url = `http://127.0.0.1:${port}`
    return { url, token }
  } catch (err) {
    console.warn('[pixel-office] Could not read OpenClaw config:', err.message)
    return { url: null, token: null }
  }
}

let GATEWAY_URL = getArg(['--gateway-url'])
let GATEWAY_TOKEN = getArg(['--gateway-token'])

if (!GATEWAY_URL || !GATEWAY_TOKEN) {
  const detected = autoDetectGateway()
  if (!GATEWAY_URL) GATEWAY_URL = detected.url
  if (!GATEWAY_TOKEN) GATEWAY_TOKEN = detected.token
}

// ── Export config and start server ──────────────────────────────

process.env.PORT = String(PORT)
process.env.PIXEL_OFFICE_HOST = HOST
process.env.OPENCLAW_HOME = OPENCLAW_HOME
if (GATEWAY_URL) process.env.OPENCLAW_GATEWAY_URL = GATEWAY_URL
if (GATEWAY_TOKEN) process.env.OPENCLAW_GATEWAY_TOKEN = GATEWAY_TOKEN
if (CHAT_DISABLED) process.env.PIXEL_OFFICE_NO_CHAT = '1'

// Print startup banner
console.log('')
console.log('  🏢 Pixel Office')
console.log('  ────────────────────────────────')
if (MOCK_MODE) {
  console.log('  Mode:     Mock (no OpenClaw needed)')
} else {
  console.log(`  OpenClaw: ${OPENCLAW_HOME}`)
  console.log(`  Gateway:  ${GATEWAY_URL || '(not detected)'}`)
  console.log(`  Token:    ${GATEWAY_TOKEN ? '(configured)' : '(not detected)'}`)
}
console.log(`  Server:   http://${HOST}:${PORT}`)
console.log(`  Chat:     ${CHAT_DISABLED ? 'disabled' : 'enabled'}`)
console.log('  ────────────────────────────────')
console.log('')

if (!MOCK_MODE && !GATEWAY_URL) {
  console.warn('  ⚠️  No OpenClaw instance detected.')
  console.warn('     Make sure OpenClaw is running, or pass --gateway-url and --gateway-token.')
  console.warn('     Starting anyway — you can connect via the UI.\n')
}

// Open browser after a short delay
if (OPEN_BROWSER) {
  setTimeout(() => {
    const url = `http://localhost:${PORT}`
    try {
      const platform = process.platform
      if (platform === 'darwin') execSync(`open ${url}`)
      else if (platform === 'win32') execSync(`start ${url}`)
      else execSync(`xdg-open ${url} 2>/dev/null || sensible-browser ${url} 2>/dev/null`)
    } catch { /* ignore */ }
  }, 1000)
}

// Import and start the server
import('./server.js')
