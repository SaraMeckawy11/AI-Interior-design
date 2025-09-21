// utils/screenUtils.js

export const SCREEN_HEIGHT = window.innerHeight;
export const SCREEN_WIDTH = window.innerWidth;

export const IsIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
export const IsAndroid = /Android/.test(navigator.userAgent);
export const IsIPAD = IsIOS && SCREEN_HEIGHT / SCREEN_WIDTH < 1.6;

export const IsHaveNotch = IsIOS && SCREEN_HEIGHT > 750; // crude approximation
export const hasNotch = IsIOS && SCREEN_HEIGHT >= 812; // iPhone X+

export const Isiphone12promax = IsIOS && SCREEN_HEIGHT >= 926;

export const windowHeight = (height) => {
  if (!height) return 0;
  let baseHeight = 667;
  let tempHeight = SCREEN_HEIGHT * (parseFloat(height.toString()) / baseHeight);
  return Math.round(tempHeight);
};

export const windowWidth = (width) => {
  if (!width) return 0;
  let baseWidth = 480;
  let tempWidth = SCREEN_WIDTH * (parseFloat(width.toString()) / baseWidth);
  return Math.round(tempWidth);
};

export const fontSizes = {
  FONT6: windowWidth(6),
  FONT7: windowWidth(7),
  FONT8: windowWidth(8),
  FONT9: windowWidth(9),
  FONT10: windowWidth(10),
  FONT11: windowWidth(11),
  FONT12: windowWidth(12),
  FONT13: windowWidth(13),
  FONT14: windowWidth(14),
  FONT15: windowWidth(15),
  FONT16: windowWidth(16),
  FONT17: windowWidth(17),
  FONT18: windowWidth(18),
  FONT19: windowWidth(19),
  FONT20: windowWidth(20),
  FONT21: windowWidth(21),
  FONT22: windowWidth(22),
  FONT23: windowWidth(23),
  FONT24: windowWidth(24),
  FONT25: windowWidth(25),
  FONT26: windowWidth(26),
  FONT27: windowWidth(27),
  FONT28: windowWidth(28),
  FONT30: windowWidth(30),
  FONT32: windowWidth(32),
  FONT35: windowWidth(35),
};
