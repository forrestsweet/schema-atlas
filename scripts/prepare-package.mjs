import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const buildDirectory = new URL("../.next/", import.meta.url);

const disposablePaths = [
  "build",
  "cache",
  "dev",
  "diagnostics",
  "trace",
  "trace-build",
  "turbopack",
  "types",
];

await Promise.all(
  disposablePaths.map((path) =>
    rm(new URL(path, buildDirectory), { force: true, recursive: true }),
  ),
);

const removeSourceMaps = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await removeSourceMaps(path);
      } else if (entry.name.endsWith(".map")) {
        await rm(path, { force: true });
      }
    }),
  );
};

await removeSourceMaps(fileURLToPath(new URL("server/", buildDirectory)));
