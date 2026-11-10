import { data, isRouteErrorResponse, Link, useFetcher } from "react-router";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { AlertTriangle, ReceiptText } from "lucide-react";
import type { Route } from "./+types/admin.refunds";
import { db } from "~/db";
import { UserRole, users } from "~/db/schema";
import { getCurrentUserId } from "~/lib/session";
import {
  declineRefundRequest,
  listOpenRefundRequests,
  REFUND_WINDOW_DAYS,
  type OpenRefundRequestListing,
} from "~/lib/refunds.server";
import { formatPrice } from "~/lib/utils";
import { parseFormData } from "~/lib/validation";
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

export async function loader({ request }: Route.LoaderArgs) {
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

  return { refundRequests: listOpenRefundRequests() };
}

async function requirePlatformAdmin(request: Request) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to decide refunds.", {
      status: 401,
    });
  }

  const currentUser = getUserById(currentUserId);

  if (!currentUser || currentUser.role !== UserRole.Admin) {
    throw data("Only Platform Admins can decide Refund Requests.", {
      status: 403,
    });
  }

  return currentUser;
}

const declineSchema = z.object({
  refundRequestId: z.coerce.number().int().positive(),
  reason: z
    .string()
    .trim()
    .min(1, "Write a reason. The learner will see it.")
    .max(1000, "Please keep the reason under 1000 characters."),
});

export type DecisionActionData = {
  intent: string;
  refundRequestId?: number;
  errors?: Record<string, string>;
};

/**
 * The email the learner gets when their Refund Request is declined. There is
 * no mail transport wired up yet, so the built message goes to the server log.
 */
function buildDeclineEmail(input: {
  learnerName: string;
  learnerEmail: string;
  courseTitle: string;
  reason: string;
}) {
  return {
    to: input.learnerEmail,
    subject: `Refund request declined — ${input.courseTitle}`,
    body: [
      `Hi ${input.learnerName},`,
      "",
      `We have reviewed your refund request for "${input.courseTitle}" and declined it.`,
      "",
      "Our reason:",
      input.reason,
      "",
      "Your access to the course is back, with your progress exactly as you left it.",
      "",
      "You may raise a new refund request if you are still eligible.",
      "",
      "— The Cadence team",
    ].join("\n"),
  };
}

async function decline(formData: FormData, platformAdminId: number) {
  const parsed = parseFormData(formData, declineSchema);
  const refundRequestId = Number(formData.get("refundRequestId")) || undefined;

  if (!parsed.success) {
    return data<DecisionActionData>(
      { intent: "decline", refundRequestId, errors: parsed.errors },
      { status: 400 }
    );
  }

  const notOpen = data<DecisionActionData>(
    {
      intent: "decline",
      refundRequestId,
      errors: {
        form: "This Refund Request is no longer open. It may have been decided in another tab.",
      },
    },
    { status: 409 }
  );

  // Look the request up before deciding it: once declined it leaves the list.
  const listing = listOpenRefundRequests().find(
    (r) => r.id === parsed.data.refundRequestId
  );
  if (!listing) return notOpen;

  const result = declineRefundRequest({
    refundRequestId: parsed.data.refundRequestId,
    platformAdminId,
    reason: parsed.data.reason,
  });

  if (!result.ok) {
    if (result.error === "not-open") return notOpen;
    return data<DecisionActionData>(
      {
        intent: "decline",
        refundRequestId,
        errors: { reason: "Write a reason. The learner will see it." },
      },
      { status: 400 }
    );
  }

  const email = buildDeclineEmail({
    learnerName: listing.learner.name,
    learnerEmail: listing.learner.email,
    courseTitle: listing.course.title,
    reason: parsed.data.reason,
  });

  console.log(
    `[email] to=${email.to} subject=${email.subject}\n${email.body}`
  );

  return data<DecisionActionData>({ intent: "decline", refundRequestId });
}

/**
 * Every decision posts here with a hidden `intent` field naming it.
 */
export async function action({ request }: Route.ActionArgs) {
  const platformAdmin = await requirePlatformAdmin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  switch (intent) {
    case "decline":
      return decline(formData, platformAdmin.id);
    default:
      throw data(`Unknown decision: "${intent}".`, { status: 400 });
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

function DeclineForm({ refundRequestId }: { refundRequestId: number }) {
  const fetcher = useFetcher<DecisionActionData>();
  const errors =
    fetcher.data?.intent === "decline" ? fetcher.data.errors : undefined;
  const reasonErrorId = `decline-reason-error-${refundRequestId}`;

  return (
    <fetcher.Form method="post" className="flex min-w-56 flex-col gap-2">
      <input type="hidden" name="intent" value="decline" />
      <input type="hidden" name="refundRequestId" value={refundRequestId} />
      <label
        htmlFor={`decline-reason-${refundRequestId}`}
        className="text-xs font-medium text-muted-foreground"
      >
        Reason for declining
      </label>
      <Textarea
        id={`decline-reason-${refundRequestId}`}
        name="reason"
        placeholder="The learner will see this."
        aria-invalid={errors?.reason ? true : undefined}
        aria-describedby={errors?.reason ? reasonErrorId : undefined}
      />
      {errors?.reason && (
        <p id={reasonErrorId} className="text-xs text-destructive">
          {errors.reason}
        </p>
      )}
      {errors?.form && (
        <p className="text-xs text-destructive">{errors.form}</p>
      )}
      <Button
        type="submit"
        variant="outline"
        size="sm"
        disabled={fetcher.state !== "idle"}
      >
        Decline
      </Button>
    </fetcher.Form>
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
      <td className="px-4 py-3 text-sm">
        <DeclineForm refundRequestId={r.id} />
      </td>
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
