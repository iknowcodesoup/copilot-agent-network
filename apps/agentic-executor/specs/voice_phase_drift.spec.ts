import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { voiceRunPhases } from '../src/app/features/voices/voice_api';

/*
 * The Python VoiceRunPhase enum is the source of truth. This union is a copy,
 * and a copy drifts: a phase added on the server would reach the browser as an
 * unknown string, and the phase badge would fall back to showing it raw.
 *
 * Reading the enum straight out of the Python file keeps the check to one test
 * rather than a code generator or a runtime sync, which is more machinery than
 * eight strings that change once a year are worth.
 */
const VOICE_MODEL_PATH = join(
  __dirname,
  '../../pythonapi/pythonapi/models/voice.py'
);

function serverPhases(): string[] {
  const source = readFileSync(VOICE_MODEL_PATH, 'utf-8');
  const enumBody = source.match(
    /class VoiceRunPhase\(StrEnum\):([\s\S]*?)\n\n\n/
  );
  if (!enumBody) {
    throw new Error(`Could not find VoiceRunPhase in ${VOICE_MODEL_PATH}`);
  }
  return [...enumBody[1].matchAll(/^\s+[A-Z_]+ = "([a-z_]+)"$/gm)].map(
    (match) => match[1]
  );
}

describe('voice phase drift', () => {
  it('should find the phases the server defines', () => {
    // guards the parser itself: an empty match would pass every check below
    expect(serverPhases().length).toBeGreaterThan(0);
  });

  it('should cover every phase the server can return', () => {
    const missing = serverPhases().filter(
      (phase) => !(voiceRunPhases as readonly string[]).includes(phase)
    );

    expect(missing).toEqual([]);
  });

  it('should not claim phases the server never returns', () => {
    const server = serverPhases();
    const extra = voiceRunPhases.filter((phase) => !server.includes(phase));

    expect(extra).toEqual([]);
  });
});
