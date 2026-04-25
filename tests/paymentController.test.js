const request = require('supertest');
const express = require('express');
const Razorpay = require('razorpay');
const Transaction = require('../models/Transaction');
const Package = require('../models/Package');
const User = require('../models/User');
const { createOrder, verifyPayment } = require('../controllers/paymentController');

// Mock the models
jest.mock('../models/Transaction');
jest.mock('../models/Package');
jest.mock('../models/User');
jest.mock('razorpay');

// Create express app for testing
const app = express();
app.use(express.json());

// Mock request user
const mockUser = {
  id: 'user123',
  role: 'franchise_user',
};

// Mock route handlers with user context
app.post('/payments/order', (req, res, next) => {
  req.user = mockUser;
  createOrder(req, res, next);
});

app.post('/payments/verify', verifyPayment);

describe('Payment Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createOrder', () => {
    it('should create a Razorpay order successfully', async () => {
      const mockUserDoc = {
        _id: 'user123',
        name: 'John Doe',
        email: 'john@example.com',
      };

      const mockPackage = {
        _id: 'package123',
        name: 'Test Package',
        price: 1500,
        isActive: true,
      };

      const mockOrder = {
        id: 'order123',
        amount: 150000,
        currency: 'INR',
      };

      const mockTransaction = {
        _id: 'transaction123',
        userId: 'user123',
        packageId: 'package123',
        orderId: 'order123',
        amount: 1500,
        currency: 'INR',
        status: 'created',
        save: jest.fn().mockResolvedValue(true),
      };

      User.findById = jest.fn().mockResolvedValue(mockUserDoc);
      Package.findById = jest.fn().mockResolvedValue(mockPackage);
      
      // Mock Razorpay orders.create
      Razorpay.mockImplementation(() => {
        return {
          orders: {
            create: jest.fn().mockResolvedValue(mockOrder),
          },
        };
      });

      Transaction.mockImplementation(() => mockTransaction);

      const response = await request(app)
        .post('/payments/order')
        .send({
          packageId: 'package123',
          userId: 'user123',
        })
        .expect(200);

      expect(response.body.orderId).toBe('order123');
      expect(response.body.amount).toBe(150000);
      expect(User.findById).toHaveBeenCalledWith('user123');
      expect(Package.findById).toHaveBeenCalledWith('package123');
    });

    it('should return error if user not found', async () => {
      User.findById = jest.fn().mockResolvedValue(null);

      const response = await request(app)
        .post('/payments/order')
        .send({
          packageId: 'package123',
          userId: 'user123',
        })
        .expect(404);

      expect(response.body.message).toBe('User not found');
    });

    it('should return error if package not found or inactive', async () => {
      User.findById = jest.fn().mockResolvedValue({ _id: 'user123' });
      Package.findById = jest.fn().mockResolvedValue(null);

      const response = await request(app)
        .post('/payments/order')
        .send({
          packageId: 'package123',
          userId: 'user123',
        })
        .expect(404);

      expect(response.body.message).toBe('Package not found or inactive');
    });
  });

  describe('verifyPayment', () => {
    it('should verify payment successfully', async () => {
      const mockTransaction = {
        _id: 'transaction123',
        userId: 'user123',
        packageId: 'package123',
        orderId: 'order123',
        paymentId: null,
        status: 'created',
        razorpayOrderId: null,
        razorpayPaymentId: null,
        razorpaySignature: null,
        save: jest.fn().mockResolvedValue(true),
      };

      const mockPackage = {
        _id: 'package123',
        creditsIncluded: 100,
      };

      const mockFranchise = {
        credits: 0,
        totalCreditsPurchased: 0,
        save: jest.fn().mockResolvedValue(true),
      };

      Transaction.findOne = jest.fn().mockResolvedValue(mockTransaction);
      Package.findById = jest.fn().mockResolvedValue(mockPackage);
      // Mock franchise update - in real implementation this would be more complex
      // For testing, we'll just mock the model method

      const response = await request(app)
        .post('/payments/verify')
        .send({
          razorpay_order_id: 'order123',
          razorpay_payment_id: 'payment123',
          razorpay_signature: 'signature123',
        })
        .expect(200);

      expect(response.body.message).toBe('Payment verified successfully');
      expect(Transaction.findOne).toHaveBeenCalledWith({ orderId: 'order123' });
    });

    it('should return error if payment verification fails', async () => {
      const response = await request(app)
        .post('/payments/verify')
        .send({
          razorpay_order_id: 'order123',
          razorpay_payment_id: 'payment123',
          razorpay_signature: 'invalid_signature',
        })
        .expect(400);

      expect(response.body.message).toBe('Payment verification failed');
    });
  });
});