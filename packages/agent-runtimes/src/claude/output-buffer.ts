/** Default size of the replay buffer: about the last 200 KB of terminal output. */
export const DEFAULT_OUTPUT_BUFFER_CHARS = 200_000;

/**
 * Keeps the latest terminal output for whoever connects late. It drops whole chunks from the
 * front, so a replay never starts in the middle of a chunk (nor of an escape sequence the chunk
 * opened and closed).
 */
export class OutputBuffer {
  private chunks: string[] = [];
  private size = 0;

  constructor(private readonly maxChars: number = DEFAULT_OUTPUT_BUFFER_CHARS) {}

  push(chunk: string): void {
    this.chunks.push(chunk);
    this.size += chunk.length;
    while (this.size > this.maxChars && this.chunks.length > 1) {
      this.size -= this.chunks.shift()?.length ?? 0;
    }
  }

  snapshot(): string {
    return this.chunks.join("");
  }
}
