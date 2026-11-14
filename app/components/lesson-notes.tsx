import { useState } from "react";
import { useFetcher } from "react-router";
import { Lock, NotebookPen } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Textarea } from "~/components/ui/textarea";
import { SectionHeading } from "~/components/section-heading";
import { MAX_NOTE_LENGTH } from "~/lib/notes";
import { cn, formatRelativeTime } from "~/lib/utils";
import { describeNoteDraft, type NoteStatus } from "~/modules/lesson-notes";

export function LessonNotes({
  note,
}: {
  note: { body: string; updatedAt: string } | null;
}) {
  const fetcher = useFetcher<{ ok: boolean; error?: string }>();
  const [draft, setDraft] = useState(note?.body ?? "");
  const { status, canSave } = describeNoteDraft({
    draft,
    saved: note,
    isSaving: fetcher.state !== "idle",
    error: fetcher.data?.error,
    maxLength: MAX_NOTE_LENGTH,
  });

  return (
    <Card className="mb-8 py-0">
      <CardContent className="p-6">
        <SectionHeading
          icon={NotebookPen}
          title="Your notes"
          description="Jot things down while you watch. They stay with this lesson."
        />

        <fetcher.Form method="post" className="space-y-2">
          <input type="hidden" name="intent" value="save-note" />
          <Textarea
            name="body"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={4}
            placeholder="What clicked? What do you want to come back to?"
            aria-label="Your notes"
            className="min-h-28 resize-y"
          />

          <NoteFooter status={status} canSave={canSave} length={draft.length} />
        </fetcher.Form>
      </CardContent>
    </Card>
  );
}

function NoteFooter({
  status,
  canSave,
  length,
}: {
  status: NoteStatus;
  canSave: boolean;
  length: number;
}) {
  return (
    <>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={!canSave}>
          {status.kind === "saving" ? "Saving..." : "Save note"}
        </Button>
        <NoteStatusLabel status={status} />
        <span
          className={cn(
            "ml-auto text-xs",
            status.kind === "too-long"
              ? "text-destructive"
              : "text-muted-foreground"
          )}
        >
          {length} / {MAX_NOTE_LENGTH}
        </span>
      </div>

      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <Lock className="size-3" />
        Private — only you can read your notes.
      </p>
    </>
  );
}

function NoteStatusLabel({ status }: { status: NoteStatus }) {
  switch (status.kind) {
    case "error":
      return <span className="text-xs text-destructive">{status.message}</span>;
    case "too-long":
      return (
        <span className="text-xs text-destructive">
          {status.over.toLocaleString("en")} characters over the limit
        </span>
      );
    case "unsaved":
      return (
        <span className="text-xs text-muted-foreground">Unsaved changes</span>
      );
    case "saved":
      return (
        <span
          suppressHydrationWarning
          className="text-xs text-muted-foreground"
        >
          Saved {formatRelativeTime(status.updatedAt)}
        </span>
      );
    case "empty":
    case "saving":
      return null;
  }
}
