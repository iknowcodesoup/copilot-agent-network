/*
 * Registers toBeInTheDocument, toBeDisabled, etc. on Jest's expect, for
 * every component test in this project. Must run through
 * setupFilesAfterEnv, not setupFiles: jest-dom's import calls
 * expect.extend(...) at module load time, and expect only exists once the
 * test framework itself has been installed, which setupFiles runs before.
 */
import "@testing-library/jest-dom";
