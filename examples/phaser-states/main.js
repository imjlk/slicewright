// A small, dedicated canvas: adding these states to the real-art sheet could
// exceed the maximum WebGL texture size. The API is only for the engine checker.
const actualX = 32;
const referenceX = 672;
const y = 64;
const labelStyle = { fontFamily: 'sans-serif', fontSize: '18px', color: '#fff6df' };

function bounds(object) {
  const { x, y, width, height } = object.getBounds();
  return { x, y, width, height };
}

function insets(object) {
  return [object.leftWidth, object.rightWidth, object.topHeight, object.bottomHeight];
}

class StateCheck extends Phaser.Scene {
  preload() {
    this.load.atlas('buttons', './assets/buttons.png', './assets/buttons.json');
  }

  create() {
    const button = this.add.nineslice(actualX, y, 'buttons', 'btn-normal', 188, 62).setOrigin(0);
    const label = this.add.text(actualX + 94, y + 31, 'Accept quest', labelStyle).setOrigin(0.5).setDepth(1);
    const referenceLabel = this.add.text(referenceX + 94, y + 31, 'Accept quest', labelStyle).setOrigin(0.5).setDepth(1);
    const heading = this.add.text(actualX, 20, 'Same button after transition', labelStyle);
    this.add.text(referenceX, 20, 'Fresh expected-frame reference', labelStyle);
    let reference = this.add.nineslice(referenceX, y, 'buttons', 'btn-normal', 188, 62).setOrigin(0);
    let width = 188;
    let height = 62;

    const show = async (state, refreshUV = true) => {
      const frame = `btn-${state}`;
      // In Phaser 4 NineSlice, true refreshes the UVs while retaining its size.
      // false deliberately reproduces a logical-frame-only update. Do not call
      // setSize afterwards: that would repair the negative control's stale UVs.
      button.setFrame(frame, refreshUV, false);
      reference?.destroy();
      reference = this.add.nineslice(referenceX, y, 'buttons', frame, width, height).setOrigin(0);
      heading.setText(`${width} x ${height} / ${state}${refreshUV ? '' : ' / stale UV control'}`);
      await new Promise((resolve, reject) => {
        const rendered = () => {
          clearTimeout(timeout);
          resolve();
        };
        const timeout = setTimeout(() => {
          this.game.events.off('postrender', rendered);
          reject(new Error('Phaser did not render the requested state within 10 seconds'));
        }, 10_000);
        this.game.events.once('postrender', rendered);
      });
      return {
        renderer: this.game.renderer.type,
        sameButton: this.children.exists(button),
        sameLabel: this.children.exists(label),
        frame: button.frame.name,
        referenceFrame: reference.frame.name,
        button: bounds(button),
        label: bounds(label),
        reference: bounds(reference),
        referenceLabel: bounds(referenceLabel),
        insets: insets(button),
        referenceInsets: insets(reference),
      };
    };

    window.slicewrightStates = {
      show,
      resize: async (nextWidth, nextHeight) => {
        width = nextWidth;
        height = nextHeight;
        button.setSize(width, height);
        label.setPosition(actualX + width / 2, y + height / 2);
        referenceLabel.setPosition(referenceX + width / 2, y + height / 2);
        return show('normal');
      },
    };
  }
}

new Phaser.Game({
  type: Phaser.WEBGL,
  width: 1280,
  height: 224,
  backgroundColor: '#1d1d24',
  render: { preserveDrawingBuffer: true },
  scene: StateCheck,
});
