const mongoose = require("mongoose");
const BusinessForm = require("../models/BusinessForm");

// Document slots a customer can have (must match the upload field names)
const DOCUMENT_KEYS = [
  "panCard",
  "aadharFront",
  "aadharBack",
  "cancelCheque",
  "bankProof",
  "extraBankDoc",
];

// PUT /api/business/admin/business-forms/:id/documents
// multipart/form-data: one file per document key (panCard, aadharFront, ...)
// Only the keys that were sent are replaced; the others stay as they are.
const uploadAdminBusinessDocuments = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ message: "Customer not found" });
    }

    const updates = {};
    for (const key of DOCUMENT_KEYS) {
      const file = req.files?.[key]?.[0];
      if (file) {
        updates[`documents.${key}`] = file.path;
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "Choose a file to upload" });
    }

    const updated = await BusinessForm.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true },
    );
    if (!updated) {
      return res.status(404).json({ message: "Customer not found" });
    }

    res.json({
      success: true,
      message: "Document uploaded successfully",
      data: updated,
    });
  } catch (error) {
    res.status(500).json({ message: "Upload failed", error: error.message });
  }
};

module.exports = { uploadAdminBusinessDocuments, DOCUMENT_KEYS };
