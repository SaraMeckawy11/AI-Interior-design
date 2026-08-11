import mongoose from "mongoose";

/**
 * One built walkthrough scene, remembered so it is never built twice.
 *
 * The exporter is already content-addressed: give it the same rooms and the same
 * design and it returns the same GLB without rebuilding. The expensive part was
 * never the export — it was *asking*. Every time someone reached the Explore
 * step the API woke a Modal container, submitted a job, polled it for as long as
 * it took to answer, and got back metadata it had already been given before. A
 * user reopening a plan they drew last week paid for a GPU container to tell
 * them something this database can.
 *
 * So the answer is cached here, keyed by a hash of the geometry and design that
 * produced it. A hit costs one indexed lookup and no Modal at all; the GLB
 * itself is served from `/realtime/model/:filename`, which has its own on-disk
 * cache and re-fetches from Modal once if this instance's disk has been recycled.
 *
 * The rows are shared across accounts on purpose. The key is derived only from
 * the plan's shape and finishes — never from who drew it — so two people who
 * draw the same studio flat in the same style get the same scene, and the second
 * one gets it for free. Nothing user-identifying is stored.
 */
const walkthroughSceneSchema = new mongoose.Schema(
  {
    // sha256 of the canonicalised scene request. See `sceneCacheKey`.
    key: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    // The GLB the exporter produced for this key. Content-addressed by the
    // exporter itself, so it is safe to hand out to any user with this key.
    modelName: {
      type: String,
      required: true,
      index: true,
    },

    // Everything the viewer needs besides the geometry: furniture pivots and
    // labels, room centres, the walkable polygons, the spawn point and yaw.
    // Schemaless for the same reason `WalkthroughPlan.data` is — the exporter
    // owns this shape and it changes with the renderer, not with this schema.
    data: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },

    /**
     * The exporter that produced this row, by its own content hash.
     *
     * Every other part of the key describes the *request*: the geometry, the
     * room programme, the finishes, and a revision string the app sends. None
     * of them move when the renderer does, so a new exporter — new furniture,
     * new layout rules, a bug fixed — kept being answered with scenes the old
     * one had built. Invalidating that meant bumping a constant by hand and
     * hoping every client had been updated to send it, which is how the style
     * kits shipped to nobody.
     *
     * The renderer already reports this hash on its health endpoint, and it
     * covers the exporter's Python *and* its catalog assets. Storing it here
     * means a scene can only be served by the renderer that built it, and the
     * cache empties itself the moment one is deployed.
     */
    rendererSource: {
      type: String,
      default: "",
    },

    // Touched on every hit. A scene nobody has opened in three months is a scene
    // whose GLB has almost certainly been evicted from the Modal volume anyway,
    // so keeping the row would only produce a 404 the app has to recover from.
    lastUsedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true },
);

walkthroughSceneSchema.index({ lastUsedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

const WalkthroughScene = mongoose.model("WalkthroughScene", walkthroughSceneSchema);

export default WalkthroughScene;
