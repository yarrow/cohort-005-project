import { PauseCircle } from "lucide-react";

/** "5 March 2026", in UTC so server and browser agree. */
function formatRequestedOn(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Shown in place of course content while the learner's Refund Request is
 * open (ADR 0001).
 */
export function RefundPausedNotice({ requestedAt }: { requestedAt: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border bg-muted/50 p-4 text-sm">
      <PauseCircle className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
      <p>
        Refund requested on {formatRequestedOn(requestedAt)}, so your access is
        paused while we review it.
      </p>
    </div>
  );
}
