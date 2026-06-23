# Changelog

All notable changes to Plum Code WebUI will be documented in this file.

## [0.2.0] - 2025-01-04

### Added

#### Mobile Support
- Progressive Web App (PWA) with manifest and service worker
- Mobile bottom navigation with tab switching
- Swipe gesture navigation between panels (Files ↔ Chat ↔ Git)
- Responsive layout for all screen sizes

#### UI Enhancements
- Project/session starring with filter toggle
- File Tree view modes: Simple, Compact (with size), Detailed (with size + date)
- LaTeX/Math rendering with KaTeX (`$...$` inline, `$$...$$` block)
- Interactive choice prompts with clickable buttons
- Starred sessions sorted to top

#### Performance
- Code splitting with React.lazy for all pages
- Manual chunk splitting for vendor libraries (React, Radix, Monaco, etc.)
- Lazy loading reduces initial bundle size significantly

#### Git Enhancements
- Pull and Fetch buttons in Git Panel header
- Remote status display (ahead/behind badges)
- New branch creation dialog
- Branch publish to remote

#### GitHub Integration
- GitHub token management in Settings
- Create new repositories on GitHub
- Clone repositories with repo browser
- Push local repos to GitHub
- Remote management

#### Custom Commands
- Built-in commands: `/help`, `/clear`, `/model`, `/status`, `/cost`, `/compact`
- User commands from `~/.claude/commands/*.md`
- Project commands from `{project}/.claude/commands/*.md`
- Command autocomplete dropdown
- Template variable support (`$ARGUMENTS`, `$1`, `$2`)

#### AI Features
- AI-powered commit message generation using Claude
- Conventional commits format (feat:, fix:, docs:, etc.)

#### Settings
- Tabbed settings interface (General, Appearance, API Keys, Tools, Extensions)
- Gemini API key management
- GitHub token management
- MCP server connection testing

### Changed
- Settings page refactored to use tabs
- Improved TypeScript type safety throughout
- Better error handling in backend routes

### Fixed
- TypeScript errors in various components
- Missing type declarations for markdown plugins
- Unused variable warnings

## [0.1.0] - 2025-01-03

### Added
- Initial release
- Real-time streaming chat via WebSocket
- Multi-session management with history
- File Tree Browser with lazy loading
- Monaco Code Editor with syntax highlighting
- Git Panel (staging, commits, diffs, history)
- Project Auto-Discovery from ~/.claude/projects
- PTY Reconnect with 30-minute buffer
- Image attachments and Gemini image generation
- Todo tracking from Claude's TodoWrite tool
- Token usage and cost tracking
- MCP Server configuration

### Technical
- Express + Socket.IO backend
- React 18 + Vite frontend
- SQLite database with better-sqlite3
- node-pty for Claude CLI process management
- TypeScript throughout with shared types package
