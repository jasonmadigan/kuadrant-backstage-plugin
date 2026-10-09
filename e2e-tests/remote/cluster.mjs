import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const root = fileURLToPath(new URL("../../", import.meta.url));
const stateDir =
  process.env.E2E_REMOTE_STATE_DIR || path.join(root, ".e2e-remote");
const stateFile = path.join(stateDir, "state.json");
const namespace = "kuadrant-backstage-e2e";
const ownerLabel = "kuadrant.io/backstage-e2e-run";
let context;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "inherit"],
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args[0]} failed`);
  return result.stdout?.trim();
}

function kube(args, options) {
  return run(
    "kubectl",
    ["--context", context, "--request-timeout=30s", ...args],
    options,
  );
}

function get(resource, name) {
  const output = kube([
    "get",
    resource,
    name,
    "--ignore-not-found",
    "-o",
    "json",
  ]);
  return output ? JSON.parse(output) : undefined;
}

function readYaml(file) {
  return yaml
    .loadAll(fs.readFileSync(path.join(root, file), "utf8"))
    .filter(Boolean);
}

function fixtures() {
  const resources = [
    ...readYaml("kuadrant-dev-setup/demo/toystore-demo.yaml"),
    ...readYaml("kuadrant-dev-setup/demo/gamestore-demo.yaml"),
    ...readYaml("kuadrant-dev-setup/demo/additional-demos.yaml"),
    ...readYaml("e2e-tests/remote/mcp-gateway.yaml"),
    ...readYaml("oinc/manifests/mcp-demo.yaml"),
  ];
  const namespaces = new Map(
    resources
      .filter((r) => r.kind === "Namespace")
      .map((r) => [r.metadata.name, r]),
  );
  namespaces.set(namespace, {
    apiVersion: "v1",
    kind: "Namespace",
    metadata: { name: namespace },
  });
  // Pre-create all persona namespaces so cleanup also owns keys made by the UI.
  for (const user of [
    "admin",
    "owner1",
    "owner2",
    "consumer1",
    "consumer2",
    "guest",
  ]) {
    const hash = createHash("sha256")
      .update(`user:default/${user}`)
      .digest("hex")
      .slice(0, 8);
    const name = `kuadrant-${user}-${hash}`;
    namespaces.set(name, {
      apiVersion: "v1",
      kind: "Namespace",
      metadata: {
        name,
        labels: { "devportal.kuadrant.io/consumer-namespace": "true" },
      },
    });
  }
  const [role] = readYaml("kuadrant-dev-setup/rbac/rhdh-cluster-role.yaml");
  role.metadata.name = namespace;
  const binding = {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "ClusterRoleBinding",
    metadata: { name: namespace },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "ClusterRole",
      name: namespace,
    },
    subjects: [{ kind: "ServiceAccount", name: "rhdh", namespace }],
  };
  const namespaced = resources.filter((r) => r.kind !== "Namespace");
  for (const resource of namespaced) {
    if (resource.metadata.namespace === "gateway-system")
      resource.metadata.namespace = namespace;
    for (const parent of resource.spec?.parentRefs || []) {
      if (
        parent.name === "mcp-gateway" &&
        parent.namespace === "gateway-system"
      )
        parent.namespace = namespace;
    }
  }
  namespaced.push({
    apiVersion: "v1",
    kind: "ServiceAccount",
    metadata: { name: "rhdh", namespace },
  });
  return { roots: [...namespaces.values(), role, binding], namespaced };
}

function save(state) {
  fs.writeFileSync(`${stateFile}.tmp`, JSON.stringify(state, null, 2), {
    mode: 0o600,
  });
  fs.renameSync(`${stateFile}.tmp`, stateFile);
}

function identity() {
  const config = JSON.parse(kube(["config", "view", "--minify", "-o", "json"]));
  const system = get("namespace", "kube-system");
  if (!system)
    throw new Error("Cannot identify the cluster's kube-system namespace");
  return {
    server: config.clusters[0].cluster.server,
    clusterUID: system.metadata.uid,
  };
}

function load() {
  if (!fs.existsSync(stateFile))
    throw new Error(
      "No remote setup recorded; run make remote-setup. If fixtures remain from a lost checkout, run make remote-teardown first",
    );
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  context = run("kubectl", ["config", "current-context"]);
  const current = identity();
  if (
    context !== state.context ||
    current.server !== state.server ||
    current.clusterUID !== state.clusterUID
  ) {
    throw new Error(
      `Select the setup context '${state.context}' and its original cluster before continuing`,
    );
  }
  return state;
}

function assertOwned(state, resource) {
  const live = get(resource.kind, resource.metadata.name);
  if (
    live &&
    (live.metadata.labels?.[ownerLabel] !== state.runID ||
      (resource.metadata.uid && live.metadata.uid !== resource.metadata.uid))
  ) {
    throw new Error(
      `Refusing to touch replaced or unowned ${resource.kind}/${resource.metadata.name}`,
    );
  }
  return live;
}

function checkReady(state) {
  if (!state.ready)
    throw new Error(
      "Setup did not finish; inspect the error and run make remote-teardown before retrying",
    );
  for (const resource of state.roots) {
    if (!assertOwned(state, resource))
      throw new Error(
        `Missing fixture ${resource.kind}/${resource.metadata.name}`,
      );
  }
  console.log(`Remote cluster: ${state.server} (OpenShift ${state.version})`);
}

async function checkBackend(state) {
  const baseURL = "http://localhost:7007";
  const auth = await fetch(`${baseURL}/api/auth/guest/refresh`, {
    method: "POST",
    signal: AbortSignal.timeout(10000),
  });
  if (!auth.ok)
    throw new Error(
      `Local Backstage authentication returned HTTP ${auth.status}`,
    );
  const token = (await auth.json()).backstageIdentity?.token;
  if (!token) throw new Error("Local Backstage did not return a guest token");
  const response = await fetch(`${baseURL}/api/kuadrant/apiproducts`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new Error(
      `Backstage cannot read the cluster: HTTP ${response.status}`,
    );
  const products = await response.json();
  const fixture = products.items?.find(
    (product) =>
      product.metadata.namespace === "toystore" &&
      product.metadata.name === "toystore-api",
  );
  if (fixture?.metadata.labels?.[ownerLabel] !== state.runID) {
    throw new Error(
      "Backstage is not connected to this run's remote fixtures; stop the app and use make remote-dev",
    );
  }
  console.log(
    "Verified: the Backstage backend reads this run's remote fixtures.",
  );
}

function setup() {
  if (fs.existsSync(stateDir))
    throw new Error(
      "Remote setup already recorded; use make remote-teardown before another setup",
    );
  context = run("kubectl", ["config", "current-context"]);
  const cluster = identity();
  const version = get("clusterversion", "version")?.status?.desired?.version;
  if (!version) throw new Error("An existing OpenShift cluster is required");
  console.log(
    `Preparing fixtures on ${cluster.server} (OpenShift ${version}, context ${context})`,
  );
  const kuadrants = JSON.parse(
    kube(["get", "kuadrants.kuadrant.io", "-A", "-o", "json"]),
  );
  if (
    !kuadrants.items.some(
      (k) => k.spec?.components?.developerPortal?.enabled === true,
    )
  ) {
    throw new Error(
      "The installed Kuadrant must already have spec.components.developerPortal.enabled=true",
    );
  }
  for (const name of [
    "apiproducts.devportal.kuadrant.io",
    "apikeys.devportal.kuadrant.io",
    "apikeyrequests.devportal.kuadrant.io",
    "apikeyapprovals.devportal.kuadrant.io",
    "planpolicies.extensions.kuadrant.io",
    "authpolicies.kuadrant.io",
    "ratelimitpolicies.kuadrant.io",
    "gateways.gateway.networking.k8s.io",
    "httproutes.gateway.networking.k8s.io",
    "mcpgatewayextensions.mcp.kuadrant.io",
    "mcpserverregistrations.mcp.kuadrant.io",
  ]) {
    if (!get("crd", name)) throw new Error(`Required CRD missing: ${name}`);
  }
  kube([
    "wait",
    "gatewayclass/istio",
    "--for=condition=Accepted=True",
    "--timeout=30s",
  ]);
  const { roots, namespaced } = fixtures();
  for (const resource of roots) {
    if (get(resource.kind, resource.metadata.name)) {
      throw new Error(
        `Fixture ${resource.kind}/${resource.metadata.name} already exists; refusing to overwrite it. If the checkout's state was lost, run make remote-teardown`,
      );
    }
  }
  const state = {
    ...cluster,
    context,
    version,
    runID: randomUUID(),
    roots: [],
    ready: false,
  };
  fs.mkdirSync(stateDir, { mode: 0o700 });
  save(state);
  for (const resource of [...roots, ...namespaced]) {
    resource.metadata.labels = {
      ...resource.metadata.labels,
      [ownerLabel]: state.runID,
    };
    if (!resource.metadata.namespace) {
      // Record intent before creating, so interrupted setup remains cleanable.
      state.roots.push(resource);
      save(state);
    }
    const created = JSON.parse(
      kube(["create", "-f", "-", "-o", "json"], {
        input: JSON.stringify(resource),
      }),
    );
    if (!resource.metadata.namespace) {
      resource.metadata.uid = created.metadata.uid;
      save(state);
    }
    console.log(`Created ${resource.kind}/${resource.metadata.name}`);
  }
  for (const resource of namespaced.filter((r) => r.kind === "Gateway")) {
    kube(
      [
        "wait",
        `gateway/${resource.metadata.name}`,
        "-n",
        resource.metadata.namespace,
        "--for=condition=Programmed=True",
        "--timeout=300s",
      ],
      { stdio: "inherit" },
    );
  }
  state.ready = true;
  save(state);
  console.log(
    "Fixtures ready. Run make remote-dev, then make e2e-remote in another terminal.",
  );
}

