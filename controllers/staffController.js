const mongoose = require("mongoose");
const User = require("../models/User");
const Role = require("../models/Role");
const Franchise = require("../models/Franchise");
const { PERMISSIONS, PERMISSION_KEYS, SCOPABLE_KEYS } = require("../config/permissions");
const { generateTempPassword } = require("../utils/password");
const generateBusinessManagerCode = require("../utils/generateBusinessManagerCode");
const { sendStaffCredentialsEmail } = require("../utils/emailService");

const RESEND_COOLDOWN_MS = 60 * 1000;

// Existing admin-role accounts that can be turned into staff by email.
// Super admins are never converted.
const CONVERTIBLE_SUB_ROLES = ["staff", "credit_analyst", "relationship_manager"];

const fail = (res, status, message) =>
  res.status(status).json({ success: false, message });

const handleError = (res, err) => {
  if (err.code === 11000) return fail(res, 409, "A role with this name already exists");
  const status = err.name === "ValidationError" ? 400 : 500;
  return fail(res, status, err.message);
};

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const cleanPermissions = (list) => {
  if (!Array.isArray(list)) return null;
  const unique = [...new Set(list)];
  return unique.every((key) => PERMISSION_KEYS.includes(key)) ? unique : null;
};

const findStaff = (id) =>
  User.findOne({
    _id: id,
    staffRole: { $ne: null },
    isDeleted: { $ne: true },
  });

const getPermissionCatalog = (req, res) =>
  res.json({
    success: true,
    data: PERMISSIONS.map((p) => ({ ...p, scopable: SCOPABLE_KEYS.includes(p.key) })),
  });

// Staff profile: the member plus the franchises they own (Business Manager view)
const getStaffProfile = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return fail(res, 400, "Invalid staff id");

    const staff = await User.findOne({
      _id: req.params.id,
      staffRole: { $ne: null },
    })
      .select("-password")
      .populate("staffRole", "name description permissions limitToOwnFranchises isActive");
    if (!staff) return fail(res, 404, "Staff member not found");

    const franchises = await Franchise.find({
      businessManager: staff._id,
      isDeleted: { $ne: true },
    })
      .select("businessName ownerName franchiseCode city state kycStatus isActive email phone createdAt")
      .sort({ createdAt: -1 })
      .lean();

    const summary = {
      totalFranchises: franchises.length,
      activeFranchises: franchises.filter((f) => f.isActive).length,
      permissionCount: staff.staffRole?.permissions?.length || 0,
      isBusinessManager: !!staff.staffRole?.limitToOwnFranchises,
    };

    res.json({ success: true, data: { staff, franchises, summary } });
  } catch (err) {
    handleError(res, err);
  }
};

// ---- Roles ----

const listRoles = async (req, res) => {
  try {
    const roles = await Role.find().sort({ name: 1 }).lean();
    const counts = await User.aggregate([
      { $match: { staffRole: { $ne: null }, isDeleted: { $ne: true } } },
      { $group: { _id: "$staffRole", count: { $sum: 1 } } },
    ]);
    const countByRole = new Map(counts.map((c) => [String(c._id), c.count]));

    res.json({
      success: true,
      data: roles.map((role) => ({
        ...role,
        staffCount: countByRole.get(String(role._id)) || 0,
      })),
    });
  } catch (err) {
    handleError(res, err);
  }
};

const createRole = async (req, res) => {
  try {
    const name = (req.body.name || "").trim();
    const permissions = cleanPermissions(req.body.permissions);
    if (!name) return fail(res, 400, "Role name is required");
    if (!permissions) return fail(res, 400, "Invalid permissions");

    const limitToOwnFranchises = Boolean(req.body.limitToOwnFranchises);
    if (limitToOwnFranchises && !permissions.every((k) => SCOPABLE_KEYS.includes(k))) {
      return fail(
        res,
        400,
        "A Business Manager role can only include sections that are limited to own franchises",
      );
    }

    const role = await Role.create({
      name,
      description: (req.body.description || "").trim(),
      permissions,
      limitToOwnFranchises,
      createdBy: req.user._id,
    });

    res.status(201).json({ success: true, message: "Role created", data: role });
  } catch (err) {
    handleError(res, err);
  }
};

