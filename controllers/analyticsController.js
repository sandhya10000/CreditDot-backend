const GoogleAnalyticsService = require('../utils/googleAnalytics');

// Initialize Google Analytics service with error handling
let googleAnalyticsService;
try {
  googleAnalyticsService = new GoogleAnalyticsService();
  console.log('Google Analytics service initialized successfully');
} catch (error) {
  console.error('Failed to initialize Google Analytics service:', error.message);
  console.warn('Analytics features will be disabled');
  
  // Create a mock service that returns default values
  googleAnalyticsService = {   
    getRealTimeVisitors: async () => 0,
    getTotalVisitors: async () => ({
      totalUsers: 0,
      pageViews: 0,
      sessions: 0,
      bounceRate: 0,
      avgSessionDuration: 0,
    }),
    getVisitorsByDate: async () => [],
    getTopPages: async () => [],
    getTrafficSources: async () => [],
  };
}

/**
 * Get website visitor statistics
 */
const getVisitorStats = async (req, res) => {
  console.log('Analytics route hit: /api/analytics/visitors');
  console.log('Query params:', req.query);
  console.log('User authenticated:', req.user ? true : false);
  console.log('User role:', req.user ? req.user.role : 'No user');
  
  try {
    // Support flexible time periods
    const { period = '1dayAgo' } = req.query;
    
    // Validate period parameter to prevent injection attacks
    const validPeriods = [
      '1dayAgo', '7daysAgo', '14daysAgo', '30daysAgo', 
      '90daysAgo', '365daysAgo', 'today', 'yesterday'
    ];
    
    if (!validPeriods.includes(period)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid period. Valid periods: ' + validPeriods.join(', ')
      });
    }
    
    // Get real-time visitors first (this is working)
    const realTimeVisitors = await googleAnalyticsService.getRealTimeVisitors();
    
    // Get other data with fallback handling
    let totalStats, chartData, topPages, trafficSources;
    
    try {
      totalStats = await googleAnalyticsService.getTotalVisitors(period, 'today');
    } catch (error) {
      console.log('Using fallback for total stats');
      totalStats = {
        totalUsers: 0,
        pageViews: 0,
        sessions: 0,
        bounceRate: 0,
        avgSessionDuration: 0
      };
    }
    
    try {
      chartData = await googleAnalyticsService.getVisitorsByDate(period, 'today');
    } catch (error) {
      console.log('Using fallback for chart data');
      chartData = [];
    }
    
    try {
      topPages = await googleAnalyticsService.getTopPages(5);
    } catch (error) {
      console.log('Using fallback for top pages');
      topPages = [];
    }
    
    try {
      trafficSources = await googleAnalyticsService.getTrafficSources();
    } catch (error) {
      console.log('Using fallback for traffic sources');
      trafficSources = [];
    }

    console.log('Successfully fetched visitor stats, sending response');
    
    res.json({
      success: true,
      data: {
        realTimeVisitors,
        totalStats,
        chartData,
        topPages,
        trafficSources,
        period, // Include the period in the response
        lastUpdated: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error in getVisitorStats:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    res.status(500).json({
      success: false,
      message: 'Failed to fetch visitor statistics',
      error: error.message
    });
  }
};

/**
 * Get real-time visitor count only
 */
const getRealTimeVisitors = async (req, res) => {
  console.log('Analytics route hit: /api/analytics/visitors/realtime');
  console.log('User authenticated:', req.user ? true : false);
  console.log('User role:', req.user ? req.user.role : 'No user');
  
  try {
    const visitors = await googleAnalyticsService.getRealTimeVisitors();
    
    res.json({
      success: true,
      data: {
        realTimeVisitors: visitors,
        lastUpdated: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error in getRealTimeVisitors:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    res.status(500).json({
      success: false,
      message: 'Failed to fetch real-time visitors',
      error: error.message
    });
  }
};

/**
 * Get visitor trends for charts
 */
const getVisitorTrends = async (req, res) => {
  console.log('Analytics route hit: /api/analytics/visitors/trends');
  console.log('Query params:', req.query);
  console.log('User authenticated:', req.user ? true : false);
  console.log('User role:', req.user ? req.user.role : 'No user');
  
  try {
    const { period = '1dayAgo' } = req.query;
    
    // Validate period parameter to prevent injection attacks
    const validPeriods = [
      '1dayAgo', '7daysAgo', '14daysAgo', '30daysAgo', 
      '90daysAgo', '365daysAgo', 'today', 'yesterday'
    ];
    
    if (!validPeriods.includes(period)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid period. Valid periods: ' + validPeriods.join(', ')
      });
    }
    
    const chartData = await googleAnalyticsService.getVisitorsByDate(period, 'today');
    
    res.json({
      success: true,
      data: {
        chartData,
        period,
        lastUpdated: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error in getVisitorTrends:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    res.status(500).json({
      success: false,
      message: 'Failed to fetch visitor trends',
      error: error.message
    });
  }
};

module.exports = {
  getVisitorStats,
  getRealTimeVisitors,
  getVisitorTrends
};