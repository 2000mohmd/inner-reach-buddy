import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { deleteMyData, getMyProfile } from "@/lib/onboarding.functions";
import { AppShell } from "@/components/AppShell";
import { YourDataSection } from "@/components/YourDataSection";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Your profile & data — Kalm" },
      {
        name: "description",
        content: "Review what Kalm knows about you, your account mode, and delete your data anytime.",
      },
      { property: "og:title", content: "Your profile & data — Kalm" },
      {
        property: "og:description",
        content: "Review what Kalm knows about you and delete your data anytime.",
      },
    ],
  }),
  component: SettingsPage,
});

const MODE_LABELS: Record<string, string> = {
  general: "Everyday stress & low mood",
  condition: "Managing a diagnosed condition",
  teen: "Teen / student mode",
  org_member: "Workplace plan",
};

function SettingsPage() {
  const queryClient = useQueryClient();
  const fetchProfile = useServerFn(getMyProfile);
  const wipeData = useServerFn(deleteMyData);

  const { data, isPending } = useQuery({
    queryKey: ["my-profile"],
    queryFn: () => fetchProfile(),
  });

  const mutation = useMutation({
    mutationFn: () => wipeData(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["my-profile"] });
      toast.success("Your check-ins and self-introduction have been deleted.");
    },
    onError: () => toast.error("We couldn't delete that right now. Please try again."),
  });

  const profile = data?.profile;
  const intro = data?.intro;

  return (
    <AppShell>
      {isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-10 w-56" />
          <Skeleton className="h-64 w-full rounded-3xl" />
        </div>
      ) : (
        <div className="space-y-6">
          <header>
            <h1 className="text-3xl sm:text-4xl">Your profile &amp; data</h1>
            <p className="mt-2 text-muted-foreground">
              Everything Kalm knows about you, in one place.
            </p>
          </header>

          <section className="surface-soft p-6">
            <h2 className="text-lg">Account</h2>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              <Row label="Preferred name" value={profile?.preferred_name ?? "—"} />
              <Row
                label="Mode"
                value={MODE_LABELS[profile?.account_type ?? ""] ?? profile?.account_type ?? "—"}
              />
              <Row
                label="AI personalization"
                value={profile?.ai_context_consent ? "On" : "Off"}
              />
              <Row
                label="Consent accepted"
                value={
                  profile?.consent_accepted_at
                    ? new Date(profile.consent_accepted_at).toLocaleDateString()
                    : "—"
                }
              />
            </dl>
          </section>

          <section className="surface-soft p-6">
            <h2 className="text-lg">Your self-introduction</h2>
            <p className="mt-3 whitespace-pre-wrap text-muted-foreground">
              {intro?.intro_text || "You haven't written an introduction yet."}
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Row label="Goals" value={(intro?.goals ?? []).join(", ") || "—"} />
              <Row label="Stressors" value={(intro?.stressors ?? []).join(", ") || "—"} />
              <Row
                label="Communication preference"
                value={intro?.communication_preference || "—"}
              />
              <Row label="Topics to avoid" value={intro?.topics_to_avoid || "—"} />
              <Row
                label="Working with a professional"
                value={intro?.in_professional_care ? "Yes" : "Not currently"}
              />
              <Row label="Shared diagnosis" value={intro?.existing_diagnosis || "—"} />
            </div>
          </section>

          <YourDataSection />

          <section className="surface-soft p-6">

            <h2 className="text-lg">Delete your data</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              This removes every check-in and clears your self-introduction. Your account stays, so
              you can start fresh whenever you want. This can't be undone.
            </p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="mt-5 rounded-full">
                  Delete my check-ins &amp; introduction
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete your wellness data?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Every mood check-in and your self-introduction will be permanently removed.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep my data</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => mutation.mutate()}
                    disabled={mutation.isPending}
                  >
                    {mutation.isPending ? "Deleting…" : "Delete permanently"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </section>

          <p className="text-sm text-muted-foreground">
            Read the{" "}
            <Link to="/legal" className="font-semibold text-primary underline underline-offset-4">
              disclaimers and privacy notice
            </Link>
            .
          </p>
        </div>
      )}
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1">{value}</dd>
    </div>
  );
}
