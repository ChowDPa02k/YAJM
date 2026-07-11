import { createReadStream, createWriteStream } from "node:fs";
import { once } from "node:events";

export async function writeJsonl<T>(file: string, rows: AsyncIterable<T> | Iterable<T>): Promise<number> {
  const stream = createWriteStream(file, { encoding: "utf8" });
  let count = 0;
  for await (const row of rows) {
    const json = JSON.stringify(row).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
    if (!stream.write(`${json}\n`)) {
      await once(stream, "drain");
    }
    count++;
  }
  stream.end();
  await once(stream, "finish");
  return count;
}

export async function* readJsonl<T>(file: string): AsyncGenerator<T> {
  const stream = createReadStream(file, { encoding: "utf8" });
  let pending = "";
  for await (const chunk of stream) {
    pending += chunk;
    let newline: number;
    while ((newline = pending.indexOf("\n")) !== -1) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        yield JSON.parse(trimmed) as T;
      }
    }
  }
  const trimmed = pending.trim();
  if (trimmed.length > 0) yield JSON.parse(trimmed) as T;
}
