import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  coupons,
  enrollments,
  refunds,
  RefundStatus,
  lessonProgress,
  lessons,
  LessonProgressStatus,
  modules,
  purchases,
  videoWatchEvents,
} from "~/db/schema";
import { courses, users } from "~/db/schema";

export const REFUND_WINDOW_DAYS = 14;
/** Completing this share of a course's lessons or more blocks a Refund Request. */
export const REFUND_COMPLETION_LIMIT = 0.5;
/** Watching this much of a course or more blocks a Refund Request. */
export const REFUND_WATCH_LIMIT_SECONDS = 2 * 60 * 60;

export type RefundBlock =
  | "no-purchase"
  | "open-refund-request"
  | "outside-refund-window"
  | "half-of-lessons-completed"
  | "two-hours-watched"
  | "claimed-seat";

export type RefundEligibility =
  | {
      eligible: true;
      offer: { purchaseId: number; amount: number; lastDayInWindow: string };
    }
  | { eligible: false; blockedBy: RefundBlock };

// The Refund Window is counted in whole calendar days (UTC), not hours: a
// purchase at 23:30 still gets the whole of its fourteenth day.
function calendarDay(when: Date): string {
  return when.toISOString().slice(0, 10);
}

export function lastDayOfRefundWindow(purchasedAt: string): string {
  const deadline = new Date(purchasedAt);
  deadline.setUTCDate(deadline.getUTCDate() + REFUND_WINDOW_DAYS);
  return calendarDay(deadline);
}

export function isWithinRefundWindow(purchasedAt: string, now: Date): boolean {
  const today = calendarDay(now);
  return (
    today >= calendarDay(new Date(purchasedAt)) &&
    today <= lastDayOfRefundWindow(purchasedAt)
  );
}

function getLatestPurchase(userId: number, courseId: number) {
  return db
    .select()
    .from(purchases)
    .where(and(eq(purchases.userId, userId), eq(purchases.courseId, courseId)))
    .orderBy(sql`${purchases.createdAt} desc`)
    .get();
}

function findOpenRefundRequest(purchaseId: number) {
  return db
    .select({ id: refunds.id })
    .from(refunds)
    .where(
      and(
        eq(refunds.purchaseId, purchaseId),
        eq(refunds.status, RefundStatus.Open)
      )
    )
    .get();
}

function hasClaimedSeat(purchaseId: number): boolean {
  const seat = db
    .select({ id: coupons.id })
    .from(coupons)
    .where(
      and(eq(coupons.purchaseId, purchaseId), isNotNull(coupons.redeemedAt))
    )
    .get();
  return seat !== undefined;
}

function getCourseLessonIds(courseId: number): number[] {
  return db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .all()
    .map((row) => row.id);
}

function countCompletedLessons(userId: number, lessonIds: number[]): number {
  if (lessonIds.length === 0) return 0;
  const result = db
    .select({ count: sql<number>`count(*)` })
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.status, LessonProgressStatus.Completed),
        inArray(lessonProgress.lessonId, lessonIds)
      )
    )
    .get();
  return result?.count ?? 0;
}

// "Watched" is, per lesson, the furthest position reached in the video,
// summed across the course's lessons.
function countSecondsWatched(userId: number, lessonIds: number[]): number {
  if (lessonIds.length === 0) return 0;
  return db
    .select({
      furthest: sql<number>`max(${videoWatchEvents.positionSeconds})`,
    })
    .from(videoWatchEvents)
    .where(
      and(
        eq(videoWatchEvents.userId, userId),
        inArray(videoWatchEvents.lessonId, lessonIds)
      )
    )
    .groupBy(videoWatchEvents.lessonId)
    .all()
    .reduce((total, row) => total + row.furthest, 0);
}

