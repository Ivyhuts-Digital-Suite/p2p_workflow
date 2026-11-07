import { ROLES } from '../../constants/roles';
import { DOCUMENT_STATUS, VENDOR_STATUS, VendorStatus } from '../../constants/status';
import { currentUser } from '../../middleware/auth';
import { Bid } from '../../models/Bid';
import { PurchaseOrder } from '../../models/PurchaseOrder';
import { User } from '../../models/User';
import { Vendor } from '../../models/Vendor';
import { ApiError } from '../../utils/ApiError';
import { asyncHandler } from '../../utils/asyncHandler';
import { oid } from '../../utils/objectId';
import { nextDocNumber } from '../../utils/sequence';

export const listVendors = asyncHandler(async (req, res) => {
  const filter: Record<string, unknown> = {};
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.category) filter.categories = String(req.query.category);
  if (req.query.past === 'true') {
    const [bidders, suppliers] = await Promise.all([Bid.distinct('vendor'), PurchaseOrder.distinct('vendor')]);
    filter._id = { $in: [...bidders, ...suppliers] };
  }
  res.json(await Vendor.find(filter).sort({ companyName: 1 }));
});

export const getVendor = asyncHandler(async (req, res) => {
  const vendor = await Vendor.findById(req.params.id);
  if (!vendor) throw ApiError.notFound('Vendor');
  res.json(vendor);
});

export const createVendor = asyncHandler(async (req, res) => {
  const { portalPassword, ...profile } = req.body;
  const vendor = await Vendor.create({ ...profile, vendorCode: await nextDocNumber('VEN') });

  if (portalPassword) {
    const user = await User.create({
      name: profile.contactPerson,
      email: profile.email,
      password: portalPassword,
      role: ROLES.VENDOR,
      vendor: vendor._id,
    });
    vendor.user = user._id;
    await vendor.save();
  }
  res.status(201).json(vendor);
});

export const updateVendor = asyncHandler(async (req, res) => {
  const vendor = await Vendor.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!vendor) throw ApiError.notFound('Vendor');
  res.json(vendor);
});

const setStatus = (status: VendorStatus) =>
  asyncHandler(async (req, res) => {
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) throw ApiError.notFound('Vendor');
    if (status === VENDOR_STATUS.APPROVED && (!vendor.pan || !vendor.bankDetails?.accountNumber)) {
      throw ApiError.unprocessable('Vendor needs a PAN and bank details before approval (KYC)');
    }
    vendor.status = status;
    await vendor.save();
    res.json(vendor);
  });

export const approveVendor = setStatus(VENDOR_STATUS.APPROVED);
export const suspendVendor = setStatus(VENDOR_STATUS.SUSPENDED);
export const blacklistVendor = setStatus(VENDOR_STATUS.BLACKLISTED);

// ---- Vendor self-service ----------------------------------------------------------

export const myProfile = asyncHandler(async (req, res) => {
  const vendor = await Vendor.findById(currentUser(req).vendor);
  if (!vendor) throw ApiError.notFound('Vendor profile');
  res.json(vendor);
});

export const updateMyProfile = asyncHandler(async (req, res) => {
  const vendor = await Vendor.findByIdAndUpdate(currentUser(req).vendor, req.body, { new: true, runValidators: true });
  if (!vendor) throw ApiError.notFound('Vendor profile');
  res.json(vendor);
});

/** A vendor adds a licence or a renewal. It counts for a required licence once Procurement verifies it. */
export const addMyDocument = asyncHandler(async (req, res) => {
  const vendor = await Vendor.findByIdAndUpdate(
    currentUser(req).vendor,
    { $push: { documents: { ...req.body, status: DOCUMENT_STATUS.PENDING, uploadedAt: new Date() } } },
    { new: true, runValidators: true },
  );
  if (!vendor) throw ApiError.notFound('Vendor profile');
  res.status(201).json(vendor);
});

export const verifyDocument = asyncHandler(async (req, res) => {
  const vendor = await Vendor.findOneAndUpdate(
    { _id: req.params.id, documents: { $elemMatch: { _id: req.params.docId, status: DOCUMENT_STATUS.PENDING } } },
    {
      $set: {
        'documents.$.status': req.body.decision,
        'documents.$.remarks': req.body.remarks,
        'documents.$.verifiedBy': oid(currentUser(req).id),
        'documents.$.verifiedAt': new Date(),
      },
    },
    { new: true },
  );
  if (!vendor) throw ApiError.unprocessable('This document is not waiting to be verified');
  res.json(vendor);
});
