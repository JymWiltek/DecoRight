import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Supabase Edge Functions run on the Deno runtime, not Node, and
    // import via `npm:` / `https:` specifiers that the Node-flavored
    // TS server + ESLint plugins can't resolve. Lint config also has
    // no Deno globals (Deno.env, Deno.serve, std/http). The pure
    // logic lives in worker.ts (testable from Node, included in
    // `tsc --noEmit`); the Deno entrypoints in this directory carry
    // a top-of-file `// @ts-nocheck` and would otherwise trip
    // `@typescript-eslint/ban-ts-comment` for a problem the comment
    // is itself solving. This is a runtime mismatch, not an
    // exception — Deno code shouldn't go through Node's linter.
    "supabase/functions/**",
  ]),
]);

export default eslintConfig;
