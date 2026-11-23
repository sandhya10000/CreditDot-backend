const request = require('supertest');
const express = require('express');
const crypto = require('crypto');
const Transaction = require('../models/Transaction');
const Package = require('../models/Package');
const User = require('../models/User');
const Franchise = require('../models/Franchise');
const cashfree = require('../utils/cashfree');
const {
  createOrder,
  verifyPayment,
  handleCashfreeWebhook,
  fulfillPackageTransaction,
} = require('../controllers/paymentController');

// Mock the models
jest.mock('../models/Transaction');
jest.mock('../models/Package');
jest.mock('../models/User');
jest.mock('../models/Franchise');

// Mock only the Cashfree network calls; keep ID/phone/signature helpers real
jest.mock('../utils/cashfree', () => {
  const actual = jest.requireActual('../utils/cashfree');
  return {
    ...actual,
    createOrder: jest.fn(),
    confirmOrderPaid: jest.fn(),
  };
});

// Create express app for testing (rawBody kept like server.js, for webhook signatures)
const app = express();
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

// Mock request user
const mockUser = {
  id: 'user123',
  role: 'franchise_user',
};

app.post('/payments/order', (req, res, next) => {
  req.user = mockUser;
  createOrder(req, res, next);
});
app.post('/payments/verify', (req, res, next) => {
  req.user = mockUser;
  verifyPayment(req, res, next);
});
app.post('/payments/cashfree/webhook', handleCashfreeWebhook);

const signWebhook = (body, timestamp) =>
  crypto
    .createHmac('sha256', process.env.CASHFREE_SECRET_KEY)
    .update(timestamp + body)
    .digest('base64');

