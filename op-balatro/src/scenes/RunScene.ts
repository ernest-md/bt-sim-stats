import Phaser from "phaser";
import { CardDefinition } from "../game/cards";
import { fetchDeckCards, resolvePlayableImageUrl } from "../game/opBalatroDb";
import { RunState } from "../game/runState";

export class RunScene extends Phaser.Scene {
  private readonly handCenterX = 860;
  private readonly handY = 620;
  private readonly handLabelY = 764;
  private readonly buttonY = 846;
  private readonly pileYDeck = 720;
  private readonly pileYTrash = 888;
  private state = new RunState();
  private handContainer!: Phaser.GameObjects.Container;
  private boardContainer!: Phaser.GameObjects.Container;
  private overlayContainer!: Phaser.GameObjects.Container;
  private logText!: Phaser.GameObjects.Text;
  private blindTargetText!: Phaser.GameObjects.Text;
  private blindRewardText!: Phaser.GameObjects.Text;
  private roundScoreText!: Phaser.GameObjects.Text;
  private formulaChipsText!: Phaser.GameObjects.Text;
  private formulaMultText!: Phaser.GameObjects.Text;
  private handsCountText!: Phaser.GameObjects.Text;
  private discardsCountText!: Phaser.GameObjects.Text;
  private berriesText!: Phaser.GameObjects.Text;
  private anteCountText!: Phaser.GameObjects.Text;
  private roundCountText!: Phaser.GameObjects.Text;
  private refreshVersion = 0;
  private isLoadingTextures = false;
  private queuedTextureReload = false;
  private deckCode = "";
  private leaderName = "";
  private selectedCardIds = new Set<string>();
  private boardClearTimer?: Phaser.Time.TimerEvent;
  private discardModal?: Phaser.GameObjects.Container;

  constructor() {
    super("run");
  }

  init(data: { deckCode?: string; leaderName?: string }): void {
    this.deckCode = data.deckCode || "";
    this.leaderName = data.leaderName || "";
  }

  create(): void {
    const pileX = Math.min(this.scale.width - 150, 1278);
    this.drawTable();
    this.createHud();
    this.overlayContainer = this.add.container(0, 0);
    this.createPileWidget(pileX, this.pileYDeck, "DECK", "deck");
    this.createPileWidget(pileX, this.pileYTrash, "TRASH", "trash");
    this.createButtons();
    this.handContainer = this.add.container(0, 0);
    this.boardContainer = this.add.container(0, 0);
    void this.initializeRun();
  }

  private async initializeRun(): Promise<void> {
    this.state = new RunState();
    this.selectedCardIds.clear();
    this.logText.setText(this.deckCode ? `Preparando ${this.deckCode}...` : "Preparando run...");
    this.refresh();

    try {
      const deck = this.deckCode ? await fetchDeckCards(this.deckCode) : [];
      this.state = new RunState(deck);
      this.logText.setText(
        this.leaderName
          ? `Run iniciada con ${this.leaderName}.`
          : "Run iniciada."
      );
    } catch (_error) {
      this.state = new RunState();
      this.logText.setText("Fallback local. No se pudo cargar el deck desde op_balatro_cards.");
    }

    this.refresh();
  }

