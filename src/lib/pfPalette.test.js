import test from "node:test"; import assert from "node:assert/strict"; import fs from "node:fs";
/* The ProspectFinder workspace screens use role-based colour variables (--pf-tx-/bg-/bd-HEX).
   • LIGHT must be the ORIGINAL colours (no visual change from before theming).
   • DARK must keep every text-on-background pair readable (checked on the real source files). */
const root = new URL("../", import.meta.url);
const palette = fs.readFileSync(new URL("styles/pf-palette.css", root), "utf8");
const grab = re => Object.fromEntries([...(palette.match(re)?.[1] ?? "").matchAll(/--pf-((?:tx|bg|bd)-[0-9A-F]{6}):(#[0-9A-Fa-f]{6});/g)].map(m => [m[1], m[2].toUpperCase()]));
const LIGHT = grab(/:root \{([^}]*)\}/), DARKO = grab(/\[data-theme="dark"\] \{([^}]*)\}/);
const darkOf = k => DARKO[k] ?? LIGHT[k];

const FILES = ["ProspectHome", "LeadQualification", "OutreachWorkspace", "TeamTasks", "AnalyticsWorkspace", "QualityReviewWorkspace", "WorkflowWorkspace", "NationwideFinder", "OutreachTools", "TaskNotifications", "ApiIntegrations"];
const SRC = FILES.map(f => [f, fs.readFileSync(new URL(`features/prospects/${f}.jsx`, root), "utf8")]);

const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const lum = c => { const f = x => { x /= 255; return x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
const ratio = (a, b) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p); return (x + .05) / (y + .05); };

test("light theme = the original colours, exactly (no visual change)", () => {
  const entries = Object.entries(LIGHT); assert.ok(entries.length > 250, `only ${entries.length} variables`);
  for (const [k, v] of entries) assert.equal(v, "#" + k.slice(-6), k);
});
test("every colour variable used in the screens is defined (a missing one would render transparent)", () => {
  const missing = new Set();
  for (const [f, s] of SRC) for (const m of s.matchAll(/var\(--pf-((?:tx|bg|bd)-[0-9A-F]{6})\)/g)) if (!LIGHT[m[1]]) missing.add(`${f}: ${m[1]}`);
  assert.deepEqual([...missing], []);
});
test("no light-theme hex is left in a text/background/border position (except deliberate keepers)", () => {
  for (const [f, s] of SRC){
    if (f === "ProspectHome") continue;                       // contains the always-dark sidebar rules (kept on purpose)
    const left = [...s.matchAll(/(?<![-\w])(?:background(?:Color)?|border\w*)\s*:\s*["'`][^"'`]*?(#[0-9A-Fa-f]{6})\b/g)].map(m => m[1]);
    const bad = left.filter(h => { const [r, g, b] = rgb(h); return (r + g + b) / 3 > 150; });   // light backgrounds/borders that were not converted
    assert.deepEqual(bad, [], `${f}: ${bad.join(" ")}`);
  }
});
test("DARK: every text-on-background pair in the source stays readable", () => {
  const problems = []; let pairs = 0;
  for (const [f, s] of SRC){
    const blocks = [...s.matchAll(/\{\{[^{}]*\}\}/g), ...s.matchAll(/\{[^{}]*\}/g)].map(m => m[0]);
    for (const b of blocks){
      const t = b.match(/(?<![-\w])color\s*:\s*["'`]?var\(--pf-(tx-[0-9A-F]{6})\)/), g = b.match(/(?<![-\w])background(?:Color|-color)?\s*:\s*["'`]?var\(--pf-(bg-[0-9A-F]{6})\)/);
      if (!t || !g) continue; pairs++;
      const lr = ratio(LIGHT[t[1]], LIGHT[g[1]]), dr = ratio(darkOf(t[1]), darkOf(g[1]));
      const need = lr >= 4.5 ? 4.5 : Math.max(3, lr - 0.3);
      if (dr < need) problems.push(`${f}: ${t[1]} on ${g[1]} → light ${lr.toFixed(1)}, dark ${dr.toFixed(1)} (${LIGHT[t[1]]}→${darkOf(t[1])} on ${LIGHT[g[1]]}→${darkOf(g[1])})`);
    }
  }
  assert.ok(pairs > 40, `only ${pairs} pairs found — the check isn't seeing the screens`);
  assert.deepEqual([...new Set(problems)], []);
});
test("DARK: page ink / surfaces / borders are mapped consistently", () => {
  const d = /\[data-theme="dark"\] \.pf-root \{([^}]*)\}/.exec(palette)[1];
  assert.match(d, /--pf-ink:#EEF2FD/); assert.match(d, /--pf-canvas:#0B1426/);
  assert.ok(ratio("#EEF2FD", "#0B1426") > 12 && ratio("#9DABC8", "#111E38") >= 4.5);
});
