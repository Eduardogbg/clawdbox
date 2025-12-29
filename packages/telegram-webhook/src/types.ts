/**
 * Telegram Bot API Types
 *
 * Subset of Telegram types needed for webhook handling.
 * @see https://core.telegram.org/bots/api
 */

/**
 * Telegram User
 */
export interface User {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

/**
 * Telegram Chat
 */
export interface Chat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

/**
 * Telegram Message
 */
export interface Message {
  message_id: number;
  message_thread_id?: number; // Forum topic ID
  from?: User;
  chat: Chat;
  date: number;
  text?: string;
  reply_to_message?: Message;
  is_topic_message?: boolean;
}

/**
 * Telegram Callback Query (inline keyboard button press)
 */
export interface CallbackQuery {
  id: string;
  from: User;
  message?: Message;
  chat_instance: string;
  data?: string;
}

/**
 * Telegram Update
 */
export interface Update {
  update_id: number;
  message?: Message;
  callback_query?: CallbackQuery;
}

/**
 * Telegram Send Message Parameters
 */
export interface SendMessageParams {
  chat_id: number | string;
  text: string;
  message_thread_id?: number;
  parse_mode?: "HTML" | "Markdown" | "MarkdownV2";
  reply_to_message_id?: number;
  reply_markup?: InlineKeyboardMarkup;
}

/**
 * Inline Keyboard Markup
 */
export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

/**
 * Inline Keyboard Button
 */
export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

/**
 * Forum Topic Created
 */
export interface ForumTopicCreated {
  name: string;
  icon_color: number;
  icon_custom_emoji_id?: string;
}

/**
 * Create Forum Topic Parameters
 */
export interface CreateForumTopicParams {
  chat_id: number | string;
  name: string;
  icon_color?: number;
  icon_custom_emoji_id?: string;
}

/**
 * Create Forum Topic Response
 */
export interface ForumTopic {
  message_thread_id: number;
  name: string;
  icon_color: number;
  icon_custom_emoji_id?: string;
}
