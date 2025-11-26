import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Typography,
  Box,
  Grid,
  Chip,
  Button,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  IconButton,
  Tooltip,
  Card,
  CardContent,
} from '@material-ui/core';
import {
  Header,
  Page,
  Content,
  Progress,
  ResponseErrorPanel,
  CodeSnippet,
  InfoCard,
} from '@backstage/core-components';
import useAsync from 'react-use/lib/useAsync';
import { useApi, configApiRef, fetchApiRef, alertApiRef } from '@backstage/core-plugin-api';
import ArrowBackIcon from '@material-ui/icons/ArrowBack';
import ExpandMoreIcon from '@material-ui/icons/ExpandMore';
import VisibilityIcon from '@material-ui/icons/Visibility';
import VisibilityOffIcon from '@material-ui/icons/VisibilityOff';
import FileCopyIcon from '@material-ui/icons/FileCopy';
import DeleteIcon from '@material-ui/icons/Delete';
import { APIKeyRequest, Plan } from '../../types/api-management';
import { ConfirmDeleteDialog } from '../ConfirmDeleteDialog';
import {
  kuadrantApiKeyDeleteOwnPermission,
  kuadrantApiKeyDeleteAllPermission,
} from '../../permissions';
import { useKuadrantPermission, canDeleteResource } from '../../utils/permissions';

const formatLimits = (limits: Plan['limits']): string[] => {
  if (!limits) return [];
  const result: string[] = [];
  if (limits.daily) result.push(`${limits.daily}/day`);
  if (limits.weekly) result.push(`${limits.weekly}/week`);
  if (limits.monthly) result.push(`${limits.monthly}/month`);
  if (limits.yearly) result.push(`${limits.yearly}/year`);
  if (limits.custom) {
    limits.custom.forEach(c => result.push(`${c.limit}/${c.window}`));
  }
  return result;
};

