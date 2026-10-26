/**
 * Language configuration for AI Credit Analysis Multi-Language Report Generation.
 * Whitelist of supported languages, font stacks, and Unicode script verification ranges.
 */

const SUPPORTED_LANGUAGES = [
  {
    code: 'en',
    name: 'English',
    nativeName: 'English',
    script: 'Latin',
    fontFamily: "'Segoe UI', 'Roboto', 'Helvetica', sans-serif",
    googleFont: null,
    dir: 'ltr',
    isDefault: true,
    // Latin basic + Latin-1 Supplement regex
    unicodeRegex: /[\u0020-\u007E]/,
  },
  {
    code: 'hi',
    name: 'Hindi',
    nativeName: 'हिन्दी',
    script: 'Devanagari',
    fontFamily: "'Noto Sans Devanagari', 'Nirmala UI', 'Segoe UI', sans-serif",
    googleFont: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;600;700&display=swap',
    dir: 'ltr',
    // Devanagari Unicode Block: U+0900 to U+097F
    unicodeRegex: /[\u0900-\u097F]/,
  },
  {
    code: 'bn',
    name: 'Bengali',
    nativeName: 'বাংলা',
    script: 'Bengali',
    fontFamily: "'Noto Sans Bengali', 'Nirmala UI', 'Segoe UI', sans-serif",
    googleFont: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;600;700&display=swap',
    dir: 'ltr',
    // Bengali Unicode Block: U+0980 to U+09FF
    unicodeRegex: /[\u0980-\u09FF]/,
  },
  {
    code: 'mr',
    name: 'Marathi',
    nativeName: 'मराठी',
    script: 'Devanagari',
    fontFamily: "'Noto Sans Devanagari', 'Nirmala UI', 'Segoe UI', sans-serif",
    googleFont: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;600;700&display=swap',
    dir: 'ltr',
    // Devanagari Unicode Block: U+0900 to U+097F
    unicodeRegex: /[\u0900-\u097F]/,
  },
  {
    code: 'gu',
    name: 'Gujarati',
    nativeName: 'ગુજરાતી',
    script: 'Gujarati',
    fontFamily: "'Noto Sans Gujarati', 'Nirmala UI', 'Segoe UI', sans-serif",
    googleFont: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Gujarati:wght@400;600;700&display=swap',
    dir: 'ltr',
    // Gujarati Unicode Block: U+0A80 to U+0AFF
    unicodeRegex: /[\u0A80-\u0AFF]/,
  },
  {
    code: 'ta',
    name: 'Tamil',
    nativeName: 'தமிழ்',
    script: 'Tamil',
    fontFamily: "'Noto Sans Tamil', 'Nirmala UI', 'Segoe UI', sans-serif",
    googleFont: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Tamil:wght@400;600;700&display=swap',
    dir: 'ltr',
    // Tamil Unicode Block: U+0B80 to U+0BFF
    unicodeRegex: /[\u0B80-\u0BFF]/,
  },
  {
    code: 'te',
    name: 'Telugu',
    nativeName: 'తెలుగు',
    script: 'Telugu',
    fontFamily: "'Noto Sans Telugu', 'Nirmala UI', 'Segoe UI', sans-serif",
    googleFont: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Telugu:wght@400;600;700&display=swap',
    dir: 'ltr',
    // Telugu Unicode Block: U+0C00 to U+0C7F
    unicodeRegex: /[\u0C00-\u0C7F]/,
  },
  {
    code: 'kn',
    name: 'Kannada',
    nativeName: 'ಕನ್ನಡ',
    script: 'Kannada',
    fontFamily: "'Noto Sans Kannada', 'Nirmala UI', 'Segoe UI', sans-serif",
    googleFont: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Kannada:wght@400;600;700&display=swap',
    dir: 'ltr',
    // Kannada Unicode Block: U+0C80 to U+0CFF
    unicodeRegex: /[\u0C80-\u0CFF]/,
  },
  {
    code: 'ml',
    name: 'Malayalam',
    nativeName: 'മലയാളം',
    script: 'Malayalam',
    fontFamily: "'Noto Sans Malayalam', 'Nirmala UI', 'Segoe UI', sans-serif",
    googleFont: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Malayalam:wght@400;600;700&display=swap',
    dir: 'ltr',
    // Malayalam Unicode Block: U+0D00 to U+0D7F
    unicodeRegex: /[\u0D00-\u0D7F]/,
  },
  {
    code: 'pa',
    name: 'Punjabi',
    nativeName: 'ਪੰਜਾਬੀ',
    script: 'Gurmukhi',
    fontFamily: "'Noto Sans Gurmukhi', 'Nirmala UI', 'Segoe UI', sans-serif",
    googleFont: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Gurmukhi:wght@400;600;700&display=swap',
    dir: 'ltr',
    // Gurmukhi Unicode Block: U+0A00 to U+0A7F
    unicodeRegex: /[\u0A00-\u0A7F]/,
  },
];

const DEFAULT_LANGUAGE_CODE = 'en';

/**
 * Checks if the multi-language feature flag is enabled.
 * Default: false
 */
const isMultiLangEnabled = () => {
  return process.env.MULTILANG_ENABLED === 'true';
};

/**
 * Whitelist lookup for language configuration.
 * Returns the matched language config object if valid and whitelisted.
 * Returns default English config if missing, unknown, or not supported.
 * @param {string} code
 * @returns {object}
 */
const getLanguageConfig = (code) => {
  if (!code || typeof code !== 'string') {
    return SUPPORTED_LANGUAGES.find((lang) => lang.code === DEFAULT_LANGUAGE_CODE);
  }
  const normalized = code.trim().toLowerCase();
  const match = SUPPORTED_LANGUAGES.find((lang) => lang.code === normalized);
  return match || SUPPORTED_LANGUAGES.find((lang) => lang.code === DEFAULT_LANGUAGE_CODE);
};

module.exports = {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE_CODE,
  isMultiLangEnabled,
  getLanguageConfig,
};
