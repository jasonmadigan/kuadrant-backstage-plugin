import React, { useState, useMemo } from 'react';
import { useAsync } from 'react-use';
import {
  Table,
  TableColumn,
  Progress,
  ResponseErrorPanel,
  CodeSnippet,
} from '@backstage/core-components';
import {
  IconButton,
  Typography,
  Box,
  Chip,
  Grid,
  Button,
  Tabs,
  Tab,
  Menu,
  MenuItem,
  Tooltip,
  CircularProgress,
} from '@material-ui/core';
import { useApi, configApiRef, identityApiRef, fetchApiRef, alertApiRef } from '@backstage/core-plugin-api';
import { useEntity } from '@backstage/plugin-catalog-react';
import VisibilityIcon from '@material-ui/icons/Visibility';
import VisibilityOffIcon from '@material-ui/icons/VisibilityOff';
import HourglassEmptyIcon from '@material-ui/icons/HourglassEmpty';
import CancelIcon from '@material-ui/icons/Cancel';
import AddIcon from '@material-ui/icons/Add';
import MoreVertIcon from '@material-ui/icons/MoreVert';
import { APIKeyRequest, APIProduct, Plan } from '../../types/api-management';
import {
  kuadrantApiKeyRequestCreatePermission,
  kuadrantApiKeyDeleteOwnPermission,
  kuadrantApiKeyDeleteAllPermission,
  kuadrantApiKeyRequestUpdateOwnPermission,
} from '../../permissions';
import { useKuadrantPermission, canDeleteResource } from '../../utils/permissions';
import { EditAPIKeyRequestDialog } from '../EditAPIKeyRequestDialog';
import { ConfirmDeleteDialog } from '../ConfirmDeleteDialog';
import { RequestApiKeyDialog } from '../RequestApiKeyDialog';

export interface ApiKeyManagementTabProps {
  namespace?: string;
}

