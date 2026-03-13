import { CardDefinition, CardFaction, CardRole } from "./cards";

const SUPABASE_URL = "https://ceunhkqhskwnsoqyunze.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNldW5oa3Foc2t3bnNvcXl1bnplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0NDQ0ODcsImV4cCI6MjA4ODAyMDQ4N30.qBGXYYQXlyQwFGeyaeMOtLPHrjBy-eU05AO37yLvi5o";
const REST_URL = `${SUPABASE_URL}/rest/v1/op_balatro_cards`;
const WRAPPED_CACHE_FN_URL = `${SUPABASE_URL}/functions/v1/optcgapi`;

type DbCardRow = {
  id: string;
  card_set_id: string;
  name: string;
  image_url: string;
  role: string;
  faction: string;
  cost: number | string | null;
  power: number | string | null;
  combo_tags: unknown;
  balatro_text: string | null;
  deck: string;
  leader: boolean;
  copies: number | string | null;
};

export type DeckSummary = {
  deckCode: string;
  leaderName: string;
  leaderImageUrl: string;
  leaderCardSetId: string;
};

const wrappedImageCache = new Map<string, string>();
const wrappedImageInflight = new Map<string, Promise<string>>();

function headers(): HeadersInit {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`
  };
}

function normalize(value: unknown): string {
  return String(value || "").trim();
}

function toNumber(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toRole(value: string): CardRole {
  const normalized = normalize(value).toLowerCase();
  if (normalized === "leader") {
    return "Leader";
  }

  if (normalized === "event") {
    return "Event";
  }

  return "Unit";
}

function toFaction(value: string): CardFaction {
  const normalized = normalize(value).toLowerCase();
  if (normalized === "navy") {
    return "Navy";
  }

  if (normalized === "revolutionary") {
    return "Revolutionary";
  }

  if (normalized === "pirate") {
    return "Pirate";
  }

  return "Straw Hat";
}

function toComboTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => normalize(item)).filter(Boolean);
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((item) => normalize(item)).filter(Boolean);
      }
    } catch (_error) {
      return [];
    }
  }

  return [];
}

async function fetchRows(query: string): Promise<DbCardRow[]> {
  const response = await fetch(`${REST_URL}?${query}`, { headers: headers() });
  if (!response.ok) {
    throw new Error(`op_balatro_cards ${response.status}`);
  }

  return (await response.json()) as DbCardRow[];
}

export async function fetchDeckSummaries(): Promise<DeckSummary[]> {
  const rows = await fetchRows("select=deck,name,image_url,card_set_id&leader=is.true&order=deck.asc");
  return rows.map((row) => ({
    deckCode: normalize(row.deck),
    leaderName: normalize(row.name),
    leaderImageUrl: normalize(row.image_url),
    leaderCardSetId: normalize(row.card_set_id)
  }));
}

export async function fetchDeckCards(deckCode: string): Promise<CardDefinition[]> {
  const encodedDeck = encodeURIComponent(deckCode);
  const rows = await fetchRows(`select=*&deck=eq.${encodedDeck}&order=leader.desc,name.asc`);
  const mainDeckRows = rows.filter((row) => !row.leader);
  const expandedDeck: CardDefinition[] = [];

  for (const row of mainDeckRows) {
    const copies = Math.max(1, toNumber(row.copies || 1));
    for (let index = 0; index < copies; index += 1) {
      expandedDeck.push({
        id: `${normalize(row.card_set_id)}-${index}-${expandedDeck.length}`,
        name: normalize(row.name),
        role: toRole(normalize(row.role)),
        faction: toFaction(normalize(row.faction)),
        cardSetId: normalize(row.card_set_id),
        imageUrl: normalize(row.image_url),
        cost: toNumber(row.cost),
        power: toNumber(row.power),
        comboTags: toComboTags(row.combo_tags),
        effectText: normalize(row.balatro_text) || "TEST"
      });
    }
  }

  return expandedDeck;
}

function proxiedImage(url: string): string {
  const normalized = normalize(url);
  if (!/^https?:\/\//i.test(normalized)) {
    return normalized;
  }

  return `https://corsproxy.io/?${encodeURIComponent(normalized)}`;
}

export async function resolvePlayableImageUrl(card: Pick<CardDefinition, "cardSetId" | "name" | "imageUrl" | "role">): Promise<string> {
  const imageUrl = normalize(card.imageUrl);
  const cardCode = normalize(card.cardSetId);
  if (!imageUrl) {
    return "";
  }

  const cacheKey = `${cardCode}::${imageUrl}`;
  if (wrappedImageCache.has(cacheKey)) {
    return wrappedImageCache.get(cacheKey) || imageUrl;
  }

  if (wrappedImageInflight.has(cacheKey)) {
    return wrappedImageInflight.get(cacheKey) as Promise<string>;
  }

  const task = (async () => {
    try {
      const response = await fetch(WRAPPED_CACHE_FN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({
          card_code: cardCode,
          image_variant: "default",
          name: card.name || "",
          set_name: "",
          card_type: card.role || "",
          image_url: imageUrl
        })
      });

      if (response.ok) {
        const data = (await response.json()) as { public_image_url?: string };
        const publicUrl = normalize(data.public_image_url);
        if (publicUrl) {
          wrappedImageCache.set(cacheKey, publicUrl);
          return publicUrl;
        }
      }
    } catch (_error) {
      // Fallback below.
    }

    const fallbackUrl = proxiedImage(imageUrl);
    wrappedImageCache.set(cacheKey, fallbackUrl);
    return fallbackUrl;
  })();

  wrappedImageInflight.set(cacheKey, task);

  try {
    return await task;
  } finally {
    wrappedImageInflight.delete(cacheKey);
  }
}
