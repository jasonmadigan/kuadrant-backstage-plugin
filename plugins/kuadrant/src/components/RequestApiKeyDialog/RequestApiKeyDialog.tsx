import React, { useState, useEffect } from 'react';
import { useApi, configApiRef, identityApiRef, fetchApiRef, alertApiRef } from '@backstage/core-plugin-api';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Typography,
  Box,
  CircularProgress,
} from '@material-ui/core';
import InfoIcon from '@material-ui/icons/Info';
import { APIProduct, Plan } from '../../types/api-management';

export interface RequestApiKeyDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  // if provided, dialog is in "entity context" mode - api is pre-selected
  apiProduct?: APIProduct;
  plans?: Plan[];
}

const formatLimits = (limits: Plan['limits']): string => {
  if (!limits) return '';
  const parts: string[] = [];
  if (limits.daily) parts.push(`${limits.daily}/day`);
  if (limits.weekly) parts.push(`${limits.weekly}/week`);
  if (limits.monthly) parts.push(`${limits.monthly}/month`);
  if (limits.yearly) parts.push(`${limits.yearly}/year`);
  if (limits.custom) {
    limits.custom.forEach(c => parts.push(`${c.limit}/${c.window}`));
  }
  return parts.length > 0 ? parts.join(', ') : '';
};

