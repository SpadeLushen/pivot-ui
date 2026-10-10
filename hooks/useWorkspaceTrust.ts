"use client";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { confirmWorkspaceTrust, readWorkspaceTrust } from "@/lib/workspace-pack-feedback";

type TrustState = { cwd: string; trusted: boolean | null; error: string | null };
export function useWorkspaceTrust(cwd: string, active = true) {
  const { t } = useI18n();
  const [state, setState] = useState<TrustState | null>(null);
  const [revision, setRevision] = useState(0);
  const [granting, setGranting] = useState(false);
  const generation = useRef(0), grantBusy = useRef(false);
  const trusted = active && state?.cwd === cwd ? state.trusted : null;
  const error = active && state?.cwd === cwd ? state.error : null;
  useEffect(() => {
    const epoch = ++generation.current;
    setState(null);
    if (!active || !cwd) return;
    const controller = new AbortController();
    void readWorkspaceTrust(cwd, AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]))
      .then(trusted => {
        if (epoch === generation.current) setState({ cwd, trusted, error: null });
      }).catch(reason => {
        if (epoch === generation.current) setState({ cwd, trusted: null,
          error: reason instanceof Error ? reason.message : String(reason) });
      });
    return () => { generation.current++; controller.abort(); };
  }, [cwd, active, revision]);
  const refresh = () => {
    if (grantBusy.current) return;
    generation.current++;
    setState(null); setRevision(value => value + 1);
  };
  const grant = async (): Promise<boolean> => {
    if (!active || !cwd || trusted !== false || grantBusy.current) return false;
    const epoch = generation.current;
    grantBusy.current = true; setGranting(true);
    setState({ cwd, trusted: false, error: null });
    try {
      await confirmWorkspaceTrust(cwd, t);
      if (epoch !== generation.current) return false;
      setState({ cwd, trusted: null, error: null });
      const current = await readWorkspaceTrust(cwd);
      if (epoch !== generation.current) return false;
      setState({ cwd, trusted: current, error: null });
      return current;
    } catch (reason) {
      if (epoch === generation.current) setState({ cwd, trusted: null,
        error: reason instanceof Error ? reason.message : String(reason) });
      return false;
    } finally { grantBusy.current = false; setGranting(false); }
  };
  return { trusted, error, checking: active && trusted === null && !error, granting, refresh, grant };
}
