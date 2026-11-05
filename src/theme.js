// Coverage comes from here, not from the model. The director picks one theme and this file
// applies it to every element on the page by role: page ground, surface, control, heading,
// body, muted text. Section agents then only have to refine, so a long page can never end
// up half redesigned.

export function parseColor(value) {
  const m = String(value).match(/rgba?\(([^)]+)\)/);
  if (!m) return { r: 0, g: 0, b: 0, a: 0 };
  const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(parseFloat);
  return { r, g, b, a };
}

export function saturation({ r, g, b }) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

export const lightness = ({ r, g, b }) => (.2126 * r + .7152 * g + .0722 * b) / 255;

const HEADING = /^H[1-6]$/;
const CONTROL = /^(BUTTON|A|LABEL|SUMMARY)$/;
const MONO = /mono|courier|consolas|menlo/i;

// `s` is a plain snapshot of an element's computed style, so this stays testable without a
// DOM. `ground` is the theme colour the element sits on. Returns the edits and the new ground.
export function restyle(s, ground, t, viewport) {
  const css = {};
  const bg = parseColor(s.backgroundColor);
  const hasColor = bg.a > .08;
  const hasGradient = s.backgroundImage.includes('gradient');
  const hasImage = s.backgroundImage.includes('url(');
  const textClip = s.backgroundClip === 'text';
  let nextGround = ground;

  if (textClip) {
    css.background = 'none';
    css['-webkit-text-fill-color'] = t.accent;
    css.color = t.accent;
  } else if (s.decor) {
    // Blurred colour blobs belong to the old design and turn into hard rectangles if recoloured.
    css.display = 'none';
    return { css, ground };
  } else if ((hasColor || hasGradient) && !hasImage) {
    const wide = s.width > viewport.width * .8;
    const compact = s.height < 96 && s.width < 460;
    const loud = hasGradient || saturation(bg) > .3;
    if (compact && (loud || CONTROL.test(s.tag))) {
      css.background = t.accent;
      nextGround = 'accent';
    } else if (wide) {
      css.background = t.bg;
      nextGround = 'bg';
    } else {
      css.background = t.surface;
      nextGround = 'surface';
    }
  }

  if (s.hasText && !textClip) {
    const ink = parseColor(s.color);
    if (nextGround === 'accent') css.color = t.accentText;
    else if (s.tag === 'A' && saturation(ink) > .3) css.color = t.accent;
    else if (saturation(ink) > .45) css.color = t.accent;
    else if (ink.a < .75 || Math.abs(lightness(ink) - lightness(s.parentBg || bg)) < .42) css.color = t.muted;
    else css.color = t.text;
  }

  if (s.borderWidth > 0 && parseColor(s.borderColor).a > .05) {
    css['border-color'] = t.border;
    if (t.borderWidth) css['border-width'] = t.borderWidth;
  }

  if (s.radius > 0) css['border-radius'] = s.radius >= Math.min(s.height / 2, 40) && s.height < 80 ? t.pill : t.radius;
  if (s.boxShadow !== 'none') css['box-shadow'] = t.shadow;

  if (HEADING.test(s.tag) || s.fontSize >= 28) {
    css['font-family'] = t.headingFont;
    css['font-weight'] = t.headingWeight;
    css['letter-spacing'] = t.headingSpacing;
    if (t.headingCase !== 'none') css['text-transform'] = t.headingCase;
  } else if (MONO.test(s.fontFamily)) {
    css['font-family'] = t.monoFont;
  } else if (s.hasText) {
    css['font-family'] = t.bodyFont;
  }
  return { css, ground: nextGround };
}

const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META', 'HEAD', 'BR', 'WBR', 'IMG', 'PICTURE', 'VIDEO', 'CANVAS', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'PATH']);
const MAX_ELEMENTS = 15000;

function read(el, parentBg) {
  const c = getComputedStyle(el), r = el.getBoundingClientRect();
  const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim());
  const backgroundImage = c.backgroundImage;
  return {
    tag: el.tagName, width: r.width, height: r.height, top: r.top + scrollY, left: r.left, hasText, parentBg,
    backgroundColor: c.backgroundColor, backgroundImage, backgroundClip: c.webkitBackgroundClip || c.backgroundClip,
    color: c.color, borderWidth: parseFloat(c.borderTopWidth) + parseFloat(c.borderBottomWidth) + parseFloat(c.borderLeftWidth),
    borderColor: c.borderTopColor, radius: parseFloat(c.borderTopLeftRadius) || 0, boxShadow: c.boxShadow,
    fontSize: parseFloat(c.fontSize), fontFamily: c.fontFamily, position: c.position,
    decor: !hasText && !el.children.length && c.filter.includes('blur') && (backgroundImage.includes('gradient') || parseColor(c.backgroundColor).a > .05),
  };
}

// Reads everything first and writes later, so a large page never thrashes layout.
export function planTheme(root, theme, grounds = new WeakMap()) {
  const plan = [], viewport = { width: innerWidth, height: innerHeight };
  const walk = (el, ground, parentBg) => {
    if (plan.length >= MAX_ELEMENTS || SKIP.has(el.tagName.toUpperCase()) || el.id === 'redraft') return;
    if (!el.getClientRects().length) {
      // Hidden menus and tabs still need the theme for when they open.
      for (const c of el.children) walk(c, ground, parentBg);
      return;
    }
    const s = read(el, parentBg);
    const { css, ground: next } = restyle(s, ground, theme, viewport);
    grounds.set(el, next);
    if (Object.keys(css).length) plan.push({ el, css, top: s.top, left: s.left, width: s.width, height: s.height, fixed: s.position === 'fixed' || s.position === 'sticky' });
    if (s.decor) return;
    const own = parseColor(s.backgroundColor);
    for (const c of el.children) walk(c, next, own.a > .08 ? own : parentBg);
  };
  walk(root, 'bg', { r: 255, g: 255, b: 255, a: 1 });
  return plan;
}

export const themeVars = t => ({
  '--nx-bg': t.bg, '--nx-surface': t.surface, '--nx-text': t.text, '--nx-muted': t.muted, '--nx-accent': t.accent,
  '--nx-accent-text': t.accentText, '--nx-border': t.border, '--nx-radius': t.radius, '--nx-shadow': t.shadow,
  '--nx-heading': t.headingFont, '--nx-body': t.bodyFont,
});
