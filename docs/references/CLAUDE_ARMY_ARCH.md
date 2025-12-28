# Claude Army - Architecture Documentation

> symlink: `./claude-army`

A Telegram-integrated daemon for managing multiple concurrent Claude Code instances. Currently in BETA status, written in Python 3.11+.

## What It Does

- Manages an "army" of Claude subprocess instances working on separate tasks
- Routes permission prompts to Telegram for remote approval/denial
- Uses an "Operator" Claude instance to orchestrate task management via natural language
- Supports both long-lived git worktree-based tasks and ephemeral session-based tasks

## Architecture

```
┌──────────────────────────────────────┐
│     Telegram Forum Group (UI)        │
│  ┌─────────────┬─────────────────┐   │
│  │ General     │ Task Topics     │   │
│  │ (Operator)  │ (Workers)       │   │
│  └─────────────┴─────────────────┘   │
└──────────────────┬───────────────────┘
                   │
          ┌────────▼────────┐
          │     DAEMON      │
          ├─────────────────┤
          │ ProcessManager  │ → Spawns/monitors Claude processes
          │ PermissionMgr   │ → Handles permission requests
          │ TelegramAdapter │ → Polls updates, sends messages
          │ CommandHandler  │ → Routes bot commands
          └─────────────────┘
                   │
     ┌─────────────┼─────────────┐
     ▼             ▼             ▼
 Operator      Worker         Permission
 Claude        Claudes        Hook Script
```

## Key Components

| File | Purpose |
|------|---------|
| `telegram-daemon.py` | Entry point - signal handling, starts daemon |
| `daemon_core.py` | Main orchestrator - coordinates all components |
| `process_manager.py` | Manages Claude subprocess pool |
| `claude_process.py` | Wraps Claude CLI with stream-json I/O |
| `permission_server.py` | HTTP server (localhost:9000) for permission brokering |
| `permission_hook.py` | Hook script called by Claude CLI for tool approvals |
| `telegram_adapter.py` | Telegram Bot API integration |
| `bot_commands.py` | Command handlers (/spawn, /cleanup, /status, etc.) |
| `session_operator.py` | Manages the Operator Claude subprocess |
| `session_worker.py` | Manages Worker Claude subprocesses |
| `registry.py` | Task persistence and configuration |

## Component Details

### telegram-daemon.py (Entry Point)
Thin wrapper that registers signal handlers (SIGINT/SIGTERM) and calls `daemon_core.main()`.

### daemon_core.py (Main Orchestrator)
Coordinates all components:
- Ensures singleton instance via PID file (`/tmp/claude-army-daemon.pid`)
- Loads Telegram credentials from `~/telegram.json`
- Creates and manages ProcessManager, PermissionManager, TelegramAdapter, CommandHandler
- Runs the main async event loop

### process_manager.py (Process Pool)
- Manages multiple ClaudeProcess instances
- Routes messages between processes
- Multiplexes events from all subprocesses
- Handles crash detection and restart

### claude_process.py (Subprocess Wrapper)
- Wraps Claude CLI with stream-json I/O
- Handles startup/resume with session IDs
- Manages subprocess lifecycle and communication

### permission_server.py (Permission Broker)
- HTTP server running on localhost:9000
- Manages pending permission requests
- Bridges permission hooks to Telegram via async notifications

### permission_hook.py (Hook Script)
- Called by Claude CLI when tools are requested
- POSTs to permission server
- Returns allow/deny decision back to Claude

### telegram_adapter.py (Telegram Frontend)
- Implements FrontendAdapter interface
- Polls Telegram for updates
- Sends messages to topics
- Manages inline keyboards and callback buttons

### bot_commands.py (Command Handlers)
Parses and routes bot commands:
- `/spawn` - Create new task
- `/cleanup` - Remove task
- `/status` - Show daemon status
- `/todo` - Manage todo items
- And more...

### session_operator.py (Operator Management)
- Manages the Operator Claude subprocess
- Routes messages to/from operator
- Operator orchestrates task creation and management

### session_worker.py (Worker Management)
- Manages Worker Claude subprocesses
- Handles task spawning (worktree/session modes)
- Cleanup and setup hooks
- Todo queue management

### registry.py (State Persistence)
- Task registry cache
- Configuration management
- Marker file I/O
- Auto-reload on file changes

## Key Flows

### Permission Flow
```
1. Worker Claude calls a tool (e.g., bash)
2. Claude CLI invokes permission_hook.py
3. Hook POSTs to http://localhost:9000/permission/request
4. PermissionManager queues notification
5. Daemon sends Telegram message with Allow/Deny buttons
6. User clicks button
7. Callback routed to daemon
8. PermissionManager returns decision
9. Hook returns decision to Claude CLI
10. Claude continues or rejects tool call
```

### Task Spawning Flow
```
1. User sends "/spawn fix login bug" in General topic
2. TelegramAdapter polls and finds message
3. CommandHandler.handle_spawn() routes to Operator Claude
4. Operator generates: create worktree, create topic, write marker, spawn worker
5. Operator calls tools (permission prompts sent to Telegram)
6. User approves
7. Worker Claude starts in new topic
8. Worker begins work on assigned task
```

### Crash Recovery Flow
```
1. User sends /rebuild-registry
2. rebuild_registry_from_markers() scans for .claude/army.json files
3. For each marker, reads task metadata
4. Rebuilds registry.json with complete task list
5. All tasks recovered and available
```

## Technologies

| Technology | Purpose |
|-----------|---------|
| Python 3.11+ | Language with modern async/await, type hints |
| asyncio | Main event loop, subprocess management |
| Claude Code CLI | Core service via subprocess with stream-json I/O |
| Telegram Bot API | Frontend - forum groups, topics, inline keyboards |
| requests | HTTP for permission hooks and Telegram API |
| threading | Permission server runs in daemon thread |
| pytest | Testing framework with async support |

## Configuration Files

| File | Purpose |
|------|---------|
| `~/telegram.json` | Bot token and chat ID (user-provided) |
| `operator/config.json` | Group ID, topic mappings, telegram_offset |
| `operator/registry.json` | Task registry cache |
| `.claude/army.json` | Marker files in task directories |

## Design Guarantees

### 100% Resource Correctness
Every resource created (topics, subprocesses, marker files) is tracked and cleaned up properly.

### Crash-Safe Markers
`.claude/army.json` marker files are the source of truth. The registry is a rebuildable cache that can be restored via `/rebuild-registry`.

### Pending Topic Pattern
Handles daemon crashes during topic creation via pending markers and retry logic.

### Auto-Allow Safe Tools
These tools are auto-approved without Telegram prompts:
- Read
- Grep
- Glob
- TodoRead
- TodoWrite

### Session Resurrection
When a worker crashes, ProcessManager resurrects it via `claude --resume <session_id>`.

### Two Task Types

| Type | Description | Cleanup Behavior |
|------|-------------|------------------|
| Worktree | Long-lived, uses git worktree | Deletes the git worktree |
| Session | Ephemeral | Removes marker but preserves directory |

## Installation

```bash
./install.sh   # Install dependencies, configure Telegram credentials
./uninstall.sh # Remove daemon and configuration
```

## Running

```bash
./telegram-daemon.py
```

The daemon ensures only one instance runs at a time via a PID file lock.
