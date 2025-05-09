import React, { useState, useEffect } from 'react';
import { Box, Button, TextField, MenuItem, Select, InputLabel, FormControl, Typography, CircularProgress, Checkbox, ListItemText, OutlinedInput, FormControlLabel } from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { format } from 'date-fns';
import Papa from 'papaparse';
import axios from 'axios';
import CryptoJS from 'crypto-js';

const api = axios.create({ baseURL: 'http://localhost:5001/api' });

export default function WorkItemCompare() {
  const [pat, setPat] = useState('');
  const [org, setOrg] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState('');
  const [teams, setTeams] = useState([]);
  const [team, setTeam] = useState('');
  const [iterations, setIterations] = useState([]);
  const [iteration, setIteration] = useState('');
  const [asOf, setAsOf] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [compareDate, setCompareDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [workItemTypes, setWorkItemTypes] = useState([]); // all types returned
  const [selectedTypes, setSelectedTypes] = useState([]); // user-selected types
  const [showOnlyChanged, setShowOnlyChanged] = useState(false);
  // Credential management
  const [credName, setCredName] = useState('');
  const [savedCreds, setSavedCreds] = useState(() => {
    try {
      const raw = localStorage.getItem('adoCreds');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [selectedCred, setSelectedCred] = useState('');
  const encryptionKey = 'ado-compare-key'; // Could be env or user-supplied

  // Pagination state for DataGrid
  const [pageSize, setPageSize] = useState(10);

  // Authenticate and fetch projects
  const handleAuthenticate = async () => {
    setAuthError('');
    setIsAuthenticated(false);
    setProjects([]);
    setProject('');
    setTeams([]);
    setTeam('');
    setIterations([]);
    setIteration('');
    if (!pat || !org) {
      setAuthError('Please enter both Organization and PAT');
      return;
    }
    try {
      const res = await api.get('/projects', {
        params: { org },
        headers: { 'x-azure-pat': pat }
      });
      setProjects(res.data);
      setIsAuthenticated(true);
    } catch (err) {
      setAuthError('Authentication failed or unable to fetch projects');
    }
  };

  // Fetch teams after project selection
  useEffect(() => {
    if (isAuthenticated && org && project && pat) {
      api.get('/teams', {
        params: { org, project },
        headers: { 'x-azure-pat': pat }
      }).then(res => setTeams(res.data)).catch(() => setTeams([]));
    }
  }, [isAuthenticated, org, project, pat]);

  // Fetch iterations after team selection
  useEffect(() => {
    if (isAuthenticated && org && project && team && pat) {
      api.get('/iterations', {
        params: { org, project, team },
        headers: { 'x-azure-pat': pat }
      }).then(res => setIterations(res.data)).catch(() => setIterations([]));
    }
  }, [isAuthenticated, org, project, team, pat]);

  // Fetch work items and states
  const handleFetch = async () => {
    setLoading(true);
    setRows([]);
    try {
      // Get all work items for iteration (filtered by selectedTypes if any)
      const wiRes = await api.post('/workitems', {
        org, project, team, iterationPath: iteration, types: selectedTypes
      }, { headers: { 'x-azure-pat': pat } });
      const workItems = wiRes.data;
      // Populate type filter options
      const typesSet = new Set(workItems.map(wi => wi.fields['System.WorkItemType']));
      setWorkItemTypes(Array.from(typesSet));
      // Get state as of each date for each work item
      const promises = workItems.map(async wi => {
        const [asOfRes, compareRes] = await Promise.all([
          api.get(`/workitem/${wi.id}/history`, {
            params: { org, project, asOf }, headers: { 'x-azure-pat': pat }
          }),
          api.get(`/workitem/${wi.id}/history`, {
            params: { org, project, asOf: compareDate }, headers: { 'x-azure-pat': pat }
          })
        ]);
        // Created column: always show created date
        const createdDate = wi.fields['System.CreatedDate'];
        // Always set created to the raw System.CreatedDate value for DataGrid formatting
        const createdStr = createdDate || '';
        return {
          id: wi.id,
          type: wi.fields['System.WorkItemType'],
          title: wi.fields['System.Title'],
          createdDate: createdStr,
          stateAsOf: asOfRes.data.state,
          changedByAsOf: asOfRes.data.changedBy,
          changedDateAsOf: asOfRes.data.changedDate,
          stateCompare: compareRes.data.state,
          changedByCompare: compareRes.data.changedBy,
          changedDateCompare: compareRes.data.changedDate,
          url: `https://dev.azure.com/${org}/${project}/_workitems/edit/${wi.id}`,
          created: createdStr
        };
      });
      const results = await Promise.all(promises);
      setRows(results);
    } catch (err) {
      setRows([]);
    }
    setLoading(false);
  };

  // Export to CSV
  const handleExport = () => {
    const formatDate = (dt) => {
      if (!dt) return '';
      const date = new Date(dt);
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      const yy = String(date.getFullYear()).slice(-2);
      return `${mm}/${dd}/${yy}`;
    };
    // No longer needed: formatChangedByDate
    const csv = Papa.unparse(rows.map(r => ({
      ID: r.id,
      Type: r.type,
      Title: r.title,
      'Created Date': formatDate(r.createdDate),
      'As Of Date': asOf,
      'Comparison Date': compareDate,
      'State as of selected date': r.stateAsOf,
      'State as of comparison date': r.stateCompare,
      Changed: r.stateAsOf !== r.stateCompare ? 'Y' : '',
      'Changed By': r.changedByCompare,
      'Changed Date': formatDate(r.changedDateCompare)
    })));
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'workitem-compare.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" gutterBottom>DevOps WIT State Compare</Typography>
      {/* Auth Section */}
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
        <TextField label="Organization" value={org} onChange={e => setOrg(e.target.value)} size="small" disabled={isAuthenticated} />
        <TextField label="Personal Access Token" value={pat} onChange={e => setPat(e.target.value)} size="small" type="password" disabled={isAuthenticated} />
        <Button variant="contained" onClick={handleAuthenticate} disabled={isAuthenticated}>Authenticate</Button>
        {authError && <Typography color="error">{authError}</Typography>}
      </Box>
      {/* Save/load credentials */}
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
        <TextField label="Credential Name" value={credName} onChange={e => setCredName(e.target.value)} size="small" />
        <Button variant="outlined" size="small" onClick={() => {
          if (!credName || !org || !pat) return;
          const encrypted = CryptoJS.AES.encrypt(JSON.stringify({ org, pat }), encryptionKey).toString();
          const newCreds = savedCreds.filter(c => c.name !== credName).concat([{ name: credName, data: encrypted }]);
          setSavedCreds(newCreds);
          localStorage.setItem('adoCreds', JSON.stringify(newCreds));
        }}>Save Credentials</Button>
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>Saved Credentials</InputLabel>
          <Select value={selectedCred} label="Saved Credentials" onChange={e => {
            setSelectedCred(e.target.value);
            const cred = savedCreds.find(c => c.name === e.target.value);
            if (cred) {
              try {
                const decrypted = CryptoJS.AES.decrypt(cred.data, encryptionKey).toString(CryptoJS.enc.Utf8);
                const parsed = JSON.parse(decrypted);
                setOrg(parsed.org);
                setPat(parsed.pat);
              } catch {}
            }
          }}>
            {savedCreds.map(c => <MenuItem key={c.name} value={c.name}>{c.name}</MenuItem>)}
          </Select>
        </FormControl>
      </Box>
      {/* Project/Team/Iteration Section */}
      {isAuthenticated && (
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
          
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>Project</InputLabel>
            <Select value={project} label="Project" onChange={e => { setProject(e.target.value); setTeam(''); setIteration(''); }}>
              {projects.map(p => <MenuItem key={p.id} value={p.name}>{p.name}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>Team</InputLabel>
            <Select value={team} label="Team" onChange={e => { setTeam(e.target.value); setIteration(''); }} disabled={!project}>
              {teams.map(t => <MenuItem key={t.id} value={t.name}>{t.name}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>Iteration</InputLabel>
            <Select value={iteration} label="Iteration" onChange={e => setIteration(e.target.value)} disabled={!team}>
              {iterations.map(i => <MenuItem key={i.id} value={i.path}>{i.name}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel id="workitem-type-label">Work Item Types</InputLabel>
            <Select
              labelId="workitem-type-label"
              multiple
              value={selectedTypes}
              onChange={e => setSelectedTypes(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value)}
              input={<OutlinedInput label="Work Item Types" />}
              renderValue={selected => selected.join(', ')}
              MenuProps={{ PaperProps: { style: { maxHeight: 260, width: 250 } } }}
              onClose={() => {
                // Auto-fetch when filter closes and selection changed
                if (isAuthenticated && org && project && team && iteration) handleFetch();
              }}
            >
              {workItemTypes.map(type => (
                <MenuItem key={type} value={type}>
                  <Checkbox checked={selectedTypes.indexOf(type) > -1} />
                  <ListItemText primary={type} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField label="As of date" type="date" value={asOf} onChange={e => setAsOf(e.target.value)} size="small" InputLabelProps={{ shrink: true }} />
          <TextField label="Comparison date" type="date" value={compareDate} onChange={e => setCompareDate(e.target.value)} size="small" InputLabelProps={{ shrink: true }} />
          <Button variant="contained" onClick={handleFetch} disabled={loading || !team || !iteration}>Compare</Button>
          <Button variant="outlined" onClick={handleExport} disabled={!rows.length}>Export CSV</Button>
          <FormControlLabel
            control={<Checkbox checked={showOnlyChanged} onChange={e => setShowOnlyChanged(e.target.checked)} />}
            label="Show Only Changed State"
          />
        </Box>
      )}
      {loading ? <CircularProgress /> : (
        <div style={{ height: 500, width: '100%' }}>
          <DataGrid
            rows={(showOnlyChanged ? rows.filter(r => r.stateAsOf !== r.stateCompare) : rows).map(r => ({ ...r, id: r.id }))}
            columns={[
              { field: 'id', headerName: 'ID', width: 110,
                renderCell: (params) => (
                  <a href={params.row.url} target="_blank" rel="noopener noreferrer">{params.value}</a>
                )
              },
              { field: 'type', headerName: 'Type', width: 140 },
              { field: 'title', headerName: 'Title', width: 400 },
              { field: 'created', headerName: 'Created', width: 180, renderCell: params => {
                if (!params.value) return '';
                const createdDate = new Date(params.value);
                const mm = String(createdDate.getMonth() + 1).padStart(2, '0');
                const dd = String(createdDate.getDate()).padStart(2, '0');
                const yy = String(createdDate.getFullYear()).slice(-2);
                let hours = createdDate.getHours();
                const minutes = String(createdDate.getMinutes()).padStart(2, '0');
                const ampm = hours >= 12 ? 'PM' : 'AM';
                hours = hours % 12;
                hours = hours ? hours : 12;
                const formatted = `${mm}/${dd}/${yy} ${hours}:${minutes} ${ampm}`;
                // Compare only date parts (ignore time)
                let asOfDate = null;
                try { asOfDate = asOf ? new Date(asOf) : null; } catch {}
                let isRed = false;
                if (asOfDate) {
                  const createdYMD = createdDate.getFullYear() * 10000 + (createdDate.getMonth() + 1) * 100 + createdDate.getDate();
                  const asOfYMD = asOfDate.getFullYear() * 10000 + (asOfDate.getMonth() + 1) * 100 + asOfDate.getDate();
                  isRed = asOfYMD < createdYMD;
                }
                return <span style={isRed ? { color: 'red' } : {}}>{formatted}</span>;
              }},
              { field: 'stateAsOf', headerName: `State as of ${asOf}`, width: 140,
                cellClassName: params => params.row.stateAsOf !== params.row.stateCompare ? 'state-diff' : '' },

              { field: 'stateCompare', headerName: `State as of ${compareDate}`, width: 140,
                cellClassName: params => params.row.stateAsOf !== params.row.stateCompare ? 'state-diff' : '' },
              { field: 'changedByCompare', headerName: 'Changed By (compare)', width: 160 },
              { field: 'changedDateCompare', headerName: 'Changed Date (compare)', width: 170,
                valueFormatter: params => {
                  if (!params.value) return '';
                  const date = new Date(params.value);
                  const mm = String(date.getMonth() + 1).padStart(2, '0');
                  const dd = String(date.getDate()).padStart(2, '0');
                  const yy = String(date.getFullYear()).slice(-2);
                  let hours = date.getHours();
                  const minutes = String(date.getMinutes()).padStart(2, '0');
                  const ampm = hours >= 12 ? 'PM' : 'AM';
                  hours = hours % 12;
                  hours = hours ? hours : 12;
                  return `${mm}/${dd}/${yy} ${hours}:${minutes} ${ampm}`;
                }
              },
            ]}
            pageSize={pageSize}
            onPageSizeChange={newSize => setPageSize(newSize)}
            rowsPerPageOptions={[10, 25, 50, 100]}

          getRowClassName={(params) => params.indexRelativeToCurrentPage % 2 === 0 ? 'even-row' : 'odd-row'}
          />
          <style>{`
            .state-diff { background: #fff9c4 !important; }
            .even-row { background-color: #fafafa; }
            .odd-row { background-color: #f5f5f5; }
          `}</style>
        </div>
      )}
    </Box>
  );
}
