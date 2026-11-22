const request = require('supertest');
const express = require('express');
const User = require('../models/User');
const { changePassword } = require('../controllers/authController');

jest.mock('../models/User');

const app = express();
app.use(express.json());
app.post('/change-password', (req, res, next) => {
  req.user = { _id: 'staff1', id: 'staff1' };
  changePassword(req, res, next);
});

const mockUserDoc = (matches) => ({
  _id: 'staff1',
  password: 'hashed',
  comparePassword: jest.fn().mockResolvedValue(matches),
  save: jest.fn().mockResolvedValue(true),
});

describe('changePassword', () => {
  beforeEach(() => jest.clearAllMocks());

  it('changes the password when the current one is correct', async () => {
    const doc = mockUserDoc(true);
    User.findById = jest.fn().mockResolvedValue(doc);

    const res = await request(app)
      .post('/change-password')
      .send({ currentPassword: 'oldpass', newPassword: 'newpass123' })
      .expect(200);

    expect(res.body.message).toBe('Password changed successfully');
    expect(doc.comparePassword).toHaveBeenCalledWith('oldpass');
    expect(doc.password).toBe('newpass123');
    expect(doc.save).toHaveBeenCalled();
  });

  it('returns 400 (not 401) for a wrong current password', async () => {
    const doc = mockUserDoc(false);
    User.findById = jest.fn().mockResolvedValue(doc);

    const res = await request(app)
      .post('/change-password')
      .send({ currentPassword: 'wrong', newPassword: 'newpass123' })
      .expect(400);

    expect(res.body.message).toBe('Current password is incorrect');
    expect(doc.save).not.toHaveBeenCalled();
  });

  it('rejects a new password shorter than 6 characters', async () => {
    User.findById = jest.fn();
    await request(app)
      .post('/change-password')
      .send({ currentPassword: 'oldpass', newPassword: '123' })
      .expect(400);
    expect(User.findById).not.toHaveBeenCalled();
  });

  it('rejects a new password equal to the current one', async () => {
    User.findById = jest.fn();
    await request(app)
      .post('/change-password')
      .send({ currentPassword: 'samepass', newPassword: 'samepass' })
      .expect(400);
    expect(User.findById).not.toHaveBeenCalled();
  });
});
