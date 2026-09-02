// Which care_resources rows to show a given person.
//
// `care_resources.region` exists (values: 'US' or NULL for universal) but
// nothing filtered on it, so a French- or Arabic-speaking user was shown
// US-only phone numbers as their primary step-up options.
//
// INTERIM heuristic until a real region signal exists on the profile (a country
// picker at onboarding is the proper fix): key off the person's app language.
// English (and unknown) users keep the US rows — no regression for the majority.
// fr / ar users get the universal rows only (Find a Helpline localises by
// country; the in-app crisis card via crisisCopy() is already localised).

export type ResourceRegionFilter = {
  /** Always true — universal (region IS NULL) resources are shown to everyone. */
  includeNull: true;
  /** Country codes whose region-specific rows are shown. */
  countries: string[];
};

export function resourceRegionFilter(language: string | null | undefined): ResourceRegionFilter {
  const lang = (language ?? "en").toLowerCase();
  if (lang === "fr" || lang === "ar") return { includeNull: true, countries: [] };
  return { includeNull: true, countries: ["US"] };
}

/** Apply the filter to a fetched list of resources. */
export function filterResourcesByRegion<T extends { region?: string | null }>(
  rows: T[],
  language: string | null | undefined,
): T[] {
  const { countries } = resourceRegionFilter(language);
  return rows.filter((row) => (row.region == null ? true : countries.includes(row.region)));
}
