import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

// A learner with an Open Refund Request has their access paused (ADR 0001):
// nothing they do may move their progress, and no course content reaches them.

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;
let signedInUserId: number | null = null;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

vi.mock("~/lib/session", () => ({
  getCurrentUserId: vi.fn(async () => signedInUserId),
}));

vi.mock("~/lib/country.server", () => ({
  resolveCountry: vi.fn(async () => null),
}));

import {
  action as lessonAction,
  loader as lessonLoader,
} from "./courses.$slug.lessons.$lessonId";
import { action as videoTrackingAction } from "./api.video-tracking";
import { openRefundRequest } from "~/lib/refunds.server";

const LESSON_CONTENT = "# Secret lesson body";
const VIDEO_URL = "https://www.youtube.com/watch?v=secret";

function addLesson() {
  const mod = testDb
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Module", position: 1 })
    .returning()
    .get();
  const lesson = testDb
    .insert(schema.lessons)
    .values({
      moduleId: mod.id,
      title: "Lesson",
      position: 1,
      content: LESSON_CONTENT,
      videoUrl: VIDEO_URL,
      durationMinutes: 10,
    })
    .returning()
    .get();
  const quiz = testDb
    .insert(schema.quizzes)
    .values({ lessonId: lesson.id, title: "Quiz", passingScore: 0.7 })
    .returning()
    .get();
  return { lesson, quiz };
}

function enrolAndBuy(userId: number) {
  testDb
    .insert(schema.enrollments)
    .values({ userId, courseId: base.course.id })
    .run();
  testDb
    .insert(schema.purchases)
    .values({
      userId,
      courseId: base.course.id,
      amountPaid: 7900,
      createdAt: new Date().toISOString(),
    })
    .run();
}

function pauseAccess(userId: number) {
  const opened = openRefundRequest({
    userId,
    courseId: base.course.id,
    reason: "Not for me",
  });
  if (!opened.ok) throw new Error(`could not open: ${opened.blockedBy}`);
}

function postForm(fields: Record<string, string>) {
  return new Request("http://localhost:3000/lesson", {
    method: "POST",
    body: new URLSearchParams(fields),
  });
}

function postJson(body: unknown) {
  return new Request("http://localhost:3000/api/video-tracking", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function statusOfRefusal(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    // Routes refuse by throwing `data(message, { status })`.
    const status = (error as { init?: { status?: number } } | null)?.init
      ?.status;
    if (status === undefined) throw error;
    return status;
  }
  throw new Error("expected the request to be refused");
}

describe("a learner whose access is paused by an Open Refund Request", () => {
  let lesson: typeof schema.lessons.$inferSelect;
  let quiz: typeof schema.quizzes.$inferSelect;

  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
    ({ lesson, quiz } = addLesson());
    enrolAndBuy(base.user.id);
    pauseAccess(base.user.id);
    signedInUserId = base.user.id;
  });

  function lessonArgs(request: Request) {
    return {
      request,
      params: { slug: base.course.slug, lessonId: String(lesson.id) },
      context: {},
    } as unknown as Parameters<typeof lessonAction>[0];
  }

  it("cannot mark a lesson complete", async () => {
    const status = await statusOfRefusal(() =>
      lessonAction(lessonArgs(postForm({ intent: "mark-complete" })))
    );

    expect(status).toBe(403);
  });

  it("cannot submit a quiz", async () => {
    const status = await statusOfRefusal(() =>
      lessonAction(
        lessonArgs(
          postForm({ intent: "submit-quiz", quizId: String(quiz.id) })
        )
      )
    );

    expect(status).toBe(403);
  });

  it("cannot record video watch time", async () => {
    const status = await statusOfRefusal(() =>
      videoTrackingAction({
        request: postJson({
          lessonId: lesson.id,
          eventType: "progress",
          positionSeconds: 600,
        }),
        params: {},
        context: {},
      } as unknown as Parameters<typeof videoTrackingAction>[0])
    );

    expect(status).toBe(403);
  });

  it("is sent none of the lesson's content", async () => {
    const page = await lessonLoader(
      lessonArgs(new Request("http://localhost:3000/lesson"))
    );

    expect(JSON.stringify(page)).not.toContain(LESSON_CONTENT);
    expect(JSON.stringify(page)).not.toContain(VIDEO_URL);
    expect(page.quiz).toBeNull();
    expect(page.lesson.title).toBe("Lesson");
  });
});

describe("an enrolled learner with no Open Refund Request", () => {
  let lesson: typeof schema.lessons.$inferSelect;

  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
    ({ lesson } = addLesson());
    enrolAndBuy(base.user.id);
    signedInUserId = base.user.id;
  });

  function lessonArgs(request: Request) {
    return {
      request,
      params: { slug: base.course.slug, lessonId: String(lesson.id) },
      context: {},
    } as unknown as Parameters<typeof lessonAction>[0];
  }

  it("can mark a lesson complete", async () => {
    const result = await lessonAction(
      lessonArgs(postForm({ intent: "mark-complete" }))
    );

    expect(result).toEqual({ success: true });
  });

  it("is sent the lesson's content", async () => {
    const page = await lessonLoader(
      lessonArgs(new Request("http://localhost:3000/lesson"))
    );

    expect(page.lesson.videoUrl).toBe(VIDEO_URL);
    expect(page.contentHtml).toContain("Secret lesson body");
    expect(page.quiz?.title).toBe("Quiz");
  });
});
