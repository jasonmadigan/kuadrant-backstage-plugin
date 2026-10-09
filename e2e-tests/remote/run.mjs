import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

try {
  if (!process.env.BASE_URL)
    throw new Error(
      "Set BASE_URL to the deployed Backstage URL: make e2e-remote BASE_URL=https://backstage.example.com",
    );
  let url;
  try {
    url = new URL(process.env.BASE_URL);
  } catch {
    throw new Error("BASE_URL must be an absolute HTTP or HTTPS URL");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "BASE_URL must be the Backstage origin (HTTP or HTTPS, without credentials, a path, query or fragment)",
    );

  console.log(`Backstage under test: ${url.origin}`);
  const result = spawnSync("yarn", ["test", ...process.argv.slice(2)], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    stdio: "inherit",
    env: {
      ...process.env,
      BASE_URL: url.origin,
      PLAYWRIGHT_HTML_OPEN: "never",
    },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
