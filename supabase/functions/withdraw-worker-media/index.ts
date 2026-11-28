import { createClient } from "npm:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL")!;
const publishableKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const storageKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors = {
  "Access-Control-Allow-Origin": "https://saahl20str-oss.github.io",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers: cors });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  const auth = request.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return reply({ error: "Authentication required" }, 401);
  const userClient = createClient(url, publishableKey, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: session, error: authError } = await userClient.auth.getUser(auth.slice(7));
  if (authError || !session.user) return reply({ error: "Authentication required" }, 401);

  const input = await request.json().catch(() => null);
  if (!input || typeof input.workerId !== "string" ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(input.workerId) ||
      (input.full !== null && typeof input.full !== "boolean")) {
    return reply({ error: "Invalid request" }, 400);
  }
  const { data, error } = await userClient.rpc("saahl2_withdraw_worker_media", {
    p_worker: input.workerId, p_full: input.full,
  });
  if (error) return reply({ error: "Could not update worker publication" }, error.code === "42501" ? 403 : 500);

  const admin = createClient(url, storageKey, { auth: { persistSession: false } });
  const publicPhotos = admin.storage.from("saahl-office-media");
  let pending = Number(data.waiting);

  for (const path of data.paths as string[]) {
    const destination = "withdrawn/" + path;
    try {
      const { error: moveError } = await publicPhotos.move(path, destination, {
        destinationBucket: "saahl-worker-drafts",
      });
      if (moveError) {
        // Requests can be replayed after Storage succeeds but before the receipt is saved.
        const current = await publicPhotos.exists(path);
        if (current.data !== false) continue;
      }
      const { error: markError } = await admin.rpc("saahl2_mark_worker_media_moved", {
        p_worker: input.workerId, p_path: path,
      });
      if (!markError) pending--;
    } catch {
      // Leave unconfirmed objects pending for a subsequent retry.
    }
  }
  return reply({ pending });
});