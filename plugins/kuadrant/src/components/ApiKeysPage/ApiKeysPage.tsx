import React, { useState, useMemo } from 'react';
import { Box, Tabs, Tab, makeStyles } from '@material-ui/core';
import {
  Header,
  Page,
  Content,
  SupportButton,
  Progress,
} from '@backstage/core-components';
import { useApi, configApiRef, fetchApiRef, identityApiRef } from '@backstage/core-plugin-api';
import useAsync from 'react-use/lib/useAsync';
import { MyApiKeysContent } from './MyApiKeysContent';
import { ApprovalQueueContent } from './ApprovalQueueContent';
import { ApiKeysFilterSidebar, StatusCounts } from './ApiKeysFilterSidebar';
import { useKuadrantPermission } from '../../utils/permissions';
import {
  kuadrantApiKeyRequestReadAllPermission,
  kuadrantApiKeyRequestReadOwnPermission,
} from '../../permissions';
import { APIKeyRequest } from '../../types/api-management';

const useStyles = makeStyles((theme) => ({
  container: {
    display: 'flex',
    gap: theme.spacing(3),
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
}));

export const ApiKeysPage = () => {
  const classes = useStyles();
  const config = useApi(configApiRef);
  const fetchApi = useApi(fetchApiRef);
  const identityApi = useApi(identityApiRef);
  const backendUrl = config.getString('backend.baseUrl');

  const [selectedTab, setSelectedTab] = useState(0);
  const [refresh, setRefresh] = useState(0);

  // my api keys filter state
  const [mySelectedStatus, setMySelectedStatus] = useState('all');
  const [mySelectedTier, setMySelectedTier] = useState('');
  const [mySelectedApi, setMySelectedApi] = useState('');

  // approval queue filter state
  const [approvalSelectedStatus, setApprovalSelectedStatus] = useState('all');
  const [approvalSelectedTier, setApprovalSelectedTier] = useState('');
  const [approvalSelectedApi, setApprovalSelectedApi] = useState('');
  const [approvalSelectedClient, setApprovalSelectedClient] = useState('');

  const {
    allowed: canViewAllRequests,
    loading: viewAllLoading,
  } = useKuadrantPermission(kuadrantApiKeyRequestReadAllPermission);

  const {
    allowed: canViewOwnRequests,
    loading: viewOwnLoading,
  } = useKuadrantPermission(kuadrantApiKeyRequestReadOwnPermission);

  const canViewApprovalQueue = canViewAllRequests || canViewOwnRequests;
  const permissionLoading = viewAllLoading || viewOwnLoading;

  // fetch user's api key requests (my api keys tab)
  const { value: myRequests, loading: myRequestsLoading } = useAsync(async () => {
    await identityApi.getBackstageIdentity();
    const response = await fetchApi.fetch(`${backendUrl}/api/kuadrant/requests/my`);
    if (!response.ok) {
      throw new Error('failed to fetch requests');
    }
    const data = await response.json();
    return (data.items || []) as APIKeyRequest[];
  }, [backendUrl, fetchApi, identityApi, refresh]);

  // fetch all api key requests (approval queue tab)
  const { value: allRequests, loading: allRequestsLoading } = useAsync(async () => {
    if (!canViewApprovalQueue) return [];
    const response = await fetchApi.fetch(`${backendUrl}/api/kuadrant/requests`);
    if (!response.ok) {
      return [];
    }
    const data = await response.json();
    return (data.items || []) as APIKeyRequest[];
  }, [backendUrl, fetchApi, canViewApprovalQueue, refresh]);

  const myRequestsList = myRequests || [];
  const allRequestsList = allRequests || [];

  // compute status counts for my api keys
  const myStatusCounts: StatusCounts = useMemo(() => {
    const active = myRequestsList.filter(r => r.status?.phase === 'Approved').length;
    const pending = myRequestsList.filter(r => !r.status?.phase || r.status.phase === 'Pending').length;
    const rejected = myRequestsList.filter(r => r.status?.phase === 'Rejected').length;
    return {
      all: myRequestsList.length,
      active,
      pending,
      rejected,
    };
  }, [myRequestsList]);

  // compute status counts for approval queue
  const approvalStatusCounts: StatusCounts = useMemo(() => {
    const active = allRequestsList.filter(r => r.status?.phase === 'Approved').length;
    const pending = allRequestsList.filter(r => !r.status?.phase || r.status.phase === 'Pending').length;
    const rejected = allRequestsList.filter(r => r.status?.phase === 'Rejected').length;
    return {
      all: allRequestsList.length,
      active,
      pending,
      rejected,
    };
  }, [allRequestsList]);

  // extract unique tiers and apis for my api keys
  const { myTiers, myApis } = useMemo(() => {
    const tierSet = new Set<string>();
    const apiSet = new Set<string>();
    myRequestsList.forEach(r => {
      if (r.spec.planTier) tierSet.add(r.spec.planTier);
      if (r.spec.apiName) apiSet.add(r.spec.apiName);
    });
    return {
      myTiers: Array.from(tierSet).sort(),
      myApis: Array.from(apiSet).sort(),
    };
  }, [myRequestsList]);

  // extract unique tiers, apis, and clients for approval queue
  const { approvalTiers, approvalApis, approvalClients } = useMemo(() => {
    const tierSet = new Set<string>();
    const apiSet = new Set<string>();
    const clientSet = new Set<string>();
    allRequestsList.forEach(r => {
      if (r.spec.planTier) tierSet.add(r.spec.planTier);
      if (r.spec.apiName) apiSet.add(r.spec.apiName);
      if (r.spec.requestedBy?.userId) clientSet.add(r.spec.requestedBy.userId);
    });
    return {
      approvalTiers: Array.from(tierSet).sort(),
      approvalApis: Array.from(apiSet).sort(),
      approvalClients: Array.from(clientSet).sort(),
    };
  }, [allRequestsList]);

  // filter my api keys
  const filteredMyRequests = useMemo(() => {
    let result = myRequestsList;

    if (mySelectedStatus === 'active') {
      result = result.filter(r => r.status?.phase === 'Approved');
    } else if (mySelectedStatus === 'pending') {
      result = result.filter(r => !r.status?.phase || r.status.phase === 'Pending');
    } else if (mySelectedStatus === 'rejected') {
      result = result.filter(r => r.status?.phase === 'Rejected');
    }

    if (mySelectedTier) {
      result = result.filter(r => r.spec.planTier === mySelectedTier);
    }

    if (mySelectedApi) {
      result = result.filter(r => r.spec.apiName === mySelectedApi);
    }

    return result;
  }, [myRequestsList, mySelectedStatus, mySelectedTier, mySelectedApi]);

  // filter approval queue
  const filteredApprovalRequests = useMemo(() => {
    let result = allRequestsList;

    if (approvalSelectedStatus === 'active') {
      result = result.filter(r => r.status?.phase === 'Approved');
    } else if (approvalSelectedStatus === 'pending') {
      result = result.filter(r => !r.status?.phase || r.status.phase === 'Pending');
    } else if (approvalSelectedStatus === 'rejected') {
      result = result.filter(r => r.status?.phase === 'Rejected');
    }

    if (approvalSelectedTier) {
      result = result.filter(r => r.spec.planTier === approvalSelectedTier);
    }

    if (approvalSelectedApi) {
      result = result.filter(r => r.spec.apiName === approvalSelectedApi);
    }

    if (approvalSelectedClient) {
      result = result.filter(r => r.spec.requestedBy?.userId === approvalSelectedClient);
    }

    return result;
  }, [allRequestsList, approvalSelectedStatus, approvalSelectedTier, approvalSelectedApi, approvalSelectedClient]);

  const handleRefresh = () => setRefresh(r => r + 1);

  const loading = selectedTab === 0 ? myRequestsLoading : allRequestsLoading;

  if (loading) {
    return (
      <Page themeId="tool">
        <Header title="API Keys" subtitle="API keys management for Kubernetes">
          <SupportButton>Manage your API keys and access requests</SupportButton>
        </Header>
        <Content>
          <Progress />
        </Content>
      </Page>
    );
  }

  return (
    <Page themeId="tool">
      <Header title="API Keys" subtitle="API keys management for Kubernetes">
        <SupportButton>Manage your API keys and access requests</SupportButton>
      </Header>
      <Content>
        <Box mb={2}>
          <Tabs
            value={selectedTab}
            onChange={(_, newValue) => setSelectedTab(newValue)}
            indicatorColor="primary"
            textColor="primary"
          >
            <Tab label="My API Keys" />
            {!permissionLoading && canViewApprovalQueue && (
              <Tab label="API Keys Approval" />
            )}
          </Tabs>
        </Box>

        <Box className={classes.container}>
          {selectedTab === 0 && (
            <ApiKeysFilterSidebar
              statusCounts={myStatusCounts}
              selectedStatus={mySelectedStatus}
              onStatusChange={setMySelectedStatus}
              tiers={myTiers}
              selectedTier={mySelectedTier}
              onTierChange={setMySelectedTier}
              apis={myApis}
              selectedApi={mySelectedApi}
              onApiChange={setMySelectedApi}
            />
          )}

          {selectedTab === 1 && canViewApprovalQueue && (
            <ApiKeysFilterSidebar
              statusCounts={approvalStatusCounts}
              selectedStatus={approvalSelectedStatus}
              onStatusChange={setApprovalSelectedStatus}
              tiers={approvalTiers}
              selectedTier={approvalSelectedTier}
              onTierChange={setApprovalSelectedTier}
              apis={approvalApis}
              selectedApi={approvalSelectedApi}
              onApiChange={setApprovalSelectedApi}
              showClientFilter
              clients={approvalClients}
              selectedClient={approvalSelectedClient}
              onClientChange={setApprovalSelectedClient}
            />
          )}

          <Box className={classes.content}>
            {selectedTab === 0 && (
              <MyApiKeysContent
                requests={filteredMyRequests}
                onRefresh={handleRefresh}
              />
            )}

            {selectedTab === 1 && canViewApprovalQueue && (
              <ApprovalQueueContent
                requests={filteredApprovalRequests}
                onRefresh={handleRefresh}
              />
            )}
          </Box>
        </Box>
      </Content>
    </Page>
  );
};
