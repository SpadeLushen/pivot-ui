import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function SettingsHeading({ icon: Icon, children, id }: { icon: LucideIcon; children: ReactNode; id?: string }) {
  return <h3 id={id} className="settings-heading"><Icon size={16} strokeWidth={1.8} aria-hidden="true" />{children}</h3>;
}
