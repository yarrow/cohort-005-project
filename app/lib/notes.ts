import { z } from "zod";

export const MAX_NOTE_LENGTH = 2000;

export const NOTE_TOO_LONG_MESSAGE = `A note can be at most ${MAX_NOTE_LENGTH.toLocaleString("en")} characters. Shorten it and save again.`;

export const NOTE_EMPTY_MESSAGE = "Write something before saving.";

/**
 * A Note body: plain text, trimmed. Refused, never truncated, when it is
 * too long. Refused when empty, so clearing the box can't delete a Note.
 */
export const noteBodySchema = z
  .string()
  .trim()
  .min(1, NOTE_EMPTY_MESSAGE)
  .max(MAX_NOTE_LENGTH, NOTE_TOO_LONG_MESSAGE);
