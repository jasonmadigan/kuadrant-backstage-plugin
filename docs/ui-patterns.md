# UI Patterns

This document covers common UI patterns used in the Kuadrant frontend plugin.

## Backstage Table with Interactive Detail Panels

When using the `Table` component's `detailPanel` with interactive elements (tabs, buttons), create a separate component to avoid re-render issues.

**Problem**: Parent component state changes cause the table to lose expansion state.

**Solution**: Isolate detail panel state in a separate component:

```typescript
// parent component - keep detailPanel config stable
const detailPanelConfig = useMemo(() => [
  {
    render: (data: any) => {
      const item = data.rowData;
      if (!item) return <Box />;
      return <DetailPanelContent item={item} />;
    },
  },
], [/* minimal dependencies */]);

// separate component with isolated state
const DetailPanelContent = ({ item }) => {
  const [localState, setLocalState] = useState(initialValue);

  return (
    <Box onClick={(e) => e.stopPropagation()}>
      <Tabs value={localState} onChange={(e, val) => {
        e.stopPropagation();
        setLocalState(val);
      }}>
        {/* ... */}
      </Tabs>
    </Box>
  );
};
```

Key points:
- Each detail panel gets its own isolated state
- Add `onClick={(e) => e.stopPropagation()}` to prevent row collapse
- Add `e.stopPropagation()` to interactive handlers
- Keep `detailPanelConfig` in `useMemo` with minimal dependencies

Example: `ApiKeyManagementTab.tsx` - expandable rows with language tabs for code examples.

## Delete Confirmation Dialogs

Use `ConfirmDeleteDialog` component at `plugins/kuadrant/src/components/ConfirmDeleteDialog/`:

```typescript
interface ConfirmDeleteDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmText?: string;  // for high-severity, require typing this
  severity?: 'normal' | 'high';
  deleting?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}
```

**Normal severity** (pending requests):
```typescript
<ConfirmDeleteDialog
  open={deleteDialogState.open}
  title="Delete API Key Request"
  description={`Delete request for ${request?.spec.apiName}?`}
  deleting={deleting}
  onConfirm={handleDeleteConfirm}
  onCancel={handleDeleteCancel}
/>
```

**High severity** (API Products, approved keys):
```typescript
<ConfirmDeleteDialog
  open={deleteDialogOpen}
  title="Delete API Product"
  description={`This will permanently delete "${name}". Any API keys will stop working.`}
  confirmText={name}
  severity="high"
  deleting={deleting}
  onConfirm={handleDeleteConfirm}
  onCancel={handleDeleteCancel}
/>
```

State pattern:
```typescript
const [deleteDialogState, setDeleteDialogState] = useState<{
  open: boolean;
  request: SomeType | null;
}>({ open: false, request: null });
```

## Theme-Aware Styling

Avoid hardcoded colours. Use theme tokens:

```typescript
// bad
bgcolor="#f5f5f5"
border="1px solid #e0e0e0"

// good
bgcolor="background.default"
borderColor="divider"
```

## Permission-Gated UI

Use `useKuadrantPermission` hook:

```typescript
const { allowed, loading } = useKuadrantPermission(kuadrantApiProductCreatePermission);

if (loading) return <Progress />;
if (!allowed) return null;
```

For ownership-aware actions:
```typescript
const canDelete = canDeleteResource(ownerId, userId, canDeleteOwn, canDeleteAll);
```

See `docs/rbac-permissions.md` for complete frontend permission patterns.
