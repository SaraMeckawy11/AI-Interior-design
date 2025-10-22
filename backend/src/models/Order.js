import mongoose from "mongoose";

const orderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Store RevenueCat product identifier (like livinai_weekly:default)
    plan: {
      type: String,
      required: true,
    },
    price: {
      type: Number,
      required: true,
    },
    billingCycle: {
      type: String,
      enum: ["weekly", "yearly"],
      required: true,
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed"],
      default: "pending",
    },
    startDate: {
      type: Date,
      default: Date.now,
    },
    endDate: {
      type: Date,
      required: true,
    },
    transactionId: {
      type: String,
    },
    entitlementId: {
      type: String, // RevenueCat entitlement ID
    },
    autoRenew: {
      type: Boolean,
      default: true,
    },
    isActive: {
      type: Boolean,
      default: true, // becomes false when expired
    },
    canceledAt: {
      type: Date, // tracks when the user canceled
      default: null,
    },
  },
  { timestamps: true }
);

// Index for faster lookups by user
orderSchema.index({ user: 1 });

const Order = mongoose.models.Order || mongoose.model("Order", orderSchema);

export default Order;
