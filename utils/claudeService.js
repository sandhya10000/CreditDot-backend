const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');

// Initialize Claude client
const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

/**
 * Load AI analysis prompt from file or environment
 * @returns {string} - The prompt to use
 */
const loadAnalysisPrompt = () => {
  try {
    // Try to load from prompt file first
    const promptFilePath = path.join(__dirname, '..', 'config', 'ai-analysis-prompt.txt');
    if (fs.existsSync(promptFilePath)) {
      console.log('Loading prompt from file:', promptFilePath);
      return fs.readFileSync(promptFilePath, 'utf-8').trim();
    }
    
    // Fallback to environment variable
    if (process.env.AI_ANALYSIS_PROMPT) {
      console.log('Loading prompt from environment variable');
      return process.env.AI_ANALYSIS_PROMPT;
    }
    
    // Default prompt
    console.log('Using default prompt');
    return 'You are the Senior Credit Analyst and Technical Report Generator for "Credit Dost," India\'s premier credit repair consulting firm. Your task is to analyze the provided CIBIL credit report data and generate a high-precision, visually rich HTML Credit Analysis Report.';
  } catch (error) {
    console.error('Error loading prompt, using default:', error.message);
    return 'You are the Senior Credit Analyst and Technical Report Generator for "Credit Dost." Analyze this credit report and provide a comprehensive HTML analysis report.';
  }
};

/**
 * Read file as base64 for sending to Claude
 * @param {string} filePath - Path to the file
 * @returns {Promise<{base64: string, mediaType: string}>}
 */
const readFileAsBase64 = async (filePath) => {
  try {
    const fileBuffer = await fs.promises.readFile(filePath);
    const base64 = fileBuffer.toString('base64');
    
    // Detect MIME type
    let mediaType = mime.lookup(filePath) || 'application/octet-stream';
    
    // Ensure it's a supported media type
    if (!['application/pdf', 'text/html', 'text/plain'].includes(mediaType)) {
      mediaType = 'application/pdf'; // Default to PDF for unknown types
    }
    
    return { base64, mediaType };
  } catch (error) {
    console.error('Error reading file:', error.message);
    throw new Error('Failed to read file');
  }
};

/**
 * Read HTML file content
 * @param {string} htmlPath - Path to the HTML file
 * @returns {Promise<string>} - HTML content
 */
const readHTMLFile = async (htmlPath) => {
  try {
    const content = await fs.promises.readFile(htmlPath, 'utf-8');
    return content;
  } catch (error) {
    console.error('Error reading HTML file:', error.message);
    throw new Error('Failed to read HTML file');
  }
};

/**
 * Analyze document content using Claude AI
 * @param {Object} documentData - Document data (base64 or text)
 * @param {string} prompt - Analysis prompt/instructions
 * @param {string} documentType - Type of document ('pdf', 'html', 'text')
 * @returns {Promise<string>} - HTML analysis report
 */
