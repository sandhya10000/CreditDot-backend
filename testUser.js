const mongoose = require("mongoose");
const User = require("./models/User");
const dotenv = require("dotenv");

// Load environment variables
dotenv.config();

// Connect to database
mongoose.connect(
  process.env.MONGODB_URI || "mongodb://localhost:27017/franchise_management",
  {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  },
);

const checkUsers = async () => {
  try {
    const users = await User.find({});
    console.log("Users in database:");
    users.forEach((user) => {
      console.log(
        `- ${user.name} (${user.email}) - Role: ${user.role} - Active: ${user.isActive}`,
      );
    });

    // Check specifically for admin user
    const adminUser = await User.findOne({ email: "admin@gmail.com" });
    if (adminUser) {
      console.log("\n✅ Admin user found:");
      console.log(`   Name: ${adminUser.name}`);
      console.log(`   Email: ${adminUser.email}`);
      console.log(`   Role: ${adminUser.role}`);
    } else {
      console.log("\n❌ Admin user (admin@gmail.com) not found!");
    }

    console.log("\nTotal users:", users.length);
    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
};

checkUsers();
