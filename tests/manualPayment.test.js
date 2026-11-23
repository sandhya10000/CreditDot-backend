const request = require('supertest');
const express = require('express');

const mockRazorpayCreate = jest.fn();
jest.mock('razorpay', () =>
  jest.fn().mockImplementation(() => ({ paymentLink: { create: mockRazorpayCreate } })),
);
jest.mock('../models/ManualPayment');
jest.mock('../utils/cashfree', () => ({ createLink: jest.fn() }));

const ManualPayment = require('../models/ManualPayment');
const cashfree = require('../utils/cashfree');
const { createManualPayment } = require('../controllers/manualPaymentController');

const app = express();
app.use(express.json());
app.post('/manual-payments', (req, res) => {
  req.user = { id: 'admin1', _id: 'admin1' };
  createManualPayment(req, res);
});

const body = { name: 'Asha', mobile: '9876543210', amount: 20, remarks: 'Test' };

describe('createManualPayment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ManualPayment.create = jest.fn((doc) => Promise.resolve(doc));
  });

  it('creates a Razorpay link by default, without email', async () => {
    mockRazorpayCreate.mockResolvedValue({ id: 'plink_1', short_url: 'https://rzp.io/x' });

    const res = await request(app).post('/manual-payments').send(body).expect(201);

    expect(mockRazorpayCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 2000,
        customer: { name: 'Asha', contact: '9876543210' },
      }),
    );
    expect(cashfree.createLink).not.toHaveBeenCalled();
    expect(res.body.payment).toMatchObject({
      gateway: 'razorpay',
      razorpayLinkId: 'plink_1',
      shortUrl: 'https://rzp.io/x',
      email: '',
    });
  });

  it('creates a Cashfree link when chosen', async () => {
    cashfree.createLink.mockResolvedValue({ link_id: 'MP_1', link_url: 'https://payments.cashfree.com/links/x' });

    const res = await request(app)
      .post('/manual-payments')
      .send({ ...body, gateway: 'cashfree' })
      .expect(201);

    expect(cashfree.createLink).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 20,
        customer: { name: 'Asha', phone: '9876543210', email: undefined },
      }),
    );
    expect(mockRazorpayCreate).not.toHaveBeenCalled();
    expect(res.body.payment).toMatchObject({ gateway: 'cashfree', cashfreeLinkId: 'MP_1' });
  });

  it('rejects an unknown gateway', async () => {
    await request(app).post('/manual-payments').send({ ...body, gateway: 'paypal' }).expect(400);
  });
});
