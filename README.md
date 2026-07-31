# Mind Bloom

Lovable Build Prompt: AI Mental Health Companion App

Copy the sections below into Lovable. Because this app has several complex systems (AI chat, live avatar sessions, subscriptions, safety systems), build it in phases rather than pasting everything in one giant prompt. Phase breakdown is at the bottom — start with Phase 1.

MASTER PROMPT (paste this first, as your project-defining prompt)

I want to build an all-in-one AI mental wellness app called [APP NAME]. It combines an AI chat companion, mood and habit tracking, guided self-help exercises, and a premium "live session" feature where users can open their camera or microphone and talk in real time to an AI therapist presented as an animated avatar or voice-only assistant.

Architecture note

This is a mobile app. Lovable is being used to build the backend only — authentication, database (Supabase), business logic, AI/LLM integration, subscription/billing logic, and API endpoints that the mobile app (built separately, e.g. React Native/Flutter) will call. Do not treat a web UI as the primary deliverable — focus on backend services, database schema, edge functions/API routes, and prompt/logic design. Any screens Lovable does render should be treated as internal reference or admin tooling (e.g., the workplace/org admin dashboard), not the end-user experience.

Target users

The app should work for four overlapping audiences, with tone/content adapting to context:

General adults managing everyday anxiety, stress, and low mood

Users managing a diagnosed condition (depression, anxiety disorders, PTSD) who are also in or seeking professional care

Teens/students (a distinct, age-appropriate mode with lighter visual tone, simplified language, and stricter safety guardrails)

Employees accessing the app through an employer/workplace wellness plan (a "team/organization" account type)

Core product principles

This is a wellness support tool, not a replacement for therapy or emergency care. This must be stated at onboarding, in the chat interface footer, and in the About/Legal section — not just buried in terms of service.

Every AI-driven feature (chat, avatar session, journaling prompts) must run user input through a crisis-language detection check before generating a response. If self-harm, suicide, or harm-to-others language is detected, interrupt the normal flow and show crisis resources (e.g., 988 Suicide & Crisis Lifeline in the US, or a localized equivalent) prominently, with a calm, non-judgmental message — never just a generic AI reply.

Data privacy is central: clear consent screens, visible data controls (export/delete my data), and no dark patterns around data sharing.

1. Core Features (all-in-one scope)

A. AI Chat Companion

Persistent, threaded chat with an AI assistant with a warm, non-clinical, validating tone (not preachy, not robotic).

Chat should reference the user's self-introduction profile (from onboarding) plus recent mood logs and journal entries (with permission) to feel personalized and continuous from the first message, not stateless or generic.

Include quick-action suggestion chips under the chat input (e.g., "I'm feeling anxious," "Help me reframe a thought," "I need a grounding exercise").

Conversation history saved per user, searchable, deletable.

B. Mood & Habit Tracking

Daily mood check-in (simple 1-5 or emoji-based scale, optional tags like "sleep," "work," "social," "physical health").

Habit tracker for user-defined or suggested habits (sleep, exercise, water, meditation, medication reminders).

Trends dashboard: weekly/monthly mood graph, correlations between habits and mood (e.g., "You tend to log lower moods on days you sleep under 6 hours").

Streaks and gentle encouragement — never guilt-based or shame-based nudging.

C. Guided Exercises Library

Categorized library: CBT-based thought reframing exercises, breathing/grounding exercises, guided journaling prompts, short meditations.

Each exercise: a short intro, step-by-step interactive flow (not just a static article), and an optional "how did that feel?" mood check afterward.

Bookmarking/favorites, and a "recommended for you" section driven by recent mood/chat data.

Age-adapted content set for teen mode (shorter, simpler language, school/social-focused scenarios).

D. Live Avatar / Voice Therapy Session (premium/flagship feature)

User taps "Start a session," chooses Video Avatar or Voice Only.

Camera/mic permission flow with a clear explanation of what is and isn't recorded/stored.

Real-time conversational interface: user speaks, sees/hears a responsive AI avatar (or just hears a voice) reply naturally, with visible listening/thinking states so it doesn't feel broken during latency.

Session timer, ability to end anytime, and a post-session summary (key themes discussed, suggested follow-up exercise, mood before/after).

Session transcripts saved to the user's account (with a clear disclosure that sessions are transcribed/stored, and an option to delete).

Same crisis-detection safety layer applies to live sessions, checking transcribed speech in real time.

2. Subscription Model (Freemium)

Free tier:

Daily mood check-in and basic trend view (7-day history only)

Limited AI chat (e.g., a daily message cap)

Access to a small starter set of guided exercises

No access to live avatar/voice sessions

Premium tier (subscription):

Unlimited AI chat with memory/context across sessions

Full mood/habit history and analytics

Full guided exercise library

Live avatar/voice sessions (consider a monthly minute allowance, e.g., "60 minutes/month included," with add-on minute packs)

