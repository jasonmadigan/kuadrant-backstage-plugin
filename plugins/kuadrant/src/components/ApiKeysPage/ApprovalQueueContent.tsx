import React, { useState, useEffect } from 'react';
import { useApi, fetchApiRef, identityApiRef, configApiRef, alertApiRef } from '@backstage/core-plugin-api';
import { useAsync } from 'react-use';
import {
  Table,
  TableColumn,
  Link,
} from '@backstage/core-components';
import { kuadrantApiKeyRequestUpdateAllPermission, kuadrantApiKeyRequestUpdateOwnPermission } from '../../permissions';
import { useKuadrantPermission } from '../../utils/permissions';
import {
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Chip,
  Typography,
  Box,
  Tooltip,
  CircularProgress,
} from '@material-ui/core';
import CheckCircleIcon from '@material-ui/icons/CheckCircle';
import CancelIcon from '@material-ui/icons/Cancel';
import { APIKeyRequest } from '../../types/api-management';

interface ApprovalDialogProps {
  open: boolean;
  request: APIKeyRequest | null;
  action: 'approve' | 'reject';
  processing: boolean;
  onClose: () => void;
  onConfirm: (comment: string) => void;
}

const ApprovalDialog = ({ open, request, action, processing, onClose, onConfirm }: ApprovalDialogProps) => {
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (!open) {
      setComment('');
    }
  }, [open]);

  const handleConfirm = () => {
    onConfirm(comment);
  };

  const isReject = action === 'reject';
  const actionLabel = isReject ? 'Reject' : 'Approve';
  const processingLabel = isReject ? 'Rejecting...' : 'Approving...';
  const canConfirm = isReject ? comment.trim().length > 0 : true;

  return (
    <Dialog open={open} onClose={processing ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" style={{ gap: 8 }}>
          {isReject ? <CancelIcon color="error" /> : <CheckCircleIcon color="primary" />}
          <span>{actionLabel} API Key Request</span>
        </Box>
      </DialogTitle>
      <DialogContent>
        {request && (
          <>
            {isReject ? (
              <Box mb={2} p={2} bgcolor="error.dark" borderRadius={1}>
                <Typography variant="body2" style={{ color: '#fff' }}>
                  This action cannot be undone. This will permanently deny this access request. The applicant will be notified.
                </Typography>
              </Box>
            ) : (
              <Box mb={2} p={2} bgcolor="primary.dark" borderRadius={1}>
                <Typography variant="body2" style={{ color: '#fff' }}>
                  This will generate an API key and grant access to the requested API. The applicant will be notified.
                </Typography>
              </Box>
            )}
            <Box mb={2}>
              <Typography variant="body2"><strong>User:</strong> {request.spec.requestedBy.userId}</Typography>
              <Typography variant="body2"><strong>API:</strong> {request.spec.apiName}</Typography>
              <Typography variant="body2"><strong>Tier:</strong> {request.spec.planTier}</Typography>
              {request.spec.useCase && (
                <Typography variant="body2"><strong>Use Case:</strong> {request.spec.useCase}</Typography>
              )}
            </Box>
            <TextField
              label={isReject ? 'Reason for rejection (required)' : 'Comment (optional)'}
              placeholder={isReject ? 'Provide the requester with a reason for this rejection' : ''}
              multiline
              rows={3}
              fullWidth
              margin="normal"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              disabled={processing}
              required={isReject}
              error={isReject && comment.trim().length === 0}
            />
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={processing}>Cancel</Button>
        <Button
          onClick={handleConfirm}
          color={isReject ? 'secondary' : 'primary'}
          variant="contained"
          disabled={processing || !canConfirm}
          startIcon={processing ? <CircularProgress size={16} color="inherit" /> : (isReject ? <CancelIcon /> : <CheckCircleIcon />)}
        >
          {processing ? processingLabel : actionLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

interface BulkActionDialogProps {
  open: boolean;
  requests: APIKeyRequest[];
  action: 'approve' | 'reject';
  processing: boolean;
  onClose: () => void;
  onConfirm: (comment: string) => void;
}

const BulkActionDialog = ({ open, requests, action, processing, onClose, onConfirm }: BulkActionDialogProps) => {
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (!open) {
      setComment('');
    }
  }, [open]);

  const handleConfirm = () => {
    onConfirm(comment);
  };

  const isApprove = action === 'approve';
  const isReject = !isApprove;
  const actionLabel = isApprove ? 'Approve All' : 'Reject All';
  const processingLabel = isApprove ? 'Approving...' : 'Rejecting...';
  const canConfirm = isReject ? comment.trim().length > 0 : true;

  return (
    <Dialog open={open} onClose={processing ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" style={{ gap: 8 }}>
          {isReject ? <CancelIcon color="error" /> : <CheckCircleIcon color="primary" />}
          <span>{isApprove ? 'Approve' : 'Reject'} {requests.length} API Key Requests</span>
        </Box>
      </DialogTitle>
      <DialogContent>
        {isReject ? (
          <Box mb={2} p={2} bgcolor="error.dark" borderRadius={1}>
            <Typography variant="body2" style={{ color: '#fff' }}>
              This action cannot be undone. This will permanently deny these access requests. The applicants will be notified.
            </Typography>
          </Box>
        ) : (
          <Box mb={2} p={2} bgcolor="primary.dark" borderRadius={1}>
            <Typography variant="body2" style={{ color: '#fff' }}>
              This will generate API keys and grant access for all selected requests. The applicants will be notified.
            </Typography>
          </Box>
        )}
        <Typography variant="body2" paragraph>
          You are about to {isApprove ? 'approve' : 'reject'} the following requests:
        </Typography>
        <Box mb={2} maxHeight={200} overflow="auto">
          {requests.map(request => (
            <Box key={`${request.metadata.namespace}/${request.metadata.name}`} mb={1} p={1} bgcolor="background.default">
              <Typography variant="body2">
                <strong>{request.spec.requestedBy.userId}</strong> - {request.spec.apiName} ({request.spec.planTier})
              </Typography>
            </Box>
          ))}
        </Box>
        <TextField
          label={isReject ? 'Reason for rejection (required)' : 'Comment (optional)'}
          placeholder={isReject ? 'Provide the requesters with a reason for this rejection' : ''}
          multiline
          rows={3}
          fullWidth
          margin="normal"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          helperText={`This ${isReject ? 'reason' : 'comment'} will be applied to all ${isApprove ? 'approved' : 'rejected'} requests`}
          disabled={processing}
          required={isReject}
          error={isReject && comment.trim().length === 0}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={processing}>Cancel</Button>
        <Button
          onClick={handleConfirm}
          color={isApprove ? 'primary' : 'secondary'}
          variant="contained"
          disabled={processing || !canConfirm}
          startIcon={processing ? <CircularProgress size={16} color="inherit" /> : (isReject ? <CancelIcon /> : <CheckCircleIcon />)}
        >
          {processing ? processingLabel : actionLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

interface ApprovalQueueContentProps {
  requests: APIKeyRequest[];
  onRefresh: () => void;
}

export const ApprovalQueueContent = ({ requests, onRefresh }: ApprovalQueueContentProps) => {
  const config = useApi(configApiRef);
  const fetchApi = useApi(fetchApiRef);
  const identityApi = useApi(identityApiRef);
  const alertApi = useApi(alertApiRef);
  const backendUrl = config.getString('backend.baseUrl');

  const [selectedRequests, setSelectedRequests] = useState<APIKeyRequest[]>([]);
  const [dialogState, setDialogState] = useState<{
    open: boolean;
    request: APIKeyRequest | null;
    action: 'approve' | 'reject';
    processing: boolean;
  }>({
    open: false,
    request: null,
    action: 'approve',
    processing: false,
  });
  const [bulkDialogState, setBulkDialogState] = useState<{
    open: boolean;
    requests: APIKeyRequest[];
    action: 'approve' | 'reject';
    processing: boolean;
  }>({
    open: false,
    requests: [],
    action: 'approve',
    processing: false,
  });

  const {
    allowed: canUpdateAllRequests,
  } = useKuadrantPermission(kuadrantApiKeyRequestUpdateAllPermission);

  const {
    allowed: canUpdateOwnRequests,
  } = useKuadrantPermission(kuadrantApiKeyRequestUpdateOwnPermission);

  const canUpdateRequests = canUpdateAllRequests || canUpdateOwnRequests;

  const { value: identity } = useAsync(async () => {
    return await identityApi.getBackstageIdentity();
  }, [identityApi]);

  // clear selection when requests change (e.g. after filtering)
  useEffect(() => {
    setSelectedRequests([]);
  }, [requests]);

  const handleApprove = (request: APIKeyRequest) => {
    setDialogState({ open: true, request, action: 'approve', processing: false });
  };

  const handleReject = (request: APIKeyRequest) => {
    setDialogState({ open: true, request, action: 'reject', processing: false });
  };

  const handleConfirm = async (comment: string) => {
    if (!dialogState.request || !identity) return;

    setDialogState(prev => ({ ...prev, processing: true }));

    const endpoint = dialogState.action === 'approve'
      ? `${backendUrl}/api/kuadrant/requests/${dialogState.request.metadata.namespace}/${dialogState.request.metadata.name}/approve`
      : `${backendUrl}/api/kuadrant/requests/${dialogState.request.metadata.namespace}/${dialogState.request.metadata.name}/reject`;

    try {
      const response = await fetchApi.fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comment,
          reviewedBy: identity.userEntityRef,
        }),
      });

      if (!response.ok) {
        throw new Error(`failed to ${dialogState.action} request`);
      }

      setDialogState({ open: false, request: null, action: 'approve', processing: false });
      onRefresh();
      const action = dialogState.action === 'approve' ? 'approved' : 'rejected';
      alertApi.post({ message: `Request ${action}`, severity: 'success', display: 'transient' });
    } catch (err) {
      setDialogState(prev => ({ ...prev, processing: false }));
      alertApi.post({ message: `Failed to ${dialogState.action} request`, severity: 'error', display: 'transient' });
    }
  };

  const handleBulkApprove = () => {
    if (selectedRequests.length === 0) return;
    setBulkDialogState({ open: true, requests: selectedRequests, action: 'approve', processing: false });
  };

  const handleBulkReject = () => {
    if (selectedRequests.length === 0) return;
    setBulkDialogState({ open: true, requests: selectedRequests, action: 'reject', processing: false });
  };

  const handleBulkConfirm = async (comment: string) => {
    if (!identity || bulkDialogState.requests.length === 0) return;

    setBulkDialogState(prev => ({ ...prev, processing: true }));

    const isApprove = bulkDialogState.action === 'approve';
    const endpoint = isApprove
      ? `${backendUrl}/api/kuadrant/requests/bulk-approve`
      : `${backendUrl}/api/kuadrant/requests/bulk-reject`;

    try {
      const response = await fetchApi.fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: bulkDialogState.requests.map(r => ({
            namespace: r.metadata.namespace,
            name: r.metadata.name,
          })),
          comment,
          reviewedBy: identity.userEntityRef,
        }),
      });

      if (!response.ok) {
        throw new Error(`failed to bulk ${bulkDialogState.action} requests`);
      }

      const count = bulkDialogState.requests.length;
      const action = isApprove ? 'approved' : 'rejected';
      setBulkDialogState({ open: false, requests: [], action: 'approve', processing: false });
      setSelectedRequests([]);
      onRefresh();
      alertApi.post({ message: `${count} requests ${action}`, severity: 'success', display: 'transient' });
    } catch (err) {
      setBulkDialogState(prev => ({ ...prev, processing: false }));
      alertApi.post({ message: `Failed to bulk ${bulkDialogState.action} requests`, severity: 'error', display: 'transient' });
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  // only pending requests can be selected for bulk actions
  const pendingRequests = requests.filter(r => !r.status?.phase || r.status.phase === 'Pending');
  const hasPendingRequests = pendingRequests.length > 0;
  const selectedPendingCount = selectedRequests.filter(r => !r.status?.phase || r.status.phase === 'Pending').length;

  const columns: TableColumn<APIKeyRequest>[] = [
    {
      title: 'Client',
      field: 'spec.requestedBy.userId',
      render: (row) => <Typography variant="body2">{row.spec.requestedBy.userId}</Typography>,
    },
    {
      title: 'API',
      field: 'spec.apiName',
      render: (row) => (
        <Link to={`/catalog/default/api/${row.spec.apiName}`}>
          <strong>{row.spec.apiName}</strong>
        </Link>
      ),
    },
    {
      title: 'Tier',
      field: 'spec.planTier',
      render: (row) => (
        <Chip
          label={row.spec.planTier}
          size="small"
        />
      ),
    },
    {
      title: 'Status',
      field: 'status.phase',
      render: (row) => {
        const phase = row.status?.phase || 'Pending';
        const color = phase === 'Approved' ? 'primary' :
                     phase === 'Rejected' ? 'secondary' : 'default';
        return <Chip label={phase} color={color} size="small" />;
      },
    },
    {
      title: 'Use Case',
      field: 'spec.useCase',
      render: (row) => {
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
      render: (row) => (
        <Typography variant="body2">
          {row.metadata.creationTimestamp ? formatDate(row.metadata.creationTimestamp) : '-'}
        </Typography>
      ),
    },
    {
      title: 'Actions',
      filtering: false,
      render: (row) => {
        const phase = row.status?.phase || 'Pending';
        if (phase !== 'Pending' || !canUpdateRequests) return null;
        return (
          <Box display="flex" style={{ gap: 8 }}>
            <Button
              size="small"
              startIcon={<CheckCircleIcon />}
              onClick={() => handleApprove(row)}
              color="primary"
              variant="outlined"
            >
              Approve
            </Button>
            <Button
              size="small"
              startIcon={<CancelIcon />}
              onClick={() => handleReject(row)}
              color="secondary"
              variant="outlined"
            >
              Reject
            </Button>
          </Box>
        );
      },
    },
  ];

  // prepare data with selection state for pending requests
  const tableData = requests.map((item: APIKeyRequest) => {
    const isPending = !item.status?.phase || item.status.phase === 'Pending';
    const isSelected = selectedRequests.some(
      selected => selected.metadata.name === item.metadata.name &&
                 selected.metadata.namespace === item.metadata.namespace
    );
    return {
      ...item,
      id: item.metadata.name,
      tableData: { checked: isSelected, disabled: !isPending },
    };
  });

  return (
    <>
      {canUpdateRequests && hasPendingRequests && selectedPendingCount > 0 && (
        <Box mb={2} display="flex" alignItems="center" justifyContent="space-between" p={2} bgcolor="background.default" borderRadius={4}>
          <Typography variant="body2">
            {selectedPendingCount} request{selectedPendingCount !== 1 ? 's' : ''} selected
          </Typography>
          <Box display="flex" style={{ gap: 8 }}>
            <Button
              size="small"
              variant="contained"
              color="primary"
              startIcon={<CheckCircleIcon />}
              onClick={handleBulkApprove}
            >
              Approve Selected
            </Button>
            <Button
              size="small"
              variant="contained"
              color="secondary"
              startIcon={<CancelIcon />}
              onClick={handleBulkReject}
            >
              Reject Selected
            </Button>
          </Box>
        </Box>
      )}

      {requests.length === 0 ? (
        <Box p={3} textAlign="center">
          <Typography variant="body1" color="textSecondary">
            No API key requests found matching the current filters.
          </Typography>
        </Box>
      ) : (
        <Table
          options={{
            selection: canUpdateRequests && hasPendingRequests,
            paging: requests.length > 10,
            pageSize: 20,
            search: true,
            filtering: true,
            debounceInterval: 300,
            toolbar: true,
            emptyRowsWhenPaging: false,
            showTextRowsSelected: false,
          }}
          columns={columns}
          data={tableData}
          onSelectionChange={(rows) => {
            // only keep pending requests in selection
            const pendingOnly = (rows as APIKeyRequest[]).filter(
              r => !r.status?.phase || r.status.phase === 'Pending'
            );
            setSelectedRequests(pendingOnly);
          }}
        />
      )}

      <ApprovalDialog
        open={dialogState.open}
        request={dialogState.request}
        action={dialogState.action}
        processing={dialogState.processing}
        onClose={() => setDialogState({ open: false, request: null, action: 'approve', processing: false })}
        onConfirm={handleConfirm}
      />

      <BulkActionDialog
        open={bulkDialogState.open}
        requests={bulkDialogState.requests}
        action={bulkDialogState.action}
        processing={bulkDialogState.processing}
        onClose={() => setBulkDialogState({ open: false, requests: [], action: 'approve', processing: false })}
        onConfirm={handleBulkConfirm}
      />
    </>
  );
};
