import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";

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

function clients(request: Request) {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const publishableKey = envKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
  const secretKey = envKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !publishableKey || !secretKey) throw new Error("Server configuration is incomplete");
  const authorization = request.headers.get("Authorization") || "";
  return {
    userClient: createClient(url, publishableKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    }),
    admin: createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } }),
    token: authorization.replace(/^Bearer\s+/i, ""),
  };
}

async function authenticate(request: Request) {
  const { userClient, admin, token } = clients(request);
  if (!token) throw new Error("Sign in required");
  const { data: { user }, error: userError } = await userClient.auth.getUser(token);
  if (userError || !user) throw new Error("Your sign-in session is no longer valid");
  const { data: profile, error: profileError } = await userClient.from("profiles")
    .select("id,role,is_active,access_status").eq("id", user.id).single();
  if (profileError || !profile) throw new Error("A community profile is required");
  return { user, profile, admin };
}

async function vapidKeys(admin: ReturnType<typeof createClient>) {
  const configured = {
    publicKey: Deno.env.get("VAPID_PUBLIC_KEY") || "",
    privateKey: Deno.env.get("VAPID_PRIVATE_KEY") || "",
  };
  if (configured.publicKey && configured.privateKey) return configured;
  const { data: saved, error: readError } = await admin.from("notification_push_config")
    .select("public_key,private_key").eq("singleton", true).maybeSingle();
  if (readError) throw readError;
  if (saved) return { publicKey: saved.public_key, privateKey: saved.private_key };
  const generated = webpush.generateVAPIDKeys();
  const { error: insertError } = await admin.from("notification_push_config").insert({
    singleton: true, public_key: generated.publicKey, private_key: generated.privateKey,
  });
  if (!insertError) return generated;
  if (insertError.code === "23505") {
    const { data: winner, error } = await admin.from("notification_push_config")
      .select("public_key,private_key").eq("singleton", true).single();
    if (error) throw error;
    return { publicKey: winner.public_key, privateKey: winner.private_key };
  }
  throw insertError;
}