Priority crisis-resource localization and export of full personal data/reports (e.g., a PDF summary to share with a real therapist)

Team/organization tier (B2B, phase 2):

Admin dashboard for HR/wellness admins showing aggregate, anonymized usage stats only (never individual chat/session content)

Bulk seat licensing

Custom branding option

Use Stripe for subscription billing, integrated via Supabase.

3. Suggested Screens / Navigation

Onboarding: welcome → account creation → consent & privacy explainer → mode selection (general / condition-specific / teen / workplace) → self-introduction step → baseline mood check-in

Self-introduction step: during signup, the user introduces themselves in their own words (free-text and/or a short guided form) — name/preferred name, what's bringing them to the app, current stressors or goals, anything they want the AI to know upfront (e.g., existing diagnosis, things to avoid bringing up, communication style preference). This profile should be stored and passed into the AI chat/live session context on every future interaction so responses feel personalized and continuous from the very first conversation, rather than generic.

Home/Dashboard: today's check-in, mood trend snapshot, "continue chat," suggested exercise, quick access to start a live session

Chat (AI companion)

Track (mood + habits + trends)

Exercises (library, categories, favorites)

Live Session (avatar/voice) — premium gated

Profile & Settings: subscription management, data export/delete, notification preferences, crisis resources page (always accessible, never gated)

Legal/About: disclaimers, terms, privacy policy

4. Design Direction

Calming, low-stimulation palette (soft blues/greens/neutrals), generous whitespace, rounded shapes — avoid clinical/cold "hospital app" look and avoid overly childish look even in teen mode.

Typography: clean, highly readable, larger default font size options for accessibility.

Micro-interactions should feel gentle (soft transitions, no jarring pop-ups), especially around mood logging and crisis messaging.

Dark mode supported.

Teen mode: same design system, slightly warmer/friendlier illustration style, simplified navigation labels.

5. Suggested Data Model (for Supabase)

users (id, auth info, account_type: individual/teen/org_member, org_id nullable, subscription_tier)

user_profiles (user_id, preferred_name, intro_text, goals[], stressors[], existing_diagnosis nullable, communication_preferences, topics_to_avoid nullable) — populated from the onboarding self-introduction step, injected as context into every AI chat/live session prompt

mood_logs (user_id, timestamp, score, tags[])

habits (user_id, name, frequency_target)

habit_logs (habit_id, timestamp, completed)

chat_threads (user_id, created_at) and chat_messages (thread_id, sender, content, timestamp, flagged_crisis boolean)

exercises (title, category, content_steps, age_mode)

exercise_completions (user_id, exercise_id, timestamp, mood_before, mood_after)

live_sessions (user_id, mode: video/voice, started_at, ended_at, transcript, flagged_crisis boolean)

organizations (id, name, admin_ids, seat_count)

subscriptions (user_id, stripe_customer_id, tier, status)

6. Safety & Compliance Notes to Build In

Crisis-detection layer on every AI input point (chat, journaling free-text, live session transcript) — flag and intercept before generating a normal AI response.

Persistent, unskippable footer/disclaimer on all AI-driven screens: "This app does not provide medical advice or emergency services."

Age-gate and parental-consent consideration for the teen mode (flag this as a legal item to review — COPPA/GDPR-K considerations if under-13 users are ever allowed; recommend restricting to 13+ initially).

Clear data deletion/export tools, since mental health data is sensitive personal data under most privacy laws (HIPAA if you ever integrate with clinicians, GDPR if serving EU users).

PHASED BUILD ORDER (paste one phase at a time into Lovable)

Phase 1 — Foundation: Auth, onboarding flow, account types, basic navigation shell, design system setup.

Phase 2 — Core tracking + chat: Mood/habit tracking, dashboard, AI chat companion (text-only, using an LLM API) with crisis-detection middleware.

Phase 3 — Exercises library: Guided exercise content, completion flow, favorites, recommendations.

Phase 4 — Subscriptions: Stripe integration, free vs. premium gating, billing management screens.

Phase 5 — Workplace/org tier: Admin dashboard, aggregate analytics, seat management.

Phase 6 — Live avatar/voice sessions (deliberately last): Hold off on this phase until a specific voice/avatar API provider has been chosen (e.g., ElevenLabs/Vapi for voice, Tavus/HeyGen/D-ID for video avatars). Build the backend integration points (session data model, API routes, crisis-detection hook) ahead of time so the app is ready to plug in once a provider is selected, but don't wire up an actual third-party avatar/voice API until that decision is made.

Note: the live avatar/voice feature will require signing up for a third-party avatar or voice API and connecting it via Supabase edge functions — Lovable can wire up the integration once you have API keys, but the avatar rendering itself happens through that external service, not Lovable natively.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/3ccb18b6-d5dd-414d-a598-ddc4028d95df).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
