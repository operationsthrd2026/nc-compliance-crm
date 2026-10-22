/* Tiny fuzzy matcher for the command palette: all typed letters must appear in order. */
const norm = s => String(s ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
/** score ≥ 0 when it matches (higher = better), -1 when it doesn't */
export function fuzzyScore(query, text){
  const q = norm(query).trim(), t = norm(text); if (!q) return 0; if (!t) return -1;
  const at = t.indexOf(q);
  if (at >= 0) return 1000 - at * 5 - (t.length - q.length) * 0.1 + (at === 0 || /\W/.test(t[at - 1]) ? 200 : 0);   // contiguous: start-of-word wins
  let ti = 0, score = 0, streak = 0;
  for (const ch of q.replace(/\s+/g, "")){
    const found = t.indexOf(ch, ti); if (found < 0) return -1;
    streak = found === ti ? streak + 1 : 0; score += 10 + streak * 5 - (found - ti) + (found === 0 || /\W/.test(t[found - 1]) ? 15 : 0); ti = found + 1;
  }
  return Math.max(0, score);
}
export function rank(query, items, get = x => x, limit = 50){
  return items.map(it => ({ it, s: fuzzyScore(query, get(it)) })).filter(x => x.s >= 0).sort((a, b) => b.s - a.s).slice(0, limit).map(x => x.it);
}
