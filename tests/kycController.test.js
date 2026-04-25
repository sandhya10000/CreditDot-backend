const request = require('supertest');
const express = require('express');
const KycRequest = require('../models/KycRequest');
const Franchise = require('../models/Franchise');
const { submitKyc, getKycStatus } = require('../controllers/kycController');

// Mock the models
jest.mock('../models/KycRequest');
jest.mock('../models/Franchise');

// Create express app for testing
const app = express();
app.use(express.json());

// Mock request user
const mockUser = {
  id: 'user123',
  role: 'franchise_user',
};

// Mock route handlers with user context
app.post('/kyc/submit', (req, res, next) => {
  req.user = mockUser;
  submitKyc(req, res, next);
});

app.get('/kyc/status', (req, res, next) => {
  req.user = mockUser;
  getKycStatus(req, res, next);
});

describe('KYC Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('submitKyc', () => {
    it('should submit KYC documents successfully', async () => {
      const mockFranchise = {
        _id: 'franchise123',
        kycStatus: 'pending',
        save: jest.fn().mockResolvedValue(true),
      };

      const mockKycRequest = {
        _id: 'kyc123',
        userId: 'user123',
        franchiseId: 'franchise123',
        aadhaarNumber: '123456789012',
        panNumber: 'ABCDE1234F',
        save: jest.fn().mockResolvedValue(true),
      };

      Franchise.findOne = jest.fn().mockResolvedValue(mockFranchise);
      KycRequest.findOne = jest.fn().mockResolvedValue(null);
      KycRequest.mockImplementation(() => mockKycRequest);

      const response = await request(app)
        .post('/kyc/submit')
        .send({
          aadhaarNumber: '123456789012',
          panNumber: 'ABCDE1234F',
          aadhaarFrontDocument: 'aadhaar_front_url',
          aadhaarBackDocument: 'aadhaar_back_url',
          panDocument: 'pan_url',
          businessRegistrationDocument: 'business_reg_url',
        })
        .expect(201);

      expect(response.body.message).toBe('KYC submitted successfully');
      expect(Franchise.findOne).toHaveBeenCalledWith({ userId: 'user123' });
      expect(KycRequest.findOne).toHaveBeenCalledWith({ franchiseId: 'franchise123' });
    });

    it('should return error if franchise not found', async () => {
      Franchise.findOne = jest.fn().mockResolvedValue(null);

      const response = await request(app)
        .post('/kyc/submit')
        .send({
          aadhaarNumber: '123456789012',
          panNumber: 'ABCDE1234F',
          aadhaarFrontDocument: 'aadhaar_front_url',
          aadhaarBackDocument: 'aadhaar_back_url',
          panDocument: 'pan_url',
          businessRegistrationDocument: 'business_reg_url',
        })
        .expect(404);

      expect(response.body.message).toBe('Franchise not found');
    });

    it('should return validation error for invalid data', async () => {
      Franchise.findOne = jest.fn().mockResolvedValue({ _id: 'franchise123' });

      const response = await request(app)
        .post('/kyc/submit')
        .send({
          aadhaarNumber: '12345',
          panNumber: 'INVALID',
        })
        .expect(400);

      expect(response.body.message).toBe('Validation error');
    });
  });

  describe('getKycStatus', () => {
    it('should get KYC status successfully', async () => {
      const mockFranchise = {
        _id: 'franchise123',
        kycStatus: 'submitted',
      };

      const mockKycRequest = {
        _id: 'kyc123',
        status: 'submitted',
      };

      Franchise.findOne = jest.fn().mockResolvedValue(mockFranchise);
      KycRequest.findOne = jest.fn().mockResolvedValue(mockKycRequest);

      const response = await request(app)
        .get('/kyc/status')
        .expect(200);

      expect(response.body.kycStatus).toBe('submitted');
      expect(Franchise.findOne).toHaveBeenCalledWith({ userId: 'user123' });
      expect(KycRequest.findOne).toHaveBeenCalledWith({ franchiseId: 'franchise123' });
    });

    it('should return error if franchise not found', async () => {
      Franchise.findOne = jest.fn().mockResolvedValue(null);

      const response = await request(app)
        .get('/kyc/status')
        .expect(404);

      expect(response.body.message).toBe('Franchise not found');
    });
  });
});