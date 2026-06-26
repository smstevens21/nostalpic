import { useState, useEffect, useRef, useCallback } from "react";
import {
  Camera, Package, Sparkles, Users, BookOpen, MapPin, Bell,
  Check, Star, Menu, X, ArrowRight, Zap, Heart, Download,
  LogIn, LogOut, Settings, Trash2, Send, Clock, ChevronRight,
  Plus, Home, RefreshCw, AlertCircle,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { getProfile, getPhotos, removePhoto, uploadPhoto, submitOrder, getOrders, saveAddresses } from "../lib/api";
import type { Photo, Order, Address } from "../lib/api";
import type { User, Session } from "@supabase/supabase-js";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// ─── Landing page data ───────────────────────────────────────────────────────

const HOW_IT_WORKS = [
  { step: "01", icon: Camera, title: "Open & Shoot", desc: "Use the NostalPic camera for any moment worth keeping. No filters, no fuss — just shoot." },
  { step: "02", icon: Bell, title: "Do Nothing", desc: "At 8 PM your photos are automatically queued for print. You don't lift a finger." },
  { step: "03", icon: Package, title: "Prints Arrive", desc: "Real 4×6 prints land in your mailbox in 3–5 days. That unmistakable joy of a fresh stack." },
];

const PLANS = [
  { name: "Basic", price: 9.99, annualPrice: 7.99, color: "#EDE3D6", textColor: "#1C0F07", prints: "20 prints/mo", features: ["Daily or weekly auto-print", "Standard 4×6 prints", "1 shipping address", "Edit window before cutoff"], highlight: false },
  { name: "Plus", price: 17.99, annualPrice: 14.99, color: "#7C3A1E", textColor: "#FAF7F2", prints: "50 prints/mo", features: ["Everything in Basic", "AI blur & duplicate removal", "Matte or glossy finish", "Auto mini-photobook", "Shipping discounts"], highlight: true },
  { name: "Family", price: 29.99, annualPrice: 24.99, color: "#C4692A", textColor: "#FAF7F2", prints: "100 prints/mo", features: ["Everything in Plus", "Shared event cameras", "Up to 4 shipping addresses", "Multi-household delivery"], highlight: false },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeUntilCutoff() {
  const now = new Date();
  const cutoff = new Date();
  cutoff.setHours(20, 0, 0, 0);
  if (now >= cutoff) cutoff.setDate(cutoff.getDate() + 1);
  const diff = cutoff.getTime() - now.getTime();
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return `${h}h ${m}m`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── Auth Modal ───────────────────────────────────────────────────────────────

function AuthModal({ onClose, onAuth }: { onClose: () => void; onAuth: (u: User) => void }) {
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.user) onAuth(data.user);
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (data.user) onAuth(data.user);
      }
    } catch (err: any) {
      setError(err.message ?? "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm px-4" onClick={onClose}>
      <div className="bg-card rounded-sm border border-border w-full max-w-sm p-8 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-black text-foreground" style={{ fontFamily: "'Martel', serif" }}>
            {mode === "signup" ? "Create account" : "Welcome back"}
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        <form onSubmit={handle} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              className="w-full bg-secondary border border-border text-foreground text-sm px-3 py-2.5 rounded-sm outline-none focus:border-accent transition-colors" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6}
              className="w-full bg-secondary border border-border text-foreground text-sm px-3 py-2.5 rounded-sm outline-none focus:border-accent transition-colors" />
          </div>
          {error && <p className="text-xs text-destructive flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" />{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full bg-primary text-primary-foreground text-sm py-2.5 rounded-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50">
            {loading ? "..." : mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>

        <p className="text-center text-xs text-muted-foreground mt-5">
          {mode === "signup" ? "Already have an account? " : "No account yet? "}
          <button onClick={() => setMode(mode === "signup" ? "login" : "signup")} className="text-accent underline">
            {mode === "signup" ? "Sign in" : "Sign up"}
          </button>
        </p>
      </div>
    </div>
  );
}

// ─── Camera Screen ────────────────────────────────────────────────────────────

function CameraScreen({ onPhotoCaptured }: { onPhotoCaptured: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [streaming, setStreaming] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captured, setCaptured] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);

  const startCamera = useCallback(async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setStreaming(true);
      }
    } catch {
      setError("Camera access denied. Please allow camera permission and try again.");
    }
  }, []);

  useEffect(() => {
    startCamera();
    return () => {
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      }
    };
  }, [startCamera]);

  const capture = () => {
    if (!videoRef.current || !canvasRef.current) return;
    setCapturing(true);
    const v = videoRef.current;
    const c = canvasRef.current;
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    setCaptured(c.toDataURL("image/jpeg", 0.85));
    setCapturing(false);
  };

  const retake = () => setCaptured(null);

  const save = async () => {
    if (!captured || !canvasRef.current) return;
    setUploading(true);
    canvasRef.current.toBlob(async (blob) => {
      if (!blob) { setUploading(false); return; }
      const result = await uploadPhoto(blob, `photo-${Date.now()}.jpg`);
      setUploading(false);
      if (result) {
        setCaptured(null);
        onPhotoCaptured();
      }
    }, "image/jpeg", 0.85);
  };

  return (
    <div className="flex flex-col h-full bg-black">
      <canvas ref={canvasRef} className="hidden" />

      {captured ? (
        <>
          <div className="flex-1 relative">
            <img src={captured} alt="Captured photo" className="w-full h-full object-contain" />
            <div className="absolute top-4 left-0 right-0 text-center">
              <span className="bg-black/50 text-white text-xs px-3 py-1 rounded-full">Preview</span>
            </div>
          </div>
          <div className="flex gap-3 p-6 bg-black">
            <button onClick={retake} className="flex-1 border border-white/30 text-white text-sm py-3 rounded-sm font-medium">
              Retake
            </button>
            <button onClick={save} disabled={uploading}
              className="flex-1 bg-primary text-primary-foreground text-sm py-3 rounded-sm font-semibold disabled:opacity-50">
              {uploading ? "Saving..." : "Add to queue"}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex-1 relative bg-black">
            {streaming ? (
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            ) : error ? (
              <div className="flex items-center justify-center h-full flex-col gap-3 px-8 text-center">
                <AlertCircle className="w-8 h-8 text-white/50" />
                <p className="text-white/70 text-sm">{error}</p>
                <button onClick={startCamera} className="text-white text-sm underline">Try again</button>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              </div>
            )}
            {/* Viewfinder corners */}
            {streaming && (
              <div className="absolute inset-6 pointer-events-none">
                <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-white/60" />
                <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-white/60" />
                <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-white/60" />
                <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-white/60" />
              </div>
            )}
          </div>

          <div className="flex items-center justify-center gap-8 py-8 bg-black">
            <div className="w-10 h-10" />
            <button
              onClick={capture}
              disabled={!streaming || capturing}
              className="w-18 h-18 rounded-full bg-white flex items-center justify-center disabled:opacity-40 active:scale-95 transition-transform"
              style={{ width: 72, height: 72 }}
            >
              <div className="w-16 h-16 rounded-full border-4 border-black/20 bg-white" />
            </button>
            <div className="w-10 h-10" />
          </div>
        </>
      )}
    </div>
  );
}

