/*
 * jsdom leaves out the text encoding globals that Node has. CopilotKit reaches
 * @segment/analytics-node, which reaches jose, which reads TextEncoder at
 * import time - so the failure is a suite that will not load, not a test that
 * fails. This runs before any test module, which is the only place the
 * assignment is early enough to help.
 */
import { TextDecoder, TextEncoder } from "node:util";

Object.assign(globalThis, { TextDecoder, TextEncoder });
