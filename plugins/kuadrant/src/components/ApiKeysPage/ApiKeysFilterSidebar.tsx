import React from 'react';
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemText,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  makeStyles,
} from '@material-ui/core';

const useStyles = makeStyles((theme) => ({
  sidebar: {
    width: 240,
    flexShrink: 0,
    paddingRight: theme.spacing(3),
    borderRight: `1px solid ${theme.palette.divider}`,
  },
  sectionTitle: {
    fontWeight: 600,
    marginBottom: theme.spacing(1),
    marginTop: theme.spacing(2),
    color: theme.palette.text.secondary,
    fontSize: '0.75rem',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  statusItem: {
    borderRadius: theme.spacing(0.5),
    marginBottom: theme.spacing(0.5),
    '&.Mui-selected': {
      backgroundColor: theme.palette.action.selected,
    },
    '&:hover': {
      backgroundColor: theme.palette.action.hover,
    },
  },
  statusBadge: {
    marginLeft: 'auto',
  },
  filterControl: {
    marginTop: theme.spacing(1),
    marginBottom: theme.spacing(1),
  },
}));

export interface StatusCounts {
  all: number;
  active: number;
  pending: number;
  rejected: number;
}

export interface ApiKeysFilterSidebarProps {
  statusCounts: StatusCounts;
  selectedStatus: string;
  onStatusChange: (status: string) => void;
  tiers: string[];
  selectedTier: string;
  onTierChange: (tier: string) => void;
  apis: string[];
  selectedApi: string;
  onApiChange: (api: string) => void;
  clients?: string[];
  selectedClient?: string;
  onClientChange?: (client: string) => void;
  showClientFilter?: boolean;
}

export const ApiKeysFilterSidebar = ({
  statusCounts,
  selectedStatus,
  onStatusChange,
  tiers,
  selectedTier,
  onTierChange,
  apis,
  selectedApi,
  onApiChange,
  clients = [],
  selectedClient = '',
  onClientChange,
  showClientFilter = false,
}: ApiKeysFilterSidebarProps) => {
  const classes = useStyles();

  const statusItems = [
    { key: 'all', label: 'All', count: statusCounts.all },
    { key: 'active', label: 'Active', count: statusCounts.active },
    { key: 'pending', label: 'Pending', count: statusCounts.pending },
    { key: 'rejected', label: 'Rejected', count: statusCounts.rejected },
  ];

  return (
    <Box className={classes.sidebar}>
      <Typography className={classes.sectionTitle}>Status</Typography>
      <List dense disablePadding>
        {statusItems.map((item) => (
          <ListItem
            key={item.key}
            button
            selected={selectedStatus === item.key}
            onClick={() => onStatusChange(item.key)}
            className={classes.statusItem}
          >
            <ListItemText primary={item.label} />
            <Chip
              size="small"
              label={item.count}
              className={classes.statusBadge}
              color={selectedStatus === item.key ? 'primary' : 'default'}
            />
          </ListItem>
        ))}
      </List>

      <Typography className={classes.sectionTitle}>Filters</Typography>

      <FormControl fullWidth size="small" className={classes.filterControl}>
        <InputLabel>Tier</InputLabel>
        <Select
          value={selectedTier}
          onChange={(e) => onTierChange(e.target.value as string)}
          label="Tier"
        >
          <MenuItem value="">All Tiers</MenuItem>
          {tiers.map((tier) => (
            <MenuItem key={tier} value={tier}>
              {tier}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl fullWidth size="small" className={classes.filterControl}>
        <InputLabel>API</InputLabel>
        <Select
          value={selectedApi}
          onChange={(e) => onApiChange(e.target.value as string)}
          label="API"
        >
          <MenuItem value="">All APIs</MenuItem>
          {apis.map((api) => (
            <MenuItem key={api} value={api}>
              {api}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {showClientFilter && onClientChange && (
        <FormControl fullWidth size="small" className={classes.filterControl}>
          <InputLabel>Client</InputLabel>
          <Select
            value={selectedClient}
            onChange={(e) => onClientChange(e.target.value as string)}
            label="Client"
          >
            <MenuItem value="">All Clients</MenuItem>
            {clients.map((client) => (
              <MenuItem key={client} value={client}>
                {client}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )}
    </Box>
  );
};
