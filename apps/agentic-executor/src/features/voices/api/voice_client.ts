"use client";

import { voiceApiBase } from "./endpoints";

/*
 * FastAPI speaks snake_case and this app speaks camelCase. Converting at the
 * boundary keeps every component in one convention, so no component has to
 * remember which side of the wire a field came from.
 */
export function toCamelCase(value: string): string {
  return value.replace(/_([a-z0-9])/g, (_, character) =>
    character.toUpperCase(),
  );
}

function toSnakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`);
}

/*
 * Fields whose object values are keyed by data, not by field name. Their keys
 * must survive the converter untouched.
 *
 * toCamelCase matches _[a-z0-9], so it rewrites a speaker label like
 * SPEAKER_00 to SPEAKER00. Any map keyed by one of those has to be listed
 * here, or a value stored correctly reads back under a key nothing matches.
 */
const DATA_KEYED_MAPS: ReadonlySet<string> = new Set([
  "speaker_map",
  "speakerMap",
]);

export function convertKeys(
  value: unknown,
  convert: (key: string) => string,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => convertKeys(item, convert));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        convert(key),
        DATA_KEYED_MAPS.has(key) ? entry : convertKeys(entry, convert),
      ]),
    );
  }
  return value;
}

export class VoiceApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "VoiceApiError";
  }
}

export async function request<T>(
  path: string,
  init?: RequestInit,
  base: string = voiceApiBase,
): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: init?.body
      ? { "Content-Type": "application/json", ...init?.headers }
      : init?.headers,
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = body.detail ?? detail;
    } catch {
      // a non-JSON error body is still worth reporting by status alone
    }
    throw new VoiceApiError(detail, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return convertKeys(await response.json(), toCamelCase) as T;
}

export function jsonBody(payload: unknown): string {
  return JSON.stringify(convertKeys(payload, toSnakeCase));
}
