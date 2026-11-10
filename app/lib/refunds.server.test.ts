import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { eq } from "drizzle-orm";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import {
  approveRefundRequest,
  declineRefundRequest,
  getRefundEligibility,
  listOpenRefundRequests,
  openRefundRequest,
} from "./refunds.server";

const PURCHASED_AT = "2026-03-01T10:00:00.000Z";

function at(iso: string) {
  return new Date(iso);
}

function buyCourse(amountPaid = 7900, createdAt = PURCHASED_AT) {
  return testDb
    .insert(schema.purchases)
    .values({
      userId: base.user.id,
      courseId: base.course.id,
      amountPaid,
      createdAt,
    })
    .returning()
    .get();
}

function addLessons(count: number) {
  const mod = testDb
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Module", position: 1 })
    .returning()
    .get();
  return Array.from({ length: count }, (_, i) =>
    testDb
      .insert(schema.lessons)
      .values({ moduleId: mod.id, title: `Lesson ${i + 1}`, position: i + 1 })
      .returning()
      .get()
  );
}

function completeLessons(lessonIds: number[]) {
  for (const lessonId of lessonIds) {
    testDb
      .insert(schema.lessonProgress)
      .values({
        userId: base.user.id,
        lessonId,
        status: schema.LessonProgressStatus.Completed,
        completedAt: PURCHASED_AT,
      })
      .run();
  }
}

function watch(lessonId: number, positionSeconds: number) {
  testDb
    .insert(schema.videoWatchEvents)
    .values({
      userId: base.user.id,
      lessonId,
      eventType: "progress",
      positionSeconds,
    })
    .run();
}

function issueSeat(purchaseId: number, claimed: boolean) {
  const team = testDb.insert(schema.teams).values({}).returning().get();
  testDb
    .insert(schema.coupons)
    .values({
      teamId: team.id,
      courseId: base.course.id,
      code: `SEAT-${team.id}`,
      purchaseId,
      redeemedByUserId: claimed ? base.user.id : null,
      redeemedAt: claimed ? PURCHASED_AT : null,
    })
    .run();
}

const SOON_AFTER = at("2026-03-02T10:00:00.000Z");

