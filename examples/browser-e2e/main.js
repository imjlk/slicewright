const query = new URLSearchParams(window.location.search);
const renderer = query.get('renderer') === 'canvas' ? 'canvas' : 'dom';
const fault = query.get('fault');
const stage = document.querySelector('#stage');
document.body.classList.toggle('scroll-example', query.get('scroll') === '1');
document.querySelector('#renderer-description').textContent =
  renderer === 'canvas' ? 'Canvas paints the panel and reports its measured text.' :
    'HTML/CSS lays out the panel and exposes ordinary DOM elements.';

const copy = {
  title: 'A light in the old wood',
  body: 'Follow the fireflies beyond the mill and help the lantern keeper find her way home.',
  action: 'Accept quest',
  status: 'Choose your next adventure.',
};
const fonts = {
  title: 'bold 22px Georgia, serif',
  body: '16px Arial, sans-serif',
  action: 'bold 16px Arial, sans-serif',
  status: '16px Arial, sans-serif',
};
const colors = { idle: '#728951', hover: '#91a85e', pressed: '#4a633e', accepted: '#326c59' };
// Leave room for real glyph ink, including serif overhang beyond its advance width.
const textInset = 2;
const state = { phase: 'idle', accepted: 0 };
let painted = { ...state };
let layout;
let canvas;
let context;
let panel;
let dom;
let overlay;
let drawn = {};
let pointerDown = false;
const measuring = document.createElement('canvas').getContext('2d');
const art = new Image();
art.src = './assets/guild-panel.png';

function wrap(text, width, font) {
  measuring.font = font;
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && measuring.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) { lines.push(line); }
  return lines;
}

function arrange() {
  const width = Math.min(560, window.innerWidth - 32);
  const contentWidth = width - 108;
  const titleLines = wrap(copy.title, contentWidth - textInset * 2, fonts.title);
  const bodyLines = wrap(copy.body, contentWidth - textInset * 2, fonts.body);
  const title = { x: 54, y: 108, width: contentWidth, height: titleLines.length * 28 };
  const body = { x: 54, y: title.y + title.height + 16, width: contentWidth, height: bodyLines.length * 22 };
  const action = { x: 54, y: body.y + body.height + 24, width: contentWidth, height: 52 };
  const status = { x: 54, y: action.y + action.height + 16, width: contentWidth, height: 44 };
  const height = Math.max(476, status.y + status.height + 111);
  layout = {
    width, height, title, body, action, status, titleLines, bodyLines,
    content: { x: 54, y: 108, width: contentWidth, height: height - 219 },
  };
  stage.style.width = `${width}px`;
  stage.style.height = `${height}px`;
  if (canvas) {
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.round(width * window.devicePixelRatio);
    canvas.height = Math.round(height * window.devicePixelRatio);
  }
  if (panel) {
    panel.style.width = `${width}px`;
    panel.style.height = `${height}px`;
    place(dom.content, layout.content);
    for (const name of ['title', 'body', 'action', 'status']) {
      place(dom[name], { ...layout[name], x: layout[name].x - 54, y: layout[name].y - 108 });
    }
  }
  if (overlay) { place(overlay, layout.action); }
  paint();
}

function place(element, bounds) {
  Object.assign(element.style, {
    left: `${bounds.x}px`, top: `${bounds.y}px`,
    width: `${bounds.width}px`, height: `${bounds.height}px`,
  });
}

function linesInto(element, lines) {
  element.replaceChildren(...lines.map((line, index) => {
    const span = document.createElement('span');
    span.className = 'text-line';
    span.textContent = `${line}${index < lines.length - 1 ? ' ' : ''}`;
    return span;
  }));
}

function statusText() {
  return painted.accepted ? `Quest accepted: ${painted.accepted}` : copy.status;
}

function labelShift() { return fault === 'shift' && painted.accepted ? 12 : 0; }
function clippedStatus() { return fault === 'clipping' && painted.accepted; }

