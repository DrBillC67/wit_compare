import React, { useState } from 'react';
import {
  Box, Button, Typography, TextField, MenuItem, Select, InputLabel, FormControl
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import Autocomplete from '@mui/material/Autocomplete';
import axios from 'axios';

import LogViewer from './LogViewer';
import TabbedPanel from './TabbedPanel';

import * as XLSX from 'xlsx';

function WorkItemCompare() {
  // Logout handler
  const handleLogout = () => {
    setPat('');
    setOrg('');
    setIsAuthenticated(false);
    setProject('');
    setTeam('');
    setIteration('');
    setAllRows([]);
    setSelectedTypes([]);
    setShowOnlyChanged(false);
  };

  // Load work items handler
  const handleLoadWorkItems = async () => {
    setError('');
    setAllRows([]);
    if (!org || !project || !team || !iteration || !pat || !selectedTypes.length || !asOf || !compareDate) {
      setError("Please select all required fields.");
      return;
    }
    try {
      const workItemsRes = await api.get('/workitems', {
        params: {
          org,
          project,
          team,
          iterationPath: iteration,
          types: selectedTypes.join(','),
          asOf,
          compareDate
        },
        headers: { 'x-azure-pat': pat }
      });
      let items = null;
      if (workItemsRes.data === undefined || workItemsRes.data === null) {
        setError('No data received from server (possible 304 Not Modified). Try disabling cache or refreshing.');
        setAllRows([]);
        return;
      }
      if (Array.isArray(workItemsRes.data.value)) {
        items = workItemsRes.data.value;
      } else if (Array.isArray(workItemsRes.data)) {
        items = workItemsRes.data;
      } else {
        const keys = Object.keys(workItemsRes.data).map(k => `${k} (${Array.isArray(workItemsRes.data[k]) ? 'array' : typeof workItemsRes.data[k]})`).join(', ');
        setError(`Unexpected response from server: work items data is not an array. Top-level keys: ${keys}`);
        setAllRows([]);
        return;
      }
      const promises = items.map(wi =>
        Promise.all([
          api.get(`/workitem/${wi.id}/history`, {
            params: { org, project, asOf }, headers: { 'x-azure-pat': pat }
          }),
          api.get(`/workitem/${wi.id}/history`, {
            params: { org, project, asOf: compareDate }, headers: { 'x-azure-pat': pat }
          })
        ]).then(([asOfRes, compareRes]) => {
          const createdDate = wi.fields['System.CreatedDate'];
          const createdStr = createdDate || '';
          return {
            id: wi.id,
            type: wi.fields['System.WorkItemType'],
            title: wi.fields['System.Title'],
            createdDate: createdStr,
            areaPath: wi.fields['System.AreaPath'] || '',
            targetRelease: wi.fields['Custom.TargetRelease'] || '',
            boardColumn: wi.fields['System.BoardColumn'] || '',
            stateAsOf: asOfRes.data.state,
            changedByAsOf: asOfRes.data.changedBy,
            changedDateAsOf: asOfRes.data.changedDate,
            stateCompare: compareRes.data.state,
            changedByCompare: compareRes.data.changedBy,
            changedDateCompare: compareRes.data.changedDate,
            url: `https://dev.azure.com/${org}/${project}/_workitems/edit/${wi.id}`,
            created: createdStr
          };
        })
      );
      const results = await Promise.all(promises);
      setAllRows(results);
    } catch (err) {
      console.error('Error fetching work items:', err);
      setAllRows([]);
      setError(err?.response?.data?.error || err.message || 'Failed to fetch work items');
    }
  };

  // Columns for DataGrid and export
  const columns = [
    { field: 'id', headerName: 'ID', width: 100, renderCell: (params) => (
      <a href={params.row.url} target="_blank" rel="noopener noreferrer">{params.value}</a>
    ) },
    { field: 'url', headerName: 'URL', width: 250, renderCell: (params) => (
      <a href={params.row.url} target="_blank" rel="noopener noreferrer">{params.row.url}</a>
    ) },
    { field: 'type', headerName: 'Type', width: 140 },
    { field: 'title', headerName: 'Title', width: 300 },
    { field: 'areaPath', headerName: 'Area Path', width: 200 },
    { field: 'targetRelease', headerName: 'Target Release', width: 150 },
    { field: 'boardColumn', headerName: 'Board Column', width: 150 },
    { field: 'created', headerName: 'Created', width: 180, renderCell: params => formatDateOnly(params.value) },
    { field: 'asOf', headerName: 'As of Date', width: 120, valueGetter: () => asOf, renderCell: () => formatDateOnly(asOf) },
    { field: 'stateAsOf', headerName: 'As of State', width: 140, cellClassName: params => params.row.stateAsOf !== params.row.stateCompare ? 'state-diff' : '' },
    { field: 'compareDate', headerName: 'Comparison Date', width: 140, valueGetter: () => compareDate, renderCell: () => formatDateOnly(compareDate) },
    { field: 'stateCompare', headerName: 'Comparison State', width: 140, cellClassName: params => params.row.stateAsOf !== params.row.stateCompare ? 'state-diff' : '' },
    { field: 'changed', headerName: 'Changed', width: 90, valueGetter: params => params.row.stateAsOf !== params.row.stateCompare ? 'Y' : '' },
    { field: 'changedByCompare', headerName: 'Changed By (compare)', width: 160 },
    { field: 'changedDateCompare', headerName: 'Changed Date', width: 170, renderCell: params => formatDateOnly(params.value) },
  ];

  function formatDateOnly(dt) {
    if (!dt) return '';
    const date = new Date(dt);
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  }

  const dataGridColumns = columns.map(col => {
    const { format, ...rest } = col;
    return rest;
  });

  // Error state for displaying visible errors
  const [error, setError] = useState('');
  const api = axios.create({ baseURL: 'http://localhost:5001/api' });
  const [pat, setPat] = useState('');
  const [org, setOrg] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [project, setProject] = useState('');
  const [team, setTeam] = useState('');
  const [iteration, setIteration] = useState('');
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [allRows, setAllRows] = useState([]);
  const [showOnlyChanged, setShowOnlyChanged] = useState(false);
  const [tab, setTab] = useState(0);
  // DataGrid pagination
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);
  // Dropdown and multi-select options
  const [projects, setProjects] = useState([]);
  const [teams, setTeams] = useState([]);
  const [iterations, setIterations] = useState([]);
  const [types, setTypes] = useState([]);
  // Date pickers
  const [asOf, setAsOf] = useState(null);
  const [compareDate, setCompareDate] = useState(null);


  // Compare only date part (ignore time) for all date fields and state
  function isRowChanged(row) {
    // You may need to adjust these field names to match your actual data
    const dateFields = Object.keys(row).filter(k => k.toLowerCase().includes('date'));
    const anyDateChanged = dateFields.some(field => {
      const asOf = row[field + 'AsOf'] || row[field];
      const compare = row[field + 'Compare'] || row[field];
      if (!asOf && !compare) return false;
      return formatDateOnly(asOf) !== formatDateOnly(compare);
    });
    return row.stateAsOf !== row.stateCompare || anyDateChanged;
  }

    // Export to CSV (must be defined before use)
  function exportRowsToCSV(rows) {
    if (!rows.length) return;
    // Use onscreen columns for order and headers
    const visibleColumns = columns;
    const headers = visibleColumns.map(col => col.headerName || col.field);
    const csv = [headers.join(',')].concat(
      rows.map(row => visibleColumns.map(col => {
        if (col.field === 'changed') {
          return JSON.stringify(isRowChanged(row) ? 'Y' : '');
        }
        if (col.field === 'url') {
          return JSON.stringify(row.url);
        }
        if (col.field === 'created' || col.field === 'createdDate') {
          return JSON.stringify(formatDateOnly(row.created));
        }
        if (col.field === 'asOf') {
          return JSON.stringify(formatDateOnly(asOf));
        }
        if (col.field === 'compareDate') {
          return JSON.stringify(formatDateOnly(compareDate));
        }
        if (col.field === 'changedDateCompare') {
          return JSON.stringify(formatDateOnly(row.changedDateCompare));
        }
        return JSON.stringify(row[col.field] ?? '');
      }).join(','))
    ).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'workitems.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function exportRowsToExcel(rows) {
    if (!rows.length) return;
    const visibleColumns = columns;
    const headers = visibleColumns.map(col => col.headerName || col.field);
    const formatted = rows.map(row => {
      const out = {};
      visibleColumns.forEach(col => {
        if (col.field === 'changed') {
          out[col.headerName || col.field] = isRowChanged(row) ? 'Y' : '';
        } else if (col.field === 'url') {
          out[col.headerName || col.field] = row.url;
        } else if (col.field === 'created' || col.field === 'createdDate') {
          out[col.headerName || col.field] = formatDateOnly(row.created);
        } else if (col.field === 'asOf') {
          out[col.headerName || col.field] = formatDateOnly(asOf);
        } else if (col.field === 'compareDate') {
          out[col.headerName || col.field] = formatDateOnly(compareDate);
        } else if (col.field === 'changedDateCompare') {
          out['Changed Date'] = formatDateOnly(row.changedDateCompare);
        } else {
          out[col.headerName || col.field] = row[col.field];
        }
      });
      return out;
    });
    const ws = XLSX.utils.json_to_sheet(formatted, { header: headers });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'WorkItems');
    XLSX.writeFile(wb, 'workitems.xlsx');
  }

  // Fetch teams when a project is selected
  const handleProjectChange = async (e) => {
    const selectedProject = e.target.value;
    setProject(selectedProject);
    setTeam("");
    setIteration("");
    setTeams([]);
    setIterations([]);
    setTypes([]);
    if (!selectedProject || !org || !pat) return;
    try {
      const teamsRes = await api.get('/teams', {
        params: { org, project: selectedProject },
        headers: { 'x-azure-pat': pat }
      });
      setTeams(Array.isArray(teamsRes.data) ? teamsRes.data : []);
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Failed to fetch teams');
      setTeams([]);
    }
  };

  // Fetch iterations when a team is selected
  const handleTeamChange = async (e) => {
    const selectedTeam = e.target.value;
    setTeam(selectedTeam);
    setIteration("");
    setIterations([]);
    setTypes([]);
    if (!selectedTeam || !org || !project || !pat) return;
    try {
      const iterationsRes = await api.get('/iterations', {
        params: { org, project, team: selectedTeam },
        headers: { 'x-azure-pat': pat }
      });
      setIterations(Array.isArray(iterationsRes.data) ? iterationsRes.data : []);
      // Optionally fetch types here if needed
      const typesRes = await api.get('/types', {
        params: { org, project },
        headers: { 'x-azure-pat': pat }
      });
      setTypes(Array.isArray(typesRes.data) ? typesRes.data : []);
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Failed to fetch iterations/types');
      setIterations([]);
      setTypes([]);
    }
  };

  // Authenticate and fetch projects, teams, iterations, types
  const handleAuthenticate = async () => {
    setError("");
    setIsAuthenticated(false);
    setProjects([]);
    setTeams([]);
    setIterations([]);
    setTypes([]);
    setProject("");
    setTeam("");
    setIteration("");
    setSelectedTypes([]);
    setShowOnlyChanged(false);
    setAllRows([]);
    if (!org || !pat) {
      setError('Organization and PAT are required');
      return;
    }
    try {
      // Fetch projects
      const projectsRes = await api.get('/projects', {
        params: { org },
        headers: { 'x-azure-pat': pat }
      });
      setProjects(Array.isArray(projectsRes.data) ? projectsRes.data : []);
      setIsAuthenticated(true);
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Failed to authenticate or fetch projects');
      setIsAuthenticated(false);
    }
  };

  // ... all other handler functions (handleLoadWorkItems, etc) ...

  // --- Component Render ---
  return (
    <Box sx={{ p: 2 }}>
      {error && (
        <Box sx={{ mb: 2, p: 2, bgcolor: '#ffeaea', border: '1px solid #ffcccc', color: '#a94442', borderRadius: 2 }}>
          <strong>Error:</strong> {error}
        </Box>
      )}
      <Typography variant="h5" sx={{ mb: 2 }}>Azure DevOps Work Item Compare</Typography>
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <React.Fragment>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 2, alignItems: 'center' }}>
            {!isAuthenticated && (
              <>
                <TextField label="Organization" value={org} onChange={e => setOrg(e.target.value)} size="small" sx={{ minWidth: 180 }} />
                <TextField label="PAT" value={pat} onChange={e => setPat(e.target.value)} size="small" type="password" sx={{ minWidth: 180 }} />
              </>
            )}
            <FormControl sx={{ minWidth: 180 }} size="small">
              <InputLabel id="project-label">Project</InputLabel>
              <Select
                labelId="project-label"
                value={project}
                label="Project"
                onChange={handleProjectChange}
                disabled={!Array.isArray(projects) || !projects.length}
              >
                {Array.isArray(projects) && projects.map(p => (
                  <MenuItem key={p.id || p.name} value={p.name}>{p.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl sx={{ minWidth: 180 }} size="small">
              <InputLabel id="team-label">Team</InputLabel>
              <Select
                labelId="team-label"
                value={team}
                label="Team"
                onChange={handleTeamChange}
                disabled={!Array.isArray(teams) || !teams.length}
              >
                {Array.isArray(teams) && teams.map(t => (
                  <MenuItem key={t.id || t.name} value={t.name}>{t.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl sx={{ minWidth: 180 }} size="small">
              <InputLabel id="iteration-label">Iteration</InputLabel>
              <Select
                labelId="iteration-label"
                value={iteration}
                label="Iteration"
                onChange={e => setIteration(e.target.value)}
                disabled={!Array.isArray(iterations) || !iterations.length}
              >
                {Array.isArray(iterations) && iterations.map(i => (
                  <MenuItem key={i.id || i.name} value={i.path}>{i.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <Autocomplete
              multiple
              options={Array.isArray(types) ? types : []}
              value={selectedTypes}
              onChange={(_, newValue) => setSelectedTypes(newValue)}
              renderInput={params => (
                <TextField {...params} label="Work Item Types" size="small" sx={{ minWidth: 200 }} />
              )}
              disabled={!Array.isArray(types) || !types.length}
            />
            <Button
              variant="contained"
              color="primary"
              onClick={handleAuthenticate}
              sx={{ alignSelf: 'center', minWidth: 120 }}
              style={{ display: isAuthenticated ? 'none' : 'inline-flex' }}
            >
              Authenticate
            </Button>
            {isAuthenticated && (
              <Button color="secondary" variant="outlined" onClick={handleLogout} sx={{ alignSelf: 'center', minWidth: 120 }}>
                Logout / Switch Org
              </Button>
            )}
          </Box>
          {isAuthenticated && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 2 }}>
              <DatePicker
                label="As Of Date"
                value={asOf}
                onChange={val => setAsOf(val)}
                slotProps={{ textField: { size: 'small' } }}
                sx={{ minWidth: 160 }}
              />
              <DatePicker
                label="Compare Date"
                value={compareDate}
                onChange={val => setCompareDate(val)}
                slotProps={{ textField: { size: 'small' } }}
                sx={{ minWidth: 160 }}
              />
              <Button
                variant="contained"
                color="success"
                onClick={handleLoadWorkItems}
                disabled={
                  !org || !project || !team || !iteration || !pat || !selectedTypes.length || !asOf || !compareDate
                }
                sx={{ minWidth: 160 }}
              >
                Load Work Items
              </Button>
            </Box>
          )}
        </React.Fragment>
      </LocalizationProvider>
      <Box sx={{ height: '100%' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <FormControl sx={{ mr: 2 }}>
            <label>
              <input
                type="checkbox"
                checked={showOnlyChanged}
                onChange={e => setShowOnlyChanged(e.target.checked)}
                style={{ marginRight: 8 }}
              />
              Show Only Changed
            </label>
          </FormControl>
          <Button variant="outlined" sx={{ mr: 1 }} onClick={() => exportRowsToCSV(showOnlyChanged ? allRows.filter(isRowChanged) : allRows)}>
            Export CSV
          </Button>
          <Button variant="outlined" color="success" onClick={() => exportRowsToExcel(showOnlyChanged ? allRows.filter(isRowChanged) : allRows)}>
            Export Excel
          </Button>
        </Box>
        <TabbedPanel
          tabs={[
            {
              label: 'Compare',
              content: (
                <Box sx={{ height: 400, width: '100%' }}>
                  <DataGrid
                    columns={dataGridColumns.map(col =>
                      col.field.toLowerCase().includes('date')
                        ? { ...col, valueFormatter: params => formatDateOnly(params.value) }
                        : col
                    )}
                    rows={showOnlyChanged ? allRows.filter(isRowChanged) : allRows}
                    pageSize={pageSize}
                    onPageSizeChange={setPageSize}
                    pagination
                    paginationModel={{ page, pageSize }}
                    onPaginationModelChange={model => { setPage(model.page); setPageSize(model.pageSize); }}
                    autoHeight
                  />
                </Box>
              )
            },
            {
              label: 'Logs',
              content: <LogViewer org={org} pat={pat} />
            }
          ]}
          value={tab}
          onChange={(_, newTab) => setTab(newTab)}
        />
      </Box>
    </Box>
  );
}

export default WorkItemCompare;
