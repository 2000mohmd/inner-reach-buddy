// Role management (super_admin only). Grants/revokes go through the service
// role because user_roles is intentionally read-only for authenticated users.
export type TeamMember = {
  user_id: string;
  email: string | null;
  preferred_name: string | null;
  roles: string[];
};

export type RoleSearchResult = {
  user_id: string;
  email: string | null;
  preferred_name: string | null;
  roles: string[];
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function emailsFor(userIds: string[]): Promise<Map<string, string | null>> {
  const client = await admin();
  const entries = await Promise.all(
    userIds.map(async (id) => {
      const result = await client.auth.admin.getUserById(id);
      return [id, result.data.user?.email ?? null] as const;
    }),
  );
  return new Map(entries);
}

export async function fetchTeam(): Promise<{ members: TeamMember[] }> {
  const client = await admin();
  const roles = await client
    .from("user_roles")
    .select("user_id, role")
    .in("role", ["admin", "super_admin"]);
  if (roles.error) throw new Error(roles.error.message);

  const byUser = new Map<string, string[]>();
  for (const row of roles.data ?? []) {
    byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row.role]);
  }
  const userIds = [...byUser.keys()];
  if (!userIds.length) return { members: [] };

  const [profiles, emails] = await Promise.all([
    client.from("profiles").select("id, preferred_name").in("id", userIds),
    emailsFor(userIds),
  ]);
  if (profiles.error) throw new Error(profiles.error.message);
  const names = new Map((profiles.data ?? []).map((p) => [p.id, p.preferred_name]));

  return {
    members: userIds
      .map((id) => ({
        user_id: id,
        email: emails.get(id) ?? null,
        preferred_name: names.get(id) ?? null,
        roles: (byUser.get(id) ?? []).sort(),
      }))
      .sort((a, b) => {
        const aSuper = a.roles.includes("super_admin") ? 0 : 1;
        const bSuper = b.roles.includes("super_admin") ? 0 : 1;
        if (aSuper !== bSuper) return aSuper - bSuper;
        return (a.email ?? "").localeCompare(b.email ?? "");
      }),
  };
}

/** Search by account email or preferred name so a super_admin can grant roles. */
export async function searchUsersForRoles(query: string): Promise<RoleSearchResult[]> {
  const term = query.trim().toLowerCase();
  if (term.length < 2) return [];
  const client = await admin();

  const matches = new Map<string, { email: string | null; preferred_name: string | null }>();

  const accounts = await client.auth.admin.listUsers({ page: 1, perPage: 200 });
  for (const user of accounts.data?.users ?? []) {
    if ((user.email ?? "").toLowerCase().includes(term)) {
      matches.set(user.id, { email: user.email ?? null, preferred_name: null });
    }
  }

  const profiles = await client
    .from("profiles")
    .select("id, preferred_name")
    .ilike("preferred_name", `%${term}%`)
    .limit(20);
  if (profiles.error) throw new Error(profiles.error.message);
  for (const profile of profiles.data ?? []) {
    matches.set(profile.id, {
      email: matches.get(profile.id)?.email ?? null,
      preferred_name: profile.preferred_name,
    });
  }

  const ids = [...matches.keys()].slice(0, 20);
  if (!ids.length) return [];

  const [roles, emails, names] = await Promise.all([
    client.from("user_roles").select("user_id, role").in("user_id", ids),
    emailsFor(ids),
    client.from("profiles").select("id, preferred_name").in("id", ids),
  ]);
  if (roles.error) throw new Error(roles.error.message);
  const nameMap = new Map((names.data ?? []).map((p) => [p.id, p.preferred_name]));

  return ids.map((id) => ({
    user_id: id,
    email: emails.get(id) ?? null,
    preferred_name: nameMap.get(id) ?? null,
    roles: (roles.data ?? []).filter((r) => r.user_id === id).map((r) => r.role).sort(),
  }));
}

export async function setUserRole(input: {
  targetUserId: string;
  role: "admin" | "super_admin";
  grant: boolean;
}): Promise<void> {
  const client = await admin();
  if (input.grant) {
    const { error } = await client
      .from("user_roles")
      .insert({ user_id: input.targetUserId, role: input.role });
    // Duplicate grant is a no-op, not an error.
    if (error && !error.message.includes("duplicate key")) throw new Error(error.message);
    return;
  }

  const { error } = await client
    .from("user_roles")
    .delete()
    .eq("user_id", input.targetUserId)
    .eq("role", input.role);
  if (error) throw new Error(error.message);
}

/** Guard against removing the last super_admin and locking everyone out. */
export async function countSuperAdmins(): Promise<number> {
  const client = await admin();
  const { count, error } = await client
    .from("user_roles")
    .select("id", { count: "exact", head: true })
    .eq("role", "super_admin");
  if (error) throw new Error(error.message);
  return count ?? 0;
}
