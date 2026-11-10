import { useEffect, useState } from "react";
import { data, isRouteErrorResponse, Link, useFetcher } from "react-router";
import { eq } from "drizzle-orm";
import { toast } from "sonner";
import { z } from "zod";
import { AlertTriangle, ReceiptText } from "lucide-react";
import type { Route } from "./+types/admin.refunds";
import { db } from "~/db";
import { UserRole, users } from "~/db/schema";
import { getCurrentUserId } from "~/lib/session";
import { parseFormData } from "~/lib/validation";
import { logEmail, type Email } from "~/lib/email.server";
import {
  approveRefundRequest,
  declineRefundRequest,
  listOpenRefundRequests,
  REFUND_WINDOW_DAYS,
  type OpenRefundRequestListing,
  type RefundDecisionRefusal,
  type RefundDecisionSubject,
} from "~/lib/refunds.server";
import { formatPrice } from "~/lib/utils";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";

export function meta() {
  return [
    { title: "Refund Requests — Cadence" },
    { name: "description", content: "Review Open Refund Requests" },
  ];
}

function getUserById(id: number) {
  return db.select().from(users).where(eq(users.id, id)).get();
}

/** Only a Platform Admin may see or decide Refund Requests. */
async function requirePlatformAdmin(request: Request) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to review refunds.", {
      status: 401,
    });
  }

  const currentUser = getUserById(currentUserId);

  if (!currentUser || currentUser.role !== UserRole.Admin) {
    throw data("Only Platform Admins can access this page.", {
      status: 403,
    });
  }

  return currentUser;
}

export async function loader({ request }: Route.LoaderArgs) {
  await requirePlatformAdmin(request);
  return { refundRequests: listOpenRefundRequests() };
}

const REASON_REQUIRED =
  "Write a reason for declining. The learner will see it.";

const refundDecisionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("approve"),
    refundRequestId: z.coerce.number().int(),
  }),
  z.object({
    intent: z.literal("decline"),
    refundRequestId: z.coerce.number().int(),
    reason: z
      .string()
      .trim()
      .min(1, REASON_REQUIRED)
      .max(1000, "Please keep the reason under 1000 characters."),
  }),
]);

const refusalMessages: Record<RefundDecisionRefusal, string> = {
  "not-found": "That Refund Request no longer exists.",
  "not-open":
    "That Refund Request has already been decided, perhaps in another tab.",
};

/** Tells the learner their Refund Request was approved. */
function buildApprovalEmail({ learner, course }: RefundDecisionSubject): Email {
  return {
    to: learner.email,
    subject: `Refund approved — ${course.title}`,
    body: [
      `Hi ${learner.name},`,
      "",
      `We have approved your refund request for "${course.title}".`,
      "Your access to the course has now ended.",
      "",
      "Your progress is kept: if you buy the course again later, you will pick up where you left off.",
      "",
      "— The Cadence team",
    ].join("\n"),
  };
}

/** Tells the learner their Refund Request was declined, and why. */
function buildDeclineEmail({
  learner,
  course,
  reason,
}: RefundDecisionSubject & { reason: string }): Email {
  return {
    to: learner.email,
    subject: `Refund declined — ${course.title}`,
    body: [
      `Hi ${learner.name},`,
      "",
      `We have reviewed your refund request for "${course.title}" and declined it.`,
      "",
      "Our reason:",
      reason,
      "",
      "Your access to the course is back, with your progress exactly as you left it.",
      "",
      "You may raise a new refund request if you are still eligible.",
      "",
      "— The Cadence team",
    ].join("\n"),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const platformAdmin = await requirePlatformAdmin(request);

  const formData = await request.formData();
  const parsed = parseFormData(formData, refundDecisionSchema);

  if (!parsed.success) {
    throw data(Object.values(parsed.errors)[0] ?? "Invalid input.", {
      status: 400,
    });
  }

  switch (parsed.data.intent) {
    case "approve": {
      const result = approveRefundRequest({
        refundRequestId: parsed.data.refundRequestId,
        platformAdminId: platformAdmin.id,
      });

      if (!result.ok) {
        throw data(refusalMessages[result.refusedBecause], { status: 409 });
      }

      logEmail(buildApprovalEmail(result));

      return { message: `Approved ${result.learner.name}'s Refund Request.` };
    }
    case "decline": {
      const result = declineRefundRequest({
        refundRequestId: parsed.data.refundRequestId,
        platformAdminId: platformAdmin.id,
        reason: parsed.data.reason,
      });

      if (!result.ok) {
        if (result.refusedBecause === "reason-required") {
          throw data(REASON_REQUIRED, { status: 400 });
        }
        throw data(refusalMessages[result.refusedBecause], { status: 409 });
      }

      logEmail(
        buildDeclineEmail({
          ...result,
          reason: result.refundRequest.declineReason ?? parsed.data.reason,
        })
      );

      return { message: `Declined ${result.learner.name}'s Refund Request.` };
    }
  }
}

const requestedAtFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function formatHours(seconds: number): string {
  return `${(seconds / 3600).toFixed(1)} h`;
}

function percentOf(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

const headings = [
  "Learner",
  "Course",
  "Paid",
  "Reason",
  "Requested",
  "Completed",
  "Watched",
  "Days after purchase",
  "Decision",
];

/**
 * A fetcher for one decision, toasting its outcome once it settles. Refusals
 * are thrown by the action and land in the ErrorBoundary.
 */
function useDecisionFetcher() {
  const fetcher = useFetcher<typeof action>();

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      toast.success(fetcher.data.message);
    }
  }, [fetcher.state, fetcher.data]);

  return fetcher;
}

