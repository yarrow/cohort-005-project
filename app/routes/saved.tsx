import type { ReactNode } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/saved";
import { db } from "~/db";
import { requireUserId } from "~/lib/access.server";
import { listBookmarksForStudent } from "~/lib/bookmarks.server";
import { listNotesForStudent } from "~/lib/notes.server";
import { Card, CardContent } from "~/components/ui/card";
import { Bookmark, NotebookPen } from "lucide-react";
import { formatRelativeTime } from "~/lib/utils";

export function meta() {
  return [
    { title: "Saved — Cadence" },
    { name: "description", content: "Your bookmarks and notes" },
  ];
}

// Only the signed-in Student's own Bookmarks and Notes, never anyone else's.
export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireUserId(request);

  return {
    savedBookmarks: listBookmarksForStudent(db, userId),
    savedNotes: listNotesForStudent(db, userId),
  };
}

export default function Saved({ loaderData }: Route.ComponentProps) {
  const { savedBookmarks, savedNotes } = loaderData;

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Saved</h1>
        <p className="text-sm text-muted-foreground">
          The lessons you flagged, and what you wrote about them.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SavedSection
          icon={<Bookmark className="size-4 text-muted-foreground" />}
          title="Bookmarks"
          emptyText="No bookmarks yet."
        >
          {savedBookmarks.map((bookmark) => (
            <Card key={bookmark.id}>
              <CardContent className="py-3">
                <LessonLink
                  courseSlug={bookmark.courseSlug}
                  lessonId={bookmark.lessonId}
                  lessonTitle={bookmark.lessonTitle}
                />
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {bookmark.courseTitle} · {bookmark.moduleTitle}
                </p>
              </CardContent>
            </Card>
          ))}
        </SavedSection>

        <SavedSection
          icon={<NotebookPen className="size-4 text-muted-foreground" />}
          title="Notes"
          emptyText="No notes yet."
        >
          {savedNotes.map((note) => (
            <Card key={note.id}>
              <CardContent className="space-y-1 py-3">
                <LessonLink
                  courseSlug={note.courseSlug}
                  lessonId={note.lessonId}
                  lessonTitle={note.lessonTitle}
                />
                <p className="text-xs text-muted-foreground">
                  {note.courseTitle}
                </p>
                {/* Plain text with line breaks kept, never Markdown. */}
                <p className="whitespace-pre-wrap text-sm">{note.body}</p>
                <p
                  suppressHydrationWarning
                  className="text-xs text-muted-foreground"
                >
                  Last edited {formatRelativeTime(note.updatedAt)}
                </p>
              </CardContent>
            </Card>
          ))}
        </SavedSection>
      </div>
    </div>
  );
}

function SavedSection({
  icon,
  title,
  emptyText,
  children,
}: {
  icon: ReactNode;
  title: string;
  emptyText: string;
  children: ReactNode[];
}) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 font-semibold">
        {icon}
        {title}
      </h2>

      {children.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {emptyText}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </section>
  );
}

function LessonLink({
  courseSlug,
  lessonId,
  lessonTitle,
}: {
  courseSlug: string;
  lessonId: number;
  lessonTitle: string;
}) {
  return (
    <Link
      to={`/courses/${courseSlug}/lessons/${lessonId}`}
      className="text-sm font-medium hover:underline"
    >
      {lessonTitle}
    </Link>
  );
}
