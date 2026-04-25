let BetaAnalyticsDataClient;
try {
  const {
    BetaAnalyticsDataClient: ActualBetaAnalyticsDataClient,
  } = require("@google-analytics/data");
  BetaAnalyticsDataClient = ActualBetaAnalyticsDataClient;
  console.log("BetaAnalyticsDataClient loaded successfully");
} catch (error) {
  console.error(
    "Failed to load @google-analytics/data package:",
    error.message
  );
  console.warn("Google Analytics will be disabled");
  // Create a mock client
  BetaAnalyticsDataClient = class MockAnalyticsClient {
    constructor(options) {
      console.log("Using mock analytics client");
    }
    async runRealtimeReport() {
      console.warn("Mock client: returning default values");
      return [{ rows: [{ metricValues: [{ value: "0" }] }] }];
    }
    async runReport() {
      console.warn("Mock client: returning default values");
      return [{ rows: [{ metricValues: [{ value: "0" }] }] }];
    }
  };
}

class GoogleAnalyticsService {
  constructor() {
    try {
      console.log("Initializing Google Analytics Service");
      this.propertyId = process.env.GOOGLE_ANALYTICS_PROPERTY_ID;

      console.log(
        "Google Analytics Property ID:",
        this.propertyId ? "SET" : "NOT SET"
      );
      console.log(
        "Google Application Credentials Content:",
        process.env.GOOGLE_APPLICATION_CREDENTIALS_CONTENT ? "SET" : "NOT SET"
      );
      console.log(
        "Google Application Credentials File:",
        process.env.GOOGLE_APPLICATION_CREDENTIALS ||
          "./config/service-account-key.json"
      );

      // Check if Google Analytics is configured
      if (!this.propertyId) {
        console.warn(
          "Google Analytics Property ID not configured. Set GOOGLE_ANALYTICS_PROPERTY_ID in environment variables."
        );
        this.analyticsDataClient = null;
        return;
      }

      // Supports both file-based and environment variable-based authentication
      if (process.env.GOOGLE_APPLICATION_CREDENTIALS_CONTENT) {
        // Use credentials from environment variable
        try {
          const credentials = JSON.parse(
            process.env.GOOGLE_APPLICATION_CREDENTIALS_CONTENT
          );
          this.analyticsDataClient = new BetaAnalyticsDataClient({
            credentials: credentials,
          });
        } catch (error) {
          console.error(
            "Invalid JSON in GOOGLE_APPLICATION_CREDENTIALS_CONTENT:",
            error.message
          );
          console.error("Falling back to file-based authentication");
          this.analyticsDataClient = new BetaAnalyticsDataClient({
            keyFilename:
              process.env.GOOGLE_APPLICATION_CREDENTIALS ||
              "./config/service-account-key.json",
          });
        }
      } else {
        // Use credentials from file (fallback)
        try {
          const keyFile =
            process.env.GOOGLE_APPLICATION_CREDENTIALS ||
            "./config/service-account-key.json";
          console.log("Attempting to load service account key from:", keyFile);

          const fs = require("fs");
          if (!fs.existsSync(keyFile)) {
            console.error("Service account key file does not exist:", keyFile);
            this.analyticsDataClient = null;
            return;
          }

          this.analyticsDataClient = new BetaAnalyticsDataClient({
            keyFilename: keyFile,
          });

          console.log(
            "Google Analytics client initialized successfully with file-based authentication"
          );
        } catch (error) {
          console.error(
            "Error initializing Google Analytics client:",
            error.message
          );
          console.error("Stack trace:", error.stack);
          console.error(
            "Make sure the service account key file exists and is properly formatted"
          );
          this.analyticsDataClient = null;
        }
      }
    } catch (error) {
      console.error(
        "Error in GoogleAnalyticsService constructor:",
        error.message
      );
      this.analyticsDataClient = null;
    }
  }

  /**
   * Get real-time active users
   */
  async getRealTimeVisitors() {
    // Check if service is properly configured
    if (!this.analyticsDataClient || !this.propertyId) {
      console.warn(
        "Google Analytics not configured - returning default values"
      );
      return 0;
    }

    try {
      console.log(
        "Attempting to fetch real-time visitors for property:",
        `properties/${this.propertyId}`
      );

      const [response] = await this.analyticsDataClient.runRealtimeReport({
        property: `properties/${this.propertyId}`,
        metrics: [
          {
            name: "activeUsers",
          },
        ],
      });

      console.log(
        "Real-time report response received:",
        response ? "success" : "failed"
      );

      const activeUsers = response.rows?.[0]?.metricValues?.[0]?.value || "0";
      console.log("Active users count:", activeUsers);
      return parseInt(activeUsers);
    } catch (error) {
      console.error("Error fetching real-time visitors:", error);
      console.error(
        "Full error details:",
        error.message,
        error.code,
        error.status
      );
      // Return 0 instead of random number to avoid misleading data
      return 0;
    }
  }

