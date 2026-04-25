const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const Package = require('../models/Package');
const { 
  getPackages, 
  createPackage, 
  updatePackage, 
  deletePackage 
} = require('../controllers/packageController');

// Mock the Package model
jest.mock('../models/Package');

// Create express app for testing
const app = express();
app.use(express.json());

// Mock route handlers
app.get('/packages', getPackages);
app.post('/packages', createPackage);
app.put('/packages/:id', updatePackage);
app.delete('/packages/:id', deletePackage);

describe('Package Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getPackages', () => {
    it('should get all active packages', async () => {
      const mockPackages = [
        { _id: '1', name: 'Basic Package', price: 1000, isActive: true },
        { _id: '2', name: 'Premium Package', price: 2000, isActive: true },
      ];

      Package.find = jest.fn().mockReturnValue({
        sort: jest.fn().mockResolvedValue(mockPackages),
      });

      const response = await request(app)
        .get('/packages')
        .expect(200);

      expect(response.body.length).toBe(2);
      expect(Package.find).toHaveBeenCalledWith({ isActive: true });
    });
  });

  describe('createPackage', () => {
    it('should create a new package successfully', async () => {
      const mockPackage = {
        _id: 'package123',
        name: 'Test Package',
        description: 'Test package description',
        price: 1500,
        creditsIncluded: 100,
        validityDays: 30,
        save: jest.fn().mockResolvedValue(true),
      };

      Package.mockImplementation(() => mockPackage);

      const response = await request(app)
        .post('/packages')
        .send({
          name: 'Test Package',
          description: 'Test package description',
          price: 1500,
          creditsIncluded: 100,
          validityDays: 30,
        })
        .expect(201);

      expect(response.body.message).toBe('Package created successfully');
      expect(response.body.package.name).toBe('Test Package');
    });

    it('should return validation error for invalid data', async () => {
      const response = await request(app)
        .post('/packages')
        .send({
          name: '',
          description: '',
          price: -100,
        })
        .expect(400);

      expect(response.body.message).toBe('Validation error');
    });
  });

  describe('updatePackage', () => {
    it('should update a package successfully', async () => {
      const mockPackage = {
        _id: 'package123',
        name: 'Updated Package',
        description: 'Updated package description',
        price: 2000,
        creditsIncluded: 150,
        validityDays: 45,
      };

      Package.findByIdAndUpdate = jest.fn().mockResolvedValue(mockPackage);

      const response = await request(app)
        .put('/packages/package123')
        .send({
          name: 'Updated Package',
          description: 'Updated package description',
          price: 2000,
          creditsIncluded: 150,
          validityDays: 45,
        })
        .expect(200);

      expect(response.body.message).toBe('Package updated successfully');
      expect(response.body.package.price).toBe(2000);
    });

    it('should return error if package not found', async () => {
      Package.findByIdAndUpdate = jest.fn().mockResolvedValue(null);

      const response = await request(app)
        .put('/packages/nonexistent')
        .send({
          name: 'Updated Package',
          description: 'Updated package description',
          price: 2000,
        })
        .expect(404);

      expect(response.body.message).toBe('Package not found');
    });
  });

  describe('deletePackage', () => {
    it('should delete a package successfully', async () => {
      Package.findByIdAndDelete = jest.fn().mockResolvedValue({ _id: 'package123' });

      const response = await request(app)
        .delete('/packages/package123')
        .expect(200);

      expect(response.body.message).toBe('Package deleted successfully');
      expect(Package.findByIdAndDelete).toHaveBeenCalledWith('package123');
    });

    it('should return error if package not found', async () => {
      Package.findByIdAndDelete = jest.fn().mockResolvedValue(null);

      const response = await request(app)
        .delete('/packages/nonexistent')
        .expect(404);

      expect(response.body.message).toBe('Package not found');
    });
  });
});