const updateRole = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return fail(res, 400, "Invalid role id");

    const role = await Role.findById(req.params.id);
    if (!role) return fail(res, 404, "Role not found");

    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) return fail(res, 400, "Role name is required");
      role.name = name;
    }
    if (req.body.description !== undefined) {
      role.description = String(req.body.description).trim();
    }
    if (req.body.permissions !== undefined) {
      const permissions = cleanPermissions(req.body.permissions);
      if (!permissions) return fail(res, 400, "Invalid permissions");
      role.permissions = permissions;
    }
    // Business Manager flag: scoped roles may only hold scopable sections
    const limitTouched = req.body.limitToOwnFranchises !== undefined;
    const turningOn = limitTouched
      ? Boolean(req.body.limitToOwnFranchises)
      : role.limitToOwnFranchises;
    if (turningOn && !role.permissions.every((k) => SCOPABLE_KEYS.includes(k))) {
      return fail(
        res,
        400,
        "A Business Manager role can only include sections that are limited to own franchises",
      );
    }
    if (limitTouched && turningOn !== role.limitToOwnFranchises) {
      const memberIds = await User.find({ staffRole: role._id }).distinct("_id");
      if (turningOn) {
        // Give every existing member a permanent RM code
        const members = await User.find({ _id: { $in: memberIds }, staffCode: null });
        for (const member of members) {
          member.staffCode = await generateBusinessManagerCode();
          await member.save();
        }
      } else {
        const owned = await Franchise.countDocuments({ businessManager: { $in: memberIds } });
        if (owned > 0) {
          return fail(
            res,
            400,
            `Reassign the ${owned} franchise(s) owned by this role's members before turning off Business Manager`,
          );
        }
      }
      role.limitToOwnFranchises = turningOn;
    }

    if (req.body.isActive !== undefined) {
      role.isActive = Boolean(req.body.isActive);
    }

    await role.save();
    res.json({ success: true, message: "Role updated", data: role });
  } catch (err) {
    handleError(res, err);
  }
};

const deleteRole = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return fail(res, 400, "Invalid role id");

    const assigned = await User.countDocuments({
      staffRole: req.params.id,
      isDeleted: { $ne: true },
    });
    if (assigned > 0) {
      return fail(
        res,
        400,
        `Reassign the ${assigned} staff member(s) using this role before deleting it`,
      );
    }

    const role = await Role.findByIdAndDelete(req.params.id);
    if (!role) return fail(res, 404, "Role not found");

    res.json({ success: true, message: "Role deleted" });
  } catch (err) {
    handleError(res, err);
  }
};

// ---- Staff ----

const listStaff = async (req, res) => {
  try {
    const staff = await User.find({
      staffRole: { $ne: null },
      isDeleted: { $ne: true },
    })
      .select("-password")
      .populate("staffRole", "name limitToOwnFranchises")
      .sort({ createdAt: -1 });

    res.json({ success: true, data: staff });
  } catch (err) {
    handleError(res, err);
  }
};

// Creates a staff account with an auto-generated password, or converts an
// existing staff-capable account with the same email. Mirrors the franchise
// partner flow in adminController.createFranchiseUser.
const assignStaff = async (req, res) => {
  try {
    const name = (req.body.name || "").trim();
    const email = (req.body.email || "").trim().toLowerCase();
    const { roleId, phone } = req.body;

    if (!name) return fail(res, 400, "Name is required");
    if (!email) return fail(res, 400, "Email is required");
    if (!isValidId(roleId)) return fail(res, 400, "Choose a role");
    // Phone is needed: RM details are sent to partners on WhatsApp
    if (!/^\d{10}$/.test(String(phone || ""))) {
      return fail(res, 400, "Enter a valid 10-digit phone number");
    }

    const role = await Role.findById(roleId);
    if (!role || !role.isActive) return fail(res, 400, "Role not found or inactive");

    const existing = await User.findOne({ email, isDeleted: { $ne: true } });
    if (existing) {
      const convertible =
        existing.role === "admin" && CONVERTIBLE_SUB_ROLES.includes(existing.subRole);
      if (!convertible) {
        return fail(
          res,
          400,
          "This email belongs to an account that cannot be made staff",
        );
      }

      existing.staffRole = role._id;
      existing.phone = phone;
      existing.subRole = "staff";
      if (role.limitToOwnFranchises && !existing.staffCode) {
        existing.staffCode = await generateBusinessManagerCode();
      }
      existing.isActive = true;
      await existing.save();

      const data = await User.findById(existing._id)
        .select("-password")
        .populate("staffRole", "name");
      return res.json({
        success: true,
        message: "Role assigned to the existing account",
        data,
        emailSent: false,
      });
    }

    // Soft-deleted accounts may still hold this email; rename them so it can be reused
    const deletedHolders = await User.find({ email, isDeleted: true });
    for (const holder of deletedHolders) {
      holder.email = `deleted_${Date.now()}_${holder.email}`;
      await holder.save();
    }

    const tempPassword = generateTempPassword();
    const user = new User({
      name,
      email,
      phone,
      state: "Not Provided",
      pincode: "000000",
      language: "en",
      password: tempPassword,
      role: "admin",
      subRole: "staff",
      staffRole: role._id,
      staffCode: role.limitToOwnFranchises ? await generateBusinessManagerCode() : undefined,
      isActive: true,
      isVerified: true,
    });
    await user.save();

    let emailSent = true;
    try {
      await sendStaffCredentialsEmail(user, tempPassword, role.name);
      await User.updateOne(
        { _id: user._id },
        { $set: { credentialsSentAt: new Date() }, $inc: { credentialsSentCount: 1 } },
      );
    } catch (emailErr) {
      emailSent = false;
      console.error("Staff credentials email failed:", emailErr);
    }

    const data = await User.findById(user._id)
      .select("-password")
      .populate("staffRole", "name");

    res.status(201).json({
      success: true,
      message: emailSent
        ? "Staff account created and credentials emailed"
        : "Staff account created, but the email failed. Use resend credentials.",
      data,
      emailSent,
    });
  } catch (err) {
    handleError(res, err);
  }
};

