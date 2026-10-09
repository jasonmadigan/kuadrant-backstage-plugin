import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import yaml from "js-yaml";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const dexConfig = yaml.load(
  fs.readFileSync(
    path.join(repo, "kuadrant-dev-setup/dex/config.yaml"),
    "utf8",
  ),
);
const deployed = "https://rhdh.example.com";
const issuer = "https://dex-kuadrant-backstage-e2e.apps.release-test.example";

// Component: integration. These tests use a fake kubectl and never contact a cluster.
function harness(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backstage-remote-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dbFile = path.join(dir, "cluster.json");
  const logFile = path.join(dir, "commands.jsonl");
  const stateDir = path.join(dir, "state");
  const fetchMock = path.join(dir, "fetch.mjs");
  fs.writeFileSync(
    fetchMock,
    `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import timers from 'node:timers/promises';
import yaml from ${JSON.stringify(import.meta.resolve("js-yaml"))};
// retry delays elapse at once
timers.setTimeout = async () => {};
syncBuiltinESMExports();
let unavailable = Number(process.env.FAKE_DEX_UNAVAILABLE || 0);
globalThis.fetch = async url => {
  if (url.endsWith('/.well-known/openid-configuration')) {
    if (process.env.FAKE_DEX_FETCH_ERROR)
      throw new TypeError('fetch failed', { cause: new Error(process.env.FAKE_DEX_FETCH_ERROR) });
    // stands in for the router: the route for this host, backed by the deployed dex config
    const db = JSON.parse(fs.readFileSync(process.env.FAKE_DB, 'utf8'));
    const route = Object.values(db).find(r => r.kind === 'Route' && r.spec.host === new URL(url).host);
    if (!route || unavailable-- > 0) return { ok: false, status: 503 };
    const config = yaml.load(db['configmap/' + route.metadata.namespace + '/dex-config'].data['config.yaml']);
    return { ok: true, status: 200, json: async () => ({ issuer: process.env.FAKE_DEX_ISSUER || config.issuer }) };
  }
  return {
    ok: true,
    json: async () => url.endsWith('/refresh')
      ? { backstageIdentity: { token: 'test-token' } }
      : { items: [{ metadata: {
          name: 'toystore-api', namespace: 'toystore',
          labels: { 'kuadrant.io/backstage-e2e-run': process.env.FAKE_BACKEND_RUN_ID || JSON.parse(fs.readFileSync(process.env.E2E_REMOTE_STATE_DIR + '/state.json', 'utf8')).runID }
        } }] }
  };
};
`,
  );
  fs.writeFileSync(dbFile, "{}");
  fs.writeFileSync(logFile, "");
  fs.writeFileSync(
    path.join(dir, "kubectl"),
    `#!${process.execPath}
const fs = require('node:fs');
let args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(args) + '\\n');
if (args[0] === '--context') args = args.slice(3);
const db = JSON.parse(fs.readFileSync(process.env.FAKE_DB, 'utf8'));
const key = (kind, name, ns = '') => [kind.toLowerCase(), ns, name].join('/');
const missing = (process.env.FAKE_MISSING_CRD || '').split(',');
let output;
if (args[0] === 'config' && args[1] === 'current-context') {
  output = process.env.FAKE_CONTEXT || 'release-test';
} else if (args[0] === 'config' && args[1] === 'view') {
  output = { clusters: [{ cluster: { server: 'https://release-test.example:6443' } }] };
} else if (args[0] === 'get' && args[1] === 'namespace' && args[2] === 'kube-system') {
  output = { metadata: { uid: process.env.FAKE_CLUSTER_UID || 'original-cluster' } };
} else if (args[0] === 'get' && args[1] === 'clusterversion') {
  output = { status: { desired: { version: '4.21.35' } } };
} else if (args[0] === 'get' && args[1] === 'ingresses.config.openshift.io') {
  output = { spec: { domain: process.env.FAKE_INGRESS_DOMAIN ?? 'apps.release-test.example' } };
} else if (args[0] === 'get' && args[1] === 'kuadrants.kuadrant.io') {
  output = { items: [{ spec: { components: { developerPortal: { enabled: true } } } }] };
} else if (args[0] === 'get' && args[1] === 'crd') {
  output = missing.includes(args[2]) ? '' : { metadata: { name: args[2] } };
} else if (args[0] === 'get') {
  output = db[key(args[1], args[2])] || '';
} else if (args[0] === 'create' && args[1] === '-f') {
  const obj = JSON.parse(fs.readFileSync(0, 'utf8'));
  if (obj.kind === process.env.FAKE_FAIL_KIND) process.exit(1);
  const id = key(obj.kind, obj.metadata.name, obj.metadata.namespace);
  if (db[id]) process.exit(1);
  obj.metadata.uid = id;
  db[id] = obj;
  output = obj;
} else if (args[0] === 'delete' && args.includes('-l')) {
  const types = args[1].split(',');
  if (types.some(type => !type || missing.includes(type))) {
    console.error('error: the server does not have resource type ' + args[1]);
    process.exit(1);
  }
  const ns = args[args.indexOf('-n') + 1];
  const [label, value] = args[args.indexOf('-l') + 1].split('=');
  const deleted = [];
  for (const [id, obj] of Object.entries(db)) {
    const resource = obj.kind.toLowerCase() + '.' + obj.apiVersion?.split('/')[0];
    if (types.includes(resource.replace('.', 's.')) && obj.metadata.namespace === ns && obj.metadata.labels?.[label] === value) {
      delete db[id];
      deleted.push(resource + ' "' + obj.metadata.name + '" deleted');
    }
  }
  output = deleted.join('\\n') || 'No resources found';
} else if (args[0] === 'delete') {
  if (args[1] === process.env.FAKE_FAIL_DELETE_KIND) process.exit(1);
  // mcp finalizers cannot complete once their namespace is terminating
  if (args[1] === 'Namespace' && Object.values(db).some(obj => obj.kind.startsWith('MCP') && obj.metadata.namespace === args[2])) {
    console.error('error: timed out waiting for namespace ' + args[2]);
    process.exit(1);
  }
  delete db[key(args[1], args[2])];
  if (args[1] === 'Namespace') {
    for (const [id, obj] of Object.entries(db)) {
      if (obj.metadata.namespace === args[2]) delete db[id];
    }
  }
} else if (!['wait', 'rollout'].includes(args[0])) {
  console.error('Unexpected kubectl invocation: ' + args.join(' '));
  process.exit(1);
}
fs.writeFileSync(process.env.FAKE_DB, JSON.stringify(db));
if (output) console.log(typeof output === 'string' ? output : JSON.stringify(output));
`,
    { mode: 0o755 },
  );
  const env = {
    ...process.env,
    PATH: `${dir}${path.delimiter}${process.env.PATH}`,
    KUBECONFIG: path.join(dir, "unused-kubeconfig"),
    E2E_REMOTE_STATE_DIR: stateDir,
    BASE_URL: "",
    FAKE_DB: dbFile,
    FAKE_LOG: logFile,
  };
  return {
    stateDir,
    appConfigFile: path.join(stateDir, "rhdh-app-config.yaml"),
    state: () =>
      JSON.parse(fs.readFileSync(path.join(stateDir, "state.json"), "utf8")),
    read: () => JSON.parse(fs.readFileSync(dbFile, "utf8")),
    write: (db) => fs.writeFileSync(dbFile, JSON.stringify(db)),
    calls: () =>
      fs
        .readFileSync(logFile, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse),
    run: (action, overrides = {}) =>
      spawnSync(
        process.execPath,
        [
          "--import",
          fetchMock,
          new URL("cluster.mjs", import.meta.url).pathname,
          action,
        ],
        {
          env: { ...env, ...overrides },
          encoding: "utf8",
        },
      ),
    make: (args) =>
      spawnSync("make", args, {
        cwd: repo,
        env: { ...env, NODE_OPTIONS: `--import=${fetchMock}` },
        encoding: "utf8",
      }),
  };
}

