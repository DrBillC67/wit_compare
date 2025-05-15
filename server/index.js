const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors({ origin: 'http://localhost:3000' }));
const axios = require('axios');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const winston = require('winston');

dotenv.config();

app.use(express.json());


// --- Logging Setup ---
const LOG_DIR = path.join(process.cwd(), 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR);

const logFormat = winston.format.printf(({ level, message, timestamp }) => {
  return `${timestamp} [${level.toUpperCase()}] ${message}`;
});

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    logFormat
  ),
  transports: [
    new winston.transports.File({ filename: path.join(LOG_DIR, `transaction-${new Date().toISOString().slice(0,10)}.log`) })
  ]
});

let loggingEnabled = process.env.DETAILED_LOGGING === 'true';

// API to toggle logging
dotenv.config();

// --- Helper to log transaction ---
function logTransaction(msg) {
  if (loggingEnabled) logger.info(msg);
}

// Endpoint to get/set logging status
app.get('/api/logging/status', (req, res) => {
  res.json({ enabled: loggingEnabled });
});
app.post('/api/logging/status', (req, res) => {
  loggingEnabled = !!req.body.enabled;
  res.json({ enabled: loggingEnabled });
});

// Endpoint to list logs
app.get('/api/logs/list', (req, res) => {
  fs.readdir(LOG_DIR, (err, files) => {
    if (err) return res.status(500).json({ error: err.message });
    const logs = files.filter(f => f.endsWith('.log')).sort().reverse();
    res.json(logs);
  });
});
// Endpoint to view log contents
app.get('/api/logs/view', (req, res) => {
  const file = req.query.file;
  if (!file || file.includes('..')) return res.status(400).json({ error: 'Invalid file' });
  const filePath = path.join(LOG_DIR, file);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ file, content: data });
  });
});
// Endpoint to download log
app.get('/api/logs/download', (req, res) => {
  const file = req.query.file;
  if (!file || file.includes('..')) return res.status(400).json({ error: 'Invalid file' });
  const filePath = path.join(LOG_DIR, file);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.download(filePath, file);
});

// Helper to get Azure DevOps API URL
const getAzureApiUrl = (org, project, path) => `https://dev.azure.com/${org}/${project}/_apis${path}`;

// Middleware to get PAT from header
const azureAuth = (req, res, next) => {
  const pat = req.header('x-azure-pat') || process.env.AZURE_DEVOPS_PAT;
  if (!pat) return res.status(401).json({ error: 'Missing Azure DevOps PAT' });
  req.pat = pat;
  next();
};