  /**
   * Get total visitors for a date range
   */
  async getTotalVisitors(startDate = "1dayAgo", endDate = "today") {
    // Check if service is properly configured
    if (!this.analyticsDataClient || !this.propertyId) {
      console.warn(
        "Google Analytics not configured - returning default values"
      );
      return {
        totalUsers: 0,
        pageViews: 0,
        sessions: 0,
        bounceRate: 0,
        avgSessionDuration: 0,
      };
    }

    try {
      const [response] = await this.analyticsDataClient.runReport({
        property: `properties/${this.propertyId}`,
        dateRanges: [
          {
            startDate,
            endDate,
          },
        ],
        metrics: [
          { name: "activeUsers" },
          { name: "screenPageViews" },
          { name: "sessions" },
          { name: "bounceRate" },
          { name: "averageSessionDuration" },
        ],
      });

      const metrics = response.rows?.[0]?.metricValues || [];

      return {
        totalUsers: parseInt(metrics[0]?.value || 0),
        pageViews: parseInt(metrics[1]?.value || 0),
        sessions: parseInt(metrics[2]?.value || 0),
        bounceRate: parseFloat(metrics[3]?.value || 0),
        avgSessionDuration: parseFloat(metrics[4]?.value || 0),
      };
    } catch (error) {
      console.error("Error fetching total visitors:", error);
      // Return zeros instead of fake data to avoid misleading admins
      return {
        totalUsers: 0,
        pageViews: 0,
        sessions: 0,
        bounceRate: 0,
        avgSessionDuration: 0,
      };
    }
  }

  /**
   * Get visitors by date for chart data
   */
  async getVisitorsByDate(startDate = "1dayAgo", endDate = "today") {
    // Check if service is properly configured
    if (!this.analyticsDataClient || !this.propertyId) {
      console.warn(
        "Google Analytics not configured - returning default values"
      );
      return [];
    }

    try {
      const [response] = await this.analyticsDataClient.runReport({
        property: `properties/${this.propertyId}`,
        dateRanges: [
          {
            startDate,
            endDate,
          },
        ],
        dimensions: [{ name: "date" }],
        metrics: [
          { name: "activeUsers" },
          { name: "screenPageViews" },
          { name: "sessions" },
        ],
      });

      const chartData =
        response.rows?.map((row) => ({
          date: row.dimensionValues[0].value,
          users: parseInt(row.metricValues[0].value),
          pageViews: parseInt(row.metricValues[1].value),
          sessions: parseInt(row.metricValues[2].value),
        })) || [];

      return chartData;
    } catch (error) {
      console.error("Error fetching visitors by date:", error);
      // Return empty array instead of fake data
      return [];
    }
  }

  /**
   * Get top pages
   */
  async getTopPages(limit = 10) {
    // Check if service is properly configured
    if (!this.analyticsDataClient || !this.propertyId) {
      console.warn(
        "Google Analytics not configured - returning default values"
      );
      return [];
    }

    try {
      const [response] = await this.analyticsDataClient.runReport({
        property: `properties/${this.propertyId}`,
        dateRanges: [
          {
            startDate: "7daysAgo",
            endDate: "today",
          },
        ],
        dimensions: [{ name: "pagePath" }],
        metrics: [{ name: "screenPageViews" }],
        orderBys: [
          {
            metric: { metricName: "screenPageViews" },
            desc: true,
          },
        ],
        limit,
      });

      const topPages =
        response.rows?.map((row) => ({
          pageTitle: row.dimensionValues[0].value || "Unknown Page",
          pagePath: row.dimensionValues[0].value || "unknown",
          pageViews: parseInt(row.metricValues[0].value || 0),
          uniqueUsers: 0,
        })) || [];

      return topPages;
    } catch (error) {
      console.error("Error fetching top pages:", error.message);
      console.error("Full error:", error);
      // Return empty array instead of fake data
      return [];
    }
  }

  /**
   * Get traffic sources
   */
  async getTrafficSources() {
    // Check if service is properly configured
    if (!this.analyticsDataClient || !this.propertyId) {
      console.warn(
        "Google Analytics not configured - returning default values"
      );
      return [];
    }

    try {
      const [response] = await this.analyticsDataClient.runReport({
        property: `properties/${this.propertyId}`,
        dateRanges: [
          {
            startDate: "7daysAgo",
            endDate: "today",
          },
        ],
        dimensions: [{ name: "sessionSource" }],
        metrics: [{ name: "totalUsers" }, { name: "sessions" }],
        orderBys: [
          {
            metric: { metricName: "totalUsers" },
            desc: true,
          },
        ],

        limit: 10,
      });

      const trafficSources =
        response.rows?.map((row) => ({
          source: row.dimensionValues[0].value || "Direct",
          users: parseInt(row.metricValues[0].value || 0),
          sessions: parseInt(row.metricValues[1].value || 0),
        })) || [];

      return trafficSources;
    } catch (error) {
      console.error("Error fetching traffic sources:", error.message);
      console.error("Full error:", error);
      // Return empty array instead of fake data
      return [];
    }
  }
}

module.exports = GoogleAnalyticsService;
