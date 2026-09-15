import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  ['accent text on the canvas', 'mint-700', 'canvas'],
  ['accent text on a card', 'mint-600', 'canvas'],
  ['accent text on the measured chip', 'mint-700', 'mint-100'],
  ['accent text on a clip block', 'mint-700', 'mint-200'],
  ['primary button label', 'base-950', 'mint-400'],
  ['warning text on its chip', 'warn-400', 'warn-100'],
  ['warning text on the canvas', 'warn-400', 'canvas'],
  ['danger text on its chip', 'danger-400', 'danger-100'],
  ['danger text on the canvas', 'danger-400', 'canvas'],
  ['white on the dark closing CTA', 'surface', 'base-950'],
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

  // A light canvas cannot fit four tiers at AA, so the ladder is three and they
  // must be far enough apart to read as different weights.
  const softToMuted = contrast(inkSoft, muted);
  const mutedToFaint = contrast(muted, faint);
  assert.ok(
    softToMuted > 1.25,
    `ink-soft and muted are only ${softToMuted.toFixed(3)}x apart — one tier, not two`,
  );
  assert.ok(
    mutedToFaint > 1.25,
    `muted and faint are only ${mutedToFaint.toFixed(3)}x apart — one tier, not two`,
  );
  assert.ok(contrast(ink, faint) > contrast(ink, muted), 'tiers are not ordered darkest-first');
});
