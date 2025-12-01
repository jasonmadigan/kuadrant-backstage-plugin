# CLAUDE.md

Guidance for Claude Code when working with this repository.

## Repository Overview

Customised fork of [Red Hat Developer Hub (RHDH)](https://github.com/redhat-developer/rhdh) for developing **Kuadrant Backstage plugins**. Monorepo containing RHDH application with Kuadrant-specific plugins for API access management.

### Key Directories

- `plugins/kuadrant` - Frontend plugin (React, API key management UI)
- `plugins/kuadrant-backend` - Backend plugin (Node.js, Kubernetes integration)
- `kuadrant-dev-setup/` - Kind cluster setup with Kuadrant + demo resources
- `packages/app` - Frontend application
- `packages/backend` - Backend application
- `docs/` - Detailed documentation

### What the Plugins Do

Enable developer portals for API access management:
- **Consumers**: Request API access, view/manage API keys
- **API Owners**: Publish APIs, approve/reject requests
- **Platform Engineers**: Configure rate limits via PlanPolicy

## Essential Commands

```bash
yarn install                    # install dependencies
yarn dev                        # frontend + backend with hot reload
yarn tsc                        # typescript compilation
yarn test                       # run tests
yarn lint:fix                   # fix linting
```

### Kuadrant Dev Environment

```bash
cd kuadrant-dev-setup && make kind-create   # create cluster
cd .. && yarn dev                            # start app
cd kuadrant-dev-setup && make kind-delete   # cleanup
```

### Testing Roles

```bash
yarn user:consumer      # switch to API Consumer
yarn user:owner         # switch to API Owner
yarn user:default       # restore default
```

Restart `yarn dev` after switching roles.

## Documentation

Detailed docs are in `docs/` directory:

| Document | Content |
|----------|---------|
| `docs/rbac-permissions.md` | **Complete RBAC guide**: permissions, roles, ownership, backend security principles |
| `docs/architecture.md` | HTTPRoute-first model, namespace organisation, approval modes, API key model |
| `docs/plugin-development.md` | Adding plugins, entity pages, Kubernetes config |
| `docs/ui-patterns.md` | Table detail panels, delete dialogs, theme-aware styling |
| `docs/common-pitfalls.md` | Backend API calls, Node version, dev mode issues |

**When implementing permissions/RBAC**, always consult `docs/rbac-permissions.md` first.

## Architecture Summary

- **HTTPRoute-first**: Platform Engineers create infrastructure on-cluster, API Owners publish to catalog
- **APIProduct**: Catalog metadata layer referencing HTTPRoute
- **APIKeyRequest**: Source of truth for API keys (not Secrets)
- **Namespace pattern**: All resources for an API live in the same namespace
- **Two-layer RBAC**: Backstage (portal access) + Kuadrant/Gateway (runtime enforcement)

## Tech Stack

- Node.js 22.20.0 (see `.nvmrc`)
- React frontend with Material-UI
- Express backend with Backstage plugin APIs
- Kubernetes CRDs: APIProduct, APIKeyRequest, PlanPolicy
- Turborepo + Yarn 3 workspaces

## Configuration

- `app-config.yaml` - Base config
- `app-config.local.yaml` - Local overrides (RBAC enabled)
- `rbac-policy.csv` - RBAC policies

## Quick Patterns

**Frontend API calls** - always use absolute URLs:
```typescript
const backendUrl = config.getString('backend.baseUrl');
await fetchApi.fetch(`${backendUrl}/api/kuadrant/...`);
```

**Permission checks** - use the hook:
```typescript
const { allowed, loading } = useKuadrantPermission(somePermission);
```

**Backend validation** - use Zod with explicit whitelists (see `docs/rbac-permissions.md`).
