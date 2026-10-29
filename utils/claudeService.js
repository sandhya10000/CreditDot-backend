const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');

const {
  getLanguageConfig,
  isMultiLangEnabled,
  DEFAULT_LANGUAGE_CODE,
} = require('../config/languages');

// Initialize Claude client
const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

/**
 * Pure function: build language directive text.
 * Returns empty string ('') if language is 'en', empty, or if MULTILANG_ENABLED flag is off.
 * @param {string} languageCode
 * @returns {string}
 */
const buildLanguageDirective = (languageCode) => {
  if (!isMultiLangEnabled()) {
    return '';
  }

  const lang = getLanguageConfig(languageCode);
  if (!lang || lang.code === DEFAULT_LANGUAGE_CODE) {
    return '';
  }

  return `\n\n` +
`======================================================================\n` +
`LANGUAGE INSTRUCTION: GENERATE REPORT IN ${lang.name.toUpperCase()} (${lang.nativeName})\n` +
`======================================================================\n` +
`1. OVERRIDE: This language instruction OVERRIDES the instruction to "only replace data". You MUST translate all visible user-facing text, section headings, card titles, table column headers, problem descriptions, analytical summaries, status labels, educational disclaimers, and recommendations into ${lang.name} (${lang.nativeName}).\n` +
`2. INVARIANCE - STRICTLY PRESERVE THE FOLLOWING WITHOUT TRANSLATION:\n` +
`   - HTML structure, all tag names, all CSS classes (e.g., "badge-critical", "account-grid", "section-title"), all HTML IDs, and all CSS variable names must remain exactly as shown in the template.\n` +
`   - Numbers and amounts: Keep all numbers, percentages, tenure months, and currency figures (₹ and INR) in Latin Arabic numerals (e.g. ₹4,50,000, 750, 18.5%, 36 Months). NEVER spell numbers out in words or convert to Indic numerals.\n` +
`   - Dates: Keep dates in standard format (e.g. 15-AUG-2024, 05/2023).\n` +
`   - Proper nouns: Client legal name, bank and NBFC names (e.g. HDFC Bank, SBI Cards, ICICI Bank, Bajaj Finance), and CIBIL Control Number / ECN.\n` +
`   - Financial acronyms: Retain standard industry acronyms in English/Latin, optionally with translated explanation (e.g. DPD, SMA-0, SMA-1, SMA-2, NPA, CIBIL, Credit Score, Written Off, Settled).\n` +
`   - QuickChart URLs and chart labels: Keep chart query params, canvas configurations, and chart legend text in English so QuickChart can render them correctly.\n` +
`3. TONE & VOCABULARY: Use formal, respectful, and authoritative Indian financial consulting terminology suitable for Credit Dost's premier advisory reputation.\n` +
`======================================================================`;
};

/**
 * Deterministically post-processes HTML report:
 * 1. Sets/replaces <html lang="..."> attribute.
 * 2. Injects Google Font <link> into <head> (idempotent, safe if <head> is missing).
 * 3. Prepends font family with fallbacks (Noto, Nirmala UI, Segoe UI) into CSS body rule.
 * @param {string} html
 * @param {string} languageCode
 * @returns {string}
 */
