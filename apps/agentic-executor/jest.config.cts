const nextJest = require("next/jest.js");

const createJestConfig = nextJest({
  dir: "./",
});

const config = {
  displayName: "@agentic-executor/agentic-executor",
  preset: "../../jest.preset.js",
  transform: {
    "^(?!.*\\.(js|jsx|ts|tsx|css|json)$)": "@nx/react/plugins/jest",
  },
  moduleFileExtensions: ["ts", "tsx", "js", "jsx"],
  // The "@/*" alias lives in the app's tsconfig.json, but tsconfig.spec.json
  // extends tsconfig.base.json, which does not carry it. Without this mapping
  // any component importing "@/components/..." fails to resolve under Jest.
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  coverageDirectory: "../../coverage/apps/agentic-executor",
  testEnvironment: "jsdom",
  // Runs before the test framework and before any module import, which is what
  // the jose/TextEncoder polyfill in there needs to be useful.
  setupFiles: ["<rootDir>/jest.setup.ts"],
  // Runs after the test framework is installed - jest-dom's matchers need
  // expect to already exist, which setupFiles runs too early for.
  setupFilesAfterEnv: ["<rootDir>/jest.setup.after-env.ts"],
};

/*
 * Nothing under node_modules is skipped. CopilotKit renders markdown through
 * the unified/rehype family, and that whole ecosystem publishes ESM only, so
 * Jest's usual "skip node_modules" hands those files to the runtime unparsed
 * and the suite fails to load rather than failing a test.
 *
 * An allow-list was the first attempt and it does not hold. The ESM packages
 * number in the dozens, pnpm truncates a long directory name and replaces the
 * version with a hash, and each new transitive dependency is another entry
 * nobody knows to add until a suite stops loading. Transforming everything
 * costs about 25 seconds on a cold cache and needs no maintenance.
 *
 * This replaces what next/jest builds rather than adding to it. A file is
 * skipped when it matches any pattern, so an extra pattern can never undo one
 * that already matches.
 */
const TRANSFORM_EVERYTHING_BUT_CSS_MODULES = [
  "^.+\\.module\\.(css|sass|scss)$",
];

const jestConfig = createJestConfig(config);

module.exports = async () => {
  const resolved = await jestConfig();
  // Disable SWC path alias resolution — handled by Nx jest resolver.
  for (const value of Object.values(resolved.transform)) {
    if (Array.isArray(value) && value[1]?.resolvedBaseUrl) {
      value[1] = { ...value[1], resolvedBaseUrl: undefined };
    }
  }
  resolved.transformIgnorePatterns = TRANSFORM_EVERYTHING_BUT_CSS_MODULES;
  return resolved;
};
