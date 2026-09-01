import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { deleteMyAccount, deleteMyData, getMyProfile } from "@/lib/onboarding.functions";
import { AppShell } from "@/components/AppShell";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { YourDataSection } from "@/components/YourDataSection";
import { useTranslation } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
        content:
          "Review what Kalm knows about you, your account mode, and delete your data anytime.",
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
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fetchProfile = useServerFn(getMyProfile);
  const wipeData = useServerFn(deleteMyData);
  const removeAccount = useServerFn(deleteMyAccount);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

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

  // Distinct from `mutation` above (data wipe, account stays). This removes the
  // account entirely, so on success we sign out locally and leave the app.
  const accountDeletion = useMutation({
    mutationFn: () => removeAccount(),
    onSuccess: async () => {
      queryClient.clear();
      await supabase.auth.signOut();
      toast.success("Your account has been deleted.");
      navigate({ to: "/", replace: true });
    },
    onError: () => toast.error("We couldn't delete your account right now. Please try again."),
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
              <Row label="AI personalization" value={profile?.ai_context_consent ? "On" : "Off"} />
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
            <h2 className="text-lg">{t("language.sectionTitle")}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{t("language.sectionDescription")}</p>
            <div className="mt-4">
              <LanguageSwitcher />
            </div>
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

          <section className="surface-soft p-6">
            <h2 className="text-lg">Contact support</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Questions about your account, billing, a bug, or feedback for us? Send a message and
              we'll reply right inside Kalm. For anything urgent about how you're feeling, use the
              support resources page instead.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button asChild className="rounded-full">
                <Link to="/support">Message support</Link>
              </Button>
              <Button asChild variant="secondary" className="rounded-full">
                <Link to="/care">Support resources</Link>
              </Button>
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

          <section className="surface-soft border border-destructive/30 p-6">
            <h2 className="text-lg text-destructive">Delete my account</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              This is different from — and more permanent than — deleting your data above. It closes
              your Kalm account entirely: you're signed out everywhere and can no longer sign back
              in with this email. Your mood check-ins, habits, conversations, exercises and
              self-introduction are permanently erased. This cannot be undone.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Crisis safety records and admin support-audit entries are kept, with your identity
              removed from them, as required by our data-retention policy.
            </p>
            <AlertDialog onOpenChange={(open) => !open && setDeleteConfirmText("")}>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="mt-5 rounded-full">
                  Delete my account
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Permanently delete your account?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Your account, profile, conversations, check-ins, habits and exercise history
                    will be permanently deleted. This is not the same as the data-wipe option — your
                    account itself will no longer exist. Type <strong>DELETE</strong> to confirm.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <Input
                  value={deleteConfirmText}
                  onChange={(event) => setDeleteConfirmText(event.target.value)}
                  placeholder="DELETE"
                  autoComplete="off"
                />
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep my account</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => accountDeletion.mutate()}
                    disabled={deleteConfirmText !== "DELETE" || accountDeletion.isPending}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {accountDeletion.isPending ? "Deleting…" : "Permanently delete my account"}
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