const postProcessReportHtml = (html, languageCode) => {
  if (!html || typeof html !== 'string') return html;

  let processed = html;

  // Safety net: Strip "formatter":<number> or %22formatter%22:<number> from quickchart.io URLs.
  // QuickChart gauge plugins expect a function for formatter; passing a number crashes with "fmt is not a function".
  if (processed.includes('quickchart.io')) {
    processed = processed.replace(
      /(https?:\/\/[^"'\s>]*quickchart\.io\/chart\?[^"'\s>]*)/g,
      (match) => {
        return match
          .replace(/(?:%22formatter%22|"formatter"):(-?\d+(?:\.\d+)?)(%2C|,)?/g, '')
          .replace(/([,{])(?:\s*(?:%2C|,))+/g, '$1') // clean up double commas if any
          .replace(/(?:%2C|,)(%7D|\})/g, '$1');       // clean up trailing comma before closing brace
      }
    );
  }

  const lang = getLanguageConfig(languageCode);
  if (!lang || lang.code === DEFAULT_LANGUAGE_CODE) {
    return processed; // English requires no font or lang modifications
  }

  // 1. Update <html lang="en"> -> <html lang="${lang.code}">
  if (/<html[^>]*>/i.test(processed)) {
    processed = processed.replace(/<html(\s+[^>]*)?>/i, (match, attrs = '') => {
      const cleanAttrs = attrs.replace(/\s*lang=(["'])[^"']*\1/i, '');
      return `<html${cleanAttrs} lang="${lang.code}">`;
    });
  }

  // 2. Inject Google Font stylesheet if defined
  if (lang.googleFont && !processed.includes(lang.googleFont)) {
    const fontLinkTags =
      `\n    <link rel="preconnect" href="https://fonts.googleapis.com">\n` +
      `    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n` +
      `    <link href="${lang.googleFont}" rel="stylesheet">\n`;

    if (/<head[^>]*>/i.test(processed)) {
      processed = processed.replace(/(<head[^>]*>)/i, `$1${fontLinkTags}`);
    } else {
      processed = `<head>${fontLinkTags}</head>\n` + processed;
    }
  }

  // 3. Update body font-family in CSS to prepend target font with Nirmala UI / Segoe UI fallbacks
  const targetFont = lang.fontFamily;
  if (targetFont && /font-family\s*:\s*[^;]+;/i.test(processed)) {
    processed = processed.replace(
      /(body\s*\{[^}]*?font-family\s*:\s*)([^;]+)(;)/i,
      (match, prefix, oldFont, suffix) => {
        if (oldFont.includes(lang.name) || oldFont.includes(lang.script)) {
          return match; // Already updated
        }
        return `${prefix}${targetFont}${suffix}`;
      }
    );
  }

  return processed;
};

/**
 * Validates generated report output:
 * - Must end with </html> (case-insensitive, ignoring trailing whitespace).
 * - For non-English target languages, must contain at least one character matching the target script's Unicode range.
 * @param {string} html
 * @param {string} languageCode
 * @returns {{valid: boolean, reason?: string}}
 */
const validateReportOutput = (html, languageCode) => {
  if (!html || typeof html !== 'string') {
    return { valid: false, reason: 'Empty report output' };
  }

  const trimmed = html.trim();
  if (!/<\/html>\s*$/i.test(trimmed)) {
    return { valid: false, reason: 'Report output is truncated or missing closing </html> tag' };
  }

  const lang = getLanguageConfig(languageCode);
  if (lang && lang.code !== DEFAULT_LANGUAGE_CODE && lang.unicodeRegex) {
    if (!lang.unicodeRegex.test(trimmed)) {
      return {
        valid: false,
        reason: `Report output does not contain expected characters for script: ${lang.script} (${lang.name})`,
      };
    }
  }

  return { valid: true };
};

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
 * Cleans raw model output before validation:
 * 1. Trims leading/trailing whitespace.
 * 2. Strips leading ```html or ``` fence and trailing ``` fence (handles whitespace/newlines before fence).
 * 3. If text contains "<!doctype" or "<html", discards everything before the first match.
 * 4. If text contains "</html>", discards everything after the LAST occurrence (case-insensitive).
 * @param {string} raw
 * @returns {string}
 */
const cleanModelOutput = (raw) => {
  if (!raw || typeof raw !== 'string') return raw;

  let text = raw.trim();

  // Step 1: Strip markdown code fences (even if preceded by whitespace/newlines)
  text = text.replace(/^[\s\S]*?```(?:html)?\s*\n?([\s\S]*?)```\s*$/i, (match, inner) => inner.trim());
  // Fallback: strip only opening fence if no closing fence was found above
  text = text.replace(/^\s*```(?:html)?\s*\n?/i, '');
  // Strip any trailing isolated closing fence
  text = text.replace(/\n?\s*```\s*$/i, '').trim();

  // Step 2: Discard preamble text before the HTML document start
  const doctypeIdx = text.search(/<!doctype/i);
  const htmlTagIdx = text.search(/<html/i);
  const htmlStartIdx = [doctypeIdx, htmlTagIdx].filter(i => i !== -1);
  if (htmlStartIdx.length > 0) {
    text = text.slice(Math.min(...htmlStartIdx));
  }

  // Step 3: Discard anything after the LAST </html>
  const lastHtmlClose = text.search(/(<\/html>)(?![\s\S]*<\/html>)/i);
  if (lastHtmlClose !== -1) {
    // include the </html> tag itself (7 chars)
    text = text.slice(0, lastHtmlClose + 7);
  }

  return text.trim();
};

/**
 * Internal single attempt execution with Claude
 */
const executeClaudeAttempt = async (documentData, basePrompt, documentType, languageCode) => {
  // Validate API key
  if (!process.env.CLAUDE_API_KEY || process.env.CLAUDE_API_KEY === 'your_claude_api_key_here') {
    throw new Error('Claude API key not configured. Please add CLAUDE_API_KEY to your .env file.');
  }

  // Get model from environment or use default
  const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';

  // Load the full prompt and append language directive at runtime (non-en only)
  const languageDirective = buildLanguageDirective(languageCode);
  const systemPrompt = `${basePrompt}${languageDirective}`;

  console.log('Analyzing document with Claude model:', model);
  console.log('Prompt length:', systemPrompt.length, 'characters');
  if (languageDirective) {
    console.log('Multi-language directive appended for language:', languageCode);
  }

  // max_tokens: read from env if set, otherwise use generous defaults.
  // claude-sonnet-4 supports 64k output; Haiku 4.5 is capped at 8192 by the model itself.
  // Non-English Indic scripts receive a higher budget due to multi-byte UTF-8 expansion.
  const isNonEnglish = isMultiLangEnabled() && languageCode && languageCode !== DEFAULT_LANGUAGE_CODE;
  const maxTokens = process.env.CLAUDE_MAX_TOKENS
    ? parseInt(process.env.CLAUDE_MAX_TOKENS, 10)
    : (isNonEnglish ? 48000 : 40000);

  // Build the message content based on document type
  let messageContent;
  if (documentType === 'pdf' && documentData.base64) {
    messageContent = [
      {
        type: 'document',
        source: {
          type: 'base64',
          media_type: documentData.mediaType,
          data: documentData.base64,
        },
      },
      {
        type: 'text',
        text: systemPrompt,
      },
    ];
  } else if (documentType === 'html' && documentData.base64) {
    messageContent = [
      {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'text/html',
          data: documentData.base64,
        },
      },
      {
        type: 'text',
        text: systemPrompt,
      },
    ];
  } else {
    messageContent = [
      {
        type: 'text',
        text: `${systemPrompt}\n\n---\nDOCUMENT CONTENT:\n${documentData.text}\n---`,
      },
    ];
  }

  console.log('Sending request to Claude API with max_tokens:', maxTokens);

  const stream = await anthropic.messages.stream({
    model: model,
    max_tokens: maxTokens,
    messages: [
      {
        role: 'user',
        content: messageContent,
      },
    ],
  });

  console.log('Received response stream from Claude API');
  const finalMessage = await stream.finalMessage();

  console.log('Stream completed');
  // ===== TEMP-DEBUG-START (remove after staging debugging) =====
  console.log('[TEMP-DEBUG] stop_reason:', finalMessage.stop_reason, '| output_tokens:', finalMessage.usage?.output_tokens, '| max_tokens_requested:', maxTokens);
  // ===== TEMP-DEBUG-END =====
  if (finalMessage.usage) {
    console.log(
      'Response tokens - Input:',
      finalMessage.usage.input_tokens,
      ', Output:',
      finalMessage.usage.output_tokens,
      ', Total:',
      finalMessage.usage.input_tokens + finalMessage.usage.output_tokens
    );
  }

  // Detect token truncation
  if (finalMessage.stop_reason === 'max_tokens') {
    throw new Error('Claude response truncated: stop_reason was max_tokens');
  }

  let analysisContent = '';
  if (finalMessage.content && finalMessage.content.length > 0) {
    analysisContent = finalMessage.content[0].text || '';
  }

  if (!analysisContent) {
    throw new Error('No content received from Claude API');
  }

  // Clean model output: strip fences, preamble text before <html>, and postamble after </html>
  const cleanedAnalysis = cleanModelOutput(analysisContent);

  // Validate output completeness and script
  const validation = validateReportOutput(cleanedAnalysis, languageCode);
  if (!validation.valid) {
    throw new Error(`Output validation failed: ${validation.reason}`);
  }

  // Deterministically post-process font tags, lang attribute, and fallback font stacks
  return postProcessReportHtml(cleanedAnalysis, languageCode);
};

/**
 * Analyze document content using Claude AI with retry capability.
 * @param {Object} documentData - Document data (base64 or text)
 * @param {string} prompt - Analysis prompt/instructions
 * @param {string} documentType - Type of document ('pdf', 'html', 'text')
 * @param {string} language - Target language ISO code (optional, defaults to 'en')
 * @returns {Promise<string>} - HTML analysis report
 */
const analyzeWithClaude = async (
  documentData,
  prompt,
  documentType = 'pdf',
  language = DEFAULT_LANGUAGE_CODE
) => {
  const basePrompt = prompt || loadAnalysisPrompt();
  const effectiveLanguage = isMultiLangEnabled()
    ? (getLanguageConfig(language)?.code || DEFAULT_LANGUAGE_CODE)
    : DEFAULT_LANGUAGE_CODE;

  try {
    return await executeClaudeAttempt(documentData, basePrompt, documentType, effectiveLanguage);
  } catch (firstError) {
    console.warn(`Claude analysis attempt 1 failed: ${firstError.message}. Retrying once...`);
    try {
      return await executeClaudeAttempt(documentData, basePrompt, documentType, effectiveLanguage);
    } catch (retryError) {
      console.error('Claude analysis attempt 2 (retry) also failed:', retryError.message);

      if (retryError.status === 401) {
        throw new Error('Invalid Claude API key. Please check your API key configuration.');
      } else if (retryError.status === 429) {
        throw new Error('Claude API rate limit exceeded. Please try again later.');
      } else if (retryError.status === 500) {
        throw new Error('Claude API server error. Please try again later.');
      }

      throw new Error(`Claude analysis failed: ${retryError.message}`);
    }
  }
};

/**
 * Process and analyze uploaded document
 * @param {string} filePath - Path to uploaded document
 * @param {string} fileName - Original file name
 * @param {string} customPrompt - Optional custom prompt
 * @param {string} language - Target language ISO code (optional, defaults to 'en')
 * @returns {Promise<{content: string, type: string}>} - Document content and type
 */
const processDocument = async (
  filePath,
  fileName,
  customPrompt = null,
  language = DEFAULT_LANGUAGE_CODE
) => {
  try {
    const fileExtension = path.extname(fileName).toLowerCase();
    let documentData;
    let documentType;

    if (['.pdf'].includes(fileExtension)) {
      documentData = await readFileAsBase64(filePath);
      documentType = 'pdf';
    } else if (['.html', '.htm'].includes(fileExtension)) {
      documentData = await readFileAsBase64(filePath);
      documentType = 'html';
    } else {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      documentData = { text: content };
      documentType = 'text';
    }

    const analysisHtml = await analyzeWithClaude(
      documentData,
      customPrompt,
      documentType,
      language
    );

    return {
      content: analysisHtml,
      type: 'html',
      originalType: documentType,
    };
  } catch (error) {
    console.error('Error processing document:', error.message);
    throw error;
  }
};

module.exports = {
  buildLanguageDirective,
  cleanModelOutput,
  postProcessReportHtml,
  validateReportOutput,
  readFileAsBase64,
  readHTMLFile,
  analyzeWithClaude,
  processDocument,
};