describe("getRefundEligibility", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  it("is blocked when the learner has not bought the course", () => {
    expect(
      getRefundEligibility(base.user.id, base.course.id, SOON_AFTER)
    ).toEqual({ eligible: false, blockedBy: "no-purchase" });
  });

  it("offers the amount paid and the last day of the Refund Window", () => {
    const purchase = buyCourse(7900);
    expect(
      getRefundEligibility(base.user.id, base.course.id, SOON_AFTER)
    ).toEqual({
      eligible: true,
      offer: {
        purchaseId: purchase.id,
        amount: 7900,
        lastDayInWindow: "2026-03-15",
      },
    });
  });

  describe("Refund Window", () => {
    it("is open for the whole of the fourteenth day after purchase", () => {
      buyCourse();
      const result = getRefundEligibility(
        base.user.id,
        base.course.id,
        at("2026-03-15T23:59:59.000Z")
      );
      expect(result.eligible).toBe(true);
    });

    it("gives a late-night purchase the whole of its fourteenth day", () => {
      buyCourse(7900, "2026-03-01T23:30:00.000Z");
      const result = getRefundEligibility(
        base.user.id,
        base.course.id,
        at("2026-03-15T23:00:00.000Z")
      );
      expect(result.eligible).toBe(true);
    });

    it("has closed on the fifteenth day after purchase", () => {
      buyCourse();
      expect(
        getRefundEligibility(
          base.user.id,
          base.course.id,
          at("2026-03-16T00:00:00.000Z")
        )
      ).toEqual({ eligible: false, blockedBy: "outside-refund-window" });
    });
  });

  describe("lessons completed", () => {
    it("allows a learner who has completed under half the lessons", () => {
      buyCourse();
      const lessons = addLessons(4);
      completeLessons([lessons[0].id]);
      const result = getRefundEligibility(
        base.user.id,
        base.course.id,
        SOON_AFTER
      );
      expect(result.eligible).toBe(true);
    });

    it("blocks a learner who has completed exactly half the lessons", () => {
      buyCourse();
      const lessons = addLessons(4);
      completeLessons([lessons[0].id, lessons[1].id]);
      expect(
        getRefundEligibility(base.user.id, base.course.id, SOON_AFTER)
      ).toEqual({ eligible: false, blockedBy: "half-of-lessons-completed" });
    });

    it("does not trip on a course with no lessons", () => {
      buyCourse();
      const result = getRefundEligibility(
        base.user.id,
        base.course.id,
        SOON_AFTER
      );
      expect(result.eligible).toBe(true);
    });
  });

  describe("hours watched", () => {
    it("allows a learner who has watched just under two hours", () => {
      buyCourse();
      const lessons = addLessons(4);
      // Rewatching a lesson does not add up: only the furthest point counts.
      watch(lessons[0].id, 3600);
      watch(lessons[0].id, 1200);
      watch(lessons[1].id, 3599);
      const result = getRefundEligibility(
        base.user.id,
        base.course.id,
        SOON_AFTER
      );
      expect(result.eligible).toBe(true);
    });

    it("blocks a learner who has watched exactly two hours", () => {
      buyCourse();
      const lessons = addLessons(4);
      watch(lessons[0].id, 3600);
      watch(lessons[1].id, 1800);
      watch(lessons[2].id, 1800);
      expect(
        getRefundEligibility(base.user.id, base.course.id, SOON_AFTER)
      ).toEqual({ eligible: false, blockedBy: "two-hours-watched" });
    });
  });

  describe("Team Licence Seats", () => {
    it("allows a Team Licence whose Seats are all unclaimed", () => {
      const purchase = buyCourse();
      issueSeat(purchase.id, false);
      const result = getRefundEligibility(
        base.user.id,
        base.course.id,
        SOON_AFTER
      );
      expect(result.eligible).toBe(true);
    });

    it("blocks a Team Licence with a claimed Seat", () => {
      const purchase = buyCourse();
      issueSeat(purchase.id, true);
      expect(
        getRefundEligibility(base.user.id, base.course.id, SOON_AFTER)
      ).toEqual({ eligible: false, blockedBy: "claimed-seat" });
    });
  });

  describe("Open Refund Request", () => {
    it("blocks a purchase that already has an Open Refund Request", () => {
      const purchase = buyCourse();
      testDb
        .insert(schema.refunds)
        .values({ purchaseId: purchase.id, reason: "Not for me after all." })
        .run();
      expect(
        getRefundEligibility(base.user.id, base.course.id, SOON_AFTER)
      ).toEqual({ eligible: false, blockedBy: "open-refund-request" });
    });

    it("allows a purchase whose earlier Refund Request was declined", () => {
      const purchase = buyCourse();
      testDb
        .insert(schema.refunds)
        .values({
          purchaseId: purchase.id,
          reason: "Not for me after all.",
          status: schema.RefundStatus.Declined,
        })
        .run();
      const result = getRefundEligibility(
        base.user.id,
        base.course.id,
        SOON_AFTER
      );
      expect(result.eligible).toBe(true);
    });
  });
});

describe("openRefundRequest", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  function open(now = SOON_AFTER) {
    return openRefundRequest({
      userId: base.user.id,
      courseId: base.course.id,
      reason: "The course was not what I expected.",
      now,
    });
  }

  it("creates an Open Refund Request on the learner's purchase", () => {
    const purchase = buyCourse(7900);
    expect(open()).toMatchObject({
      ok: true,
      refundRequest: {
        purchaseId: purchase.id,
        status: schema.RefundStatus.Open,
        reason: "The course was not what I expected.",
        requestedAt: SOON_AFTER.toISOString(),
        amountRefunded: null,
      },
      amount: 7900,
    });
  });

  it("refuses a second Refund Request while one is open", () => {
    buyCourse();
    open();
    expect(open()).toEqual({ ok: false, blockedBy: "open-refund-request" });
  });

  it("refuses a learner who has completed half the lessons", () => {
    buyCourse();
    const lessons = addLessons(2);
    completeLessons([lessons[0].id]);
    expect(open()).toEqual({
      ok: false,
      blockedBy: "half-of-lessons-completed",
    });
  });

  it("refuses a learner who has watched two hours", () => {
    buyCourse();
    const lessons = addLessons(1);
    watch(lessons[0].id, 7200);
    expect(open()).toEqual({ ok: false, blockedBy: "two-hours-watched" });
  });

  it("refuses a learner outside the Refund Window", () => {
    buyCourse();
    expect(open(at("2026-03-16T00:00:00.000Z"))).toEqual({
      ok: false,
      blockedBy: "outside-refund-window",
    });
  });

  it("refuses a Team Licence with a claimed Seat", () => {
    const purchase = buyCourse();
    issueSeat(purchase.id, true);
    expect(open()).toEqual({ ok: false, blockedBy: "claimed-seat" });
  });

  it("refuses a learner with no purchase", () => {
    expect(open()).toEqual({ ok: false, blockedBy: "no-purchase" });
  });
});

