"""Pre-download all HuggingFace models at Docker build time.

Must exactly match the models and cache_dir used by handler.py so the
built image ships with every weight file already on disk. This avoids
cold-start network downloads that can time out on RunPod serverless
workers and trigger the startup Traceback.
"""
from transformers import (
    DPTImageProcessor,
    DPTForDepthEstimation,
    AutoImageProcessor,
    UperNetForSemanticSegmentation,
)
from diffusers import (
    StableDiffusionControlNetPipeline,
    ControlNetModel,
)

CACHE_DIR = "/home/user/.cache/huggingface"


def main() -> None:
    print("[preload] depth model...", flush=True)
    DPTImageProcessor.from_pretrained("Intel/dpt-large", cache_dir=CACHE_DIR)
    DPTForDepthEstimation.from_pretrained("Intel/dpt-large", cache_dir=CACHE_DIR)

    print("[preload] segmentation model...", flush=True)
    AutoImageProcessor.from_pretrained(
        "openmmlab/upernet-convnext-small", cache_dir=CACHE_DIR
    )
    UperNetForSemanticSegmentation.from_pretrained(
        "openmmlab/upernet-convnext-small", cache_dir=CACHE_DIR
    )

    print("[preload] controlnet models...", flush=True)
    c1 = ControlNetModel.from_pretrained(
        "lllyasviel/sd-controlnet-depth", cache_dir=CACHE_DIR
    )
    c2 = ControlNetModel.from_pretrained(
        "lllyasviel/control_v11p_sd15_seg", cache_dir=CACHE_DIR
    )

    print("[preload] stable diffusion pipeline...", flush=True)
    StableDiffusionControlNetPipeline.from_pretrained(
        "Lykon/dreamshaper-8",
        controlnet=[c1, c2],
        cache_dir=CACHE_DIR,
    )

    print("[preload] done.", flush=True)


if __name__ == "__main__":
    main()
