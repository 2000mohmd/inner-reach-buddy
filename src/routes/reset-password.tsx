import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Leaf } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SafetyFooter } from "@/components/SafetyFooter";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Set a new password — Kalm" },
      {
        name: "description",
        content: "Choose a new password for your Kalm account and get back to your check-ins.",
      },
      { property: "og:title", content: "Set a new password — Kalm" },
      {
        property: "og:description",
        content: "Choose a new password for your Kalm account and get back to your check-ins.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Set a new password — Kalm" },
      {
        name: "twitter:description",
        content: "Choose a new password for your Kalm account and get back to your check-ins.",
      },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    void supabase.auth.getSession().then(({ data: session }) => {
      if (session.session) setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function handleSubmit() {
    if (password.length < 8) {
      toast.error("Use at least 8 characters");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords don't match");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Password updated");
      navigate({ to: "/chat", replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't update your password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col breathe-gradient">
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-md">
          <Link
            to="/"
            className="mb-8 flex items-center justify-center gap-2 font-display text-2xl"
          >
            <Leaf className="size-5 text-primary" aria-hidden />
            Kalm
          </Link>

          <div className="surface-soft space-y-4 p-7">
            <h1 className="text-2xl">Set a new password</h1>
            {!ready ? (
              <p className="text-muted-foreground">
                Open the reset link from your email on this device to continue. If the link expired,{" "}
                <Link to="/auth" className="text-primary underline underline-offset-4">
                  request a new one
                </Link>
                .
              </p>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="new-password">New password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="At least 8 characters"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(event) => setConfirm(event.target.value)}
                    placeholder="Repeat your new password"
                  />
                </div>
                <Button
                  className="w-full rounded-full"
                  disabled={busy}
                  onClick={() => void handleSubmit()}
                >
                  Update password
                </Button>
              </>
            )}
          </div>
        </div>
      </main>
      <SafetyFooter />
    </div>
  );
}