  private drawTable(): void {
    const { width, height } = this.scale;
    this.add.rectangle(width / 2, height / 2, width, height, 0x193a2e);
    this.add.rectangle(196, height / 2, 314, height, 0x11151c);
    this.add.rectangle(354, height / 2, 2, height, 0xd99929, 0.55);
    this.add.rectangle(width / 2 + 157, height / 2, width - 354, height, 0x2e8267);
    this.add.ellipse(930, 332, 760, 390, 0xffffff, 0.035);
    this.add.ellipse(1048, 448, 560, 258, 0x000000, 0.05);
    for (let index = 0; index < 44; index += 1) {
      this.add.rectangle(width / 2, 20 + index * 20, width, 1, 0xffffff, 0.025);
    }

    this.add.rectangle(102, 82, 156, 44, 0x293041)
      .setStrokeStyle(3, 0xd6c39b, 0.8);
    this.add.text(102, 82, "BACK", {
      fontFamily: "Georgia",
      fontSize: "24px",
      fontStyle: "bold",
      color: "#fff5da"
    }).setOrigin(0.5);

    this.add.rectangle(204, 128, 286, 64, 0xd18b15)
      .setStrokeStyle(4, 0x52350e, 0.95);
    this.add.text(204, 128, "Big Blind", {
      fontFamily: "Georgia",
      fontSize: "30px",
      fontStyle: "bold",
      color: "#fff4d1"
    }).setOrigin(0.5);

    this.add.rectangle(205, 268, 286, 160, 0x6f5618)
      .setStrokeStyle(4, 0x111111, 0.9);
    this.add.rectangle(138, 240, 88, 88, 0xe0a12e);
    this.add.text(138, 240, "BIG\nBLIND", {
      fontFamily: "Georgia",
      fontSize: "24px",
      fontStyle: "bold",
      align: "center",
      color: "#2a2411"
    }).setOrigin(0.5);
    this.add.rectangle(258, 240, 148, 88, 0x111823);
    this.add.text(258, 218, "Score at least", {
      fontFamily: "Georgia",
      fontSize: "18px",
      color: "#f3f0df"
    }).setOrigin(0.5);
    this.blindTargetText = this.add.text(258, 254, `${this.state.targetScore}`, {
      fontFamily: "Georgia",
      fontSize: "40px",
      fontStyle: "bold",
      color: "#ff6b57"
    }).setOrigin(0.5);
    this.blindRewardText = this.add.text(258, 284, "Reward: 0 berries", {
      fontFamily: "Georgia",
      fontSize: "18px",
      fontStyle: "bold",
      color: "#f3d269"
    }).setOrigin(0.5);

    this.add.rectangle(205, 370, 286, 86, 0x111823)
      .setStrokeStyle(3, 0x273446, 0.95);
    this.add.text(108, 370, "Round\nscore", {
      fontFamily: "Georgia",
      fontSize: "24px",
      fontStyle: "bold",
      align: "center",
      color: "#f1f1e6"
    }).setOrigin(0.5);
    this.roundScoreText = this.add.text(254, 370, `${this.state.score}`, {
      fontFamily: "Georgia",
      fontSize: "42px",
      fontStyle: "bold",
      color: "#ffffff"
    }).setOrigin(0.5);

    this.add.rectangle(205, 502, 286, 132, 0x111823)
      .setStrokeStyle(3, 0x273446, 0.95);
    this.add.text(205, 450, "ONE PIECE RUN", {
      fontFamily: "Georgia",
      fontSize: "28px",
      fontStyle: "bold",
      color: "#fff7df"
    }).setOrigin(0.5);
    this.add.text(205, 500, "chips x mult", {
      fontFamily: "Georgia",
      fontSize: "22px",
      fontStyle: "bold",
      color: "#9fc0ff"
    }).setOrigin(0.5);
    this.formulaChipsText = this.add.text(146, 548, "0", {
      fontFamily: "Georgia",
      fontSize: "42px",
      fontStyle: "bold",
      color: "#3ca4ff"
    }).setOrigin(0.5);
    this.add.text(205, 548, "x", {
      fontFamily: "Georgia",
      fontSize: "34px",
      fontStyle: "bold",
      color: "#f6dfd5"
    }).setOrigin(0.5);
    this.formulaMultText = this.add.text(268, 548, "0", {
      fontFamily: "Georgia",
      fontSize: "42px",
      fontStyle: "bold",
      color: "#ff5f50"
    }).setOrigin(0.5);

    this.add.rectangle(92, 690, 96, 108, 0xff5d4f)
      .setStrokeStyle(3, 0x7b1f1c, 0.95);
    this.add.text(92, 690, "Run\nInfo", {
      fontFamily: "Georgia",
      fontSize: "24px",
      fontStyle: "bold",
      align: "center",
      color: "#fff3dd"
    }).setOrigin(0.5);

    this.add.rectangle(200, 662, 72, 56, 0x1b232d).setStrokeStyle(2, 0x2f3d4b, 0.95);
    this.add.rectangle(282, 662, 72, 56, 0x1b232d).setStrokeStyle(2, 0x2f3d4b, 0.95);
    this.add.text(200, 638, "Hands", {
      fontFamily: "Georgia",
      fontSize: "16px",
      color: "#e7e2d1"
    }).setOrigin(0.5);
    this.handsCountText = this.add.text(200, 666, "4", {
      fontFamily: "Georgia",
      fontSize: "30px",
      fontStyle: "bold",
      color: "#46a4ff"
    }).setOrigin(0.5);
    this.add.text(282, 638, "Discards", {
      fontFamily: "Georgia",
      fontSize: "16px",
      color: "#e7e2d1"
    }).setOrigin(0.5);
    this.discardsCountText = this.add.text(282, 666, "0", {
      fontFamily: "Georgia",
      fontSize: "30px",
      fontStyle: "bold",
      color: "#ff6859"
    }).setOrigin(0.5);

    this.add.rectangle(242, 734, 154, 64, 0x111823)
      .setStrokeStyle(3, 0x2f3d4b, 0.95);
    this.berriesText = this.add.text(242, 734, "B$0", {
      fontFamily: "Georgia",
      fontSize: "38px",
      fontStyle: "bold",
      color: "#f4cb53"
    }).setOrigin(0.5);

    this.add.rectangle(92, 822, 96, 82, 0xe7a41a)
      .setStrokeStyle(3, 0x7e5400, 0.95);
    this.add.text(92, 822, "Options", {
      fontFamily: "Georgia",
      fontSize: "22px",
      fontStyle: "bold",
      color: "#fff3dd"
    }).setOrigin(0.5);

    this.add.rectangle(200, 820, 72, 70, 0x111823).setStrokeStyle(2, 0x2f3d4b, 0.95);
    this.add.rectangle(282, 820, 72, 70, 0x111823).setStrokeStyle(2, 0x2f3d4b, 0.95);
    this.add.text(200, 800, "Ante", {
      fontFamily: "Georgia",
      fontSize: "16px",
      color: "#e7e2d1"
    }).setOrigin(0.5);
    this.anteCountText = this.add.text(200, 828, "1", {
      fontFamily: "Georgia",
      fontSize: "28px",
      fontStyle: "bold",
      color: "#f4cb53"
    }).setOrigin(0.5);
    this.add.text(282, 800, "Round", {
      fontFamily: "Georgia",
      fontSize: "16px",
      color: "#e7e2d1"
    }).setOrigin(0.5);
    this.roundCountText = this.add.text(282, 828, "1", {
      fontFamily: "Georgia",
      fontSize: "28px",
      fontStyle: "bold",
      color: "#f4cb53"
    }).setOrigin(0.5);

    this.add.text(500, 60, "JOKERS", {
      fontFamily: "Georgia",
      fontSize: "18px",
      fontStyle: "bold",
      color: "#f8f1da"
    }).setAlpha(0.9);

    for (let index = 0; index < 5; index += 1) {
      const x = 556 + index * 102;
      this.add.rectangle(x, 132, 82, 118, 0x101721, 0.28)
        .setStrokeStyle(2, 0xe9d39d, 0.18);
    }

    this.add.rectangle(1088, 122, 286, 96, 0x1b2028, 0.72)
      .setStrokeStyle(2, 0x7ac6d7, 0.3);
    this.add.text(1088, 86, "TABLE LOG", {
      fontFamily: "Georgia",
      fontSize: "20px",
      fontStyle: "bold",
      color: "#88d8e8"
    }).setOrigin(0.5);

    this.add.text(this.handCenterX, this.handLabelY, "HAND", {
      fontFamily: "Georgia",
      fontSize: "22px",
      fontStyle: "bold",
      color: "#f8f1da"
    }).setOrigin(0.5).setAlpha(0.86);

    if (this.leaderName) {
      this.add.text(836, 74, `Leader deck: ${this.leaderName}`, {
        fontFamily: "Georgia",
        fontSize: "22px",
        color: "#f7e7b1",
        fontStyle: "bold"
      }).setOrigin(0.5);
    }
  }

