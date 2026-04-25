/**
 * Test script for Claude AI Integration
 * 
 * Usage: node testClaudeAI.js
 * 
 * This script tests:
 * 1. Environment variable configuration
 * 2. Document file reading
 * 3. Claude API connection
 * 4. Document analysis 
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { processDocument } = require('./utils/claudeService');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m'
};

console.log(`${colors.blue}=== Claude AI Integration Test ===${colors.reset}\n`);

// Test 1: Check environment variables
console.log('Test 1: Checking environment variables...');
if (!process.env.CLAUDE_API_KEY || process.env.CLAUDE_API_KEY === 'your_claude_api_key_here') {
  console.log(`${colors.red}✗ CLAUDE_API_KEY not configured${colors.reset}`);
  console.log('Please add CLAUDE_API_KEY to your .env file');
  process.exit(1);
}
console.log(`${colors.green}✓ CLAUDE_API_KEY configured${colors.reset}`);

if (!process.env.AI_ANALYSIS_PROMPT) {
  console.log(`${colors.yellow}⚠ AI_ANALYSIS_PROMPT not set (using default)${colors.reset}`);
} else {
  console.log(`${colors.green}✓ AI_ANALYSIS_PROMPT configured${colors.reset}`);
}

// Test 2: Create a sample document for testing
console.log('\nTest 2: Creating sample test document...');
const testFilePath = path.join(__dirname, 'test-document.txt');

const sampleText = `CREDIT REPORT SUMMARY

Name: John Doe
SSN: XXX-XX-1234
Date of Birth: 01/15/1985

CREDIT SCORE: 720 (Good)

PAYMENT HISTORY:
- Current accounts: 5
- Late payments (30 days): 1 in last 12 months
- Delinquent accounts: 0

CREDIT UTILIZATION: 35%
Total Credit Limit: $50,000
Total Balance: $17,500

DEROGATORY MARKS: None

CREDIT INQUIRIES:
- Hard inquiries (last 2 years): 2
- Soft inquiries (last 12 months): 5

RECOMMENDATIONS:
1. Reduce credit utilization below 30%
2. Continue making on-time payments
3. Avoid opening new credit accounts
`;

// Create a simple test file
fs.writeFileSync(testFilePath, sampleText, 'utf-8');
console.log(`${colors.green}✓ Test document created${colors.reset}`);

// Test 3: Test Claude API with text content
console.log('\nTest 3: Testing Claude API analysis...');

async function testClaudeAnalysis() {
  try {
    // Simulate document analysis
    const result = await processDocument(testFilePath, 'test-document.txt', null);
    
    console.log(`${colors.green}✓ Claude analysis completed successfully${colors.reset}`);
    console.log(`\n${colors.blue}Analysis Result Preview:${colors.reset}`);
    console.log('---');
    // Show first 500 characters of analysis
    console.log(result.content.substring(0, 500) + '...\n');
    console.log('---');
    
    // Clean up test files
    fs.unlinkSync(testFilePath);
    console.log(`${colors.green}✓ Test files cleaned up${colors.reset}`);
    
    console.log(`\n${colors.green}=== All Tests Passed! ===${colors.reset}`);
    console.log('\nThe Claude AI integration is working correctly.');
    console.log('You can now upload documents in the franchise dashboard.');
    
  } catch (error) {
    console.log(`${colors.red}✗ Claude analysis failed${colors.reset}`);
    console.log(`${colors.red}Error: ${error.message}${colors.reset}`);
    
    if (error.message.includes('API key')) {
      console.log('\nPlease check your CLAUDE_API_KEY in .env file');
    } else if (error.message.includes('rate limit')) {
      console.log('\nRate limit exceeded. Please wait and try again.');
    }
    
    // Clean up test file
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
    
    process.exit(1);
  }
}

// Run the test
testClaudeAnalysis();
