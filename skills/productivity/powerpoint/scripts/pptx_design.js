#!/usr/bin/env node
/**
 * Build an art-directed .pptx deck using PptxGenJS.
 *
 * Run via Hermes `terminal`:
 *   node scripts/pptx_design.js spec.json out.pptx
 *
 * Design-spec format (all image paths are local, resolved from the spec):
 * {
 *   "language": "ar" | "en",                 // default: en
 *   "theme": {"name":"editorial", "accent":"B4482E", "font":"Cairo",
 *             "arabicFont":"Cairo", "latinFont":"Aptos"},
 *   "title": "Deck metadata",
 *   "footer": "Latin footer line",           // omit and no footer is drawn
 *   "footerAr": "سطر تذييل عربي",
 *   "slides": [
 *     {"type":"cover", "kicker":"2026", "title":"...", "subtitle":"...",
 *      "image":"hero.jpg", "notes":"..."},
 *     {"type":"cards", "kicker":"01", "title":"...", "summary":"...",
 *      "cards":[{"title":"...", "body":"...", "label":"01"}]},
 *     {"type":"data", "kicker":"02", "title":"...", "summary":"...",
 *      "chart":{"labels":["A","B"], "values":[45,72], "series":"Score"},
 *      "callout":{"title":"...", "body":"..."}},
 *     {"type":"split", "kicker":"03", "title":"...", "summary":"...",
 *      "rtl":{"title":"...", "body":"..."},
 *      "ltr":{"title":"...", "body":"..."}}
 *   ]
 * }
 *
 * The script deliberately has a small slide grammar. It produces a coherent
 * visual system and refuses the text-dump pattern that makes generated decks
 * unreadable. For a supplied company deck, use pptx_from_template.py instead.
 *
 * Colors and point sizes are not owned here. They come from the house design
 * system (skills/productivity/house-style/scripts/house_style.py), read at run
 * time through its JSON CLI so this deck cannot drift away from the reports and
 * the sheets. When that module or a python interpreter is out of reach, the
 * hardcoded FALLBACK below keeps the script usable on its own.
 *
 * `theme.font` sets both the Arabic and the Latin slot. `theme.arabicFont` and
 * `theme.latinFont` set one slot each and win over it.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pptxgen;
try {
  pptxgen = require('pptxgenjs');
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: 'PptxGenJS is required for the design path.',
    setup: 'Install it locally in the task workspace: npm install pptxgenjs',
    detail: error.message,
  }));
  process.exit(2);
}

/**
 * The look this file shipped before the design system existed. It is both the
 * standalone fallback and the floor under every lookup, so a house theme that
 * ever drops a key still lands on a designed value rather than on undefined.
 */
const FALLBACK = {
  ink: '1B1A18', paper: 'F6F3EE', card: 'FFFFFF', muted: '6E685F',
  accent: 'B4482E', gold: 'C9922B', blue: '27566B', line: 'D1C4AF',
  arabicFont: 'Cairo', latinFont: 'Aptos',
  width: 13.333, height: 7.5,
  type: {
    cover_title: 36, cover_subtitle: 17, kicker: 10, title: 30, section: 24,
    lead: 15, body: 16, body_sm: 15, body_xs: 13, table: 11, chart: 11,
    caption: 9, footer: 7, slide_number: 7,
  },
};

/**
 * Where house_style.py can be. These mirror house_common.py's candidates one
 * for one, because the two locators have to agree about which copy of the
 * design system a deck and a report are reading.
 */
function houseStylePaths() {
  return [
    __dirname,
    path.resolve(__dirname, '..', '..', 'house-style', 'scripts'),
    path.join(os.homedir(), '.hermes', 'skills', 'productivity', 'house-style', 'scripts'),
  ];
}

/**
 * Ask the house design system for its JSON, or return null. Nothing in here is
 * allowed to throw: a missing module, a missing interpreter, a python error and
 * unreadable output all mean the same thing to the caller, which is that the
 * FALLBACK has to carry the deck.
 */
