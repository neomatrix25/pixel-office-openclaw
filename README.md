# 🏢 Pixel Office

Watch your [OpenClaw](https://openclaw.ai) AI agents work in a pixel-art virtual office.

Each agent gets an animated character that walks around, sits at desks, and shows real-time status as they execute tasks. Click any agent to chat with them directly.

## Quick Start

```bash
npx pixel-office
```

That's it. Pixel Office auto-detects your local OpenClaw instance and starts a web server at `http://localhost:3002`.

> **No OpenClaw?** Try `npx pixel-office --mock` to see it with simulated agents.

## Features

- 🎮 **Pixel-art office** with animated characters and furniture
- 🔄 **Real-time status** — agents glow green when working, go idle when done
- 💬 **Chat** — click any agent to send them a message
- 🏗️ **Layout editor** — customize the office with desks, plants, bookshelves
- 🎨 **Role-based sprites** — coders, researchers, planners get distinct looks
- ✨ **Matrix animations** — spawn/despawn effects when agents come and go
- 📊 **Activity log** — see what your agents are doing in real-time
- 🖱️ **Interactive** — click agents to freeze them, hover for status tooltips

## Installation

### Global install (recommended)

```bash
npm install -g pixel-office
pixel-office
```

### npx (no install)

```bash
npx pixel-office
```

### From source

```bash
git clone https://github.com/neomatrix25/pixel-office.git
cd pixel-office
npm install
npm run build
npm start
```

## Configuration

Pixel Office auto-detects your OpenClaw setup. Override with CLI flags:

```
pixel-office [options]

Options:
  -p, --port <number>       Port (default: 3002)
  --host <address>          Bind address (default: 127.0.0.1)
  --openclaw-home <path>    OpenClaw home dir (default: ~/.openclaw)
  --gateway-url <url>       Gateway URL (auto-detected)
  --gateway-token <token>   Gateway token (auto-detected)
  --no-chat                 Disable chat endpoint
  --mock                    Demo mode with simulated agents
  --open                    Open browser automatically
```

### Examples

```bash
# Default — auto-detect everything
pixel-office

# Custom port
pixel-office --port 8080

# Expose to your network (default is localhost only)
pixel-office --host 0.0.0.0

# Demo mode — no OpenClaw needed
pixel-office --mock

# Remote OpenClaw instance
pixel-office --gateway-url http://myserver:18789 --gateway-token mytoken
```

### Remote Access

By default, Pixel Office only listens on `127.0.0.1` (localhost). To access from other machines:

```bash
pixel-office --host 0.0.0.0
```

⚠️ **Security**: When exposed to a network, the server can read your agent sessions and send messages. Only expose on trusted networks.

## How It Works

Pixel Office runs a lightweight Express server that:

1. **Reads agent session stores** from `~/.openclaw/agents/*/sessions/sessions.json`
2. **Deduplicates sessions** — one character per agent, using the most recently active session
3. **Serves a React app** that renders a pixel-art office on HTML Canvas
4. **Polls every 3 seconds** for status updates
5. **Proxies chat messages** to agents via the OpenClaw gateway API

No data leaves your machine. The gateway token stays server-side and is never sent to the browser.

## Layout Editor

Click the **Edit** button (bottom toolbar) to customize your office:

- 🎨 Paint floor tiles and walls
- 🪑 Place furniture (desks, chairs, plants, bookshelves)
- ↩️ Undo/redo (Ctrl+Z / Ctrl+Y)
- 🔄 Rotate items (R key)
- 💾 Save your layout

## Requirements

- **Node.js 18+**
- **OpenClaw** running locally (or use `--mock` for demo)

## Tech Stack

- React 19 + TypeScript
- Canvas 2D rendering (no WebGL)
- Vite for builds
- Express 5 for the bridge server
- A* pathfinding for character navigation

## License

MIT — see [LICENSE](LICENSE)

## Credits

Built by [Tridents Lab](https://github.com/neomatrix25) 🔱

Character sprites based on [pixel-agents](https://github.com/pablodelucca/pixel-agents) (MIT).
