/**
 * Telegram Update Handler
 *
 * Processes incoming Telegram updates and routes them appropriately.
 */
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import type { Update, Message, CallbackQuery } from "./types.js";
import { TelegramClient } from "./telegram.js";
import { createOperatorClient, type OperatorClient } from "./operator-client.js";

/**
 * Handler context
 */
interface HandlerContext {
  telegram: TelegramClient;
  operator: OperatorClient;
  operatorUrl: string;
}

/**
 * Process a Telegram update
 */
export const handleUpdate = (update: Update, ctx: HandlerContext) =>
  Effect.gen(function* () {
    yield* Effect.logInfo(`Received update: ${update.update_id}`);

    if (update.message) {
      yield* handleMessage(update.message, ctx);
    } else if (update.callback_query) {
      yield* handleCallbackQuery(update.callback_query, ctx);
    } else {
      yield* Effect.logDebug("Ignoring unhandled update type");
    }
  });

/**
 * Handle an incoming message
 */
const handleMessage = (message: Message, ctx: HandlerContext) =>
  Effect.gen(function* () {
    const { telegram } = ctx;
    const chatId = message.chat.id;
    const text = message.text ?? "";
    const threadId = message.message_thread_id;

    yield* Effect.logInfo(
      `Message from ${message.from?.username ?? "unknown"}: ${text.substring(0, 50)}`,
    );

    // Handle commands
    if (text.startsWith("/")) {
      yield* handleCommand(message, ctx);
      return;
    }

    // If in a topic (thread), forward to agent
    if (threadId) {
      yield* forwardToAgent(message, ctx);
      return;
    }

    // Otherwise, prompt to create a new task
    yield* pipe(
      telegram.sendMessage({
        chat_id: chatId,
        text: "Hi! Use /task <description> to create a new coding task, or reply in an existing task thread.",
        reply_to_message_id: message.message_id,
      }),
      Effect.catchAll((e) => Effect.logError(`Failed to send message: ${e}`)),
    );
  });

/**
 * Handle a command
 */
const handleCommand = (message: Message, ctx: HandlerContext) =>
  Effect.gen(function* () {
    const { telegram } = ctx;
    const text = message.text ?? "";
    const chatId = message.chat.id;

    // Parse command
    const [command, ...args] = text.split(" ");
    const arg = args.join(" ").trim();

    switch (command) {
      case "/start":
        yield* telegram.sendMessage({
          chat_id: chatId,
          text: `Welcome to Clawdbox! 🤖

I'm your AI coding assistant. Here's what I can do:

/task <description> - Create a new coding task
/status - Check your active tasks
/help - Show this help message

Each task runs in its own thread where you can:
- Send follow-up messages
- Approve or deny code changes
- See real-time progress`,
          parse_mode: "HTML",
        });
        break;

      case "/task":
        if (!arg) {
          yield* telegram.sendMessage({
            chat_id: chatId,
            text: "Please provide a task description. Example:\n/task Add a new endpoint for user authentication",
          });
          return;
        }
        yield* createTask(message, arg, ctx);
        break;

      case "/status":
        yield* telegram.sendMessage({
          chat_id: chatId,
          text: "📊 Status: No active tasks.\n\nUse /task to create a new task.",
        });
        break;

      case "/help":
        yield* telegram.sendMessage({
          chat_id: chatId,
          text: `Available commands:

/task <description> - Create a new coding task
/status - Check your active tasks
/help - Show this help message

In a task thread:
• Send messages to provide more context
• Use buttons to approve/deny changes
• Say "cancel" to stop the current task`,
        });
        break;

      default:
        yield* telegram.sendMessage({
          chat_id: chatId,
          text: `Unknown command: ${command}\nUse /help to see available commands.`,
        });
    }
  });

/**
 * Create a new task
 */
