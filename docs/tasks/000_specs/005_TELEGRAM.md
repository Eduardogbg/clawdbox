# Telegram Bot Integration

> Forum-based UI for controlling Claude agents

## Overview

Clawdbox uses a Telegram forum group as its primary interface, following the pattern established by claude-army:

- **General topic**: Chat with the Operator agent for task management
- **Task topics**: Each spawned task gets its own topic for isolation
- **Inline keyboards**: Permission approval/denial buttons

## Forum Group Structure

```
Clawdbox Forum Group
├── General (Topic)
│   └── Operator Claude
│       - Task creation commands
│       - Status queries
│       - General orchestration
├── Task: fix-login-bug (Topic)
│   └── Worker Claude #1
│       - Task execution logs
│       - Permission requests
│       - Results
├── Task: add-dark-mode (Topic)
│   └── Worker Claude #2
│       - ...
└── Task: refactor-api (Topic)
    └── Worker Claude #3
        - ...
```

## Bot Setup

### 1. Create Bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow prompts
3. Save the bot token
4. Enable inline mode: `/setinline`
5. Enable groups: `/setjoingroups`

### 2. Create Forum Group

1. Create a new Telegram group
2. Convert to supergroup (group settings)
3. Enable topics (group settings → Topics)
4. Add your bot as admin with permissions:
   - Post messages
   - Edit messages
   - Delete messages
   - Manage topics

### 3. Get IDs

```bash
# Get chat ID and topic IDs
curl "https://api.telegram.org/bot<TOKEN>/getUpdates"
```

## Webhook Handler

```typescript
// src/worker/telegram.ts
import { Effect } from "effect";

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: CallbackQuery;
}

interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  message_thread_id?: number; // Topic ID
  text?: string;
  from?: { id: number; username?: string };
}

interface CallbackQuery {
  id: string;
  data?: string;
  message?: TelegramMessage;
}

export const handleWebhook = (update: TelegramUpdate, env: Env) =>
  Effect.gen(function* () {
    if (update.callback_query) {
      // Handle button clicks (permissions)
      yield* handleCallback(update.callback_query, env);
    } else if (update.message?.text) {
      // Handle text messages
      yield* handleMessage(update.message, env);
    }
  });

const handleMessage = (message: TelegramMessage, env: Env) =>
  Effect.gen(function* () {
    const text = message.text || "";
    const topicId = message.message_thread_id;
    const chatId = message.chat.id;

    // Route to Operator DO
    const operatorId = env.OPERATOR.idFromName("main");
    const operator = env.OPERATOR.get(operatorId);

    if (text.startsWith("/")) {
      // Command
      yield* Effect.tryPromise(() =>
        operator.fetch(new Request("http://internal/command", {
          method: "POST",
          body: JSON.stringify({ command: text, topicId, chatId, messageId: message.message_id }),
        }))
      );
    } else if (topicId) {
      // Message to a task topic - forward to worker
      yield* Effect.tryPromise(() =>
        operator.fetch(new Request("http://internal/message", {
          method: "POST",
          body: JSON.stringify({ text, topicId, chatId }),
        }))
      );
    } else {
      // General topic - chat with Operator
      yield* Effect.tryPromise(() =>
        operator.fetch(new Request("http://internal/operator-chat", {
          method: "POST",
          body: JSON.stringify({ text, chatId }),
        }))
      );
    }
  });
```

## Bot Commands

### `/spawn <task description>`

Create a new task with a dedicated topic.

```
User: /spawn fix the login bug in auth.ts

Bot: 🚀 Creating task: "fix the login bug in auth.ts"
     📁 Repository: user/repo (main branch)
     🔗 Topic: Task: fix-login-bug

[Bot creates topic and spawns worker]
```

**Implementation**:
```typescript
const handleSpawn = (args: string, chatId: number) =>
  Effect.gen(function* () {
    // Create topic
    const topic = yield* createTopic(chatId, `Task: ${slugify(args)}`);

    // Create task record
    const task = yield* createTask({
      prompt: args,
      topicId: topic.message_thread_id,
      status: "pending",
    });

    // Spawn agent container
    yield* spawnAgent(task.id);

    // Notify user
    yield* sendMessage(chatId, `🚀 Task created in topic: ${topic.name}`);
  });
```

### `/status`

Show status of all tasks.

```
User: /status

Bot: 📊 Clawdbox Status

     Active Tasks:
     • fix-login-bug (active) - Running for 5m
     • add-dark-mode (pending) - Queued

     Completed: 12
     Failed: 1
```

### `/cleanup <task-id>`

Remove a task and its topic.

```
User: /cleanup fix-login-bug

Bot: 🗑️ Cleaning up task: fix-login-bug
     - Terminating agent
     - Archiving topic
     - Removing container

     ✅ Cleanup complete
```

### `/todo`

Manage global todo items (like claude-army).

