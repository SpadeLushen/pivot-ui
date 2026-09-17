import type { Metadata } from "next";
import { Noto_Sans_Mono } from "next/font/google";
import "katex/dist/katex.min.css";
import "@xterm/xterm/css/xterm.css";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n";
import { PreferencesProvider } from "@/lib/preferences-context";
import { readPreferences } from "@/lib/preferences";

const notoSansMono = Noto_Sans_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-noto-mono",
  display: "swap",
});

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pivot UI ",
  description: "Pi Coding Agent Web Interface",
  icons: {
    icon: "/pi-agent-mark.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const initialPreferences = readPreferences();
  const themeClass = initialPreferences.theme === "light" ? "" : initialPreferences.theme;
  return (
    <html lang={initialPreferences.locale} translate="no" className={`${notoSansMono.variable} ${themeClass} notranslate`} suppressHydrationWarning>
      <head>
        <meta name="google" content="notranslate" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var h=window.__REACT_DEVTOOLS_GLOBAL_HOOK__;if(h&&typeof h.onCommitFiberRoot!=="function")h.onCommitFiberRoot=function(){}}catch(e){}})();`,
          }}
        />
      </head>
      <body translate="no" className="notranslate" style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
        <PreferencesProvider initialPreferences={initialPreferences}>
          <I18nProvider>
            {children}
          </I18nProvider>
        </PreferencesProvider>
      </body>
    </html>
  );
}
