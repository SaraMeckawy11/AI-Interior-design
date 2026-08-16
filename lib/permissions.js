import { Alert, Linking, Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as MediaLibrary from "expo-media-library";

/**
 * Asking for the camera and the photo library, in one place.
 *
 * Six screens each had their own copy of this, and each copy did the same two
 * things wrong.
 *
 * **It asked again when asking was pointless.** Both platforms answer the
 * *second* permission request without showing anything: iOS never re-prompts,
 * and Android stops after a denial with "don't ask again". The old code called
 * `request…Async` unconditionally and read the status, so a person who had
 * declined once got a dead button and a note telling them to visit their
 * settings — with no way to get there, and no way to tell that from a request
 * that had merely been declined a moment ago. `canAskAgain` is what separates
 * those two, and the second one is the only case where settings are the answer,
 * so it is the only case that offers to open them.
 *
 * **It asked for more than it needed.** Saving a render needs permission to
 * *add* to the photo library and nothing else, but `requestPermissionsAsync()`
 * with no argument asks for full read and write — so downloading one image
 * requested the right to read every photo on the device. Every request below
 * asks for the narrowest thing that lets the feature work, and accepts the
 * narrowest answer: on iOS, "Limited Access" is a yes, because a person who
 * picked three photos to share has granted exactly what picking a photo needs.
 */

/**
 * Offer the one thing that can still help: the app's own settings page.
 *
 * Resolves false either way — the permission is not granted when this returns,
 * whatever the person chose. If they do open settings and grant access, the
 * next tap on the same button is what picks it up, because a permission changed
 * outside the app cannot be awaited from inside it.
 */
const offerSettings = (title, message) =>
  new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: "Not now", style: "cancel", onPress: () => resolve(false) },
        {
          text: "Open Settings",
          onPress: () => {
            Linking.openSettings().catch(() => undefined);
            resolve(false);
          },
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });

/**
 * Run one permission through the same three-way decision.
 *
 * Granted already → go. Never asked, or askable again → ask, and say nothing
 * further if the answer is no; the person just declined a prompt and does not
 * need a second dialog repeating it back. Asked before and no longer askable →
 * the prompt will not appear again, so offer settings.
 */
const ensure = async ({ get, request, title, message }) => {
  // Nothing to grant on web; the file input is its own permission.
  if (Platform.OS === "web") return true;

  try {
    const current = await get();
    if (current.granted) return true;

    if (current.canAskAgain) {
      const asked = await request();
      if (asked.granted) return true;
      // Declined just now, with the prompt still available next time. Sending
      // somebody to settings for a choice they have only just made is nagging.
      if (asked.canAskAgain) return false;
    }

    return offerSettings(title, message);
  } catch (error) {
    if (__DEV__) console.info("Permission check failed:", error?.message);
    return false;
  }
};

/**
 * Permission to choose a photo.
 *
 * Read access, and "Limited Access" counts: the picker shows whatever the
 * person allowed, which is all this needs.
 */
export const ensurePhotoLibraryAccess = () =>
  ensure({
    get: () => ImagePicker.getMediaLibraryPermissionsAsync(),
    request: () => ImagePicker.requestMediaLibraryPermissionsAsync(),
    title: "Photo access is off",
    message:
      "Livinai needs access to your photos to redesign one. Open Settings and choose "
      + "Photos to allow it — you can pick All Photos, or Limited Access and choose "
      + "only the photos you want Livinai to see.",
  });

/** Permission to take a photo. */
export const ensureCameraAccess = () =>
  ensure({
    get: () => ImagePicker.getCameraPermissionsAsync(),
    request: () => ImagePicker.requestCameraPermissionsAsync(),
    title: "Camera access is off",
    message:
      "Livinai needs the camera to photograph the room you want redesigned. "
      + "Open Settings and turn on Camera to allow it.",
  });

/**
 * Permission to save a finished render.
 *
 * `true` is `writeOnly` — add-only access. It is the difference between asking
 * to put one image into the library and asking to read the whole of it, and
 * this feature only ever does the former.
 */
export const ensureSaveToLibraryAccess = () =>
  ensure({
    get: () => MediaLibrary.getPermissionsAsync(true),
    request: () => MediaLibrary.requestPermissionsAsync(true),
    title: "Cannot save to your photos",
    message:
      "Livinai needs permission to add images to your photo library to save this "
      + "design. Open Settings and allow Photos to save it.",
  });