describe("listOpenRefundRequests", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  function requestRefund(
    purchaseId: number,
    requestedAt: string,
    status: schema.RefundStatus = schema.RefundStatus.Open
  ) {
    return testDb
      .insert(schema.refunds)
      .values({
        purchaseId,
        reason: "The course was not what I expected.",
        status,
        requestedAt,
      })
      .returning()
      .get();
  }

  it("lists an Open Refund Request with who asked, for what, and why", () => {
    const purchase = buyCourse(7900);
    const request = requestRefund(purchase.id, "2026-03-04T09:00:00.000Z");
    expect(listOpenRefundRequests()).toEqual([
      expect.objectContaining({
        id: request.id,
        learner: {
          id: base.user.id,
          name: "Test User",
          email: "test@example.com",
        },
        course: { id: base.course.id, title: "Test Course" },
        amountPaid: 7900,
        reason: "The course was not what I expected.",
        requestedAt: "2026-03-04T09:00:00.000Z",
      }),
    ]);
  });

  it("shows how much of the course the learner has completed and watched", () => {
    const purchase = buyCourse();
    const lessons = addLessons(4);
    completeLessons([lessons[0].id]);
    // Only the furthest point reached in each lesson counts.
    watch(lessons[0].id, 1800);
    watch(lessons[0].id, 600);
    watch(lessons[1].id, 900);
    requestRefund(purchase.id, "2026-03-04T09:00:00.000Z");
    expect(listOpenRefundRequests()).toEqual([
      expect.objectContaining({
        lessonsCompleted: 1,
        totalLessons: 4,
        secondsWatched: 2700,
      }),
    ]);
  });

  it("counts days from purchase to request in calendar days", () => {
    // Bought late on the 1st, asked early on the 4th: three days in.
    const purchase = buyCourse(7900, "2026-03-01T23:30:00.000Z");
    requestRefund(purchase.id, "2026-03-04T00:30:00.000Z");
    expect(listOpenRefundRequests()).toEqual([
      expect.objectContaining({
        purchasedAt: "2026-03-01T23:30:00.000Z",
        daysSincePurchase: 3,
      }),
    ]);
  });

  it("leaves out Approved and Declined Refund Requests", () => {
    const purchase = buyCourse();
    requestRefund(
      purchase.id,
      "2026-03-02T09:00:00.000Z",
      schema.RefundStatus.Declined
    );
    requestRefund(
      purchase.id,
      "2026-03-03T09:00:00.000Z",
      schema.RefundStatus.Approved
    );
    expect(listOpenRefundRequests()).toEqual([]);
  });

  it("lists the oldest Open Refund Request first", () => {
    const otherLearner = testDb
      .insert(schema.users)
      .values({
        name: "Other Learner",
        email: "other@example.com",
        role: schema.UserRole.Student,
      })
      .returning()
      .get();
    const otherPurchase = testDb
      .insert(schema.purchases)
      .values({
        userId: otherLearner.id,
        courseId: base.course.id,
        amountPaid: 7900,
        createdAt: PURCHASED_AT,
      })
      .returning()
      .get();
    const newer = requestRefund(buyCourse().id, "2026-03-05T09:00:00.000Z");
    const older = requestRefund(otherPurchase.id, "2026-03-03T09:00:00.000Z");
    expect(listOpenRefundRequests().map((r) => r.id)).toEqual([
      older.id,
      newer.id,
    ]);
  });
});

