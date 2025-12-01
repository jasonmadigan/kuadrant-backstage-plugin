# Architecture

This document describes the architecture and key design decisions for the Kuadrant Backstage plugins.

## HTTPRoute-First APIProduct Model

Platform Engineers set up infrastructure on-cluster first:
1. Create PlanPolicy with rate limit tiers
2. Apply PlanPolicy to HTTPRoute via `targetRef`
3. Annotate HTTPRoute with `backstage.io/expose: "true"`

API Owner workflow in Backstage:
1. Browse available HTTPRoutes (filtered by annotation)
2. Select existing HTTPRoute to publish
3. Add catalog metadata (display name, description, docs, tags)
4. APIProduct is created with `spec.targetRef` pointing to HTTPRoute

Key points:
- Backstage remains read-only for infrastructure resources (HTTPRoute, PlanPolicy)
- PlanPolicy configuration happens on-cluster (via kubectl/GitOps)
- Clear separation: Platform Engineers configure infrastructure, API Owners publish to catalog
- Multiple APIProducts can reference the same HTTPRoute

## APIKeyRequest Scoping

APIKeyRequest `spec.apiName` references the **APIProduct name**, not HTTPRoute name:
- Each APIProduct has isolated API key requests
- Multiple APIProducts can share HTTPRoute infrastructure
- Each product has separate approval workflow, keys, and request tracking

## Catalog Sync

APIProductEntityProvider syncs to Backstage catalog:
- Periodic sync every 30 seconds as backup
- Immediate sync after create/delete via `provider.refresh()`
- Only syncs APIProducts with `publishStatus: Published`
- Draft APIProducts are hidden from catalog

## PublishStatus Workflow

APIProducts have `spec.publishStatus` field:
- `Draft` (default) - hidden from catalog
- `Published` - visible in Backstage catalog

## Plan Population (Temporary)

Until a proper controller exists, the backend populates `spec.plans` during APIProduct creation:
1. Finds PlanPolicy targeting the same HTTPRoute
2. Copies plans array from PlanPolicy to APIProduct
3. Non-blocking if PlanPolicy lookup fails

## Namespace Organisation

All resources for an API must live in the same namespace:

```
namespace: toystore
├── httproute (toystore)
├── authpolicy (toystore)
├── planpolicy (toystore-plans)
├── service (toystore)
└── secrets (api keys)
```

Why:
- AuthPolicy needs to access Secrets in the same namespace
- Policies target HTTPRoute by name (same namespace lookup)
- API keys (Secrets) must be where AuthPolicy can reference them

## Approval Modes

APIProducts support two approval modes:
- **Manual** (default): Requests require explicit approval
- **Automatic**: Requests immediately create API keys

## API Key Management Model

APIKeyRequests are the source of truth, not Kubernetes Secrets:

```
APIKeyRequest (CRD)          Secret (Kubernetes)
├── metadata.name            Created when approved
├── spec.planTier            annotations:
├── spec.apiName               - secret.kuadrant.io/plan-id
├── spec.requestedBy.userId    - secret.kuadrant.io/user-id
└── status.apiKey            labels:
                               - app: <apiName>
```

UI shows APIKeyRequests only. Secrets are implementation details managed by backend. Deleting an approved request deletes both the APIKeyRequest and its Secret.