function paint() {
  if (!layout) { return; }
  if (!(fault === 'stale-paint' && painted.phase === 'pressed')) { painted = { ...state }; }
  if (renderer === 'dom') {
    linesInto(dom.title, layout.titleLines);
    linesInto(dom.body, layout.bodyLines);
    linesInto(dom.status, wrap(statusText(), layout.status.width - textInset * 2, fonts.status));
    dom.action.dataset.phase = painted.phase;
    dom.label.style.transform = `translateX(${labelShift()}px)`;
    dom.status.style.height = `${clippedStatus() ? 8 : layout.status.height}px`;
    dom.status.style.overflow = clippedStatus() ? 'hidden' : 'visible';
  } else {
    paintCanvas();
  }
}

function paintCanvas() {
  context.setTransform(canvas.width / layout.width, 0, 0, canvas.height / layout.height, 0, 0);
  context.clearRect(0, 0, layout.width, layout.height);
  const sourceX = [0, 104, 376, 480];
  const sourceY = [0, 108, 365, 476];
  const destX = [0, 104, layout.width - 104, layout.width];
  const destY = [0, 108, layout.height - 111, layout.height];
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 3; x++) {
      context.drawImage(art, sourceX[x], sourceY[y], sourceX[x + 1] - sourceX[x], sourceY[y + 1] - sourceY[y],
        destX[x], destY[y], destX[x + 1] - destX[x], destY[y + 1] - destY[y]);
    }
  }
  drawn = {};
  drawLines('title', layout.title, layout.titleLines, 28);
  drawLines('body', layout.body, layout.bodyLines, 22);
  const action = layout.action;
  context.fillStyle = colors[painted.phase];
  context.strokeStyle = '#38523b';
  context.lineWidth = 2;
  context.beginPath();
  context.roundRect(action.x + 1, action.y + 1, action.width - 2, action.height - 2, 7);
  context.fill();
  context.stroke();
  const label = actionContent();
  context.font = fonts.action;
  const labelWidth = context.measureText(copy.action).width;
  drawLines('action', { ...label, x: action.x + (action.width - labelWidth) / 2 + labelShift(), y: action.y + 14 }, [copy.action], 24, '#fff9df');
  if (clippedStatus()) {
    context.save();
    context.beginPath();
    context.rect(layout.status.x, layout.status.y, layout.status.width, 8);
    context.clip();
  }
  drawLines('status', layout.status, wrap(statusText(), layout.status.width - textInset * 2, fonts.status), 22);
  if (clippedStatus()) { context.restore(); }
}

// These are the glyph metrics used by fillText, not inferred semantic regions.
function drawLines(name, bounds, lines, lineHeight, color = '#49371e') {
  context.font = fonts[name];
  context.textBaseline = 'alphabetic';
  context.fillStyle = color;
  const textBounds = [];
  const x = bounds.x + (name === 'action' ? 0 : textInset);
  for (const [index, line] of lines.entries()) {
    const baseline = bounds.y + index * lineHeight + (name === 'title' ? 22 : 17);
    const metrics = context.measureText(line);
    context.fillText(line, x, baseline);
    textBounds.push({
      x: x - metrics.actualBoundingBoxLeft,
      y: baseline - metrics.actualBoundingBoxAscent,
      width: metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight,
      height: metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent,
    });
  }
  drawn[name] = textBounds;
}

function actionContent() {
  return { x: layout.action.x + 14, y: layout.action.y + 12, width: layout.action.width - 28, height: 28 };
}

function setPhase(phase) {
  state.phase = state.accepted ? 'accepted' : phase;
  paint();
}

function activate() {
  if (fault === 'missing-handler') { return; }
  state.accepted++;
  state.phase = 'accepted';
  paint();
}

function insideAction(event) {
  const bounds = canvas.getBoundingClientRect();
  const x = (event.clientX - bounds.left) * layout.width / bounds.width;
  const y = (event.clientY - bounds.top) * layout.height / bounds.height;
  return x >= layout.action.x && x <= layout.action.x + layout.action.width &&
    y >= layout.action.y && y <= layout.action.y + layout.action.height;
}

