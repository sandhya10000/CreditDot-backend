const GoogleSheet = require('../models/GoogleSheet');
const googleSheetsService = require('../utils/googleSheetsService');

// Helper function to ensure all required tabs are present in settings
const ensureRequiredTabs = (tabsMap) => {
  const requiredTabs = [
    'creditScore',
    'applyForLoan',
    'creditScoreRepair',
    'contactUs',
    'newRegistration',
    'franchiseOpportunity',
    'businessLogin',
    'suvidhaCentre'
  ];
  
  for (const tab of requiredTabs) {
    if (!tabsMap.has(tab)) {
      tabsMap.set(tab, { enabled: true, lastSync: null });
    }
  }
  
  return tabsMap;
};

// Get Google Sheets settings
const getSettings = async (req, res) => {
  try {
    const settings = await GoogleSheet.findOne();
    if (!settings) {
      // Return default settings structure if none exist
      // Convert tabs to a format that can be properly converted to Map
      const defaultTabs = new Map([
        ['creditScore', { enabled: true, lastSync: null }],
        ['applyForLoan', { enabled: true, lastSync: null }],
        ['creditScoreRepair', { enabled: true, lastSync: null }],
        ['contactUs', { enabled: true, lastSync: null }],
        ['newRegistration', { enabled: true, lastSync: null }],
        ['franchiseOpportunity', { enabled: true, lastSync: null }],
        ['businessLogin', { enabled: true, lastSync: null }],
        ['suvidhaCentre', { enabled: true, lastSync: null }]
      ]);
      
      return res.json({
        spreadsheetId: '',
        tabs: Object.fromEntries(defaultTabs),
        syncSettings: {
          autoSync: true,
          syncInterval: 300,
          twoWaySync: true
        },
        isActive: false
      });
    }
    
    // Remove sensitive credentials from response
    const settingsObj = settings.toObject();
    console.log('Settings credentials exist:', !!settings.credentials);
    delete settingsObj.credentials;
    
    res.json(settingsObj);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Update Google Sheets settings
const updateSettings = async (req, res) => {
  try {
    const { spreadsheetId, tabs, syncSettings, isActive } = req.body;
    
    // Parse tabs and syncSettings if they are strings
    let parsedTabs;
    let parsedSyncSettings;
    
    try {
      parsedTabs = typeof tabs === 'string' ? JSON.parse(tabs) : tabs;
      parsedSyncSettings = typeof syncSettings === 'string' ? JSON.parse(syncSettings) : syncSettings;
    } catch (parseError) {
      console.error('Error parsing tabs or syncSettings:', parseError);
      return res.status(400).json({ message: 'Invalid JSON in tabs or syncSettings' });
    }
    
    let settings = await GoogleSheet.findOne();
    
    if (settings) {
      // Update existing settings
      if (spreadsheetId) {
        // Extract spreadsheet ID from URL if full URL is provided
        let cleanSpreadsheetId = spreadsheetId;
        if (spreadsheetId.includes('docs.google.com/spreadsheets')) {
          // Extract ID from URL
          const match = spreadsheetId.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
          if (match && match[1]) {
            cleanSpreadsheetId = match[1];
          }
        }
        settings.spreadsheetId = cleanSpreadsheetId;
      }
      
      // Only update credentials if provided in the request
      if (req.file) {
        try {
          // Parse the JSON file content
          const credentials = JSON.parse(req.file.buffer.toString());
          console.log('Parsed credentials:', {
            client_email: credentials.client_email,
            private_key_exists: !!credentials.private_key
          });
          settings.credentials = googleSheetsService.encryptCredentials(credentials);
          console.log('Saved credentials to settings');
        } catch (parseError) {
          console.error('Error parsing credentials file:', parseError);
          return res.status(400).json({ message: 'Invalid credentials JSON file' });
        }
      }
      
      if (parsedTabs) {
        // Convert parsedTabs object to Map if it's not already
        if (!(parsedTabs instanceof Map)) {
          const tabsMap = new Map();
          for (const [key, value] of Object.entries(parsedTabs)) {
            tabsMap.set(key, value);
          }
          settings.tabs = ensureRequiredTabs(tabsMap);
        } else {
          settings.tabs = ensureRequiredTabs(parsedTabs);
        }
      } else {
        // Ensure all required tabs exist in existing settings
        settings.tabs = ensureRequiredTabs(settings.tabs);
      }
      if (parsedSyncSettings) settings.syncSettings = parsedSyncSettings;
      if (typeof isActive !== 'undefined') settings.isActive = isActive;
      
      await settings.save();
    } else {
      // Create new settings
      let credentials = null;
      if (req.file) {
        try {
          // Parse the JSON file content
          credentials = JSON.parse(req.file.buffer.toString());
          console.log('Parsed credentials for new settings:', {
            client_email: credentials.client_email,
            private_key_exists: !!credentials.private_key
          });
        } catch (parseError) {
          console.error('Error parsing credentials file:', parseError);
          return res.status(400).json({ message: 'Invalid credentials JSON file' });
        }
      }
      
      // Convert parsedTabs to Map if provided
      let tabsMap = new Map();
      if (parsedTabs) {
        if (!(parsedTabs instanceof Map)) {
          for (const [key, value] of Object.entries(parsedTabs)) {
            tabsMap.set(key, value);
          }
        } else {
          tabsMap = parsedTabs;
        }
      } else {
        // Default tabs if none provided
        tabsMap = new Map([
          ['creditScore', { enabled: true, lastSync: null }],
          ['applyForLoan', { enabled: true, lastSync: null }],
          ['creditScoreRepair', { enabled: true, lastSync: null }],
          ['contactUs', { enabled: true, lastSync: null }],
          ['newRegistration', { enabled: true, lastSync: null }],
          ['franchiseOpportunity', { enabled: true, lastSync: null }],
          ['businessLogin', { enabled: true, lastSync: null }],
          ['suvidhaCentre', { enabled: true, lastSync: null }]
        ]);
      }
      
      // Ensure all required tabs are present
      tabsMap = ensureRequiredTabs(tabsMap);
      
      // Extract spreadsheet ID from URL if full URL is provided
      let cleanSpreadsheetId = spreadsheetId || '';
      if (cleanSpreadsheetId && cleanSpreadsheetId.includes('docs.google.com/spreadsheets')) {
        // Extract ID from URL
        const match = cleanSpreadsheetId.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
        if (match && match[1]) {
          cleanSpreadsheetId = match[1];
        }
      }
      
      settings = new GoogleSheet({
        spreadsheetId: cleanSpreadsheetId,
        credentials: credentials ? googleSheetsService.encryptCredentials(credentials) : null,
        tabs: tabsMap,
        syncSettings: parsedSyncSettings || {},
        isActive: typeof isActive !== 'undefined' ? isActive : false
      });
      
      await settings.save();
    }
    
    // Remove sensitive credentials from response
    const settingsObj = settings.toObject();
    console.log('Updated settings credentials exist:', !!settings.credentials);
    delete settingsObj.credentials;
    
    res.json({
      message: 'Google Sheets settings updated successfully',
      settings: settingsObj
    });
  } catch (error) {
    console.error('Error updating Google Sheets settings:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Test Google Sheets connection
const testConnection = async (req, res) => {
  try {
    const initialized = await googleSheetsService.initialize();
    
    if (initialized) {
      res.json({ message: 'Google Sheets connection successful' });
    } else {
      res.status(500).json({ message: 'Failed to connect to Google Sheets' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Sync credit score data
const syncCreditScoreData = async (req, res) => {
  try {
    console.log('Manual sync credit score data request received');
    const initialized = await googleSheetsService.initialize();
    
    if (!initialized) {
      console.log('Failed to initialize Google Sheets service for credit score sync');
      return res.status(500).json({ message: 'Failed to initialize Google Sheets service' });
    }
    
    console.log('Google Sheets service initialized, starting credit score sync');
    const result = await googleSheetsService.syncCreditScoreData();
    console.log('Credit score sync completed with result:', result);
    
    if (result.success) {
      res.json({ message: `Successfully synced ${result.count} credit score records` });
    } else {
      res.status(500).json({ message: 'Failed to sync credit score data', error: result.error });
    }
  } catch (error) {
    console.error('Credit score sync failed:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Sync business form data (apply for loan)
const syncBusinessFormData = async (req, res) => {
  try {
    const initialized = await googleSheetsService.initialize();
    
    if (!initialized) {
      return res.status(500).json({ message: 'Failed to initialize Google Sheets service' });
    }
    
    const result = await googleSheetsService.syncBusinessFormData();
    
    if (result.success) {
      res.json({ message: `Successfully synced ${result.count} business form records` });
    } else {
      res.status(500).json({ message: 'Failed to sync business form data', error: result.error });
    }
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Sync credit repair data
const syncCreditRepairData = async (req, res) => {
  try {
    const initialized = await googleSheetsService.initialize();
    
    if (!initialized) {
      return res.status(500).json({ message: 'Failed to initialize Google Sheets service' });
    }
    
    const result = await googleSheetsService.syncCreditRepairData();
    
    if (result.success) {
      res.json({ message: `Successfully synced ${result.count} credit repair records` });
    } else {
      res.status(500).json({ message: 'Failed to sync credit repair data', error: result.error });
    }
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Sync contact form data
const syncContactFormData = async (req, res) => {
  try {
    const initialized = await googleSheetsService.initialize();
    
    if (!initialized) {
      return res.status(500).json({ message: 'Failed to initialize Google Sheets service' });
    }
    
    const result = await googleSheetsService.syncContactFormData();
    
    if (result.success) {
      res.json({ message: `Successfully synced ${result.count} contact form records` });
    } else {
      res.status(500).json({ message: 'Failed to sync contact form data', error: result.error });
    }
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Sync registration data
const syncRegistrationData = async (req, res) => {
  try {
    const initialized = await googleSheetsService.initialize();
    
    if (!initialized) {
      return res.status(500).json({ message: 'Failed to initialize Google Sheets service' });
    }
    
    const result = await googleSheetsService.syncRegistrationData();
    
    if (result.success) {
      res.json({ message: `Successfully synced ${result.count} registration records` });
    } else {
      res.status(500).json({ message: 'Failed to sync registration data', error: result.error });
    }
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Sync franchise opportunity data
const syncFranchiseOpportunityData = async (req, res) => {
  try {
    const initialized = await googleSheetsService.initialize();
    
    if (!initialized) {
      return res.status(500).json({ message: 'Failed to initialize Google Sheets service' });
    }
    
    const result = await googleSheetsService.syncFranchiseOpportunityData();
    
    if (result.success) {
      res.json({ message: `Successfully synced ${result.count} franchise opportunity records` });
    } else {
      res.status(500).json({ message: 'Failed to sync franchise opportunity data', error: result.error });
    }
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Sync business login data
const syncBusinessLoginData = async (req, res) => {
  try {
    const initialized = await googleSheetsService.initialize();
    
    if (!initialized) {
      return res.status(500).json({ message: 'Failed to initialize Google Sheets service' });
    }
    
    const result = await googleSheetsService.syncBusinessLoginData();
    
    if (result.success) {
      res.json({ message: `Successfully synced ${result.count} business login records` });
    } else {
      res.status(500).json({ message: 'Failed to sync business login data', error: result.error });
    }
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Sync suvidha centre application data
const syncSuvidhaCentreData = async (req, res) => {
  try {
    const initialized = await googleSheetsService.initialize();
    
    if (!initialized) {
      return res.status(500).json({ message: 'Failed to initialize Google Sheets service' });
    }
    
    const result = await googleSheetsService.syncSuvidhaCentreApplicationData();
    
    if (result.success) {
      res.json({ message: `Successfully synced ${result.count} suvidha centre application records` });
    } else {
      res.status(500).json({ message: 'Failed to sync suvidha centre application data', error: result.error });
    }
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Sync all data
const syncAllData = async (req, res) => {
  try {
    console.log('Manual sync all data request received');
    const initialized = await googleSheetsService.initialize();
    
    if (!initialized) {
      console.log('Failed to initialize Google Sheets service for manual sync');
      return res.status(500).json({ message: 'Failed to initialize Google Sheets service' });
    }
    
    console.log('Google Sheets service initialized, starting sync');
    const results = await googleSheetsService.syncAllData();
    console.log('Manual sync completed with results:', results);
    
    res.json({
      message: 'Data synchronization completed',
      results
    });
  } catch (error) {
    console.error('Manual sync failed:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = {
  getSettings,
  updateSettings,
  testConnection,
  syncCreditScoreData,
  syncBusinessFormData,
  syncCreditRepairData,
  syncContactFormData,
  syncRegistrationData,
  syncFranchiseOpportunityData,
  syncBusinessLoginData,
  syncSuvidhaCentreData,
  syncAllData
};