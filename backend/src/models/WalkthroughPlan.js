import mongoose from "mongoose";

/**
 * A saved 3D plan.
 *
 * The walkthrough editor used to keep every plan in AsyncStorage only, so a
 * plan a user spent an evening drawing lived on exactly one device and vanished
 * with the app. This collection is the durable copy: the geometry the editor
 * needs to reopen the plan is stored verbatim in `data`, and the two images a
 * plan can carry (the uploaded floor plan it was traced over, and a preview
 * thumbnail) are moved to Cloudinary so they survive the local file cache.
 *
 * `data` is deliberately schemaless. The editor's coordinate format is versioned
 * by the `coordinateSpace` field inside it, and pinning a strict shape here would
 * mean a schema migration every time the plan editor learns a new kind of wall.
 */
const walkthroughPlanSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // The id the device generated when the plan was first created. It is what
    // lets an offline draft become an update of the same row rather than a
    // duplicate the first time the phone gets a connection back.
    clientId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },

    title: {
      type: String,
      trim: true,
      maxlength: 80,
      default: "Untitled 3D plan",
    },

    // Whether the plan was traced over an uploaded image or drawn from scratch.
    // The library shows this so the two kinds of project are told apart at a
    // glance without opening them.
    source: {
      type: String,
      enum: ["upload", "blank"],
      default: "blank",
    },

    roomCount: { type: Number, default: 0 },
    openingCount: { type: Number, default: 0 },
    areaMeters: { type: Number, default: 0 },

    // The uploaded floor plan the rooms were traced over.
    planImage: { type: String },
    planImagePublicId: { type: String },

    // Preview shown on the library card — an AI render when the user has made
    // one, otherwise the uploaded plan.
    thumbnail: { type: String },
    thumbnailPublicId: { type: String },

    data: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
  },
  { timestamps: true },
);

// One row per plan per user. `clientId` alone is not unique across accounts, and
// two users can legitimately hold the same generated id.
walkthroughPlanSchema.index({ user: 1, clientId: 1 }, { unique: true });
walkthroughPlanSchema.index({ user: 1, updatedAt: -1 });

const WalkthroughPlan = mongoose.model("WalkthroughPlan", walkthroughPlanSchema);

export default WalkthroughPlan;