function loadHouseTheme(themeName, accent) {
  let script = null;
  for (const candidate of houseStylePaths()) {
    const probe = path.join(candidate, 'house_style.py');
    try {
      if (fs.existsSync(probe)) { script = probe; break; }
    } catch (error) { /* an unreadable candidate is simply not the one */ }
  }
  if (!script) return null;
  const args = [script];
  if (themeName) args.push('--theme', String(themeName));
  if (accent) args.push('--accent', String(accent));
  const interpreters = [process.env.PYTHON, 'python3', '/usr/bin/python3'].filter(Boolean);
  for (const python of interpreters) {
    let run;
    try {
      run = spawnSync(python, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    } catch (error) {
      continue;
    }
    if (!run || run.error || run.status !== 0 || !run.stdout) continue;
    try {
      const parsed = JSON.parse(run.stdout);
      if (parsed && parsed.palette) return parsed;
    } catch (error) { /* an interpreter that printed noise is not a theme */ }
  }
  return null;
}

/**
 * Flatten the house JSON, the fallback and the spec's theme into the one flat
 * object the builders read. The spec is applied last on purpose, so a caller
 * who sets theme.accent still wins, and the accent also went into python above
 * so that the soft tint, the readable shade and the first series were retinted
 * with it rather than around it.
 */
function buildTokens(specTheme) {
  const theme = specTheme || {};
  const house = loadHouseTheme(theme.name, theme.accent);
  const palette = (house && house.palette) || {};
  const series = Array.isArray(palette.series) ? palette.series : [];
  const deckType = (house && house.deck_type) || {};
  const geometry = (house && house.geometry) || {};
  const fonts = (house && house.fonts) || {};
  const pick = (value, floor) => (value === undefined || value === null ? floor : value);
  const type = {};
  for (const role of Object.keys(FALLBACK.type)) {
    type[role] = pick(deckType[role], FALLBACK.type[role]);
  }
  // theme.type overrides single roles, so a spec can nudge one size without
  // replacing the whole scale it inherited.
  if (theme.type && typeof theme.type === 'object') Object.assign(type, theme.type);
  // The house calls its page white "paper" and its tinted ground "surface".
  // This deck has always been printed on the tinted ground with white panels
  // floating on it, so the two names swap places here.
  const tokens = {
    ink: pick(palette.ink, FALLBACK.ink),
    paper: pick(palette.surface, FALLBACK.paper),
    card: pick(palette.paper, FALLBACK.card),
    muted: pick(palette.muted, FALLBACK.muted),
    accent: pick(palette.accent, FALLBACK.accent),
    gold: pick(series[2], FALLBACK.gold),
    blue: pick(series[1], FALLBACK.blue),
    line: pick(palette.line, FALLBACK.line),
    arabicFont: pick(fonts.arabic, FALLBACK.arabicFont),
    latinFont: FALLBACK.latinFont,
    width: pick(geometry.width, FALLBACK.width),
    height: pick(geometry.height, FALLBACK.height),
    type,
    house: Boolean(house),
  };
  // theme.font is the one knob that sets both slots, then the per-slot knobs
  // override it. Everything else in theme.* lands on the tokens as written,
  // except name and type, which were consumed above.
  if (theme.font) {
    tokens.arabicFont = theme.font;
    tokens.latinFont = theme.font;
  }
  if (theme.arabicFont) tokens.arabicFont = theme.arabicFont;
  if (theme.latinFont) tokens.latinFont = theme.latinFont;
  for (const [key, value] of Object.entries(theme)) {
    if (['font', 'arabicFont', 'latinFont', 'name', 'type'].includes(key)) continue;
    if (value !== undefined && value !== null) tokens[key] = value;
  }
  return tokens;
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}

function loadSpec(specPath) {
  let spec;
  try {
    spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  } catch (error) {
    fail(`Cannot read valid JSON spec: ${error.message}`);
  }
  if (!Array.isArray(spec.slides) || spec.slides.length === 0) {
    fail('Spec requires a non-empty slides array.');
  }
  return spec;
}

function makeTextHelpers(isArabic, C) {
  const rtl = {
    fontFace: C.arabicFont, color: C.ink, align: 'right', rtlMode: true,
    margin: 0, fit: 'shrink', valign: 'mid', breakLine: false,
  };
  const ltr = {
    fontFace: C.latinFont, color: C.ink, align: 'left', rtlMode: false,
    margin: 0, fit: 'shrink', valign: 'mid', breakLine: false,
  };
  return {
    rtl,
    ltr,
    addMain(slide, text, opts = {}) { slide.addText(String(text || ''), { ...(isArabic ? rtl : ltr), ...opts }); },
    addArabic(slide, text, opts = {}) { slide.addText(String(text || ''), { ...rtl, ...opts }); },
    addLatin(slide, text, opts = {}) { slide.addText(String(text || ''), { ...ltr, ...opts }); },
  };
}

function resolveAsset(baseDir, asset) {
  if (!asset) return null;
  const resolved = path.resolve(baseDir, asset);
  if (!fs.existsSync(resolved)) fail(`Image asset does not exist: ${asset}`);
  return resolved;
}

function addMaster(pptx, C, T, spec) {
  // A footer is the deck's own line, never this script's. The objects are built
  // conditionally rather than with empty strings, because an empty text object
  // still emits a shape on every slide.
  const objects = [
    { line: { x: 0.55, y: 0.38, w: 12.23, h: 0, line: { color: C.line, width: 0.75 } } },
  ];
  if (spec.footer) {
    objects.push({ text: { text: String(spec.footer), options: { ...T.ltr, x: 0.55, y: 7.05, w: 4.5, h: 0.2, fontSize: C.type.footer, color: C.muted, charSpacing: 1.1 } } });
  }
  if (spec.footerAr) {
    objects.push({ text: { text: String(spec.footerAr), options: { ...T.rtl, x: 8.4, y: 7.01, w: 4.35, h: 0.25, fontSize: C.type.footer, color: C.muted } } });
  }
  pptx.defineSlideMaster({
    title: 'HERMES_DESIGN_MASTER',
    background: { color: C.paper },
    objects,
    slideNumber: { x: 12.28, y: 0.52, color: C.muted, fontFace: C.latinFont, fontSize: C.type.slide_number },
  });
}

function addKicker(slide, T, text, isArabic, C) {
  if (!text) return;
  T.addMain(slide, text, { x: isArabic ? 7.0 : 0.58, y: 0.72, w: 5.75, h: 0.28, fontSize: C.type.kicker, color: C.accent, bold: true, charSpacing: 1.0 });
}

function addTitle(slide, T, text, isArabic, C) {
  T.addMain(slide, text || '', { x: isArabic ? 4.72 : 0.58, y: 1.08, w: 7.98, h: 0.82, fontSize: C.type.title, bold: true, valign: 'mid' });
}

function addSummary(slide, T, text, isArabic, C) {
  if (!text) return;
  T.addMain(slide, text, { x: isArabic ? 5.12 : 0.58, y: 2.04, w: 7.58, h: 0.46, fontSize: C.type.lead, color: C.muted, valign: 'top' });
}

function addSource(slide, T, text, isArabic, C) {
  if (!text) return;
  T.addMain(slide, text, { x: isArabic ? 6.3 : 0.58, y: 6.53, w: 6.45, h: 0.23, fontSize: C.type.caption, color: C.muted, valign: 'mid' });
}

function addNotes(slide, notes) {
  if (notes) slide.addNotes(String(notes));
}

function buildCover({ slide, item, assetsDir, T, isArabic, C, pptx }) {
  slide.background = { color: C.ink };
  const image = resolveAsset(assetsDir, item.image);
  if (image) {
    slide.addImage({ path: image, x: 0, y: 0, w: C.width, h: C.height, sizing: { type: 'cover', x: 0, y: 0, w: C.width, h: C.height } });
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: C.width, h: C.height, fill: { color: C.ink, transparency: 53 }, line: { color: C.ink, transparency: 100 } });
  }
  slide.addShape(pptx.ShapeType.arc, { x: -1.2, y: -1.7, w: 7.4, h: 7.4, adjustPoint: 0.25, rotate: 34, line: { color: C.gold, transparency: 25, width: 2 }, fill: { color: C.ink, transparency: 100 } });
  // The cover kicker is the deck's word, so an absent one leaves the corner
  // empty instead of borrowing a stock line.
  if (item.kicker) {
    T.addLatin(slide, item.kicker, { x: 0.62, y: 0.65, w: 3.6, h: 0.25, fontSize: C.type.kicker, color: C.paper, charSpacing: 1.5, bold: true });
  }
  T.addMain(slide, item.title || '', { x: isArabic ? 3.1 : 0.62, y: 2.1, w: isArabic ? 9.65 : 8.85, h: 0.8, fontSize: C.type.cover_title, color: C.card, bold: true, valign: 'mid' });
  T.addMain(slide, item.subtitle || '', { x: isArabic ? 3.1 : 0.62, y: 3.1, w: isArabic ? 9.65 : 8.85, h: 0.46, fontSize: C.type.cover_subtitle, color: 'F4E9DD', valign: 'top' });
  slide.addShape(pptx.ShapeType.line, { x: isArabic ? 9.95 : 0.62, y: 4.05, w: 2.8, h: 0, line: { color: C.gold, width: 2.25 } });
  if (item.caption) T.addMain(slide, item.caption, { x: isArabic ? 7.3 : 0.62, y: 6.42, w: 5.45, h: 0.28, fontSize: C.type.caption, color: C.paper });
}