const analyzeWithClaude = async (documentData, prompt, documentType = 'pdf') => {
  try {
    // Validate API key
    if (!process.env.CLAUDE_API_KEY || process.env.CLAUDE_API_KEY === 'your_claude_api_key_here') {
      throw new Error('Claude API key not configured. Please add CLAUDE_API_KEY to your .env file.');
    }

    // Get model from environment or use default
    const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';

    // Load the full prompt (from file, env, or parameter)
    const systemPrompt = prompt || loadAnalysisPrompt();

    console.log('Analyzing document with Claude model:', model);
    console.log('Prompt length:', systemPrompt.length, 'characters');

    // Build the message content based on document type
    let messageContent;
    
    if (documentType === 'pdf' && documentData.base64) {
      // Send PDF file directly to Claude (native support)
      messageContent = [
        {
          type: 'document',
          source: {
            type: 'base64',
            media_type: documentData.mediaType,
            data: documentData.base64
          }
        },
        {
          type: 'text',
          text: systemPrompt
        }
      ];
    } else if (documentType === 'html' && documentData.base64) {
      // Send HTML file as document
      messageContent = [
        {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'text/html',
            data: documentData.base64
          }
        },
        {
          type: 'text',
          text: systemPrompt
        }
      ];
    } else {
      // Send as plain text
      messageContent = [
        {
          type: 'text',
          text: `${systemPrompt}\n\n---\nDOCUMENT CONTENT:\n${documentData.text}\n---`
        }
      ];
    }

    console.log('Sending request to Claude API...');

    // Call Claude API with streaming for long-running requests
    // Streaming is required for operations that may take longer than 10 minutes
    const stream = await anthropic.messages.stream({
      model: model,
      max_tokens: 25000, // Increased to 25k tokens for comprehensive analysis reports
      messages: [
        {
          role: 'user',
          content: messageContent
        }
      ]
    });

    console.log('Received response stream from Claude API');

    // Wait for the final message (this collects all chunks automatically)
    const finalMessage = await stream.finalMessage();
    
    console.log('Stream completed');
    console.log('Response tokens - Input:', finalMessage.usage.input_tokens, ', Output:', finalMessage.usage.output_tokens, ', Total:', (finalMessage.usage.input_tokens + finalMessage.usage.output_tokens));

    // Extract the analysis from the final message
    let analysisContent = '';
    
    if (finalMessage.content && finalMessage.content.length > 0) {
      analysisContent = finalMessage.content[0].text || '';
    }
    
    if (!analysisContent) {
      throw new Error('No content received from Claude API');
    }

    // Clean up the response - remove markdown code blocks if present
    let cleanedAnalysis = analysisContent;
    
    // Remove markdown code block wrappers if Claude wraps HTML in them
    if (cleanedAnalysis.startsWith('```html')) {
      cleanedAnalysis = cleanedAnalysis.replace(/^```html\s*/, '').replace(/\s*```$/, '');
    } else if (cleanedAnalysis.startsWith('```')) {
      cleanedAnalysis = cleanedAnalysis.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    return cleanedAnalysis.trim();
  } catch (error) {
    console.error('Error analyzing with Claude:', error.message);
    
    // Provide more specific error messages
    if (error.status === 401) {
      throw new Error('Invalid Claude API key. Please check your API key configuration.');
    } else if (error.status === 429) {
      throw new Error('Claude API rate limit exceeded. Please try again later.');
    } else if (error.status === 500) {
      throw new Error('Claude API server error. Please try again later.');
    }
    
    throw new Error(`Claude analysis failed: ${error.message}`);
  }
};

/**
 * Process and analyze uploaded document
 * @param {string} filePath - Path to uploaded document
 * @param {string} fileName - Original file name
 * @param {string} customPrompt - Optional custom prompt
 * @returns {Promise<{content: string, type: string}>} - Document content and type
 */
const processDocument = async (filePath, fileName, customPrompt = null) => {
  try {
    const fileExtension = path.extname(fileName).toLowerCase();
    let documentData;
    let documentType;

    // Prepare document based on file type
    if (['.pdf'].includes(fileExtension)) {
      // Send PDF directly to Claude as base64
      documentData = await readFileAsBase64(filePath);
      documentType = 'pdf';
    } else if (['.html', '.htm'].includes(fileExtension)) {
      // Send HTML directly to Claude as base64
      documentData = await readFileAsBase64(filePath);
      documentType = 'html';
    } else {
      // Try to read as text
      const content = await fs.promises.readFile(filePath, 'utf-8');
      documentData = { text: content };
      documentType = 'text';
    }

    // Analyze with Claude
    const analysisHtml = await analyzeWithClaude(documentData, customPrompt, documentType);

    return {
      content: analysisHtml,
      type: 'html',
      originalType: documentType
    };
  } catch (error) {
    console.error('Error processing document:', error.message);
    throw error;
  }
};

module.exports = {
  readFileAsBase64,
  readHTMLFile,
  analyzeWithClaude,
  processDocument
};