export function getRefundEligibility(
  userId: number,
  courseId: number,
  now: Date = new Date()
): RefundEligibility {
  const purchase = getLatestPurchase(userId, courseId);
  if (!purchase) return { eligible: false, blockedBy: "no-purchase" };

  if (findOpenRefundRequest(purchase.id)) {
    return { eligible: false, blockedBy: "open-refund-request" };
  }

  if (!isWithinRefundWindow(purchase.createdAt, now)) {
    return { eligible: false, blockedBy: "outside-refund-window" };
  }

  const lessonIds = getCourseLessonIds(courseId);
  if (
    lessonIds.length > 0 &&
    countCompletedLessons(userId, lessonIds) / lessonIds.length >=
      REFUND_COMPLETION_LIMIT
  ) {
    return { eligible: false, blockedBy: "half-of-lessons-completed" };
  }

  if (countSecondsWatched(userId, lessonIds) >= REFUND_WATCH_LIMIT_SECONDS) {
    return { eligible: false, blockedBy: "two-hours-watched" };
  }

  // A claimed Seat belongs to the team; the buyer cannot hand it back.
  if (hasClaimedSeat(purchase.id)) {
    return { eligible: false, blockedBy: "claimed-seat" };
  }

  return {
    eligible: true,
    offer: {
      purchaseId: purchase.id,
      amount: purchase.amountPaid,
      lastDayInWindow: lastDayOfRefundWindow(purchase.createdAt),
    },
  };
}

export type OpenRefundRequestResult =
  | {
      ok: true;
      refundRequest: typeof refunds.$inferSelect;
      /** What the learner paid, which is what the Refund would be. */
      amount: number;
    }
  | { ok: false; blockedBy: RefundBlock };

/**
 * Raise a Refund Request for the learner's latest purchase of a course.
 * Eligibility is judged here, at the moment the request is made, and nowhere
 * else.
 */
export function openRefundRequest(input: {
  userId: number;
  courseId: number;
  reason: string;
  now?: Date;
}): OpenRefundRequestResult {
  const now = input.now ?? new Date();

  // better-sqlite3 is synchronous, so nothing can slip in between the check
  // and the insert.
  const eligibility = getRefundEligibility(input.userId, input.courseId, now);
  if (!eligibility.eligible) {
    return { ok: false, blockedBy: eligibility.blockedBy };
  }

  const refundRequest = db
    .insert(refunds)
    .values({
      purchaseId: eligibility.offer.purchaseId,
      status: RefundStatus.Open,
      reason: input.reason,
      requestedAt: now.toISOString(),
    })
    .returning()
    .get();

  return { ok: true, refundRequest, amount: eligibility.offer.amount };
}

/**
 * The Open Refund Request on the learner's latest purchase of a course, if
 * any. While one exists the learner's access to the course is paused
 * (ADR 0001).
 */
export function findOpenRefundRequestForCourse(
  userId: number,
  courseId: number
): { id: number; requestedAt: string } | undefined {
  const purchase = getLatestPurchase(userId, courseId);
  if (!purchase) return undefined;
  return db
    .select({ id: refunds.id, requestedAt: refunds.requestedAt })
    .from(refunds)
    .where(
      and(
        eq(refunds.purchaseId, purchase.id),
        eq(refunds.status, RefundStatus.Open)
      )
    )
    .get();
}

export type OpenRefundRequestListing = {
  id: number;
  learner: { id: number; name: string; email: string };
  course: { id: number; title: string };
  amountPaid: number;
  reason: string;
  requestedAt: string;
  /** Lessons with completed progress, out of `totalLessons` in the course. */
  lessonsCompleted: number;
  totalLessons: number;
  /** Furthest point reached in each lesson's video, summed across the course. */
  secondsWatched: number;
  purchasedAt: string;
  /** UTC calendar days from purchase to request, as the Refund Window counts. */
  daysSincePurchase: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function calendarDaysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(calendarDay(new Date(fromIso)));
  const to = Date.parse(calendarDay(new Date(toIso)));
  return Math.round((to - from) / MS_PER_DAY);
}

