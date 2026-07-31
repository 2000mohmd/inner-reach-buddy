import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Check, Leaf } from "lucide-react";
import { completeOnboarding, getMyProfile } from "@/lib/onboarding.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { SafetyFooter } from "@/components/SafetyFooter";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({
    meta: [
      { title: "Set up your Kalm profile" },
      {
        name: "description",
        content: "Tell Kalm who you are so your companion feels personal from the first message.",
      },
      { property: "og:title", content: "Set up your Kalm profile" },
      {
        property: "og:description",
        content: "Consent, mode selection, self-introduction and your baseline mood check-in.",
      },
    ],
  }),
  component: OnboardingPage,
});

const MODES = [
  {
    value: "general" as const,
    title: "Everyday stress & low mood",
    body: "General support for anxiety, stress and difficult days.",
  },
  {
    value: "condition" as const,
    title: "Managing a diagnosed condition",
    body: "For people in or seeking professional care alongside Kalm.",
  },
  {
    value: "teen" as const,
    title: "Teen / student mode",
    body: "Simpler language, school and social scenarios, stricter safety guardrails. Ages 13+.",
  },
  {
    value: "org_member" as const,
    title: "Through my workplace",
    body: "Employer wellness plan. Your employer only ever sees anonymized totals.",
  },
];

const GOALS = [
  "Feel less anxious",
  "Sleep better",
  "Build a daily habit",
  "Understand my patterns",
  "Handle work stress",
  "Be kinder to myself",
];

const STRESSORS = ["Work", "School", "Family", "Money", "Health", "Relationships", "Loneliness"];

const MOODS = [
  { score: 1, label: "Really low" },
  { score: 2, label: "Low" },
  { score: 3, label: "Okay" },
  { score: 4, label: "Good" },
  { score: 5, label: "Great" },
];

const STEPS = ["Consent", "Mode", "About you", "First check-in"];

