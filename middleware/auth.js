const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Role = require('../models/Role');
const Franchise = require('../models/Franchise');

const auth = async (req, res, next) => {
  console.log('Auth middleware hit for analytics route');
  try {
    let token;
    
    // Check for token in header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }
    // Check for token in cookies
    else if (req.cookies.token) {
      token = req.cookies.token;
    }
    
    if (!token) {
      console.log('No authentication token found, access denied');
      return res.status(401).json({ message: 'No authentication token, access denied' });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    
    if (!user) {
      console.log('Token invalid, access denied');
      return res.status(401).json({ message: 'Token invalid, access denied' });
    }

    if (user.isDeleted) {
      console.log('Deleted account, access denied:', user.email);
      return res.status(403).json({ message: 'Account has been deleted. Please contact admin.' });
    }

    // Staff accounts take their permissions from their role, checked on every request
    // so role edits and deactivation apply without waiting for the token to expire
    if (user.staffRole) {
      const staffRole = await Role.findById(user.staffRole).select('name permissions isActive limitToOwnFranchises');
      if (!user.isActive || !staffRole || !staffRole.isActive) {
        return res.status(403).json({ message: 'Staff access has been disabled. Please contact admin.' });
      }
      user.permissions = staffRole.permissions;
      user.staffRoleName = staffRole.name;
      // Business Managers only see franchises they own (see utils/franchiseScope.js)
      user.scopedToOwnFranchises = Boolean(staffRole.limitToOwnFranchises);
    }

    console.log('Authenticated user:', user.email, 'Role:', user.role);
    
    // If user is a franchise user, get their franchiseId
    if (user.role === 'franchise_user') {
      const franchise = await Franchise.findOne({ userId: user._id });
      if (franchise) {
        user.franchiseId = franchise._id;
        console.log('Franchise ID set for user:', user._id, 'Franchise ID:', franchise._id);
      } else {
        console.log('No franchise found for user:', user._id);
      }
    }
    
    req.user = user;
    next();
  } catch (error) {
    console.error('Auth error:', error);
    res.status(401).json({ message: 'Token invalid, access denied' });
  }
};

module.exports = auth;