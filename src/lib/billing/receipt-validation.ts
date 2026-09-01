// App Store / Play Store receipt validation — INTERFACE ONLY. Not implemented.
//
// When in-app subscriptions ship, the mobile app sends its store receipt to
// POST /api/v1/billing/verify-receipt; the server validates it with the store,
// then updates profiles.subscription_tier. Nothing here talks to Apple/Google
// yet — every validator throws.
//
// TODO(billing): implement per platform.
//   iOS  — POST to https://buy.itunes.apple.com/verifyReceipt (prod) with
//          APP_STORE_SHARED_SECRET; fall back to the sandbox URL on status 21007.
//          Or use the App Store Server API (JWS) with APP_STORE_ISSUER_ID /
//          APP_STORE_KEY_ID / APP_STORE_PRIVATE_KEY.
//   Android — Google Play Developer API purchases.subscriptionsv2.get with a
//          service-account key (GOOGLE_PLAY_SERVICE_ACCOUNT_JSON) and
//          GOOGLE_PLAY_PACKAGE_NAME.
// Also decide: RevenueCat as the abstraction layer vs. direct store calls.

import type { SubscriptionTier } from "@/lib/entitlements.server";

export type ReceiptPlatform = "ios" | "android";

export type VerifyReceiptInput = {
  platform: ReceiptPlatform;
  /** Base64 receipt (iOS) or purchase token (Android). */
  receipt: string;
  /** Store product id, e.g. "kalm.premium.monthly". */
  productId: string;
};

export type ReceiptValidationResult = {
  valid: boolean;
  tier: SubscriptionTier;
  /** ISO timestamp the entitlement is paid through, if known. */
  expiresAt: string | null;
  /** Opaque store id for dedupe / support. */
  transactionId: string | null;
  environment: "production" | "sandbox";
};

export interface ReceiptValidator {
  validate(input: VerifyReceiptInput): Promise<ReceiptValidationResult>;
}

class NotImplementedReceiptValidator implements ReceiptValidator {
  constructor(private readonly platform: ReceiptPlatform) {}
  async validate(): Promise<ReceiptValidationResult> {
    throw new Error(
      `Receipt validation for "${this.platform}" is not implemented yet — see src/lib/billing/receipt-validation.ts`,
    );
  }
}

export function getReceiptValidator(platform: ReceiptPlatform): ReceiptValidator {
  // Swap these for real AppStoreReceiptValidator / PlayStoreReceiptValidator.
  return new NotImplementedReceiptValidator(platform);
}
