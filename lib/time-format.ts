/**
 * Return the hour-cycle preference exposed by the browser's default locale.
 *
 * Browsers do not expose a separate, cross-platform API for the operating
 * system's short-time setting. Intl is the closest portable signal: when the
 * browser honours that setting, resolvedOptions().hour12 reflects it. Keep a
 * 24-hour fallback for environments that do not provide the signal.
 */
export function getSystemHour12(): boolean {
  try {
    const options = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions();
    return options.hour12 === true;
  } catch {
    return false;
  }
}
