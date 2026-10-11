// Draws each manifest atlas frame as a Phaser 4 NineSlice at several sizes so
// slice insets can be checked in the real renderer, including GPU filtering.
const params = new URLSearchParams(location.search);
const manifestUrl = new URL(params.get('manifest') ?? '../real/manifest.json', location.href);
const pixelArt = params.get('pixelArt') === '1';
const gap = 16;
const labelWidth = 150;

const manifest = await (await fetch(manifestUrl)).json();
const entries = await Promise.all(
  manifest.entries.map(async (entry, index) => {
    const atlasUrl = new URL(entry.atlas, manifestUrl);
    const atlas = await (await fetch(atlasUrl)).json();
    const [frameName, frame] = Object.entries(atlas.frames)[0];
    // `like` renders this frame at the sizes of another atlas's frame, so a
    // rebuilt texture can be compared pixel for pixel with its source.
    const likeFrame = entry.like === undefined
      ? frame
      : Object.values((await (await fetch(new URL(entry.like, manifestUrl))).json()).frames)[0];
    return {
      ...entry,
      likeFrame,
      key: `atlas${index}`,
      atlasUrl: atlasUrl.href,
      imageUrl: new URL(atlas.meta.image, atlasUrl).href,
      frameName,
      frame,
    };
  }),
);

function sizesFor(entry) {
  const { w, h } = entry.likeFrame.frame;
  const b = entry.likeFrame.scale9Borders;
  // Phaser's three-slice keeps the height; zero side insets keep the width.
  const three = b.y === 0 && b.h === h;
  const vertical = b.x === 0 && b.w === w;
  const sizes = [
    ['frame', w, h],
    ['min', vertical ? w : w - b.w, three ? h : h - b.h],
  ];
  if (!vertical) {
    sizes.push(['wide', Math.round(w * 2.5), h]);
  }
  if (!three) {
    sizes.push(['tall', w, Math.round(h * 2.5)]);
  }
  sizes.push(['double', vertical ? w : w * 2, three ? h : h * 2]);
  return sizes;
}

const rows = entries.map((entry) => {
  const sizes = sizesFor(entry);
  return {
    entry,
    sizes,
    width: labelWidth + sizes.reduce((sum, [, w]) => sum + w + gap, 0),
    height: Math.max(...sizes.map(([, , h]) => h)) + gap,
  };
});
const width = Math.max(...rows.map((row) => row.width)) + gap;
const height = rows.reduce((sum, row) => sum + row.height, gap);

class Check extends Phaser.Scene {
  preload() {
    for (const { key, imageUrl, atlasUrl } of entries) {
      this.load.atlas(key, imageUrl, atlasUrl);
    }
  }

  create() {
    const checker = this.add.graphics();
    for (let y = 0; y < height; y += 12) {
      for (let x = 0; x < width; x += 12) {
        checker.fillStyle((x / 12 + y / 12) % 2 === 0 ? 0x34343e : 0x2a2a32);
        checker.fillRect(x, y, 12, 12);
      }
    }
    let y = gap;
    const report = [];
    for (const row of rows) {
      this.add.text(gap, y, row.entry.label, { fontSize: '13px', color: '#e8e8e8' });
      let x = labelWidth;
      for (const [label, w, h] of row.sizes) {
        const slice = this.add.nineslice(x, y, row.entry.key, row.entry.frameName, w, h).setOrigin(0);
        report.push({
          entry: row.entry.label,
          label,
          at: [x, y],
          requested: [w, h],
          rendered: [slice.width, slice.height],
          insets: [slice.leftWidth, slice.rightWidth, slice.topHeight, slice.bottomHeight],
          threeSlice: slice.is3Slice,
        });
        x += w + gap;
      }
      y += row.height;
    }
    window.slicewrightReport = report;
    window.slicewrightCompare = () => compareLikePairs(this.game.canvas, report);
  }
}

new Phaser.Game({
  type: Phaser.WEBGL,
  width,
  height,
  backgroundColor: '#1d1d24',
  pixelArt,
  // Keeps the last frame readable so pixels can be compared from scripts.
  render: { preserveDrawingBuffer: true },
  scene: Check,
});

/**
 * For every entry rendered `like` another, compares its pixels with the other
 * entry's at the same size: mean and max channel difference, and the column and
 * row ranges whose difference exceeds 32.
 */
function compareLikePairs(canvas, report) {
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  const context = copy.getContext('2d');
  context.drawImage(canvas, 0, 0);
  const results = [];
  for (const entry of entries.filter((item) => item.like !== undefined)) {
    const base = entries.find((item) => item.atlas === entry.like);
    if (base === undefined) {
      results.push({ entry: entry.label, against: entry.like, skipped: 'the like atlas is not in the manifest' });
      continue;
    }
    for (const rendered of report.filter((item) => item.entry === entry.label)) {
      const other = report.find((item) => item.entry === base.label && item.label === rendered.label);
      if (other === undefined || other.rendered.join() !== rendered.rendered.join()) {
        results.push({ entry: entry.label, against: base.label, size: rendered.label, skipped: 'no same-size render to compare' });
        continue;
      }
      const [w, h] = rendered.rendered;
      const a = context.getImageData(other.at[0], other.at[1], w, h).data;
      const b = context.getImageData(rendered.at[0], rendered.at[1], w, h).data;
      const columns = new Float64Array(w);
      const rows = new Float64Array(h);
      let sum = 0;
      let max = 0;
      for (let i = 0; i < a.length; i += 4) {
        const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]), Math.abs(a[i + 3] - b[i + 3]));
        const x = (i / 4) % w;
        const y = Math.floor(i / 4 / w);
        sum += d;
        max = Math.max(max, d);
        columns[x] = Math.max(columns[x], d);
        rows[y] = Math.max(rows[y], d);
      }
      results.push({
        entry: entry.label,
        against: base.label,
        size: rendered.label,
        rendered: [w, h],
        mean: Number((sum / (w * h)).toFixed(2)),
        max,
        hotColumns: hotRange(columns),
        hotRows: hotRange(rows),
      });
    }
  }
  return results;
}

function hotRange(values) {
  const hot = [...values].flatMap((value, index) => (value > 32 ? [index] : []));
  return hot.length === 0 ? null : { first: hot[0], last: hot.at(-1), count: hot.length };
}
