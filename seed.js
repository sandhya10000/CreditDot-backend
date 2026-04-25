// Sample packages data
const packages = [
  {
    name: 'Starter Package',
    description: 'Perfect for new franchise partners to get started',
    price: 2999,
    creditsIncluded: 50,
    validityDays: 30,
    features: [
      '50 credit reports',
      'Basic dashboard',
      'Email support',
      'Access to leads management',
    ],
    sortOrder: 1,
    // Business payout settings
    businessPayoutPercentage: 15,
    businessPayoutType: 'percentage',
    businessPayoutFixedAmount: 0,
  },
  {
    name: 'Professional Package',
    description: 'Ideal for growing franchise businesses',
    price: 5999,
    creditsIncluded: 125,
    validityDays: 60,
    features: [
      '125 credit reports',
      'Advanced dashboard',
      'Priority email support',
      'Access to leads management',
      'Referral program',
      'Business MIS reports',
    ],
    sortOrder: 2,
    // Business payout settings
    businessPayoutPercentage: 20,
    businessPayoutType: 'percentage',
    businessPayoutFixedAmount: 0,
  },
  {
    name: 'Enterprise Package',
    description: 'Complete solution for established franchise partners',
    price: 9999,
    creditsIncluded: 250,
    validityDays: 90,
    features: [
      '250 credit reports',
      'Premium dashboard with analytics',
      '24/7 priority support',
      'Access to all features',
      'Advanced referral program',
      'Custom business MIS reports',
      'AI-powered insights',
    ],
    sortOrder: 3,
    // Business payout settings
    businessPayoutPercentage: 25,
    businessPayoutType: 'percentage',
    businessPayoutFixedAmount: 0,
  },
];

// Sample customer packages data
const customerPackages = [
  {
    name: 'Basic Credit Check',
    description: 'Single credit report for individual customers',
    price: 199,
    creditsIncluded: 1,
    features: [
      'One credit report',
      'Basic credit score',
      'PDF download',
    ],
    sortOrder: 1,
    // Business payout settings
    businessPayoutPercentage: 30,
    businessPayoutType: 'percentage',
    businessPayoutFixedAmount: 0,
  },
  {
    name: 'Premium Credit Check',
    description: 'Comprehensive credit analysis with detailed insights',
    price: 499,
    creditsIncluded: 1,
    features: [
      'Detailed credit report',
      'Credit score analysis',
      'Recommendations',
      'PDF download',
      'Email support',
    ],
    sortOrder: 2,
    // Business payout settings
    businessPayoutPercentage: 25,
    businessPayoutType: 'percentage',
    businessPayoutFixedAmount: 0,
  },
];

// Seed function
const seed = async () => {
  try {
    // Clear existing data
    await User.deleteMany({ role: 'admin' });
    await Package.deleteMany({});
    await CustomerPackage.deleteMany({});
    
    console.log('Existing data cleared');
    
    // Create admin user
    const adminPassword = await bcrypt.hash('admin@123', 10);
    
    const adminUser = new User({
      name: 'Admin User',
      email: 'nitinv@creditdost.co.in',
      phone: '9876543210',
      password: adminPassword,
      role: 'admin',
      isActive: true, 
      isVerified: true,
    });
    
    await adminUser.save();
    
    console.log('Admin user created');
    
    // Create sample packages
    for (const pkg of packages) {
      const package = new Package(pkg);
      await package.save();
    }
    
    console.log('Sample packages created');
    
    // Create sample customer packages
    for (const pkg of customerPackages) {
      const customerPackage = new CustomerPackage(pkg);
      await customerPackage.save();
    }
    
    console.log('Sample customer packages created');
    
    console.log('Seeding completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Seeding failed:', error);
    process.exit(1);
  }
};

// Run seed function
seed();