  private createHud(): void {
    this.logText = this.add.text(958, 104, "", {
      fontFamily: "Georgia",
      fontSize: "18px",
      color: "#f3edd8",
      wordWrap: { width: 260 },
      lineSpacing: 8
    });
  }

  private createButtons(): void {
    this.makeButton(this.handCenterX - 108, this.buttonY, 198, 44, "PLAY HAND", () => {
      this.playSelectedCards();
    });

    this.makeButton(this.handCenterX + 108, this.buttonY, 198, 44, "DISCARD", () => {
      this.discardSelectedCards();
      this.refresh();
    }, 0x1d6f8e, 0x9fe8ff);

    this.makeButton(102, 82, 162, 42, "BACK", () => {
      this.scene.start("menu");
    }, 0x30384a, 0xe7dcc0);
  }

  private makeButton(
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    onClick: () => void,
    color = 0xc94f1d,
    accent = 0xf6e3b0
  ): void {
    const glow = this.add.rectangle(x, y, width + 14, height + 14, accent, 0.1);
    const button = this.add.rectangle(x, y, width, height, color)
      .setStrokeStyle(3, accent, 0.9)
      .setInteractive({ useHandCursor: true });
    const inner = this.add.rectangle(x, y, width - 16, height - 14, 0x181520, 0.2);

    const text = this.add.text(x, y, label, {
      fontFamily: "Georgia",
      fontSize: "20px",
      color: "#fff5da",
      fontStyle: "bold"
    }).setOrigin(0.5);

    button.on("pointerover", () => {
      text.setScale(1.04);
      glow.setFillStyle(accent, 0.2);
      inner.setAlpha(0.4);
    });
    button.on("pointerout", () => {
      text.setScale(1);
      glow.setFillStyle(accent, 0.12);
      inner.setAlpha(0.26);
    });
    button.on("pointerdown", onClick);
  }

