import { supabase, SERVER_URL } from "./supabase";

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session?.access_token ?? ""}`,
  };
}

export async function getProfile() {
  const res = await fetch(`${SERVER_URL}/profile`, { headers: await authHeaders() });
  return res.json();
}

export async function updateProfile(data: Record<string, unknown>) {
  await fetch(`${SERVER_URL}/profile`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(data),
  });
}

export async function saveAddresses(addresses: Address[]) {
  await fetch(`${SERVER_URL}/addresses`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ addresses }),
  });
}

export async function getPhotos() {
  const res = await fetch(`${SERVER_URL}/photos`, { headers: await authHeaders() });
  return res.json();
}

export async function removePhoto(id: string) {
  await fetch(`${SERVER_URL}/photos/${id}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
}

export async function uploadPhoto(file: Blob, filename: string): Promise<{ path: string } | null> {
  const headers = await authHeaders();

  // Get signed upload URL
  const urlRes = await fetch(`${SERVER_URL}/upload-url`, {
    method: "POST",
    headers,
    body: JSON.stringify({ filename }),
  });
  if (!urlRes.ok) return null;
  const { signedUrl, path } = await urlRes.json();

  // Upload directly to storage
  const uploadRes = await fetch(signedUrl, {
    method: "PUT",
    headers: { "Content-Type": "image/jpeg" },
    body: file,
  });
  if (!uploadRes.ok) return null;

  // Register in queue
  await fetch(`${SERVER_URL}/photos`, {
    method: "POST",
    headers,
    body: JSON.stringify({ path, filename }),
  });

  return { path };
}

export async function submitOrder() {
  const res = await fetch(`${SERVER_URL}/orders/submit`, {
    method: "POST",
    headers: await authHeaders(),
  });
  return res.json();
}

export async function getOrders() {
  const res = await fetch(`${SERVER_URL}/orders`, { headers: await authHeaders() });
  return res.json();
}

// Types
export interface Photo {
  id: string;
  path: string;
  url?: string;
  filename: string;
  capturedAt: string;
  status: "queued" | "printed" | "removed";
}

export interface Order {
  id: string;
  prodigiOrderId: string | null;
  submittedAt: string;
  photoCount: number;
  status: string;
  address: Address;
  tracking: string | null;
}

export interface Address {
  id: string;
  label: string;
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  isPrimary: boolean;
}
