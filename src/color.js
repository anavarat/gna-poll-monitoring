// Color classification helpers.
// We intentionally do NOT hardcode a single green RGB; sites vary.
// Instead we classify by hue + saturation/lightness.

function parseCssRgb(css) {
  // css like: rgb(0, 128, 0) or rgba(0, 128, 0, 1)
  const m = css.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!m) return null;
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s;
  const l = (max + min) / 2;

  if (max === min) {
    h = 0; s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return { h, s, l };
}

function isGreenish(cssColor) {
  const rgb = parseCssRgb(cssColor);
  if (!rgb) return { ok: false, reason: 'unparsed', hsl: null };

  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);

  // Chosen to match "obviously green" to normal eyes:
  // Hue roughly [85°, 160°] (yellow-green to cyan-green),
  // with some saturation (avoid grey), and mid lightness.
  const hueOk = h >= 85 && h <= 160;
  const satOk = s >= 0.18;         // allow slightly desaturated greens
  const lightOk = l >= 0.15 && l <= 0.85;

  const ok = hueOk && satOk && lightOk;
  return { ok, reason: ok ? 'greenish' : 'not-greenish', hsl: { h, s, l }, rgb };
}

module.exports = { parseCssRgb, rgbToHsl, isGreenish };