  private refresh(): void {
    this.refreshVersion += 1;
    this.blindTargetText.setText(`${this.state.targetScore}`);
    this.blindRewardText.setText(`Reward: ${this.state.blindReward} berries`);
    this.roundScoreText.setText(`${this.state.score}`);
    const boardChips = this.state.board.reduce((sum, card) => sum + card.chips, 0);
    const boardMult = this.state.board.reduce((sum, card) => sum + card.mult, 0);
    this.formulaChipsText.setText(`${boardChips}`);
    this.formulaMultText.setText(`${boardMult}`);
    this.handsCountText.setText(`${this.state.handsRemaining}`);
    this.discardsCountText.setText(`${this.state.discardsRemaining}`);
    this.berriesText.setText(`B$${this.state.berries}`);
    this.anteCountText.setText("1");
    this.roundCountText.setText(`${this.state.round}`);

    this.handContainer.removeAll(true);
    this.boardContainer.removeAll(true);

    this.renderHand();
    this.renderBoard();
    this.updatePileCounts();
    this.renderTrashPileFace();
    void this.ensureVisibleTextures();
  }

  private renderHand(): void {
    const handWidth = Math.max(1, this.state.hand.length - 1) * 70;
    const startX = this.handCenterX - handWidth / 2;
    const y = this.handY;
    const gap = 70;

    this.state.hand.forEach((card, index) => {
      const x = startX + index * gap;
      const angle = (index - (this.state.hand.length - 1) / 2) * 0.9;
      const cardView = this.createCardView(card, x, y, true, false);
      cardView.setAngle(angle);
      cardView.setDepth(index);
      if (this.selectedCardIds.has(card.id)) {
        cardView.y -= 18;
        cardView.setDepth(100 + index);
      }
      this.handContainer.add(cardView);
      this.tweens.add({
        targets: cardView,
        y: cardView.y,
        duration: 120,
        ease: "Sine.Out"
      });
    });
  }

  private renderBoard(): void {
    const boardWidth = Math.max(1, this.state.board.length - 1) * 146;
    const startX = 820 - boardWidth / 2;
    const y = 462;
    const gap = 146;

    this.state.board.forEach((card, index) => {
      const x = startX + index * gap;
      const angle = (index - (this.state.board.length - 1) / 2) * 2;
      const cardView = this.createCardView(card, x, y, false, true);
      cardView.setAngle(angle);
      cardView.alpha = 0;
      cardView.y += 22;
      this.boardContainer.add(cardView);
      this.tweens.add({
        targets: cardView,
        alpha: 1,
        y,
        duration: 220,
        delay: index * 45,
        ease: "Quad.Out"
      });
    });
  }