const isDex = (resource) => /^dex(-|$)/.test(resource.metadata.name);

test("refuses fixture collisions before any create", (t) => {
  const h = harness(t);
  h.write({ "namespace//toystore": { metadata: { name: "toystore" } } });
  const result = h.run("setup");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /already exists/);
  assert.ok(!h.calls().some((call) => call.includes("create")));
  assert.ok(!fs.existsSync(h.stateDir));
});

test("missing MCP APIs fail without creating fixtures", (t) => {
  const h = harness(t);
  const result = h.run("setup", {
    FAKE_MISSING_CRD: "mcpserverregistrations.mcp.kuadrant.io",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Required CRD missing/);
  assert.ok(!h.calls().some((call) => call.includes("create")));
});

test("setup and cleanup own fixtures without changing installed operators", (t) => {
  const h = harness(t);
  const unrelated = { kind: "Namespace", metadata: { name: "existing-work" } };
  h.write({ "namespace//existing-work": unrelated });
  const setup = h.run("setup");
  assert.equal(setup.status, 0, setup.stderr);
  const resources = Object.values(h.read());
  assert.ok(!JSON.stringify(resources).includes("oinc.io/metallb"));
  const role = resources.find((r) => r.kind === "ClusterRole");
  assert.equal(role.metadata.name, "kuadrant-backstage-e2e");
  assert.ok(resources.some((r) => r.kind === "MCPServerRegistration"));
  assert.ok(
    !resources.some(
      (r) => r.kind === "CustomResourceDefinition" || r.kind === "Kuadrant",
    ),
  );
  const teardown = h.run("teardown");
  assert.equal(teardown.status, 0, teardown.stderr);
  assert.deepEqual(h.read(), { "namespace//existing-work": unrelated });
  assert.ok(!fs.existsSync(h.stateDir));
});

test("partial setup can be cleaned using the saved inventory", (t) => {
  const h = harness(t);
  assert.equal(h.run("setup", { FAKE_FAIL_KIND: "APIProduct" }).status, 1);
  assert.ok(fs.existsSync(h.stateDir));
  assert.equal(h.run("teardown").status, 0);
  assert.deepEqual(h.read(), {});
});

for (const partial of [false, true]) {
  test(`cleanup recovers lost state after ${partial ? "partial" : "complete"} setup`, (t) => {
    const h = harness(t);
    const unrelated = {
      kind: "Namespace",
      metadata: { name: "existing-work" },
    };
    h.write({ "namespace//existing-work": unrelated });
    const setup = h.run(
      "setup",
      partial ? { FAKE_FAIL_KIND: "APIProduct" } : {},
    );
    assert.equal(setup.status, partial ? 1 : 0, setup.stderr);
    fs.rmSync(h.stateDir, { recursive: true });

    const collision = h.run("setup");
    assert.equal(collision.status, 1);
    assert.match(collision.stderr, /make remote-teardown/);

    const before = h.calls().length;
    const teardown = h.run("teardown");
    assert.equal(teardown.status, 0, teardown.stderr);
    assert.match(teardown.stdout, /Recovered cleanup record/);
    assert.deepEqual(h.read(), { "namespace//existing-work": unrelated });
    assert.ok(!fs.existsSync(h.stateDir));
    assert.ok(
      h
        .calls()
        .slice(before)
        .every((call) =>
          ["config", "get", "delete"].includes(
            call[0] === "--context" ? call[3] : call[0],
          ),
        ),
    );
    const retry = h.run("setup");
    assert.equal(retry.status, 0, retry.stderr);
  });
}

for (const ownership of ["unowned", "different run"]) {
  test(`cleanup without local state refuses ${ownership} fixtures before deleting anything`, (t) => {
    const h = harness(t);
    assert.equal(h.run("setup").status, 0);
    fs.rmSync(h.stateDir, { recursive: true });
    const db = h.read();
    const role = db["clusterrole//kuadrant-backstage-e2e"];
    if (ownership === "unowned") delete role.metadata.labels;
    else role.metadata.labels["kuadrant.io/backstage-e2e-run"] = "another-run";
    h.write(db);

    const result = h.run("teardown");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unowned|different runs/);
    assert.ok(!h.calls().some((call) => call.includes("delete")));
    assert.ok(!fs.existsSync(h.stateDir));
    assert.deepEqual(h.read(), db);
  });
}