describe("declineRefundRequest", () => {
  const DECIDED_AT = at("2026-03-06T12:00:00.000Z");
  let platformAdmin: typeof schema.users.$inferSelect;
  let refundRequestId: number;

  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
    platformAdmin = testDb
      .insert(schema.users)
      .values({
        name: "Platform Admin",
        email: "admin@example.com",
        role: schema.UserRole.Admin,
      })
      .returning()
      .get();
    testDb
      .insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();
    buyCourse();
    const opened = openRefundRequest({
      userId: base.user.id,
      courseId: base.course.id,
      reason: "Not for me.",
      now: SOON_AFTER,
    });
    if (!opened.ok) throw new Error("expected an Open Refund Request");
    refundRequestId = opened.refundRequest.id;
  });

  it("records the reason, the deciding Platform Admin and when", () => {
    const result = declineRefundRequest({
      refundRequestId,
      platformAdminId: platformAdmin.id,
      reason: "You have watched most of the course.",
      now: DECIDED_AT,
    });
    expect(result).toMatchObject({
      ok: true,
      refundRequest: expect.objectContaining({
        id: refundRequestId,
        status: schema.RefundStatus.Declined,
        declineReason: "You have watched most of the course.",
        resolvedByUserId: platformAdmin.id,
        resolvedAt: "2026-03-06T12:00:00.000Z",
        amountRefunded: null,
      }),
    });
  });

  it("refuses to decline without a reason and leaves the request open", () => {
    const result = declineRefundRequest({
      refundRequestId,
      platformAdminId: platformAdmin.id,
      reason: "   ",
      now: DECIDED_AT,
    });
    expect(result).toEqual({ ok: false, refusedBecause: "reason-required" });
    expect(listOpenRefundRequests().map((r) => r.id)).toEqual([
      refundRequestId,
    ]);
  });

  it("refuses a Refund Request that has already been decided", () => {
    declineRefundRequest({
      refundRequestId,
      platformAdminId: platformAdmin.id,
      reason: "First decision.",
      now: DECIDED_AT,
    });
    const again = declineRefundRequest({
      refundRequestId,
      platformAdminId: platformAdmin.id,
      reason: "Second decision.",
      now: at("2026-03-07T12:00:00.000Z"),
    });
    expect(again).toEqual({ ok: false, refusedBecause: "not-open" });
  });

  it("leaves the list once declined", () => {
    declineRefundRequest({
      refundRequestId,
      platformAdminId: platformAdmin.id,
      reason: "No.",
      now: DECIDED_AT,
    });
    expect(listOpenRefundRequests()).toEqual([]);
  });

  it("can be declined after the Refund Window has closed", () => {
    const result = declineRefundRequest({
      refundRequestId,
      platformAdminId: platformAdmin.id,
      reason: "Too late anyway.",
      now: at("2026-04-30T12:00:00.000Z"),
    });
    expect(result.ok).toBe(true);
  });

  it("says who to tell and about which course", () => {
    expect(
      declineRefundRequest({
        refundRequestId,
        platformAdminId: platformAdmin.id,
        reason: "No.",
        now: DECIDED_AT,
      })
    ).toMatchObject({
      ok: true,
      learner: {
        id: base.user.id,
        name: "Test User",
        email: "test@example.com",
      },
      course: { id: base.course.id, title: "Test Course" },
    });
  });

  it("refuses a Refund Request that does not exist", () => {
    expect(
      declineRefundRequest({
        refundRequestId: 9999,
        platformAdminId: platformAdmin.id,
        reason: "No.",
        now: DECIDED_AT,
      })
    ).toEqual({ ok: false, refusedBecause: "not-found" });
  });

  it("keeps the learner's enrollment and lets them raise a new Refund Request", () => {
    declineRefundRequest({
      refundRequestId,
      platformAdminId: platformAdmin.id,
      reason: "Try again with more detail.",
      now: DECIDED_AT,
    });
    const enrollments = testDb.select().from(schema.enrollments).all();
    expect(enrollments).toEqual([
      expect.objectContaining({
        userId: base.user.id,
        courseId: base.course.id,
      }),
    ]);
    expect(
      getRefundEligibility(base.user.id, base.course.id, DECIDED_AT).eligible
    ).toBe(true);
  });
});

