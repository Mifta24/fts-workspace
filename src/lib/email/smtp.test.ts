import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createSmtpSender, createSmtpTransport } from "@/lib/email/smtp";

/** A tiny SMTP server that records what it is sent; enough to see the real wire format. */
function startServer(options: { refuseRecipient?: boolean } = {}) {
  const received: string[] = [];
  const server = net.createServer((socket) => {
    let buffer = "";
    let data = "";
    let inData = false;
    socket.write("220 test ESMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      for (let end = buffer.indexOf("\r\n"); end >= 0; end = buffer.indexOf("\r\n")) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            received.push(data);
            data = "";
            socket.write("250 queued\r\n");
          } else {
            data += `${line}\n`;
          }
          continue;
        }
        const command = line.toUpperCase();
        if (command.startsWith("RCPT TO") && options.refuseRecipient) {
          socket.write("550 no such user\r\n");
        } else if (command === "DATA") {
          inData = true;
          socket.write("354 go ahead\r\n");
        } else if (command === "QUIT") {
          socket.end("221 bye\r\n");
        } else {
          socket.write("250 ok\r\n");
        }
      }
    });
  });
  return new Promise<{ url: string; received: string[]; close: () => Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      resolve({
        url: `smtp://127.0.0.1:${port}`,
        received,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

let running: { close: () => Promise<void> } | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

const message = {
  to: "pat@example.test",
  subject: "Verify your FTS Workspace email",
  text: "Confirm your email address:\nhttps://app.example.test/verify?token=abc",
};

describe("SMTP email", () => {
  it("sends a plain-text message with the configured sender over a real SMTP conversation", async () => {
    const server = (running = await startServer());
    const send = createSmtpSender(
      createSmtpTransport(server.url),
      "FTS Workspace <no-reply@app.example.test>",
    );
    await send(message);

    expect(server.received).toHaveLength(1);
    const raw = server.received[0]!;
    expect(raw).toMatch(/^From: FTS Workspace <no-reply@app\.example\.test>$/m);
    expect(raw).toMatch(/^To: pat@example\.test$/m);
    expect(raw).toMatch(/^Subject: Verify your FTS Workspace email$/m);
    expect(raw).toMatch(/^Content-Type: text\/plain/m);
    expect(raw).not.toMatch(/text\/html/i);
    expect(raw).toContain("https://app.example.test/verify?token=abc");
  });

  it("reports a refusal from the mail server as an error", async () => {
    const server = (running = await startServer({ refuseRecipient: true }));
    const send = createSmtpSender(createSmtpTransport(server.url), "no-reply@app.example.test");
    await expect(send(message)).rejects.toThrow();
    expect(server.received).toEqual([]);
  });

  it("reports an unreachable server as an error instead of hanging", async () => {
    const server = await startServer();
    const { url } = server;
    await server.close(); // nothing listens there any more
    const send = createSmtpSender(createSmtpTransport(url), "no-reply@app.example.test");
    await expect(send(message)).rejects.toThrow();
  });

  it("refuses line breaks in the recipient or the subject, so headers cannot be injected", async () => {
    const server = (running = await startServer());
    const send = createSmtpSender(createSmtpTransport(server.url), "no-reply@app.example.test");
    await expect(
      send({ ...message, to: "pat@example.test\r\nBcc: victim@example.test" }),
    ).rejects.toThrow(/line breaks/);
    await expect(send({ ...message, subject: "Hello\nBcc: victim@example.test" })).rejects.toThrow(
      /line breaks/,
    );
    expect(server.received).toEqual([]);
  });
});