```
User: /todo add Review PR #123
Bot: ✅ Added: Review PR #123

User: /todo list
Bot: 📝 Todo List:
     1. [ ] Review PR #123
     2. [ ] Update documentation
     3. [x] Fix login bug

User: /todo done 1
Bot: ✅ Completed: Review PR #123
```

### `/help`

Show available commands.

## Permission Flow

When an agent needs permission for a dangerous operation:

```
[Task: fix-login-bug topic]

Agent: 🔧 Requesting permission:

       Tool: Bash
       Command: rm -rf node_modules && npm install

       [✅ Allow] [❌ Deny]
```

**Implementation**:
```typescript
const sendPermissionRequest = (
  chatId: number,
  topicId: number,
  permissionId: string,
  toolName: string,
  toolInput: string
) =>
  Effect.gen(function* () {
    const keyboard = {
      inline_keyboard: [
        [
          { text: "✅ Allow", callback_data: `perm:allow:${permissionId}` },
          { text: "❌ Deny", callback_data: `perm:deny:${permissionId}` },
        ],
      ],
    };

    const message = `🔧 **Permission Request**

**Tool**: ${toolName}
**Input**:
\`\`\`
${toolInput.substring(0, 500)}${toolInput.length > 500 ? "..." : ""}
\`\`\``;

    yield* sendMessage(chatId, message, {
      message_thread_id: topicId,
      reply_markup: keyboard,
      parse_mode: "Markdown",
    });
  });

const handleCallback = (query: CallbackQuery, env: Env) =>
  Effect.gen(function* () {
    const data = query.data || "";

    if (data.startsWith("perm:")) {
      const [, action, permissionId] = data.split(":");
      const approved = action === "allow";

      // Resolve permission in Operator DO
      const operatorId = env.OPERATOR.idFromName("main");
      const operator = env.OPERATOR.get(operatorId);

      yield* Effect.tryPromise(() =>
        operator.fetch(new Request("http://internal/permission/resolve", {
          method: "POST",
          body: JSON.stringify({ permissionId, approved }),
        }))
      );

      // Update message to show decision
      yield* answerCallbackQuery(query.id, approved ? "Allowed" : "Denied");
      yield* editMessage(
        query.message!.chat.id,
        query.message!.message_id,
        `${approved ? "✅" : "❌"} ${approved ? "Allowed" : "Denied"}: ${data}`
      );
    }
  });
```

## Streaming Output

Stream agent output to Telegram in chunks:

```typescript
class MessageBuffer {
  private buffer = "";
  private lastSent = 0;
  private messageId: number | null = null;

  async append(text: string, chatId: number, topicId: number) {
    this.buffer += text;

    // Debounce: only send every 500ms or 200 chars
    const now = Date.now();
    if (now - this.lastSent > 500 || this.buffer.length > 200) {
      await this.flush(chatId, topicId);
    }
  }

  async flush(chatId: number, topicId: number) {
    if (!this.buffer) return;

    if (this.messageId) {
      // Edit existing message
      await editMessage(chatId, this.messageId, this.buffer);
    } else {
      // Send new message
      const result = await sendMessage(chatId, this.buffer, {
        message_thread_id: topicId,
      });
      this.messageId = result.message_id;
    }

    this.lastSent = Date.now();
  }
}
```

## Topic Management

### Create Topic

```typescript
const createTopic = (chatId: number, name: string) =>
  Effect.tryPromise(async () => {
    const response = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/createForumTopic`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          name: name.substring(0, 128), // Max 128 chars
          icon_color: 0x6FB9F0, // Blue
        }),
      }
    );
    return response.json();
  });
```

### Close/Archive Topic

```typescript
const closeTopic = (chatId: number, topicId: number) =>
  Effect.tryPromise(async () => {
    await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/closeForumTopic`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_thread_id: topicId,
        }),
      }
    );
  });
```

## Rate Limiting

Telegram has rate limits. Implement backoff:

```typescript
const sendWithRetry = (fn: () => Promise<any>) =>
  Effect.retryN(
    Effect.tryPromise(fn).pipe(
      Effect.catchIf(
        (e: any) => e.error_code === 429,
        (e) =>
          Effect.sleep(Duration.seconds(e.parameters?.retry_after || 5)).pipe(
            Effect.flatMap(() => Effect.fail(e))
          )
      )
    ),
    3
  );
```

## Security

### Validate Webhook

```typescript
// Verify update comes from Telegram
const validateWebhook = (request: Request, secretToken: string) => {
  const header = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  return header === secretToken;
};
```

### Restrict Access

```typescript
// Only allow specific users/chats
const ALLOWED_CHAT_IDS = [123456789]; // Your chat ID

const checkAccess = (chatId: number) =>
  ALLOWED_CHAT_IDS.includes(chatId)
    ? Effect.succeed(undefined)
    : Effect.fail(new UnauthorizedError());
```