test("interrupted recovery retains UIDs for a safe cleanup retry", (t) => {
  const h = harness(t);
  assert.equal(h.run("setup").status, 0);
  fs.rmSync(h.stateDir, { recursive: true });
  const interrupted = h.run("teardown", { FAKE_FAIL_DELETE_KIND: "Namespace" });
  assert.equal(interrupted.status, 1);
  assert.ok(fs.existsSync(path.join(h.stateDir, "state.json")));

  const db = h.read();
  db["namespace//toystore"].metadata.uid = "replacement";
  h.write(db);
  const before = h.calls().length;
  const retry = h.run("teardown");
  assert.equal(retry.status, 1);
  assert.match(retry.stderr, /replaced or unowned/);
  assert.ok(
    !h
      .calls()
      .slice(before)
      .some((call) => call.includes("delete")),
  );
});

test("cleanup without state or fixtures does not create a recovery record", (t) => {
  const h = harness(t);
  const result = h.run("teardown");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No remote fixtures found/);
  assert.ok(!fs.existsSync(h.stateDir));
  assert.ok(!h.calls().some((call) => call.includes("delete")));
});

test("rejects a Backstage backend serving another run's fixtures", (t) => {
  const h = harness(t);
  assert.equal(h.run("setup").status, 0);
  const result = h.run("check", { FAKE_BACKEND_RUN_ID: "old-local-cluster" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not connected to this run's remote fixtures/);
  const correct = h.run("check");
  assert.equal(correct.status, 0, correct.stderr);
  assert.match(correct.stdout, /Verified: the Backstage backend/);
});

test("cleanup rejects changed context, changed cluster and replaced resources", (t) => {
  const h = harness(t);
  const setup = h.run("setup");
  assert.equal(setup.status, 0, setup.stderr);
  for (const overrides of [
    { FAKE_CONTEXT: "other" },
    { FAKE_CLUSTER_UID: "replacement" },
  ]) {
    const result = h.run("teardown", overrides);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /original cluster/);
  }
  const db = h.read();
  db["namespace//toystore"].metadata.uid = "replacement";
  h.write(db);
  const result = h.run("teardown");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /replaced or unowned/);
  assert.ok(!h.calls().some((call) => call.includes("delete")));
});

