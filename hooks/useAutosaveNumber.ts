import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type FocusEvent } from "react";

export function useAutosaveNumber(value: number, save: (next: number) => Promise<void>, zeroOnBlur?: number) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const version = useRef(0);
  const submitted = useRef(-1);
  const pending = useRef<Promise<void> | null>(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const latest = useRef(value);
  useLayoutEffect(() => { latest.current = value; }, [value]);

  function commit(next: number) {
    const id = version.current;
    if (submitted.current === id) return;
    if (!pending.current && next === latest.current) { setDraft(null); return; }
    submitted.current = id;
    const task = (pending.current ?? Promise.resolve()).then(() => save(next)).then(() => {
      if (id === version.current) setDraft(null);
    }, () => {
      if (id === version.current) { submitted.current = -1; setError(true); }
    });
    pending.current = task;
    void task.then(() => { if (pending.current === task) pending.current = null; });
  }

  function reset() {
    clearTimeout(timer.current);
    version.current++;
    setDraft(null); setError(false);
  }

  return { error, reset, settle: () => pending.current, input: {
    value: draft ?? value,
    onChange({ currentTarget: el }: ChangeEvent<HTMLInputElement>) {
      clearTimeout(timer.current);
      version.current++;
      setDraft(el.value); setError(false);
      const next = el.valueAsNumber;
      if (el.validity.valid && next > 0) timer.current = setTimeout(() => commit(next), 1000);
    },
    onBlur({ currentTarget: el }: FocusEvent<HTMLInputElement>) {
      clearTimeout(timer.current);
      if (draft === null) return;
      if (!el.reportValidity()) return;
      const next = el.valueAsNumber;
      if (next === 0 && zeroOnBlur !== undefined) setDraft(String(zeroOnBlur));
      setError(false);
      commit(next === 0 && zeroOnBlur !== undefined ? zeroOnBlur : next);
    },
  } };
}
