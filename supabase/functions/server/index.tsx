import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "jsr:@supabase/supabase-js@2.49.8";
import * as kv from "./kv_store.tsx";

const app = new Hono();
app.use("*", logger(console.log));
app.use("/*", cors({
  origin: "*",
  allowHeaders: ["Content-Type", "Authorization"],
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  exposeHeaders: ["Content-Length"],
  maxAge: 600,
}));

const BASE = "/make-server-b9ad3c8d";
const BUCKET = "nostalpic-photos";

// --- Auth helpers ---

function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function getUser(authHeader: string | undefined) {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const { data: { user } } = await serviceClient().auth.getUser(token);
  return user;
}

async function requireUser(c: any) {
  const user = await getUser(c.req.header("Authorization"));
  if (!user) {
    c.status(401);
    return null;
  }
  return user;
}

// --- Ensure storage bucket exists ---
async function ensureBucket() {
  const sb = serviceClient();
  const { data: buckets } = await sb.storage.listBuckets();
  if (!buckets?.find((b: any) => b.name === BUCKET)) {
    await sb.storage.createBucket(BUCKET, { public: false });
  }
}

// --- Health ---
app.get(`${BASE}/health`, (c) => c.json({ status: "ok" }));

// --- Upload URL ---
// Returns a signed URL so the client can upload directly to Supabase Storage
app.post(`${BASE}/upload-url`, async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  await ensureBucket();
  const { filename } = await c.req.json();
  const path = `${user.id}/${Date.now()}-${filename}`;
  const sb = serviceClient();
  const { data, error } = await sb.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ signedUrl: data.signedUrl, path });
});

// --- Photos ---

app.get(`${BASE}/photos`, async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const photos = (await kv.get(`photos:${user.id}`)) ?? [];
  // Generate fresh signed read URLs
  const sb = serviceClient();
  const withUrls = await Promise.all(
    photos.filter((p: any) => p.status === "queued").map(async (p: any) => {
      const { data } = await sb.storage.from(BUCKET).createSignedUrl(p.path, 3600);
      return { ...p, url: data?.signedUrl };
    }),
  );
  return c.json({ photos: withUrls });
});

app.post(`${BASE}/photos`, async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const { path, filename } = await c.req.json();
  const existing: any[] = (await kv.get(`photos:${user.id}`)) ?? [];
  const photo = {
    id: crypto.randomUUID(),
    path,
    filename,
    capturedAt: new Date().toISOString(),
    status: "queued",
  };
  await kv.set(`photos:${user.id}`, [...existing, photo]);
  return c.json({ photo });
});

app.delete(`${BASE}/photos/:id`, async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const photoId = c.req.param("id");
  const photos: any[] = (await kv.get(`photos:${user.id}`)) ?? [];
  const updated = photos.map((p: any) =>
    p.id === photoId ? { ...p, status: "removed" } : p
  );
  await kv.set(`photos:${user.id}`, updated);
  return c.json({ ok: true });
});

// --- Orders ---

app.get(`${BASE}/orders`, async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const orders = (await kv.get(`orders:${user.id}`)) ?? [];
  return c.json({ orders });
});

