/**
 * Codex progress renderer (ported from takopi, ASCII-only).
 */
import { pipe } from "effect/Function";

type EventRecord = Record<string, unknown>;

export type RenderedEvent = {
  lastItem: number | null;
  cliLines: string[];
  progressLine: string | null;
  progressPrefix: string | null;
};

const STATUS_RUNNING = ">";
const STATUS_DONE = "ok";
const HEADER_SEP = " - ";
const HARD_BREAK = "\n";

const MAX_CMD_LEN = 40;
const MAX_QUERY_LEN = 60;
const MAX_PATH_LEN = 40;
const MAX_PROGRESS_CHARS = 300;

const formatElapsed = (elapsedSeconds: number): string => {
  const total = Math.max(0, Math.floor(elapsedSeconds));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours > 0) {
    return `${hours}h ${remainingMinutes.toString().padStart(2, "0")}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  }
  return `${seconds}s`;
};

const formatHeader = (
  elapsedSeconds: number,
  turn: number | null,
  item: number | null,
  label: string,
): string => {
  const parts = [label, formatElapsed(elapsedSeconds)];
  if (turn !== null) {
    parts.push(`turn ${turn}`);
  }
  if (item !== null) {
    parts.push(`item ${item}`);
  }
  return parts.join(HEADER_SEP);
};

const isCommandLogLine = (line: string): boolean =>
  line.includes(`${STATUS_RUNNING} running:`) || line.includes(`${STATUS_DONE} ran:`);

const extractNumericId = (itemId: unknown, fallback: number | null): number | null => {
  if (typeof itemId === "number") {
    return itemId;
  }
  if (typeof itemId === "string") {
    const match = itemId.match(/(?:item_)?(\d+)/);
    if (match && match[1]) {
      return Number(match[1]);
    }
  }
  return fallback;
};

const shorten = (text: string, width: number): string => {
  if (text.length <= width) return text;
  return `${text.slice(0, Math.max(0, width - 3))}...`;
};

const shortenPath = (value: string, width: number): string =>
  pipe(value.replace(/\//g, " /"), (spaced) => shorten(spaced, width).replace(/ \//g, "/"));

const asString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const asNumber = (value: unknown): number | null =>
  typeof value === "number" ? value : null;

const getItem = (event: EventRecord): EventRecord | null => {
  const item = event.item;
  return typeof item === "object" && item !== null ? (item as EventRecord) : null;
};

const formatEvent = (
  event: EventRecord,
  lastItem: number | null,
): RenderedEvent => {
  const eventType = asString(event.type);
  if (!eventType) {
    return { lastItem, cliLines: [], progressLine: null, progressPrefix: null };
  }

  if (eventType === "thread.started") {
    return { lastItem, cliLines: ["thread started"], progressLine: null, progressPrefix: null };
  }

  if (eventType === "turn.started") {
    return { lastItem, cliLines: ["turn started"], progressLine: null, progressPrefix: null };
  }

  if (eventType === "turn.completed") {
    return { lastItem, cliLines: ["turn completed"], progressLine: null, progressPrefix: null };
  }

  if (eventType === "turn.failed") {
    const error = event.error;
    const message =
      typeof error === "object" && error !== null && typeof (error as EventRecord).message === "string"
        ? (error as EventRecord).message
        : "unknown error";
    return {
      lastItem,
      cliLines: [`turn failed: ${message}`],
      progressLine: null,
      progressPrefix: null,
    };
  }

  if (eventType === "error") {
    const message = asString(event.message) ?? "stream error";
    return { lastItem, cliLines: [`stream error: ${message}`], progressLine: null, progressPrefix: null };
  }

  if (eventType === "item.started" || eventType === "item.updated" || eventType === "item.completed") {
    const item = getItem(event);
    if (!item) {
      return { lastItem, cliLines: [], progressLine: null, progressPrefix: null };
    }
    const itemNum = extractNumericId(item.id, lastItem);
    const prefix = `[${itemNum ?? "?"}] `;
    const itemType = asString(item.type) ?? "";
    const eventCompleted = eventType === "item.completed";

    if (itemType === "agent_message" && eventCompleted) {
      const text = asString(item.text) ?? "";
      const lines = ["assistant:", ...text.split("\n").map((line) => `  ${line}`)];
      return { lastItem: itemNum ?? lastItem, cliLines: lines, progressLine: null, progressPrefix: null };
    }

    if (itemType === "reasoning" && eventCompleted) {
      const line = `${prefix}${asString(item.text) ?? ""}`;
      return { lastItem: itemNum ?? lastItem, cliLines: [line], progressLine: line, progressPrefix: prefix };
    }

    if (itemType === "command_execution") {
      const command = asString(item.command) ?? "";
      const short = `\`${shorten(command, MAX_CMD_LEN)}\``;
      if (eventType === "item.started") {
        const line = `${prefix}${STATUS_RUNNING} running: ${short}`;
        return { lastItem: itemNum ?? lastItem, cliLines: [line], progressLine: line, progressPrefix: prefix };
      }
      if (eventCompleted) {
        const exitCode = asNumber(item.exit_code);
        const exitPart = exitCode === null ? "" : ` (exit ${exitCode})`;
        const line = `${prefix}${STATUS_DONE} ran: ${short}${exitPart}`;
        return { lastItem: itemNum ?? lastItem, cliLines: [line], progressLine: line, progressPrefix: prefix };
      }
    }

    if (itemType === "mcp_tool_call") {
      const server = asString(item.server);
      const tool = asString(item.tool);
      const name = [server, tool].filter((part): part is string => Boolean(part)).join(".") || "tool";
      const line = `${prefix}${eventCompleted ? STATUS_DONE : STATUS_RUNNING} tool: ${name}`;
      return { lastItem: itemNum ?? lastItem, cliLines: [line], progressLine: line, progressPrefix: prefix };
    }

    if (itemType === "web_search" && eventCompleted) {
      const query = shorten(asString(item.query) ?? "", MAX_QUERY_LEN);
      const line = `${prefix}${STATUS_DONE} searched: ${query}`;
      return { lastItem: itemNum ?? lastItem, cliLines: [line], progressLine: line, progressPrefix: prefix };
    }

    if (itemType === "file_change" && eventCompleted) {
      const changes = Array.isArray(item.changes) ? item.changes : [];
      const paths = changes
        .map((change) => (isRecord(change) ? asString(change.path) : null))
        .filter((path): path is string => Boolean(path));
      let desc = "updated files";
      if (paths.length === 0) {
        desc = changes.length === 0 ? "updated files" : `updated ${changes.length} files`;
      } else if (paths.length <= 3) {
        desc = `updated ${paths.map((path) => `\`${shortenPath(path, MAX_PATH_LEN)}\``).join(", ")}`;
      } else {
        desc = `updated ${paths.length} files`;
      }
      const line = `${prefix}${STATUS_DONE} ${desc}`;
      return { lastItem: itemNum ?? lastItem, cliLines: [line], progressLine: line, progressPrefix: prefix };
    }

    if (itemType === "error" && eventCompleted) {
      const message = shorten(asString(item.message) ?? "warning", 120);
      const line = `${prefix}${STATUS_DONE} warning: ${message}`;
      return { lastItem: itemNum ?? lastItem, cliLines: [line], progressLine: line, progressPrefix: prefix };
    }
  }

  return { lastItem, cliLines: [], progressLine: null, progressPrefix: null };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export class ExecProgressRenderer {
  private readonly maxActions: number;
  private readonly maxChars: number;
  private recentActions: string[] = [];
  private turnCount: number | null = null;
  private lastItem: number | null = null;

  constructor(maxActions = 5, maxChars = MAX_PROGRESS_CHARS) {
    this.maxActions = maxActions;
    this.maxChars = maxChars;
  }

  noteEvent(event: EventRecord): boolean {
    const eventType = asString(event.type);
    if (!eventType) return false;
    if (eventType === "thread.started") return true;
    if (eventType === "turn.started") {
      this.turnCount = this.turnCount === null ? 1 : this.turnCount + 1;
      return true;
    }

    const rendered = formatEvent(event, this.lastItem);
    this.lastItem = rendered.lastItem;
    if (!rendered.progressLine) return false;

    if (
      eventType === "item.completed" &&
      rendered.progressPrefix &&
      this.recentActions.length > 0
    ) {
      const last = this.recentActions[this.recentActions.length - 1];
      if (last.startsWith(`${rendered.progressPrefix}${STATUS_RUNNING} `)) {
        this.recentActions.pop();
      }
    }

    this.recentActions.push(rendered.progressLine);
    if (this.recentActions.length > this.maxActions) {
      this.recentActions = this.recentActions.slice(-this.maxActions);
    }
    return true;
  }

  renderProgress(elapsedSeconds: number): string {
    const header = formatHeader(elapsedSeconds, this.turnCount, this.lastItem, "working");
    const message = this.assemble(header, this.recentActions);
    return message.length <= this.maxChars ? message : header;
  }

  renderFinal(elapsedSeconds: number, answer: string, status = "done"): string {
    const header = formatHeader(elapsedSeconds, this.turnCount, this.lastItem, status);
    const lines =
      status === "done"
        ? this.recentActions.filter((line) => !isCommandLogLine(line))
        : this.recentActions;
    const body = this.assemble(header, lines);
    const trimmed = answer.trim();
    return trimmed ? `${body}\n\n${trimmed}` : body;
  }

  private assemble(header: string, lines: string[]): string {
    return lines.length === 0 ? header : `${header}\n\n${lines.join(HARD_BREAK)}`;
  }
}

export const isCodexEvent = (value: unknown): value is EventRecord =>
  isRecord(value) && typeof value.type === "string";
