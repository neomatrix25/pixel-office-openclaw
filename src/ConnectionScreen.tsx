/**
 * Connection screen — shown when no OpenClaw gateway is configured.
 *
 * Provides input fields for Gateway URL and API Token, a Connect button,
 * and auto-loads saved credentials from localStorage on mount.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { loadConnection } from './localStorage.js'

// ── Types ───────────────────────────────────────────────────────

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error'

export interface ConnectionScreenProps {
  /** Current connection status. */
  status: ConnectionStatus
  /** Error message to display when status is 'error'. */
  errorMessage: string | null
  /** Called when the user clicks Connect. */
  onConnect: (gatewayUrl: string, apiToken: string) => void
  /** Called when saved credentials are found and should auto-connect. */
  onAutoConnect: (gatewayUrl: string, apiToken: string) => void
}

// ── Styles ──────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--pixel-bg)',
  color: 'var(--pixel-text)',
}

const cardStyle: React.CSSProperties = {
  background: 'var(--pixel-bg)',
  border: '2px solid var(--pixel-border)',
  borderRadius: 0,
  padding: '20px 28px',
  boxShadow: 'var(--pixel-shadow)',
  minWidth: 280,
  maxWidth: 420,
  width: '90%',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  boxSizing: 'border-box',
}

const titleStyle: React.CSSProperties = {
  fontSize: '28px',
  color: 'rgba(255, 255, 255, 0.9)',
  textAlign: 'center',
  margin: 0,
  letterSpacing: '1px',
}

const subtitleStyle: React.CSSProperties = {
  fontSize: '20px',
  color: 'rgba(255, 255, 255, 0.5)',
  textAlign: 'center',
  margin: 0,
}

const labelStyle: React.CSSProperties = {
  fontSize: '20px',
  color: 'rgba(255, 255, 255, 0.7)',
  marginBottom: 4,
  display: 'block',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: '20px',
  background: 'rgba(255, 255, 255, 0.06)',
  color: 'rgba(255, 255, 255, 0.9)',
  border: '2px solid var(--pixel-border)',
  borderRadius: 0,
  outline: 'none',
  boxSizing: 'border-box',
}

const inputFocusedBorder = '2px solid var(--pixel-accent)'

const buttonStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 16px',
  fontSize: '24px',
  color: '#fff',
  background: 'var(--pixel-accent)',
  border: '2px solid var(--pixel-accent)',
  borderRadius: 0,
  cursor: 'pointer',
  letterSpacing: '1px',
  boxShadow: 'var(--pixel-shadow)',
}

const buttonDisabledStyle: React.CSSProperties = {
  ...buttonStyle,
  opacity: 0.5,
  cursor: 'default',
}

const statusDotStyle = (color: string): React.CSSProperties => ({
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: color,
  display: 'inline-block',
  marginRight: 8,
  flexShrink: 0,
})

const statusRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  fontSize: '20px',
  padding: '6px 0',
}

const errorStyle: React.CSSProperties = {
  fontSize: '18px',
  color: '#e55',
  background: 'rgba(200, 50, 50, 0.1)',
  border: '1px solid rgba(200, 50, 50, 0.3)',
  padding: '8px 10px',
  wordBreak: 'break-word',
}

// ── Component ───────────────────────────────────────────────────

export function ConnectionScreen({ status, errorMessage, onConnect, onAutoConnect }: ConnectionScreenProps) {
  const [gatewayUrl, setGatewayUrl] = useState('')
  const [apiToken, setApiToken] = useState('')
  const [focusedField, setFocusedField] = useState<string | null>(null)

  // Track whether we've already attempted auto-connect
  const autoConnectAttempted = useRef(false)

  // On mount: load saved credentials and auto-connect
  useEffect(() => {
    if (autoConnectAttempted.current) return
    autoConnectAttempted.current = true

    const saved = loadConnection()
    if (saved) {
      setGatewayUrl(saved.gatewayUrl)
      setApiToken(saved.apiToken)
      onAutoConnect(saved.gatewayUrl, saved.apiToken)
    }
  }, [onAutoConnect])

  const canSubmit = gatewayUrl.trim().length > 0 && apiToken.trim().length > 0 && status !== 'connecting'

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    onConnect(gatewayUrl.trim(), apiToken.trim())
  }, [canSubmit, gatewayUrl, apiToken, onConnect])

  const isConnecting = status === 'connecting'

  return (
    <div style={containerStyle}>
      <form onSubmit={handleSubmit} style={cardStyle}>
        <h1 style={titleStyle}>Pixel Office</h1>
        <p style={subtitleStyle}>Connect to OpenClaw</p>

        {/* Gateway URL */}
        <div>
          <label style={labelStyle} htmlFor="gateway-url">Gateway URL</label>
          <input
            id="gateway-url"
            type="text"
            value={gatewayUrl}
            onChange={(e) => setGatewayUrl(e.target.value)}
            onFocus={() => setFocusedField('url')}
            onBlur={() => setFocusedField(null)}
            placeholder="https://your-gateway.example.com"
            style={{
              ...inputStyle,
              border: focusedField === 'url' ? inputFocusedBorder : inputStyle.border,
            }}
            disabled={isConnecting}
            autoComplete="url"
            spellCheck={false}
          />
        </div>

        {/* API Token */}
        <div>
          <label style={labelStyle} htmlFor="api-token">API Token</label>
          <input
            id="api-token"
            type="password"
            value={apiToken}
            onChange={(e) => setApiToken(e.target.value)}
            onFocus={() => setFocusedField('token')}
            onBlur={() => setFocusedField(null)}
            placeholder="Bearer token"
            style={{
              ...inputStyle,
              border: focusedField === 'token' ? inputFocusedBorder : inputStyle.border,
            }}
            disabled={isConnecting}
            autoComplete="current-password"
          />
        </div>

        {/* Connect button */}
        <button
          type="submit"
          style={canSubmit ? buttonStyle : buttonDisabledStyle}
          disabled={!canSubmit}
        >
          {isConnecting ? 'Connecting...' : 'Connect'}
        </button>

        {/* Status indicator */}
        {status !== 'idle' && (
          <div style={statusRowStyle}>
            {status === 'connecting' && (
              <>
                <span style={statusDotStyle('var(--pixel-accent)')} className="pixel-agents-pulse" />
                <span style={{ color: 'rgba(255, 255, 255, 0.6)' }}>Connecting...</span>
              </>
            )}
            {status === 'connected' && (
              <>
                <span style={statusDotStyle('var(--pixel-green)')} />
                <span style={{ color: 'var(--pixel-green)' }}>Connected</span>
              </>
            )}
            {status === 'error' && (
              <>
                <span style={statusDotStyle('#e55')} />
                <span style={{ color: '#e55' }}>Connection failed</span>
              </>
            )}
          </div>
        )}

        {/* Error details */}
        {status === 'error' && errorMessage && (
          <div style={errorStyle}>
            {errorMessage}
          </div>
        )}

        {/* Mock mode hint */}
        <div style={{ fontSize: '16px', color: 'rgba(255, 255, 255, 0.3)', textAlign: 'center' }}>
          For demo mode, add ?mock=true to the URL
        </div>
      </form>
    </div>
  )
}