const changeStaffRole = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return fail(res, 400, "Invalid staff id");
    if (!isValidId(req.body.roleId)) return fail(res, 400, "Choose a role");

    const role = await Role.findById(req.body.roleId);
    if (!role || !role.isActive) return fail(res, 400, "Role not found or inactive");

    const staff = await findStaff(req.params.id);
    if (!staff) return fail(res, 404, "Staff member not found");

    // Leaving a Business Manager role is blocked while they still own franchises
    if (!role.limitToOwnFranchises) {
      const owned = await Franchise.countDocuments({ businessManager: staff._id });
      if (owned > 0) {
        return fail(
          res,
          400,
          `Reassign their ${owned} franchise(s) before moving them off a Business Manager role`,
        );
      }
    }

    staff.staffRole = role._id;
    if (role.limitToOwnFranchises && !staff.staffCode) {
      staff.staffCode = await generateBusinessManagerCode();
    }
    await staff.save();

    const data = await User.findById(staff._id)
      .select("-password")
      .populate("staffRole", "name");
    res.json({ success: true, message: "Role updated", data });
  } catch (err) {
    handleError(res, err);
  }
};

// Edits basic details (name, email, phone). Only the fields sent are changed.
// Role, status and password have their own endpoints.
const updateStaffDetails = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return fail(res, 400, "Invalid staff id");

    const { name, email, phone } = req.body;
    if (name === undefined && email === undefined && phone === undefined) {
      return fail(res, 400, "Send at least one of: name, email, phone");
    }

    const staff = await findStaff(req.params.id);
    if (!staff) return fail(res, 404, "Staff member not found");

    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (!trimmed) return fail(res, 400, "Name cannot be empty");
      staff.name = trimmed;
    }

    if (phone !== undefined) {
      const digits = String(phone).trim();
      if (!/^\d{10}$/.test(digits)) return fail(res, 400, "Enter a valid 10-digit phone number");
      staff.phone = digits;
    }

    if (email !== undefined) {
      const normalized = String(email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
        return fail(res, 400, "Enter a valid email address");
      }
      // Email is the login, so it must not belong to another active account
      const taken = await User.findOne({
        email: normalized,
        isDeleted: { $ne: true },
        _id: { $ne: staff._id },
      });
      if (taken) return fail(res, 409, "This email is already used by another account");
      staff.email = normalized;
    }

    await staff.save();

    const data = await User.findById(staff._id)
      .select("-password")
      .populate("staffRole", "name");
    res.json({ success: true, message: "Staff details updated", data });
  } catch (err) {
    handleError(res, err);
  }
};

// Deactivating takes effect on the next request, since auth re-checks isActive
const setStaffStatus = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return fail(res, 400, "Invalid staff id");
    if (typeof req.body.isActive !== "boolean") {
      return fail(res, 400, "isActive must be true or false");
    }

    const staff = await findStaff(req.params.id);
    if (!staff) return fail(res, 404, "Staff member not found");

    staff.isActive = req.body.isActive;
    await staff.save();

    res.json({
      success: true,
      message: staff.isActive ? "Staff account activated" : "Staff account deactivated",
    });
  } catch (err) {
    handleError(res, err);
  }
};

// Emails first and only then changes the password, so a failed email
// never locks the staff member out of their current password.
const resendCredentials = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return fail(res, 400, "Invalid staff id");

    const staff = await findStaff(req.params.id).populate("staffRole", "name");
    if (!staff) return fail(res, 404, "Staff member not found");

    const sentAt = staff.credentialsSentAt ? new Date(staff.credentialsSentAt).getTime() : 0;
    const waitMs = RESEND_COOLDOWN_MS - (Date.now() - sentAt);
    if (waitMs > 0) {
      return fail(
        res,
        429,
        `Please wait ${Math.ceil(waitMs / 1000)} seconds before resending`,
      );
    }

    const newPassword = generateTempPassword();
    try {
      await sendStaffCredentialsEmail(staff, newPassword, staff.staffRole?.name || "Staff");
    } catch (emailErr) {
      console.error("Resend staff credentials failed:", emailErr);
      return fail(res, 502, "Could not send the email. The password was not changed.");
    }

    staff.password = newPassword;
    staff.credentialsSentAt = new Date();
    staff.credentialsSentCount = (staff.credentialsSentCount || 0) + 1;
    await staff.save();

    res.json({ success: true, message: "New credentials emailed" });
  } catch (err) {
    handleError(res, err);
  }
};

module.exports = {
  getPermissionCatalog,
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  listStaff,
  getStaffProfile,
  assignStaff,
  changeStaffRole,
  updateStaffDetails,
  setStaffStatus,
  resendCredentials,
};
