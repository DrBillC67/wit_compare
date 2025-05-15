import React from 'react';
import { Tabs, Tab, Box } from '@mui/material';

export default function TabbedPanel({ tabs, value, onChange }) {
  return (
    <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
      <Tabs value={value} onChange={onChange}>
        {tabs.map((tab, idx) => (
          <Tab label={tab.label} key={tab.label} />
        ))}
      </Tabs>
      <Box sx={{ p: 2 }}>
        {tabs[value]?.content}
      </Box>
    </Box>
  );
}
