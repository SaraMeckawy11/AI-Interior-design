const DEFAULT_SERVER_URI = "https://ai-interior-design-g5oc.onrender.com";

const configuredServerUri = process.env.EXPO_PUBLIC_SERVER_URI?.trim();

export const SERVER_URI = (configuredServerUri || DEFAULT_SERVER_URI).replace(
  /\/+$/,
  ""
);

export const apiUrl = (path) => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${SERVER_URI}${normalizedPath}`;
};
