const Joi = require('joi');

// Validation schema for EMI calculation
const emiCalculationSchema = Joi.object({
  loanAmount: Joi.number().positive().required(),
  interestRate: Joi.number().positive().required(),
  loanTenure: Joi.number().positive().required(), // in years
}); 

// Calculate EMI
const calculateEMI = async (req, res) => {
  try {
    // Validate request body
    const { error } = emiCalculationSchema.validate(req.body);
    if (error) {  
      return res.status(400).json({
        message: "Validation error",
        details: error.details[0].message,
      });
    }

    const { loanAmount, interestRate, loanTenure } = req.body;

    // Convert years to months
    const tenureInMonths = loanTenure * 12;
    
    // Calculate monthly interest rate
    const monthlyInterestRate = interestRate / (12 * 100);
    
    // Calculate EMI using the formula: EMI = P * r * (1 + r)^n / ((1 + r)^n - 1)
    const emi = loanAmount * monthlyInterestRate * 
      (Math.pow(1 + monthlyInterestRate, tenureInMonths) / 
      (Math.pow(1 + monthlyInterestRate, tenureInMonths) - 1));
    
    // Calculate total payment and total interest
    const totalPayment = emi * tenureInMonths;
    const totalInterest = totalPayment - loanAmount;
    
    res.json({
      emi: parseFloat(emi.toFixed(2)),
      totalPayment: parseFloat(totalPayment.toFixed(2)),
      totalInterest: parseFloat(totalInterest.toFixed(2)),
      principal: loanAmount,
      interestRate,
      loanTenure,
    });
  } catch (error) {
    console.error("EMI calculation error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Generate EMI schedule
const generateEmiSchedule = async (req, res) => {
  try {
    // Validate request body
    const { error } = emiCalculationSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        message: "Validation error",
        details: error.details[0].message,
      });
    }

    const { loanAmount, interestRate, loanTenure } = req.body;

    // Convert years to months
    const tenureInMonths = loanTenure * 12;
    
    // Calculate monthly interest rate
    const monthlyInterestRate = interestRate / (12 * 100);
    
    // Calculate EMI
    const emi = loanAmount * monthlyInterestRate * 
      (Math.pow(1 + monthlyInterestRate, tenureInMonths) / 
      (Math.pow(1 + monthlyInterestRate, tenureInMonths) - 1));
    
    // Generate EMI schedule
    const schedule = [];
    let remainingPrincipal = loanAmount;

    for (let month = 1; month <= tenureInMonths; month++) {
      const interestPayment = remainingPrincipal * monthlyInterestRate;
      const principalPayment = emi - interestPayment;
      remainingPrincipal -= principalPayment;

      // Ensure remaining principal doesn't go negative due to rounding
      if (remainingPrincipal < 0) {
        remainingPrincipal = 0;
      }

      schedule.push({
        month,
        emi: parseFloat(emi.toFixed(2)),
        interest: parseFloat(interestPayment.toFixed(2)),
        principal: parseFloat(principalPayment.toFixed(2)),
        balance: parseFloat(remainingPrincipal.toFixed(2))
      });
    }
    
    res.json({
      schedule
    });
  } catch (error) {
    console.error("EMI schedule generation error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports = {
  calculateEMI,
  generateEmiSchedule
};