function wireInput(input) {
  input.addEventListener('pointermove', (event) => {
    const inside = renderer === 'dom' || insideAction(event);
    setPhase(inside ? (pointerDown ? 'pressed' : 'hover') : 'idle');
  });
  input.addEventListener('pointerleave', () => { setPhase('idle'); });
  input.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || (renderer === 'canvas' && !insideAction(event))) { return; }
    pointerDown = true;
    input.focus({ preventScroll: true });
    setPhase('pressed');
  });
  input.addEventListener('pointerup', (event) => {
    if (event.button !== 0) { return; }
    pointerDown = false;
    setPhase(renderer === 'dom' || insideAction(event) ? 'hover' : 'idle');
  });
  input.addEventListener('click', (event) => {
    if (renderer === 'dom' || insideAction(event)) { activate(); }
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === ' ' || event.key === 'Enter') {
      if (renderer === 'canvas') { event.preventDefault(); }
      if (!event.repeat) { setPhase('pressed'); }
    }
  });
  input.addEventListener('keyup', (event) => {
    if (event.key === ' ' || event.key === 'Enter') {
      if (renderer === 'canvas') { event.preventDefault(); activate(); }
      else { setPhase('hover'); }
    }
  });
  window.addEventListener('pointerup', () => { pointerDown = false; });
}

function createDom() {
  panel = document.createElement('article');
  panel.id = 'panel';
  panel.setAttribute('aria-labelledby', 'title');
  panel.innerHTML = '<div class="panel-art" aria-hidden="true"></div><div id="content">' +
    '<h2 id="title" class="text-block"></h2><p id="body" class="text-block"></p>' +
    '<button id="action" type="button"><span id="action-content"><span id="action-label">Accept quest</span></span></button>' +
    '<p id="status" class="text-block" role="status"></p></div>';
  stage.append(panel);
  dom = Object.fromEntries(['content', 'title', 'body', 'action', 'status'].map((name) => [name, panel.querySelector(`#${name}`)]));
  dom.label = panel.querySelector('#action-label');
  wireInput(dom.action);
}

function createCanvas() {
  canvas = document.createElement('canvas');
  canvas.id = 'panel';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'button');
  canvas.setAttribute('aria-label', copy.action);
  canvas.textContent = 'Accept a quest from the Oakleaf Guild.';
  stage.append(canvas);
  context = canvas.getContext('2d');
  wireInput(canvas);
}

function translate(bounds) {
  const origin = canvas.getBoundingClientRect();
  const scaleX = origin.width / layout.width;
  const scaleY = origin.height / layout.height;
  return { x: origin.left + bounds.x * scaleX, y: origin.top + bounds.y * scaleY,
    width: bounds.width * scaleX, height: bounds.height * scaleY };
}

function measure(id) {
  if (renderer !== 'canvas') { throw new Error('Measure HTML/CSS through its DOM locators.'); }
  if (id !== 'panel' && id !== 'action') { throw new Error(`Unknown target: ${id}`); }
  if (id === 'action') {
    return {
      bounds: translate(layout.action), contentBox: translate(actionContent()),
      content: { label: { bounds: translate(actionContent()), text: copy.action, textBounds: drawn.action.map(translate) } },
    };
  }
  const content = {};
  for (const name of ['title', 'body', 'action', 'status']) {
    const bounds = name === 'status' && clippedStatus() ? { ...layout.status, height: 8 } : layout[name];
    content[name] = { bounds: translate(bounds), text: name === 'status' ? statusText() : copy[name], textBounds: drawn[name].map(translate) };
  }
  return { bounds: translate({ x: 0, y: 0, width: layout.width, height: layout.height }), contentBox: translate(layout.content), content };
}

const ready = Promise.all([art.decode(), document.fonts.ready]).then(async () => {
  if (renderer === 'dom') { createDom(); } else { createCanvas(); }
  if (fault === 'overlay') {
    overlay = document.createElement('div');
    overlay.className = 'input-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    stage.append(overlay);
  }
  arrange();
  window.addEventListener('resize', arrange);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
});

// Observation only. Inputs still go through browser events and application handlers.
window.browserE2EFixture = Object.freeze({
  ready, measure,
  getState: () => ({ ...state, paintedPhase: painted.phase, paintedAccepted: painted.accepted, renderer }),
});
