/* Ctrl/⌘+K: jump anywhere, run an action, or find a prospect — without hunting through menus. */
import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "./icons.jsx";
import { rank, fuzzyScore } from "../lib/fuzzy.js";
import { extractEmails } from "../lib/text.js";

export default function CommandPalette({ open, onClose, commands, prospects = [], onOpenProspect }){
  const [q, setQ] = useState(""); const [idx, setIdx] = useState(0);
  const inputRef = useRef(null); const listRef = useRef(null);
  useEffect(() => { if (open){ setQ(""); setIdx(0); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);

  const results = useMemo(() => {
    const query = q.trim();
    const cmds = query
      ? commands.map(c => ({ c, s: Math.max(fuzzyScore(query, c.label), fuzzyScore(query, c.keywords || "") - 50) })).filter(x => x.s >= 0).sort((a, b) => b.s - a.s).map(x => x.c)
      : commands;
    const people = query.length >= 2
      ? rank(query, prospects, p => `${p.companyName || ""} ${p.contactName || ""} ${extractEmails(p.emailPhone)[0] || ""} ${p.cityMarket || p.market || ""}`, 6) : [];
    const groups = []; const add = (title, items) => { if (items.length) groups.push({ title, items }); };
    add("Prospects", people.map(p => ({ id: "p-" + p.id, label: p.companyName || "(unnamed)", hint: [p.contactName, p.cityMarket || p.market].filter(Boolean).join(" · "), icon: "users", run: () => onOpenProspect?.(p) })));
    for (const g of ["Do", "Go to"]) add(g, cmds.filter(c => c.group === g).slice(0, query ? 8 : 40));
    return groups;
  }, [q, commands, prospects, onOpenProspect]);

  const flat = results.flatMap(g => g.items);
  useEffect(() => { setIdx(0); }, [q]);
  useEffect(() => { listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" }); }, [idx]);
  if (!open) return null;

  const run = item => { onClose(); setTimeout(() => item.run(), 0); };
  const onKey = e => {
    if (e.key === "Escape"){ e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown"){ e.preventDefault(); setIdx(i => Math.min(flat.length - 1, i + 1)); }
    else if (e.key === "ArrowUp"){ e.preventDefault(); setIdx(i => Math.max(0, i - 1)); }
    else if (e.key === "Enter" && flat[idx]){ e.preventDefault(); run(flat[idx]); }
  };
  let n = -1;
  return (
    <div className="nc-cmd-scrim nc" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="nc-cmd" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKey}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 18px", borderBottom: "1px solid var(--k-border)" }}>
          <Icon name="search" size={18} />
          <input ref={inputRef} className="nc-cmd-input" value={q} onChange={e => setQ(e.target.value)} placeholder="Search prospects, or type what you want to do…"
            role="combobox" aria-expanded="true" aria-controls="nc-cmd-list" aria-activedescendant={flat[idx] ? "cmd-" + flat[idx].id : undefined} autoComplete="off" spellCheck={false} />
          <span className="nc-kbd">Esc</span>
        </div>
        <div className="nc-cmd-list" id="nc-cmd-list" role="listbox" ref={listRef}>
          {flat.length === 0 && <div style={{ padding: "26px 16px", textAlign: "center", color: "var(--k-text2)", fontSize: 13.5 }}>Nothing matches “{q}”. Try a company name, or “add”, “map” or “email”.</div>}
          {results.map(g => (
            <div key={g.title} role="group" aria-label={g.title}>
              <div className="nc-cmd-group">{g.title}</div>
              {g.items.map(it => { n++; const mine = n; return (
                <button key={it.id} id={"cmd-" + it.id} type="button" role="option" aria-selected={idx === mine} className="nc-cmd-item" onMouseMove={() => setIdx(mine)} onClick={() => run(it)}>
                  <span className="nc-cmd-ico"><Icon name={it.icon || "bolt"} size={16} /></span>
                  <span style={{ flex: 1, minWidth: 0 }}><span className="nc-trunc" style={{ display: "block" }}>{it.label}</span>{it.hint && <span className="nc-trunc" style={{ display: "block", fontSize: 12, color: "var(--k-text2)" }}>{it.hint}</span>}</span>
                  {idx === mine && <span className="nc-kbd">Enter</span>}
                </button>); })}
            </div>
          ))}
        </div>
        <div className="nc-cmd-foot"><span><span className="nc-kbd">↑</span> <span className="nc-kbd">↓</span> to move</span><span><span className="nc-kbd">Enter</span> to open</span><span style={{ marginLeft: "auto" }}>Nothing is sent or changed from here</span></div>
      </div>
    </div>
  );
}
