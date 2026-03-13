import Phaser from "phaser";
import { DeckSummary, fetchDeckSummaries } from "../game/opBalatroDb";

export class MenuScene extends Phaser.Scene {
  private loadingText!: Phaser.GameObjects.Text;

  constructor() {
    super("menu");
  }

  create(): void {
    const { width, height } = this.scale;

    this.add.rectangle(width / 2, height / 2, width, height, 0x110d19);
    this.add.circle(width * 0.16, height * 0.18, 180, 0xf1b24a, 0.18);
    this.add.circle(width * 0.82, height * 0.2, 240, 0xbd294e, 0.16);
    this.add.rectangle(width / 2, height / 2, width - 54, height - 54, 0x0a1522)
      .setStrokeStyle(2, 0xc9a45c, 0.35);
    this.add.rectangle(width / 2, 112, 760, 160, 0x1b1828, 0.84)
      .setStrokeStyle(3, 0xf0d28d, 0.7);
    this.add.rectangle(width / 2, 112, 730, 130, 0x251228, 0.52);

    this.add.text(width / 2, 82, "OP BALATRO", {
      fontFamily: "Georgia",
      fontSize: "74px",
      color: "#ffe7a8",
      fontStyle: "bold"
    }).setOrigin(0.5);

    this.add.text(width / 2, 132, "Deck Select", {
      fontFamily: "Georgia",
      fontSize: "30px",
      color: "#ff8c61",
      fontStyle: "bold"
    }).setOrigin(0.5);

    this.add.text(width / 2, 250,
      "Selecciona una baraja desde los lideres cargados\nen op_balatro_cards para empezar la run.",
      {
        align: "center",
        fontFamily: "Georgia",
        fontSize: "25px",
        color: "#d7dbe7",
        lineSpacing: 14
      }
    ).setOrigin(0.5);

    this.loadingText = this.add.text(width / 2, 460, "Cargando decks...", {
      fontFamily: "Georgia",
      fontSize: "28px",
      color: "#f7f1dd"
    }).setOrigin(0.5);

    void this.renderDeckPicker();
  }

  private async renderDeckPicker(): Promise<void> {
    const { width } = this.scale;

    try {
      const decks = await fetchDeckSummaries();
      this.loadingText.destroy();

      if (decks.length === 0) {
        this.add.text(width / 2, 540, "No hay lideres en op_balatro_cards.", {
          fontFamily: "Georgia",
          fontSize: "26px",
          color: "#f7f1dd"
        }).setOrigin(0.5);
        return;
      }

      decks.forEach((deck, index) => {
        const column = index % 2;
        const row = Math.floor(index / 2);
        this.createDeckButton(deck, 400 + column * 640, 420 + row * 106);
      });
    } catch (_error) {
      this.loadingText.setText("No se pudieron cargar los decks.");
    }
  }

  private createDeckButton(deck: DeckSummary, x: number, y: number): void {
    const glow = this.add.rectangle(x, y, 538, 90, 0xf1b24a, 0.14);
    const button = this.add.rectangle(x, y, 520, 72, 0x8e263d)
      .setStrokeStyle(3, 0xf2d597)
      .setInteractive({ useHandCursor: true });
    const inner = this.add.rectangle(x, y, 500, 54, 0x241827, 0.9)
      .setStrokeStyle(1, 0xffffff, 0.15);

    const label = this.add.text(x, y - 10, deck.leaderName, {
      fontFamily: "Georgia",
      fontSize: "30px",
      color: "#fff2c6",
      fontStyle: "bold"
    }).setOrigin(0.5);

    const sublabel = this.add.text(x, y + 18, deck.deckCode, {
      fontFamily: "Georgia",
      fontSize: "18px",
      color: "#f6a98c"
    }).setOrigin(0.5);

    button.on("pointerover", () => {
      button.setFillStyle(0xb13051);
      glow.setFillStyle(0xf1b24a, 0.22);
      label.setScale(1.03);
      inner.setFillStyle(0x2f1d2d, 0.95);
    });

    button.on("pointerout", () => {
      button.setFillStyle(0x8e263d);
      glow.setFillStyle(0xf1b24a, 0.14);
      label.setScale(1);
      inner.setFillStyle(0x241827, 0.9);
    });

    button.on("pointerdown", () => {
      this.scene.start("run", {
        deckCode: deck.deckCode,
        leaderName: deck.leaderName
      });
    });
  }
}