function buildCards({ slide, item, T, isArabic, C, pptx }) {
  addKicker(slide, T, item.kicker, isArabic, C);
  addTitle(slide, T, item.title, isArabic, C);
  addSummary(slide, T, item.summary, isArabic, C);
  const cards = (item.cards || []).slice(0, 3);
  if (!cards.length) fail('A cards slide requires at least one card.');
  const cardW = cards.length === 1 ? 5.0 : cards.length === 2 ? 4.0 : 2.45;
  const gap = cards.length === 1 ? 0 : cards.length === 2 ? 0.32 : 0.33;
  const rowW = cards.length * cardW + (cards.length - 1) * gap;
  const start = (C.width - rowW) / 2;
  cards.forEach((card, index) => {
    const visualIndex = isArabic ? cards.length - index - 1 : index;
    const x = start + visualIndex * (cardW + gap);
    slide.addShape(pptx.ShapeType.roundRect, { x, y: 3.15, w: cardW, h: 2.32, rectRadius: 0.07, fill: { color: C.card }, line: { color: C.line, width: 0.8 }, shadow: { type: 'outer', color: 'B7AFA5', opacity: 0.12, blur: 1, angle: 45, distance: 1 } });
    slide.addShape(pptx.ShapeType.ellipse, { x: x + cardW - 0.72, y: 3.4, w: 0.42, h: 0.42, fill: { color: index === 1 ? C.gold : C.accent }, line: { color: C.card, transparency: 100 } });
    T.addLatin(slide, card.label || String(index + 1).padStart(2, '0'), { x: x + 0.22, y: 3.4, w: 0.9, h: 0.25, fontSize: C.type.caption, color: C.muted, bold: true });
    T.addMain(slide, card.title || '', { x: x + 0.22, y: 4.0, w: cardW - 0.45, h: 0.32, fontSize: C.type.body, bold: true, valign: 'mid' });
    T.addMain(slide, card.body || '', { x: x + 0.22, y: 4.5, w: cardW - 0.45, h: 0.61, fontSize: C.type.body_xs, color: C.muted, valign: 'top' });
  });
  addSource(slide, T, item.source, isArabic, C);
}

