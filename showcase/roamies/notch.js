// The notch capsule: the agent comes out of the top of the screen (a Mac's camera notch, where there is one) instead
// of popping up beside the cursor.
// A black capsule pours out of the notch (it starts exactly the notch's size, so it reads as the notch itself
// growing), spreads sideways with a little spring, and drops open when there's something to read. When the turn is
// over it folds back the same way and disappears into the notch. Inside: a small live JARVIS globe (jarvis.js, the
// same renderer as the sidekick), what it's doing, and the reply as it streams.
// Two styles (R.notch.style): 'drop' (the default) is a capsule that pours out of the notch like water, a liquid
// neck stretching and splitting off with a couple of droplets, floats just under the notch and plays with the cursor
// (the lens watches it, a click folds the reply away or opens it again), then rises back and melts
// into the notch the same way. 'spread' widens sideways out of the notch instead.
// The lens shows whichever look is picked (JARVIS's globe, a person, or the Roamie blob). While it speaks, a true
// waveform of its own voice (voice-out.js samples) runs in the status slot; while it listens, one that follows the mic.
// Screens without a notch get the same capsule hanging from the top edge, with nothing to hide in at rest.
// The overlay is click-through, so the host asks Roamie.notchHit(x, y) whether the cursor is over it.
// API: Roamie.notch.enabled (set by the host from the setting) .active .listen() .level(v) .heard(text) .think(text)
//      .tool(label) .text(chunk) .done({ speech }) .fail(message) .say(text) .prompt(question, choices, onChoose)
//      .close() .rect()
(() => {
  const R = window.Roamie;
  if (typeof document === 'undefined' || !R) return;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ---------- look ----------
  const INK = '#dcfff6', ACCENT = '#78ffe2';
  // The LED levels JARVIS is drawn in (12-sidekick.js), level 0 never drawn here: the capsule is the dark.
  const PAL = [null, 'rgb(14,92,96)', 'rgb(40,196,184)', 'rgb(120,255,226)', 'rgb(230,255,250)'];
  const L = PAL.length - 1;
  // Fillet where the capsule meets the top edge, flowing into the screen like the notch's own corners.
  const FILLET = 9;
  // Compact: the notch plus a wing either side for the globe and the status. Open: wide enough to read.
  const WING = 88, OPEN_W = 440, MAX_BODY = 7 * 20;
  // Drop: the pill's height, and how far below the notch it floats.
  // GAP is past the goo's reach, so the neck always breaks once the pill has settled.
  const DROP_ROW = 40, GAP = 15;

  const css = `
.nc { --ink: ${INK}; --ink-2: rgba(220,255,246,.62); --ink-3: rgba(220,255,246,.38); --accent: ${ACCENT};
  --w: 180px; --h: 32px; --r: 0px; --f: ${FILLET}px;
  --y: 0px; --gl: .4; --gr: .4; --glow-a: #6fd6ff; --glow-b: #2a6bff;
  position: fixed; top: var(--y); left: 50%; z-index: 9; box-sizing: border-box; width: var(--w); height: var(--h);
  transform-origin: 50% 0;
  /* Centred by its left edge (the host sets it from var(--w)), never a percentage translate: WebKit freezes those at
     the size an animation started at, so it came out off-centre. Squash and hover scale are set by the frame loop for
     the same reason (no animation handed to the GPU). */ background: #000; color: var(--ink); border-radius: 0 0 var(--r) var(--r);
  font: 400 12.5px/20px "Martian Mono", "Roamies Bengali", "Roamies Arabic", "Kohinoor Bangla", ".SF Bangla", ui-monospace, Menlo, monospace;
  pointer-events: none; visibility: hidden; contain: layout style;
  transition: --w .46s cubic-bezier(.22, 1, .36, 1), --h .4s cubic-bezier(.22, 1, .36, 1), --r .4s cubic-bezier(.22, 1, .36, 1),
    top .6s cubic-bezier(.3, 1.35, .5, 1), box-shadow .35s ease, --glow-a .6s ease, --glow-b .6s ease; }
/* The size is animated through these (not width and height), so what's sized from them (the card, the glow's outline)
   follows the shape frame by frame. */
@property --w { syntax: '<length>'; inherits: true; initial-value: 180px; }
@property --h { syntax: '<length>'; inherits: true; initial-value: 32px; }
@property --r { syntax: '<length>'; inherits: true; initial-value: 0px; }
.nc.on { visibility: visible; }
.nc.hot { pointer-events: auto; cursor: default; }
/* Folding back: no spring, it should look like it's being drawn in. */
.nc.closing { transition: --w .34s cubic-bezier(.55, 0, .75, .2) .12s, --h .3s cubic-bezier(.5, 0, .7, .3), --r .3s ease-in,
  top .42s cubic-bezier(.6, 0, .8, .35) .08s; }
/* Drop: a floating pill, no fillets (the neck joins it to the notch instead), a shadow to lift it off the page. */
.nc.drop::before, .nc.drop::after { display: none; }
.nc.drop { background: #000; border-radius: var(--r); }
.nc.drop.compact, .nc.drop.full { box-shadow: 0 12px 32px rgba(0, 0, 0, .34), 0 2px 6px rgba(0, 0, 0, .3), 0 0 0 1px rgba(120, 190, 255, .07); }
.nc.drop.hot { cursor: pointer; }
.nc.drop.full.hot { cursor: default; }
/* Drop: the name on the left glow, the globe in the middle like a camera lens, the status on the right glow. */
.nc.drop .nc-row { display: grid; grid-template-columns: 1fr auto 1fr; gap: 12px; padding: 0 18px; }
.nc.drop .nc-mark { justify-self: start; }
.nc.drop .nc-status { justify-self: end; color: #fff; }
/* The pill never changes shape: the reply and Allow prompts open in their own card. Closed, the card is the pill's
   size, tucked under it; it slides down out of the pill as it widens and grows, and goes back up the same way. The
   text keeps its final width, so it doesn't re-wrap while the card grows. */
.nc.drop .nc-body { --cw: var(--w); top: 0; left: calc(50% - var(--cw) / 2); right: auto; width: var(--cw); padding: 14px 20px 16px;
  height: var(--row); overflow: hidden; box-sizing: border-box; opacity: 0;
  background: #000; border-radius: 22px; pointer-events: none;
  box-shadow: 0 14px 36px rgba(0, 0, 0, .34), 0 2px 6px rgba(0, 0, 0, .3), 0 0 0 1px rgba(120, 190, 255, .07), inset 0 1px 0 rgba(255, 255, 255, .06);
  transition: opacity .12s ease .2s, --cw .32s cubic-bezier(.4, 0, .2, 1), height .3s cubic-bezier(.4, 0, .2, 1), top .32s cubic-bezier(.4, 0, .2, 1); }
.nc.drop.full .nc-body { --cw: var(--bw, 440px); top: calc(var(--row) + 8px); height: var(--bh, auto); opacity: 1; pointer-events: auto;
  transition: opacity .1s ease, --cw .44s cubic-bezier(.22, 1, .36, 1), height .4s cubic-bezier(.22, 1, .36, 1), top .52s cubic-bezier(.3, 1.25, .5, 1); }
@property --cw { syntax: '<length>'; inherits: false; initial-value: 0px; }
.nc.drop .nc-text { width: calc(var(--bw, 440px) - 40px + var(--sb)); }
/* The pill (its black, glow and contents) stays above the card while it slides out from under it. */
.nc.drop .nc-skin, .nc.drop .nc-row { z-index: 1; }
.nc.drop .nc-skin { background: #000; }
.nc.drop .nc-globe { width: 30px; height: 30px; border-radius: 50%; background: radial-gradient(circle, #0b1626 0, #000 72%);
  box-shadow: 0 0 0 2px #070a12, 0 0 0 3.5px rgba(255, 255, 255, .08), inset 0 0 6px #000; }

/* The concave corners either side, so the capsule flows out of the top edge instead of sitting under it. */
.nc::before, .nc::after { content: ""; position: absolute; top: 0; width: var(--f); height: var(--f); pointer-events: none; }
.nc::before { right: 100%; background: radial-gradient(circle at 0 100%, transparent calc(var(--f) - .5px), #000 var(--f)); }
.nc::after { left: 100%; background: radial-gradient(circle at 100% 100%, transparent calc(var(--f) - .5px), #000 var(--f)); }
/* The skin: light blooming in from both ends, and on the drop pill a glassy top highlight. */
.nc-skin { position: absolute; inset: 0; border-radius: inherit; overflow: hidden; pointer-events: none; opacity: 0; transition: opacity .3s ease .14s; }
.nc.compact .nc-skin, .nc.full .nc-skin { opacity: 1; }
.nc.closing .nc-skin { opacity: 0; transition: opacity .12s ease; }
/* Notch style: the light fills the whole outline, the flares where it meets the top edge included (the skin reaches
   over them and is cut to the outline: flares, sides, rounded bottom corners). Above the flares' own black. */
.nc:not(.drop) .nc-skin { left: calc(-1 * var(--f)); right: calc(-1 * var(--f)); border-radius: 0; z-index: 1;
  -webkit-mask: radial-gradient(circle at 0 100%, transparent calc(var(--f) - .5px), #000 var(--f)) 0 0 / var(--f) var(--f) no-repeat,
    radial-gradient(circle at 100% 100%, transparent calc(var(--f) - .5px), #000 var(--f)) 100% 0 / var(--f) var(--f) no-repeat,
    linear-gradient(#000, #000) var(--f) 0 / calc(100% - 2 * var(--f)) calc(100% - var(--r) + 1px) no-repeat,
    linear-gradient(#000, #000) calc(var(--f) + var(--r)) 100% / calc(100% - 2 * var(--f) - 2 * var(--r)) var(--r) no-repeat,
    radial-gradient(circle at 100% 0, #000 calc(var(--r) - .5px), transparent var(--r)) var(--f) 100% / var(--r) var(--r) no-repeat,
    radial-gradient(circle at 0 0, #000 calc(var(--r) - .5px), transparent var(--r)) calc(100% - var(--f)) 100% / var(--r) var(--r) no-repeat;
  mask: radial-gradient(circle at 0 100%, transparent calc(var(--f) - .5px), #000 var(--f)) 0 0 / var(--f) var(--f) no-repeat,
    radial-gradient(circle at 100% 100%, transparent calc(var(--f) - .5px), #000 var(--f)) 100% 0 / var(--f) var(--f) no-repeat,
    linear-gradient(#000, #000) var(--f) 0 / calc(100% - 2 * var(--f)) calc(100% - var(--r) + 1px) no-repeat,
    linear-gradient(#000, #000) calc(var(--f) + var(--r)) 100% / calc(100% - 2 * var(--f) - 2 * var(--r)) var(--r) no-repeat,
    radial-gradient(circle at 100% 0, #000 calc(var(--r) - .5px), transparent var(--r)) var(--f) 100% / var(--r) var(--r) no-repeat,
    radial-gradient(circle at 0 0, #000 calc(var(--r) - .5px), transparent var(--r)) calc(100% - var(--f)) 100% / var(--r) var(--r) no-repeat; }
.nc:not(.drop) .nc-row, .nc:not(.drop) .nc-body { z-index: 2; }
.nc.drop .nc-skin::after { content: ""; position: absolute; inset: 0; border-radius: inherit;
  background: linear-gradient(to bottom, rgba(255, 255, 255, .08), rgba(255, 255, 255, 0) 45%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .07); }
.nc-glow { position: absolute; top: calc(var(--row) * -.55); height: calc(var(--row) * 2.1); width: calc(var(--row) * 3.2); border-radius: 50%;
  background: radial-gradient(closest-side, color-mix(in srgb, var(--glow-a) 70%, #fff), var(--glow-a) 22%,
    color-mix(in srgb, var(--glow-b) 70%, transparent) 50%, transparent 100%);
  filter: blur(9px); --k: var(--gl); opacity: calc(.3 + var(--k) * .7); transform: scale(calc(.85 + var(--k) * .25)); }
.nc-glow.l { left: calc(var(--row) * -1.5); }
.nc-glow.r { right: calc(var(--row) * -1.5); --k: var(--gr); }
.nc:not(.drop) .nc-glow.l { left: calc(var(--f) - var(--row) * 1.5); }
.nc:not(.drop) .nc-glow.r { right: calc(var(--f) - var(--row) * 1.5); }
/* Each state has its colour: listening cyan, thinking indigo, responding blue, waiting for an OK a calm teal,
   trouble amber. The colours ease from one to the next (registered properties, see @property below). */
.nc[data-mode="listen"] { --glow-a: #7ff3ff; --glow-b: #1fa8ff; }
.nc[data-mode="think"], .nc[data-mode="tool"] { --glow-a: #a9b6ff; --glow-b: #5a4dff; }
.nc[data-mode="ask"] { --glow-a: #8ff5e0; --glow-b: #1fb5a0; }
.nc[data-mode="error"] { --glow-a: #ffcf86; --glow-b: #ff6a2f; }
@property --glow-a { syntax: '<color>'; inherits: true; initial-value: #6fd6ff; }
@property --glow-b { syntax: '<color>'; inherits: true; initial-value: #2a6bff; }
.nc-mark { flex: none; color: #fff; font: 800 15px/1 "Doto", "Martian Mono", "Roamies Bengali", "Roamies Arabic", "Kohinoor Bangla", ".SF Bangla", ui-monospace, monospace;
  letter-spacing: .02em; text-shadow: 0 0 10px rgba(0, 30, 90, .55); white-space: nowrap; }
.nc:not(.drop) .nc-globe { order: -1; }
.nc:not(.drop) .nc-status { margin-left: auto; }
.nc-row { position: absolute; left: 0; right: 0; top: 0; height: var(--row); display: flex; align-items: center; gap: 8px;
  padding: 0 16px 0 12px; box-sizing: border-box; opacity: 0; transition: opacity .18s ease .22s; }
.nc.full .nc-row, .nc.compact .nc-row { opacity: 1; }
.nc.closing .nc-row, .nc.closing .nc-body { opacity: 0; transition: opacity .1s ease; }
/* desktop.html pins every canvas to the page's top-left (the sidekick's stage): not these. */
.nc canvas { position: static; left: auto; top: auto; transform: none; will-change: auto; cursor: inherit; touch-action: auto; }
.nc-globe { flex: none; width: 28px; height: 28px; image-rendering: pixelated; }
.nc-status { flex: none; display: flex; align-items: center; gap: 8px; color: var(--ink); text-shadow: 0 0 10px rgba(0, 30, 90, .55); white-space: nowrap; max-width: 300px;
  overflow: hidden; text-overflow: ellipsis; }
.nc.full .nc-status { max-width: none; }
.nc-label { display: inline-block; overflow: hidden; text-overflow: ellipsis; will-change: transform, opacity;
  font-size: 11px; line-height: 1.3; letter-spacing: .04em; text-transform: uppercase; }
/* The waveform and the lens ease in when they appear. */
@keyframes nc-in { from { opacity: 0; transform: scaleX(.3); } }
.nc[data-mode="listen"] .nc-wave, .nc[data-mode="talk"] .nc-wave { animation: nc-in .32s cubic-bezier(.2, .8, .2, 1); }
/* The waveform: the agent's own voice while it speaks, the mic while it listens. */
.nc-wave { display: none; width: 64px; height: 24px; }
.nc[data-mode="listen"] .nc-wave, .nc[data-mode="talk"] .nc-wave { display: block; }
.nc[data-mode="talk"] .nc-label, .nc.drop[data-mode="listen"] .nc-label { display: none; }
/* Liquid: while it pours out of the notch or melts back in, a bridge of liquid glass (the goo layer below) joins the
   capsule to the notch; the capsule stays solid, its contents come in once it has split off. */
.nc.drop.liquid .nc-row, .nc.drop.liquid .nc-skin { opacity: 0; transition: opacity .12s ease; }
.nc.drop.liquid { box-shadow: none !important; }
.nc.drop .nc-skin, .nc.drop .nc-row { transition: opacity .16s ease; }
.nc-goo { position: fixed; top: 0; left: 0; width: 760px; height: 140px; z-index: 8; pointer-events: none; display: none; }
.nc-goo .g-layer { position: absolute; inset: 0; }
.nc-goo .g-fill { filter: url(#nc-fill-f); }
.nc-goo .g-rim, .nc-goo .g-drop { display: none !important; }
.nc-goo i { position: absolute; display: block; background: #000; }
.nc-goo .g-notch { border-radius: 0 0 14px 14px; }
.nc-goo .g-drop { border-radius: 50%; }
.nc-goo .g-tongue { border-radius: 0 0 50% 50% / 0 0 16px 16px; }
.nc[data-mode="error"] .nc-status { color: #ffcf8a; }
.nc-body { position: absolute; left: 0; right: 0; top: var(--row); padding: 2px 20px 16px; box-sizing: border-box; opacity: 0;
  transition: opacity .2s ease .18s; }
/* Words show the frame they arrive: no fade on the way in. */
.nc.full .nc-body { opacity: 1; transition: opacity 0s; }
/* Notch style: the reply is inside the shape, so it's cut to the shape while it grows and shrinks. */
.nc:not(.drop) .nc-body { clip-path: inset(0 0 max(0px, calc(100% - var(--h) + var(--row))) 0); }
.nc:not(.drop) .nc-text { width: calc(var(--bw, 440px) - 40px + var(--sb)); }
/* The scrollbar has its own lane in the card's right margin (--sb wide), so it never sits over the words, whether the
   system draws it over the content (macOS's default) or beside it; the words keep the same width either way. */
.nc-text { --sb: 12px; margin: 0 calc(-1 * var(--sb)) 0 0; padding-right: var(--sb); box-sizing: border-box; scrollbar-gutter: stable;
  max-height: ${MAX_BODY}px; overflow: hidden auto; overscroll-behavior: contain; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--ink);
  scrollbar-width: thin; scrollbar-color: rgba(120,255,226,.35) transparent;
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 14px, #000 calc(100% - 14px), transparent 100%); }
/* Long replies scroll (wheel or trackpad); the edges fade only where there's more to see. */
.nc-text::-webkit-scrollbar { width: 6px; }
.nc-text::-webkit-scrollbar-thumb { background: rgba(120,255,226,.35); border-radius: 3px; }
.nc-text::-webkit-scrollbar-track { background: transparent; }
.nc-text.top { -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 14px), transparent 100%); }
.nc-text.end { -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 14px); }
.nc-text.short, .nc-text.top.end { -webkit-mask-image: none; }
.nc-heard { color: var(--ink-3); }
/* Each line is its own paragraph with its own direction (Arabic and Hebrew run right to left, in the Arabic font). */
.nc-line:dir(rtl) { font-family: "Roamies Arabic RTL", "Martian Mono", "Roamies Bengali", "Roamies Arabic", "Kohinoor Bangla", ".SF Bangla", ui-monospace, Menlo, monospace; }
.nc-choices { display: flex; gap: 8px; margin-top: 12px; }
.nc-choices button { font: inherit; letter-spacing: inherit; border-radius: 999px; padding: 4px 14px; cursor: pointer;
  border: 1px solid rgba(120,255,226,.45); background: transparent; color: var(--ink); }
.nc-choices button:first-child { background: var(--accent); border-color: var(--accent); color: #000; }
.nc-choices button.sel { outline: 2px solid var(--ink); outline-offset: 2px; }
.nc-choices button:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.nc-keys { align-self: center; margin-left: auto; color: var(--ink-3); }
@media (prefers-reduced-motion: reduce) {
  .nc, .nc.closing { transition: opacity .18s ease; }
  .nc-goo { display: none !important; }
  .nc-row, .nc-body { transition: none; }
}
.nc-sr { position: fixed; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (forced-colors: active) { .nc { border: 2px solid CanvasText; } }
`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const el = document.createElement('div');
  el.className = 'nc drop'; // the capsule is the default; 'spread' is the alternative
  // Screen readers hear the reply once it's whole (and Allow questions, and errors), not every streamed word.
  const sr = document.createElement('p');
  sr.className = 'nc-sr';
  sr.setAttribute('role', 'status');
  const announce = (t) => { sr.textContent = ''; setTimeout(() => { sr.textContent = String(t ?? '').replace(/\*\*|__|`|^#+\s*/gm, ''); }, 60); };
  el.innerHTML = '<div class="nc-skin" aria-hidden="true"><i class="nc-glow l"></i><i class="nc-glow r"></i></div>'
    + '<div class="nc-row"><span class="nc-mark">JARVIS</span><canvas class="nc-globe" aria-hidden="true"></canvas>'
    + '<div class="nc-status"><canvas class="nc-wave" aria-hidden="true"></canvas><span class="nc-label"></span></div></div>'
    + '<div class="nc-body"><p class="nc-text"></p><div class="nc-choices" hidden></div></div>';
  // The goo: blurred, then its alpha thresholded, so shapes that touch melt into one (metaballs). The notch, a tongue,
  // the pill and two droplets live in it while it pours out or melts back. It's drawn twice from the same shapes:
  // - fill: the capsule's black, faded by a vertical mask so the bridge is black where it leaves the notch, clear in
  //   the middle and black again where it joins the capsule (it belongs to both);
  // - rim: liquid glass edges (a refraction band, a bright rim and a highlight riding the curves), never faded, so the
  //   clear middle still reads as glass.
  const SHAPE = '<feGaussianBlur in="SourceAlpha" stdDeviation="5.5" result="b"/>'
    + '<feColorMatrix in="b" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 26 -11" result="shape"/>';
  const goo = document.createElement('div');
  goo.className = 'nc-goo';
  goo.setAttribute('aria-hidden', 'true');
  const shapes = '<i class="g-notch"></i><i class="g-tongue"></i><i class="g-pill"></i><i class="g-drop"></i><i class="g-drop"></i>';
  goo.innerHTML = '<svg width="0" height="0" style="position:absolute">'
    + '<filter id="nc-fill-f" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">'
    + '<feGaussianBlur in="SourceAlpha" stdDeviation="7" result="b"/>'
    + '<feColorMatrix in="b" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 34 -15" result="shape"/>'
    + '<feFlood flood-color="#000"/><feComposite in2="shape" operator="in"/></filter>'
    + '<filter id="nc-rim-f" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">' + SHAPE
    + '<feMorphology in="shape" operator="erode" radius="1.3" result="inner"/>'
    + '<feComposite in="shape" in2="inner" operator="out" result="rim0"/>'
    + '<feColorMatrix in="rim0" type="matrix" values="0 0 0 0 .92  0 0 0 0 .97  0 0 0 0 1  0 0 0 .7 0" result="rim"/>'
    + '<feGaussianBlur in="inner" stdDeviation="3" result="ib"/>'
    + '<feComposite in="shape" in2="ib" operator="out" result="band0"/>'
    + '<feColorMatrix in="band0" type="matrix" values="0 0 0 0 .55  0 0 0 0 .75  0 0 0 0 1  0 0 0 .22 0" result="band"/>'
    + '<feGaussianBlur in="shape" stdDeviation="2.2" result="hb"/>'
    + '<feSpecularLighting in="hb" surfaceScale="5" specularConstant="1.4" specularExponent="26" lighting-color="#ffffff" result="spec0">'
    + '<feDistantLight azimuth="240" elevation="52"/></feSpecularLighting>'
    + '<feComposite in="spec0" in2="shape" operator="in" result="spec"/>'
    + '<feMerge><feMergeNode in="band"/><feMergeNode in="rim"/><feMergeNode in="spec"/></feMerge></filter></svg>'
    + `<div class="g-layer g-fill">${shapes}</div><div class="g-layer g-rim">${shapes}</div>`;
  // Each shape is in both layers: set them together.
  const pair = (sel) => { const a = goo.querySelectorAll(`.g-fill ${sel}`), b = goo.querySelectorAll(`.g-rim ${sel}`); return [...a].map((x, i) => [x, b[i]]); };
  const place = (two, css) => { for (const e of two) Object.assign(e.style, css); };
  const [gNotch] = pair('.g-notch'), [gTongue] = pair('.g-tongue'), [gPill] = pair('.g-pill'), gDrops = pair('.g-drop');
  const gFill = goo.querySelector('.g-fill');
  const mount = () => { if (!el.isConnected) document.body.append(goo, el, sr); };
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
  // Text is measured to size the capsule: measure again once the fonts are in (else 'Searching the web' gets cut).
  document.fonts?.ready?.then(() => refit?.());
  document.fonts?.addEventListener?.('loadingdone', () => refit?.());
  const $ = (s) => el.querySelector(s);
  const globe = $('.nc-globe'), label = $('.nc-label'), textEl = $('.nc-text'), choicesEl = $('.nc-choices'), wave = $('.nc-wave');

  // ---------- geometry ----------
  // The notch as the shell reported it (main.rs safe_js): left edge, width and height in this screen's CSS px.
  const notch = () => {
    const n = R.safe?.notch;
    if (n && n.w > 0) return { x: n.x, w: n.w, h: n.h, real: true };
    // No notch: a capsule as tall as the menu bar (or a slim one), with nothing to hide in at rest.
    const h = clamp(R.safe?.top || 30, 26, 40);
    return { x: innerWidth / 2 - 90, w: 180, h, real: false };
  };
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  let shape = 'rest';
  const drop = () => el.classList.contains('drop');
  // While it's open, the top of the screen down to its bottom edge (card included) is the capsule's: R.safe.top is
  // raised so drawings, cards and the sidekick are placed below it. Put back when it closes.
  const reserve = (px) => {
    R.notchReserve = px;
    if (R.safeTop0 == null) R.safeTop0 = R.safe?.top ?? 0;
    if (R.safe) R.safe.top = Math.max(R.safeTop0, px);
  };
  // The shape it should have now: open for a prompt or a reply (unless folded), else the slim one.
  // The card waits for the pill to split off the notch, and goes back in before the pill does.
  const want = () => (!st.retractT && st.liq?.dir !== 'out' && (st.prompt || (st.text && !st.folded)) ? 'full' : 'compact');
  const apply = (s) => {
    if (drop()) return applyDrop(s);
    el.style.setProperty('--y', '0px');
    const n = notch(), row = Math.max(n.h, 34);
    el.style.left = `calc(${n.x + n.w / 2}px - var(--w) / 2)`;
    el.style.setProperty('--row', `${row}px`);
    // Both wings as wide as the status needs (the capsule stays centred on the notch), within reason.
    // Left wing: globe and name; right wing: the status. Both as wide as the wider one, so it stays centred.
    const mark = $('.nc-mark');
    const need = Math.max(12 + 28 + 8 + mark.scrollWidth + 18, (st.statusW ?? $('.nc-status').scrollWidth) + 34);
    const wing = clamp(Math.ceil(need), WING, 240);
    el.style.setProperty('--wing', `${wing}px`);
    let w = n.w, h = n.real ? n.h : 0, r = n.real ? n.h * 0.36 : 0;
    if (s === 'compact') { w = n.w + wing * 2; h = row; r = row / 2; }
    else if (s === 'full') {
      w = Math.min(Math.max(OPEN_W, n.w + WING * 2), innerWidth - 24);
      el.style.setProperty('--bw', `${Math.round(w)}px`);
      const body = $('.nc-body');
      h = row + body.scrollHeight; r = 26;
    }
    el.style.setProperty('--w', `${Math.round(w)}px`);
    el.style.setProperty('--h', `${Math.round(h)}px`);
    el.style.setProperty('--r', `${Math.round(r)}px`);
    // The fillets only make sense against a real notch, or once there's a capsule to flow from.
    el.style.setProperty('--f', `${s === 'rest' && !n.real ? 0 : FILLET}px`);
    el.classList.toggle('compact', s === 'compact');
    el.classList.toggle('full', s === 'full');
    shape = s;
    reserve(s === 'rest' ? 0 : Math.round(h + 10));
  };
  // Drop: at rest a pill hidden inside the notch (or above the top edge); out, a pill floating GAP below it.
  const applyDrop = (s) => {
    const n = notch(), row = DROP_ROW;
    el.style.left = `calc(${n.x + n.w / 2}px - var(--w) / 2)`;
    el.style.setProperty('--row', `${row}px`);
    el.style.setProperty('--f', '0px');
    const statusW = st.statusW ?? $('.nc-status').scrollWidth;
    let w = n.real ? n.w * 0.62 : 120, h = n.real ? Math.min(n.h, row) : row, r = h / 2, y = n.real ? 0 : -row - 12;
    if (s === 'compact') {
      // The globe dead centre: both sides as wide as the wider of the name and the status.
      const side = Math.max($('.nc-mark').scrollWidth, statusW);
      w = Math.max(190, 2 * (side + 18 + 12) + 30, st.minW || 0); h = row; r = row / 2; y = n.h + GAP;
    } else if (s === 'full') {
      const side = Math.max($('.nc-mark').scrollWidth, statusW);
      w = Math.max(190, 2 * (side + 18 + 12) + 30, st.minW || 0); h = row; r = row / 2; y = n.h + GAP;
      el.style.setProperty('--bw', `${Math.round(Math.min(OPEN_W, innerWidth - 24))}px`);
    }
    // Within a turn the pill only grows: a shorter status doesn't shrink it and grow it again a moment later.
    if (s !== 'rest') st.minW = Math.max(st.minW || 0, w);
    el.style.setProperty('--w', `${Math.round(Math.min(w, innerWidth - 24))}px`);
    el.style.setProperty('--h', `${Math.round(h)}px`);
    el.style.setProperty('--r', `${Math.round(r)}px`);
    el.style.setProperty('--y', `${Math.round(y)}px`);
    el.classList.toggle('compact', s === 'compact');
    el.classList.toggle('full', s === 'full');
    shape = s;
    const card = s === 'full' ? 8 + (parseFloat(getComputedStyle($('.nc-body')).getPropertyValue('--bh')) || $('.nc-body').scrollHeight) : 0;
    reserve(s === 'rest' ? 0 : Math.round(y + h + card + 12));
  };

  // ---------- state ----------
  const st = { mode: null, open: false, text: '', heard: '', mic: 0, lingerAt: 0, linger: 0, speech: null, prompt: null, hover: false, closeT: 0, folded: false, px: null, py: null, g: 0.4, look: 'jarvis', liq: null, follow: true };
  let raf = 0, last = 0;
  const jst = { t: 0, dt: 0.016, mode: null, act: null, actA: 0, open: 1, look: [0, 0], sq: 0, wide: 0, dizzy: 0, happy: 0, sleepy: 0, voice: null, heard: 0 };

  // The status slot (the waveform or the words) changes with a little motion: the old content lifts and blurs away,
  // the pill starts resizing for the new content at once, and the new content settles in once there's room for it.
  const statusEl = $('.nc-status');
  const labelShown = (m) => m !== 'talk' && !(drop() && m === 'listen');
  const looks = (m, words) => `${m === 'listen' || m === 'talk' ? 'wave' : ''}|${labelShown(m) ? words : ''}`;
  // The status width a mode and words would take (laid out once, never painted).
  const statusWidthFor = (m, words) => {
    const keepM = el.dataset.mode, keepW = label.textContent;
    el.dataset.mode = m; label.textContent = words;
    const w = statusEl.scrollWidth;
    el.dataset.mode = keepM; label.textContent = keepW;
    return w;
  };
  let swapTo = null, swapN = 0;
  const settle = (to) => { el.dataset.mode = to.mode; label.textContent = to.words; };
  const setMode = (m, words) => {
    st.mode = m;
    const cur = swapTo ?? { mode: el.dataset.mode ?? '', words: label.textContent };
    const to = { mode: m ?? '', words: words ?? cur.words };
    if (looks(to.mode, to.words) === looks(cur.mode, cur.words)) {
      // Looks the same (the glow colour may still change): no motion.
      if (swapTo) swapTo = to; else settle(to);
      return;
    }
    swapN++; statusEl.getAnimations?.().forEach((a) => a.cancel());
    if (!st.open || shape === 'rest' || reduced()) { swapTo = null; settle(to); st.statusW = null; if (st.open && shape !== 'rest') refit(); return; }
    const tok = swapN, was = statusEl.scrollWidth;
    st.statusW = statusWidthFor(to.mode, to.words);
    const grows = st.statusW > was + 2;
    swapTo = to;
    refit();
    const settleIn = () => {
      if (tok !== swapN) return;
      swapTo = null; settle(to);
      if (looks(to.mode, to.words) === '|') return;
      // Growing: the pill gets a head start, so the words never spill past it.
      statusEl.animate?.([{ opacity: 0, filter: 'blur(3px)', transform: 'translateY(5px)' }, { opacity: 1, filter: 'blur(0)', transform: 'translateY(0)' }],
        { duration: 240, delay: grows ? 110 : 0, easing: 'cubic-bezier(.2, .8, .2, 1)', fill: 'backwards' });
    };
    if (looks(cur.mode, cur.words) === '|') { settleIn(); return; } // nothing showing to fade away
    const out = statusEl.animate?.([{ opacity: 1, filter: 'blur(0)', transform: 'translateY(0)' }, { opacity: 0, filter: 'blur(3px)', transform: 'translateY(-5px)' }], { duration: 120, easing: 'ease-in', fill: 'forwards' });
    if (!out) { settleIn(); return; }
    out.onfinish = () => { if (tok !== swapN) return; out.cancel(); settleIn(); };
  };
  const show = () => {
    mount();
    R.wake?.();
    clearTimeout(st.closeT);
    if (st.retractT) { clearTimeout(st.retractT); st.retractT = 0; requestAnimationFrame(() => { if (st.open) apply(want()); }); }
    if (st.open && !el.classList.contains('closing')) return;
    st.open = true;
    el.classList.remove('closing');
    if (!el.classList.contains('on')) {
      // From the notch's own size, with no transition, then let it spring out.
      el.style.transition = 'none';
      apply('rest');
      el.classList.add('on');
      void el.offsetWidth;
      el.style.transition = '';
    }
    pour('out');
    // Measured now it's open: text set while it was closed (a line said on its own, a prompt) wasn't.
    refit();
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  };
  const close = () => {
    if (!st.open || st.retractT) return;
    // A card out: it slides back up into the pill first, then the pill goes into the notch.
    if (drop() && shape === 'full' && !reduced()) {
      st.prompt = null; st.lingerAt = 0; hot(false);
      st.retractT = setTimeout(() => { st.retractT = 0; close(); }, 320);
      apply('compact');
      return;
    }
    st.open = false; st.prompt = null; st.lingerAt = 0;
    pour('in');
    hot(false); el.classList.remove('hov');
    el.classList.add('closing');
    apply('rest');
    clearTimeout(st.closeT);
    st.closeT = setTimeout(() => {
      if (st.open) return;
      el.classList.remove('on', 'closing');
      st.liq = null; goo.style.display = 'none'; el.classList.remove('liquid'); st.folded = false; st.minW = 0; st.statusW = null;
      st.text = ''; st.heard = ''; st.follow = true; textEl.textContent = ''; choicesEl.hidden = true; choicesEl.textContent = ''; setMode(null, '');
    }, reduced() ? 200 : 760);
  };
  // Which ends of the text have more past them (they fade), and whether the newest line is in view.
  const edges = () => {
    const below = textEl.scrollHeight - textEl.scrollTop - textEl.clientHeight;
    textEl.classList.toggle('top', textEl.scrollTop <= 1);
    textEl.classList.toggle('end', below <= 1);
    return below;
  };
  // Only their own scrolling (wheel, trackpad, touch, keys, the scrollbar) decides it: replacing the text as words
  // stream in also moves it, and that mustn't count as scrolling up.
  let userAt = -Infinity;
  for (const ev of ['wheel', 'touchmove', 'pointerdown', 'keydown']) textEl.addEventListener(ev, () => { userAt = performance.now(); }, { passive: true });
  textEl.addEventListener('scroll', () => {
    const below = edges();
    if (performance.now() - userAt > 800) return;
    st.follow = below <= 4;
    st.lingerAt &&= performance.now(); // reading it: it doesn't fold away mid-scroll
  }, { passive: true });
  // Grows (or shrinks) to fit what's in it, once the text has laid out.
  // One re-fit per frame at most, however fast the words stream in.
  let fitQ = 0;
  const refit = () => { if (st.open && !fitQ) fitQ = requestAnimationFrame(() => { fitQ = 0; if (st.open) { textEl.classList.toggle('short', textEl.scrollHeight <= MAX_BODY);
    // New words keep the newest line in view, unless they've scrolled up to read: then it stays where they are.
    if (st.follow) textEl.scrollTop = textEl.scrollHeight;
    edges();
    // The card eases to its new height as lines arrive, instead of jumping a line at a time.
    const body = $('.nc-body'); body.style.setProperty('--bh', `${Math.ceil(textEl.offsetHeight + (choicesEl.hidden ? 0 : choicesEl.offsetHeight + 12) + 30)}px`);
    apply(want()); } }); };
  const render = () => {
    const words = st.text || st.heard;
    textEl.classList.toggle('nc-heard', !st.text && !!st.heard);
    // One block per line, so a line in Arabic runs right to left and lines in English stay left to right.
    const keep = textEl.scrollTop;
    textEl.replaceChildren(...words.replace(/\*\*|__|`|^#+\s*/gm, '').split('\n').map((ln) => {
      const d = document.createElement('div'); d.className = 'nc-line'; d.dir = 'auto'; d.textContent = ln || '\u200b'; return d;
    }));
    if (!st.follow) textEl.scrollTop = keep; // scrolled up to read: new words don't move it
    refit();
  };
  // It takes clicks only while it has buttons or something to read (hovering keeps it open).
  const hot = (on) => el.classList.toggle('hot', !!on);

  // ---------- the globe ----------
  const CELLS = 28;
  const gctx = globe.getContext('2d');
  const drawGlobe = (dt) => {
    const dpr = devicePixelRatio || 1, px = Math.max(1, Math.round(dpr));
    if (globe.width !== CELLS * px) { globe.width = globe.height = CELLS * px; }
    gctx.clearRect(0, 0, globe.width, globe.height);
    const buf = new Map();
    const put = (x, y, l) => {
      const gx = Math.round(x), gy = Math.round(y);
      if (gx < 0 || gy < 0 || gx >= CELLS || gy >= CELLS) return;
      const k = gy * CELLS + gx;
      if ((buf.get(k) ?? 0) < l) buf.set(k, l);
    };
    const playing = R.voiceOut?.playing?.();
    jst.dt = dt; jst.t += dt;
    jst.mode = st.mode === 'error' ? null : playing ? 'talk' : st.mode === 'tool' ? 'think' : st.mode;
    jst.voice = playing ? R.voiceOut.level() : null;
    jst.heard = st.mic;
    jst.happy = st.mode === 'done' ? 0.6 : 0;
    jst.mouth = playing ? (jst.voice > 0.35 ? 'talk2' : jst.voice > 0.08 ? 'talk1' : null) : st.mode === 'error' ? 'frown' : null;
    jst.brow = st.mode === 'think' || st.mode === 'tool' ? 'raised' : null;
    const k = { put, L, th: () => 0 };
    const person = R.people?.[st.look];
    // The lens shows whoever was picked: JARVIS's globe, a person (head and shoulders), or the Roamie's blob.
    if (person) person.body(k, CELLS / 2 - 0.5, CELLS / 2 + 3, 10, jst);
    else if (st.look === 'jarvis' || !st.look || !R.jarvis) R.jarvis?.body(k, CELLS / 2 - 0.5, CELLS / 2 - 0.5, 10.5, jst);
    else blob(put, jst);
    for (const [k, l] of buf) {
      gctx.fillStyle = PAL[clamp(l, 1, L)];
      gctx.fillRect((k % CELLS) * px, Math.floor(k / CELLS) * px, px, px);
    }
  };

  // The original Roamie in the lens: a glowing goo blob that breathes and talks, two dark eyes that blink and look.
  const blob = (put, s) => {
    const c = CELLS / 2 - 0.5, v = s.voice ?? (s.mode === 'listen' ? s.heard * 0.6 : 0);
    const rx = 9 + v * 1.4, ry = 8.2 - v * 0.6 + 0.3 * Math.sin(s.t * 2.2), cy = c + 1.5;
    const ex = Math.round(s.look[0] * 1.6), ey = Math.round(s.look[1] * 1.2), blink = (s.t % 4.2) < 0.12;
    for (let y = -11; y <= 11; y++) for (let x = -11; x <= 11; x++) {
      const d = (x * x) / (rx * rx) + (y * y) / (ry * ry);
      if (d > 1) continue;
      // Eyes: holes in the light (2 tall, 1 when blinking); the mouth opens with the voice.
      const eye = (x === -3 + ex || x === 3 + ex) && (blink ? y === -1 + ey : y >= -2 + ey && y <= -1 + ey);
      const mouth = v > 0.1 && x >= -1 && x <= 1 && y >= 2 && y <= 2 + Math.round(v * 2.5);
      if (eye || mouth) continue;
      put(c + x, cy + y, d < 0.35 ? 4 : d < 0.7 ? 3 : 2);
    }
  };

  // ---------- the waveform ----------
  const wctx = wave.getContext('2d');
  const PTS = 36;
  const wv = new Float32Array(PTS), wv2 = new Float32Array(PTS);
  let wpeak = 0.2;
  const drawWave = (t) => {
    const dpr = devicePixelRatio || 1, W = 64, H = 24;
    if (wave.width !== W * dpr) { wave.width = W * dpr; wave.height = H * dpr; }
    wctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    wctx.clearRect(0, 0, W, H);
    const smp = R.voiceOut?.samples?.();
    if (smp) {
      // The real thing: the voice's last few milliseconds, each slice's strongest swing (sign kept), auto-gained
      // so quiet and loud speech both fill the slot, eased frame to frame so it flows instead of flickering.
      const seg = Math.floor(smp.length / PTS);
      let pk = 0;
      for (let i = 0; i < PTS; i++) {
        let m = 0;
        for (let j = i * seg; j < (i + 1) * seg; j++) if (Math.abs(smp[j]) > Math.abs(m)) m = smp[j];
        wv2[i] = m; pk = Math.max(pk, Math.abs(m));
      }
      wpeak += (Math.max(0.1, pk) - wpeak) * (pk > wpeak ? 0.2 : 0.04);
      // Neighbours blended in, then eased toward: it flows like a wave instead of flickering sample to sample.
      for (let i = 0; i < PTS; i++) {
        const v = (wv2[Math.max(0, i - 1)] + 2 * wv2[i] + wv2[Math.min(PTS - 1, i + 1)]) / 4 / wpeak;
        wv[i] += (v - wv[i]) * 0.3;
      }
    } else {
      // Listening: no samples from the mic here, so a wave whose height is the mic's level.
      const a = st.mode === 'listen' ? 0.15 + st.mic * 0.85 : 0;
      for (let i = 0; i < PTS; i++) {
        const x = i / PTS, target = a * (0.6 * Math.sin(x * 13 + t * 7.3) + 0.4 * Math.sin(x * 29 - t * 11.1));
        wv[i] += (target - wv[i]) * 0.3;
      }
    }
    // Pinned to the middle line at both ends (a Hann taper), so it reads as one wave and not a cut-off clip.
    const pt = (i, k) => [(i / (PTS - 1)) * W, H / 2 - wv[i] * k * (H / 2 - 2) * Math.sin(Math.PI * i / (PTS - 1)) ** 2];
    const path = (k) => {
      wctx.beginPath();
      let [x0, y0] = pt(0, k);
      wctx.moveTo(x0, y0);
      for (let i = 1; i < PTS; i++) { const [x1, y1] = pt(i, k); wctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2); x0 = x1; y0 = y1; }
      wctx.lineTo(x0, y0);
    };
    wctx.lineCap = 'round'; wctx.lineJoin = 'round';
    // An echo underneath, flipped and dim, then the glow, then a bright core.
    path(-0.55); wctx.strokeStyle = 'rgba(70, 140, 255, .35)'; wctx.lineWidth = 1.2; wctx.shadowBlur = 0; wctx.stroke();
    path(1); wctx.strokeStyle = 'rgba(80, 170, 255, .55)'; wctx.lineWidth = 3.2; wctx.shadowColor = '#3d8bff'; wctx.shadowBlur = 8; wctx.stroke();
    path(1); wctx.strokeStyle = '#e9fbff'; wctx.lineWidth = 1.3; wctx.shadowBlur = 0; wctx.stroke();
  };

  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!el.classList.contains('on')) { raf = 0; return; }
    drawGlobe(dt);
    if (drop()) dropStep();
    else if (st.liq || goo.style.display === 'block') { st.liq = null; goo.style.display = 'none'; el.classList.remove('liquid'); }
    // The glows, one each end:
    // listening: both breathe with the mic; thinking: a slow light drifting from one end to the other;
    // responding: both follow the voice, or flick softly with each word as text streams in; waiting for an OK: a slow
    // calm pulse; at rest after the answer: low and still.
    {
      const t = now / 1000, speak = R.voiceOut?.playing?.(), m = st.mode;
      let l, r;
      if (m === 'listen') { const v = 0.22 + st.mic * 0.78; l = v * (0.92 + 0.08 * Math.sin(t * 5)); r = v * (0.92 + 0.08 * Math.sin(t * 5 + 2)); }
      else if (speak) { const v = 0.25 + (R.voiceOut.level?.() ?? 0.4) * 0.75; l = r = v; }
      else if (m === 'think' || m === 'tool') { const p = 0.5 + 0.5 * Math.sin(t * 1.9); l = 0.3 + 0.6 * p; r = 0.3 + 0.6 * (1 - p); }
      else if (m === 'reply') { const flick = Math.exp(-(now - (st.tokAt ?? 0)) / 220); l = r = 0.5 + 0.35 * flick; }
      else if (m === 'ask') { l = r = 0.5 + 0.18 * Math.sin(t * 2.2); }
      else if (m === 'error') { l = r = 0.55; }
      else { l = r = 0.45 + 0.04 * Math.sin(t * 1.1); }
      const k = Math.min(1, dt * (m === 'listen' || speak ? 8 : 5));
      st.gl = (st.gl ?? 0.3) + (l - (st.gl ?? 0.3)) * k;
      st.gr = (st.gr ?? 0.3) + (r - (st.gr ?? 0.3)) * k;
      el.style.setProperty('--gl', st.gl.toFixed(3));
      el.style.setProperty('--gr', st.gr.toFixed(3));
    }
    // The waveform: the voice while it talks, the mic while it listens.
    const playing = R.voiceOut?.playing?.();
    // Gaps between voice chunks don't flip it back and forth: 'talk' holds for 400 ms of silence.
    if (playing) { st.talkAt = now; if (st.mode !== 'listen' && st.mode !== 'talk' && st.mode !== 'error' && st.mode !== 'ask') setMode('talk', ''); }
    else if (st.mode === 'talk' && now - (st.talkAt ?? 0) > 400) setMode('done', '');
    if (st.mode === 'listen' || st.mode === 'talk') drawWave(now / 1000);
    // After the turn: stay while the voice plays or the cursor rests on it, then fold back in.
    if (st.open && st.lingerAt && !st.prompt) {
      const speaking = st.speech ? !R.voiceOut?.finished?.(st.speech) : playing;
      if (speaking || st.hover) st.lingerAt = now;
      else if (now - st.lingerAt > st.linger) close();
    }
    raf = requestAnimationFrame(frame);
  };

  // ---------- liquid ----------
  // pour('out'): the capsule leaves the notch like water: the notch bulges, a neck stretches down with the pill, thins
  // and splits, two droplets fall after it and merge in, the pill wobbles as it settles. pour('in') runs it backwards:
  // the notch reaches down, the pill squashes, stretches up into it and melts away.
  const OUT_MS = 820, IN_MS = 620;
  const pour = (dir) => {
    if (!drop() || reduced()) { st.liq = null; return; }
    st.liq = { dir, t0: performance.now(), dropped: false };
    el.classList.add('liquid');
    goo.style.display = 'block';
    // Squash and stretch on the capsule itself, stepped by the frame loop (jellyStep).
    st.jelly = { kf: dir === 'out' ? JELLY_OUT : JELLY_IN, t0: st.liq.t0, ms: dir === 'out' ? OUT_MS : IN_MS };
  };
  // [time, x, y]. Out: it stretches as it pulls away, pinches off, and the release bounces it wide, then settles.
  // In: it squashes, stretches up toward the notch as the neck takes it, and is drawn in.
  const JELLY_OUT = [[0, 0.5, 0.6], [0.4, 0.9, 1.14], [0.62, 1.06, 0.9], [0.82, 0.985, 1.02], [1, 1, 1]];
  const JELLY_IN = [[0, 1, 1], [0.2, 1.05, 0.9], [0.58, 0.86, 1.14], [1, 0.5, 0.6]];
  // cubic-bezier(.33, .1, .3, 1), the jelly's easing.
  const ease = (t) => {
    let u = t;
    for (let i = 0; i < 6; i++) { const x = 3 * 0.33 * u * (1 - u) ** 2 + 3 * 0.3 * u * u * (1 - u) + u ** 3 - t, d = 3 * 0.33 * (1 - u) ** 2 + 6 * (0.3 - 0.33) * u * (1 - u) + 3 * (1 - 0.3) * u * u; if (Math.abs(d) < 1e-6) break; u = clamp(u - x / d, 0, 1); }
    return 3 * 0.1 * u * (1 - u) ** 2 + 3 * u * u * (1 - u) + u ** 3;
  };
  // The capsule's scale this frame: the jelly while it pours, times a slight swell while the cursor is on it.
  const jellyStep = (now) => {
    let sx = 1, sy = 1;
    const j = st.jelly;
    if (j) {
      const t = ease(clamp((now - j.t0) / j.ms, 0, 1));
      let k = 1;
      while (k < j.kf.length - 1 && j.kf[k][0] < t) k++;
      const [ta, xa, ya] = j.kf[k - 1], [tb, xb, yb] = j.kf[k], f = tb > ta ? clamp((t - ta) / (tb - ta), 0, 1) : 1;
      sx = xa + (xb - xa) * f; sy = ya + (yb - ya) * f;
      if (now - j.t0 >= j.ms) st.jelly = null;
    }
    st.hs = (st.hs ?? 1) + ((el.classList.contains('hov') ? 1.035 : 1) - (st.hs ?? 1)) * 0.25;
    if (Math.abs(st.hs - 1) < 0.001) st.hs = 1;
    el.style.scale = sx === 1 && sy === 1 && st.hs === 1 ? '' : `${(sx * st.hs).toFixed(4)} ${(sy * st.hs).toFixed(4)}`;
  };
  const liquidStep = (now) => {
    const q = st.liq;
    if (!q) return;
    const n = notch(), u = clamp((now - q.t0) / (q.dir === 'out' ? OUT_MS : IN_MS), 0, 1);
    const r = el.getBoundingClientRect(), cx = n.x + n.w / 2;
    // The goo layer is a 760×140 box centred on the notch; everything in it is placed relative to that.
    const ox = cx - 380;
    goo.style.left = `${ox}px`;
    // The notch blob stays the notch (black on black), or a lip above the top edge on screens without one.
    const top = n.real ? 0 : -24, base = n.real ? n.h : 0, nw = n.real ? n.w : 120;
    // Inset: the blur's threshold grows a shape by a few px, and nothing may show around the real notch.
    place(gNotch, { left: `${cx - nw / 2 + 4 - ox}px`, top: `${top}px`, width: `${nw - 8}px`, height: `${base - top - 4}px` });
    // The tongue: a stream from the middle of the notch. Out: it holds on to the top of the pill as it falls, then
    // thins and pulls back up, and the stream splits. In: it reaches down, takes hold, and the pill rises up it.
    const reach = r.top + r.height * 0.4;
    let len, wid;
    if (q.dir === 'out') {
      // Holds the pill as it falls (a wide neck), then thins to a thread and snaps back up into the notch.
      if (u < 0.4) { len = reach; wid = 0.5 - 0.12 * (u / 0.4); }
      else { const k = clamp((u - 0.4) / 0.22, 0, 1), e = k * k * (3 - 2 * k); len = reach + (base - 14 - reach) * e; wid = 0.38 - 0.32 * e; }
    } else {
      // Reaches down, takes hold, widens as the pill rises into it.
      const k = clamp(u / 0.35, 0, 1), e = 1 - (1 - k) * (1 - k);
      len = base - 14 + (reach - base + 14) * e; wid = 0.08 + 0.42 * k;
    }
    place(gTongue, { left: `${cx - (nw * wid) / 2 - ox}px`, top: `${top}px`, width: `${nw * wid}px`, height: `${Math.max(0, len - top)}px` });
    // The pill blob follows the capsule exactly (its live box, jelly included).
    place(gPill, { left: `${r.left - ox}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: `${r.height / 2}px` });
    // Droplets: split off as the neck breaks, fall into the pill and merge.
    gDrops.forEach((d, i) => {
      const p = q.dir === 'out' ? clamp((u - 0.6 - i * 0.07) / 0.22, 0, 1) : 0;
      if (p <= 0 || p >= 1) { place(d, { display: 'none' }); return; }
      const size = (i ? 6 : 9) * (1 - p * 0.4), x = cx + (i ? 7 : -5) - size / 2, y0 = base + 2, y1 = r.top + r.height * 0.3;
      place(d, { display: 'block', left: `${x - ox}px`, top: `${y0 + (y1 - y0) * p * p}px`, width: `${size}px`, height: `${size}px` });
    });
    // The contents come in the moment the neck snaps, not after the wobble: words should never wait on the motion.
    // Once the neck has snapped (u 0.62) the goo has nothing left to show; its copy of the pill trails the real one by a
    // frame while it springs, so it's hidden at once (else a sliver of it peeks out above the capsule).
    if (q.dir === 'out' && u >= 0.55) el.classList.remove('liquid');
    if (q.dir === 'out' && u >= 0.64) { st.liq = null; goo.style.display = 'none'; refit(); return; }
    if (u >= 1) {
      if (q.dir === 'out') { st.liq = null; el.classList.remove('liquid'); goo.style.display = 'none'; refit(); }
      else { st.liq = null; goo.style.display = 'none'; }
    }
  };

  // Drop: the lens looks at the cursor. The pill itself stays put under the notch.
  const dropStep = () => {
    const now = performance.now();
    jellyStep(now);
    const r = el.getBoundingClientRect();
    liquidStep(now);
    let look = [0, 0];
    if (st.open && !st.liq && st.px != null) {
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2, dx = st.px - cx, dy = st.py - cy, dist = Math.hypot(dx, dy);
      if (dist < 520) look = [clamp(dx / 260, -1, 1), clamp(dy / 200, -1, 1)];
    }
    jst.look = look;
  };

  // ---------- pointer ----------
  const within = (r, x, y) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  const inside = (x, y) => {
    if (!st.open) return false;
    // The drop card hangs below the pill, outside its box.
    return within(el.getBoundingClientRect(), x, y) || (drop() && shape === 'full' && within($('.nc-body').getBoundingClientRect(), x, y));
  };
  // Clicks go to the app below unless there's something to act on: Allow buttons, or a reply to fold or open.
  const takes = () => !!st.prompt || !!st.text;
  R.notchHit = (x, y, sample = true) => {
    if (!sample) return inside(x, y) && takes();
    st.px = x; st.py = y;
    const on = inside(x, y);
    st.hover = on;
    el.classList.toggle('hov', on && drop() && shape === 'compact');
    const take = on && takes();
    hot(take);
    return take;
  };
  // Linux takes clicks by region (host.js): the capsule's box, while it has something to click.
  R.notchTakes = () => st.open && takes();
  R.notchRect = () => {
    if (!st.open) return null;
    const a = el.getBoundingClientRect(), b = drop() && shape === 'full' ? $('.nc-body').getBoundingClientRect() : a;
    const l = Math.min(a.left, b.left), t = Math.min(a.top, b.top);
    return [l, t, Math.max(a.right, b.right) - l, Math.max(a.bottom, b.bottom) - t];
  };
  // A click on the capsule (not a button) folds it away: the reply's been read.
  // Drop: a click folds the reply into the pill (its first words as the status) and opens it again.
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, .nc-body') || st.prompt) return;
    if (!drop()) { close(); return; }
    if (!st.text) return;
    st.folded = !st.folded;
    if (st.folded) st.preFoldW = st.minW; else st.minW = st.preFoldW ?? 0;
    st.lingerAt &&= performance.now();
    apply(want());
    setMode(st.mode, st.folded ? `${st.text.replace(/\s+/g, ' ').slice(0, 28).trim()}…` : '');
  });
  addEventListener('resize', () => { if (st.open) apply(shape); });

  // ---------- API ----------
  // A new turn starts clean: anything left from the last one (a reply still lingering, or one folding away) goes.
  const fresh = () => {
    st.text = ''; st.heard = ''; st.prompt = null; st.folded = false; st.lingerAt = 0; st.speech = null; st.minW = 0; st.statusW = null; st.follow = true;
    textEl.textContent = ''; choicesEl.hidden = true; choicesEl.textContent = '';
    if (st.open) refit();
  };
  const closing = () => !st.open || el.classList.contains('closing') || !!st.retractT;
  const linger = () => {
    // Long enough to read it: about a third of a second a word, between 3 and 14 seconds.
    const words = (st.text.match(/\S+/g) ?? []).length;
    st.linger = clamp(words * 320, 3000, 14000);
    st.lingerAt = performance.now();
  };
  R.notch = {
    enabled: false,
    get style() { return drop() ? 'drop' : 'spread'; },
    // The name on the capsule: the look's own (JARVIS, Roamie, …).
    set name(v) { $('.nc-mark').textContent = String(v || 'JARVIS'); if (st.open) apply(shape); },
    // The look in the lens: 'jarvis', a person ('anime', 'sarah', 'adrian', 'rita', 'ultren', 'glayos'), or 'classic' (the Roamie blob).
    set look(v) { st.look = String(v || 'jarvis'); jst.swing = null; },
    set style(v) {
      const d = v === 'drop';
      if (d === drop()) return;
      // Open: fold away in the old style, come back out in the new one with the same contents.
      if (st.open) {
        const keep = { mode: st.mode, words: label.textContent };
        close();
        setTimeout(() => { el.classList.toggle('drop', d); if (!st.open && keep.mode) { setMode(keep.mode, keep.words); show(); } }, 800);
      } else el.classList.toggle('drop', d);
    },
    get active() { return st.open; },
    listen() {
      fresh(); setMode('listen', 'Listening'); render(); show();
    },
    level(v) { st.mic = clamp(+v || 0, 0, 1); },
    heard(text) { st.heard = String(text ?? ''); if (!st.text) render(); },
    // Where replies show: 'capsule' (default) or 'cursor' (the sidekick's bubble; the capsule shows the state only).
    replies: 'capsule',
    // Replies at the cursor: the capsule shows it's answering, the words are elsewhere.
    replying() { st.tokAt = performance.now(); st.lingerAt = 0; if (st.mode !== 'talk') setMode('reply', 'Answering'); show(); },
    // The answer is being drawn on screen: the capsule folds its text away (one place for the answer) and says so.
    // A click on the pill still opens the text.
    yieldTo(words) { st.folded = true; st.lingerAt = 0; setMode('tool', words || 'Showing you'); show(); refit(); },
    // A new request: clears the last reply, then thinks.
    begin() { fresh(); this.think(); },
    think(text) {
      if (closing() || st.lingerAt) fresh();
      st.lingerAt = 0;
      if (st.mode !== 'tool' || text == null) setMode('think', 'Thinking');
      show();
    },
    tool(words) { if (closing() || st.lingerAt) fresh(); st.lingerAt = 0; setMode('tool', words || 'Working'); show(); },
    text(chunk) {
      if (closing()) fresh();
      st.lingerAt = 0;
      if (!st.text) chunk = String(chunk).replace(/^\s+/, '');
      st.text += chunk; st.heard = ''; st.tokAt = performance.now();
      if (!st.folded && st.mode !== 'talk') setMode('reply', '');
      render(); show();
    },
    done({ speech } = {}) {
      // A turn cut short by talking again ends while the mic is already on: the capsule stays listening.
      if (st.mode === 'listen' && st.open) return;
      st.speech = speech ?? null;
      if (!st.text && !st.prompt) { close(); return; }
      if (!st.prompt && !st.folded && st.mode !== 'talk' && st.mode !== 'error') setMode('done', '');
      if (st.text && !st.prompt && st.mode !== 'error') announce(st.text);
      linger();
    },
    fail(message) {
      if (st.mode === 'listen' && st.open) return;
      if (closing()) fresh();
      st.text = String(message ?? 'Something went wrong.'); st.speech = null;
      setMode('error', 'Couldn’t finish'); render(); show(); linger(); announce(st.text);
    },
    // A line on its own (a reminder, a greeting): out, said, back in.
    say(text) { if (R.notch._busy?.() && st.text) return; st.text = ''; this.text(text); this.done(); },
    // The reply moved to the research card: the capsule stops showing it.
    reset() { st.text = ''; st.heard = ''; render(); },
    // Allow / Don't allow. onChoose(i): the first answers yes. The host's hidden field still takes Y, N, Tab, Enter.
    prompt(question, choices, onChoose) {
      if (closing()) fresh();
      const me = { onChoose };
      st.prompt = me; st.lingerAt = 0; st.folded = false;
      st.reply = st.text; // the reply so far comes back once it's answered
      st.text = String(question ?? '');
      setMode('ask', 'Needs your OK');
      announce(st.text);
      choicesEl.textContent = '';
      choices.forEach((c, i) => {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = c;
        b.addEventListener('click', (e) => { e.stopPropagation(); onChoose(i); });
        choicesEl.appendChild(b);
      });
      const keys = document.createElement('span');
      keys.className = 'nc-keys'; keys.textContent = 'Y or N';
      choicesEl.appendChild(keys);
      choicesEl.hidden = false;
      render(); show();
      return {
        select: (i) => [...choicesEl.querySelectorAll('button')].forEach((b, j) => b.classList.toggle('sel', j === i)),
        close: () => {
          if (st.prompt !== me) return; // already answered, or the capsule went away
          st.prompt = null; choicesEl.hidden = true;
          st.text = st.reply ?? ''; st.reply = null; render();
          if (R.notch._busy?.()) R.notch.think(); else if (!st.text) close(); else { setMode('done', ''); linger(); }
        },
        set() {}, focus() {},
      };
    },
    close,
    rect: () => R.notchRect(),
    // The host says whether a turn is still going, so an answered prompt goes back to thinking instead of closing.
    _busy: null,
  };
})();
