# Plugin Development

This document covers adding and integrating plugins in this monorepo.

## Adding Custom Plugins

1. Copy plugin directories to `plugins/` folder
2. Run `yarn install` to link via workspace
3. Add backend plugins to `packages/backend/src/index.ts`:
   ```typescript
   backend.add(import('@internal/plugin-your-backend'));
   ```
4. Add frontend plugin to `packages/app/package.json` dependencies
5. Import and use directly in app components

Hot reloading works automatically with `yarn dev`.

## Plugin Integration Patterns

For local development, direct imports work better than Scalprum dynamic loading.

### Adding a Plugin Page

1. Import and add route in `packages/app/src/components/AppBase/AppBase.tsx`:
   ```typescript
   import { YourPluginPage } from '@internal/plugin-your-plugin';
   <Route path="/your-plugin" element={<YourPluginPage />} />
   ```

2. Add menu item in `packages/app/src/consts.ts`:
   ```typescript
   'default.your-plugin': {
     title: 'Your Plugin',
     icon: 'extension',
     to: 'your-plugin',
     priority: 55,
   }
   ```

### Adding Entity Page Components

Files to modify in `packages/app/src/components/catalog/EntityPage/`:

1. `defaultTabs.tsx` - import component, define tab
2. `tabRules` object - add visibility rule (e.g., `if: isKind('api')`)
3. `tabChildren` object - add content

### Grid Layout for Entity Tabs

Entity pages use CSS Grid. Wrap content with explicit grid columns:

```typescript
// full-width
<Grid item sx={{ gridColumn: '1 / -1' }}>
  <YourContent />
</Grid>

// half-width
<Grid item sx={{ gridColumn: { lg: '1 / span 6', xs: '1 / -1' } }}>
```

Without explicit settings, content may appear half-width.

### Adding Entity Overview Cards

Add to `OverviewTabContent.tsx` within appropriate `EntitySwitch.Case`:
```typescript
<Grid item sx={{ gridColumn: { lg: '5 / -1', md: '7 / -1', xs: '1 / -1' } }}>
  <EntityYourCard />
</Grid>
```

## Kubernetes Configuration

Backend plugins needing Kubernetes access use this pattern in `app-config.yaml`:

```yaml
kubernetes:
  clusterLocatorMethods:
    - type: config
      clusters:
        - name: my-cluster
          url: https://kubernetes.default.svc
          authProvider: serviceAccount
          serviceAccountToken: ${K8S_CLUSTER_TOKEN}
          skipTLSVerify: true
```

Implementation:
1. Use `@kubernetes/client-node` library
2. Accept `RootConfigService` in constructor
3. Parse `kubernetes.clusterLocatorMethods[].clusters` config
4. Support `serviceAccount` auth or fallback to `loadFromDefault()`

## Dynamic Plugins

For dynamic plugin development:

```bash
# export all dynamic plugins
yarn export-dynamic -- -- --dev

# export single plugin (from wrapper directory)
yarn export-dynamic
```

Note: `yarn dev` doesn't load dynamic plugins but provides hot reload. Use `yarn start` if you need dynamic plugins loaded.