export const ApiKeyManagementTab = ({ namespace: propNamespace }: ApiKeyManagementTabProps) => {
  const { entity } = useEntity();
  const config = useApi(configApiRef);
  const identityApi = useApi(identityApiRef);
  const fetchApi = useApi(fetchApiRef);
  const alertApi = useApi(alertApiRef);
  const backendUrl = config.getString('backend.baseUrl');
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());
  const [refresh, setRefresh] = useState(0);
  const [userId, setUserId] = useState<string>('');
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [requestToEdit, setRequestToEdit] = useState<APIKeyRequest | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; left: number } | null>(null);
  const [menuRequest, setMenuRequest] = useState<APIKeyRequest | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [optimisticallyDeleted, setOptimisticallyDeleted] = useState<Set<string>>(new Set());
  const [deleteDialogState, setDeleteDialogState] = useState<{
    open: boolean;
    request: APIKeyRequest | null;
  }>({ open: false, request: null });

  // get apiproduct name from entity annotation (set by entity provider)
  const apiProductName = entity.metadata.annotations?.['kuadrant.io/apiproduct'] || entity.metadata.name;
  const namespace = entity.metadata.annotations?.['kuadrant.io/namespace'] || propNamespace || 'default';

  useAsync(async () => {
    const identity = await identityApi.getBackstageIdentity();
    setUserId(identity.userEntityRef);
  }, [identityApi]);

  const { value: requests, loading: requestsLoading, error: requestsError } = useAsync(async () => {
    const response = await fetchApi.fetch(
      `${backendUrl}/api/kuadrant/requests/my?namespace=${namespace}`
    );
    if (!response.ok) {
      throw new Error('failed to fetch requests');
    }
    const data = await response.json();
    // filter by apiproduct name, not httproute name
    return (data.items || []).filter(
      (r: APIKeyRequest) => r.spec.apiName === apiProductName && r.spec.apiNamespace === namespace
    );
  }, [apiProductName, namespace, refresh, fetchApi, backendUrl]);

  const { value: apiProduct, loading: plansLoading, error: plansError } = useAsync(async () => {
    const response = await fetchApi.fetch(`${backendUrl}/api/kuadrant/apiproducts`);
    if (!response.ok) {
      throw new Error('failed to fetch api products');
    }
    const data = await response.json();

    const product = data.items?.find((p: APIProduct) =>
      p.metadata.namespace === namespace &&
      p.metadata.name === apiProductName
    );

    return product;
  }, [namespace, apiProductName, fetchApi]);

  // check permissions with resource reference once we have the apiproduct
  const resourceRef = apiProduct ? `apiproduct:${apiProduct.metadata.namespace}/${apiProduct.metadata.name}` : undefined;

  const {
    allowed: canCreateRequest,
    loading: createRequestPermissionLoading,
    error: createRequestPermissionError,
  } = useKuadrantPermission(kuadrantApiKeyRequestCreatePermission, resourceRef);

  const {
    allowed: canDeleteOwnKey,
    loading: deleteOwnPermissionLoading,
    error: deleteOwnPermissionError,
  } = useKuadrantPermission(kuadrantApiKeyDeleteOwnPermission);

  const {
    allowed: canDeleteAllKeys,
    loading: deleteAllPermissionLoading,
    error: deleteAllPermissionError,
  } = useKuadrantPermission(kuadrantApiKeyDeleteAllPermission);

  const {
    allowed: canUpdateRequest,
    loading: updateRequestPermissionLoading,
    error: updateRequestPermissionError,
  } = useKuadrantPermission(kuadrantApiKeyRequestUpdateOwnPermission);

  const handleDeleteRequest = async (name: string) => {
    // optimistic update - remove from UI immediately
    setOptimisticallyDeleted(prev => new Set(prev).add(name));
    setDeleting(name);
    try {
      const response = await fetchApi.fetch(
        `${backendUrl}/api/kuadrant/requests/${namespace}/${name}`,
        { method: 'DELETE' }
      );
      if (!response.ok) {
        throw new Error('failed to delete request');
      }
      alertApi.post({
        message: 'API key request deleted successfully',
        severity: 'success',
        display: 'transient',
      });
      setRefresh(r => r + 1);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'unknown error occurred';
      // rollback optimistic update on error
      setOptimisticallyDeleted(prev => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
      alertApi.post({
        message: `Failed to delete API key request: ${errorMessage}`,
        severity: 'error',
        display: 'transient',
      });
    } finally {
      setDeleting(null);
    }
  };

  const handleEditRequest = (request: APIKeyRequest) => {
    setRequestToEdit(request);
    setEditDialogOpen(true);
  };

  const handleEditSuccess = () => {
    setRefresh(r => r + 1);
    setEditDialogOpen(false);
    alertApi.post({ message: 'Request updated', severity: 'success', display: 'transient' });
    setRequestToEdit(null);
  };

  const handleMenuClose = () => {
    setMenuAnchor(null);
    setMenuRequest(null);
  };

  const handleMenuEdit = () => {
    if (!menuRequest) return;
    handleEditRequest(menuRequest);
    handleMenuClose();
  };

  const handleMenuDeleteClick = () => {
    if (!menuRequest) return;
    const request = menuRequest;
    handleMenuClose();
    setDeleteDialogState({ open: true, request });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteDialogState.request) return;
    await handleDeleteRequest(deleteDialogState.request.metadata.name);
    setDeleteDialogState({ open: false, request: null });
  };

  const handleDeleteCancel = () => {
    setDeleteDialogState({ open: false, request: null });
  };

  const toggleVisibility = (keyName: string) => {
    setVisibleKeys(prev => {
      const newSet = new Set(prev);
      if (newSet.has(keyName)) {
        newSet.delete(keyName);
      } else {
        newSet.add(keyName);
      }
      return newSet;
    });
  };

  const detailPanelConfig = useMemo(() => [
    {
      render: (data: any) => {
        // backstage Table wraps the data in { rowData: actualData }
        const request = data.rowData as APIKeyRequest;
        if (!request?.metadata?.name) {
          return <Box />;
        }

        return <DetailPanelContent request={request} apiName={apiProductName} />;
      },
    },
  ], [apiProductName]);

  // separate component to isolate state
  const DetailPanelContent = ({ request, apiName: api }: { request: APIKeyRequest; apiName: string }) => {
    const [selectedLanguage, setSelectedLanguage] = useState(0);
    const hostname = request.status?.apiHostname || `${api}.apps.example.com`;

    return (
      <Box p={3} bgcolor="background.default" onClick={(e) => e.stopPropagation()}>
        {request.spec.useCase && (
          <Box mb={3}>
            <Typography variant="h6" gutterBottom>
              Use Case
            </Typography>
            <Box p={2} bgcolor="background.paper" borderRadius={1} border="1px solid rgba(0, 0, 0, 0.12)">
              <Typography
                variant="body2"
                style={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  overflowWrap: 'break-word',
                }}
              >
                {request.spec.useCase}
              </Typography>
            </Box>
          </Box>
        )}
        <Typography variant="h6" gutterBottom>
          Usage Examples
        </Typography>
        <Typography variant="body2" paragraph>
          Use these code examples to test the API with your {request.spec.planTier} tier key.
        </Typography>
        <Box onClick={(e) => e.stopPropagation()}>
          <Tabs
            value={selectedLanguage}
            onChange={(e, newValue) => {
              e.stopPropagation();
              setSelectedLanguage(newValue);
            }}
            indicatorColor="primary"
          >
            <Tab label="cURL" onClick={(e) => e.stopPropagation()} />
            <Tab label="Node.js" onClick={(e) => e.stopPropagation()} />
            <Tab label="Python" onClick={(e) => e.stopPropagation()} />
            <Tab label="Go" onClick={(e) => e.stopPropagation()} />
          </Tabs>
        </Box>
        <Box mt={2}>
          {selectedLanguage === 0 && (
            <CodeSnippet
              text={`curl -X GET https://${hostname}/api/v1/endpoint \\
  -H "Authorization: Bearer ${request.status?.apiKey}"`}
              language="bash"
              showCopyCodeButton
            />
          )}
          {selectedLanguage === 1 && (
            <CodeSnippet
              text={`const fetch = require('node-fetch');

const apiKey = '${request.status?.apiKey}';
const endpoint = 'https://${hostname}/api/v1/endpoint';

fetch(endpoint, {
  method: 'GET',
  headers: {
    'Authorization': \`Bearer \${apiKey}\`
  }
})
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));`}
              language="javascript"
              showCopyCodeButton
            />
          )}
          {selectedLanguage === 2 && (
            <CodeSnippet
              text={`import requests

api_key = '${request.status?.apiKey}'
endpoint = 'https://${hostname}/api/v1/endpoint'

headers = {
    'Authorization': f'Bearer {api_key}'
}

response = requests.get(endpoint, headers=headers)
print(response.json())`}
              language="python"
              showCopyCodeButton
            />
          )}
          {selectedLanguage === 3 && (
            <CodeSnippet
              text={`package main

import (
    "fmt"
    "net/http"
    "io"
)

func main() {
    apiKey := "${request.status?.apiKey}"
    endpoint := "https://${hostname}/api/v1/endpoint"

    client := &http.Client{}
    req, _ := http.NewRequest("GET", endpoint, nil)
    req.Header.Add("Authorization", "Bearer " + apiKey)

    resp, err := client.Do(req)
    if err != nil {
        fmt.Println("Error:", err)
        return
    }
    defer resp.Body.Close()

    body, _ := io.ReadAll(resp.Body)
    fmt.Println(string(body))
}`}
              language="go"
              showCopyCodeButton
            />
          )}
        </Box>
      </Box>
    );
  };

  const loading = requestsLoading || plansLoading || createRequestPermissionLoading || deleteOwnPermissionLoading || deleteAllPermissionLoading || updateRequestPermissionLoading;
  const error = requestsError || plansError;
  const permissionError = createRequestPermissionError || deleteOwnPermissionError || deleteAllPermissionError || updateRequestPermissionError;

  if (loading) {
    return <Progress />;
  }

  if (error) {
    return <ResponseErrorPanel error={error} />;
  }

  if (permissionError) {
    const failedPermission = createRequestPermissionError ? 'kuadrant.apikeyrequest.create' :
      deleteOwnPermissionError ? 'kuadrant.apikey.delete.own' :
        deleteAllPermissionError ? 'kuadrant.apikey.delete.all' :
          updateRequestPermissionError ? 'kuadrant.apikeyrequest.update.own' : 'unknown';
    return (
      <Box p={2}>
        <Typography color="error">
          Unable to check permissions: {permissionError.message}
        </Typography>
        <Typography variant="body2" color="textSecondary">
          Permission: {failedPermission}
        </Typography>
        <Typography variant="body2" color="textSecondary">
          Please try again or contact your administrator
        </Typography>
      </Box>
    );
  }

  const myRequests = ((requests || []) as APIKeyRequest[]).filter(
    r => !optimisticallyDeleted.has(r.metadata.name)
  );
  const plans = (apiProduct?.spec?.plans || []) as Plan[];

  const pendingRequests = myRequests.filter(r => !r.status?.phase || r.status.phase === 'Pending');
  const approvedRequests = myRequests.filter(r => r.status?.phase === 'Approved');
  const rejectedRequests = myRequests.filter(r => r.status?.phase === 'Rejected');

  const approvedColumns: TableColumn<APIKeyRequest>[] = [
    {
      title: 'Tier',
      field: 'spec.planTier',
      render: (row: APIKeyRequest) => (
        <Chip label={row.spec.planTier} color="primary" size="small" />
      ),
    },
    {
      title: 'Approved',
      field: 'status.reviewedAt',
      render: (row: APIKeyRequest) => (
        <Typography variant="body2">
          {row.status?.reviewedAt ? new Date(row.status.reviewedAt).toLocaleDateString() : '-'}
        </Typography>
      ),
    },
    {
      title: 'API Key',
      field: 'status.apiKey',
      searchable: false,
      filtering: false,
      render: (row: APIKeyRequest) => {
        const isVisible = visibleKeys.has(row.metadata.name);
        const apiKey = row.status?.apiKey || 'N/A';

        return (
          <Box display="flex" alignItems="center">
            <Typography
              variant="body2"
              style={{
                fontFamily: 'monospace',
                marginRight: 8,
              }}
            >
              {isVisible ? apiKey : '••••••••••••••••'}
            </Typography>
            <IconButton
              size="small"
              onClick={() => toggleVisibility(row.metadata.name)}
            >
              {isVisible ? <VisibilityOffIcon /> : <VisibilityIcon />}
            </IconButton>
          </Box>
        );
      },
    },
    {
      title: '',
      field: 'actions',
      searchable: false,
      filtering: false,
      render: (row: APIKeyRequest) => {
        const isDeleting = deleting === row.metadata.name;
        if (isDeleting) {
          return <CircularProgress size={20} />;
        }
        const ownerId = row.spec.requestedBy.userId;
        const canDelete = canDeleteResource(ownerId, userId, canDeleteOwnKey, canDeleteAllKeys);
        if (!canDelete) return null;
        return (
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              setMenuAnchor({ top: rect.bottom, left: rect.left });
              setMenuRequest(row);
            }}
            title="Actions"
            aria-controls={menuAnchor ? 'actions-menu' : undefined}
            aria-haspopup="true"
          >
            <MoreVertIcon />
          </IconButton>
        );
      },
    },
  ];

  const requestColumns: TableColumn<APIKeyRequest>[] = [
    {
      title: 'Status',
      field: 'status.phase',
      render: (row: APIKeyRequest) => {
        const phase = row.status?.phase || 'Pending';
        const isPending = phase === 'Pending';
        return (
          <Chip
            label={phase}
            size="small"
            icon={isPending ? <HourglassEmptyIcon /> : <CancelIcon />}
            color={isPending ? 'default' : 'secondary'}
          />
        );
      },
    },
    {
      title: 'Tier',
      field: 'spec.planTier',
      render: (row: APIKeyRequest) => (
        <Chip label={row.spec.planTier} color="primary" size="small" />
      ),
    },
    {
      title: 'Use Case',
      field: 'spec.useCase',
      render: (row: APIKeyRequest) => {
        if (!row.spec.useCase) {
          return <Typography variant="body2">-</Typography>;
        }
        return (
          <Tooltip title={row.spec.useCase} placement="top">
            <Typography
              variant="body2"
              style={{
                maxWidth: '200px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {row.spec.useCase}
            </Typography>
          </Tooltip>
        );
      },
    },
    {
      title: 'Requested',
      field: 'spec.requestedAt',
      render: (row: APIKeyRequest) => (
        <Typography variant="body2">
          {row.spec.requestedAt ? new Date(row.spec.requestedAt).toLocaleDateString() : '-'}
        </Typography>
      ),
    },
    {
      title: 'Reviewed',
      field: 'status.reviewedAt',
      render: (row: APIKeyRequest) => {
        if (!row.status?.reviewedAt) return <Typography variant="body2">-</Typography>;
        return (
          <Typography variant="body2">
            {new Date(row.status.reviewedAt).toLocaleDateString()}
          </Typography>
        );
      },
    },
    {
      title: 'Reason',
      field: 'status.reason',
      render: (row: APIKeyRequest) => {
        if (!row.status?.reason) {
          return <Typography variant="body2">-</Typography>;
        }
        return (
          <Tooltip title={row.status.reason} placement="top">
            <Typography
              variant="body2"
              style={{
                maxWidth: '200px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {row.status.reason}
            </Typography>
          </Tooltip>
        );
      },
    },
    {
      title: '',
      field: 'actions',
      searchable: false,
      filtering: false,
      render: (row: APIKeyRequest) => {
        const isDeleting = deleting === row.metadata.name;
        if (isDeleting) {
          return <CircularProgress size={20} />;
        }
        const isPending = !row.status?.phase || row.status.phase === 'Pending';
        const ownerId = row.spec.requestedBy.userId;
        const canDelete = canDeleteResource(ownerId, userId, canDeleteOwnKey, canDeleteAllKeys);
        const canEdit = canUpdateRequest && ownerId === userId;
        if (!isPending || (!canEdit && !canDelete)) return null;
        return (
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              setMenuAnchor({ top: rect.bottom, left: rect.left });
              setMenuRequest(row);
            }}
            title="Actions"
            aria-controls={menuAnchor ? 'actions-menu' : undefined}
            aria-haspopup="true"
          >
            <MoreVertIcon />
          </IconButton>
        );
      },
    },
  ];

  // Filter columns for pending requests (no Reviewed or Reason)
  const pendingRequestColumns = requestColumns.filter(
    col => col.title !== 'Reviewed' && col.title !== 'Reason'
  );

  return (
    <Box p={2}>
      <Grid container spacing={3} direction="column">
        {canCreateRequest && (
          <Grid item>
            <Box display="flex" flexDirection="column" alignItems="flex-end" mb={2}>
              <Button
                variant="contained"
                color="primary"
                startIcon={<AddIcon />}
                onClick={() => setRequestDialogOpen(true)}
                disabled={plans.length === 0}
              >
                Request API Access
              </Button>
              {plans.length === 0 && (
                <Typography variant="caption" color="textSecondary" style={{ marginTop: 4 }}>
                  {!apiProduct ? 'API product not found' : 'No plans available'}
                </Typography>
              )}
            </Box>
          </Grid>
        )}
        {pendingRequests.length === 0 && rejectedRequests.length === 0 && approvedRequests.length === 0 && (
          <Grid item>
            <Box p={3} textAlign="center">
              <Typography variant="body1" color="textSecondary">
                No API keys yet. Request access to get started.
              </Typography>
            </Box>
          </Grid>
        )}
        {pendingRequests.length > 0 && (
          <Grid item>
            <Table
              title="Pending Requests"
              options={{
                paging: pendingRequests.length > 5,
                pageSize: 20,
                search: true,
                filtering: true,
                debounceInterval: 300,
                toolbar: true,
                emptyRowsWhenPaging: false,
              }}
              columns={pendingRequestColumns}
              data={pendingRequests}
            />
          </Grid>
        )}
        {rejectedRequests.length > 0 && (
          <Grid item>
            <Table
              title="Rejected Requests"
              options={{
                paging: rejectedRequests.length > 5,
                pageSize: 20,
                search: true,
                filtering: true,
                debounceInterval: 300,
                toolbar: true,
                emptyRowsWhenPaging: false,
              }}
              columns={requestColumns}
              data={rejectedRequests}
            />
          </Grid>
        )}
        {approvedRequests.length > 0 && (
          <Grid item>
            <Table
              key="api-keys-table"
              title="API Keys"
              options={{
                paging: approvedRequests.length > 5,
                pageSize: 20,
                search: true,
                filtering: true,
                debounceInterval: 300,
                toolbar: true,
                emptyRowsWhenPaging: false,
              }}
              columns={approvedColumns}
              data={approvedRequests}
              detailPanel={detailPanelConfig}
            />
          </Grid>
        )}
      </Grid>

      <RequestApiKeyDialog
        open={requestDialogOpen}
        onClose={() => setRequestDialogOpen(false)}
        onSuccess={() => setRefresh(r => r + 1)}
        apiProduct={apiProduct as APIProduct}
        plans={plans}
      />

      <Menu
        id="actions-menu"
        open={Boolean(menuAnchor)}
        onClose={handleMenuClose}
        anchorReference="anchorPosition"
        anchorPosition={menuAnchor || { top: 0, left: 0 }}
      >
        {menuRequest && (() => {
          const isPending = !menuRequest.status?.phase || menuRequest.status.phase === 'Pending';
          const ownerId = menuRequest.spec.requestedBy.userId;
          const canEdit = canUpdateRequest && ownerId === userId && isPending;

          const items = [];
          if (canEdit) {
            items.push(<MenuItem key="edit" onClick={handleMenuEdit}>Edit</MenuItem>);
          }
          items.push(<MenuItem key="delete" onClick={handleMenuDeleteClick}>Delete</MenuItem>);
          return items;
        })()}
      </Menu>

      {requestToEdit && (
        <EditAPIKeyRequestDialog
          open={editDialogOpen}
          onClose={() => {
            setEditDialogOpen(false);
            setRequestToEdit(null);
          }}
          onSuccess={handleEditSuccess}
          request={requestToEdit}
          availablePlans={plans}
        />
      )}

      <ConfirmDeleteDialog
        open={deleteDialogState.open}
        title={deleteDialogState.request?.status?.phase === 'Approved' ? 'Delete API Key' : 'Delete Request'}
        description={
          deleteDialogState.request?.status?.phase === 'Approved'
            ? 'This will permanently revoke this API key. Applications using this key will no longer be able to authenticate.'
            : 'Are you sure you want to delete this request?'
        }
        severity={deleteDialogState.request?.status?.phase === 'Approved' ? 'high' : 'normal'}
        confirmText={deleteDialogState.request?.status?.phase === 'Approved' ? 'delete' : undefined}
        deleting={deleting !== null}
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />
    </Box>
  );
};