// Get Projects for authenticated user
app.get('/api/projects', azureAuth, async (req, res) => {
  const { org } = req.query;
  logTransaction(`[IN] /api/projects org=${org}`);
  try {
    const url = `https://dev.azure.com/${org}/_apis/projects?api-version=7.0`;
    const response = await axios.get(url, {
      headers: { Authorization: `Basic ${Buffer.from(':' + req.pat).toString('base64')}` }
    });
    logTransaction(`[OUT] /api/projects org=${org} status=200 count=${response.data.value.length}`);
    res.json(response.data.value);
  } catch (err) {
    logTransaction(`[ERR] /api/projects org=${org} status=500 error=${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Get Teams for a project
app.get('/api/teams', azureAuth, async (req, res) => {
  const { org, project } = req.query;
  logTransaction(`[IN] /api/teams org=${org} project=${project}`);
  try {
    const url = `https://dev.azure.com/${org}/_apis/projects/${project}/teams?api-version=7.0`;
    const response = await axios.get(url, {
      headers: { Authorization: `Basic ${Buffer.from(':' + req.pat).toString('base64')}` }
    });
    logTransaction(`[OUT] /api/teams org=${org} project=${project} status=200 count=${response.data.value.length}`);
    res.json(response.data.value);
  } catch (err) {
    logTransaction(`[ERR] /api/teams org=${org} project=${project} status=500 error=${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Get Iterations
app.get('/api/iterations', azureAuth, async (req, res) => {
  const { org, project, team } = req.query;
  logTransaction(`[IN] /api/iterations org=${org} project=${project} team=${team}`);
  try {
    const url = `https://dev.azure.com/${org}/${project}/${team}/_apis/work/teamsettings/iterations?api-version=7.0`;
    const response = await axios.get(url, {
      headers: { Authorization: `Basic ${Buffer.from(':' + req.pat).toString('base64')}` }
    });
    logTransaction(`[OUT] /api/iterations org=${org} project=${project} team=${team} status=200 count=${response.data.value.length}`);
    res.json(response.data.value);
  } catch (err) {
    logTransaction(`[ERR] /api/iterations org=${org} project=${project} team=${team} status=500 error=${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Disable caching for all workitems endpoints
app.use('/api/workitems', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Shared handler for GET/POST /api/workitems
async function handleWorkItems(req, res) {
  // Accept params from body (POST) or query (GET)
  const src = req.method === 'POST' ? req.body : req.query;
  const org = src.org;
  const project = src.project;
  const team = src.team;
  const iterationPath = src.iterationPath || src.iteration; // support both
  let types = src.types;
  // If types is a string (from query), split it
  if (typeof types === 'string') {
    try {
      types = JSON.parse(types);
    } catch {
      types = types.split(',').map(s => s.trim()).filter(Boolean);
    }
  }
  logTransaction(`[IN] /api/workitems org=${org} project=${project} team=${team} iterationPath=${iterationPath} types=${types}`);
  try {
    // WIQL Query
    let wiqlQuery = `SELECT [System.Id], [System.WorkItemType], [System.Title], [System.State], [System.CreatedDate], [System.AreaPath], [Custom.TargetRelease] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.IterationPath] = '${iterationPath}'`;
    if (types && Array.isArray(types) && types.length > 0) {
      wiqlQuery += ` AND [System.WorkItemType] IN (${types.map(t => `'${t}'`).join(',')})`;
    }
    wiqlQuery += ' ORDER BY [System.Id]';
    const wiql = { query: wiqlQuery };
    logTransaction(`[DEBUG] WIQL QUERY: ${wiqlQuery}`);
    logTransaction(`[DEBUG] /api/workitems input org=${org} project=${project} team=${team} iterationPath=${iterationPath} types=${types}`);

    const url = `https://dev.azure.com/${org}/${project}/${encodeURIComponent(team)}/_apis/wit/wiql?api-version=7.0`;
    const wiqlRes = await axios.post(url, wiql, {
      headers: { Authorization: `Basic ${Buffer.from(':' + req.pat).toString('base64')}` }
    });
    const ids = wiqlRes.data.workItems.map(wi => wi.id);
    logTransaction(`[DEBUG] /api/workitems WIQL returned IDs: ${JSON.stringify(ids)}`);
    if (!ids.length) {
      logTransaction(`[OUT] /api/workitems org=${org} project=${project} team=${team} status=200 count=0`);
      return res.json({ count: 0, value: [] });
    }
    // Batch work item details requests (max 200 IDs per batch)
    const batchUrl = `https://dev.azure.com/${org}/${project}/_apis/wit/workitemsbatch?api-version=7.0`;
    const requestedFields = [
      "System.Id",
      "System.WorkItemType",
      "System.Title",
      "System.State",
      "System.CreatedDate",
      "System.AreaPath",
      "Custom.TargetRelease",
      "System.BoardColumn"
    ];
    logTransaction(`[DEBUG] BATCH REQUESTED FIELDS: ${requestedFields}`);
    const chunkSize = 200;
    const batches = [];
    for (let i = 0; i < ids.length; i += chunkSize) {
      batches.push(ids.slice(i, i + chunkSize));
    }
    // Prepare local file for writing batches
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outFile = `workitems_${timestamp}.json`;
    const outPath = require('path').join(process.cwd(), outFile);
    const fs = require('fs');
    fs.writeFileSync(outPath, '[\n'); // Start array
    let allResults = [];
    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      const batchRes = await axios.post(batchUrl, {
        ids: batch,
        fields: requestedFields
      }, {
        headers: { Authorization: `Basic ${Buffer.from(':' + req.pat).toString('base64')}` }
      });
      batchRes.data.value.forEach(wi => {
        logTransaction(`[DEBUG] WORKITEM FIELDS: ${JSON.stringify(wi.fields)}`);
        if (!wi.fields['System.CreatedDate']) {
          logTransaction(`[WARN] System.CreatedDate missing for work item ${wi.fields['System.Id']}`);
        }
      });
      allResults = allResults.concat(batchRes.data.value);
      // Write batch to file
      fs.appendFileSync(outPath, JSON.stringify(batchRes.data.value, null, 2));
      if (b < batches.length - 1) fs.appendFileSync(outPath, ',\n');
    }
    fs.appendFileSync(outPath, '\n]'); // End array
    logTransaction(`[OUT] /api/workitems org=${org} project=${project} team=${team} status=200 count=${allResults.length} file=${outFile}`);
    // Ensure allResults is always an array
    if (!Array.isArray(allResults)) {
      allResults = Object.values(allResults);
    }
    res.json({ count: ids.length, value: allResults, file: outFile }); // count is total matching, value is the batch details, file is the local file written

  } catch (err) {
    const adoMsg = err.response?.data?.message || '';
    if (adoMsg.includes('VS403474')) {
      logTransaction(`[ERR] /api/workitems org=${org} project=${project} team=${team} status=400 error=Too many work items. Please filter your query to fewer than 200 items.`);
      console.error(`[400] /api/workitems too many work items: org=${org}, project=${project}, team=${team}`);
      return res.status(400).json({
        error: 'Too many work items. Please filter your query to fewer than 200 items (e.g., by type, date, or iteration).',
        adoMessage: adoMsg
      });
    }
    logTransaction(`[ERR] /api/workitems org=${org} project=${project} team=${team} status=500 error=${err.message} response=${JSON.stringify(err.response?.data)}`);
    res.status(500).json({ error: err.message, details: err.response?.data });
  }
}

// Get Work Items for Iteration
app.post('/api/workitems', azureAuth, handleWorkItems);
app.get('/api/workitems', azureAuth, handleWorkItems);

// Get Work Item State as of Date
app.get('/api/workitem/:id/history', azureAuth, async (req, res) => {
  const { org, project, asOf } = req.query;
  const { id } = req.params;
  logTransaction(`[IN] /api/workitem/${id}/history org=${org} project=${project} asOf=${asOf}`);
  try {
    logTransaction(`[DEBUG] Fetching history for WI ${id}, asOf=${asOf}`);
    // Get revisions up to asOf date
    const url = `https://dev.azure.com/${org}/${project}/_apis/wit/workItems/${id}/revisions?api-version=7.0`;
    const response = await axios.get(url, {
      headers: { Authorization: `Basic ${Buffer.from(':' + req.pat).toString('base64')}` }
    });
    const revisions = response.data.value;
    const asOfDate = new Date(asOf);
    let state = null;
    let changedBy = null;
    let changedDate = null;
    let found = false;
    for (const rev of revisions) {
      const changed = new Date(rev.fields['System.ChangedDate']);
      if (changed <= asOfDate) {
        state = rev.fields['System.State'];
        changedBy = rev.fields['System.ChangedBy']?.displayName || rev.fields['System.ChangedBy'] || null;
        changedDate = rev.fields['System.ChangedDate'];
        found = true;
      } else break;
    }
    // If no revision before asOf, fallback to first revision state
    if (!found && revisions.length > 0) {
      state = revisions[0].fields['System.State'];
      changedBy = revisions[0].fields['System.ChangedBy']?.displayName || revisions[0].fields['System.ChangedBy'] || null;
      changedDate = revisions[0].fields['System.ChangedDate'];
    }
    logTransaction(`[OUT] /api/workitem/${id}/history org=${org} project=${project} status=200 state=${state}`);
    res.json({ id, state, changedBy, changedDate });
  } catch (err) {
    logTransaction(`[ERR] /api/workitem/${id}/history org=${org} project=${project} status=500 error=${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Get work item types for a project
app.get('/api/types', async (req, res) => {
  const org = req.query.org;
  const project = req.query.project;
  const pat = req.headers['x-azure-pat'] || req.query.pat;
  if (!org || !project || !pat) {
    console.error(`[400] /api/types missing param(s): org=${org}, project=${project}, pat=${pat ? '***' : ''}`);
    console.error('Request query:', req.query);
    console.error('Request headers:', req.headers);
    return res.status(400).json({ error: 'Missing org, project, or PAT', org, project, patPresent: !!pat });
  }
  try {
    const url = `https://dev.azure.com/${org}/${project}/_apis/wit/workitemtypes?api-version=7.0`;
    const adoRes = await axios.get(url, {
      headers: { Authorization: `Basic ${Buffer.from(':' + pat).toString('base64')}` }
    });
    const typeNames = adoRes.data.value.map(t => t.name);
    res.json(typeNames);
  } catch (err) {
    res.status(500).json({ error: err.message, details: err.response?.data });
  }
});

// Serve static files from React app (after all /api/* routes)
const staticDir = path.join(__dirname, '..', 'client', 'build');
app.use(express.static(staticDir));

// React catch-all (after all /api/* routes)
app.get('*', (req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

// Start server
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
