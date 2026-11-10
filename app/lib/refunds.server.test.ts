import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import { getRefundEligibility, openRefundRequest } from "./refunds.server";

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
