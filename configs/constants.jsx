import { Dimensions } from "react-native";
import COLORS from "@/constants/colors";

const showcaseImages = [
  require("@/assets/images/onboarding/editorial-living-room.jpg"),
  require("@/assets/images/onboarding/editorial-bedroom.jpg"),
  require("@/assets/images/onboarding/editorial-kitchen.jpg"),
  require("@/assets/images/onboarding/editorial-bathroom.jpg"),
  require("@/assets/images/onboarding/editorial-villa-exterior.jpg"),
  require("@/assets/images/onboarding/editorial-terrace-exterior.jpg"),
];

const showcaseImageLabels = [
  "A warm contemporary living room in ivory, oak, and muted sage",
  "A serene bedroom with soft arches and natural materials",
  "A harmonious oak kitchen and dining space",
  "A spa-like bathroom in limestone and warm oak",
  "A contemporary Mediterranean villa at golden hour",
  "A landscaped rooftop terrace overlooking the city",
];

export const onBoardingSlides = [
  {
    color: COLORS.cardBackground,
    title: "Reimagine Every Space",
    images: showcaseImages,
    imageLabels: showcaseImageLabels,
    secondTitle: "Inside and Out",
    subTitle:
      "Create harmonious interiors and striking exteriors, tailored to your home in seconds.",
  },
];

export const Side = {
  LEFT: "LEFT",
  RIGHT: "RIGHT",
  NONE: "NONE",
};

export const MIN_LEDGE = 25;
export const { width: WIDTH, height: HEIGHT } = Dimensions.get("screen");
export const MARGIN_WIDTH = MIN_LEDGE + 50;
export const PREV = WIDTH;
export const NEXT = 0;
export const LEFT_SNAP_POINTS = [MARGIN_WIDTH, PREV];
export const RIGHT_SNAP_POINTS = [NEXT, WIDTH - MARGIN_WIDTH];
