export type NoteStatus =
  | { kind: "empty" }
  | { kind: "saving" }
  | { kind: "error"; message: string }
  | { kind: "too-long"; over: number }
  | { kind: "unsaved" }
  | { kind: "saved"; updatedAt: string };

export type NoteDraft = {
  draft: string;
  saved: { body: string; updatedAt: string } | null;
  isSaving: boolean;
  error: string | undefined;
  maxLength: number;
};

export function noteStatus({
  draft,
  saved,
  isSaving,
  error,
  maxLength,
}: NoteDraft): NoteStatus {
  if (isSaving) return { kind: "saving" };
  if (draft.length > maxLength) {
    return { kind: "too-long", over: draft.length - maxLength };
  }
  if (draft !== (saved?.body ?? "")) {
    return error ? { kind: "error", message: error } : { kind: "unsaved" };
  }
  if (saved) return { kind: "saved", updatedAt: saved.updatedAt };
  return { kind: "empty" };
}

export function canSaveNote(draft: string, status: NoteStatus): boolean {
  if (draft.trim().length === 0) return false;
  return status.kind === "unsaved" || status.kind === "error";
}