test("setup without BASE_URL leaves Dex to the local app", (t) => {
  const h = harness(t);
  const setup = h.run("setup");
  assert.equal(setup.status, 0, setup.stderr);
  assert.ok(!Object.values(h.read()).some(isDex));
  assert.ok(
    !h
      .calls()
      .some(
        (call) =>
          call.includes("ingresses.config.openshift.io") ||
          call.includes("rollout"),
      ),
  );
  assert.ok(!fs.existsSync(h.appConfigFile));
  assert.match(setup.stdout, /make remote-dev/);
});

test("setup with BASE_URL deploys owned Dex and writes RHDH config for it", (t) => {
  const h = harness(t);
  const setup = h.run("setup", { BASE_URL: `${deployed}/` });
  assert.equal(setup.status, 0, setup.stderr);
  const db = h.read();
  const ns = "kuadrant-backstage-e2e";
  const dex = Object.values(db).filter(isDex);
  assert.deepEqual(dex.map((r) => `${r.kind}/${r.metadata.name}`).sort(), [
    "ConfigMap/dex-config",
    "ConfigMap/dex-web",
    "Deployment/dex",
    "Route/dex",
    "Service/dex",
  ]);
  for (const resource of dex) {
    assert.equal(resource.metadata.namespace, ns);
    assert.equal(
      resource.metadata.labels["kuadrant.io/backstage-e2e-run"],
      h.state().runID,
    );
  }
  const volumes = db[`deployment/${ns}/dex`].spec.template.spec.volumes;
  for (const volume of volumes.filter((v) => v.configMap))
    assert.ok(db[`configmap/${ns}/${volume.configMap.name}`]);
  // restricted-v2 mounts the root read-only; the dex entrypoint writes to /tmp
  assert.ok(volumes.some((v) => v.name === "tmp" && v.emptyDir));
  assert.equal(
    db[`configmap/${ns}/dex-web`].data["password.html"],
    fs.readFileSync(
      path.join(repo, "kuadrant-dev-setup/dex/web/templates/password.html"),
      "utf8",
    ),
  );
  const route = db[`route/${ns}/dex`];
  assert.equal(
    route.spec.host,
    "dex-kuadrant-backstage-e2e.apps.release-test.example",
  );
  assert.deepEqual(route.spec.tls, {
    termination: "edge",
    insecureEdgeTerminationPolicy: "Redirect",
  });
  assert.ok(
    h
      .calls()
      .some(
        (call) => call.includes("rollout") && call.includes("deployment/dex"),
      ),
  );

  const config = yaml.load(
    db[`configmap/${ns}/dex-config`].data["config.yaml"],
  );
  assert.equal(config.issuer, issuer);
  assert.deepEqual(config.staticPasswords, dexConfig.staticPasswords);
  const client = (c) => c.id === "backstage";
  assert.deepEqual(config.staticClients.find(client).redirectURIs, [
    ...dexConfig.staticClients.find(client).redirectURIs,
    "https://rhdh.example.com/api/auth/oidc/handler/frame",
  ]);

  const app = yaml.load(fs.readFileSync(h.appConfigFile, "utf8"));
  assert.equal(fs.statSync(h.appConfigFile).mode & 0o777, 0o600);
  assert.equal(app.signInPage, "oidc");
  assert.ok(app.auth.session.secret.length >= 32);
  assert.deepEqual(app.auth.providers.oidc[app.auth.environment], {
    metadataUrl: `${issuer}/.well-known/openid-configuration`,
    clientId: "backstage",
    clientSecret: "backstage-dev-secret",
    additionalScopes: ["offline_access"],
    signIn: {
      resolvers: [{ resolver: "emailMatchingUserEntityProfileEmail" }],
    },
  });
  assert.deepEqual(app.catalog.locations, [
    {
      type: "file",
      target: "/opt/app-root/etc/kuadrant-users.yaml",
      rules: [{ allow: ["User", "Group"] }],
    },
  ]);
  assert.deepEqual(app.permission, {
    enabled: true,
    rbac: {
      admin: { superUsers: [{ name: "user:default/admin" }] },
      "policies-csv-file": "/opt/app-root/etc/rbac-policy.csv",
      policyFileReload: true,
    },
  });
  assert.match(setup.stdout, /Verified: Dex/);
  // the temporary state dir sits outside the checkout
  assert.ok(setup.stdout.includes(h.appConfigFile), h.appConfigFile);
  for (const file of [
    "rhdh-app-config.yaml",
    "catalog-entities/kuadrant-users.yaml",
    "rbac-policy.csv",
  ])
    assert.ok(setup.stdout.includes(file), file);
});

