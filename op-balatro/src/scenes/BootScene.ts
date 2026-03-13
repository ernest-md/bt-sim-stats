import Phaser from "phaser";

export class BootScene extends Phaser.Scene {
  constructor() {
    super("boot");
  }

  preload(): void {
    this.load.image("op-card-back-photo", "back.jpg");
  }

  create(): void {
    this.scene.start("menu");
  }
}
