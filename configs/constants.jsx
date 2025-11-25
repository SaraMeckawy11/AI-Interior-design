import { IsIPAD } from "@/themes/app.constant";
import { Dimensions, Image } from "react-native";
import { scale, verticalScale } from "react-native-size-matters";

import One from "@/assets/images/onboarding/i1.png";
import Two from "@/assets/images/onboarding/i2.png";
import Three from "@/assets/images/onboarding/i3.png";

// Import after images for last slide
const afterImages = [
  require('@/assets/images/onboarding/1.jpg'),
  require('@/assets/images/onboarding/2.jpg'),
  require('@/assets/images/onboarding/3.jpg'),
  require('@/assets/images/onboarding/4.jpg'),
  require('@/assets/images/onboarding/5.jpg'),
  require('@/assets/images/onboarding/6.jpg'),
  require('@/assets/images/onboarding/7.jpg'),
  require('@/assets/images/onboarding/8.jpg'),
  require('@/assets/images/onboarding/9.jpg'),
  require('@/assets/images/onboarding/10.jpg'),
];

import COLORS from "@/constants/colors";

export const onBoardingSlides = [
  // {
  //   color: COLORS.primary,
  //   title: "Transform Your Space",
  //   image: (
  //     <Image
  //       source={One}
  //       style={{
  //         width: IsIPAD ? verticalScale(285) : verticalScale(320),
  //         height: IsIPAD ? verticalScale(345) : verticalScale(330),
  //       }}
  //     />
  //   ),
  //   secondTitle: "With AI Vision",
  //   subTitle:
  //     "Upload your room photo and let our AI visualize stunning interiors tailored to your space.",
  // },
  //  {
  //   color: COLORS.cardBackground,
  //   title: "Get Inspired",
  //   image: (
  //     <Image
  //       source={Three}
  //       style={{
  //         width: IsIPAD ? scale(285) : scale(320),
  //         height: IsIPAD ? verticalScale(345) : verticalScale(330),
  //       }}
  //     />
  //   ),
  //   secondTitle: "Design Instantly",
  //   subTitle:
  //     "Generate AI-powered interior visuals and bring your dream space to life in seconds.",
  // },
  // {
  //   color: COLORS.secondary,
  //   title: "Customize Your Design",
  //   image: (
  //     <Image
  //       source={Two}
  //       style={{
  //         width: IsIPAD ? scale(285) : scale(320),
  //         height: IsIPAD ? verticalScale(345) : verticalScale(330),
  //       }}
  //     />
  //   ),
  //   secondTitle: "Your Style, Your Rules",
  //   subTitle:
  //     "Choose your room type, preferred design style, and color tones for a personalized result.",
  // },
  {
    color: COLORS.cardBackground,
    title: "Transform Your Space",
    images: afterImages, // last slide becomes slideshow
    secondTitle: "With AI Vision",
    subTitle:
      "Generate AI-powered designs and bring your dream space to life in seconds.",
  },
];

// Onboarding layout constants
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
