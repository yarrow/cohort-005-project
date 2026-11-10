import { data, isRouteErrorResponse, Link } from "react-router";
import { eq } from "drizzle-orm";
import { AlertTriangle, ReceiptText } from "lucide-react";
import type { Route } from "./+types/admin.refunds";
import { db } from "~/db";
import { UserRole, users } from "~/db/schema";
import { getCurrentUserId } from "~/lib/session";
import {
  listOpenRefundRequests,
  REFUND_WINDOW_DAYS,
  type OpenRefundRequestListing,
} from "~/lib/refunds.server";
import { formatPrice } from "~/lib/utils";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";

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
];

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
