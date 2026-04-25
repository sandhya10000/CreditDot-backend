require('dotenv').config();
const GoogleAnalyticsService = require('./utils/googleAnalytics');

async function testAnalyticsConnection() {
  console.log('Testing Google Analytics connection...');
  
  try {
    const gaService = new GoogleAnalyticsService();
    
    console.log('Service initialized. Testing real-time visitors...');
    
    // Test real-time visitors
    const realTimeVisitors = await gaService.getRealTimeVisitors();
    console.log('Real-time visitors:', realTimeVisitors);
    
    // Test total visitors
    console.log('Testing total visitors...');
    const totalStats = await gaService.getTotalVisitors('7daysAgo', 'today');
    console.log('Total stats:', totalStats);
    
    // Test top pages
    console.log('Testing top pages...');
    const topPages = await gaService.getTopPages(5);
    console.log('Top pages:', topPages);
    
    // Test traffic sources
    console.log('Testing traffic sources...');
    const trafficSources = await gaService.getTrafficSources();
    console.log('Traffic sources:', trafficSources);
    
    console.log('All tests completed successfully!');
    
  } catch (error) {
    console.error('Test failed:', error.message);
    console.error('Full error:', error);
  }
}

testAnalyticsConnection();