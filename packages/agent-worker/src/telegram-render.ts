/**
 * Telegram message utilities (length limits, resume line handling).
 */
export const TELEGRAM_LIMIT = 4000;

const findResumeLine = (text: string): string | null => {
  const lines = text.trimEnd().split("\n");
  const last = lines[lines.length - 1];
  if (!last) return null;
  return last.startsWith("resume: ") ? last : null;
};

export const withResumeLine = (text: string, sessionId: string | null): string => {
  if (!sessionId) return text;
  const suffix = `resume: ${sessionId}`;
  const trimmed = text.trimEnd();
  return trimmed ? `${trimmed}\n\n${suffix}` : suffix;
};

export const truncateForTelegram = (text: string, limit = TELEGRAM_LIMIT): string => {
  if (text.length <= limit) return text;
  const resume = findResumeLine(text);
  if (!resume) {
    return `${text.slice(0, Math.max(0, limit - 3))}...`;
  }
  const budget = limit - resume.length - 2;
  if (budget <= 0) {
    return resume.slice(0, limit);
  }
  const head = text.slice(0, Math.max(0, budget - 3)).trimEnd();
  return `${head}...\n${resume}`;
};
