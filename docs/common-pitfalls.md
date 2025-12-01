# Common Pitfalls

This document covers common issues and their solutions.

## Backend API Calls

Always use absolute backend URLs, not relative paths:

```typescript
// wrong - goes to webpack dev server (port 3000)
const response = await fetchApi.fetch('/api/your-endpoint');

// correct - goes to backend (port 7007)
const config = useApi(configApiRef);
const backendUrl = config.getString('backend.baseUrl');
const response = await fetchApi.fetch(`${backendUrl}/api/your-endpoint`);
```

## Menu Items Showing Translation Keys

If menu items show `menuItem.key-name` instead of the title, remove `titleKey`:

```typescript
// wrong
'default.your-plugin': {
  title: 'Your Plugin',
  titleKey: 'menuItem.yourPlugin',  // remove this
}

// correct
'default.your-plugin': {
  title: 'Your Plugin',
  icon: 'extension',
  to: 'your-plugin',
}
```

## Home Page 404 in Dev Mode

`yarn dev` doesn't load dynamic plugins, so the home page returns 404.

Add redirect in `packages/app/src/components/AppBase/AppBase.tsx`:
```typescript
<Route path="/" element={<Navigate to="catalog" />} />
```

## Node Version Mismatch

If `node --version` shows wrong version (e.g., v24+ instead of v22.20.0), Homebrew's Node is taking precedence over nvm.

Fix:
```bash
nvm use                # use version from .nvmrc
# or
brew unlink node       # temporarily unlink Homebrew's Node
```

## macOS System Dependencies

Must use GNU `grep` and GNU `sed` instead of BSD versions:
```bash
brew install grep gnu-sed
```
Set GNU versions as default to avoid script compatibility issues.

## Guest Authentication in Dev

For local development, enable in `app-config.local.yaml`:
```yaml
auth:
  environment: development
  providers:
    guest:
      dangerouslyAllowOutsideDevelopment: true
```

## Dynamic Plugins vs Hot Reload

- `yarn dev` - hot reload, no dynamic plugins
- `yarn start` - dynamic plugins, no hot reload

Use `yarn dev` for Kuadrant plugin development.