function recover() {
  context = run("kubectl", ["config", "current-context"]);
  const state = { ...identity(), context, roots: [], ready: false };
  for (const resource of fixtures().roots) {
    const live = get(resource.kind, resource.metadata.name);
    if (!live) continue;
    const runID = live.metadata.labels?.[ownerLabel];
    if (!runID || !live.metadata.uid)
      throw new Error(
        `Cannot recover unowned ${resource.kind}/${resource.metadata.name}`,
      );
    if (state.runID && state.runID !== runID)
      throw new Error("Fixtures belong to different runs; refusing recovery");
    state.runID = runID;
    state.roots.push({
      kind: resource.kind,
      metadata: { name: resource.metadata.name, uid: live.metadata.uid },
    });
  }
  if (!state.roots.length)
    throw new Error("No remote fixtures found; run make remote-setup");
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  save(state);
  console.log(
    `Recovered cleanup record for run ${state.runID} on ${state.server}.`,
  );
  return state;
}

function teardown(state) {
  // Validate the entire inventory before deleting anything.
  for (const resource of state.roots) assertOwned(state, resource);
  for (const resource of [...state.roots].reverse()) {
    kube(
      [
        "delete",
        resource.kind,
        resource.metadata.name,
        "--ignore-not-found",
        "--timeout=180s",
      ],
      { stdio: "inherit" },
    );
  }
  fs.rmSync(stateDir, { recursive: true });
  console.log(
    "Removed this run's fixtures; existing cluster and installed operators retained.",
  );
}

async function checkPort(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () =>
      reject(
        new Error(
          `Port ${port} is in use; stop the existing local app/Dex before make remote-dev`,
        ),
      ),
    );
    server.listen(port, () => server.close(resolve));
  });
}

try {
  const action = process.argv[2];
  if (!["setup", "dev", "check", "teardown"].includes(action))
    throw new Error("Usage: cluster.mjs setup|dev|check|teardown");
  if (action === "setup") {
    setup();
  } else if (action === "teardown") {
    teardown(fs.existsSync(stateFile) ? load() : recover());
  } else {
    const state = load();
    checkReady(state);
    if (action === "check") await checkBackend(state);
    if (action === "dev") {
      for (const port of [3000, 7007, 5556]) await checkPort(port);
      const token = kube([
        "create",
        "token",
        "rhdh",
        "-n",
        namespace,
        "--duration=8h",
      ]);
      run("yarn", ["dev"], {
        stdio: "inherit",
        env: {
          ...process.env,
          K8S_URL: state.server,
          K8S_CLUSTER_TOKEN: token,
          BROWSER: "none",
        },
      });
    }
  }
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
