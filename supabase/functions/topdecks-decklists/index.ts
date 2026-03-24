import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const TOPDECK_SOURCES = [
  {
    label: "Asia OP15",
    url: "https://onepiecetopdecks.com/deck-list/japan-op-15-deck-list-adventure-on-kamis-island/",
  },
  {
    label: "Ingles EB03",
    url: "https://onepiecetopdecks.com/deck-list/english-eb-03-deck-list-one-piece-heroines-edition/",
  },
  {
    label: "Ingles OP14 + EB04",
    url: "https://onepiecetopdecks.com/deck-list/english-op-14-eb-04-deck-list-the-azure-sea-seven/",
  },
  {
    label: "Asia OP14 + EB03",
    url: "https://onepiecetopdecks.com/deck-list/japan-eb-04-deck-list-egghead-crisis/",
  },
];

function normalizeCardCode(value: string | null | undefined): string {
  return String(value || "").trim().toUpperCase();
}

function formatIsoDate(dateValue: Date): string {
  const y = dateValue.getFullYear();
  const m = String(dateValue.getMonth() + 1).padStart(2, "0");
  const d = String(dateValue.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseTopDecksDate(value: string): Date | null {
  const match = String(value || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function decodeTopDecksDeckString(encoded: string) {
  const matches = Array.from(String(encoded || "").matchAll(/(?:^|a)(\d+)n([A-Z0-9-]+)/g));
  return matches
    .map((match) => ({
      quantity: Number(match[1]),
      code: normalizeCardCode(match[2]),
    }))
    .filter((card) => card.quantity > 0 && card.code);
}

function htmlToLines(html: string): string[] {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(a|div|p|li|section|article|header|footer|h[1-6]|tr|td|th|ul|ol|main|aside|nav)>/gi, "$&\n")
    .replace(/<[^>]+>/g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

type DeckEntry = {
  label: string;
  date: Date;
  sourceUrl: string;
  deckText: string;
};

function chooseLatestDeckEntry(currentBest: DeckEntry | null, candidate: DeckEntry | null): DeckEntry | null {
  if (!candidate) return currentBest;
  if (!currentBest) return candidate;
  if (candidate.date.getTime() > currentBest.date.getTime()) return candidate;
  return currentBest;
}

function parseTopDecksPage(html: string, leaderCode: string, source: { label: string; url: string }): DeckEntry | null {
  const normalizedLeaderCode = normalizeCardCode(leaderCode);
  const text = htmlToLines(html).join("\n");
  const deckRegex = /1n[A-Z0-9-]+(?:a\d+n[A-Z0-9-]+)*/g;
  const matches = Array.from(text.matchAll(deckRegex));
  let best: DeckEntry | null = null;

  for (let i = 0; i < matches.length; i += 1) {
    const encodedDeck = matches[i][0];
    if (!encodedDeck.startsWith(`1n${normalizedLeaderCode}`)) continue;

    const start = matches[i].index ?? 0;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length;
    const chunk = text.slice(start, end).trim();
    const dateMatch = chunk.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
    if (!dateMatch) continue;

    const parsedDate = parseTopDecksDate(dateMatch[1]);
    if (!parsedDate) continue;

    const beforeDate = chunk.slice(encodedDeck.length, dateMatch.index)
      .replace(/【\d+†.*?】/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const metaTokens = beforeDate.split(/\s+/).filter(Boolean);
    const deckName = metaTokens.length >= 3 ? metaTokens.slice(2).join(" ") : normalizedLeaderCode;
    const deckCards = decodeTopDecksDeckString(encodedDeck);
    if (!deckCards.length) continue;

    const candidate: DeckEntry = {
      label: `${source.label} - ${deckName} - ${formatIsoDate(parsedDate)}`,
      date: parsedDate,
      sourceUrl: source.url,
      deckText: deckCards.map((card) => `${card.quantity}x${card.code}`).join("\n"),
    };
    best = chooseLatestDeckEntry(best, candidate);
  }

  return best;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
    });
  }

  try {
    const url = new URL(req.url);
    const leader = normalizeCardCode(url.searchParams.get("leader"));
    if (!leader) {
      return new Response(JSON.stringify({ error: "Missing leader parameter" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
      });
    }

    let best: DeckEntry | null = null;
    const errors: string[] = [];

    for (const source of TOPDECK_SOURCES) {
      try {
        const upstream = await fetch(source.url, {
          method: "GET",
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; BarateamHub/1.0)",
          },
        });
        if (!upstream.ok) {
          errors.push(`${source.label}: ${upstream.status}`);
          continue;
        }

        const html = await upstream.text();
        const candidate = parseTopDecksPage(html, leader, source);
        best = chooseLatestDeckEntry(best, candidate);
      } catch (err) {
        errors.push(`${source.label}: ${err instanceof Error ? err.message : "Unexpected error"}`);
      }
    }

    if (!best) {
      return new Response(JSON.stringify({ error: "No decklist found", details: errors }), {
        status: 404,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
      });
    }

    return new Response(JSON.stringify({
      leader,
      label: best.label,
      sourceUrl: best.sourceUrl,
      deckText: best.deckText,
      date: formatIsoDate(best.date),
    }), {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=900",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unexpected error" }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
    });
  }
});
