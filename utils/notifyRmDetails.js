const Franchise = require("../models/Franchise");
const User = require("../models/User");
const whatsappService = require("./whatsappService");

// Sends the partner's assigned RM details on WhatsApp once per RM.
// Only runs for approved partners that have an RM. Never throws, so approval/assignment is not affected.
const notifyPartnerRmDetails = async (franchiseId) => {
  try {
    const franchise = await Franchise.findById(franchiseId);
    if (!franchise) return;

    if (franchise.kycStatus !== "approved") return;
    if (!franchise.businessManager) return;
    // Skip missing numbers and the old "0000000000" placeholder
    if (!franchise.phone || franchise.phone === "0000000000") {
      console.log("RM details WhatsApp skipped: partner has no phone number", franchiseId);
      return;
    }

    const rmId = franchise.businessManager.toString();
    if (franchise.rmDetailsSentFor && franchise.rmDetailsSentFor.toString() === rmId) {
      return;
    }

    const rm = await User.findById(rmId).select("name email phone");
    if (!rm) return;

    await whatsappService.sendRmDetails({
      mobile: franchise.phone,
      partnerName: franchise.ownerName || franchise.businessName,
      rmName: rm.name,
      rmMobile: rm.phone,
      rmEmail: rm.email,
    });

    franchise.rmDetailsSentFor = rm._id;
    franchise.rmDetailsSentAt = new Date();
    await franchise.save();
    console.log("RM details sent on WhatsApp to partner:", franchiseId);
  } catch (error) {
    console.error("RM details WhatsApp failed:", error.response?.data || error.message);
  }
};

module.exports = { notifyPartnerRmDetails };