// ─── Queue Screen ─────────────────────────────────────────────────────────────

function QueueScreen({ onSubmitted }: { onSubmitted: () => void }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ photoCount: number; status: string } | null>(null);
  const [countdown, setCountdown] = useState(timeUntilCutoff());
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const data = await getPhotos();
    setPhotos(data.photos ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const t = setInterval(() => setCountdown(timeUntilCutoff()), 30000);
    return () => clearInterval(t);
  }, []);

  const handleRemove = async (id: string) => {
    await removePhoto(id);
    setPhotos((p) => p.filter((ph) => ph.id !== id));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError("");
    const data = await submitOrder();
    if (data.error) {
      setError(data.error);
    } else {
      setResult({ photoCount: data.photoCount, status: data.order?.status });
      onSubmitted();
    }
    setSubmitting(false);
  };

  if (result) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-8 text-center gap-6">
        <div className="w-16 h-16 bg-primary rounded-full flex items-center justify-center">
          <Check className="w-8 h-8 text-primary-foreground" />
        </div>
        <div>
          <h2 className="text-2xl font-black text-foreground mb-2" style={{ fontFamily: "'Martel', serif" }}>
            {result.photoCount} photos sent to print!
          </h2>
          <p className="text-muted-foreground text-sm">
            {result.status === "sandbox"
              ? "Running in sandbox mode — add your Prodigi API key to send real orders."
              : "Your prints are on their way to the lab. Expect them in 3–5 days."}
          </p>
        </div>
        <button onClick={() => { setResult(null); load(); }}
          className="text-sm text-accent underline">Start a new queue</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Cutoff banner */}
      <div className="bg-secondary border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-accent" />
          <span className="text-sm font-medium text-foreground">Auto-print in {countdown}</span>
        </div>
        <span className="text-xs text-muted-foreground">8:00 PM cutoff</span>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-border border-t-accent rounded-full animate-spin" />
        </div>
      ) : photos.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-4">
          <Camera className="w-10 h-10 text-muted-foreground/40" />
          <p className="text-muted-foreground text-sm">No photos queued yet.<br />Head to the camera tab and shoot something.</p>
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto">
            <div className="p-4 grid grid-cols-3 gap-2">
              {photos.map((photo) => (
                <div key={photo.id} className="relative group aspect-square bg-muted rounded-sm overflow-hidden">
                  {photo.url ? (
                    <img src={photo.url} alt="Queued photo" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Camera className="w-6 h-6 text-muted-foreground/40" />
                    </div>
                  )}
                  <button
                    onClick={() => handleRemove(photo.id)}
                    className="absolute top-1 right-1 w-6 h-6 bg-black/60 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3 h-3 text-white" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="p-4 border-t border-border space-y-2">
            {error && <p className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" />{error}</p>}
            <button onClick={handleSubmit} disabled={submitting}
              className="w-full bg-primary text-primary-foreground py-3 rounded-sm font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50 transition-opacity">
              {submitting ? <><RefreshCw className="w-4 h-4 animate-spin" /> Submitting...</> : <><Send className="w-4 h-4" /> Print {photos.length} photo{photos.length !== 1 ? "s" : ""} now</>}
            </button>
            <p className="text-center text-xs text-muted-foreground">Or wait — they auto-print at 8 PM</p>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Orders Screen ────────────────────────────────────────────────────────────

function OrdersScreen() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getOrders().then((d) => { setOrders(d.orders ?? []); setLoading(false); });
  }, []);

  if (loading) return <div className="flex-1 flex items-center justify-center"><div className="w-6 h-6 border-2 border-border border-t-accent rounded-full animate-spin" /></div>;

  if (orders.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-4 h-full">
        <Package className="w-10 h-10 text-muted-foreground/40" />
        <p className="text-muted-foreground text-sm">No orders yet.<br />Your first prints will show up here once submitted.</p>
      </div>
    );
  }

  const statusLabel: Record<string, { label: string; color: string }> = {
    submitted: { label: "Processing", color: "text-amber-600 bg-amber-50" },
    sandbox: { label: "Sandbox", color: "text-blue-600 bg-blue-50" },
    prodigi_error: { label: "Error", color: "text-red-600 bg-red-50" },
    shipped: { label: "Shipped", color: "text-green-600 bg-green-50" },
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {orders.map((order) => {
        const st = statusLabel[order.status] ?? { label: order.status, color: "text-muted-foreground bg-muted" };
        return (
          <div key={order.id} className="bg-card border border-border rounded-sm p-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-sm font-semibold text-foreground">{order.photoCount} prints</p>
                <p className="text-xs text-muted-foreground">{formatDate(order.submittedAt)}</p>
              </div>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${st.color}`}>{st.label}</span>
            </div>
            <p className="text-xs text-muted-foreground">To: {order.address?.name} · {order.address?.city}, {order.address?.state}</p>
            {order.prodigiOrderId && (
              <p className="text-xs text-muted-foreground mt-1">Order: {order.prodigiOrderId}</p>
            )}
            {order.tracking && (
              <p className="text-xs text-accent mt-1 font-medium">Tracking: {order.tracking}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Settings Screen ──────────────────────────────────────────────────────────

function SettingsScreen({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAddr, setNewAddr] = useState({ label: "Home", name: "", line1: "", city: "", state: "", zip: "", country: "US", isPrimary: true });

  useEffect(() => {
    getProfile().then((d) => setAddresses(d.addresses ?? []));
  }, []);

  const addAddress = async () => {
    if (!newAddr.name || !newAddr.line1 || !newAddr.city || !newAddr.zip) return;
    const addr: Address = { ...newAddr, id: crypto.randomUUID(), line2: "", isPrimary: addresses.length === 0 };
    const updated = [...addresses, addr];
    setAddresses(updated);
    setSaving(true);
    await saveAddresses(updated);
    setSaving(false);
    setSaved(true);
    setShowAddForm(false);
    setTimeout(() => setSaved(false), 2000);
  };

  const removeAddress = async (id: string) => {
    const updated = addresses.filter((a) => a.id !== id);
    setAddresses(updated);
    await saveAddresses(updated);
  };

  const setPrimary = async (id: string) => {
    const updated = addresses.map((a) => ({ ...a, isPrimary: a.id === id }));
    setAddresses(updated);
    await saveAddresses(updated);
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-6">
      {/* Account */}
      <section>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Account</h3>
        <div className="bg-card border border-border rounded-sm divide-y divide-border">
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-foreground">{email}</span>
          </div>
          <button onClick={onSignOut} className="w-full px-4 py-3 flex items-center gap-2 text-destructive text-sm hover:bg-muted transition-colors">
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </section>

      {/* Addresses */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Shipping Addresses</h3>
          <button onClick={() => setShowAddForm(!showAddForm)} className="text-xs text-accent font-semibold flex items-center gap-1">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>

        {showAddForm && (
          <div className="bg-card border border-border rounded-sm p-4 mb-3 space-y-2">
            <p className="text-xs font-semibold text-foreground mb-2">New address</p>
            {[
              { key: "label", label: "Label (e.g. Home, Grandma)", placeholder: "Home" },
              { key: "name", label: "Recipient name", placeholder: "Emily Rodriguez" },
              { key: "line1", label: "Street address", placeholder: "123 Main St" },
              { key: "city", label: "City", placeholder: "Brooklyn" },
              { key: "state", label: "State", placeholder: "NY" },
              { key: "zip", label: "ZIP code", placeholder: "11201" },
            ].map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="block text-xs text-muted-foreground mb-0.5">{label}</label>
                <input
                  value={(newAddr as any)[key]}
                  onChange={(e) => setNewAddr((p) => ({ ...p, [key]: e.target.value }))}
                  placeholder={placeholder}
                  className="w-full bg-secondary border border-border text-foreground text-sm px-3 py-2 rounded-sm outline-none focus:border-accent text-xs"
                />
              </div>
            ))}
            <div className="flex gap-2 pt-1">
              <button onClick={addAddress} disabled={saving}
                className="flex-1 bg-primary text-primary-foreground text-xs py-2 rounded-sm font-semibold disabled:opacity-50">
                {saving ? "Saving..." : "Save address"}
              </button>
              <button onClick={() => setShowAddForm(false)} className="text-xs text-muted-foreground px-3">Cancel</button>
            </div>
          </div>
        )}

        {addresses.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3 text-center">No addresses saved yet. Add one above.</p>
        ) : (
          <div className="space-y-2">
            {addresses.map((addr) => (
              <div key={addr.id} className="bg-card border border-border rounded-sm px-4 py-3 flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold text-foreground">{addr.label}</span>
                    {addr.isPrimary && <span className="text-xs bg-primary text-primary-foreground px-1.5 py-0.5 rounded-sm">Primary</span>}
                  </div>
                  <p className="text-xs text-muted-foreground">{addr.name}</p>
                  <p className="text-xs text-muted-foreground">{addr.line1}, {addr.city}, {addr.state} {addr.zip}</p>
                </div>
                <div className="flex flex-col gap-1 items-end ml-3">
                  {!addr.isPrimary && (
                    <button onClick={() => setPrimary(addr.id)} className="text-xs text-accent">Set primary</button>
                  )}
                  <button onClick={() => removeAddress(addr.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {saved && <p className="text-xs text-green-600 text-center mt-2 flex items-center justify-center gap-1"><Check className="w-3.5 h-3.5" /> Saved</p>}
      </section>

      {/* Print info */}
      <section>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">About prints</h3>
        <div className="bg-card border border-border rounded-sm px-4 py-3 space-y-2 text-xs text-muted-foreground">
          <p>4×6 standard prints, glossy finish.</p>
          <p>Fulfilled by Prodigi print labs, delivered in 3–5 business days.</p>
          <p>Auto-print cutoff is 8:00 PM local time daily.</p>
        </div>
      </section>
    </div>
  );
}

// ─── Main App (authenticated) ─────────────────────────────────────────────────

type AppTab = "camera" | "queue" | "orders" | "settings";

function NostalPicApp({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const [tab, setTab] = useState<AppTab>("camera");
  const [queueCount, setQueueCount] = useState(0);

  const refreshQueueCount = useCallback(async () => {
    const data = await getPhotos();
    setQueueCount((data.photos ?? []).length);
  }, []);

  useEffect(() => { refreshQueueCount(); }, [refreshQueueCount]);

  const tabs: { id: AppTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "camera", label: "Camera", icon: Camera },
    { id: "queue", label: "Queue", icon: Package },
    { id: "orders", label: "Orders", icon: BookOpen },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="flex flex-col h-screen bg-background" style={{ fontFamily: "'Assistant', sans-serif" }}>
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
        <span className="text-lg font-black text-foreground" style={{ fontFamily: "'Martel', serif", fontWeight: 800 }}>NostalPic</span>
        {tab === "queue" && queueCount > 0 && (
          <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full font-medium">
            {queueCount} queued
          </span>
        )}
      </header>

      {/* Screen */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {tab === "camera" && <CameraScreen onPhotoCaptured={() => { refreshQueueCount(); setTab("queue"); }} />}
        {tab === "queue" && <QueueScreen onSubmitted={refreshQueueCount} />}
        {tab === "orders" && <OrdersScreen />}
        {tab === "settings" && <SettingsScreen email={user.email ?? ""} onSignOut={onSignOut} />}
      </div>

      {/* Bottom tab bar */}
      <nav className="flex border-t border-border bg-card pb-safe" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex-1 flex flex-col items-center py-2.5 gap-1 transition-colors ${tab === id ? "text-primary" : "text-muted-foreground"}`}>
            <div className="relative">
              <Icon className="w-5 h-5" />
              {id === "queue" && queueCount > 0 && (
                <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-accent rounded-full text-[9px] text-white flex items-center justify-center font-bold">
                  {queueCount > 9 ? "9+" : queueCount}
                </span>
              )}
            </div>
            <span className="text-[10px] font-medium">{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

// ─── Landing Page ─────────────────────────────────────────────────────────────

function LandingPage({ onSignIn }: { onSignIn: () => void }) {
  const [annual, setAnnual] = useState(false);
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ fontFamily: "'Assistant', sans-serif" }}>
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/90 backdrop-blur-sm border-b border-border">
        <div className="max-w-6xl mx-auto px-5 flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-sm flex items-center justify-center">
              <Camera className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="text-xl font-black text-foreground" style={{ fontFamily: "'Martel', serif", fontWeight: 800 }}>NostalPic</span>
          </div>
          <div className="hidden md:flex items-center gap-8">
            {["How it works", "Pricing"].map((l) => (
              <a key={l} href={`#${l.toLowerCase().replace(" ", "-")}`} className="text-sm text-muted-foreground hover:text-foreground transition-colors">{l}</a>
            ))}
          </div>
          <div className="hidden md:flex items-center gap-3">
            <button onClick={onSignIn} className="text-sm text-muted-foreground hover:text-foreground transition-colors">Log in</button>
            <button onClick={onSignIn} className="bg-primary text-primary-foreground text-sm px-4 py-2 rounded-sm hover:opacity-90 font-medium">Get started</button>
          </div>
          <button className="md:hidden" onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
        {menuOpen && (
          <div className="md:hidden bg-card border-t border-border px-5 py-4 flex flex-col gap-3">
            <button onClick={() => { onSignIn(); setMenuOpen(false); }} className="bg-primary text-primary-foreground text-sm px-4 py-2 rounded-sm text-center font-medium">Get started free</button>
          </div>
        )}
      </nav>

      {/* Hero */}
      <section className="pt-28 pb-20 px-5 max-w-6xl mx-auto">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 bg-secondary text-secondary-foreground text-xs px-3 py-1.5 rounded-sm font-medium mb-6 border border-border">
              <Zap className="w-3 h-3 text-accent" />Zero-friction photo printing
            </div>
            <h1 className="text-5xl md:text-6xl leading-[1.08] mb-6" style={{ fontFamily: "'Martel', serif", fontWeight: 900 }}>
              Shoot your day.<br /><span className="text-accent">Prints arrive.</span><br />That&apos;s it.
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed mb-8 max-w-md">
              NostalPic automatically prints and ships your daily photos. No sorting, no selecting — modern life, disposable-camera soul.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 max-w-sm">
              <button onClick={onSignIn} className="flex-1 bg-primary text-primary-foreground text-sm px-5 py-3 rounded-sm hover:opacity-90 font-semibold flex items-center justify-center gap-1.5">
                Start for free <ArrowRight className="w-3.5 h-3.5" />
              </button>
              <button onClick={onSignIn} className="flex-1 border border-border text-foreground text-sm px-5 py-3 rounded-sm hover:bg-secondary transition-colors font-medium">
                Sign in
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-3">First set of prints free. No credit card required.</p>
          </div>

          {/* Polaroids */}
          <div className="relative h-[420px] hidden md:block">
            <div className="absolute top-0 right-4 w-60 shadow-xl rounded-sm overflow-hidden border-4 border-card" style={{ transform: "rotate(1.5deg)" }}>
              <img src="https://images.unsplash.com/photo-1528569937393-ee892b976859?w=400&h=480&fit=crop&auto=format" alt="Family photo album" className="w-full h-64 object-cover" />
              <div className="bg-card py-3 px-3 text-xs text-muted-foreground" style={{ fontFamily: "'Martel', serif" }}>Summer 2024 ✦</div>
            </div>
            <div className="absolute bottom-4 left-0 w-48 shadow-lg rounded-sm overflow-hidden border-4 border-card" style={{ transform: "rotate(-2deg)" }}>
              <img src="https://images.unsplash.com/photo-1621176244729-644a73b56dfe?w=400&h=300&fit=crop&auto=format" alt="Mother and child" className="w-full h-44 object-cover" />
              <div className="bg-card py-3 px-3 text-xs text-muted-foreground" style={{ fontFamily: "'Martel', serif" }}>Saturday ✦</div>
            </div>
            <div className="absolute top-4 left-2 bg-card border border-border shadow-md rounded-full px-3 py-2 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs font-medium">14 prints queued</span>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="py-20 bg-secondary/40">
        <div className="max-w-6xl mx-auto px-5">
          <p className="text-accent text-sm font-semibold uppercase tracking-widest mb-3">How it works</p>
          <h2 className="text-4xl font-black text-foreground mb-12 max-w-lg" style={{ fontFamily: "'Martel', serif" }}>Three steps. You only do one.</h2>
          <div className="grid md:grid-cols-3 gap-px bg-border">
            {HOW_IT_WORKS.map(({ step, icon: Icon, title, desc }) => (
              <div key={step} className="bg-background p-10 group">
                <div className="flex items-start justify-between mb-8">
                  <span className="text-6xl text-muted-foreground/20 leading-none" style={{ fontFamily: "'Martel', serif", fontWeight: 900 }}>{step}</span>
                  <div className="w-10 h-10 rounded-sm bg-secondary flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                    <Icon className="w-5 h-5" />
                  </div>
                </div>
                <h3 className="text-lg mb-2 font-bold text-foreground" style={{ fontFamily: "'Martel', serif" }}>{title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20 px-5 max-w-6xl mx-auto">
        <p className="text-accent text-sm font-semibold uppercase tracking-widest mb-3">Pricing</p>
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 mb-10">
          <h2 className="text-4xl font-black text-foreground" style={{ fontFamily: "'Martel', serif" }}>Simple. Predictable.</h2>
          <div className="flex items-center gap-2 bg-card border border-border rounded-sm p-1">
            <button onClick={() => setAnnual(false)} className={`text-sm px-4 py-1.5 rounded-sm font-medium transition-colors ${!annual ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Monthly</button>
            <button onClick={() => setAnnual(true)} className={`text-sm px-3 py-1.5 rounded-sm font-medium transition-colors flex items-center gap-1.5 ${annual ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
              Annual <span className="text-xs bg-accent text-accent-foreground px-1.5 py-0.5 rounded-sm">−20%</span>
            </button>
          </div>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          {PLANS.map((plan) => (
            <div key={plan.name} className="rounded-sm overflow-hidden border" style={{ backgroundColor: plan.color, borderColor: plan.highlight ? plan.color : "rgba(124,58,30,0.15)", boxShadow: plan.highlight ? "0 8px 32px rgba(124,58,30,0.18)" : "none" }}>
              <div className="p-8">
                {plan.highlight && <div className="text-xs font-semibold px-2 py-0.5 rounded-sm mb-4 inline-block" style={{ backgroundColor: "rgba(255,255,255,0.2)", color: plan.textColor }}>Most popular</div>}
                <h3 className="text-2xl font-black mb-1" style={{ fontFamily: "'Martel', serif", color: plan.textColor }}>{plan.name}</h3>
                <div className="flex items-end gap-1 mb-1">
                  <span className="text-4xl font-black" style={{ fontFamily: "'Martel', serif", color: plan.textColor }}>${annual ? plan.annualPrice : plan.price}</span>
                  <span className="text-sm mb-1.5 opacity-60" style={{ color: plan.textColor }}>/mo</span>
                </div>
                <p className="text-xs opacity-60 mb-6" style={{ color: plan.textColor }}>{plan.prints}</p>
                <button onClick={onSignIn} className="w-full text-sm font-semibold px-4 py-3 rounded-sm mb-6 hover:opacity-80 transition-opacity" style={{ backgroundColor: plan.highlight ? "#FAF7F2" : plan.textColor, color: plan.highlight ? plan.color : plan.color }}>
                  Get started
                </button>
                <ul className="space-y-2">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm" style={{ color: plan.textColor }}>
                      <Check className="w-4 h-4 mt-0.5 flex-shrink-0 opacity-70" />
                      <span className="opacity-80">{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-primary">
        <div className="max-w-lg mx-auto px-5 text-center">
          <h2 className="text-4xl font-black text-primary-foreground mb-4 leading-tight" style={{ fontFamily: "'Martel', serif" }}>
            Bring back the joy of opening fresh prints.
          </h2>
          <p className="text-primary-foreground/70 mb-8">Real prints, real mailbox, real moments — on autopilot.</p>
          <button onClick={onSignIn} className="bg-accent text-accent-foreground px-8 py-3 rounded-sm font-semibold hover:opacity-90 transition-opacity">
            Start for free
          </button>
        </div>
      </section>

      <footer className="bg-foreground text-primary-foreground/60 py-10 px-5 text-sm text-center">
        <p className="text-primary-foreground/80 font-semibold mb-1" style={{ fontFamily: "'Martel', serif" }}>NostalPic</p>
        <p>The camera that prints. Shoot your day; we mail the memories.</p>
        <p className="mt-3 text-xs">Fulfilled by Prodigi · WHCC · Gelato</p>
      </footer>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAuth, setShowAuth] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installDismissed, setInstallDismissed] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    // PWA meta tags
    const metas: [string, string][] = [
      ["theme-color", "#7C3A1E"],
      ["apple-mobile-web-app-capable", "yes"],
      ["apple-mobile-web-app-status-bar-style", "default"],
      ["apple-mobile-web-app-title", "NostalPic"],
    ];
    const injected: HTMLMetaElement[] = [];
    metas.forEach(([name, content]) => {
      if (!document.querySelector(`meta[name="${name}"]`)) {
        const m = document.createElement("meta");
        m.name = name; m.content = content;
        document.head.appendChild(m); injected.push(m);
      }
    });

    const handler = (e: Event) => { e.preventDefault(); setInstallPrompt(e as BeforeInstallPromptEvent); };
    window.addEventListener("beforeinstallprompt", handler);

    return () => {
      subscription.unsubscribe();
      injected.forEach((m) => m.remove());
      window.removeEventListener("beforeinstallprompt", handler);
    };
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
  };

  const handleInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
    setInstallDismissed(true);
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-border border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <>
      {session?.user ? (
        <NostalPicApp user={session.user} onSignOut={handleSignOut} />
      ) : (
        <LandingPage onSignIn={() => setShowAuth(true)} />
      )}

      {showAuth && !session && (
        <AuthModal
          onClose={() => setShowAuth(false)}
          onAuth={() => setShowAuth(false)}
        />
      )}

      {/* PWA install banner */}
      {installPrompt && !installDismissed && (
        <div className="fixed bottom-4 left-4 right-4 z-50 md:left-auto md:right-6 md:w-80">
          <div className="bg-card border border-border rounded-sm shadow-xl p-4 flex items-start gap-3">
            <div className="w-10 h-10 bg-primary rounded-sm flex items-center justify-center flex-shrink-0">
              <Camera className="w-5 h-5 text-primary-foreground" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-foreground mb-0.5">Add NostalPic to your phone</p>
              <p className="text-xs text-muted-foreground">Install for a native app experience — no App Store needed.</p>
              <div className="flex gap-2 mt-3">
                <button onClick={handleInstall} className="flex items-center gap-1.5 bg-primary text-primary-foreground text-xs px-3 py-1.5 rounded-sm font-medium hover:opacity-90 transition-opacity">
                  <Download className="w-3 h-3" /> Add to Home Screen
                </button>
                <button onClick={() => setInstallDismissed(true)} className="text-xs text-muted-foreground hover:text-foreground px-2">Not now</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
