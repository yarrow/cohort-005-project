import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

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

import { getAccess } from "./access.server";
import { openRefundRequest } from "./refunds.server";

const REQUESTED_AT = "2026-03-05T09:30:00.000Z";

function request() {
  return new Request("http://localhost:3000");
}

function signInAs(userId: number) {
  signedInUserId = userId;
}

function enrollAndBuy(userId: number) {
  testDb
    .insert(schema.enrollments)
    .values({ userId, courseId: base.course.id })
    .run();
  return testDb
    .insert(schema.purchases)
    .values({
      userId,
      courseId: base.course.id,
      amountPaid: 7900,
      createdAt: "2026-03-01T10:00:00.000Z",
    })
    .returning()
    .get();
}

function raiseRefundRequest(
  purchaseId: number,
  status: schema.RefundStatus = schema.RefundStatus.Open
) {
  testDb
    .insert(schema.refunds)
    .values({
      purchaseId,
      status,
      reason: "Not for me",
      requestedAt: REQUESTED_AT,
    })
    .run();
}

describe("getAccess", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
    signedInUserId = null;
  });

  it("lets an enrolled learner view content when no Refund Request is open", async () => {
    enrollAndBuy(base.user.id);
    signInAs(base.user.id);

    const access = await getAccess(request(), base.course.id);

    expect(access.enrolled).toBe(true);
    expect(access.canViewContent).toBe(true);
    expect(access.openRefundRequest).toBeNull();
  });

  it("pauses content for an enrolled learner whose purchase has an Open Refund Request", async () => {
    const purchase = enrollAndBuy(base.user.id);
    raiseRefundRequest(purchase.id);
    signInAs(base.user.id);

    const access = await getAccess(request(), base.course.id);

    expect(access.enrolled).toBe(true);
    expect(access.canViewContent).toBe(false);
    expect(access.openRefundRequest).toEqual({ requestedAt: REQUESTED_AT });
  });

  it("leaves a Platform Admin's access alone even with an Open Refund Request", async () => {
    const admin = testDb
      .insert(schema.users)
      .values({
        name: "Admin",
        email: "admin@example.com",
        role: schema.UserRole.Admin,
      })
      .returning()
      .get();
    const purchase = enrollAndBuy(admin.id);
    raiseRefundRequest(purchase.id);
    signInAs(admin.id);

    const access = await getAccess(request(), base.course.id);

    expect(access.canViewContent).toBe(true);
    expect(access.openRefundRequest).toBeNull();
  });

  it("leaves the owning instructor's access alone even with an Open Refund Request", async () => {
    const purchase = enrollAndBuy(base.instructor.id);
    raiseRefundRequest(purchase.id);
    signInAs(base.instructor.id);

    const access = await getAccess(request(), base.course.id);

    expect(access.canViewContent).toBe(true);
    expect(access.openRefundRequest).toBeNull();
  });

  it("gives access back once the Refund Request is Declined", async () => {
    const purchase = enrollAndBuy(base.user.id);
    raiseRefundRequest(purchase.id, schema.RefundStatus.Declined);
    signInAs(base.user.id);

    const access = await getAccess(request(), base.course.id);

    expect(access.canViewContent).toBe(true);
    expect(access.openRefundRequest).toBeNull();
  });

  it("keeps the learner's progress when they open a Refund Request", async () => {
    enrollAndBuy(base.user.id);
    const mod = testDb
      .insert(schema.modules)
      .values({ courseId: base.course.id, title: "Module", position: 1 })
      .returning()
      .get();
    const lessonIds = [1, 2, 3].map(
      (position) =>
        testDb
          .insert(schema.lessons)
          .values({ moduleId: mod.id, title: `Lesson ${position}`, position })
          .returning()
          .get().id
    );
    testDb
      .insert(schema.lessonProgress)
      .values({
        userId: base.user.id,
        lessonId: lessonIds[0],
        status: schema.LessonProgressStatus.Completed,
        completedAt: "2026-03-02T10:00:00.000Z",
      })
      .run();
    testDb
      .insert(schema.videoWatchEvents)
      .values({
        userId: base.user.id,
        lessonId: lessonIds[1],
        eventType: "progress",
        positionSeconds: 300,
      })
      .run();

    const result = openRefundRequest({
      userId: base.user.id,
      courseId: base.course.id,
      reason: "Not what I expected",
      now: new Date("2026-03-05T09:30:00.000Z"),
    });
    signInAs(base.user.id);
    const access = await getAccess(request(), base.course.id);

    expect(result.ok).toBe(true);
    expect(access.canViewContent).toBe(false);
    expect(testDb.select().from(schema.lessonProgress).all()).toMatchObject([
      {
        lessonId: lessonIds[0],
        status: schema.LessonProgressStatus.Completed,
      },
    ]);
    expect(testDb.select().from(schema.videoWatchEvents).all()).toMatchObject([
      { lessonId: lessonIds[1], positionSeconds: 300 },
    ]);
  });

  it("ends access once the Refund Request is Approved and the enrollment removed", async () => {
    const purchase = enrollAndBuy(base.user.id);
    raiseRefundRequest(purchase.id, schema.RefundStatus.Approved);
    testDb.delete(schema.enrollments).run();
    signInAs(base.user.id);

    const access = await getAccess(request(), base.course.id);

    expect(access.enrolled).toBe(false);
    expect(access.canViewContent).toBe(false);
    expect(access.openRefundRequest).toBeNull();
  });
});
