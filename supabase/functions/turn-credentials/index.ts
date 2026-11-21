// Returns short-lived Cloudflare TURN/STUN servers to signed-in WebDeck users.
// Secrets (set in Supabase → Edge Functions → Secrets):
//   CF_TURN_KEY_ID     Cloudflare Realtime TURN key id
//   CF_TURN_API_TOKEN  Cloudflare Realtime TURN API token
// Only signed-in users get relay credentials: the function verifies the caller's
// session itself (the gateway check doesn't apply to publishable keys).

const FALLBACK = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];
const TTL_SECONDS = 6 * 60 * 60;

async function signedInUser(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt || jwt.startsWith("sb_")) return null; // an API key, not a user session
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${jwt}`, apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "" },
  });
  if (!res.ok) return null;
  const user = await res.json();
  return typeof user?.id === "string" ? user.id : null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }
  if (!(await signedInUser(req))) {
    return Response.json({ error: "Sign in required" }, { status: 401 });
  }
  const keyId = Deno.env.get("CF_TURN_KEY_ID");
  const token = Deno.env.get("CF_TURN_API_TOKEN");
  if (!keyId || !token) {
    return Response.json({ iceServers: FALLBACK, relay: false, error: "TURN is not configured" });
  }
  try {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: TTL_SECONDS }),
      },
    );
    if (!res.ok) {
      return Response.json({ iceServers: FALLBACK, relay: false, error: `Cloudflare returned ${res.status}` });
    }
    const data = await res.json();
    // Port 53 is blocked by many browsers/WebViews; drop those URLs.
    const iceServers = (data.iceServers ?? []).map((s: { urls: string | string[] }) => ({
      ...s,
      urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u)),
    }));
    return Response.json({ iceServers, relay: true, ttl: TTL_SECONDS });
  } catch (e) {
    return Response.json({ iceServers: FALLBACK, relay: false, error: String(e) });
  }
});