const createTask = (message: Message, prompt: string, ctx: HandlerContext) =>
  Effect.gen(function* () {
    const { telegram, operator } = ctx;
    const chatId = message.chat.id;
    const userId = message.from?.id;

    yield* Effect.logInfo(`Creating task for user ${userId}: ${prompt.substring(0, 50)}`);

    // In a forum (supergroup with topics), create a new topic
    if (message.chat.type === "supergroup") {
      // Create a forum topic for this task
      const topic = yield* pipe(
        telegram.createForumTopic({
          chat_id: chatId,
          name: `📋 ${prompt.substring(0, 50)}${prompt.length > 50 ? "..." : ""}`,
        }),
        Effect.tapError((e) => Effect.logWarning(`Failed to create forum topic: ${e}`)),
        Effect.catchAll(() => Effect.succeed(null)),
      );

      if (topic) {
        // Create task in Operator DO
        const task = yield* pipe(
          operator.createTask({
            prompt,
            telegramTopicId: topic.message_thread_id,
            telegramChatId: chatId,
          }),
          Effect.tapError((e) => Effect.logError(`Failed to create task in Operator: ${e}`)),
          Effect.catchAll(() => Effect.succeed(null)),
        );

        // Send initial message in the topic
        yield* telegram.sendMessage({
          chat_id: chatId,
          message_thread_id: topic.message_thread_id,
          text: `🚀 Task created!

<b>Task:</b> ${escapeHtml(prompt)}
<b>ID:</b> <code>${task?.id ?? "pending"}</code>

Starting agent... Please wait.`,
          parse_mode: "HTML",
        });

        yield* Effect.logInfo(`Task ${task?.id} created with topic ${topic.message_thread_id}`);
        return;
      }
    }

    // Regular group or private chat - create task without topic
    const task = yield* pipe(
      operator.createTask({
        prompt,
        telegramChatId: chatId,
      }),
      Effect.tapError((e) => Effect.logError(`Failed to create task in Operator: ${e}`)),
      Effect.catchAll(() => Effect.succeed(null)),
    );

    yield* telegram.sendMessage({
      chat_id: chatId,
      text: `🚀 Task received!

<b>Task:</b> ${escapeHtml(prompt)}
<b>ID:</b> <code>${task?.id ?? "pending"}</code>

Note: For best experience, use this bot in a forum-enabled group where each task gets its own thread.`,
      parse_mode: "HTML",
      reply_to_message_id: message.message_id,
    });
  });

/**
 * Forward a message to the agent
 */
const forwardToAgent = (message: Message, ctx: HandlerContext) =>
  Effect.gen(function* () {
    const { telegram, operatorUrl } = ctx;
    const chatId = message.chat.id;
    const threadId = message.message_thread_id;
    const text = message.text ?? "";

    yield* Effect.logInfo(`Forwarding to agent in topic ${threadId}: ${text.substring(0, 50)}`);

    // TODO: Forward to Operator DO
    // For now, acknowledge receipt
    yield* telegram.sendMessage({
      chat_id: chatId,
      message_thread_id: threadId,
      text: "📝 Message received. Processing...",
      reply_to_message_id: message.message_id,
    });
  });

/**
 * Handle a callback query (button press)
 */
const handleCallbackQuery = (query: CallbackQuery, ctx: HandlerContext) =>
  Effect.gen(function* () {
    const { telegram, operatorUrl } = ctx;
    const data = query.data ?? "";

    yield* Effect.logInfo(`Callback query: ${data}`);

    // Parse callback data
    // Format: action:param1:param2...
    const [action, ...params] = data.split(":");

    switch (action) {
      case "approve":
        yield* handlePermissionResponse(query, true, ctx);
        break;

      case "deny":
        yield* handlePermissionResponse(query, false, ctx);
        break;

      case "cancel":
        yield* handleCancelTask(query, ctx);
        break;

      default:
        yield* telegram.answerCallbackQuery(query.id, {
          text: "Unknown action",
        });
    }
  });

/**
 * Handle permission approval/denial
 */
const handlePermissionResponse = (
  query: CallbackQuery,
  approved: boolean,
  ctx: HandlerContext,
) =>
  Effect.gen(function* () {
    const { telegram, operator } = ctx;
    const data = query.data ?? "";
    const parts = data.split(":");
    const permissionId = parts[1];

    // Answer the callback query
    yield* telegram.answerCallbackQuery(query.id, {
      text: approved ? "✅ Approved" : "❌ Denied",
    });

    // Forward decision to Operator DO
    yield* pipe(
      operator.resolvePermission(permissionId, { approved }),
      Effect.tapError((e) => Effect.logError(`Failed to resolve permission: ${e}`)),
      Effect.catchAll(() => Effect.succeed(null)),
    );

    // Update the message
    if (query.message) {
      yield* telegram.editMessageText(
        query.message.chat.id,
        query.message.message_id,
        `${query.message.text}\n\n${approved ? "✅ Approved" : "❌ Denied"} by ${query.from.first_name}`,
      );
    }

    yield* Effect.logInfo(`Permission ${permissionId} ${approved ? "approved" : "denied"}`);
  });

/**
 * Handle task cancellation
 */
const handleCancelTask = (query: CallbackQuery, ctx: HandlerContext) =>
  Effect.gen(function* () {
    const { telegram } = ctx;
    const data = query.data ?? "";
    const parts = data.split(":");
    const taskId = parts[1];

    yield* telegram.answerCallbackQuery(query.id, {
      text: "Task cancellation requested",
    });

    // TODO: Forward to Operator DO
    yield* Effect.logInfo(`Task ${taskId} cancellation requested`);
  });

/**
 * Escape HTML special characters
 */
const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