  private createCardView(
    card: CardDefinition & { chips?: number; mult?: number },
    x: number,
    y: number,
    interactive: boolean,
    showScoring: boolean
  ): Phaser.GameObjects.Container {
    const container = this.add.container(x, y);
    const projectedSelection = interactive
      ? this.getProjectedSelection(card)
      : [card];
    const isPlayable = !interactive || this.state.canPlay(projectedSelection);
    const cardWidth = interactive ? 152 : 168;
    const cardHeight = interactive ? 212 : 234;
    const artFallback = this.add.rectangle(0, 0, cardWidth, cardHeight, 0x132742, isPlayable ? 0.92 : 0.5)
      .setStrokeStyle(3, 0xf6e3b0, 0.9);
    const artHint = this.add.text(0, -10, "Loading\nart", {
      fontFamily: "Georgia",
      fontSize: "20px",
      fontStyle: "bold",
      color: "#fff3cb",
      align: "center"
    }).setOrigin(0.5);

    const fallbackName = this.add.text(0, 72, card.name, {
      fontFamily: "Georgia",
      fontSize: "18px",
      fontStyle: "bold",
      color: "#f7f1dd",
      align: "center",
      wordWrap: { width: 140 }
    }).setOrigin(0.5);

    const displayEffect = card.effectText || "";
    const effectPlate = this.add.rectangle(0, 52, 146, 58, 0xf1e7bc, 0.96)
      .setStrokeStyle(2, 0x8b7b4a, 0.9);
    const effectText = this.add.text(0, 52, displayEffect, {
      fontFamily: "Georgia",
      fontSize: "12px",
      fontStyle: "bold",
      align: "center",
      color: "#08121f",
      wordWrap: { width: 128 },
      lineSpacing: 5
    }).setOrigin(0.5);

    const inactiveShade = this.add.rectangle(0, 0, cardWidth, cardHeight, 0x08121f, isPlayable ? 0 : 0.34);
    const scoreBadge = showScoring && card.chips !== undefined && card.mult !== undefined
      ? this.add.rectangle(0, -98, 128, 30, 0x281727, 0.92).setStrokeStyle(2, 0xffda7b, 0.9)
      : null;
    const scoreLabel = showScoring && card.chips !== undefined && card.mult !== undefined
      ? this.add.text(0, -98, `${card.chips} x ${card.mult}`, {
        fontFamily: "Georgia",
        fontSize: "14px",
        fontStyle: "bold",
        color: "#fff3cb"
      }).setOrigin(0.5)
      : null;

    container.add([
      artFallback,
      artHint,
      fallbackName,
      effectPlate,
      effectText,
      inactiveShade
    ]);

    if (scoreBadge && scoreLabel) {
      container.add([scoreBadge, scoreLabel]);
    }

    const textureKey = this.textureKeyFor(card);
    if (this.textures.exists(textureKey)) {
      const art = this.add.image(0, 0, textureKey).setDisplaySize(cardWidth, cardHeight);
      container.addAt(art, 0);
      artFallback.destroy();
      artHint.destroy();
      fallbackName.destroy();
    }

    const hitbox = this.add.rectangle(0, 0, cardWidth, cardHeight, 0xffffff, 0.001);
    container.add(hitbox);
    if (interactive) {
      hitbox.setInteractive({ useHandCursor: true });
      hitbox.on("pointerdown", () => this.toggleCardSelection(card.id));
    }

    return container;
  }

  private toggleCardSelection(cardId: string): void {
    if (this.selectedCardIds.has(cardId)) {
      this.selectedCardIds.delete(cardId);
    } else {
      if (this.selectedCardIds.size >= 5) {
        return;
      }
      this.selectedCardIds.add(cardId);
    }
    this.refresh();
  }

  private playSelectedCards(): void {
    const selectedIds = Array.from(this.selectedCardIds);
    const result = this.state.playCards(selectedIds);

    if (!result) {
      this.logText.setText("Selecciona cartas validas y suficientes para jugar la mano.");
      return;
    }

    this.selectedCardIds.clear();
    this.boardClearTimer?.destroy();
    this.logText.setText(
      [`Turn total: ${result.total}`, `Chips ${result.chips} | Mult ${result.mult}`, ...result.breakdown].join("\n")
    );

    if (this.state.score >= this.state.targetScore) {
      const reward = this.state.completeRound(true);
      this.logText.setText(`Blind clear.\n+${reward} berries\nNuevo objetivo: ${this.state.targetScore}`);
    } else if (this.state.handsRemaining <= 0) {
      this.logText.setText(`Run perdida.\nNo alcanzaste ${this.state.targetScore}.`);
      void this.resetRun();
      return;
    }

    this.refresh();
    this.boardClearTimer = this.time.delayedCall(900, () => {
      this.state.board = [];
      this.refresh();
    });
  }