function toggle(list: string[], value: string) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function OnboardingPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fetchProfile = useServerFn(getMyProfile);
  const saveOnboarding = useServerFn(completeOnboarding);

  const { data } = useQuery({ queryKey: ["my-profile"], queryFn: () => fetchProfile() });

  const [step, setStep] = useState(0);
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [aiContextConsent, setAiContextConsent] = useState(true);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [accountType, setAccountType] = useState<(typeof MODES)[number]["value"]>("general");
  const [preferredName, setPreferredName] = useState("");
  const [introText, setIntroText] = useState("");
  const [goals, setGoals] = useState<string[]>([]);
  const [stressors, setStressors] = useState<string[]>([]);
  const [diagnosis, setDiagnosis] = useState("");
  const [communication, setCommunication] = useState("");
  const [avoid, setAvoid] = useState("");
  const [inCare, setInCare] = useState(false);
  const [mood, setMood] = useState<number | null>(null);

  useEffect(() => {
    if (data?.profile?.onboarding_completed) {
      navigate({ to: "/dashboard", replace: true });
    }
    if (data?.profile?.preferred_name && !preferredName) {
      setPreferredName(data.profile.preferred_name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const mutation = useMutation({
    mutationFn: () =>
      saveOnboarding({
        data: {
          preferred_name: preferredName.trim(),
          account_type: accountType,
          privacy_consent: true as const,
          ai_context_consent: aiContextConsent,
          age_confirmed_13_plus: true as const,
          intro_text: introText.trim(),
          goals,
          stressors,
          existing_diagnosis: diagnosis.trim(),
          communication_preference: communication.trim(),
          topics_to_avoid: avoid.trim(),
          in_professional_care: inCare,
          baseline_mood: mood ?? 3,
          baseline_tags: [],
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["my-profile"] });
      toast.success("You're all set. Welcome to Kalm.");
      navigate({ to: "/dashboard", replace: true });
    },
    onError: () => toast.error("We couldn't save your profile. Please try again."),
  });

  const canContinue = [
    privacyConsent && ageConfirmed,
    Boolean(accountType),
    preferredName.trim().length > 0,
    mood !== null,
  ][step];

  return (
    <div className="flex min-h-screen flex-col breathe-gradient">
      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-12">
        <div className="mb-8 flex items-center gap-2 font-display text-xl">
          <Leaf className="size-5 text-primary" aria-hidden />
          Kalm
        </div>

        <Progress value={((step + 1) / STEPS.length) * 100} className="h-1.5" />
        <p className="mt-3 text-sm text-muted-foreground">
          Step {step + 1} of {STEPS.length} · {STEPS[step]}
        </p>

        <div className="surface-soft mt-6 p-7">
          {step === 0 && (
            <div className="space-y-6">
              <div>
                <h1 className="text-3xl">Before we start</h1>
                <p className="mt-3 text-muted-foreground">
                  Kalm is a wellness support tool — not therapy, not a diagnosis, and not an
                  emergency service. Everything you write stays yours: you can export or delete it
                  whenever you like.
                </p>
              </div>
              <label className="flex cursor-pointer items-start gap-3">
                <Checkbox
                  checked={privacyConsent}
                  onCheckedChange={(value) => setPrivacyConsent(value === true)}
                  className="mt-1"
                />
                <span>
                  I understand Kalm is wellness support, not medical care, and I agree to the privacy
                  notice and terms.
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3">
                <Checkbox
                  checked={ageConfirmed}
                  onCheckedChange={(value) => setAgeConfirmed(value === true)}
                  className="mt-1"
                />
                <span>I am 13 years old or older.</span>
              </label>
              <label className="flex cursor-pointer items-start gap-3">
                <Checkbox
                  checked={aiContextConsent}
                  onCheckedChange={(value) => setAiContextConsent(value === true)}
                  className="mt-1"
                />
                <span>
                  Optional: let Kalm use my check-ins and self-introduction to personalize
                  conversations. You can turn this off at any time.
                </span>
              </label>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h1 className="text-3xl">What brings you here?</h1>
                <p className="mt-3 text-muted-foreground">
                  This sets the tone, content and safety guardrails Kalm uses with you.
                </p>
              </div>
              <div className="space-y-3">
                {MODES.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setAccountType(option.value)}
                    className={`flex w-full items-start gap-3 rounded-2xl border p-5 text-left ${
                      accountType === option.value
                        ? "border-primary bg-secondary"
                        : "border-border bg-card hover:bg-muted"
                    }`}
                  >
                    <span className="flex-1">
                      <span className="block font-semibold">{option.title}</span>
                      <span className="mt-1 block text-sm text-muted-foreground">{option.body}</span>
                    </span>
                    {accountType === option.value && (
                      <Check className="mt-1 size-5 text-primary" aria-hidden />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div>
                <h1 className="text-3xl">Introduce yourself</h1>
                <p className="mt-3 text-muted-foreground">
                  Kalm carries this into every conversation, so it never starts from zero. Share as
                  much or as little as you want.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="name">What should Kalm call you?</Label>
                <Input
                  id="name"
                  value={preferredName}
                  maxLength={60}
                  onChange={(event) => setPreferredName(event.target.value)}
                  placeholder="Preferred name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="intro">In your own words, what's going on right now?</Label>
                <Textarea
                  id="intro"
                  value={introText}
                  maxLength={2000}
                  rows={5}
                  onChange={(event) => setIntroText(event.target.value)}
                  placeholder="I've been feeling stretched thin at work and my sleep has slipped…"
                />
              </div>

              <div className="space-y-2">
                <Label>What would you like to work on?</Label>
                <div className="flex flex-wrap gap-2">
                  {GOALS.map((goal) => (
                    <Chip
                      key={goal}
                      label={goal}
                      active={goals.includes(goal)}
                      onClick={() => setGoals(toggle(goals, goal))}
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>What's weighing on you?</Label>
                <div className="flex flex-wrap gap-2">
                  {STRESSORS.map((item) => (
                    <Chip
                      key={item}
                      label={item}
                      active={stressors.includes(item)}
                      onClick={() => setStressors(toggle(stressors, item))}
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="communication">How do you like to be spoken to? (optional)</Label>
                <Input
                  id="communication"
                  value={communication}
                  maxLength={120}
                  onChange={(event) => setCommunication(event.target.value)}
                  placeholder="Gentle and direct, no toxic positivity"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="avoid">Anything Kalm should avoid bringing up? (optional)</Label>
                <Input
                  id="avoid"
                  value={avoid}
                  maxLength={500}
                  onChange={(event) => setAvoid(event.target.value)}
                  placeholder="Please don't ask about my father"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="diagnosis">Existing diagnosis, if you'd like to share (optional)</Label>
                <Input
                  id="diagnosis"
                  value={diagnosis}
                  maxLength={200}
                  onChange={(event) => setDiagnosis(event.target.value)}
                  placeholder="e.g. generalized anxiety"
                />
              </div>

              <label className="flex cursor-pointer items-start gap-3">
                <Checkbox
                  checked={inCare}
                  onCheckedChange={(value) => setInCare(value === true)}
                  className="mt-1"
                />
                <span>I'm currently working with a therapist, counselor or doctor.</span>
              </label>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <div>
                <h1 className="text-3xl">How are you right now?</h1>
                <p className="mt-3 text-muted-foreground">
                  This is your baseline. No wrong answer, and nothing here is a test.
                </p>
              </div>
              <div className="grid grid-cols-5 gap-2">
                {MOODS.map((option) => (
                  <button
                    key={option.score}
                    type="button"
                    onClick={() => setMood(option.score)}
                    className={`rounded-2xl border px-2 py-5 text-center text-sm ${
                      mood === option.score
                        ? "border-primary bg-secondary font-semibold"
                        : "border-border bg-card hover:bg-muted"
                    }`}
                  >
                    <span className="block text-2xl">{"○●"[mood === option.score ? 1 : 0]}</span>
                    <span className="mt-2 block">{option.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-8 flex items-center justify-between gap-3">
            <Button
              variant="ghost"
              className="rounded-full"
              disabled={step === 0}
              onClick={() => setStep((value) => Math.max(0, value - 1))}
            >
              <ArrowLeft className="size-4" aria-hidden />
              Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button
                className="rounded-full px-6"
                disabled={!canContinue}
                onClick={() => setStep((value) => value + 1)}
              >
                Continue
                <ArrowRight className="size-4" aria-hidden />
              </Button>
            ) : (
              <Button
                className="rounded-full px-6"
                disabled={!canContinue || mutation.isPending}
                onClick={() => mutation.mutate()}
              >
                {mutation.isPending ? "Saving…" : "Finish setup"}
              </Button>
            )}
          </div>
        </div>
      </main>
      <SafetyFooter />
    </div>
  );
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-4 py-2 text-sm ${
        active
          ? "border-primary bg-secondary font-semibold text-secondary-foreground"
          : "border-border bg-card text-muted-foreground hover:bg-muted"
      }`}
    >
      {label}
    </button>
  );
}