describe("approveRefundRequest", () => {
  let platformAdmin: typeof schema.users.$inferSelect;

  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
    platformAdmin = testDb
      .insert(schema.users)
      .values({
        name: "Platform Admin",
        email: "admin@example.com",
        role: schema.UserRole.Admin,
      })
      .returning()
      .get();
  });

  const DECIDED_AT = at("2026-03-05T12:00:00.000Z");

  function enrol() {
    testDb
      .insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();
  }

  function buyEnrolAndAsk() {
    buyCourse(7900);
    enrol();
    const result = openRefundRequest({
      userId: base.user.id,
      courseId: base.course.id,
      reason: "Not what I expected.",
      now: SOON_AFTER,
    });
    if (!result.ok) throw new Error(`could not open: ${result.blockedBy}`);
    return result.refundRequest;
  }

  function approve(refundRequestId: number, now = DECIDED_AT) {
    return approveRefundRequest({
      refundRequestId,
      platformAdminId: platformAdmin.id,
      now,
    });
  }

  function enrollmentsOfLearner() {
    return testDb
      .select()
      .from(schema.enrollments)
      .where(eq(schema.enrollments.userId, base.user.id))
      .all();
  }

  it("records the decision, the deciding Platform Admin, the time and the full amount paid", () => {
    const request = buyEnrolAndAsk();
    const result = approve(request.id);
    expect(result).toMatchObject({
      ok: true,
      refundRequest: {
        id: request.id,
        status: schema.RefundStatus.Approved,
        resolvedByUserId: platformAdmin.id,
        resolvedAt: "2026-03-05T12:00:00.000Z",
        amountRefunded: 7900,
      },
    });
  });

  it("says who to tell and about which course", () => {
    const request = buyEnrolAndAsk();
    expect(approve(request.id)).toMatchObject({
      ok: true,
      learner: {
        id: base.user.id,
        name: "Test User",
        email: "test@example.com",
      },
      course: { id: base.course.id, title: "Test Course" },
    });
  });

  it("ends the learner's enrollment in the course", () => {
    const request = buyEnrolAndAsk();
    approve(request.id);
    expect(enrollmentsOfLearner()).toEqual([]);
  });

  it("refuses a Refund Request that has already been decided, and changes nothing", () => {
    const request = buyEnrolAndAsk();
    approve(request.id);
    // The learner buys again; a second approval from a stale tab must not
    // end their new enrollment or overwrite the first decision.
    enrol();
    expect(approve(request.id, at("2026-03-06T12:00:00.000Z"))).toEqual({
      ok: false,
      refusedBecause: "not-open",
    });
    expect(enrollmentsOfLearner()).toHaveLength(1);
    const stored = testDb
      .select()
      .from(schema.refunds)
      .where(eq(schema.refunds.id, request.id))
      .get();
    expect(stored?.resolvedAt).toBe("2026-03-05T12:00:00.000Z");
  });

  it("keeps lesson progress, video watch history and quiz attempts", () => {
    const lessons = addLessons(4);
    const request = buyEnrolAndAsk();
    completeLessons([lessons[0].id]);
    watch(lessons[0].id, 600);
    const quiz = testDb
      .insert(schema.quizzes)
      .values({ lessonId: lessons[0].id, title: "Quiz", passingScore: 0.7 })
      .returning()
      .get();
    testDb
      .insert(schema.quizAttempts)
      .values({ userId: base.user.id, quizId: quiz.id, score: 1, passed: true })
      .run();

    approve(request.id);

    const learnerRows = (
      table:
        | typeof schema.lessonProgress
        | typeof schema.videoWatchEvents
        | typeof schema.quizAttempts
    ) =>
      testDb.select().from(table).where(eq(table.userId, base.user.id)).all();
    expect(learnerRows(schema.lessonProgress)).toHaveLength(1);
    expect(learnerRows(schema.videoWatchEvents)).toHaveLength(1);
    expect(learnerRows(schema.quizAttempts)).toHaveLength(1);
  });

  it("approves a Refund Request after its Refund Window has closed", () => {
    const request = buyEnrolAndAsk();
    const result = approve(request.id, at("2026-04-30T12:00:00.000Z"));
    expect(result).toMatchObject({
      ok: true,
      refundRequest: { status: schema.RefundStatus.Approved },
    });
    expect(enrollmentsOfLearner()).toEqual([]);
  });

  it("takes the approved Refund Request off the list of Open Refund Requests", () => {
    const request = buyEnrolAndAsk();
    approve(request.id);
    expect(listOpenRefundRequests()).toEqual([]);
  });

  it("refuses a Refund Request that does not exist", () => {
    expect(approve(9999)).toEqual({ ok: false, refusedBecause: "not-found" });
  });
});
