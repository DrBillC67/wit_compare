# Azure DevOps Work Item Compare Tool

This tool allows users to connect to an Azure DevOps project, select a team and iteration, and compare the state of Product Backlog Items and Bugs as of two dates. Results are displayed in a table and can be exported as CSV.

## Features
- Connect to Azure DevOps using a Personal Access Token (PAT)
- Select organization, project, team, and iteration
- Pick dates to compare work item states
- View work item ID, type, title, and states as of selected/comparison dates
- Export table to CSV

## Stack
- Frontend: React
- Backend: Node.js/Express

## Getting Started
1. Place your Azure DevOps PAT in the UI when prompted.
2. Select organization, project, team, iteration, and dates.
3. View and export the comparison table.

## Setup
- `npm install` in both `/server` and `/client` directories
- Start server and client as described in their respective directories

---
This is a prototype. For production, use OAuth and secure storage for credentials.