describe('Payment Controller (Cashfree)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createOrder', () => {
    it('creates a Cashfree order and returns the payment session', async () => {
      User.findById = jest.fn().mockResolvedValue({
        _id: 'user123',
        name: 'John Doe',
        email: 'john@example.com',
        phone: '+91 98765 43210',
      });
      Package.findById = jest.fn().mockResolvedValue({
        _id: 'package123',
        name: 'Test Package',
        price: 1500,
        isActive: true,
      });
      cashfree.createOrder.mockResolvedValue({
        cf_order_id: 555,
        payment_session_id: 'session_abc',
      });
      const save = jest.fn().mockResolvedValue(true);
      Transaction.mockImplementation((data) => ({ _id: 'transaction123', ...data, save }));

      const response = await request(app)
        .post('/payments/order')
        .send({ packageId: 'package123', returnPath: '/packages' })
        .expect(200);

      expect(response.body.paymentSessionId).toBe('session_abc');
      expect(response.body.orderId).toMatch(/^PKG_/);
      expect(response.body.amount).toBe(1770); // 1500 + 18% GST, in rupees
      expect(cashfree.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 1770,
          returnPath: '/packages',
          customer: expect.objectContaining({ phone: '9876543210' }),
        }),
      );
      expect(Transaction).toHaveBeenCalledWith(
        expect.objectContaining({ gateway: 'cashfree', status: 'created', amount: 1770 }),
      );
      expect(save).toHaveBeenCalled();
    });

    it('falls back to the default return path when an unknown one is sent', async () => {
      User.findById = jest.fn().mockResolvedValue({ _id: 'user123', phone: '9876543210' });
      Package.findById = jest.fn().mockResolvedValue({ _id: 'p', price: 100, isActive: true });
      cashfree.createOrder.mockResolvedValue({ payment_session_id: 's' });
      Transaction.mockImplementation((data) => ({ ...data, save: jest.fn() }));

      await request(app)
        .post('/payments/order')
        .send({ packageId: 'p', returnPath: 'https://evil.example' })
        .expect(200);

      expect(cashfree.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({ returnPath: '/franchise/payment' }),
      );
    });

    it('returns 400 when no valid phone is available', async () => {
      User.findById = jest.fn().mockResolvedValue({ _id: 'user123', phone: '' });
      Package.findById = jest.fn().mockResolvedValue({ _id: 'p', price: 100, isActive: true });
      Franchise.findOne = jest.fn(() => ({ select: jest.fn().mockResolvedValue(null) }));

      await request(app).post('/payments/order').send({ packageId: 'p' }).expect(400);
      expect(cashfree.createOrder).not.toHaveBeenCalled();
    });

    it('returns error if user not found', async () => {
      User.findById = jest.fn().mockResolvedValue(null);

      const response = await request(app)
        .post('/payments/order')
        .send({ packageId: 'package123' })
        .expect(404);

      expect(response.body.message).toBe('User not found');
    });

    it('returns error if package not found or inactive', async () => {
      User.findById = jest.fn().mockResolvedValue({ _id: 'user123' });
      Package.findById = jest.fn().mockResolvedValue(null);

      const response = await request(app)
        .post('/payments/order')
        .send({ packageId: 'package123' })
        .expect(404);

      expect(response.body.message).toBe('Package not found or inactive');
    });
  });

  describe('verifyPayment', () => {
    const pendingTxn = {
      _id: 'transaction123',
      userId: 'user123',
      packageId: 'package123',
      orderId: 'PKG_1',
      amount: 1770,
      status: 'created',
      gateway: 'cashfree',
    };

    it('fulfils the order when Cashfree says PAID', async () => {
      Transaction.findOne = jest.fn().mockResolvedValue(pendingTxn);
      cashfree.confirmOrderPaid.mockResolvedValue({ paid: true, status: 'PAID', cfPaymentId: '999' });
      Transaction.findOneAndUpdate = jest
        .fn()
        .mockResolvedValue({ ...pendingTxn, status: 'paid', paymentId: '999' });
      Franchise.findOne = jest.fn().mockResolvedValue(null);
      User.findById = jest.fn().mockResolvedValue(null);

      const response = await request(app)
        .post('/payments/verify')
        .send({ orderId: 'PKG_1' })
        .expect(200);

      expect(response.body.message).toBe('Payment verified successfully');
      expect(Transaction.findOne).toHaveBeenCalledWith({ orderId: 'PKG_1', userId: 'user123' });
      expect(cashfree.confirmOrderPaid).toHaveBeenCalledWith('PKG_1', 1770);
      expect(Transaction.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: 'transaction123', status: { $ne: 'paid' } },
        expect.anything(),
        { new: true },
      );
    });

    it('returns 400 when the order is not paid', async () => {
      Transaction.findOne = jest.fn().mockResolvedValue(pendingTxn);
      cashfree.confirmOrderPaid.mockResolvedValue({ paid: false, status: 'ACTIVE' });
      Transaction.findOneAndUpdate = jest.fn();

      const response = await request(app)
        .post('/payments/verify')
        .send({ orderId: 'PKG_1' })
        .expect(400);

      expect(response.body.message).toBe('Payment not completed');
      expect(Transaction.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('returns 200 without re-fulfilling an already paid order', async () => {
      Transaction.findOne = jest.fn().mockResolvedValue({ ...pendingTxn, status: 'paid' });
      Transaction.findOneAndUpdate = jest.fn();

      await request(app).post('/payments/verify').send({ orderId: 'PKG_1' }).expect(200);

      expect(cashfree.confirmOrderPaid).not.toHaveBeenCalled();
      expect(Transaction.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it("returns 404 for another user's order", async () => {
      Transaction.findOne = jest.fn().mockResolvedValue(null);

      await request(app).post('/payments/verify').send({ orderId: 'PKG_1' }).expect(404);
      expect(cashfree.confirmOrderPaid).not.toHaveBeenCalled();
    });

    it('returns 400 when orderId is missing', async () => {
      await request(app).post('/payments/verify').send({}).expect(400);
    });
  });

  describe('fulfillPackageTransaction', () => {
    it('runs side effects only once when verify and webhook race', async () => {
      const paidTxn = { _id: 't1', userId: 'u1', packageId: 'p1', status: 'paid' };
      Transaction.findOneAndUpdate = jest
        .fn()
        .mockResolvedValueOnce(paidTxn) // first caller claims it
        .mockResolvedValueOnce(null); // second caller finds it already paid
      Transaction.findById = jest.fn().mockResolvedValue(paidTxn);
      Franchise.findOne = jest.fn().mockResolvedValue(null);
      User.findById = jest.fn().mockResolvedValue(null);

      const [first, second] = await Promise.all([
        fulfillPackageTransaction('t1', { paymentId: 'x' }),
        fulfillPackageTransaction('t1', { paymentId: 'x' }),
      ]);

      expect(first.alreadyPaid).toBe(false);
      expect(second.alreadyPaid).toBe(true);
      expect(Franchise.findOne).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleCashfreeWebhook', () => {
    it('rejects a bad signature', async () => {
      const body = JSON.stringify({ type: 'PAYMENT_SUCCESS_WEBHOOK', data: {} });
      await request(app)
        .post('/payments/cashfree/webhook')
        .set('Content-Type', 'application/json')
        .set('x-webhook-timestamp', '1700000000')
        .set('x-webhook-signature', 'not-a-real-signature')
        .send(body)
        .expect(401);
    });

    it('accepts a valid signature and settles a package order', async () => {
      const body = JSON.stringify({
        type: 'PAYMENT_SUCCESS_WEBHOOK',
        data: { order: { order_id: 'PKG_1' }, payment: { cf_payment_id: 999 } },
      });
      const timestamp = '1700000000';
      Transaction.findOne = jest.fn().mockResolvedValue({
        _id: 't1',
        orderId: 'PKG_1',
        amount: 1770,
        status: 'created',
        gateway: 'cashfree',
      });
      cashfree.confirmOrderPaid.mockResolvedValue({ paid: true, cfPaymentId: '999' });
      Transaction.findOneAndUpdate = jest.fn().mockResolvedValue({ _id: 't1', status: 'paid' });
      Franchise.findOne = jest.fn().mockResolvedValue(null);
      User.findById = jest.fn().mockResolvedValue(null);

      await request(app)
        .post('/payments/cashfree/webhook')
        .set('Content-Type', 'application/json')
        .set('x-webhook-timestamp', timestamp)
        .set('x-webhook-signature', signWebhook(body, timestamp))
        .send(body)
        .expect(200);

      expect(cashfree.confirmOrderPaid).toHaveBeenCalledWith('PKG_1', 1770);
      expect(Transaction.findOneAndUpdate).toHaveBeenCalledTimes(1);
    });
  });
});