  private discardSelectedCards(): void {
    const selectedIds = Array.from(this.selectedCardIds);
    const discarded = this.state.discardCards(selectedIds);

    if (!discarded) {
      this.logText.setText("Selecciona cartas para descartar. Cada descarte consume 1 discard.");
      return;
    }

    this.selectedCardIds.clear();
    this.boardClearTimer?.destroy();
    this.logText.setText("Cartas descartadas. Mano repuesta.");
    this.refresh();
  }

  private textureKeyFor(card: CardDefinition): string {
    return `card-art-${card.cardSetId}`;
  }

  private async ensureVisibleTextures(): Promise<void> {
    if (this.isLoadingTextures) {
      this.queuedTextureReload = true;
      return;
    }

    const visibleCards = [...this.state.hand, ...this.state.board];
    const pending = visibleCards.filter((card) => !this.textures.exists(this.textureKeyFor(card)));
    if (pending.length === 0) {
      return;
    }

    this.isLoadingTextures = true;
    const versionAtStart = this.refreshVersion;

    try {
      const queue: Array<{ key: string; url: string }> = [];
      const seenKeys = new Set<string>();

      for (const card of pending) {
        if (!card.imageUrl) {
          continue;
        }

        const url = await resolvePlayableImageUrl(card);
        const key = this.textureKeyFor(card);
        if (!url || this.textures.exists(key) || seenKeys.has(key)) {
          continue;
        }

        seenKeys.add(key);
        queue.push({ key, url });
      }

      if (queue.length === 0) {
        return;
      }

      await new Promise<void>((resolve) => {
        for (const item of queue) {
          this.load.image(item.key, item.url);
        }

        this.load.once("complete", () => resolve());
        this.load.start();
      });
    } finally {
      this.isLoadingTextures = false;
    }

    if (this.queuedTextureReload) {
      this.queuedTextureReload = false;
      void this.ensureVisibleTextures();
      return;
    }

    if (versionAtStart === this.refreshVersion) {
      this.refresh();
    }
  }

  private async resetRun(): Promise<void> {
    await this.initializeRun();
  }

  private getProjectedSelection(card: CardDefinition): CardDefinition[] {
    const selected = this.state.hand.filter((handCard) => this.selectedCardIds.has(handCard.id));
    if (this.selectedCardIds.has(card.id)) {
      return selected.filter((handCard) => handCard.id !== card.id);
    }

    return [...selected, card];
  }

  private createPileWidget(x: number, y: number, label: string, pile: "deck" | "trash"): void {
    const pileWidth = 108;
    const pileHeight = 152;
    const shadow = this.add.rectangle(x + 6, y + 8, pileWidth, pileHeight, 0x000000, 0.18).setName(`${pile}-shadow`);
    const frame = this.add.rectangle(x, y, pileWidth, pileHeight, 0xffffff, 0.001)
      .setInteractive({ useHandCursor: true })
      .setName(`${pile}-pile`);
    const cardBack = pile === "deck"
      ? this.add.image(x, y, "op-card-back-photo").setDisplaySize(pileWidth, pileHeight).setName("deck-back")
      : this.add.rectangle(x, y, pileWidth, pileHeight, 0xbfd4dd).setStrokeStyle(3, 0x476877, 0.9).setName("trash-back");
    const title = this.add.text(x, y - 58, label, {
      fontFamily: "Georgia",
      fontSize: "20px",
      fontStyle: "bold",
      color: "#fff1cb"
    }).setOrigin(0.5);
    const count = this.add.text(x, y + 56, "0", {
      fontFamily: "Georgia",
      fontSize: "28px",
      fontStyle: "bold",
      color: pile === "deck" ? "#5c3d10" : "#1c3946"
    }).setOrigin(0.5).setName(`${pile}-count`).setVisible(false);

    frame.on("pointerover", () => this.showPileCount(pile));
    frame.on("pointerout", () => this.hidePileCount(pile));
    if (pile === "trash") {
      frame.on("pointerdown", () => this.openDiscardModal());
    }

    this.overlayContainer.add([shadow, cardBack, frame, title, count]);
  }

