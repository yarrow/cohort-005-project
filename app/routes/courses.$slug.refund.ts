import { data, redirect } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/courses.$slug.refund";
import { getCurrentUserId } from "~/lib/session";
import { db } from "~/db";
import { courses, users } from "~/db/schema";
import { eq } from "drizzle-orm";
import { parseFormData, parseParams } from "~/lib/validation";
import { formatPrice } from "~/lib/utils";
import {
  getRefundEligibility,
  openRefundRequest,
  REFUND_WINDOW_DAYS,
  type RefundBlock,
} from "~/lib/refunds.server";

const refundParamsSchema = z.object({
  slug: z.string().min(1),
});

const refundActionSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, "Tell us a little more about why you want a refund.")
    .max(1000, "Please keep your reason under 1000 characters."),
});

function getCourseBySlug(slug: string) {
  return db.select().from(courses).where(eq(courses.slug, slug)).get();
}

const blockedResponses: Record<RefundBlock, { message: string; status: number }> =
  {
    "no-purchase": { message: "You have not bought this course.", status: 403 },
    "open-refund-request": {
      message: "You already have an open refund request on this purchase.",
      status: 409,
    },
    "outside-refund-window": {
      message: `The ${REFUND_WINDOW_DAYS}-day window has closed.`,
      status: 403,
    },
    "half-of-lessons-completed": {
      message:
        "You have completed too much of this course to request a refund.",
      status: 403,
    },
    "two-hours-watched": {
      message: "You have watched too much of this course to request a refund.",
      status: 403,
    },
    "claimed-seat": {
      message: "A claimed team seat cannot be refunded.",
      status: 403,
    },
  };

function refuse(blockedBy: RefundBlock): never {
  const { message, status } = blockedResponses[blockedBy];
  throw data(message, { status });
}

/**
 * The confirmation the learner gets in their inbox. There is no mail
 * transport wired up yet, so the built message goes to the server log.
 */
function buildRefundRequestEmail(input: {
  learnerName: string;
  learnerEmail: string;
  courseTitle: string;
  amount: number;
}) {
  return {
    to: input.learnerEmail,
    subject: `Refund requested — ${input.courseTitle}`,
    body: [
      `Hi ${input.learnerName},`,
      "",
      `We have your refund request for "${input.courseTitle}".`,
      `The refund is for ${formatPrice(input.amount)}, the amount you paid.`,
      "",
      "Our team reviews every refund request by hand. You do not need to do anything else — we will email you again when it is done.",
      "",
      "— The Cadence team",
    ].join("\n"),
  };
}

export async function action({ params, request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("You must be logged in to request a refund.", { status: 401 });
  }

  const { slug } = parseParams(params, refundParamsSchema);
  const course = getCourseBySlug(slug);

  if (!course) {
    throw data("Course not found", { status: 404 });
  }

  const learner = db
    .select()
    .from(users)
    .where(eq(users.id, currentUserId))
    .get();

  if (!learner) {
    throw data("User not found", { status: 404 });
  }

  // Refuse an ineligible learner before complaining about their reason.
  const eligibility = getRefundEligibility(currentUserId, course.id);
  if (!eligibility.eligible) refuse(eligibility.blockedBy);

  const formData = await request.formData();
  const parsed = parseFormData(formData, refundActionSchema);

  if (!parsed.success) {
    return data({ errors: parsed.errors }, { status: 400 });
  }

  const result = openRefundRequest({
    userId: currentUserId,
    courseId: course.id,
    reason: parsed.data.reason,
  });

  if (!result.ok) refuse(result.blockedBy);

  const email = buildRefundRequestEmail({
    learnerName: learner.name,
    learnerEmail: learner.email,
    courseTitle: course.title,
    amount: result.amount,
  });

  console.log(
    `[email] to=${email.to} subject=${email.subject}\n${email.body}`
  );

  return redirect("/settings");
}
