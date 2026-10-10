"use strict";

// postinstall: recreate the Turbopack runtime dependency aliases recorded by
// scripts/prepare-package-runtime.js.
//
// This must never fail the installation. pnpm (and some npm setups) run this
// script while the package is being built inside the package manager's own
// store, where the dependencies are not linked yet. In that case the aliases
// are restored later, when bin/pivot-ui.js launches the server.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("node:path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { restoreRuntimeAliases } = require("./pivot-runtime-aliases");

const projectRoot = path.resolve(__dirname, "..");

const { restored, missing } = restoreRuntimeAliases(projectRoot);

if (restored.length > 0) {
  console.log(`Restored ${restored.length} Turbopack dependency aliases.`);
}

if (missing.length > 0) {
  console.warn(
    `Skipped ${missing.length} Turbopack dependency alias(es) because the dependencies are not linked yet ` +
      `(${missing.join(", ")}). They will be restored automatically at startup.`,
  );
}
