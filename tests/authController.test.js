const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const { register, login } = require('../controllers/authController');

// Mock the User model
jest.mock('../models/User');

// Create express app for testing
const app = express();
app.use(express.json());

// Mock route handlers
app.post('/register', register);
app.post('/login', login);

describe('Auth Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('should register a new user successfully', async () => {
      const mockUser = {
        _id: 'user123',
        name: 'John Doe',
        email: 'john@example.com',
        phone: '1234567890',
        role: 'franchise_user',
        save: jest.fn().mockResolvedValue(true),
      };

      User.mockImplementation(() => mockUser);
      User.findOne = jest.fn().mockResolvedValue(null);

      const response = await request(app)
        .post('/register')
        .send({
          name: 'John Doe',
          email: 'john@example.com',
          phone: '1234567890',
          password: 'password123',
        })
        .expect(201);

      expect(response.body.message).toBe('User registered successfully');
      expect(response.body.user.name).toBe('John Doe');
      expect(User.findOne).toHaveBeenCalledWith({ email: 'john@example.com' });
    });

    it('should return error if user already exists', async () => {
      User.findOne = jest.fn().mockResolvedValue({ email: 'john@example.com' });

      const response = await request(app)
        .post('/register')
        .send({
          name: 'John Doe',
          email: 'john@example.com',
          phone: '1234567890',
          password: 'password123',
        })
        .expect(400);

      expect(response.body.message).toBe('User already exists with this email');
    });

    it('should return validation error for invalid data', async () => {
      const response = await request(app)
        .post('/register')
        .send({
          name: 'J',
          email: 'invalid-email',
          phone: '123',
          password: 'pass',
        })
        .expect(400);

      expect(response.body.message).toBe('Validation error');
    });
  });

  describe('login', () => {
    it('should login user successfully with valid credentials', async () => {
      const mockUser = {
        _id: 'user123',
        name: 'John Doe',
        email: 'john@example.com',
        role: 'franchise_user',
        isActive: true,
        comparePassword: jest.fn().mockResolvedValue(true),
      };

      User.findOne = jest.fn().mockResolvedValue(mockUser);

      const response = await request(app)
        .post('/login')
        .send({
          email: 'john@example.com',
          password: 'password123',
        })
        .expect(200);

      expect(response.body.message).toBe('Login successful');
      expect(response.body.user.email).toBe('john@example.com');
    });

    it('should return error for invalid credentials', async () => {
      User.findOne = jest.fn().mockResolvedValue(null);

      const response = await request(app)
        .post('/login')
        .send({
          email: 'john@example.com',
          password: 'wrongpassword',
        })
        .expect(400);

      expect(response.body.message).toBe('Invalid credentials');
    });

    it('should return error for deactivated account', async () => {
      const mockUser = {
        _id: 'user123',
        name: 'John Doe',
        email: 'john@example.com',
        role: 'franchise_user',
        isActive: false,
        comparePassword: jest.fn().mockResolvedValue(true),
      };

      User.findOne = jest.fn().mockResolvedValue(mockUser);

      const response = await request(app)
        .post('/login')
        .send({
          email: 'john@example.com',
          password: 'password123',
        })
        .expect(400);

      expect(response.body.message).toBe('Account is deactivated');
    });
  });
});