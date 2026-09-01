import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Leaf } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SafetyFooter } from "@/components/SafetyFooter";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in to Kalm" },
      {
        name: "description",
        content: "Sign in or create your Kalm account to start your private wellness check-ins.",
      },
      { property: "og:title", content: "Sign in to Kalm" },
      {
        property: "og:description",
        content: "Sign in or create your Kalm account to start your private wellness check-ins.",
      },
    ],
  }),
  component: AuthPage,
});

const credentials = z.object({
  email: z.string().trim().email("Enter a valid email address").max(255),
  password: z.string().min(8, "Use at least 8 characters").max(72),
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  async function handleForgotPassword() {
    const parsedEmail = z.string().trim().email().safeParse(email);
    if (!parsedEmail.success) {
      toast.error("Enter your email address first");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(parsedEmail.data, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setResetSent(true);
      toast.success("Password reset link sent");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't send the reset link");
    } finally {
      setBusy(false);
    }
  }


  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/chat", replace: true });
    });
  }, [navigate]);

  async function handlePassword(mode: "signin" | "signup") {
    const parsed = credentials.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check your details");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: parsed.data.email,
          password: parsed.data.password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        if (!data.session) {
          setEmailSent(true);
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword(parsed.data);
        if (error) throw error;
      }
      navigate({ to: "/chat", replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    setBusy(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      setBusy(false);
      toast.error("Google sign-in didn't complete. Please try again.");
      return;
    }
    if (result.redirected) return;
    navigate({ to: "/chat", replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col breathe-gradient">
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-md">
          <Link to="/" className="mb-8 flex items-center justify-center gap-2 font-display text-2xl">
            <Leaf className="size-5 text-primary" aria-hidden />
            Kalm
          </Link>

          <div className="surface-soft p-7">
            {emailSent ? (
              <div className="space-y-3 text-center">
                <h1 className="text-2xl">Check your email</h1>
                <p className="text-muted-foreground">
                  We sent a confirmation link to {email}. Open it to finish creating your account.
                </p>
              </div>
            ) : (
              <Tabs defaultValue="signup">
                <TabsList className="w-full rounded-full">
                  <TabsTrigger value="signup" className="flex-1 rounded-full">
                    Create account
                  </TabsTrigger>
                  <TabsTrigger value="signin" className="flex-1 rounded-full">
                    Sign in
                  </TabsTrigger>
                </TabsList>

                {(["signup", "signin"] as const).map((mode) => (
                  <TabsContent key={mode} value={mode} className="mt-6 space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor={`${mode}-email`}>Email</Label>
                      <Input
                        id={`${mode}-email`}
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        placeholder="you@example.com"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`${mode}-password`}>Password</Label>
                      <Input
                        id={`${mode}-password`}
                        type="password"
                        autoComplete={mode === "signup" ? "new-password" : "current-password"}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="At least 8 characters"
                      />
                    </div>
                    <Button
                      className="w-full rounded-full"
                      disabled={busy}
                      onClick={() => void handlePassword(mode)}
                    >
                      {mode === "signup" ? "Create account" : "Sign in"}
                    </Button>
                    {mode === "signin" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleForgotPassword()}
                        className="w-full text-center text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                      >
                        {resetSent ? "Reset link sent — send again" : "Forgot your password?"}
                      </button>
                    )}
                  </TabsContent>

                ))}
              </Tabs>
            )}

            {!emailSent && (
              <>
                <div className="my-6 flex items-center gap-3 text-sm text-muted-foreground">
                  <span className="h-px flex-1 bg-border" />
                  or
                  <span className="h-px flex-1 bg-border" />
                </div>
                <Button
                  variant="outline"
                  className="w-full rounded-full"
                  disabled={busy}
                  onClick={() => void handleGoogle()}
                >
                  Continue with Google
                </Button>
              </>
            )}
          </div>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            By continuing you agree to our{" "}
            <Link to="/legal" className="text-primary underline underline-offset-4">
              terms and privacy notice
            </Link>
            . Kalm is wellness support, not therapy or emergency care.
          </p>
        </div>
      </main>
      <SafetyFooter />
    </div>
  );
}
