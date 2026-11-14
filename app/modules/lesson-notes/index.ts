import { canSaveNote, noteStatus, type NoteDraft } from "./lib/note-status";

export type { NoteStatus, NoteDraft, SavedNote } from "./lib/note-status";

/**
 * What the Student's note editor should say about their draft, and whether
 * the Save button does anything. Pure: the component renders the result.
 */
export function describeNoteDraft(input: NoteDraft) {
  const status = noteStatus(input);
  return { status, canSave: canSaveNote(input.draft, status) };
}
