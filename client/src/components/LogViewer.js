import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Switch, FormControlLabel, Button, List, ListItem, ListItemText, Divider, Paper, CircularProgress
} from '@mui/material';
import axios from 'axios';

export default function LogViewer() {
  const [loggingEnabled, setLoggingEnabled] = useState(false);
  const [logs, setLogs] = useState([]);
  const [selectedLog, setSelectedLog] = useState(null);
  const [logContent, setLogContent] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchLoggingStatus();
    fetchLogList();
  }, []);

  const fetchLoggingStatus = async () => {
    try {
      const res = await axios.get('/api/logging/status');
      setLoggingEnabled(res.data.enabled);
    } catch (err) {}
  };

  const handleToggleLogging = async (e) => {
    const enabled = e.target.checked;
    setLoggingEnabled(enabled);
    await axios.post('/api/logging/status', { enabled });
  };

  const fetchLogList = async () => {
    try {
      const res = await axios.get('/api/logs/list');
      setLogs(Array.isArray(res.data) ? res.data : []);
    } catch (err) {}
  };

  const handleSelectLog = async (file) => {
    setSelectedLog(file);
    setLoading(true);
    try {
      const res = await axios.get('/api/logs/view', { params: { file } });
      setLogContent(res.data.content);
    } catch (err) {
      setLogContent('Error loading log.');
    }
    setLoading(false);
  };

  const handleDownloadLog = (file) => {
    window.open(`/api/logs/download?file=${encodeURIComponent(file)}`);
  };

  return (
    <Paper sx={{ p: 2, mt: 2 }}>
      <Typography variant="h6" gutterBottom>Transaction Logging</Typography>
      <FormControlLabel
        control={<Switch checked={loggingEnabled} onChange={handleToggleLogging} />}
        label={loggingEnabled ? 'Enabled' : 'Disabled'}
      />
      <Divider sx={{ my: 2 }} />
      <Typography variant="h6">Transaction Logs</Typography>
      <Button onClick={fetchLogList} size="small" sx={{ mb: 1 }}>Refresh List</Button>
      <Box sx={{ display: 'flex', gap: 2 }}>
        <List sx={{ width: 260, bgcolor: '#f5f5f5', maxHeight: 300, overflow: 'auto' }}>
          {Array.isArray(logs) && logs.map(file => (
            <ListItem
              key={file}
              button
              selected={selectedLog === file}
              onClick={() => handleSelectLog(file)}
              secondaryAction={<Button size="small" onClick={() => handleDownloadLog(file)}>Download</Button>}
            >
              <ListItemText primary={file} />
            </ListItem>
          ))}
        </List>
        <Box sx={{ flex: 1, minHeight: 300, bgcolor: '#fafafa', p: 1, border: '1px solid #eee', borderRadius: 1 }}>
          {loading ? <CircularProgress /> : (
            <pre style={{ fontSize: 13, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{logContent}</pre>
          )}
        </Box>
      </Box>
    </Paper>
  );
}
