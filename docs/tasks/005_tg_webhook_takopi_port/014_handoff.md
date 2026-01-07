# Handoff 014 - Thread-aware Telegram routing

## What I did
- Routed Orchestrator/Container DOs by chat + topic thread key (`chatId:threadId`).
- Persisted `message_thread_id` in the message queue and used it for replies.
- Added `/rename <title>` using Telegram `editForumTopic`.
- Updated Telegram schemas to include `message_thread_id`.
- Registered `/rename` in bot commands during dev deploy.

## Current behavior
- Replies stay inside the topic thread that triggered them.
- `/rename <title>` works inside topics; replies with a usage hint in non-topic chats.
- Private chats still behave as a single thread (Telegram limitation).

## How to verify
- Send a message in a forum topic and confirm replies stay in that topic.
- Run `/rename New Name` inside a topic and confirm rename.

## Notes
- Debug endpoints now accept `thread_id` query param to target a specific topic.
  Example: `/debug/orchestrator?chat_id=<chat>&thread_id=<topic>`.
