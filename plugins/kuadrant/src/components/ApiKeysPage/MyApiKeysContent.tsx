import React, { useState } from 'react';
import { Table, TableColumn, Link } from '@backstage/core-components';
import { useApi, configApiRef, fetchApiRef, alertApiRef } from '@backstage/core-plugin-api';
import { Box, Chip, Typography, IconButton, Tooltip, Menu, MenuItem, CircularProgress, Button } from '@material-ui/core';
import VisibilityIcon from '@material-ui/icons/Visibility';
import VisibilityOffIcon from '@material-ui/icons/VisibilityOff';
import MoreVertIcon from '@material-ui/icons/MoreVert';
import AddIcon from '@material-ui/icons/Add';
import { EditAPIKeyRequestDialog } from '../EditAPIKeyRequestDialog';
import { ConfirmDeleteDialog } from '../ConfirmDeleteDialog';
import { RequestApiKeyDialog } from '../RequestApiKeyDialog';
import { APIKeyRequest } from '../../types/api-management';
import { kuadrantApiKeyRequestCreatePermission } from '../../permissions';
import { useKuadrantPermission } from '../../utils/permissions';

interface MyApiKeysContentProps {
  requests: APIKeyRequest[];
  onRefresh: () => void;
}

export const MyApiKeysContent = ({ requests, onRefresh }: MyApiKeysContentProps) => {
  const config = useApi(configApiRef);
  const fetchApi = useApi(fetchApiRef);
  const alertApi = useApi(alertApiRef);
  const backendUrl = config.getString('backend.baseUrl');

  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; left: number } | null>(null);
  const [menuRequest, setMenuRequest] = useState<APIKeyRequest | null>(null);
  const [editDialogState, setEditDialogState] = useState<{ open: boolean; request: APIKeyRequest | null; plans: any[] }>({
    open: false,
    request: null,
    plans: [],
  });
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteDialogState, setDeleteDialogState] = useState<{
    open: boolean;
    request: APIKeyRequest | null;
  }>({ open: false, request: null });
  const [optimisticallyDeleted, setOptimisticallyDeleted] = useState<Set<string>>(new Set());
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);

  const { allowed: canCreateRequest } = useKuadrantPermission(kuadrantApiKeyRequestCreatePermission);

  const toggleKeyVisibility = (keyName: string) => {
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

  const handleMenuClose = () => {
    setMenuAnchor(null);
    setMenuRequest(null);
  };

  const handleEdit = async () => {
    if (!menuRequest) return;

    const request = menuRequest;
    handleMenuClose();

    try {
      const apiProductResponse = await fetchApi.fetch(
        `${backendUrl}/api/kuadrant/apiproducts/${request.spec.apiNamespace}/${request.spec.apiName}`
      );

      if (apiProductResponse.ok) {
        const apiProduct = await apiProductResponse.json();
        const plans = apiProduct.spec?.plans || [];
        setEditDialogState({ open: true, request, plans });
      } else {
        setEditDialogState({ open: true, request, plans: [] });
      }
    } catch (err) {
      setEditDialogState({ open: true, request, plans: [] });
    }
  };

  const handleDeleteClick = () => {
    if (!menuRequest) return;
    const request = menuRequest;
    handleMenuClose();
    setDeleteDialogState({ open: true, request });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteDialogState.request) return;

    const request = deleteDialogState.request;
    const requestName = request.metadata.name;

    setOptimisticallyDeleted(prev => new Set(prev).add(requestName));
    setDeleting(requestName);

    try {
      const response = await fetchApi.fetch(
        `${backendUrl}/api/kuadrant/requests/${request.metadata.namespace}/${request.metadata.name}`,
        { method: 'DELETE' }
      );

      if (!response.ok) {
        throw new Error('Failed to delete request');
      }

      onRefresh();
      alertApi.post({ message: 'Request deleted', severity: 'success', display: 'transient' });
      setDeleteDialogState({ open: false, request: null });
    } catch (err) {
      setOptimisticallyDeleted(prev => {
        const next = new Set(prev);
        next.delete(requestName);
        return next;
      });
      alertApi.post({ message: 'Failed to delete request', severity: 'error', display: 'transient' });
    } finally {
      setDeleting(null);
    }
  };

  const handleDeleteCancel = () => {
    setDeleteDialogState({ open: false, request: null });
  };

  const isPending = (row: APIKeyRequest) => !row.status || row.status.phase === 'Pending';

  const filteredData = requests.filter(r => !optimisticallyDeleted.has(r.metadata.name));

  const columns: TableColumn<APIKeyRequest>[] = [
    {
      title: 'API Product',
      field: 'spec.apiName',
      render: (row: APIKeyRequest) => (
        <Link to={`/catalog/default/api/${row.spec.apiName}`}>
          <strong>{row.spec.apiName}</strong>
        </Link>
      ),
    },
    {
      title: 'Tier',
      field: 'spec.planTier',
      render: (row: APIKeyRequest) => {
        const color = row.spec.planTier === 'gold' ? 'primary' :
                     row.spec.planTier === 'silver' ? 'default' : 'secondary';
        return <Chip label={row.spec.planTier} color={color} size="small" />;
      },
    },
    {
      title: 'Status',
      field: 'status.phase',
      render: (row: APIKeyRequest) => {
        const phase = row.status?.phase || 'Pending';
        const color = phase === 'Approved' ? 'primary' :
                     phase === 'Rejected' ? 'secondary' : 'default';
        return <Chip label={phase} color={color} size="small" />;
      },
    },
    {
      title: 'API Key',
      field: 'status.apiKey',
      filtering: false,
      render: (row: APIKeyRequest) => {
        if (row.status?.phase === 'Approved' && row.status.apiKey) {
          const isVisible = visibleKeys.has(row.metadata.name);
          return (
            <Box display="flex" alignItems="center" style={{ gap: 8 }}>
              <Box fontFamily="monospace" fontSize="0.875rem">
                {isVisible ? row.status.apiKey : '••••••••••••••••••••'}
              </Box>
              <Tooltip title={isVisible ? 'hide key' : 'show key'}>
                <IconButton
                  size="small"
                  onClick={() => toggleKeyVisibility(row.metadata.name)}
                >
                  {isVisible ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
            </Box>
          );
        }
        return <Typography variant="body2" color="textSecondary">-</Typography>;
      },
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
      field: 'metadata.creationTimestamp',
      render: (row: APIKeyRequest) => {
        if (!row.metadata.creationTimestamp) {
          return <Typography variant="body2">-</Typography>;
        }
        const date = new Date(row.metadata.creationTimestamp);
        return <Typography variant="body2">{date.toLocaleDateString()}</Typography>;
      },
    },
    {
      title: '',
      filtering: false,
      render: (row: APIKeyRequest) => {
        const isDeleting = deleting === row.metadata.name;
        if (isDeleting) {
          return <CircularProgress size={20} />;
        }
        return (
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              setMenuAnchor({ top: rect.bottom, left: rect.left });
              setMenuRequest(row);
            }}
          >
            <MoreVertIcon />
          </IconButton>
        );
      },
    },
  ];

  return (
    <>
      {canCreateRequest && (
        <Box display="flex" justifyContent="flex-end" mb={2}>
          <Button
            variant="contained"
            color="primary"
            startIcon={<AddIcon />}
            onClick={() => setRequestDialogOpen(true)}
          >
            Request API Key
          </Button>
        </Box>
      )}

      {filteredData.length === 0 ? (
        <Box p={3} textAlign="center">
          <Typography variant="body1" color="textSecondary">
            No API keys found matching the current filters.
          </Typography>
        </Box>
      ) : (
        <Table
          options={{
            paging: filteredData.length > 10,
            pageSize: 20,
            search: true,
            filtering: true,
            debounceInterval: 300,
            toolbar: true,
            emptyRowsWhenPaging: false,
          }}
          columns={columns}
          data={filteredData.map((item: APIKeyRequest) => ({
            ...item,
            id: item.metadata.name,
          }))}
        />
      )}

      <Menu
        open={Boolean(menuAnchor)}
        onClose={handleMenuClose}
        anchorReference="anchorPosition"
        anchorPosition={menuAnchor || { top: 0, left: 0 }}
      >
        {menuRequest && (() => {
          const items = [];
          if (isPending(menuRequest)) {
            items.push(<MenuItem key="edit" onClick={handleEdit}>Edit</MenuItem>);
          }
          items.push(<MenuItem key="delete" onClick={handleDeleteClick}>Delete</MenuItem>);
          return items;
        })()}
      </Menu>

      {editDialogState.request && (
        <EditAPIKeyRequestDialog
          open={editDialogState.open}
          request={editDialogState.request}
          availablePlans={editDialogState.plans}
          onClose={() => setEditDialogState({ open: false, request: null, plans: [] })}
          onSuccess={() => {
            setEditDialogState({ open: false, request: null, plans: [] });
            onRefresh();
          }}
        />
      )}

      <ConfirmDeleteDialog
        open={deleteDialogState.open}
        title={deleteDialogState.request?.status?.phase === 'Approved' ? 'Delete API Key' : 'Delete API Key Request'}
        description={
          deleteDialogState.request?.status?.phase === 'Approved'
            ? `This will permanently revoke the API key for ${deleteDialogState.request?.spec.apiName || 'this API'}. Applications using this key will no longer be able to authenticate.`
            : `Are you sure you want to delete the API key request for ${deleteDialogState.request?.spec.apiName || 'this API'}?`
        }
        severity={deleteDialogState.request?.status?.phase === 'Approved' ? 'high' : 'normal'}
        confirmText={deleteDialogState.request?.status?.phase === 'Approved' ? 'delete' : undefined}
        deleting={deleting !== null}
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />

      <RequestApiKeyDialog
        open={requestDialogOpen}
        onClose={() => setRequestDialogOpen(false)}
        onSuccess={onRefresh}
      />
    </>
  );
};
