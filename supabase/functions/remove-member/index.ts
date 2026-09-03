import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: corsHeaders });

function envKey(name: "SUPABASE_PUBLISHABLE_KEYS" | "SUPABASE_SECRET_KEYS", legacy: string) {
  try {
    const keys = JSON.parse(Deno.env.get(name) || "{}");
    if (keys.default) return keys.default as string;
  } catch { /* use the legacy environment name */ }
  return Deno.env.get(legacy) || "";
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL") || "";
    const publishableKey = envKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
    const secretKey = envKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !publishableKey || !secretKey) throw new Error("Server configuration is incomplete");
    const authorization = request.headers.get("Authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    if (!token) return json({ ok: false, error: "Sign in required" }, 401);
    const userClient = createClient(url, publishableKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: userError } = await userClient.auth.getUser(token);
    if (userError || !user) return json({ ok: false, error: "Your sign-in session is no longer valid" }, 401);
    const { data: actor, error: actorError } = await userClient.from("profiles")
      .select("id,role,is_active,access_status").eq("id", user.id).single();
    if (actorError || actor?.role !== "admin" || !actor.is_active || actor.access_status !== "active") {
      return json({ ok: false, error: "Active administrator access is required" }, 403);
    }
    const { userId } = await request.json().catch(() => ({}));
    const targetId = String(userId || "");
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(targetId)) return json({ ok: false, error: "Invalid member" }, 400);
    if (targetId === user.id) return json({ ok: false, error: "You cannot remove your own account" }, 409);
    const { data: target, error: targetError } = await admin.from("profiles")
      .select("id,is_active,access_status").eq("id", targetId).maybeSingle();
    if (targetError) throw targetError;
    if (!target) return json({ ok: true, alreadyRemoved: true });
    if (target.is_active || target.access_status !== "revoked") {
      return json({ ok: false, error: "Revoke this member before removing the account" }, 409);
    }
    const { error: deleteError } = await admin.auth.admin.deleteUser(targetId);
    if (deleteError) throw deleteError;
    await admin.from("audit_logs").insert({
      actor_id: user.id,
      action: "member.permanently_removed",
      entity_type: "profile",
      entity_id: targetId,
      details: { removed_after_revocation: true },
    });
    return json({ ok: true });
  } catch (error) {
    console.error("remove-member", error);
    return json({ ok: false, error: error instanceof Error ? error.message : "Member could not be removed" }, 500);
  }
});
