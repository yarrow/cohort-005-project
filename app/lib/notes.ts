import { z } from "zod";

export const MAX_NOTE_LENGTH = 2000;

export const NOTE_TOO_LONG_MESSAGE = `A note can be at most ${MAX_NOTE_LENGTH.toLocaleString("en")} characters. Shorten it and save again.`;

/** A Note body: plain text, trimmed, refused (not truncated) when too long. */
export const noteBodySchema = z
  .string()
  .trim()
  .max(MAX_NOTE_LENGTH, NOTE_TOO_LONG_MESSAGE);
