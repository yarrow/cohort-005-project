import { useEffect } from "react";
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
      .min(1, "Write a reason for declining. The learner will see it.")
      .max(1000, "Please keep the reason under 1000 characters."),
  }),
]);

const refusalMessages: Record<RefundDecisionRefusal, string> = {
  "not-found": "That Refund Request no longer exists.",
  "not-open":
    "That Refund Request has already been decided, perhaps in another tab.",
};

/** A refused decision. `fieldErrors` are shown inline, next to the field. */
type DecisionRefused = {
  ok: false;
  error: string;
  fieldErrors?: Record<string, string>;
};

const REASON_REQUIRED =
  "Write a reason for declining. The learner will see it.";

/**
 * Tells the learner their Refund Request was approved. There is no mail
 * transport wired up yet, so the built message goes to the server log.
 */
function buildApprovalEmail({ learner, course }: RefundDecisionSubject) {
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

/**
 * Tells the learner their Refund Request was declined, and why. There is no
 * mail transport wired up yet, so the built message goes to the server log.
 */
function buildDeclineEmail({
  learner,
  course,
  reason,
}: RefundDecisionSubject & { reason: string }) {
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
    return data<DecisionRefused>(
      {
        ok: false,
        error: Object.values(parsed.errors)[0] ?? "Invalid input.",
        fieldErrors: parsed.errors,
      },
      { status: 400 }
    );
  }

  switch (parsed.data.intent) {
    case "approve": {
      const result = approveRefundRequest({
        refundRequestId: parsed.data.refundRequestId,
        platformAdminId: platformAdmin.id,
      });

      if (!result.ok) {
        return data<DecisionRefused>(
          { ok: false, error: refusalMessages[result.refusedBecause] },
          { status: 409 }
        );
      }

      const email = buildApprovalEmail(result);
      console.log(
        `[email] to=${email.to} subject=${email.subject}\n${email.body}`
      );

      return {
        ok: true as const,
        message: `Approved ${result.learner.name}'s Refund Request.`,
      };
    }
    case "decline": {
      const result = declineRefundRequest({
        refundRequestId: parsed.data.refundRequestId,
        platformAdminId: platformAdmin.id,
        reason: parsed.data.reason,
      });

      if (!result.ok) {
        if (result.refusedBecause === "reason-required") {
          return data<DecisionRefused>(
            {
              ok: false,
              error: REASON_REQUIRED,
              fieldErrors: { reason: REASON_REQUIRED },
            },
            { status: 400 }
          );
        }
        return data<DecisionRefused>(
          { ok: false, error: refusalMessages[result.refusedBecause] },
          { status: 409 }
        );
      }

      const email = buildDeclineEmail({
        ...result,
        reason: result.refundRequest.declineReason ?? parsed.data.reason,
      });
      console.log(
        `[email] to=${email.to} subject=${email.subject}\n${email.body}`
      );

      return {
        ok: true as const,
        message: `Declined ${result.learner.name}'s Refund Request.`,
      };
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

function DecisionCell({ refundRequestId }: { refundRequestId: number }) {
  const approveFetcher = useFetcher<typeof action>();
  const approving = approveFetcher.state !== "idle";

  useEffect(() => {
    if (approveFetcher.state !== "idle" || !approveFetcher.data) return;
    if (approveFetcher.data.ok) toast.success(approveFetcher.data.message);
    else toast.error(approveFetcher.data.error);
  }, [approveFetcher.state, approveFetcher.data]);

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
  const declineFetcher = useFetcher<typeof action>();
  const declining = declineFetcher.state !== "idle";
  const result = declineFetcher.state === "idle" ? declineFetcher.data : null;
  const reasonError =
    result && !result.ok ? result.fieldErrors?.reason : undefined;
  const reasonId = `decline-reason-${refundRequestId}`;
  const reasonErrorId = `${reasonId}-error`;

  useEffect(() => {
    if (declineFetcher.state !== "idle" || !declineFetcher.data) return;
    if (declineFetcher.data.ok) toast.success(declineFetcher.data.message);
    // A missing reason is shown inline, next to the field.
    else if (!declineFetcher.data.fieldErrors)
      toast.error(declineFetcher.data.error);
  }, [declineFetcher.state, declineFetcher.data]);

  return (
    <declineFetcher.Form
      method="post"
      className="mt-3 flex min-w-56 flex-col gap-2"
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
  refundRequest: r,
}: {
  refundRequest: OpenRefundRequestListing;
}) {
  return (
    <tr className="border-b border-border align-top last:border-0">
      <td className="px-4 py-3 text-sm">
        <div className="font-medium">{r.learner.name}</div>
        <div className="text-muted-foreground">{r.learner.email}</div>
      </td>
      <td className="px-4 py-3 text-sm">{r.course.title}</td>
      <td className="px-4 py-3 text-sm">{formatPrice(r.amountPaid)}</td>
      <td className="max-w-xs whitespace-pre-wrap px-4 py-3 text-sm">
        {r.reason}
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {requestedAtFormat.format(new Date(r.requestedAt))} UTC
      </td>
      <td className="px-4 py-3 text-sm">
        {r.lessonsCompleted} of {r.totalLessons} (
        {percentOf(r.lessonsCompleted, r.totalLessons)}%)
      </td>
      <td className="px-4 py-3 text-sm">{formatHours(r.secondsWatched)}</td>
      <td className="px-4 py-3 text-sm">
        {r.daysSincePurchase} of {REFUND_WINDOW_DAYS}
      </td>
      <DecisionCell refundRequestId={r.id} />
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