const cleanEndpoint = (value: unknown) => {
  const endpoint = String(value || "").trim();
  if (!endpoint.startsWith("https://")) throw new Error("Invalid push endpoint");
  return endpoint;
};

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  let dispatchAdmin: ReturnType<typeof createClient> | null = null;
  let dispatchAlertId = "";
  try {
    const input = await request.json().catch(() => ({}));
    const { user, profile, admin } = await authenticate(request);
    const action = String(input.action || "");

    if (["config", "status", "subscribe", "unsubscribe"].includes(action) && profile.access_status === "revoked") {
      return json({ ok: false, error: "This account no longer has notification access" }, 403);
    }

    if (action === "config") {
      const keys = await vapidKeys(admin);
      return json({ ok: true, publicKey: keys.publicKey });
    }

    if (action === "status") {
      const endpoint = cleanEndpoint(input.endpoint);
      const { data, error } = await admin.from("push_subscriptions").select("enabled")
        .eq("user_id", user.id).eq("endpoint", endpoint).maybeSingle();
      if (error) throw error;
      return json({ ok: true, enabled: !!data?.enabled });
    }

    if (action === "subscribe") {
      const endpoint = cleanEndpoint(input.endpoint);
      const p256dh = String(input.p256dh || ""), auth = String(input.auth || "");
      if (!p256dh || !auth) return json({ ok: false, error: "Push keys are missing" }, 400);
      const { error } = await admin.from("push_subscriptions").upsert({
        user_id: user.id, endpoint, p256dh, auth,
        device_label: String(input.deviceLabel || "Web browser").slice(0, 80),
        user_agent: String(input.userAgent || "").slice(0, 300),
        enabled: true, failure_count: 0, updated_at: new Date().toISOString(),
      }, { onConflict: "endpoint" });
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "unsubscribe") {
      const endpoint = cleanEndpoint(input.endpoint);
      const { error } = await admin.from("push_subscriptions").update({
        enabled: false, updated_at: new Date().toISOString(),
      }).eq("user_id", user.id).eq("endpoint", endpoint);
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "access-decision") {
      if (profile.role !== "admin" || !profile.is_active || profile.access_status !== "active") {
        return json({ ok: false, error: "Active administrator access is required" }, 403);
      }
      const targetId = String(input.userId || ""), decision = String(input.decision || "");
      if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(targetId)) return json({ ok: false, error: "Invalid member" }, 400);
      if (targetId === user.id) return json({ ok: false, error: "You cannot change your own access" }, 409);
      const transitions: Record<string, { from: string; status: string; active: boolean; title: string; body: string }> = {
        approve: { from: "pending", status: "active", active: true, title: "BSD #7 access approved", body: "Your community assistance account has been approved. You can sign in now." },
        deny: { from: "pending", status: "revoked", active: false, title: "BSD #7 access decision", body: "Your community assistance account request was not approved. Contact the district with questions." },
        revoke: { from: "active", status: "revoked", active: false, title: "BSD #7 access changed", body: "Access to your community assistance account has been revoked. Contact the district with questions." },
        restore: { from: "revoked", status: "active", active: true, title: "BSD #7 access restored", body: "Access to your community assistance account has been restored. You can sign in now." },
      };
      const transition = transitions[decision];
      if (!transition) return json({ ok: false, error: "Invalid access decision" }, 400);
      const { data: target, error: targetError } = await admin.from("profiles")
        .select("id,access_status,is_active").eq("id", targetId).maybeSingle();
      if (targetError) throw targetError;
      if (!target) return json({ ok: false, error: "Member not found" }, 404);
      if (target.access_status !== transition.from) {
        if (target.access_status === transition.status && target.is_active === transition.active) return json({ ok: true, alreadyApplied: true, delivered: 0, failed: 0 });
        return json({ ok: false, error: "That access decision is not valid for the member's current status" }, 409);
      }
      const { error: updateError } = await admin.from("profiles").update({
        access_status: transition.status, is_active: transition.active, updated_at: new Date().toISOString(),
      }).eq("id", targetId).eq("access_status", transition.from);
      if (updateError) throw updateError;
      await admin.from("audit_logs").insert({
        actor_id: user.id, action: `member.access_${decision}`, entity_type: "profile", entity_id: targetId,
        details: { from: transition.from, to: transition.status },
      });
      let delivered = 0, failed = 0, notificationError = "";
      try {
        const { data: subscriptions, error: subscriptionsError } = await admin.from("push_subscriptions")
          .select("id,endpoint,p256dh,auth,failure_count").eq("user_id", targetId).eq("enabled", true);
        if (subscriptionsError) throw subscriptionsError;
        if (subscriptions?.length) {
          const keys = await vapidKeys(admin);
          webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") || "https://github.com/CGrant10/bsd-test", keys.publicKey, keys.privateKey);
          const payload = JSON.stringify({ title: transition.title, body: transition.body });
          await Promise.all(subscriptions.map(async row => {
            try {
              await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, payload, { TTL: 86400, urgency: "normal" });
              delivered++;
              await admin.from("push_subscriptions").update({ failure_count: 0, last_success_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", row.id);
            } catch (cause) {
              failed++;
              const statusCode = Number((cause as { statusCode?: number })?.statusCode || 0), failureCount = Number(row.failure_count || 0) + 1;
              await admin.from("push_subscriptions").update({ enabled: ![404, 410].includes(statusCode) && failureCount < 3, failure_count: failureCount, updated_at: new Date().toISOString() }).eq("id", row.id);
            }
          }));
        }
      } catch (notificationCause) {
        notificationError = notificationCause instanceof Error ? notificationCause.message : "Decision notification could not be delivered";
        console.error("access-decision-notification", notificationCause);
      }
      return json({ ok: true, delivered, failed, notificationError });
    }

    if (!["send-alert", "send-all-clear"].includes(action)) return json({ ok: false, error: "Unknown action" }, 400);
    if (!profile.is_active || profile.access_status !== "active" || !["approver", "admin"].includes(profile.role)) {
      return json({ ok: false, error: "Approver access is required" }, 403);
    }
    const alertId = String(input.alertId || "");
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(alertId)) return json({ ok: false, error: "Invalid alert" }, 400);
    const { data: alert, error: alertError } = await admin.from("alerts")
      .select("id,title,description,child_name,status,is_public").eq("id", alertId).single();
    if (alertError) throw alertError;
    if (action === "send-alert" && (alert.status !== "active" || !alert.is_public)) {
      return json({ ok: false, error: "Only active public alerts can be delivered" }, 409);
    }
    if (action === "send-all-clear" && !["closed", "located"].includes(alert.status)) {
      return json({ ok: false, error: "Only cleared alerts can send an all-clear" }, 409);
    }
    dispatchAdmin = admin;
    dispatchAlertId = alertId;

    const { data: existing, error: dispatchReadError } = await admin.from("alert_notification_sends")
      .select("status,delivered,failed").eq("alert_id", alertId).maybeSingle();
    if (dispatchReadError) throw dispatchReadError;
    if (action === "send-alert" && existing && existing.status !== "failed") {
      return json({ ok: true, alreadyDispatched: true, delivered: existing.delivered, failed: existing.failed });
    }
    if (existing) {
      const { error } = await admin.from("alert_notification_sends").update({ status: "sending", updated_at: new Date().toISOString() }).eq("alert_id", alertId);
      if (error) throw error;
    } else {
      const { error } = await admin.from("alert_notification_sends").insert({ alert_id: alertId, status: "sending" });
      if (error?.code === "23505") return json({ ok: true, alreadyDispatched: true, delivered: 0, failed: 0 });
      if (error) throw error;
    }

    const keys = await vapidKeys(admin);
    webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") || "https://github.com/CGrant10/bsd-test", keys.publicKey, keys.privateKey);
    const { data: subscriptions, error: subscriptionsError } = await admin.from("push_subscriptions")
      .select("id,endpoint,p256dh,auth,failure_count").eq("enabled", true);
    if (subscriptionsError) throw subscriptionsError;
    const title = action === "send-all-clear"
      ? "BSD #7 all clear"
      : alert.child_name ? `Community alert: ${alert.child_name}` : (alert.title || "BSD #7 Community Alert");
    const body = action === "send-all-clear"
      ? `${alert.child_name || "The student"} has been located. The Community Assistance alert is now all clear.`
      : String(alert.description || "A new verified community alert is available.").trim().slice(0, 180);
    const payload = JSON.stringify({ title, body, alertId: alert.id });
    let delivered = 0, failed = 0;
    const rows = subscriptions || [];
    for (let start = 0; start < rows.length; start += 50) {
      await Promise.all(rows.slice(start, start + 50).map(async row => {
        try {
          await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, payload, { TTL: 86400, urgency: "high" });
          delivered++;
          await admin.from("push_subscriptions").update({ failure_count: 0, last_success_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", row.id);
        } catch (cause) {
          failed++;
          const statusCode = Number((cause as { statusCode?: number })?.statusCode || 0);
          const failureCount = Number(row.failure_count || 0) + 1;
          await admin.from("push_subscriptions").update({ enabled: ![404, 410].includes(statusCode) && failureCount < 3, failure_count: failureCount, updated_at: new Date().toISOString() }).eq("id", row.id);
        }
      }));
    }
    await admin.from("alert_notification_sends").update({ status: "sent", delivered, failed, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("alert_id", alertId);
    return json({ ok: true, delivered, failed });
  } catch (error) {
    if (dispatchAdmin && dispatchAlertId) {
      try {
        await dispatchAdmin.from("alert_notification_sends").update({
          status: "failed", updated_at: new Date().toISOString(),
        }).eq("alert_id", dispatchAlertId);
      } catch { /* preserve the original delivery error */ }
    }
    console.error("alert-notifications", error);
    return json({ ok: false, error: error instanceof Error ? error.message : "Notification request failed" }, 500);
  }
});