function DecisionCell({ refundRequestId }: { refundRequestId: number }) {
  const approveFetcher = useDecisionFetcher();
  const approving = approveFetcher.state !== "idle";

  return (
    <td className="px-4 py-3 text-sm">
      <approveFetcher.Form method="post">
        <input type="hidden" name="intent" value="approve" />
        <input type="hidden" name="refundRequestId" value={refundRequestId} />
        <Button type="submit" size="sm" disabled={approving}>
          {approving ? "Approving…" : "Approve"}
        </Button>
      </approveFetcher.Form>
      <DeclineForm refundRequestId={refundRequestId} />
    </td>
  );
}

function DeclineForm({ refundRequestId }: { refundRequestId: number }) {
  const declineFetcher = useDecisionFetcher();
  const declining = declineFetcher.state !== "idle";
  // A missing reason is caught here and shown inline, next to the field. The
  // action refuses it too (400), but a thrown response cannot point at a field.
  const [reasonError, setReasonError] = useState<string | null>(null);
  const reasonId = `decline-reason-${refundRequestId}`;
  const reasonErrorId = `${reasonId}-error`;

  return (
    <declineFetcher.Form
      method="post"
      className="mt-3 flex min-w-56 flex-col gap-2"
      noValidate
      onSubmit={(event) => {
        const reason = new FormData(event.currentTarget).get("reason");
        if (typeof reason !== "string" || reason.trim() === "") {
          event.preventDefault();
          setReasonError(REASON_REQUIRED);
          return;
        }
        setReasonError(null);
      }}
    >
      <input type="hidden" name="intent" value="decline" />
      <input type="hidden" name="refundRequestId" value={refundRequestId} />
      <label
        htmlFor={reasonId}
        className="text-xs font-medium text-muted-foreground"
      >
        Reason for declining
      </label>
      <Textarea
        id={reasonId}
        name="reason"
        placeholder="The learner will see this."
        aria-invalid={reasonError ? true : undefined}
        aria-describedby={reasonError ? reasonErrorId : undefined}
      />
      {reasonError && (
        <p id={reasonErrorId} className="text-xs text-destructive">
          {reasonError}
        </p>
      )}
      <Button type="submit" size="sm" variant="outline" disabled={declining}>
        {declining ? "Declining…" : "Decline"}
      </Button>
    </declineFetcher.Form>
  );
}

function RefundRequestRow({
  refundRequest,
}: {
  refundRequest: OpenRefundRequestListing;
}) {
  const {
    id,
    learner,
    course,
    amountPaid,
    reason,
    requestedAt,
    lessonsCompleted,
    totalLessons,
    secondsWatched,
    daysSincePurchase,
  } = refundRequest;

  return (
    <tr className="border-b border-border align-top last:border-0">
      <td className="px-4 py-3 text-sm">
        <div className="font-medium">{learner.name}</div>
        <div className="text-muted-foreground">{learner.email}</div>
      </td>
      <td className="px-4 py-3 text-sm">{course.title}</td>
      <td className="px-4 py-3 text-sm">{formatPrice(amountPaid)}</td>
      <td className="max-w-xs whitespace-pre-wrap px-4 py-3 text-sm">
        {reason}
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {requestedAtFormat.format(new Date(requestedAt))} UTC
      </td>
      <td className="px-4 py-3 text-sm">
        {lessonsCompleted} of {totalLessons} (
        {percentOf(lessonsCompleted, totalLessons)}%)
      </td>
      <td className="px-4 py-3 text-sm">{formatHours(secondsWatched)}</td>
      <td className="px-4 py-3 text-sm">
        {daysSincePurchase} of {REFUND_WINDOW_DAYS}
      </td>
      <DecisionCell refundRequestId={id} />
    </tr>
  );
}

export default function AdminRefunds({ loaderData }: Route.ComponentProps) {
  const { refundRequests } = loaderData;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Refund Requests</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Refund Requests</h1>
        <p className="mt-1 text-muted-foreground">
          Open Refund Requests across all courses, oldest first
        </p>
      </div>

      {refundRequests.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <ReceiptText className="mx-auto mb-3 size-8 text-muted-foreground/50" />
            <p className="text-muted-foreground">
              There are no Open Refund Requests. You're all caught up.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    {headings.map((heading) => (
                      <th
                        key={heading}
                        className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {refundRequests.map((refundRequest) => (
                    <RefundRequestRow
                      key={refundRequest.id}
                      refundRequest={refundRequest}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading Refund Requests.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Access denied";
      message =
        typeof error.data === "string"
          ? error.data
          : "Only Platform Admins can access this page.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <Link to="/">
          <Button>Go Home</Button>
        </Link>
      </div>
    </div>
  );
}
