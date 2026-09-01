// Age from a date-of-birth string. Used by the onboarding UI to gate/lock and by
// the server as the authority — the server value is what gets persisted.

/** Completed years between `dob` and now (UTC). Returns null for an unparseable date. */
export function ageFromDateOfBirth(dob: string, now: Date = new Date()): number | null {
  const birth = new Date(`${dob}T00:00:00Z`);
  if (Number.isNaN(birth.getTime())) return null;

  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - birth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < birth.getUTCDate())) {
    age -= 1;
  }
  return age;
}

export const MIN_AGE = 13;
export const MINOR_AGE = 18;

/** ISO date (YYYY-MM-DD) for `MIN_AGE` years ago — the latest DOB the picker allows. */
export function maxAllowedDob(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear() - MIN_AGE, now.getUTCMonth(), now.getUTCDate()));
  return d.toISOString().slice(0, 10);
}
