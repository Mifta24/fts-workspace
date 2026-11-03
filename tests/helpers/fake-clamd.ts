import { createServer, type Server } from "node:net";

/** The marker the fake scanner treats as a virus; it is not a real signature. */
export const FAKE_VIRUS = "FAKE-VIRUS-MARKER-FOR-TESTS";

export type FakeClamd = { port: number; close: () => Promise<void> };

/**
 * A minimal clamd that speaks the INSTREAM protocol: zINSTREAM\0, then chunks of a 4-byte
 * big-endian length and the bytes, ended by a zero length. It answers "stream: OK" or
 * "stream: <name> FOUND", or, with `mode`, a scan error or silence.
 */
export async function startFakeClamd(
  mode: "normal" | "error" | "silent" = "normal",
): Promise<FakeClamd> {
  const server: Server = createServer((socket) => {
    let buffer = Buffer.alloc(0);
    let started = false;
    const body: Buffer[] = [];
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!started) {
        const header = Buffer.from("zINSTREAM\0");
        if (buffer.length < header.length) return;
        if (!buffer.subarray(0, header.length).equals(header)) return socket.destroy();
        buffer = buffer.subarray(header.length);
        started = true;
      }
      while (buffer.length >= 4) {
        const length = buffer.readUInt32BE(0);
        if (length === 0) {
          if (mode === "silent") return;
          const text = Buffer.concat(body).toString("latin1");
          const answer =
            mode === "error"
              ? "INSTREAM size limit exceeded. ERROR"
              : text.includes(FAKE_VIRUS)
                ? "stream: Fake.Test.Virus FOUND"
                : "stream: OK";
          socket.end(`${answer}\0`);
          return;
        }
        if (buffer.length < 4 + length) return;
        body.push(buffer.subarray(4, 4 + length));
        buffer = buffer.subarray(4 + length);
      }
    });
    socket.on("error", () => {});
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return {
    port: address.port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
