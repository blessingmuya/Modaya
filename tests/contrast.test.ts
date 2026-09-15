import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Contrast is a measured property, not a matter of taste, so it is tested.
 *
 * The first light-theme pass shipped a tertiary text tier at 2.6:1 and several
 * accent-on-tint pairs just under 4.5:1. Nothing would have caught that: the
 * colours are spread across CSS custom properties that no other test reads. This
 * test parses the token block and asserts the pairs the UI actually renders.
 */

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', 'src');
const css = readFileSync(join(here, '..', 'src', 'app', 'globals.css'), 'utf8');

/** Reads `--color-<name>: <hex>;` out of the @theme block. */
function readTokens(): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const match of css.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    tokens.set(match[1], match[2].toLowerCase());
  }
  return tokens;
}

function channel(value: number): number {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.1 contrast ratio. */
export function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const AA = 4.5;

/** Every text-on-surface pairing the components actually render. */
const PAIRS: [label: string, fg: string, bg: string][] = [
  ['body text on the page canvas', 'ink', 'canvas'],
  ['body text on a card', 'ink', 'surface'],
  ['soft body text on the canvas', 'ink-soft', 'canvas'],
  ['secondary text on the canvas', 'muted', 'canvas'],
  ['secondary text on a card', 'muted', 'surface'],
  ['secondary text on an inset well', 'muted', 'base-900'],
  ['tertiary metadata on the canvas', 'faint', 'canvas'],
  ['tertiary metadata on a card', 'faint', 'surface'],
  ['tertiary metadata on an inset well', 'faint', 'base-900'],
  ['accent text on the canvas', 'accent-strong', 'canvas'],
  ['accent text on a card', 'accent-strong', 'surface'],
  ['accent text on the measured chip', 'accent-strong', 'accent-soft'],
  ['accent fill label', 'accent-on', 'accent'],
  ['solid pill label on the page canvas', 'canvas', 'ink'],
  ['warning text on its chip', 'warn-text', 'warn-soft'],
  ['warning text on the canvas', 'warn-text', 'canvas'],
  ['danger text on its chip', 'danger-text', 'danger-soft'],
  ['danger text on the canvas', 'danger-text', 'canvas'],
];

test('every text/background pair in the UI meets WCAG AA', () => {
  const tokens = readTokens();
  assert.ok(tokens.size >= 20, `expected the token block to parse, got ${tokens.size} tokens`);

  const failures: string[] = [];
  for (const [label, fg, bg] of PAIRS) {
    const fgHex = tokens.get(fg);
    const bgHex = tokens.get(bg);
    assert.ok(fgHex, `token --color-${fg} is not defined in globals.css`);
    assert.ok(bgHex, `token --color-${bg} is not defined in globals.css`);

    const ratio = contrast(fgHex, bgHex);
    if (ratio < AA) {
      failures.push(`${label}: ${fgHex} on ${bgHex} = ${ratio.toFixed(2)}:1 (needs ${AA}:1)`);
    }
  }

  assert.deepEqual(failures, [], `contrast regressions:\n${failures.join('\n')}`);
});

test('the text ladder has visibly separated tiers', () => {
  const tokens = readTokens();
  const ink = tokens.get('ink')!;
  const inkSoft = tokens.get('ink-soft')!;
  const muted = tokens.get('muted')!;
  const faint = tokens.get('faint')!;

  // A canvas can only carry so many text tiers before they stop being
  // distinguishable, so the ladder is three and each step must be visible.
  const softToMuted = contrast(inkSoft, muted);
  const mutedToFaint = contrast(muted, faint);
  assert.ok(
    softToMuted > 1.2,
    `ink-soft and muted are only ${softToMuted.toFixed(3)}x apart — one tier, not two`,
  );
  assert.ok(
    mutedToFaint > 1.15,
    `muted and faint are only ${mutedToFaint.toFixed(3)}x apart — one tier, not two`,
  );
  assert.ok(contrast(ink, faint) > contrast(ink, muted), 'tiers are not ordered brightest-first');
});

/**
 * A renamed token silently deletes every class that referenced it: the element
 * keeps its layout and loses its colour. That is how a status dot ends up
 * invisible rather than obviously broken, so it is checked here.
 */
test('no component references a colour token that does not exist', () => {
  const defined = new Set(
    [...css.matchAll(/--color-([a-z0-9-]+):/g)].map((match) => match[1]),
  );

  // Colour-ish prefixes, minus Tailwind's own built-ins and our component classes.
  const UTILITY = /\b(?:bg|text|border|ring|from|to|via|fill|stroke)-(?:mint|warn|danger|accent|surface|ink|line|faint|muted|canvas|base)-?[a-z0-9/-]*/g;
  const BUILT_IN = new Set([
    'text-white',
    'text-black',
    'text-transparent',
    'text-current',
    'text-center',
    'text-left',
    'text-right',
    'text-sm',
    'text-xs',
    'bg-white',
    'bg-black',
    'border-transparent',
    'text-base',
    'text-inherit',
  ]);

  const dangling = new Set<string>();
  for (const file of readdirSync(srcDir, { recursive: true, encoding: 'utf8' })) {
    if (!file.endsWith('.tsx')) continue;
    const contents = readFileSync(join(srcDir, file), 'utf8');
    for (const match of contents.matchAll(UTILITY)) {
      const [utility] = match;
      // Strip the utility prefix and any opacity suffix: `bg-canvas/85` uses the
      // `canvas` token at 85% opacity.
      const token = utility
        .replace(/^(bg|text|border|ring|from|to|via|fill|stroke)-/, '')
        .split('/')[0];
      if (BUILT_IN.has(utility)) continue;
      if (defined.has(token)) continue;
      dangling.add(`${utility} (in src/${file})`);
    }
  }

  assert.deepEqual([...dangling], [], `classes with no matching --color-* token:\n${[...dangling].join('\n')}`);
});
