import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { buildMyReport, getMyDataSummary } from "@/lib/data-export.functions";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/lib/i18n";

/** Plain-language view of what Kalm stores, plus a shareable report export. */
export function YourDataSection() {
  const { t } = useTranslation();
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
      toast.success(t("yourData.downloaded"));
    } catch {
      toast.error(t("yourData.reportFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface-soft p-6">
      <h2 className="text-lg">{t("yourData.title")}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{t("yourData.subtitle")}</p>

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
                  ? t("yourData.nothingStored")
                  : item.first === item.last
                    ? t("yourData.onDate", { date: item.first ?? "" })
                    : t("yourData.dateRange", { from: item.first ?? "", to: item.last ?? "" })}
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5">
        <Button variant="outline" className="rounded-full" disabled={busy} onClick={download}>
          <Download className="size-4" aria-hidden />
          {busy ? t("yourData.preparing") : t("yourData.downloadReport")}
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">{t("yourData.reportDescription")}</p>
      </div>
    </section>
  );
}