export const ApiKeyDetailPage = () => {
  const { namespace, name } = useParams<{
    namespace: string;
    name: string;
  }>();
  const navigate = useNavigate();
  const config = useApi(configApiRef);
  const fetchApi = useApi(fetchApiRef);
  const alertApi = useApi(alertApiRef);
  const backendUrl = config.getString('backend.baseUrl');

  const [keyVisible, setKeyVisible] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { allowed: canDeleteOwn } = useKuadrantPermission(kuadrantApiKeyDeleteOwnPermission);
  const { allowed: canDeleteAll } = useKuadrantPermission(kuadrantApiKeyDeleteAllPermission);

  const { value: userId } = useAsync(async () => {
    const response = await fetchApi.fetch(`${backendUrl}/api/auth/v1/identity`);
    if (response.ok) {
      const identity = await response.json();
      return identity.userEntityRef || '';
    }
    return '';
  }, [backendUrl, fetchApi]);

  const { value: request, loading, error } = useAsync(async (): Promise<APIKeyRequest> => {
    const response = await fetchApi.fetch(`${backendUrl}/api/kuadrant/requests/${namespace}/${name}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch API key request: ${response.status}`);
    }
    return await response.json();
  }, [backendUrl, namespace, name, fetchApi]);

  const handleDelete = async () => {
    if (!request) return;
    setDeleting(true);
    try {
      const response = await fetchApi.fetch(
        `${backendUrl}/api/kuadrant/requests/${request.metadata.namespace}/${request.metadata.name}`,
        { method: 'DELETE' }
      );
      if (!response.ok) {
        throw new Error('Failed to delete request');
      }
      alertApi.post({ message: 'API key deleted', severity: 'success', display: 'transient' });
      navigate('/kuadrant/api-keys');
    } catch (err) {
      alertApi.post({
        message: err instanceof Error ? err.message : 'Failed to delete',
        severity: 'error',
        display: 'transient',
      });
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
    }
  };

  const handleCopyKey = () => {
    if (request?.status?.apiKey) {
      navigator.clipboard.writeText(request.status.apiKey);
      alertApi.post({ message: 'API key copied to clipboard', severity: 'info', display: 'transient' });
    }
  };

  if (loading) {
    return (
      <Page themeId="tool">
        <Header title="Loading..." />
        <Content>
          <Progress />
        </Content>
      </Page>
    );
  }

  if (error) {
    return (
      <Page themeId="tool">
        <Header title="Error" />
        <Content>
          <ResponseErrorPanel error={error} />
        </Content>
      </Page>
    );
  }

  if (!request) {
    return (
      <Page themeId="tool">
        <Header title="Not Found" />
        <Content>
          <Typography>API key request not found</Typography>
        </Content>
      </Page>
    );
  }

  const phase = request.status?.phase || 'Pending';
  const isApproved = phase === 'Approved';
  const isRejected = phase === 'Rejected';
  const ownerId = request.spec.requestedBy.userId;
  const canDelete = canDeleteResource(ownerId, userId || '', canDeleteOwn, canDeleteAll);

  const phaseColor = isApproved ? 'primary' : isRejected ? 'secondary' : 'default';

  const hostname = request.status?.apiHostname || `${request.spec.apiName}.apps.example.com`;

  return (
    <Page themeId="tool">
      <Header
        title={request.metadata.name}
        subtitle={`API Key Request for ${request.spec.apiName}`}
      >
        <Box display="flex" style={{ gap: 8 }}>
          <Button
            variant="outlined"
            startIcon={<ArrowBackIcon />}
            onClick={() => navigate('/kuadrant/api-keys')}
          >
            Back to API Keys
          </Button>
          {canDelete && (
            <Button
              variant="outlined"
              color="secondary"
              startIcon={<DeleteIcon />}
              onClick={() => setDeleteDialogOpen(true)}
            >
              Delete
            </Button>
          )}
        </Box>
      </Header>
      <Content>
        <Grid container spacing={3}>
          {/* Status Section */}
          <Grid item xs={12}>
            <InfoCard title="Status">
              <Box p={2}>
                <Grid container spacing={3}>
                  <Grid item xs={12} md={3}>
                    <Typography variant="body2" color="textSecondary">
                      Status
                    </Typography>
                    <Box mt={1}>
                      <Chip label={phase} color={phaseColor} />
                    </Box>
                  </Grid>
                  <Grid item xs={12} md={3}>
                    <Typography variant="body2" color="textSecondary">
                      Tier
                    </Typography>
                    <Box mt={1}>
                      <Chip label={request.spec.planTier} variant="outlined" />
                    </Box>
                  </Grid>
                  <Grid item xs={12} md={3}>
                    <Typography variant="body2" color="textSecondary">
                      Requested
                    </Typography>
                    <Typography variant="body1">
                      {request.metadata.creationTimestamp
                        ? new Date(request.metadata.creationTimestamp).toLocaleDateString()
                        : '-'}
                    </Typography>
                  </Grid>
                  {request.status?.reviewedAt && (
                    <Grid item xs={12} md={3}>
                      <Typography variant="body2" color="textSecondary">
                        Reviewed
                      </Typography>
                      <Typography variant="body1">
                        {new Date(request.status.reviewedAt).toLocaleDateString()}
                      </Typography>
                    </Grid>
                  )}
                </Grid>
              </Box>
            </InfoCard>
          </Grid>

          {/* API Key Section - only for approved */}
          {isApproved && request.status?.apiKey && (
            <Grid item xs={12}>
              <InfoCard title="API Key">
                <Box p={2}>
                  <Box display="flex" alignItems="center" style={{ gap: 8 }}>
                    <Box
                      p={2}
                      bgcolor="background.default"
                      borderRadius={1}
                      fontFamily="monospace"
                      fontSize="1rem"
                      flexGrow={1}
                      style={{ wordBreak: 'break-all' }}
                    >
                      {keyVisible ? request.status.apiKey : '•'.repeat(40)}
                    </Box>
                    <Tooltip title={keyVisible ? 'Hide key' : 'Show key'}>
                      <IconButton onClick={() => setKeyVisible(!keyVisible)}>
                        {keyVisible ? <VisibilityOffIcon /> : <VisibilityIcon />}
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Copy to clipboard">
                      <IconButton onClick={handleCopyKey}>
                        <FileCopyIcon />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>
              </InfoCard>
            </Grid>
          )}

          {/* Rejection Reason - only for rejected */}
          {isRejected && request.status?.reason && (
            <Grid item xs={12}>
              <Card style={{ borderLeft: '4px solid #f44336' }}>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Rejection Reason
                  </Typography>
                  <Typography variant="body1">
                    {request.status.reason}
                  </Typography>
                  {request.status.reviewedBy && (
                    <Typography variant="caption" color="textSecondary" style={{ marginTop: 8, display: 'block' }}>
                      Reviewed by: {request.status.reviewedBy}
                    </Typography>
                  )}
                </CardContent>
              </Card>
            </Grid>
          )}

          {/* Request Details */}
          <Grid item xs={12}>
            <InfoCard title="Request Details">
              <Box p={2}>
                <Grid container spacing={3}>
                  <Grid item xs={12} md={6}>
                    <Typography variant="body2" color="textSecondary">
                      API
                    </Typography>
                    <Typography variant="body1">
                      <strong>{request.spec.apiName}</strong>
                    </Typography>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Typography variant="body2" color="textSecondary">
                      Namespace
                    </Typography>
                    <Typography variant="body1">
                      {request.spec.apiNamespace}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Typography variant="body2" color="textSecondary">
                      Requested By
                    </Typography>
                    <Typography variant="body1">
                      {request.spec.requestedBy.userId}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Typography variant="body2" color="textSecondary">
                      Email
                    </Typography>
                    <Typography variant="body1">
                      {request.spec.requestedBy.email || '-'}
                    </Typography>
                  </Grid>
                  {request.spec.useCase && (
                    <Grid item xs={12}>
                      <Typography variant="body2" color="textSecondary">
                        Use Case
                      </Typography>
                      <Box
                        mt={1}
                        p={2}
                        bgcolor="background.default"
                        borderRadius={1}
                        style={{ whiteSpace: 'pre-wrap' }}
                      >
                        <Typography variant="body1">
                          {request.spec.useCase}
                        </Typography>
                      </Box>
                    </Grid>
                  )}
                </Grid>
              </Box>
            </InfoCard>
          </Grid>

          {/* Rate Limits - only for approved */}
          {isApproved && request.status?.planLimits && (
            <Grid item xs={12}>
              <InfoCard title="Rate Limits">
                <Box p={2}>
                  {formatLimits(request.status.planLimits).length > 0 ? (
                    <Box display="flex" flexWrap="wrap" style={{ gap: 8 }}>
                      {formatLimits(request.status.planLimits).map((limit, idx) => (
                        <Chip key={idx} label={limit} variant="outlined" />
                      ))}
                    </Box>
                  ) : (
                    <Typography variant="body2" color="textSecondary">
                      No rate limits configured
                    </Typography>
                  )}
                </Box>
              </InfoCard>
            </Grid>
          )}

          {/* Usage Examples - only for approved */}
          {isApproved && request.status?.apiKey && (
            <Grid item xs={12}>
              <InfoCard title="Usage Examples">
                <Box p={2}>
                  <Typography variant="body2" paragraph>
                    Use these code examples to test the API with your key.
                  </Typography>
                  <Accordion defaultExpanded>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography>cURL</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Box width="100%">
                        <CodeSnippet
                          text={`curl -X GET https://${hostname}/api/v1/endpoint \\
  -H "Authorization: Bearer ${request.status.apiKey}"`}
                          language="bash"
                          showCopyCodeButton
                        />
                      </Box>
                    </AccordionDetails>
                  </Accordion>
                  <Accordion>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography>Node.js</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Box width="100%">
                        <CodeSnippet
                          text={`const fetch = require('node-fetch');

const apiKey = '${request.status.apiKey}';
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
                      </Box>
                    </AccordionDetails>
                  </Accordion>
                  <Accordion>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography>Python</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Box width="100%">
                        <CodeSnippet
                          text={`import requests

api_key = '${request.status.apiKey}'
endpoint = 'https://${hostname}/api/v1/endpoint'

headers = {
    'Authorization': f'Bearer {api_key}'
}

response = requests.get(endpoint, headers=headers)
print(response.json())`}
                          language="python"
                          showCopyCodeButton
                        />
                      </Box>
                    </AccordionDetails>
                  </Accordion>
                  <Accordion>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography>Go</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Box width="100%">
                        <CodeSnippet
                          text={`package main

import (
    "fmt"
    "net/http"
    "io"
)

func main() {
    apiKey := "${request.status.apiKey}"
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
                      </Box>
                    </AccordionDetails>
                  </Accordion>
                </Box>
              </InfoCard>
            </Grid>
          )}

          {/* YAML View */}
          <Grid item xs={12}>
            <Accordion>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="h6">View Full YAML</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Box width="100%">
                  <CodeSnippet
                    text={JSON.stringify(request, null, 2)}
                    language="yaml"
                    showCopyCodeButton
                  />
                </Box>
              </AccordionDetails>
            </Accordion>
          </Grid>
        </Grid>

        <ConfirmDeleteDialog
          open={deleteDialogOpen}
          title={isApproved ? 'Delete API Key' : 'Delete API Key Request'}
          description={
            isApproved
              ? `This will permanently revoke the API key for ${request.spec.apiName}. Applications using this key will no longer be able to authenticate.`
              : `Are you sure you want to delete the API key request for ${request.spec.apiName}?`
          }
          severity={isApproved ? 'high' : 'normal'}
          confirmText={isApproved ? 'delete' : undefined}
          deleting={deleting}
          onConfirm={handleDelete}
          onCancel={() => setDeleteDialogOpen(false)}
        />
      </Content>
    </Page>
  );
};
