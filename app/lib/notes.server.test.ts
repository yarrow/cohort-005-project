import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { getNote, listNotesForStudent, saveNote } from "./notes.server";
import { MAX_NOTE_LENGTH } from "./notes";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

function minutesAfterNow(minutes: number) {
  return new Date(NOW.getTime() + minutes * 60_000);
}

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonIds: number[];

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();

  lessonIds = [1, 2, 3].map(
    (position) =>
      db
        .insert(schema.lessons)
        .values({ moduleId: module.id, title: `Lesson ${position}`, position })
        .returning()
        .get().id
  );
});

function addStudent(name: string) {
  return db
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase()}@example.com`,
      role: schema.UserRole.Student,
    })
    .returning()
    .get();
}

describe("saving a Note", () => {
  it("creates a Note with the body trimmed", () => {
    expect(
      saveNote(db, base.user.id, lessonIds[0], "  Rewatch this.  ", NOW)
    ).toMatchObject({ ok: true, note: { body: "Rewatch this." } });

    expect(getNote(db, base.user.id, lessonIds[0])).toMatchObject({
      body: "Rewatch this.",
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
  });

  it("replaces the body and moves the last-edited time on when saved again", () => {
    const later = minutesAfterNow(5);
    saveNote(db, base.user.id, lessonIds[0], "First thought.", NOW);

    saveNote(db, base.user.id, lessonIds[0], "Second thought.", later);

    expect(getNote(db, base.user.id, lessonIds[0])).toMatchObject({
      body: "Second thought.",
      createdAt: NOW.toISOString(),
      updatedAt: later.toISOString(),
    });
    expect(listNotesForStudent(db, base.user.id)).toHaveLength(1);
  });

  it("keeps the body exactly as typed, Markdown characters included", () => {
    const body = "# not a heading\n\n*not emphasis*";
    saveNote(db, base.user.id, lessonIds[0], body, NOW);

    expect(getNote(db, base.user.id, lessonIds[0])?.body).toBe(body);
  });

  it(`accepts a Note of exactly ${MAX_NOTE_LENGTH} characters`, () => {
    const body = "a".repeat(MAX_NOTE_LENGTH);

    expect(saveNote(db, base.user.id, lessonIds[0], body, NOW)).toMatchObject({
      ok: true,
    });
    expect(getNote(db, base.user.id, lessonIds[0])?.body).toBe(body);
  });

  it(`refuses a Note over ${MAX_NOTE_LENGTH} characters with a message`, () => {
    const result = saveNote(
      db,
      base.user.id,
      lessonIds[0],
      "a".repeat(MAX_NOTE_LENGTH + 1),
      NOW
    );

    expect(result).toEqual({
      ok: false,
      error: "A note can be at most 2,000 characters. Shorten it and save again.",
    });
    expect(getNote(db, base.user.id, lessonIds[0])).toBeUndefined();
  });

  it("removes the Note when saved empty", () => {
    saveNote(db, base.user.id, lessonIds[0], "Rewatch this.", NOW);

    expect(saveNote(db, base.user.id, lessonIds[0], "   ", NOW)).toEqual({
      ok: true,
      note: null,
    });
    expect(getNote(db, base.user.id, lessonIds[0])).toBeUndefined();
  });

  it("never leaves a Student with two Notes on one Lesson", () => {
    saveNote(db, base.user.id, lessonIds[0], "Rewatch this.", NOW);

    expect(() =>
      db
        .insert(schema.notes)
        .values({ userId: base.user.id, lessonId: lessonIds[0], body: "Again" })
        .run()
    ).toThrow(/UNIQUE/);
  });
});

describe("listing a Student's Notes", () => {
  it("lists only that Student's Notes, most recently edited first, with Lesson and Course", () => {
    const ben = addStudent("Ben");
    saveNote(db, base.user.id, lessonIds[0], "Older", minutesAfterNow(1));
    saveNote(db, base.user.id, lessonIds[1], "Newer", minutesAfterNow(2));
    saveNote(db, ben.id, lessonIds[2], "Ben's", minutesAfterNow(3));
    saveNote(db, base.user.id, lessonIds[0], "Edited last", minutesAfterNow(4));

    expect(listNotesForStudent(db, base.user.id)).toMatchObject([
      {
        body: "Edited last",
        lessonId: lessonIds[0],
        lessonTitle: "Lesson 1",
        courseTitle: "Test Course",
        courseSlug: "test-course",
      },
      {
        body: "Newer",
        lessonId: lessonIds[1],
        lessonTitle: "Lesson 2",
        courseTitle: "Test Course",
        courseSlug: "test-course",
      },
    ]);
  });
});
