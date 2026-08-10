/**
 * The 60/30/10 palette behind a colour tone.
 *
 * Picking "Sage" used to send one word to the prompt engine, which turned it
 * into "60% sage dominant field, 30% one harmonizing secondary tone, 10% one
 * controlled contrasting accent". Two of the three ratios were left for the
 * model to invent, so the same tone produced a different scheme on every run and
 * the swatch a person tapped told them nothing about the other 40% of the room.
 *
 * This derives the whole scheme from the chosen colour so the app can show it
 * and the prompt can name it. The rules are the ones an interior designer would
 * use on a single-colour brief:
 *
 * - **Dominant (60%)** is the colour as picked: walls, large soft furnishings,
 *   the field the eye reads first.
 * - **Secondary (30%)** stays on the same hue and steps away from the dominant
 *   in weight — a lighter tone under a dark colour, a deeper one under a pale
 *   colour — with the saturation pulled back so it supports rather than repeats.
 * - **Accent (10%)** is the complement, held at a believable interior
 *   saturation. For a near-neutral dominant the complement of grey is grey, so
 *   the accent falls back to a warm metal, which is what a neutral room actually
 *   uses for its 10%.
 *
 * Deriving rather than tabulating matters because the tone list is open: the
 * colour picker lets people add their own hex, and a lookup table could not
 * answer for those.
 */

import namer from "color-namer";

/** Warm brass. The 10% of a neutral scheme, where a complement would be grey. */
const NEUTRAL_ACCENT = { h: 38, s: 0.52, l: 0.44 };

/**
 * Below this chroma a colour has no usable complement.
 *
 * Chroma, not HSL saturation. Ivory (#FFFFF0) is 100% saturated in HSL — the
 * formula divides by a lightness term that collapses near white — so a
 * saturation test called it a colour and gave it a mustard secondary and a blue
 * accent. `max - min` says what the eye says: it is off-white.
 */
const NEUTRAL_CHROMA = 0.12;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function hexToRgb(hex) {
  const clean = String(hex || "").trim().replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16) / 255,
    g: parseInt(full.slice(2, 4), 16) / 255,
    b: parseInt(full.slice(4, 6), 16) / 255,
  };
}

function rgbToHsl({ r, g, b }) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

function hslToHex({ h, s, l }) {
  const hue = ((h % 360) + 360) % 360 / 360;
  const sat = clamp(s, 0, 1);
  const light = clamp(l, 0, 1);
  const channel = (p, q, t) => {
    let value = t;
    if (value < 0) value += 1;
    if (value > 1) value -= 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 1 / 2) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
  };
  let r = light;
  let g = light;
  let b = light;
  if (sat !== 0) {
    const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
    const p = 2 * light - q;
    r = channel(p, q, hue + 1 / 3);
    g = channel(p, q, hue);
    b = channel(p, q, hue - 1 / 3);
  }
  const byte = (value) => Math.round(clamp(value, 0, 1) * 255).toString(16).padStart(2, "0");
  return `#${byte(r)}${byte(g)}${byte(b)}`.toUpperCase();
}

/**
 * A short, human colour name for a hex.
 *
 * The prompt is read by an image model, so "Peppermint" carries more than
 * "#98FF98" does; `color-namer` is already a dependency for the custom-tone
 * picker, and this is the same lookup it uses.
 */
function nameOf(hex) {
  try {
    return namer(hex).ntc[0].name;
  } catch {
    return String(hex || "").toUpperCase();
  }
}

const swatch = (hex, role, share) => ({ hex, role, share, name: nameOf(hex) });

/**
 * Derive the 60/30/10 scheme for one colour.
 *
 * Returns `null` for anything that is not a colour, so callers can fall back to
 * sending the tone name alone rather than an invented palette.
 */
