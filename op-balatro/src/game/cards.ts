export type CardFaction = "Straw Hat" | "Navy" | "Revolutionary" | "Pirate";
export type CardRole = "Leader" | "Unit" | "Event";

export type CardDefinition = {
  id: string;
  name: string;
  role: CardRole;
  faction: CardFaction;
  cardSetId: string;
  imageUrl: string;
  cost: number;
  power: number;
  comboTags: string[];
  effectText: string;
};

export const starterDeck: CardDefinition[] = [
  {
    id: "rush-luffy",
    name: "Rookie Captain",
    role: "Unit",
    faction: "Straw Hat",
    cardSetId: "OP01-003",
    imageUrl: "",
    cost: 2,
    power: 3000,
    comboTags: ["Rush", "Captain"],
    effectText: "+1 mult si juegas otra carta Straw Hat este turno."
  },
  {
    id: "zoro-blade",
    name: "Three Blade Duelist",
    role: "Unit",
    faction: "Straw Hat",
    cardSetId: "OP01-025",
    imageUrl: "",
    cost: 3,
    power: 5000,
    comboTags: ["Slash", "Rush"],
    effectText: "+3 chips si ya tienes una carta con tag Rush."
  },
  {
    id: "nami-map",
    name: "Navigator of Odds",
    role: "Unit",
    faction: "Straw Hat",
    cardSetId: "OP01-016",
    imageUrl: "",
    cost: 1,
    power: 2000,
    comboTags: ["Support", "Draw"],
    effectText: "Roba 1 si tu mano queda con 3 o menos cartas."
  },
  {
    id: "sanji-sky",
    name: "Sky Walk Cook",
    role: "Unit",
    faction: "Straw Hat",
    cardSetId: "OP06-009",
    imageUrl: "",
    cost: 2,
    power: 4000,
    comboTags: ["Kick", "Combo"],
    effectText: "+5 chips si juegas una Event este turno."
  },
  {
    id: "marine-rookie",
    name: "Harbor Enforcer",
    role: "Unit",
    faction: "Navy",
    cardSetId: "OP02-114",
    imageUrl: "",
    cost: 2,
    power: 3000,
    comboTags: ["Control", "Shield"],
    effectText: "+1 mult por cada faccion distinta en tu mesa."
  },
  {
    id: "buster-call",
    name: "Full Broadside",
    role: "Event",
    faction: "Navy",
    cardSetId: "OP03-057",
    imageUrl: "",
    cost: 4,
    power: 0,
    comboTags: ["Event", "Control"],
    effectText: "+14 chips. Duplica el bonus de cartas Navy."
  },
  {
    id: "dragon-flame",
    name: "Wind of Rebellion",
    role: "Event",
    faction: "Revolutionary",
    cardSetId: "OP07-017",
    imageUrl: "",
    cost: 3,
    power: 0,
    comboTags: ["Event", "Draw"],
    effectText: "+8 chips y roba 2."
  },
  {
    id: "sabo-staff",
    name: "Flame Staff",
    role: "Unit",
    faction: "Revolutionary",
    cardSetId: "OP04-083",
    imageUrl: "",
    cost: 3,
    power: 5000,
    comboTags: ["Flame", "Combo"],
    effectText: "+2 mult si ya jugaste una Event."
  },
  {
    id: "pirate-cannon",
    name: "Deck Cannonade",
    role: "Event",
    faction: "Pirate",
    cardSetId: "OP05-077",
    imageUrl: "",
    cost: 2,
    power: 0,
    comboTags: ["Event", "Burst"],
    effectText: "+10 chips. +6 extra si tienes 2 o mas tags Burst o Rush."
  },
  {
    id: "pirate-bruiser",
    name: "Grand Line Bruiser",
    role: "Unit",
    faction: "Pirate",
    cardSetId: "OP01-086",
    imageUrl: "",
    cost: 1,
    power: 3000,
    comboTags: ["Burst", "Power"],
    effectText: "+4 chips si esta es tu carta mas barata jugada."
  }
];

export function createStarterDeck(): CardDefinition[] {
  return [
    ...starterDeck,
    ...starterDeck.map((card, index) => ({
      ...card,
      id: `${card.id}-${index}`
    }))
  ];
}
