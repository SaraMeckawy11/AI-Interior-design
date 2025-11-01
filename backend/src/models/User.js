import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      // unique: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      minlength: 6,
    },
    profileImage: {
      type: String,
      default: "",
    },
    orders: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Order",
      },
    ],
    //  Track number of free designs used
    freeDesignsUsed: {
      type: Number,
      default: 0,
    },
    // Track total number of designs created
    designCount: {
      type: Number,
      default: 0,  // lifetime total
    },
    activeDesigns: {
      type: Number,
      default: 0,  // currently not deleted
    },

    // Subscription status (paid users)
    isSubscribed: {
      type: Boolean,
      default: false,
    },
    // Manual Premium flag (friends/family accounts)
    isPremium: {
      type: Boolean,
      default: false,
    },
     manualDisabled: { 
      type: Boolean, 
      default: false 
    }, // manually disabled by admin
    adsWatched: { 
      type: Number, 
      default: 0 
    },
    adCoins: { 
      type: Number, 
      default: 0 
    },
  },
  { timestamps: true }
);

// Hash password before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function (userPassword) {
  return await bcrypt.compare(userPassword, this.password);
};

const User = mongoose.model("User", userSchema);

export default User;