export const RequestApiKeyDialog = ({
  open,
  onClose,
  onSuccess,
  apiProduct,
  plans: providedPlans,
}: RequestApiKeyDialogProps) => {
  const config = useApi(configApiRef);
  const identityApi = useApi(identityApiRef);
  const fetchApi = useApi(fetchApiRef);
  const alertApi = useApi(alertApiRef);
  const backendUrl = config.getString('backend.baseUrl');

  const [selectedApi, setSelectedApi] = useState('');
  const [selectedTier, setSelectedTier] = useState('');
  const [keyName, setKeyName] = useState('');
  const [useCase, setUseCase] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [apiProducts, setApiProducts] = useState<APIProduct[]>([]);
  const [loadingApis, setLoadingApis] = useState(false);
  const [userId, setUserId] = useState('');
  const [userEmail, setUserEmail] = useState('');

  // entity context mode - api is pre-selected
  const isEntityContext = !!apiProduct;
  const currentApiProduct = isEntityContext
    ? apiProduct
    : apiProducts.find(p => `${p.metadata.namespace}/${p.metadata.name}` === selectedApi);
  const currentPlans = isEntityContext ? (providedPlans || []) : (currentApiProduct?.spec?.plans || []);
  const approvalMode = currentApiProduct?.spec?.approvalMode || 'manual';

  useEffect(() => {
    if (!open) {
      setSelectedApi('');
      setSelectedTier('');
      setKeyName('');
      setUseCase('');
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    const loadIdentity = async () => {
      const identity = await identityApi.getBackstageIdentity();
      const profile = await identityApi.getProfileInfo();
      setUserId(identity.userEntityRef);
      setUserEmail(profile.email || '');
    };
    loadIdentity();
  }, [identityApi]);

  useEffect(() => {
    if (!open || isEntityContext) return;

    const loadApiProducts = async () => {
      setLoadingApis(true);
      try {
        const response = await fetchApi.fetch(`${backendUrl}/api/kuadrant/apiproducts`);
        if (!response.ok) {
          throw new Error('failed to fetch api products');
        }
        const data = await response.json();
        // only show published api products
        const published = (data.items || []).filter(
          (p: APIProduct) => p.spec.publishStatus === 'Published'
        );
        setApiProducts(published);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'failed to load apis');
      } finally {
        setLoadingApis(false);
      }
    };
    loadApiProducts();
  }, [open, isEntityContext, backendUrl, fetchApi]);

  // reset tier when api changes
  useEffect(() => {
    setSelectedTier('');
  }, [selectedApi]);

  const handleSubmit = async () => {
    if (!currentApiProduct) return;
    if (!selectedTier) return;

    setCreating(true);
    setError(null);

    try {
      const response = await fetchApi.fetch(`${backendUrl}/api/kuadrant/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiName: currentApiProduct.metadata.name,
          apiNamespace: currentApiProduct.metadata.namespace,
          userId,
          userEmail,
          planTier: selectedTier,
          useCase: useCase.trim() || '',
          keyName: keyName.trim() || '',
          namespace: currentApiProduct.metadata.namespace,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `failed to create request: ${response.status}`);
      }

      const successMessage = approvalMode === 'automatic'
        ? 'API key created successfully'
        : 'API access request submitted successfully';
      alertApi.post({ message: successMessage, severity: 'success', display: 'transient' });

      onSuccess();
      onClose();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'unknown error';
      setError(errorMessage);
      alertApi.post({ message: `Failed to create request: ${errorMessage}`, severity: 'error', display: 'transient' });
    } finally {
      setCreating(false);
    }
  };

  const canSubmit = (isEntityContext || selectedApi) && selectedTier && !creating;

  return (
    <Dialog open={open} onClose={creating ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Request API Key</DialogTitle>
      <DialogContent>
        {error && (
          <Box mb={2} p={2} bgcolor="error.main" color="error.contrastText" borderRadius={1}>
            <Typography variant="body2">{error}</Typography>
          </Box>
        )}

        {/* approval mode info banner */}
        {currentApiProduct && (
          <Box mb={2} p={2} bgcolor="info.light" borderRadius={1} display="flex" alignItems="flex-start">
            <InfoIcon style={{ marginRight: 8, marginTop: 2, fontSize: 20 }} />
            <Typography variant="body2">
              {approvalMode === 'automatic'
                ? 'This API uses automatic approval. Your key will be available immediately.'
                : 'This API requires manual approval. Your request will be reviewed by an administrator.'}
            </Typography>
          </Box>
        )}

        {/* api selection - only shown in standalone mode */}
        {!isEntityContext && (
          <FormControl fullWidth margin="normal" disabled={creating || loadingApis}>
            <InputLabel>API</InputLabel>
            <Select
              value={selectedApi}
              onChange={(e) => setSelectedApi(e.target.value as string)}
              disabled={creating || loadingApis}
            >
              {loadingApis ? (
                <MenuItem disabled>Loading...</MenuItem>
              ) : apiProducts.length === 0 ? (
                <MenuItem disabled>No APIs available</MenuItem>
              ) : (
                apiProducts.map((product) => (
                  <MenuItem
                    key={`${product.metadata.namespace}/${product.metadata.name}`}
                    value={`${product.metadata.namespace}/${product.metadata.name}`}
                  >
                    {product.spec.displayName || product.metadata.name}
                  </MenuItem>
                ))
              )}
            </Select>
          </FormControl>
        )}

        {/* tier selection */}
        <FormControl
          fullWidth
          margin="normal"
          disabled={creating || (!isEntityContext && !selectedApi) || currentPlans.length === 0}
        >
          <InputLabel>Tier</InputLabel>
          <Select
            value={selectedTier}
            onChange={(e) => setSelectedTier(e.target.value as string)}
            disabled={creating || (!isEntityContext && !selectedApi) || currentPlans.length === 0}
          >
            {currentPlans.length === 0 ? (
              <MenuItem disabled>No tiers available</MenuItem>
            ) : (
              currentPlans.map((plan) => {
                const limitStr = formatLimits(plan.limits);
                return (
                  <MenuItem key={plan.tier} value={plan.tier}>
                    {plan.tier}{limitStr ? ` (${limitStr})` : ''}
                  </MenuItem>
                );
              })
            )}
          </Select>
        </FormControl>

        {/* key name - optional */}
        <TextField
          label="Key Name (optional)"
          placeholder="e.g. production-key, dev-testing"
          fullWidth
          margin="normal"
          value={keyName}
          onChange={(e) => setKeyName(e.target.value)}
          helperText="A friendly name to identify this API key"
          disabled={creating}
        />

        {/* use case */}
        <TextField
          label="Use Case (optional)"
          placeholder="Describe how you plan to use this API"
          multiline
          rows={3}
          fullWidth
          margin="normal"
          value={useCase}
          onChange={(e) => setUseCase(e.target.value)}
          helperText="Explain your intended use for administrator review"
          disabled={creating}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={creating}>Cancel</Button>
        <Button
          onClick={handleSubmit}
          color="primary"
          variant="contained"
          disabled={!canSubmit}
          startIcon={creating ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {creating ? 'Submitting...' : 'Submit Request'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
