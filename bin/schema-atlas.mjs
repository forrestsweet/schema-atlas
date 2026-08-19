#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

const usage = `Schema Atlas ${packageJson.version}

Usage:
  schema-atlas [options]

Options:
  -p, --port <number>  Port to listen on (default: first available from 3000)
      --host <host>    Host to bind (default: 127.0.0.1)
      --no-open        Do not open the browser automatically
  -v, --version        Print the version
  -h, --help           Show this help
`;

const fail = (message) => {
  console.error(`Schema Atlas: ${message}`);
  process.exit(1);
};

const args = process.argv.slice(2);
let requestedPort;
let host = "127.0.0.1";
let shouldOpen = true;

for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === "-h" || argument === "--help") {
    console.log(usage);
    process.exit(0);
  }
  if (argument === "-v" || argument === "--version") {
    console.log(packageJson.version);
    process.exit(0);
  }
  if (argument === "--no-open") {
    shouldOpen = false;
    continue;
  }
  if (argument === "-p" || argument === "--port") {
    const value = args[index + 1];
    if (!value) fail(`${argument} requires a port number`);
    requestedPort = Number(value);
    index += 1;
    continue;
  }
  if (argument === "--host") {
    const value = args[index + 1];
    if (!value) fail("--host requires a value");
    host = value;
    index += 1;
    continue;
  }
  fail(`unknown option: ${argument}\n\n${usage}`);
}

if (
  requestedPort !== undefined &&
  (!Number.isInteger(requestedPort) || requestedPort < 1 || requestedPort > 65535)
) {
  fail("port must be an integer between 1 and 65535");
}

const isPortAvailable = (port) =>
  new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host, port }, () => {
      server.close(() => resolve(true));
    });
  });

const findPort = async () => {
  if (requestedPort !== undefined) {
    if (!(await isPortAvailable(requestedPort))) {
      fail(`port ${requestedPort} is already in use`);
    }
    return requestedPort;
  }
  for (let port = 3000; port <= 3010; port += 1) {
    if (await isPortAvailable(port)) return port;
  }
  fail("no available port found between 3000 and 3010");
};

const openBrowser = (url) => {
  const options = { detached: true, stdio: "ignore" };
  if (process.platform === "darwin") {
    spawn("open", [url], options).unref();
    return;
  }
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], options).unref();
    return;
  }
  spawn("xdg-open", [url], options).unref();
};

const waitUntilReady = async (url) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
};

const port = await findPort();
const browserHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
const url = `http://${browserHost}:${port}`;
const nextBin = require.resolve("next/dist/bin/next");

console.log(`\n  Schema Atlas → ${url}\n`);

const child = spawn(
  process.execPath,
  [nextBin, "start", packageRoot, "--hostname", host, "--port", String(port)],
  {
    cwd: packageRoot,
    env: { ...process.env, NODE_ENV: "production" },
    stdio: "inherit",
  },
);

if (shouldOpen) {
  void waitUntilReady(url).then((ready) => {
    if (ready) openBrowser(url);
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}

child.once("error", (error) => fail(error.message));
child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
