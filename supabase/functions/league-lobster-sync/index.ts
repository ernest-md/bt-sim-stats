// Supabase Edge Function: league-lobster-sync
// Reads the public LeagueLobster schedule server-side to avoid browser CORS.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const DEFAULT_SCHEDULE_ID = "2648809";
const DEFAULT_PUBLIC_URL = "https://scheduler.leaguelobster.com/es/2648809/lliga-op15/op15/?mode=full";

type MatchRow = {
  id: string;
  week: number;
  home: string;
  away: string;
  homeScore: string;
  awayScore: string;
};

function jsonResponse(body: unknown, status = 200, cache = "public, max-age=300"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cache,
    },
  });
}

function htmlDecode(value: string): string {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function attr(tag: string, name: string): string {
  const match = tag.match(new RegExp(`\\s${name}="([^"]*)"`, "i"));
  return htmlDecode(match?.[1] || "");
}

async function fetchText(url: string, referer = DEFAULT_PUBLIC_URL): Promise<string> {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": "BarateamHub/1.0 (+https://barateam-hub)",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "X-Requested-With": "XMLHttpRequest",
      "Referer": referer,
    },
  });
  if (!res.ok) throw new Error(`LeagueLobster responded ${res.status} for ${url}`);
  return await res.text();
}

function extractLoadGamesUrl(pageHtml: string, publicUrl: string): { loadGamesUrl: string; modified: string } {
  const loadGames = pageHtml.match(/document\.urls\.load_games\s*=\s*["']([^"']+)["']/);
  if (!loadGames?.[1]) throw new Error("No se encontro document.urls.load_games");

  const modified = pageHtml.match(/document\.seasonModified\s*=\s*["']([^"']+)["']/)?.[1] || "";
  return {
    loadGamesUrl: new URL(loadGames[1], publicUrl).toString(),
    modified,
  };
}

function parseMatches(weeksHtml: string): MatchRow[] {
  const matches: MatchRow[] = [];
  const matchTagRegex = /<div\b[^>]*\bdata-match="([^"]+)"[^>]*>/gi;
  const teamNameRegex = /<span\b[^>]*\bclass="[^"]*\bteam-display\b[^"]*"[^>]*>\s*([^<]*?)\s*<\/span>/gi;
  const starts = Array.from(weeksHtml.matchAll(matchTagRegex));

  starts.forEach((startMatch, index) => {
    const tag = startMatch[0] || "";
    const start = startMatch.index || 0;
    const end = index + 1 < starts.length ? starts[index + 1].index || weeksHtml.length : weeksHtml.length;
    const block = weeksHtml.slice(start, end);

    if (attr(tag, "data-no-match").toLowerCase() === "true") return;

    const id = attr(tag, "data-match") || startMatch[1] || "";
    const homeScore = attr(tag, "data-home_score");
    const awayScore = attr(tag, "data-away_score");
    const previousHtml = weeksHtml.slice(0, start);
    const weekMatch = previousHtml.match(/data-week="([^"]+)"(?![\s\S]*data-week="[^"]+")/i);
    const week = Number(weekMatch?.[1] || 0);
    const teamNames = Array.from(block.matchAll(teamNameRegex))
      .map((item) => htmlDecode(item[1]))
      .filter(Boolean);

    if (!id || teamNames.length < 2) return;

    matches.push({
      id,
      week,
      home: teamNames[0],
      away: teamNames[1],
      homeScore,
      awayScore,
    });
  });

  return matches;
}

function parseDebugInfo(weeksHtml: string): Record<string, unknown> {
  const firstMatchIndex = weeksHtml.indexOf("data-match=");
  const firstTeamIndex = weeksHtml.indexOf("team-display");
  return {
    htmlLength: weeksHtml.length,
    dataMatchCount: (weeksHtml.match(/data-match="/g) || []).length,
    scheduleMatchCount: (weeksHtml.match(/schedule-match/g) || []).length,
    teamDisplayCount: (weeksHtml.match(/team-display/g) || []).length,
    firstMatchSnippet: firstMatchIndex >= 0 ? weeksHtml.slice(firstMatchIndex - 120, firstMatchIndex + 320) : "",
    firstTeamSnippet: firstTeamIndex >= 0 ? weeksHtml.slice(firstTeamIndex - 120, firstTeamIndex + 220) : "",
  };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405, "no-store");
  }

  try {
    const url = new URL(req.url);
    const scheduleId = url.searchParams.get("scheduleId") || DEFAULT_SCHEDULE_ID;
    const publicUrl = scheduleId === DEFAULT_SCHEDULE_ID
      ? DEFAULT_PUBLIC_URL
      : `https://scheduler.leaguelobster.com/es/${encodeURIComponent(scheduleId)}/`;

    const pageHtml = await fetchText(publicUrl);
    const { loadGamesUrl, modified } = extractLoadGamesUrl(pageHtml, publicUrl);
    const weeksHtml = await fetchText(loadGamesUrl, publicUrl);
    const matches = parseMatches(weeksHtml);

    if (!matches.length) {
      return jsonResponse({
        error: "No se encontraron enfrentamientos",
        sourceUrl: loadGamesUrl,
        debug: parseDebugInfo(weeksHtml),
      }, 502, "no-store");
    }

    return jsonResponse({
      leagueId: "op15",
      scheduleId,
      publicUrl,
      sourceUrl: loadGamesUrl,
      modified,
      updatedAt: new Date().toISOString(),
      matches,
    });
  } catch (err) {
    return jsonResponse({
      error: err instanceof Error ? err.message : "Unexpected error",
    }, 500, "no-store");
  }
});
