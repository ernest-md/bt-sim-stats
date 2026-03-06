// Supabase Edge Function: leader-stats
// Proxy for CardKaizoku stats JSON to avoid browser CORS restrictions.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function normalizeDate(raw: string | null): string | null {
  if (!raw) return null;
  const v = String(raw).trim();
  if (/^\d{8}$/.test(v)) return v;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v.replaceAll("-", "");
  return null;
}

function compactDateFromUtc(dt: Date): string {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  try {
    const url = new URL(req.url);
    const requested = normalizeDate(url.searchParams.get("date"));

    const start = requested ? new Date(`${requested.slice(0, 4)}-${requested.slice(4, 6)}-${requested.slice(6, 8)}T00:00:00Z`) : new Date();
    const candidates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const c = new Date(start);
      c.setUTCDate(start.getUTCDate() - i);
      candidates.push(compactDateFromUtc(c));
    }

    let lastError: string | null = null;
    for (const day of candidates) {
      const sourceUrl = `https://cdn.cardkaizoku.com/stats/stats_west_${day}.json?v=3`;
      const upstream = await fetch(sourceUrl, { method: "GET" });
      if (!upstream.ok) {
        lastError = `upstream status ${upstream.status} for ${day}`;
        continue;
      }

      const data = await upstream.json();
      if (!Array.isArray(data)) {
        lastError = `unexpected JSON format for ${day}`;
        continue;
      }

      return new Response(JSON.stringify({ date: day, sourceUrl, data }), {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "public, max-age=900",
        },
      });
    }

    return new Response(JSON.stringify({ error: lastError || "No stats available" }), {
      status: 502,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unexpected error" }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
    });
  }
});
