// Setup file for Jest tests
// Mock environment variables
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.RAZORPAY_KEY_ID = 'test-razorpay-key-id';
process.env.RAZORPAY_KEY_SECRET = 'test-razorpay-key-secret';

// Mock console.error to reduce test output noise
console.error = jest.fn();