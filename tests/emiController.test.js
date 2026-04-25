const request = require('supertest');
const express = require('express');
const { calculateEMI, generateEmiSchedule } = require('../controllers/emiController');

// Create express app for testing
const app = express();
app.use(express.json());

// Add routes for testing
app.post('/calculate', calculateEMI);
app.post('/schedule', generateEmiSchedule);

describe('EMI Controller', () => {
  describe('POST /calculate', () => {
    it('should calculate EMI correctly', async () => {
      const res = await request(app)
        .post('/calculate')
        .send({
          loanAmount: 100000,
          interestRate: 10,
          loanTenure: 1
        })
        .expect(200);

      expect(res.body).toHaveProperty('emi');
      expect(res.body).toHaveProperty('totalPayment');
      expect(res.body).toHaveProperty('totalInterest');
      expect(res.body).toHaveProperty('principal');
      
      // Check if values are reasonable
      expect(res.body.emi).toBeGreaterThan(0);
      expect(res.body.totalPayment).toBeGreaterThan(res.body.principal);
    });

    it('should return validation error for invalid input', async () => {
      const res = await request(app)
        .post('/calculate')
        .send({
          loanAmount: -100000,
          interestRate: 10,
          loanTenure: 1
        })
        .expect(400);

      expect(res.body).toHaveProperty('message');
      expect(res.body).toHaveProperty('details');
    });
  });

  describe('POST /schedule', () => {
    it('should generate EMI schedule correctly', async () => {
      const res = await request(app)
        .post('/schedule')
        .send({
          loanAmount: 100000,
          interestRate: 10,
          loanTenure: 1
        })
        .expect(200);

      expect(res.body).toHaveProperty('schedule');
      expect(Array.isArray(res.body.schedule)).toBe(true);
      expect(res.body.schedule.length).toBe(12); // 1 year = 12 months
      
      // Check first month data
      const firstMonth = res.body.schedule[0];
      expect(firstMonth).toHaveProperty('month');
      expect(firstMonth).toHaveProperty('emi');
      expect(firstMonth).toHaveProperty('interest');
      expect(firstMonth).toHaveProperty('principal');
      expect(firstMonth).toHaveProperty('balance');
    });
  });
});