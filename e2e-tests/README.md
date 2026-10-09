# Kuadrant E2E Tests

End-to-end tests for the Kuadrant Backstage plugins using Playwright.

## Running Tests

Start the app in another terminal (after the cluster below):

```bash
yarn dev:oinc
```

Then run the tests:

```bash
cd e2e-tests
yarn test
```

Or just smoke test:

```bash
yarn test:smoke
```

## Prerequisites

For an existing OpenShift release-test cluster, use `make remote-setup`,
`make remote-dev`, and `make e2e-remote` from the repository root. Afterwards,
`make remote-teardown` removes this run's fixtures and retains the cluster.
If the checkout was deleted, teardown can recover the fixture ownership from
the cluster before cleanup; run it before setting up the fresh clone.
See [existing-cluster prerequisites and commands](../docs/e2e-testing.md#running-against-an-existing-openshift-cluster).

CI uses oinc (Kuadrant + MCP Gateway), not kind. Locally, match that or use kind as a lighter fallback:

```bash
# loop 2 — same cluster as CI
yarn oinc:cluster
yarn dev:oinc

# loop 1 — kind, no MCP Gateway operator
make -C kuadrant-dev-setup kind-create
yarn dev:kind
```

## What's Tested

- Smoke test: app loads and displays homepage
- Kuadrant plugin: navigation, page rendering, API products display

Tests run in CI automatically on every PR and push to main.
