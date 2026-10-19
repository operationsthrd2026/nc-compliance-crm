/* Saved searches / views.
   Production: shared team storage in Supabase (saved_searches table).
   Demo mode or pre-migration databases: this browser's localStorage. */
import { useState, useEffect, useCallback } from "react";

const KEY = scope => `nc_saved_${scope}`;
const readLocal = scope => { try { return JSON.parse(localStorage.getItem(KEY(scope)) || "[]"); } catch { return []; } };
const writeLocal = (scope, rows) => { try { localStorage.setItem(KEY(scope), JSON.stringify(rows)); } catch { /* storage full / blocked */ } };

export const localSavedApi = {
  local: true,
  async list(scope){ return readLocal(scope); },
  async save(s){
    const row = { id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, scope: s.scope, name: s.name, params: s.params, shared: false, createdByName: s.createdByName || "", createdAt: new Date().toISOString(), mine: true };
    writeLocal(s.scope, [row, ...readLocal(s.scope)]); return row;
  },
  async remove(id, scope){ writeLocal(scope, readLocal(scope).filter(r => r.id !== id)); },
};

export function useSavedSearches(scope, api, { enabled = true, currentUser } = {}){
  const [items, setItems] = useState([]); const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  const reload = useCallback(async () => {
    if (!enabled) return; setLoading(true);
    try { setItems(await api.list(scope)); setError(""); } catch (e){ setError(e.message || "Couldn't load saved searches"); }
    finally { setLoading(false); }
  }, [api, scope, enabled]);
  useEffect(() => { reload(); }, [reload]);

  const save = useCallback(async (name, params, shared = true) => {
    const row = await api.save({ scope, name: name.trim(), params, shared, createdByName: currentUser?.name || "" });
    setItems(prev => [row, ...prev]); return row;
  }, [api, scope, currentUser]);

  const remove = useCallback(async id => { await api.remove(id, scope); setItems(prev => prev.filter(r => r.id !== id)); }, [api, scope]);
  return { items, loading, error, save, remove, reload, isLocal: !!api.local };
}

/* "Not a duplicate" decisions — remembered per browser. */
const DIS_KEY = "nc_dedupe_dismissed";
export function loadDismissed(){ try { return new Set(JSON.parse(localStorage.getItem(DIS_KEY) || "[]")); } catch { return new Set(); } }
export function saveDismissed(set){ try { localStorage.setItem(DIS_KEY, JSON.stringify([...set])); } catch { /* ignore */ } }
