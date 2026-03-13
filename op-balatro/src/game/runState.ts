import Phaser from "phaser";
import { CardDefinition, createStarterDeck } from "./cards";

export type PlayedCard = CardDefinition & {
  chips: number;
  mult: number;
};

export type TurnScore = {
  chips: number;
  mult: number;
  total: number;
  breakdown: string[];
};

export class RunState {
  round = 1;
  targetScore = 300;
  blindReward = 4;
  berries = 0;
  score = 0;
  deck: CardDefinition[];
  hand: CardDefinition[] = [];
  discard: CardDefinition[] = [];
  board: PlayedCard[] = [];
  handsRemaining = 4;
  discardsRemaining = 4;
  readonly maxHandSize = 5;

  constructor(deck: CardDefinition[] = createStarterDeck()) {
    this.deck = Phaser.Utils.Array.Shuffle([...deck]);
    this.drawToHand(this.maxHandSize);
  }

  drawToHand(amount: number): void {
    for (let index = 0; index < amount; index += 1) {
      if (this.deck.length === 0) {
        this.deck = Phaser.Utils.Array.Shuffle(this.discard.splice(0));
      }

      const next = this.deck.shift();
      if (!next) {
        return;
      }

      this.hand.push(next);
    }
  }

  canPlay(cards: CardDefinition[]): boolean {
    if (cards.length === 0 || this.handsRemaining <= 0) {
      return false;
    }

    return cards.length <= this.maxHandSize;
  }

  playCards(cardIds: string[]): TurnScore | null {
    const selectedCards = cardIds
      .map((cardId) => this.hand.find((card) => card.id === cardId))
      .filter((card): card is CardDefinition => Boolean(card));

    if (selectedCards.length !== cardIds.length || !this.canPlay(selectedCards)) {
      return null;
    }

    this.handsRemaining -= 1;

    const playedCards: PlayedCard[] = [];
    for (const cardId of cardIds) {
      const handIndex = this.hand.findIndex((card) => card.id === cardId);
      const card = this.hand[handIndex];
      if (!card) {
        continue;
      }

      this.hand.splice(handIndex, 1);
      const played: PlayedCard = {
        ...card,
        chips: this.baseChips(card),
        mult: this.baseMult(card)
      };

      this.applySynergies(played, playedCards);
      playedCards.push(played);
      this.discard.push(card);
    }

    this.board = playedCards;

    for (const card of selectedCards) {
      if (card.comboTags.includes("Draw")) {
        this.drawToHand(card.role === "Event" ? 2 : 1);
      }
    }

    const turnScore = this.calculateScore();
    this.score += turnScore.total;
    this.drawToHand(this.maxHandSize - this.hand.length);

    return turnScore;
  }

  discardCards(cardIds: string[]): boolean {
    if (cardIds.length === 0 || this.discardsRemaining <= 0) {
      return false;
    }

    const selectedCards = cardIds
      .map((cardId) => this.hand.find((card) => card.id === cardId))
      .filter((card): card is CardDefinition => Boolean(card));

    if (selectedCards.length !== cardIds.length) {
      return false;
    }

    for (const cardId of cardIds) {
      const handIndex = this.hand.findIndex((card) => card.id === cardId);
      const card = this.hand[handIndex];
      if (!card) {
        continue;
      }

      this.hand.splice(handIndex, 1);
      this.discard.push(card);
    }

    this.discardsRemaining -= 1;
    this.drawToHand(this.maxHandSize - this.hand.length);
    this.board = [];
    return true;
  }

  completeRound(success: boolean): number {
    const clearedBoard = this.board.splice(0);
    this.discard.push(...clearedBoard);
    const reward = success ? this.blindReward + this.handsRemaining : 0;

    if (success) {
      this.berries += reward;
      this.round += 1;
      this.targetScore = Math.floor(this.targetScore * 1.6);
      this.blindReward += 1;
    }

    this.score = 0;
    this.handsRemaining = 4;
    this.discardsRemaining = 4;
    this.hand = [];
    this.drawToHand(this.maxHandSize);

    return reward;
  }

  private baseChips(card: CardDefinition): number {
    if (card.role === "Event") {
      return 8;
    }

    return Math.floor(card.power / 1000);
  }

  private baseMult(card: CardDefinition): number {
    return card.role === "Leader" ? 2 : 1;
  }

  private applySynergies(nextCard: PlayedCard, stagedCards: PlayedCard[]): void {
    const playedThisTurn = [...stagedCards, nextCard];
    const factions = new Set(playedThisTurn.map((card) => card.faction));
    const allTags = playedThisTurn.flatMap((card) => card.comboTags);

    if (nextCard.faction === "Straw Hat" && stagedCards.some((card) => card.faction === "Straw Hat")) {
      nextCard.mult += 1;
    }

    if (nextCard.comboTags.includes("Rush") && allTags.filter((tag) => tag === "Rush").length >= 2) {
      nextCard.chips += 3;
    }

    if (nextCard.comboTags.includes("Combo") && stagedCards.some((card) => card.role === "Event")) {
      nextCard.mult += 2;
    }

    if (nextCard.faction === "Navy") {
      nextCard.mult += Math.max(0, factions.size - 1);
    }

    if (nextCard.role === "Event") {
      nextCard.chips += 6;
    }

    if (nextCard.comboTags.includes("Burst") && allTags.filter((tag) => tag === "Burst" || tag === "Rush").length >= 2) {
      nextCard.chips += 6;
    }
  }

  private calculateScore(): TurnScore {
    const chips = this.board.reduce((sum, card) => sum + card.chips, 0);
    const mult = this.board.reduce((sum, card) => sum + card.mult, 0);
    const total = chips * mult;
    const breakdown = this.board.map(
      (card) => `${card.name}: ${card.chips} chips x ${card.mult} mult`
    );

    return { chips, mult, total, breakdown };
  }
}