function buildData({ slide, item, T, isArabic, C, pptx }) {
  addKicker(slide, T, item.kicker, isArabic, C);
  addTitle(slide, T, item.title, isArabic, C);
  addSummary(slide, T, item.summary, isArabic, C);
  const chart = item.chart || {};
  if (!Array.isArray(chart.labels) || !Array.isArray(chart.values) || chart.labels.length !== chart.values.length) {
    fail('A data slide requires chart.labels and chart.values arrays of the same length.');
  }
  const chartX = isArabic ? 6.25 : 0.58;
  slide.addChart(pptx.ChartType.bar, [{ name: chart.series || 'Series', labels: chart.labels, values: chart.values }], {
    x: chartX, y: 2.72, w: 6.5, h: 3.25,
    catAxisLabelFontFace: isArabic ? C.arabicFont : C.latinFont, catAxisLabelFontSize: C.type.chart, catAxisLabelColor: C.ink,
    valAxisLabelFontFace: C.latinFont, valAxisLabelFontSize: C.type.chart, valAxisMinVal: chart.min || 0, valAxisMaxVal: chart.max || Math.max(...chart.values),
    valAxisMajorUnit: chart.majorUnit || Math.max(1, Math.ceil(Math.max(...chart.values) / 5)),
    showLegend: false, showTitle: false, showValue: true, dataLabelPosition: 'outEnd', dataLabelColor: C.ink, dataLabelFormatCode: '0',
    chartColors: [C.accent], valGridLine: { color: 'DCD6CD', width: 0.5 }, showBorder: false,
  });
  const callout = item.callout || {};
  const boxX = isArabic ? 0.55 : 7.92;
  slide.addShape(pptx.ShapeType.roundRect, { x: boxX, y: 2.72, w: 4.85, h: 3.25, rectRadius: 0.06, fill: { color: C.blue }, line: { color: C.blue } });
  T.addMain(slide, callout.title || '', { x: boxX + 0.4, y: 3.22, w: 4.05, h: 0.32, fontSize: C.type.body_sm, bold: true, color: C.card });
  T.addMain(slide, callout.body || '', { x: boxX + 0.4, y: 3.86, w: 4.05, h: 1.05, fontSize: C.type.body_xs, color: 'EAE4DA', valign: 'top' });
  addSource(slide, T, item.source, isArabic, C);
}

