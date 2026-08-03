import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { buildMyReport, getMyDataSummary } from "@/lib/data-export.functions";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/** Plain-language view of what Kalm stores, plus a shareable report export. */
export function YourDataSection() {
  const fetchSummary = useServerFn(getMyDataSummary);
  const fetchReport = useServerFn(buildMyReport);
  const [busy, setBusy] = useState(false);

  const { data, isPending } = useQuery({
    queryKey: ["my-data-summary"],
    queryFn: () => fetchSummary(),
  });

  async function download() {
    setBusy(true);
    try {
      const report = await fetchReport();
      const blob = new Blob([report.content], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = report.filename;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Report downloaded.");
    } catch {
      toast.error("We couldn't build that report. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface-soft p-6">
      <h2 className="text-lg">Your data</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Everything Kalm keeps about you, in plain language. Nothing here is shared with anyone unless
        you choose to share it.
      </p>

      {isPending ? (
        <Skeleton className="mt-5 h-40 w-full rounded-2xl" />
      ) : (
        <ul className="mt-5 space-y-3 text-sm">
          {(data?.items ?? []).map((item) => (
            <li key={item.key} className="rounded-2xl bg-card p-4">
              <p className="font-medium">
                {item.label} — {item.count}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {item.count === 0
                  ? "Nothing stored yet."
                  : item.first === item.last
                    ? `On ${item.first}.`
                    : `From ${item.first} to ${item.last}.`}
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5">
        <Button variant="outline" className="rounded-full" disabled={busy} onClick={download}>
          <Download className="size-4" aria-hidden />
          {busy ? "Preparing…" : "Download a report to share"}
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">
          A readable summary of your mood trend, check-in history with severity bands, and exercises
          completed — suitable for sharing with a therapist. It's a self-tracking summary, not a
          clinical assessment.
        </p>
      </div>
    </section>
  );
}
