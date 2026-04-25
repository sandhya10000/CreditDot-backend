const errorHandler = (err, req, res, next) => {
  console.error(err.stack);
  
  // Joi validation error
  if (err.isJoi) {
    return res.status(400).json({
      message: 'Validation error',
      details: err.details.map(detail => detail.message)
    });
  }
  
  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map(error => error.message);
    return res.status(400).json({
      message: 'Validation error',
      details: messages
    });
  }
  
  // Mongoose duplicate key error
  if (err.code === 11000) {
    return res.status(400).json({
      message: 'Duplicate field value entered',
      field: Object.keys(err.keyValue)[0]
    });
  }
  
  // Mongoose cast error
  if (err.name === 'CastError') {
    return res.status(400).json({
      message: 'Resource not found',
      details: `${err.path} is invalid`
    });
  }
  
  // Default error
  res.status(err.statusCode || 500).json({
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

module.exports = errorHandler;