  private updatePileCounts(): void {
    const deckCount = this.overlayContainer.getByName("deck-count") as Phaser.GameObjects.Text | null;
    const trashCount = this.overlayContainer.getByName("trash-count") as Phaser.GameObjects.Text | null;
    deckCount?.setText(String(this.state.deck.length));
    trashCount?.setText(String(this.state.discard.length));
  }

  private showPileCount(pile: "deck" | "trash"): void {
    const count = this.overlayContainer.getByName(`${pile}-count`) as Phaser.GameObjects.Text | null;
    count?.setVisible(true);
  }

  private hidePileCount(pile: "deck" | "trash"): void {
    const count = this.overlayContainer.getByName(`${pile}-count`) as Phaser.GameObjects.Text | null;
    count?.setVisible(false);
  }

  private renderTrashPileFace(): void {
    const trashBack = this.overlayContainer.getByName("trash-back");
    if (!trashBack) {
      return;
    }

    const existingThumb = this.overlayContainer.getByName("trash-thumb");
    existingThumb?.destroy();

    const lastDiscarded = this.state.discard[this.state.discard.length - 1];
    if (!lastDiscarded) {
      return;
    }

    const textureKey = this.textureKeyFor(lastDiscarded);
    if (!this.textures.exists(textureKey)) {
      return;
    }

    const thumb = this.add.image(
      Math.min(this.scale.width - 150, 1278),
      this.pileYTrash,
      textureKey
    )
      .setDisplaySize(108, 152)
      .setName("trash-thumb");
    this.overlayContainer.add(thumb);
  }

  private openDiscardModal(): void {
    if (this.discardModal || this.state.discard.length === 0) {
      return;
    }

    const { width, height } = this.scale;
    const container = this.add.container(0, 0);
    const overlay = this.add.rectangle(width / 2, height / 2, width, height, 0x08111a, 0.72)
      .setInteractive();
    const panel = this.add.rectangle(width / 2, height / 2, 980, 700, 0x101721, 0.98)
      .setStrokeStyle(3, 0xdcc48a, 0.9);
    const title = this.add.text(width / 2, 118, "Trash", {
      fontFamily: "Georgia",
      fontSize: "34px",
      fontStyle: "bold",
      color: "#fff1cb"
    }).setOrigin(0.5);
    const closeButton = this.add.rectangle(width / 2 + 400, 118, 108, 42, 0x7e2438)
      .setStrokeStyle(2, 0xf6d59b, 0.9)
      .setInteractive({ useHandCursor: true });
    const closeText = this.add.text(width / 2 + 400, 118, "CLOSE", {
      fontFamily: "Georgia",
      fontSize: "20px",
      fontStyle: "bold",
      color: "#fff5da"
    }).setOrigin(0.5);

    const previewCards = [...this.state.discard].reverse().slice(0, 12);
    previewCards.forEach((card, index) => {
      const col = index % 4;
      const row = Math.floor(index / 4);
      const x = width / 2 - 312 + col * 208;
      const y = 228 + row * 178;
      const textureKey = this.textureKeyFor(card);
      const hasTexture = this.textures.exists(textureKey);
      const frame = this.add.rectangle(x, y, 154, 148, 0x1a2430, 0.92)
        .setStrokeStyle(2, 0x6e8294, 0.6);
      const art = hasTexture
        ? this.add.image(x, y - 16, textureKey).setDisplaySize(112, 156)
        : this.add.rectangle(x, y - 16, 112, 156, 0x324456, 0.9);
      const name = this.add.text(x, y + 66, card.name, {
        fontFamily: "Georgia",
        fontSize: "15px",
        color: "#f2efe6",
        align: "center",
        wordWrap: { width: 144 }
      }).setOrigin(0.5);
      container.add([frame, art, name]);
    });

    const close = () => {
      this.discardModal?.destroy();
      this.discardModal = undefined;
    };

    overlay.on("pointerdown", close);
    closeButton.on("pointerdown", close);

    container.add([overlay, panel, title, closeButton, closeText]);
    this.discardModal = container;
  }
}