for (const [label, overrides, error] of [
  [
    "BASE_URL without a scheme",
    { BASE_URL: "rhdh.example.com" },
    /BASE_URL must be/,
  ],
  [
    "BASE_URL with credentials",
    { BASE_URL: "https://user:password@rhdh.example.com" },
    /BASE_URL must be/,
  ],
  [
    "BASE_URL with a path",
    { BASE_URL: `${deployed}/catalog` },
    /BASE_URL must be/,
  ],
  [
    "no cluster ingress domain",
    { BASE_URL: deployed, FAKE_INGRESS_DOMAIN: "" },
    /ingress domain/,
  ],
]) {
  test(`setup with ${label} fails before creating anything`, (t) => {
    const h = harness(t);
    const result = h.run("setup", overrides);
    assert.equal(result.status, 1);
    assert.match(result.stderr, error);
    assert.ok(!result.stderr.includes("password"));
    assert.ok(!h.calls().some((call) => call.includes("create")));
    assert.ok(!fs.existsSync(h.stateDir));
  });
}

test("setup warns, but completes, when this machine cannot verify Dex", (t) => {
  const h = harness(t);
  const result = h.run("setup", {
    BASE_URL: deployed,
    FAKE_DEX_FETCH_ERROR: "self-signed certificate in certificate chain",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /self-signed certificate in certificate chain/);
  assert.match(result.stderr, /ingress CA/);
  assert.match(result.stderr, /NODE_EXTRA_CA_CERTS/);
  assert.equal(h.state().ready, true);
  assert.ok(fs.existsSync(h.appConfigFile));
});

test("setup waits for the router to serve Dex", (t) => {
  const h = harness(t);
  const result = h.run("setup", {
    BASE_URL: deployed,
    FAKE_DEX_UNAVAILABLE: "3",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Verified: Dex/);
});

for (const [label, overrides, error] of [
  [
    "serves another issuer",
    { FAKE_DEX_ISSUER: "https://dex.other.example" },
    /reports issuer https:\/\/dex\.other\.example, expected https:\/\/dex-kuadrant-backstage-e2e\./,
  ],
  [
    "is never served by the router",
    { FAKE_DEX_UNAVAILABLE: "1000" },
    /HTTP 503.*route dex in namespace kuadrant-backstage-e2e/,
  ],
]) {
  test(`setup fails when Dex ${label}`, (t) => {
    const h = harness(t);
    const result = h.run("setup", { BASE_URL: deployed, ...overrides });
    assert.equal(result.status, 1);
    assert.match(result.stderr, error);
    assert.equal(h.state().ready, false);
    assert.ok(!fs.existsSync(h.appConfigFile));
  });
}

for (const lost of [false, true]) {
  test(`teardown removes Dex through the owned namespace${lost ? " after losing local state" : ""}`, (t) => {
    const h = harness(t);
    const unrelated = {
      kind: "Namespace",
      metadata: { name: "existing-work" },
    };
    h.write({ "namespace//existing-work": unrelated });
    const setup = h.run("setup", { BASE_URL: deployed });
    assert.equal(setup.status, 0, setup.stderr);
    assert.ok(Object.values(h.read()).some(isDex));
    if (lost) fs.rmSync(h.stateDir, { recursive: true });
    const teardown = h.run("teardown");
    assert.equal(teardown.status, 0, teardown.stderr);
    assert.deepEqual(h.read(), { "namespace//existing-work": unrelated });
    assert.ok(!fs.existsSync(h.stateDir));
  });
}

test("make remote-setup passes BASE_URL through to Dex setup", (t) => {
  const h = harness(t);
  const result = h.make(["remote-setup", `BASE_URL=${deployed}`]);
  assert.equal(result.status, 0, result.stderr);
  const app = yaml.load(fs.readFileSync(h.appConfigFile, "utf8"));
  assert.equal(
    app.auth.providers.oidc[app.auth.environment].metadataUrl,
    `${issuer}/.well-known/openid-configuration`,
  );
});

for (const lost of [false, true]) {
  test(`teardown deletes this run's MCP resources before any namespace${lost ? " after losing local state" : ""}`, (t) => {
    const h = harness(t);
    assert.equal(h.run("setup").status, 0);
    const { runID } = h.state();
    if (lost) fs.rmSync(h.stateDir, { recursive: true });
    const before = h.calls().length;
    const teardown = h.run("teardown");
    assert.equal(teardown.status, 0, teardown.stderr);
    assert.deepEqual(h.read(), {});
    const deletes = h
      .calls()
      .slice(before)
      .map((call) => (call[0] === "--context" ? call.slice(3) : call))
      .filter((call) => call[0] === "delete");
    const mcp = deletes.filter((call) => call[1].includes("mcp.kuadrant.io"));
    const firstNamespace = deletes.findIndex((call) => call[1] === "Namespace");
    assert.ok(mcp.length);
    assert.ok(deletes.indexOf(mcp.at(-1)) < firstNamespace);
    for (const call of mcp) {
      assert.ok(call.includes(`kuadrant.io/backstage-e2e-run=${runID}`));
      assert.ok(call.some((arg) => arg.startsWith("--timeout=")));
    }
    assert.match(
      teardown.stdout,
      /mcpserverregistration\.mcp\.kuadrant\.io "toystore-mcp-server" deleted/,
    );
    assert.match(
      teardown.stdout,
      /mcpgatewayextension\.mcp\.kuadrant\.io "mcp-gateway" deleted/,
    );
    assert.ok(!teardown.stdout.includes("No resources found"));
  });
}

for (const removed of [
  ["mcpgatewayextensions.mcp.kuadrant.io"],
  [
    "mcpserverregistrations.mcp.kuadrant.io",
    "mcpgatewayextensions.mcp.kuadrant.io",
  ],
]) {
  test(`teardown completes after ${removed.map((crd) => crd.split(".")[0]).join(" and ")} were uninstalled`, (t) => {
    const h = harness(t);
    assert.equal(h.run("setup").status, 0);
    const db = h.read();
    for (const [id, obj] of Object.entries(db)) {
      if (removed.includes(`${obj.kind.toLowerCase()}s.mcp.kuadrant.io`))
        delete db[id];
    }
    h.write(db);
    const teardown = h.run("teardown", { FAKE_MISSING_CRD: removed.join(",") });
    assert.equal(teardown.status, 0, teardown.stderr);
    assert.deepEqual(h.read(), {});
  });
}
