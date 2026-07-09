/**
 * Incrementally splits a growing text buffer into complete NDJSON lines.
 *
 * Network chunks rarely align with line boundaries, so callers accumulate
 * text across `fetch` reads and call this after each chunk. Complete lines
 * are parsed as JSON and returned; any trailing partial line is returned as
 * `remainder` so the caller can prepend it to the next chunk.
 */
export function splitNdjsonLines<T = unknown>(buffer: string): { events: T[]; remainder: string } {
  const lines = buffer.split("\n");
  // The last entry is either "" (buffer ended in a newline) or an
  // incomplete line waiting for more bytes — either way, hold it back.
  const remainder = lines.pop() ?? "";

  const events: T[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    events.push(JSON.parse(trimmed) as T);
  }

  return { events, remainder };
}