export function buildPalette(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const { h, s, l } = rgbToHsl(rgb);
  const chroma = Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b);
  // How saturated the colour actually looks, rather than what HSL reports at the
  // ends of the lightness range. Everything derived below keys off this.
  const intensity = clamp(chroma * 1.6, 0, 1);

  // Move away from the dominant rather than always down: a secondary derived by
  // darkening turns Ivory into beige but Eggplant into black.
  const towardsLight = l < 0.5;
  const secondary = {
    h,
    s: Math.min(s, intensity) * 0.6,
    l: towardsLight ? clamp(l + 0.26, 0, 0.92) : clamp(l - 0.24, 0.1, 1),
  };

  const accent = intensity < NEUTRAL_CHROMA
    ? NEUTRAL_ACCENT
    : {
      h: h + 180,
      // Held well below full saturation: a true complement at 100% reads as
      // signage, not as the one considered object in a room.
      s: clamp(Math.max(intensity, 0.34) * 0.82, 0.28, 0.62),
      l: clamp(towardsLight ? 0.52 : 0.42, 0.3, 0.6),
    };

  return {
    dominant: swatch(hslToHex({ h, s, l }), "dominant", 60),
    secondary: swatch(hslToHex(secondary), "secondary", 30),
    accent: swatch(hslToHex(accent), "accent", 10),
  };
}

/**
 * The palettes the app offers, keyed by the tone name the rest of the app
 * already sends. Anything not listed here — a custom hex, a walkthrough colour
 * mood, a tone from an older build — resolves through `buildPalette` or, failing
 * that, to null.
 */
export const TONE_HEXES = {
  Ivory: "#FFFFF0",
  Pearl: "#F8F6F0",
  Alabaster: "#FAFAFA",
  Neutral: "#A9A9A9",
  Ash: "#B2BEB5",
  Stone: "#DCDCDC",
  Charcoal: "#36454F",
  Slate: "#708090",
  "Vanilla Latte": "#F3E5AB",
  Taupe: "#D8B384",
  Earthy: "#8B4513",
  Walnut: "#5C4033",
  Blush: "#FFC0CB",
  Rose: "#FF007F",
  Crimson: "#DC143C",
  Rust: "#B7410E",
  Warm: "#FFB347",
  Amber: "#FFBF00",
  Gold: "#FFD700",
  Ochre: "#CC7722",
  Mint: "#98FF98",
  Olive: "#808000",
  Sage: "#9DC183",
  Forest: "#228B22",
  Sky: "#87CEEB",
  Cool: "#ADD8E6",
  Denim: "#1560BD",
  Navy: "#000080",
  Lavender: "#E6E6FA",
  Lilac: "#C8A2C8",
  Plum: "#8E4585",
  Eggplant: "#3B0A45",

  // The 3D walkthrough's own vocabulary. It asks for a "colour mood" rather than
  // a tone, and its answers reach the same prompt engine, so they resolve here
  // too instead of arriving as a bare adjective.
  "Warm neutral": "#D8C3A5",
  "Cool neutral": "#B9C2C6",
  "Earthy natural": "#A8836A",
  "Light and airy": "#F2EFE6",
  Monochrome: "#8C8C8C",
  "Bold accents": "#2F5D62",
};

/**
 * The 60/30/10 scheme for a tone name or a raw hex.
 *
 * Callers pass whatever they already hold — "Sage", "#9DC183", a name a person
 * typed into the custom picker — and get a palette or null.
 */
export function paletteForTone(tone) {
  if (!tone) return null;
  const value = String(tone).trim();
  return buildPalette(TONE_HEXES[value] || value);
}

/**
 * Flatten the palette to the exact number of colors a design path asks for.
 * Interior keeps the default three-color 60/30/10 scheme; exterior can send a
 * single selected facade color without silently inventing two more colors.
 */
export function paletteForRequest(tone, palette, colorCount = 3) {
  const resolved = palette || paletteForTone(tone);
  if (!resolved) return undefined;
  const count = Math.max(1, Math.min(3, Number(colorCount) || 3));
  const entries = [resolved.dominant, resolved.secondary, resolved.accent].slice(0, count);
  const request = {
    colorCount: count,
    colors: entries.map((entry, index) => ({
      name: count === 1 && index === 0 ? String(tone).trim() || entry.name : entry.name,
      hex: entry.hex,
    })),
    dominant: resolved.dominant.name,
    dominantHex: resolved.dominant.hex,
  };
  if (count >= 2) {
    request.secondary = resolved.secondary.name;
    request.secondaryHex = resolved.secondary.hex;
  }
  if (count >= 3) {
    request.accent = resolved.accent.name;
    request.accentHex = resolved.accent.hex;
  }
  return request;
}
