import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, type TestDb } from "~/test/setup";
import * as schema from "~/db/schema";
import { CourseStatus, UserRole } from "~/db/schema";
import { markdown } from "~/lib/text";
import { createLanding } from "../index.server";

let db: TestDb;
let instructorId: number;
let categoryId: number;

beforeEach(() => {
  db = createTestDb();
  instructorId = db
    .insert(schema.users)
    .values({
      name: "Ada Instructor",
      email: "ada@example.com",
      role: UserRole.Instructor,
    })
    .returning()
    .get().id;
  categoryId = addCategory("Programming");
});

// ─── Fixtures ───
// The landing module only reads. Nothing in it writes courses, so rows go in
// directly, kept in one block so a schema change touches only this.

let counter = 0;

function addCategory(name: string) {
  counter += 1;
  return db
    .insert(schema.categories)
    .values({ name, slug: `category-${counter}` })
    .returning()
    .get().id;
}

function addCourse(
  title: string,
  createdAt: string,
  status = CourseStatus.Published
) {
  counter += 1;
  return db
    .insert(schema.courses)
    .values({
      title,
      slug: `course-${counter}`,
      description: `About ${title}`,
      salesCopy: markdown(`## ${title}`),
      instructorId,
      categoryId,
      status,
      createdAt,
    })
    .returning()
    .get().id;
}

function addLessons(courseId: number, lessonsPerModule: number[]) {
  lessonsPerModule.forEach((lessonCount, position) => {
    const moduleId = db
      .insert(schema.modules)
      .values({ courseId, title: `Module ${position}`, position })
      .returning()
      .get().id;
    for (let i = 0; i < lessonCount; i++) {
      db.insert(schema.lessons)
        .values({ moduleId, title: `Lesson ${i}`, position: i })
        .run();
    }
  });
}

const day = (n: number) => `2026-11-${String(n).padStart(2, "0")}T12:00:00Z`;

function getPage() {
  return createLanding(db).get();
}

// ─── Tests ───

describe("landing.get", () => {
  it("is empty when nothing is published", () => {
    addCourse("Draft", day(1), CourseStatus.Draft);

    expect(getPage()).toEqual({
      spotlight: null,
      featuredCourses: [],
      totalCourses: 0,
      totalCategories: 1,
      totalLessons: 0,
    });
  });

  it("spotlights the newest published course and features the next three", () => {
    addCourse("Oldest", day(1));
    addCourse("Second", day(2));
    addCourse("Third", day(3));
    addCourse("Fourth", day(4));
    addCourse("Newest", day(5));
    addCourse("Newer draft", day(6), CourseStatus.Draft);
    addCourse("Newer archived", day(7), CourseStatus.Archived);

    const page = getPage();

    expect(page.spotlight?.title).toBe("Newest");
    expect(page.featuredCourses.map((c) => c.title)).toEqual([
      "Fourth",
      "Third",
      "Second",
    ]);
  });

  it("describes each course with its instructor, category and lessons", () => {
    const id = addCourse("Only", day(1));
    addLessons(id, [2, 3]);

    expect(getPage().spotlight).toEqual({
      id,
      title: "Only",
      slug: expect.stringMatching(/^course-/),
      description: "About Only",
      coverImageUrl: null,
      instructorName: "Ada Instructor",
      categoryName: "Programming",
      lessonCount: 5,
    });
  });

  it("counts each featured course's own lessons, zero when it has none", () => {
    const empty = addCourse("No lessons", day(1));
    const small = addCourse("Small", day(2));
    addLessons(small, [1]);
    addCourse("Newest", day(3));

    const counts = Object.fromEntries(
      getPage().featuredCourses.map((c) => [c.id, c.lessonCount])
    );

    expect(counts).toEqual({ [small]: 1, [empty]: 0 });
  });

  it("totals published courses and their lessons, and every category", () => {
    addLessons(addCourse("A", day(1)), [3]);
    addLessons(addCourse("B", day(2)), [1, 1]);
    addLessons(addCourse("Draft", day(3), CourseStatus.Draft), [10]);
    for (let i = 0; i < 4; i++) addCourse(`Filler ${i}`, day(4 + i));
    addCategory("Design");

    const page = getPage();

    expect(page.totalCourses).toBe(6);
    expect(page.totalLessons).toBe(5);
    expect(page.totalCategories).toBe(2);
  });
});

describe("landing.get ordering", () => {
  it("breaks a tie in creation time by the most recently inserted course", () => {
    addCourse("First in", day(1));
    addCourse("Second in", day(1));

    const page = getPage();

    expect(page.spotlight?.title).toBe("Second in");
    expect(page.featuredCourses.map((c) => c.title)).toEqual(["First in"]);
  });
});
