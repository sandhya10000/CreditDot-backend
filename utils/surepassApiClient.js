const axios = require('axios');

class SurepassApiClient {
  constructor() {
    this.requestQueue = [];
    this.lastRequestTime = 0;
    this.minDelayBetweenRequests = parseInt(process.env.SUREPASS_MIN_DELAY_MS) || 1500; // Minimum delay configurable via env var (default 1.5 seconds)
    this.retryAttempts = 3;
    this.retryDelay = 2000; // 2 seconds base delay for retries
    this.requestsPerWindow = parseInt(process.env.SUREPASS_MAX_REQUESTS_PER_WINDOW) || 20; // Max requests per window (default 20)
    this.windowMs = parseInt(process.env.SUREPASS_RATE_LIMIT_WINDOW_MS) || 60000; // Window size in ms (default 60 seconds)
    this.requestTimestamps = []; // Track request timestamps for sliding window
  }

  /**
   * Makes a request to SurePass API with built-in rate limiting and retry logic
   */
  async makeRequest(apiKey, endpoint, data, options = {}) {
    const { method = 'POST', maxRetries = this.retryAttempts, retryDelay = this.retryDelay } = options;
    
    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Enforce rate limiting using sliding window algorithm
        await this.enforceRateLimit();
        
        // Make the API request
        const response = await axios({
          method,
          url: endpoint,
          data,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            ...options.headers,
          },
          timeout: options.timeout || 30000, // 30 second timeout
        });
        
        // Record successful request
        this.recordSuccessfulRequest();
        return response;
      } catch (error) {
        lastError = error;
        
        // If it's a 429 (Too Many Requests) error, wait longer before retrying
        if (error.response?.status === 429) {
          console.warn(`Rate limit hit on attempt ${attempt + 1}, waiting longer...`);
          // Respect any Retry-After header from the API if present
          const retryAfter = error.response.headers?.['retry-after'] || 60; // Default to 60 seconds
          const delay = Math.max(retryAfter * 1000, retryDelay * Math.pow(2, attempt)); // Use Retry-After if provided
          await this.delay(delay + Math.random() * 1000); // Add jitter
          continue;
        }
        
        // If it's a temporary error (network, timeout), retry
        if (this.isRetryableError(error) && attempt < maxRetries) {
          console.warn(`Request failed on attempt ${attempt + 1}, retrying...`, error.message);
          const exponentialDelay = retryDelay * Math.pow(2, attempt); // Exponential backoff
          await this.delay(exponentialDelay + Math.random() * 1000); // Add jitter
          continue;
        }
        
        // If it's not retryable or we've exhausted retries, throw the error
        break;
      }
    }
    
    throw lastError;
  }

  /**
   * Enforces rate limiting using a sliding window algorithm
   */
  async enforceRateLimit() {
    const now = Date.now();
    
    // Clean up old request timestamps outside the window
    this.requestTimestamps = this.requestTimestamps.filter(timestamp => 
      now - timestamp < this.windowMs
    );
    
    // Check if we're at the rate limit
    if (this.requestTimestamps.length >= this.requestsPerWindow) {
      // Calculate how long to wait until oldest request falls out of window
      const oldestRequest = this.requestTimestamps[0];
      const waitTime = this.windowMs - (now - oldestRequest) + 100; // Add 100ms buffer
      
      console.log(`Rate limit approaching. Waiting ${waitTime}ms before next request...`);
      await this.delay(waitTime);
      
      // Re-check after waiting (in case other requests completed)
      this.requestTimestamps = this.requestTimestamps.filter(timestamp => 
        now - timestamp < this.windowMs
      );
    }
    
    // Enforce minimum delay between requests to prevent burst requests
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.minDelayBetweenRequests) {
      const delay = this.minDelayBetweenRequests - timeSinceLastRequest;
      await this.delay(delay);
    }
  }

  /**
   * Records a successful request for rate limiting purposes
   */
  recordSuccessfulRequest() {
    const now = Date.now();
    this.requestTimestamps.push(now);
    this.lastRequestTime = now;
  }

  /**
   * Checks if an error is retryable
   */
  isRetryableError(error) {
    // Network errors, timeouts, server errors (5xx), and rate limiting (429)
    return (
      !error.response || // Network error
      error.code === 'ETIMEDOUT' || 
      error.code === 'ECONNABORTED' || 
      error.response.status >= 500 || 
      error.response.status === 429 ||
      error.response.status === 408 // Request Timeout
    );
  }

  /**
   * Delays execution for specified milliseconds
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Specific method for credit check API calls
   */
  async makeCreditCheckRequest(apiKey, endpoint, requestData) {
    return this.makeRequest(apiKey, endpoint, requestData, {
      timeout: 45000, // Credit checks might take longer
    });
  }

  /**
   * Specific method for PAN verification API calls
   */
  async makePanVerificationRequest(apiKey, endpoint, requestData) {
    return this.makeRequest(apiKey, endpoint, requestData, {
      timeout: 30000,
    });
  }

  /**
   * Specific method for bank verification API calls
   */
  async makeBankVerificationRequest(apiKey, endpoint, requestData) {
    return this.makeRequest(apiKey, endpoint, requestData, {
      timeout: 30000,
    });
  }
}

module.exports = new SurepassApiClient();