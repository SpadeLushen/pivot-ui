import * as parser from "eslint-parser-oxc";
import next from "@next/eslint-plugin-next";
import react from "eslint-plugin-react";
import hooks from "eslint-plugin-react-hooks";
import imports from "eslint-plugin-import";
import a11y from "eslint-plugin-jsx-a11y";
import globals from "globals";

// Syntax-only lint uses native Oxc, not TypeScript's removed JS compiler API.
// Type checking remains a separate, mandatory native TS7 build step.
const eslintConfig = [
  { ignores: [".next/**", "out/**", "build/**", "tmp/**", "next-env.d.ts"] },
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    languageOptions: {
      parser,
      ecmaVersion: "latest",
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { react, "react-hooks": hooks, import: imports, "jsx-a11y": a11y, "@next/next": next },
    settings: {
      react: { version: "detect" },
      "import/parsers": { "eslint-parser-oxc": [".ts", ".tsx", ".mts", ".cts"] },
      "import/resolver": { typescript: { alwaysTryTypes: true } },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...hooks.configs.recommended.rules,
      ...next.configs["core-web-vitals"].rules,
      "import/no-anonymous-default-export": "warn",
      "jsx-a11y/alt-text": ["warn", { elements: ["img"], img: ["Image"] }],
      "jsx-a11y/aria-props": "warn",
      "jsx-a11y/aria-proptypes": "warn",
      "jsx-a11y/aria-unsupported-elements": "warn",
      "jsx-a11y/role-has-required-aria-props": "warn",
      "jsx-a11y/role-supports-aria-props": "warn",
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none", ignoreRestSiblings: true, varsIgnorePattern: "^__(pi|pivot)" }],
      "no-unused-expressions": "warn",
      "no-restricted-syntax": ["error", { selector: "TSAnyKeyword", message: "Use a concrete type or unknown instead of any." }],
      "react/no-unknown-property": "off",
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react/jsx-no-target-blank": "off",
      // React Compiler is not enabled; keep its optimization-only checks off.
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default eslintConfig;
