# Reply to App Review — send only after the new recording exists

Replace every bracketed value, attach the physical-device recording, and select
the matching build before sending this reply.

## Reply

Hello,

Thank you for the follow-up review. We corrected both issues in build [BUILD
NUMBER].

**Guideline 2.1 — App Tracking Transparency**

The ATT request is now enforced by a root-level startup privacy gate. On iOS and
iPadOS, Livinai waits until the app is active and its first visible frame has
appeared, checks that tracking authorization is undetermined, and presents the
native App Tracking Transparency prompt before navigation, AdMob initialization,
or any ad request. Google Mobile Ads app measurement is delayed in the native
configuration. Declining tracking does not restrict app functionality; ads use
limited, non-personalized signals in that case.

The attached uninterrupted recording was captured on a physical [EXACT DEVICE
MODEL] running [EXACT IOS VERSION]. It shows deletion and reinstallation of
TestFlight build [BUILD NUMBER], launch from the Home Screen, the native ATT
prompt before sign-in or advertising, the selected response, and the normal
sign-in/Create flow that follows.

**Guideline 1.5 — Support URL**

The Support URL is now:

https://livinai2025.github.io/support/

It is live and provides the support email address plus account, purchase,
subscription, design-generation, technical-support, and account-deletion help.
The root URL also opens an official support page.

The corrected recording and complete testing instructions are also included in
App Review Information → Notes.

Thank you for reviewing the corrected submission.

## Recording checklist

1. Update the physical iPhone to the latest public iOS release.
2. Confirm Settings → Privacy & Security → Tracking → Allow Apps to Request to
   Track is enabled.
3. Delete Livinai completely, then install the new build from TestFlight.
4. Start recording on the Home Screen before tapping Livinai.
5. Record continuously through launch, the native ATT prompt, the answer, sign-in,
   and arrival at Create. Do not cut around the prompt.
6. For private QA, repeat a clean-install test choosing the opposite ATT answer;
   both paths must reach the app, and no ad may appear before the decision.
7. Replace every bracketed value in this file and `APP_REVIEW_NOTES.md` with the
   exact device, OS, and build number shown in the recording.
