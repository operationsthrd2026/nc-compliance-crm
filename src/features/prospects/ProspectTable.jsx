import { extractEmails, extractPhones } from "../../lib/text.js";
import { nextAction, fmtDay } from "../../lib/outreach.js";
import { StatusPill, ScoreBadge, EmailBadge, Check, Btn, cx } from "../../ui/kit.jsx";

export const COLUMNS = [
  { id: "company", label: "Company", always: true, sort: "companyName" },
  { id: "contact", label: "Contact", sort: "contactName" },
  { id: "fit", label: "Fit", sort: "score" },
  { id: "email", label: "Email", sort: "emailStatus" },
  { id: "vertical", label: "Industry", sort: "vertical" },
  { id: "market", label: "Market", sort: "market" },
  { id: "status", label: "Status", always: true, sort: "currentStatus" },
  { id: "next", label: "Next step" },
  { id: "tags", label: "Tags" },
];
const TONE = { ready: "var(--nc-green)", warn: "var(--nc-amber)", due: "var(--nc-red)", info: "var(--nc-text-2)", muted: "var(--nc-text-3)", done: "var(--nc-green)" };

export default function ProspectTable({ rows, selected, onToggle, onTogglePage, sort, onSort, cols, compact, onOpen, openId, scoreOf, dupOf, onEdit, canEdit, tagsEnabled }){
  const visible = COLUMNS.filter(c => c.always || cols[c.id]);
  const pageSel = rows.filter(r => selected.has(r.id)).length;
  const now = new Date();
  return (
    <div className="nc-tablewrap">
      <table className={cx("nc-table", compact && "compact")} aria-label="Prospects">
        <thead>
          <tr>
            <th style={{ width: 38 }}><Check checked={rows.length > 0 && pageSel === rows.length} indeterminate={pageSel > 0 && pageSel < rows.length} onChange={onTogglePage} label="Select all rows on this page" disabled={!canEdit} /></th>
            {visible.map(c => (
              <th key={c.id} className={c.sort ? "sortable" : ""} aria-sort={sort.key === c.sort ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                onClick={c.sort ? () => onSort(c.sort) : undefined}>
                {c.label}{sort.key === c.sort && <span aria-hidden style={{ marginLeft: 4, color: "var(--nc-gold-l)" }}>{sort.dir === "asc" ? "↑" : "↓"}</span>}
              </th>
            ))}
            <th style={{ width: 44 }} />
          </tr>
        </thead>
        <tbody>
          {rows.map(p => {
            const emails = extractEmails(p.emailPhone), phones = extractPhones(p.emailPhone);
            const sc = scoreOf(p), na = nextAction(p, now), dup = dupOf.get(p.id);
            return (
              <tr key={p.id} tabIndex={0} className={cx(selected.has(p.id) && "sel", openId === p.id && "open")}
                onClick={() => onOpen(p)} onKeyDown={e => { if (e.key === "Enter" && e.target === e.currentTarget){ e.preventDefault(); onOpen(p); } if (e.key === " " && e.target === e.currentTarget && canEdit){ e.preventDefault(); onToggle(p.id); } }}>
                <td onClick={e => e.stopPropagation()}><Check checked={selected.has(p.id)} onChange={() => onToggle(p.id)} label={`Select ${p.companyName}`} disabled={!canEdit} /></td>
                <td style={{ maxWidth: 240 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="nc-trunc" style={{ font: "700 13px var(--nc-font)" }}>{p.companyName || "(unnamed)"}</span>
                    {dup && <span title={`Possible duplicate (${dup.size} records) — open to review`} style={{ color: dup.level === "high" ? "var(--nc-amber)" : "var(--nc-text-3)", fontSize: 12 }}>⚠</span>}
                    {p.flagToMelissa && <span title="Flagged for Melissa" style={{ fontSize: 11 }}>🔔</span>}
                    {p.replyReceived && <span title="Replied" style={{ color: "var(--nc-green)", fontSize: 12 }}>↩</span>}
                    {p.doNotRespond && <span title="Do not respond" style={{ fontSize: 11 }}>🚫</span>}
                  </div>
                  {p.cityMarket && <div className="nc-trunc" style={{ color: "var(--nc-text-3)", fontSize: 11, marginTop: 2 }}>{p.cityMarket}</div>}
                </td>
                {cols.contact && <td style={{ maxWidth: 190 }}><div className="nc-trunc" style={{ color: p.contactName ? "var(--nc-text)" : "var(--nc-text-3)" }}>{p.contactName || "—"}</div>{p.title && <div className="nc-trunc" style={{ color: "var(--nc-text-3)", fontSize: 11 }}>{p.title}</div>}</td>}
                {cols.fit && <td><ScoreBadge result={sc} showLabel /></td>}
                {cols.email && <td style={{ maxWidth: 220 }}>
                  {emails.length ? <><div className="nc-trunc" style={{ fontSize: 12 }}>{emails[0]}{emails.length > 1 && <span style={{ color: "var(--nc-text-3)" }}> +{emails.length - 1}</span>}</div>{tagsEnabled && <EmailBadge status={p.emailStatus || ""} compact={false} />}</>
                    : <span style={{ color: "var(--nc-text-3)", fontSize: 12 }}>{phones.length ? `📞 ${phones[0].replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3")}` : "—"}</span>}
                </td>}
                {cols.vertical && <td style={{ maxWidth: 170 }}><span className="nc-trunc" style={{ display: "block", color: p.vertical ? "var(--nc-text-2)" : "var(--nc-text-3)", fontSize: 12 }}>{p.vertical || "—"}</span></td>}
                {cols.market && <td style={{ color: p.market ? "var(--nc-text-2)" : "var(--nc-text-3)", fontSize: 12 }}>{p.market || "—"}</td>}
                <td><StatusPill status={p.currentStatus} /></td>
                {cols.next && <td><div style={{ color: TONE[na.tone], font: "600 12px var(--nc-font)" }}>{na.label}</div>{na.due && <div style={{ fontSize: 11, color: na.overdue ? "var(--nc-red)" : "var(--nc-text-3)" }}>{na.overdue ? "Overdue · " : "Due "}{fmtDay(na.due)}</div>}</td>}
                {cols.tags && <td style={{ maxWidth: 180 }}><div style={{ display: "flex", gap: 4, flexWrap: "nowrap", overflow: "hidden" }}>{(p.tags || []).slice(0, 2).map(t => <span key={t} className="nc-tag">{t}</span>)}{(p.tags || []).length > 2 && <span style={{ color: "var(--nc-text-3)", fontSize: 11 }}>+{p.tags.length - 2}</span>}</div></td>}
                <td onClick={e => e.stopPropagation()}><Btn variant="subtle" size="icon" aria-label={`${canEdit ? "Edit" : "View"} ${p.companyName}`} title={canEdit ? "Open full editor" : "View details"} onClick={() => onEdit(p)}>✎</Btn></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