/** Every Open Refund Request across all courses, oldest first. */
export function listOpenRefundRequests(): OpenRefundRequestListing[] {
  return db
    .select({
      id: refunds.id,
      learnerId: users.id,
      learnerName: users.name,
      learnerEmail: users.email,
      courseId: courses.id,
      courseTitle: courses.title,
      amountPaid: purchases.amountPaid,
      purchasedAt: purchases.createdAt,
      reason: refunds.reason,
      requestedAt: refunds.requestedAt,
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(eq(refunds.status, RefundStatus.Open))
    .orderBy(refunds.requestedAt, refunds.id)
    .all()
    .map((row) => {
      const lessonIds = getCourseLessonIds(row.courseId);
      return {
        id: row.id,
        learner: {
          id: row.learnerId,
          name: row.learnerName,
          email: row.learnerEmail,
        },
        course: { id: row.courseId, title: row.courseTitle },
        amountPaid: row.amountPaid,
        reason: row.reason,
        requestedAt: row.requestedAt,
        lessonsCompleted: countCompletedLessons(row.learnerId, lessonIds),
        totalLessons: lessonIds.length,
        secondsWatched: countSecondsWatched(row.learnerId, lessonIds),
        purchasedAt: row.purchasedAt,
        daysSincePurchase: calendarDaysBetween(
          row.purchasedAt,
          row.requestedAt
        ),
      };
    });
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Why a Platform Admin's decision on a Refund Request was refused. */
export type RefundDecisionRefusal = "not-found" | "not-open";

/** Who and what a decided Refund Request was about, for the learner's email. */
export type RefundDecisionSubject = {
  learner: { id: number; name: string; email: string };
  course: { id: number; title: string };
};

/**
 * Load a Refund Request a Platform Admin is about to decide, inside the
 * deciding transaction. Refused unless it is still open: another Platform
 * Admin may have decided it in another tab.
 */
function findRefundRequestToDecide(tx: Transaction, refundRequestId: number) {
  const found = tx
    .select({
      refundRequest: refunds,
      purchase: purchases,
      learner: { id: users.id, name: users.name, email: users.email },
      course: { id: courses.id, title: courses.title },
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(eq(refunds.id, refundRequestId))
    .get();
  if (!found) return { ok: false, refusedBecause: "not-found" } as const;
  if (found.refundRequest.status !== RefundStatus.Open) {
    return { ok: false, refusedBecause: "not-open" } as const;
  }
  return { ok: true, ...found } as const;
}

export type ApproveRefundRequestResult =
  | ({
      ok: true;
      refundRequest: typeof refunds.$inferSelect;
    } & RefundDecisionSubject)
  | { ok: false; refusedBecause: RefundDecisionRefusal };

/**
 * A Platform Admin approves an Open Refund Request. Everything happens in one
 * transaction. Eligibility is not judged again: the time a request spends
 * waiting on us never counts against the learner (ADR 0001).
 */
export function approveRefundRequest(input: {
  refundRequestId: number;
  platformAdminId: number;
  now?: Date;
}): ApproveRefundRequestResult {
  const now = input.now ?? new Date();

  return db.transaction((tx) => {
    const found = findRefundRequestToDecide(tx, input.refundRequestId);
    if (!found.ok) return found;
    const { purchase, learner, course } = found;

    const refundRequest = tx
      .update(refunds)
      .set({
        status: RefundStatus.Approved,
        amountRefunded: purchase.amountPaid,
        resolvedAt: now.toISOString(),
        resolvedByUserId: input.platformAdminId,
      })
      .where(eq(refunds.id, input.refundRequestId))
      .returning()
      .get();

    // Access ends for good. Progress, watch history and quiz attempts are
    // kept, so buying the course again brings them back.
    tx.delete(enrollments)
      .where(
        and(
          eq(enrollments.userId, purchase.userId),
          eq(enrollments.courseId, purchase.courseId)
        )
      )
      .run();

    return { ok: true, refundRequest, learner, course } as const;
  });
}

export type DeclineRefundRequestResult =
  | ({
      ok: true;
      refundRequest: typeof refunds.$inferSelect;
    } & RefundDecisionSubject)
  | {
      ok: false;
      refusedBecause: RefundDecisionRefusal | "reason-required";
    };

/**
 * A Platform Admin declines an Open Refund Request, giving the learner a
 * reason. The enrollment is kept, so access comes straight back with progress
 * as it was (ADR 0001). Eligibility is not judged again.
 */
export function declineRefundRequest(input: {
  refundRequestId: number;
  platformAdminId: number;
  reason: string;
  now?: Date;
}): DeclineRefundRequestResult {
  const reason = input.reason.trim();
  if (reason === "") return { ok: false, refusedBecause: "reason-required" };

  const now = input.now ?? new Date();

  return db.transaction((tx) => {
    const found = findRefundRequestToDecide(tx, input.refundRequestId);
    if (!found.ok) return found;
    const { learner, course } = found;

    const refundRequest = tx
      .update(refunds)
      .set({
        status: RefundStatus.Declined,
        declineReason: reason,
        resolvedAt: now.toISOString(),
        resolvedByUserId: input.platformAdminId,
      })
      .where(eq(refunds.id, input.refundRequestId))
      .returning()
      .get();

    return { ok: true, refundRequest, learner, course } as const;
  });
}
