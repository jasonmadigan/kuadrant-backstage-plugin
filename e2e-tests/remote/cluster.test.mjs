import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

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
globalThis.fetch = async url => ({
  ok: true,
  json: async () => url.endsWith('/refresh')
    ? { backstageIdentity: { token: 'test-token' } }
    : { items: [{ metadata: {
        name: 'toystore-api', namespace: 'toystore',
        labels: { 'kuadrant.io/backstage-e2e-run': process.env.FAKE_BACKEND_RUN_ID || JSON.parse(fs.readFileSync(process.env.E2E_REMOTE_STATE_DIR + '/state.json', 'utf8')).runID }
      } }] }
});
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
let output;
if (args[0] === 'config' && args[1] === 'current-context') {
  output = process.env.FAKE_CONTEXT || 'release-test';
} else if (args[0] === 'config' && args[1] === 'view') {
  output = { clusters: [{ cluster: { server: 'https://release-test.example:6443' } }] };
} else if (args[0] === 'get' && args[1] === 'namespace' && args[2] === 'kube-system') {
  output = { metadata: { uid: process.env.FAKE_CLUSTER_UID || 'original-cluster' } };
} else if (args[0] === 'get' && args[1] === 'clusterversion') {
  output = { status: { desired: { version: '4.21.35' } } };
} else if (args[0] === 'get' && args[1] === 'kuadrants.kuadrant.io') {
  output = { items: [{ spec: { components: { developerPortal: { enabled: true } } } }] };
} else if (args[0] === 'get' && args[1] === 'crd') {
  output = args[2] === process.env.FAKE_MISSING_CRD ? '' : { metadata: { name: args[2] } };
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
} else if (args[0] === 'delete') {
  if (args[1] === process.env.FAKE_FAIL_DELETE_KIND) process.exit(1);
  delete db[key(args[1], args[2])];
  if (args[1] === 'Namespace') {
    for (const [id, obj] of Object.entries(db)) {
      if (obj.metadata.namespace === args[2]) delete db[id];
    }
  }
} else if (args[0] !== 'wait') {
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
    FAKE_DB: dbFile,
    FAKE_LOG: logFile,
  };
  return {
    stateDir,
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
  };
}

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