app.post(`${BASE}/orders/submit`, async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  // Load queued photos
  const allPhotos: any[] = (await kv.get(`photos:${user.id}`)) ?? [];
  const queued = allPhotos.filter((p: any) => p.status === "queued");
  if (queued.length === 0) return c.json({ error: "No photos queued" }, 400);

  // Load primary address
  const addresses: any[] = (await kv.get(`addresses:${user.id}`)) ?? [];
  const primary = addresses.find((a: any) => a.isPrimary) ?? addresses[0];
  if (!primary) return c.json({ error: "No shipping address saved" }, 400);

  // Generate public read URLs for Prodigi (24h signed)
  const sb = serviceClient();
  const photoItems = await Promise.all(
    queued.map(async (p: any) => {
      const { data } = await sb.storage.from(BUCKET).createSignedUrl(p.path, 86400);
      return { path: p.path, url: data?.signedUrl };
    }),
  );

  const prodigiKey = Deno.env.get("PRODIGI_API_KEY");

  let prodigiOrderId: string | null = null;
  let orderStatus = "submitted";

  if (prodigiKey) {
    // Call Prodigi API
    const orderPayload = {
      shippingMethod: "Standard",
      recipient: {
        name: primary.name,
        address: {
          line1: primary.line1,
          line2: primary.line2 ?? "",
          postalOrZipCode: primary.zip,
          stateOrCounty: primary.state ?? "",
          townOrCity: primary.city,
          countryCode: primary.country ?? "US",
        },
      },
      items: photoItems.map((p) => ({
        sku: "GLOBAL-PHO-4x6",
        copies: 1,
        sizing: "fillPrintArea",
        assets: [{ printArea: "default", url: p.url }],
      })),
    };

    const res = await fetch("https://api.prodigi.com/v4.0/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": prodigiKey,
      },
      body: JSON.stringify(orderPayload),
    });

    if (res.ok) {
      const prodigiData = await res.json();
      prodigiOrderId = prodigiData.order?.id ?? null;
    } else {
      const errText = await res.text();
      console.error("Prodigi error:", errText);
      orderStatus = "prodigi_error";
    }
  } else {
    // Sandbox mode — simulate the order
    prodigiOrderId = `SANDBOX-${Date.now()}`;
    orderStatus = "sandbox";
  }

  // Mark photos as printed
  const updatedPhotos = allPhotos.map((p: any) =>
    p.status === "queued" ? { ...p, status: "printed" } : p
  );
  await kv.set(`photos:${user.id}`, updatedPhotos);

  // Save order record
  const existingOrders: any[] = (await kv.get(`orders:${user.id}`)) ?? [];
  const order = {
    id: crypto.randomUUID(),
    prodigiOrderId,
    submittedAt: new Date().toISOString(),
    photoCount: queued.length,
    status: orderStatus,
    address: primary,
    tracking: null,
  };
  await kv.set(`orders:${user.id}`, [order, ...existingOrders]);

  // Also submit to any secondary addresses
  const secondary = addresses.filter((a: any) => !a.isPrimary);
  for (const addr of secondary) {
    if (!prodigiKey) break;
    const payload2 = {
      shippingMethod: "Standard",
      recipient: {
        name: addr.name,
        address: {
          line1: addr.line1,
          line2: addr.line2 ?? "",
          postalOrZipCode: addr.zip,
          stateOrCounty: addr.state ?? "",
          townOrCity: addr.city,
          countryCode: addr.country ?? "US",
        },
      },
      items: photoItems.map((p) => ({
        sku: "GLOBAL-PHO-4x6",
        copies: 1,
        sizing: "fillPrintArea",
        assets: [{ printArea: "default", url: p.url }],
      })),
    };
    await fetch("https://api.prodigi.com/v4.0/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": prodigiKey },
      body: JSON.stringify(payload2),
    });
  }

  return c.json({ order, photoCount: queued.length });
});

// --- Profile ---

app.get(`${BASE}/profile`, async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const profile = (await kv.get(`profile:${user.id}`)) ?? {
    name: user.email?.split("@")[0] ?? "Friend",
    plan: "basic",
    cutoffTime: "20:00",
    vacationMode: false,
  };
  const addresses = (await kv.get(`addresses:${user.id}`)) ?? [];
  return c.json({ profile, addresses, email: user.email });
});

app.post(`${BASE}/profile`, async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json();
  const existing = (await kv.get(`profile:${user.id}`)) ?? {};
  await kv.set(`profile:${user.id}`, { ...existing, ...body });
  return c.json({ ok: true });
});

app.post(`${BASE}/addresses`, async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const { addresses } = await c.req.json();
  await kv.set(`addresses:${user.id}`, addresses);
  return c.json({ ok: true });
});

Deno.serve(app.fetch);
