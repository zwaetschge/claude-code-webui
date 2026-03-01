# Plum Code WebUI

A powerful web-based interface for Claude Code, Codex, Gemini, and GLM CLIs with multi-provider support, real-time streaming, tool execution tracking, orchestration, and self-rebuild capabilities.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18.3-blue.svg)](https://react.dev/)
[![Docker Hub](https://img.shields.io/docker/v/valentin2177/claude-code-webui?label=Docker%20Hub&logo=docker)](https://hub.docker.com/r/valentin2177/claude-code-webui)

# Screenshots

## Desktop:

<img width="1874" height="856" alt="Bildschirmfoto_20260104_140400" src="https://github.com/user-attachments/assets/f7ebf624-39df-44ad-b0bc-9d685ea43f49" />
<img width="1874" height="859" alt="Bildschirmfoto_20260104_140428" src="https://github.com/user-attachments/assets/b58f2808-4899-4884-9083-be48a31ef473" />
<img width="1863" height="860" alt="Bildschirmfoto_20260104_140510" src="https://github.com/user-attachments/assets/bb334cd5-de76-47bd-b0de-0f6c5e9cdbf9" />

## Mobile:

<img width="487" height="737" alt="Bildschirmfoto_20260104_141306" src="https://github.com/user-attachments/assets/91829fc9-af83-461b-bd4e-11271e28033e" />
<img width="476" height="738" alt="Bildschirmfoto_20260104_141321" src="https://github.com/user-attachments/assets/f5897703-c0e9-48ff-9150-d4018c715553" />
<img width="476" height="738" alt="Bildschirmfoto_20260104_141404" src="https://github.com/user-attachments/assets/ddc26671-8e94-4f96-b307-56969f180801" />
<img width="476" height="738" alt="Bildschirmfoto_20260104_141424" src="https://github.com/user-attachments/assets/6b3331c8-4ecc-428d-a749-5fff0c9613c4" />


## Features

### Chat Interface
- Real-time streaming responses via WebSocket
- Multi-session management with history
- Image attachments and Gemini image generation
- LaTeX/Math rendering with KaTeX
- Interactive choice prompts
- Context & token popover with live progress bar
- Todo tracking from Claude's TodoWrite tool

### DevTools Integration
- **Context Popover**: Inline progress bar showing context window usage (green→yellow→red), click to see full token breakdown (input/output/cache read/cache write), cost, and model
- **Tool-Log Panel**: Full tool execution timeline with filter buttons (All, Read, Write, Bash, Web, Agent), duration tracking per tool, live timers for running tools, expandable input/output details
- **Compaction Boundary Cards**: Visual separators in chat when context is compacted, with expandable summary text

### Multi-Provider Support
- **Claude** (Anthropic) — primary provider
- **Codex** (OpenAI) — alternative provider
- **GLM** (Z.AI) — Chinese market provider
- Per-session provider selection
- Independent CLI instances per provider

### Orchestration
- Multi-provider task delegation
- Parallel worker execution
- Task routing and progress tracking
- Worker output streaming

### Ralph (Autonomous Loop)
- Iterative autonomous task execution
- Plan generation and progress tracking
- Multi-iteration workflows with checkpoints

### File Management
- File Tree Browser with lazy loading and git status
- Monaco Code Editor with syntax highlighting
- Create, edit, delete, and rename files
- Three view modes: Simple, Compact, Detailed

### Git Integration
- Full Git Panel (staging, commits, diffs, history)
- Visual branch management (create, publish, delete)
- Commit history with diff viewer
- AI-powered commit message generation
- Pull/Fetch with remote status (ahead/behind)

### GitHub Integration
- Create new repositories
- Clone repositories (with repo browser)
- Push to GitHub with remote management
- Token-authenticated operations

### Custom Commands
- Built-in commands: `/help`, `/clear`, `/model`, `/status`, `/cost`, `/compact`
- User commands from `~/.claude/commands/*.md`
- Project commands from `{project}/.claude/commands/*.md`
- Autocomplete dropdown when typing `/`

### Project Management
- Project Auto-Discovery from `~/.claude/projects`
- Working directory navigation
- Session starring and filtering
- PTY Reconnect with 30-minute buffer

### Self-Rebuild
- Container can rebuild and redeploy itself
- Rebuild Robot for external container management
- Status tracking and reporting

### Watchdog & Monitoring
- Session health monitoring
- Telegram bot notifications
- Configurable alert thresholds

### Mobile Support
- Progressive Web App (PWA)
- Bottom tab navigation
- Swipe gestures for panel navigation
- Responsive design

### Settings
- Tabbed settings interface
- Theme configuration
- API key management (Gemini, GitHub)
- MCP Server management with connection testing
- Memory viewer for session context

## Tech Stack

### Backend
- **Express.js** - HTTP server
- **Socket.IO** - Real-time communication
- **SQLite** (better-sqlite3) - Database
- **node-pty** - Claude CLI process management
- **simple-git** - Git operations
- **@octokit/rest** - GitHub API

### Frontend
- **React 18** - UI framework
- **Vite** - Build tool with code splitting
- **Radix UI** - Accessible components
- **Tailwind CSS** - Styling
- **Zustand** - State management
- **TanStack Query** - Data fetching
- **Monaco Editor** - Code editing
- **KaTeX** - Math rendering

### Shared
- **TypeScript** - Type safety across all packages

## Installation

### Quick Start with Docker Hub (Recommended)

The easiest way to run Claude Code WebUI is using the pre-built Docker image:

```bash
# Create a directory for docker-compose
mkdir claude-code-webui && cd claude-code-webui

# Download docker-compose file
curl -O https://raw.githubusercontent.com/zwaetschge/claude-code-webui/main/docker-compose.hub.yml

# Create .env file with your secrets
cat > .env << 'EOF'
SESSION_SECRET=your-session-secret-at-least-32-characters-long
JWT_SECRET=your-jwt-secret-at-least-32-characters-long
EOF

# Start the container
docker-compose -f docker-compose.hub.yml up -d
```

Access the WebUI at http://localhost:5174

**Requirements:**
- Docker and Docker Compose
- Claude Code CLI configured on your host (`~/.claude` directory)

### Prerequisites (for development)
- Node.js 20+
- pnpm 9+
- Claude Code CLI installed and configured

### Development Setup

```bash
# Clone the repository
git clone https://github.com/zwaetschge/plum-code-webui.git
cd claude-code-webui

# Install dependencies
pnpm install

# Start development servers
pnpm dev

# Or use the helper script (generates temporary secrets)
./scripts/start-webui.sh
```

- Backend: http://localhost:3006
- Frontend: http://localhost:5173

### Production Build

```bash
# Build all packages
pnpm build

# Start production server
pnpm start
```

### Docker Deployment

```bash
# Option 1: Pull from Docker Hub (recommended)
docker-compose -f docker-compose.hub.yml up -d

# Option 2: Build locally
docker-compose up -d --build
```

### Unraid persistence note

On Unraid, avoid mounting configs from `/root` (tmpfs on reboot). Use the appdata share instead, e.g.:

```
/mnt/user/appdata/claude-code-webui/config/claude  -> /home/node/.claude
/mnt/user/appdata/claude-code-webui/config/codex   -> /home/node/.codex
/mnt/user/appdata/claude-code-webui/config/gemini  -> /home/node/.gemini
/mnt/user/appdata/claude-code-webui/config/glm     -> /home/node/.glm
/mnt/user/appdata/claude-code-webui/config/npm-global -> /home/node/.npm-global
/mnt/user/appdata/claude-code-webui/config/npm-glm -> /home/node/.npm-glm
```

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SESSION_SECRET` | Express session secret | Yes |
| `JWT_SECRET` | JWT signing key | Yes |
| `FRONTEND_URL` | CORS origin (default: http://localhost:5173) | No |
| `PORT` | Backend port (default: 3006) | No |
| `CLI_AUTO_UPDATE` | Auto-update CLI tools on startup (true/false) | No |
| `CLI_AUTO_UPDATE_INTERVAL_HOURS` | Repeat auto-update every N hours (0 disables) | No |
| `CLI_AUTO_UPDATE_PROVIDERS` | Comma list of CLI providers to update | No |
| `WEBUI_GLM_CONFIG_HOME` | Config home for GLM Claude Code (default: ~/.glm) | No |
| `CLI_PROVIDER_GLM_PREFIX` | npm prefix for GLM Claude Code CLI (default: ~/.npm-glm) | No |
| `CLI_PROVIDER_GLM_COMMAND` | Path to GLM Claude Code binary | No |
| `CLI_PROVIDER_GLM_CREDENTIALS_PATH` | Credentials path for GLM availability checks | No |

### Claude CLI Integration

The backend communicates with Claude CLI in `stream-json` mode:

```bash
claude --print --verbose --output-format stream-json --input-format stream-json \
       --include-partial-messages --dangerously-skip-permissions
```

GLM (Z.AI) sessions run a separate Claude Code CLI instance with its own config home (`~/.glm` by default). See the `CLI_PROVIDER_GLM_*` and `WEBUI_GLM_CONFIG_HOME` environment variables above.

## Project Structure

```
packages/
├── backend/              # Express + Socket.IO server
│   ├── src/
│   │   ├── routes/       # REST API endpoints
│   │   ├── services/     # Business logic
│   │   │   ├── claude/   # Claude CLI process management
│   │   │   ├── orchestration/  # Multi-provider orchestration
│   │   │   ├── ralph/    # Autonomous loop engine
│   │   │   ├── watchdog/ # Health monitoring & alerts
│   │   │   └── gemini/   # Gemini image generation
│   │   ├── websocket/    # Socket.IO handlers
│   │   └── db/           # SQLite database
├── frontend/             # React + Vite application
│   ├── src/
│   │   ├── components/
│   │   │   ├── chat/     # Chat messages, tools, compaction cards
│   │   │   ├── session/  # Controls, tool log, watchdog
│   │   │   ├── orchestration/  # Multi-provider UI
│   │   │   ├── ralph/    # Autonomous loop UI
│   │   │   └── ui/       # Shared UI primitives
│   │   ├── pages/
│   │   ├── stores/       # Zustand stores
│   │   ├── services/     # API & Socket clients
│   │   └── hooks/        # Custom React hooks
├── shared/               # Shared TypeScript types
└── scripts/              # Rebuild robot & helper scripts
```

## API Endpoints

### Sessions
- `GET /api/sessions` - List all sessions
- `POST /api/sessions` - Create new session
- `GET /api/sessions/:id` - Get session details
- `PATCH /api/sessions/:id/star` - Toggle star

### Files
- `GET /api/files?path=` - List directory contents
- `GET /api/files/content?path=` - Read file content
- `POST /api/files` - Create file
- `PUT /api/files` - Update file
- `DELETE /api/files?path=` - Delete file

### Git
- `GET /api/git/status?path=` - Get git status
- `POST /api/git/stage` - Stage files
- `POST /api/git/commit` - Create commit
- `POST /api/git/pull` - Pull from remote
- `POST /api/git/push` - Push to remote
- `POST /api/git/branch/create` - Create branch
- `POST /api/git/generate-commit-message` - AI commit message

### GitHub
- `GET /api/github/repos` - List user repos
- `POST /api/github/repos` - Create repo
- `POST /api/github/clone` - Clone repo
- `POST /api/github/push` - Push to GitHub

### Commands
- `GET /api/commands` - List available commands
- `POST /api/commands/execute` - Execute command

## WebSocket Events

### Client → Server
- `session:send` - Send message to Claude
- `session:subscribe` - Subscribe to session updates
- `session:interrupt` - Interrupt Claude (Ctrl+C)
- `session:reconnect` - Reconnect with buffer replay

### Server → Client
- `session:output` - Streaming text
- `session:message` - Complete message
- `session:thinking` - Thinking indicator
- `session:tool_use` - Tool usage events (with duration tracking)
- `session:todos` - Todo list updates
- `session:usage` - Token usage data
- `session:compact` - Context compaction events
- `session:agent` - Subagent lifecycle events
- `session:mode` - Permission mode changes
- `orchestration:*` - Orchestration state, tasks, workers
- `ralph:*` - Ralph autonomous loop events

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `pnpm typecheck` and `pnpm lint`
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- [Anthropic](https://anthropic.com) for Claude
- [Claude Code CLI](https://claude.com/claude-code) for the underlying tool
