/* "Today": the home screen. Tells the user what to do next and puts the next step one click away.
   It only SUGGESTS — every button opens the place where a person does the step. */
import { useMemo, useState } from "react";
import Icon from "../../ui/icons.jsx";
import { Btn } from "../../ui/kit.jsx";
import { buildToday, pipelineStats, topPlaces } from "../../lib/todayActions.js";
import { setupSteps } from "../../lib/setupSteps.js";
import { SC } from "../../constants.js";

const hello = d => { const h = d.getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };
const DISMISS = "nc_setup_dismissed";

function Chip({ children }){ return <span className="td-chip">{children}</span>; }

export default function TodayHome({ crmData, firstName, dupGroups = 0, tagsEnabled, onRun, onOpenFind, children }){
  const now = new Date();
  const { actions, allClear, more } = useMemo(() => buildToday(crmData, { now, dupGroups, tagsEnabled }), [crmData, dupGroups, tagsEnabled]); // eslint-disable-line react-hooks/exhaustive-deps
  const pipe = useMemo(() => pipelineStats(crmData), [crmData]);
  const places = useMemo(() => topPlaces(crmData, 5), [crmData]);
  const setup = useMemo(() => setupSteps(crmData), [crmData]);
  const [hideSetup, setHideSetup] = useState(() => { try { return localStorage.getItem(DISMISS) === "1"; } catch { return false; } });
  const live = crmData.filter(p => !p.doNotRespond && p.currentStatus !== "Do Not Respond");
  const stat = [
    ["In your pipeline", live.length, "users"],
    ["Ready to contact", live.filter(p => p.currentStatus === "NEW").length, "mail"],
    ["Waiting on a reply", live.filter(p => /^T[123] SENT$|NURTURE/.test(p.currentStatus) && !p.replyReceived).length, "clock"],
    ["Replies", live.filter(p => p.replyReceived).length, "reply"],
  ];
  const [focus, ...rest] = actions;
  const maxStage = Math.max(1, ...pipe.stages.map(s => s.count)), maxPlace = Math.max(1, ...places.map(p => p.count));

  return (
    <div className="td nc">
      <header className="td-head">
        <div>
          <div className="td-date">{now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</div>
          <h1 className="td-title">{hello(now)}, {firstName}</h1>
          <p className="td-sub">{allClear ? (crmData.length ? "You're all caught up. Nothing needs you right now." : "Let's find your first prospects.") : "Here's what needs you today — most important first."}</p>
        </div>
        <Btn variant="primary" icon="🔍" onClick={onOpenFind}>Find prospects</Btn>
      </header>

      <section className="td-stats" aria-label="Your numbers">
        {stat.map(([label, n, ico]) => <div key={label} className="td-stat"><Icon name={ico} size={16} /><span className="td-stat-n">{n}</span><span className="td-stat-l">{label}</span></div>)}
      </section>

      <div className="td-grid">
        <div className="td-main">
          {allClear && (
            <div className="td-card td-empty">
              <div className="td-empty-ico"><Icon name={crmData.length ? "check" : "search"} size={26} /></div>
              <h2>{crmData.length ? "All clear" : "Nothing here yet"}</h2>
              <p>{crmData.length ? "No overdue follow-ups, replies or unchecked emails. A good moment to find more prospects." : "Search nonprofits and small businesses anywhere in the U.S., or import your existing list."}</p>
              <Btn variant="primary" onClick={onOpenFind}>Find prospects</Btn>
            </div>
          )}

          {focus && (
            <article className={`td-focus tone-${focus.tone}`} aria-label="Most important">
              <div className="td-focus-top"><span className="td-badge"><Icon name={focus.icon} size={14} /> Do this first</span></div>
              <div className="td-focus-row">
                <div className="td-count">{focus.count}</div>
                <div style={{ minWidth: 0 }}>
                  <h2 className="td-focus-title">{focus.title}</h2>
                  <p className="td-detail">{focus.detail}</p>
                  {focus.sample.length > 0 && <div className="td-chips">{focus.sample.map(s => <Chip key={s}>{s}</Chip>)}{focus.count > focus.sample.length && <Chip>+{focus.count - focus.sample.length} more</Chip>}</div>}
                </div>
              </div>
              <div className="td-focus-cta">
                <Btn variant="primary" onClick={() => onRun(focus.target)}>{focus.cta} <Icon name="arrow" size={15} /></Btn>
                {focus.secondary && <Btn variant="ghost" onClick={() => onRun(focus.secondary.target)}>{focus.secondary.label}</Btn>}
              </div>
            </article>
          )}

          {rest.length > 0 && (
            <ul className="td-list" aria-label="Next best actions">
              {rest.map(a => (
                <li key={a.id} className={`td-act tone-${a.tone}`}>
                  <span className="td-ico"><Icon name={a.icon} size={18} /></span>
                  <div className="td-act-body">
                    <div className="td-act-title">{a.title}</div>
                    <div className="td-act-detail">{a.detail}</div>
                    {a.sample.length > 0 && <div className="td-chips">{a.sample.slice(0, 3).map(s => <Chip key={s}>{s}</Chip>)}</div>}
                  </div>
                  <div className="td-act-cta">
                    <Btn size="sm" variant="ghost" onClick={() => onRun(a.target)}>{a.cta.length > 26 ? a.cta.slice(0, 25) + "…" : a.cta}</Btn>
                    {a.secondary && <button type="button" className="td-link" onClick={() => onRun(a.secondary.target)}>{a.secondary.label}</button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {more > 0 && <p className="td-more">+ {more} more suggestion{more === 1 ? "" : "s"} once these are done.</p>}
          {children}
        </div>

        <aside className="td-side" aria-label="Overview">
          {!setup.complete && !hideSetup && (
            <section className="td-card td-setup">
              <div className="td-card-head"><h3>Getting started</h3><button type="button" className="td-link" onClick={() => { try { localStorage.setItem(DISMISS, "1"); } catch { /* ignore */ } setHideSetup(true); }}>Hide</button></div>
              <div className="td-progress" role="progressbar" aria-valuemin={0} aria-valuemax={setup.total} aria-valuenow={setup.done} aria-label="Setup progress"><i style={{ width: `${(setup.done / setup.total) * 100}%` }} /></div>
              <ul>
                {setup.steps.map(s => (
                  <li key={s.id} className={s.done ? "done" : ""}>
                    <span className="td-tick" aria-hidden="true">{s.done ? <Icon name="check" size={13} /> : null}</span>
                    {s.done ? <span>{s.label}</span> : <button type="button" className="td-link" onClick={() => s.to === "find" ? onOpenFind() : onRun({ type: "view", viewId: s.to })}>{s.label}</button>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="td-card">
            <div className="td-card-head"><h3>Pipeline</h3></div>
            {pipe.stages.length === 0 ? <p className="td-muted">Your stages appear here once you save prospects.</p> : pipe.stages.map(s => (
              <button type="button" key={s.status} className="td-row" onClick={() => onRun({ type: "stage", status: s.status })} title={`Show ${s.status}`}>
                <span className="td-row-l">{s.status}</span><span className="td-bar"><i style={{ width: `${(s.count / maxStage) * 100}%`, background: (SC[s.status] || {}).c || "var(--k-blue)" }} /></span><span className="td-row-n">{s.count}</span>
              </button>
            ))}
          </section>

          <section className="td-card">
            <div className="td-card-head"><h3>Where your prospects are</h3><button type="button" className="td-link" onClick={() => onRun({ type: "mode", mode: "map" })}>Open map</button></div>
            {places.length === 0 ? <p className="td-muted">Add a city and state to a prospect to see it here.</p> : places.map(p => (
              <button type="button" key={p.key} className="td-row" onClick={() => onRun({ type: "place", key: p.key })} title={`Show ${p.label} on the map`}>
                <Icon name="map" size={14} /><span className="td-row-l">{p.label}{p.precision === "state" ? " (state)" : ""}</span><span className="td-bar"><i style={{ width: `${(p.count / maxPlace) * 100}%`, background: "var(--k-gold)" }} /></span><span className="td-row-n">{p.count}</span>
              </button>
            ))}
          </section>
        </aside>
      </div>
    </div>
  );
}
