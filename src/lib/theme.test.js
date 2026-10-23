import test from "node:test"; import assert from "node:assert/strict"; import fs from "node:fs";
/* WCAG contrast of every text / accent token against the surfaces it is drawn on — in BOTH themes.
   (Reads the real src/styles/theme.css, so a bad edit to a token fails here.) */
const css = fs.readFileSync(new URL("../styles/theme.css", import.meta.url), "utf8");
const block = re => { const m = css.match(re); assert.ok(m, "theme block missing"); return Object.fromEntries([...m[1].matchAll(/--k-([\w-]+):([^;]+);/g)].map(x => [x[1], x[2].trim()])); };
const THEMES = { dark: block(/:root, \[data-theme="dark"\] \{([^}]*)\}/), light: block(/\[data-theme="light"\] \{([^}]*)\}/) };

const parse = v => {
  let m = v.match(/^#([0-9a-f]{6})$/i); if (m) return [...m[1].match(/../g)].map(h => parseInt(h, 16)).concat(1);
  m = v.match(/^rgba?\(([^)]+)\)$/); if (m){ const p = m[1].split(",").map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; }
  throw new Error("cannot parse " + v);
};
const over = (fg, bg) => [0, 1, 2].map(i => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1);        // alpha-blend fg over an opaque bg
const lum = c => { const f = x => { x /= 255; return x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
const contrast = (t, fgName, bgName) => { const T = THEMES[t]; const bg = parse(T[bgName]); return ratio(over(parse(T[fgName]), bg), bg); };

const TEXT = ["text", "text2", "gold-l", "green", "amber", "red", "blue", "purple", "pink"];
const SURFACES = ["bg", "surface", "surface2", "pop", "thead"];

for (const theme of ["dark", "light"]){
  test(`${theme}: body and accent text meet WCAG AA (4.5:1) on every surface`, () => {
    const bad = [];
    for (const f of TEXT) for (const b of SURFACES){ const r = contrast(theme, f, b); if (r < 4.5) bad.push(`${f} on ${b} = ${r.toFixed(2)}`); }
    assert.deepEqual(bad, [], bad.join("; "));
  });
  test(`${theme}: dim helper text (text3) stays readable (≥3:1) on cards`, () => {
    for (const b of ["surface", "bg"]) assert.ok(contrast(theme, "text3", b) >= 3, `text3 on ${b} = ${contrast(theme, "text3", b).toFixed(2)}`);
  });
  test(`${theme}: navy text on the gold button is readable`, () => {
    const navy = [11, 20, 38, 1], gold = parse(THEMES[theme].gold); assert.ok(ratio(navy, gold) >= 4.5, ratio(navy, gold).toFixed(2));
  });
  test(`${theme}: borders are visible but not heavy`, () => {
    const r = contrast(theme, "border2", "surface"); assert.ok(r >= 1.15 && r <= 4, r.toFixed(2));
  });
}
test("every token exists in BOTH themes (a missing one would silently fall back)", () => {
  assert.deepEqual(Object.keys(THEMES.dark).sort(), Object.keys(THEMES.light).sort());
});
test("dark theme keeps the original brand values (dark mode must not change)", () => {
  const d = THEMES.dark; assert.equal(d.bg, "#0B1426"); assert.equal(d.surface, "#111E38"); assert.equal(d.text, "#F0F4FF"); assert.equal(d["gold-l"], "#DBA843"); assert.equal(d.green, "#34d399");
});

/* The Today screen paints coloured text on a faint wash of the same colour (badges, icon chips, big numbers). */
const mix = (fg, bg, pct) => [0, 1, 2].map(i => fg[i] * pct + bg[i] * (1 - pct)).concat(1);
for (const theme of ["dark", "light"]){
  test(`${theme}: tone-coloured text stays readable on its own tinted background (Today badges / chips)`, () => {
    const T = THEMES[theme], surface = parse(T.surface), bad = [];
    for (const tone of ["red", "green", "blue", "amber"]){
      const fg = over(parse(T[tone]), surface);
      for (const pct of [0.10, 0.12, 0.14]){ const bg = mix(fg, surface, pct); const r = ratio(fg, bg); if (r < 4.5) bad.push(`${tone} on ${Math.round(pct * 100)}% wash = ${r.toFixed(2)}`); }
    }
    assert.deepEqual(bad, [], bad.join("; "));
  });
  test(`${theme}: gold links on cards (Today “Hide”, “See all”) are readable`, () => {
    assert.ok(contrast(theme, "gold-l", "surface") >= 4.5, contrast(theme, "gold-l", "surface").toFixed(2));
  });
}
