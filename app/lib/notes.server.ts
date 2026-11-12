import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import { courses, lessons, modules, notes } from "~/db/schema";
import { NOTE_TOO_LONG_MESSAGE, noteBodySchema } from "~/lib/notes";

// ─── Notes ───
// A Note is a Student's own plain-text writing about a Lesson, one per Student
// per Lesson, private to the Student who wrote it. See GLOSSARY.md.
//
// Only the owning Student's Lesson page and Saved page may call these. No
// Instructor or Platform Admin view reads Note bodies.
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Uses positional parameters (project convention).

export type Db = BetterSQLite3Database<typeof schema>;

type Note = typeof notes.$inferSelect;

export type SaveNoteResult =
  | { ok: true; note: Note | null }
  | { ok: false; error: string };

export function getNote(db: Db, userId: number, lessonId: number) {
  return db
    .select()
    .from(notes)
    .where(and(eq(notes.userId, userId), eq(notes.lessonId, lessonId)))
    .get();
}

/**
 * Saves the Student's Note on the Lesson: creates it, or replaces its body and
 * moves its "last edited" time on. The body is trimmed; over
 * `MAX_NOTE_LENGTH` characters it is refused, not truncated. A body that is
 * empty after trimming
 * removes the Note, and the result's `note` is then null.
 */
export function saveNote(
  db: Db,
  userId: number,
  lessonId: number,
  body: string,
  now: Date
): SaveNoteResult {
  const parsed = noteBodySchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: NOTE_TOO_LONG_MESSAGE };
  }
  const trimmed = parsed.data;

  if (trimmed.length === 0) {
    db.delete(notes)
      .where(and(eq(notes.userId, userId), eq(notes.lessonId, lessonId)))
      .run();
    return { ok: true, note: null };
  }

  const at = now.toISOString();
  const note = db
    .insert(notes)
    .values({ userId, lessonId, body: trimmed, createdAt: at, updatedAt: at })
    .onConflictDoUpdate({
      target: [notes.userId, notes.lessonId],
      set: { body: trimmed, updatedAt: at },
    })
    .returning()
    .get();
  return { ok: true, note };
}

/**
 * The Student's own Notes, most recently edited first, each with its Lesson
 * and Course.
 */
export function listNotesForStudent(db: Db, userId: number) {
  return db
    .select({
      id: notes.id,
      body: notes.body,
      updatedAt: notes.updatedAt,
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(notes)
    .innerJoin(lessons, eq(notes.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(notes.userId, userId))
    .orderBy(desc(notes.updatedAt), desc(notes.id))
    .all();
}
