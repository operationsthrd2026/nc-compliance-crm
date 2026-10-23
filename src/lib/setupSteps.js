/* A short getting-started checklist, derived from what the user has actually done (nothing is stored except "dismissed"). */
export function setupSteps(crm){
  const steps = [
    { id: "add",     label: "Add your first prospects",      done: crm.length > 0,                                              to: "find" },
    { id: "check",   label: "Check email addresses",         done: crm.some(p => !!p.emailStatus),                              to: "verify" },
    { id: "reach",   label: "Reach out to a prospect",       done: crm.some(p => p.currentStatus && p.currentStatus !== "NEW"), to: "ready" },
    { id: "result",  label: "Record a reply or a win",       done: crm.some(p => p.replyReceived || p.currentStatus === "Converted"), to: "replied" },
  ];
  const done = steps.filter(s => s.done).length;
  return { steps, done, total: steps.length, complete: done === steps.length, next: steps.find(s => !s.done) || null };
}