function buildSplit({ slide, item, T, isArabic, C, pptx }) {
  addKicker(slide, T, item.kicker, isArabic, C);
  addTitle(slide, T, item.title, isArabic, C);
  addSummary(slide, T, item.summary, isArabic, C);
  const rtlBlock = item.rtl || {};
  const ltrBlock = item.ltr || {};
  slide.addShape(pptx.ShapeType.roundRect, { x: 6.85, y: 2.9, w: 5.9, h: 2.45, rectRadius: 0.06, fill: { color: C.card }, line: { color: C.line, width: 0.8 } });
  T.addArabic(slide, rtlBlock.title || '', { x: 7.22, y: 3.27, w: 5.15, h: 0.45, fontSize: C.type.body_sm, bold: true });
  T.addArabic(slide, rtlBlock.body || '', { x: 7.22, y: 4.14, w: 5.15, h: 0.42, fontSize: C.type.body_xs, color: C.muted, valign: 'top' });
  slide.addShape(pptx.ShapeType.roundRect, { x: 0.55, y: 2.9, w: 5.55, h: 2.45, rectRadius: 0.06, fill: { color: C.ink }, line: { color: C.ink } });
  T.addLatin(slide, ltrBlock.title || '', { x: 0.95, y: 3.27, w: 4.75, h: 0.45, fontSize: C.type.body, bold: true, color: C.card });
  T.addLatin(slide, ltrBlock.body || '', { x: 0.95, y: 4.14, w: 4.75, h: 0.42, fontSize: C.type.body_xs, color: 'EAE4DA', valign: 'top' });
  slide.addShape(pptx.ShapeType.line, { x: 0.55, y: 6.25, w: 12.2, h: 0, line: { color: C.line, width: 0.75 } });
  addSource(slide, T, item.source, isArabic, C);
}

function main(argv) {
  if (argv.length !== 2) {
    console.error('Usage: node pptx_design.js <spec.json> <out.pptx>');
    return 2;
  }
  const [specPath, outputPath] = argv;
  const spec = loadSpec(specPath);
  const isArabic = (spec.language || 'en').toLowerCase().startsWith('ar');
  const C = buildTokens(spec.theme);
  const pptx = new pptxgen();
  pptx.defineLayout({ name: 'HERMES_WIDE', width: C.width, height: C.height });
  pptx.layout = 'HERMES_WIDE';
  pptx.author = 'Hermes Agent';
  pptx.title = spec.title || 'Presentation';
  pptx.subject = spec.subject || 'Presentation';
  pptx.lang = isArabic ? 'ar-SA' : 'en-US';
  pptx.rtlMode = isArabic;
  pptx.theme = { headFontFace: isArabic ? C.arabicFont : C.latinFont, bodyFontFace: isArabic ? C.arabicFont : C.latinFont, lang: pptx.lang };
  const T = makeTextHelpers(isArabic, C);
  addMaster(pptx, C, T, spec);
  const assetsDir = path.dirname(path.resolve(specPath));
  const builders = { cover: buildCover, cards: buildCards, data: buildData, split: buildSplit };
  spec.slides.forEach((item, index) => {
    const builder = builders[item.type];
    if (!builder) fail(`Slide ${index + 1} has unsupported type: ${item.type}. Use cover, cards, data, or split.`);
    const slide = pptx.addSlide('HERMES_DESIGN_MASTER');
    builder({ slide, item, assetsDir, T, isArabic, C, pptx });
    addNotes(slide, item.notes);
  });
  return pptx.writeFile({ fileName: outputPath }).then(() => {
    console.log(JSON.stringify({ ok: true, output: outputPath, slides: spec.slides.length, language: isArabic ? 'ar' : 'en', engine: 'PptxGenJS' }));
  });
}

main(process.argv.slice(2)).catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message, stack: error.stack }));
  process.exit(1);
});
