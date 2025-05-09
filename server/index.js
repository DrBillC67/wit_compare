import express from 'express';
import axios from 'axios';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

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
  try {
    const url = `https://dev.azure.com/${org}/_apis/projects?api-version=7.0`;
    const response = await axios.get(url, {
      headers: { Authorization: `Basic ${Buffer.from(':' + req.pat).toString('base64')}` }
    });
    res.json(response.data.value);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Teams for a project
app.get('/api/teams', azureAuth, async (req, res) => {
  const { org, project } = req.query;
  try {
    const url = `https://dev.azure.com/${org}/_apis/projects/${project}/teams?api-version=7.0`;
    const response = await axios.get(url, {
      headers: { Authorization: `Basic ${Buffer.from(':' + req.pat).toString('base64')}` }
    });
    res.json(response.data.value);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Iterations
app.get('/api/iterations', azureAuth, async (req, res) => {
  const { org, project, team } = req.query;
  try {
    const url = `https://dev.azure.com/${org}/${project}/${team}/_apis/work/teamsettings/iterations?api-version=7.0`;
    const response = await axios.get(url, {
      headers: { Authorization: `Basic ${Buffer.from(':' + req.pat).toString('base64')}` }
    });
    res.json(response.data.value);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Work Items for Iteration
app.post('/api/workitems', azureAuth, async (req, res) => {
  const { org, project, team, iterationPath, types } = req.body;
  try {
    // WIQL Query
    let wiqlQuery = `SELECT [System.Id], [System.WorkItemType], [System.Title], [System.State], [System.CreatedDate] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.IterationPath] = '${iterationPath}'`;
    if (types && Array.isArray(types) && types.length > 0) {
      wiqlQuery += ` AND [System.WorkItemType] IN (${types.map(t => `'${t}'`).join(',')})`;
    }
    wiqlQuery += ' ORDER BY [System.Id]';
    const wiql = { query: wiqlQuery };
    console.log('WIQL QUERY:', wiqlQuery);

    const url = `https://dev.azure.com/${org}/${project}/${team}/_apis/wit/wiql?api-version=7.0`;
    const wiqlRes = await axios.post(url, wiql, {
      headers: { Authorization: `Basic ${Buffer.from(':' + req.pat).toString('base64')}` }
    });
    const ids = wiqlRes.data.workItems.map(wi => wi.id);
    if (!ids.length) return res.json([]);
    // Get details for all work items
    const batchUrl = `https://dev.azure.com/${org}/${project}/_apis/wit/workitemsbatch?api-version=7.0`;
    const requestedFields = ["System.Id", "System.WorkItemType", "System.Title", "System.State", "System.CreatedDate"];
    console.log('BATCH REQUESTED FIELDS:', requestedFields);
    const batchRes = await axios.post(batchUrl, {
      ids,
      fields: requestedFields
    }, {
      headers: { Authorization: `Basic ${Buffer.from(':' + req.pat).toString('base64')}` }
    });
    // Debug: log fields returned for each work item
    batchRes.data.value.forEach(wi => {
      console.log('WORKITEM DEBUG:', wi.fields);
      if (!wi.fields['System.CreatedDate']) {
        console.warn('WARNING: System.CreatedDate missing for work item', wi.fields['System.Id']);
      }
    });
    res.json(batchRes.data.value); // unchanged, as /api/workitem/:id/history will provide changedBy/changedDate

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Work Item State as of Date
app.get('/api/workitem/:id/history', azureAuth, async (req, res) => {
  const { org, project, asOf } = req.query;
  const { id } = req.params;
  try {
    console.log(`[DEBUG] Fetching history for WI ${id}, asOf=${asOf}`);
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
    console.log(`[DEBUG] WI ${id} state as of ${asOf}: ${state}`);
    res.json({ id, state, changedBy, changedDate });
  } catch (err) {
    console.error(`[ERROR] /api/workitem/${id}/history:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
