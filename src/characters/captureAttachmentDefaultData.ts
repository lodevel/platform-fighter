import {parseCaptureAttachmentCalibration, type CaptureAttachmentCalibration} from './captureAttachmentCalibration';

/** Reviewed target 2D calibration, not a recovered native capture constraint.
 * DK grip rows belong ONLY to the selected grab_pull/grab_hold clip; the
 * captor default carries identity, avoiding duplicate-selector ambiguity.
 * Pikachu and DK own reviewed recipient anchors/floor: their captured (ordinary-held)
 * and captured_hit (ordinary-damage, pummel hit) drawings. Cargo (carry and cargo
 * throw) reuses the held rows; ordinary throw poses, other recipients and changed dimensions retain
 * named legacy fallback unless separate exact metadata is supplied.
 */
export const CAPTURE_ATTACHMENT_DEFAULT_REVIEW_PINS = {
  "dkGripInputSha256": "61cded14e5707275ebfdd355c02baaebc83af62f49ae7d029d1ae0f1d32408cc",
  "dkOwnAnchorFloorSha256": "2abf50e4a03e3fe4f697673726bedb250e4622b61cb61c5c41cd15c76664733e",
  "pikachuOwnAnchorFloorSha256": "2abea3630a0329a338d3baea645b1b2117477d4f182d1d062924fd9778dd1b9a"
} as const;

/** DK's captor grips live in gameplay.json (captureGripPoses); as a RECIPIENT (carried by / pummelled by a DK captor) DK owns these anchors and
 * floor (rework 2026-10-11 remaining gaps, dk-recipient-anchor/derive_dk_recipient_anchors.py).
 * The extras2 rows (cargo_recipient_carried -> cargo-held, cargo_recipient_{f,b,u,d}throw -> cargo-throw) are the drawing's native Hip
 * (install/extras2/derive_recipient_anchors.py); the captured drawings still use their ordinary-held rows while carried. */
const donkeykongIdentity = {
  "profileKey": "dk-ordinary-grab-target-v1",
  "revision": "57bb01221909e840a2ae4bce31743fc405193d05246428a05ba9f38f6ee28f70",
  "anchors": [
    {
      "poseKey": "captured",
      "context": "ordinary-held",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 0,
      "nativeSample": 1,
      "point": {
        "x": 5.8333337499999995,
        "y": -6.300003449999998
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "captured",
      "context": "ordinary-held",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 1,
      "nativeSample": 9,
      "point": {
        "x": 3.03333355,
        "y": -7.700003549999998
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "captured",
      "context": "ordinary-held",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 2,
      "nativeSample": 17,
      "point": {
        "x": 3.03333355,
        "y": -11.900003849999997
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "captured",
      "context": "ordinary-held",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 3,
      "nativeSample": 24,
      "point": {
        "x": 3.50000025,
        "y": -14.700004049999997
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "captured",
      "context": "ordinary-held",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 4,
      "nativeSample": 32,
      "point": {
        "x": 3.50000025,
        "y": -14.700004049999997
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "captured_hit",
      "context": "ordinary-damage",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 0,
      "nativeSample": 1,
      "point": {
        "x": 12.83333425,
        "y": -26.366671549999992
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "captured_hit",
      "context": "ordinary-damage",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 1,
      "nativeSample": 7,
      "point": {
        "x": 13.30000095,
        "y": -10.966670450000002
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "captured_hit",
      "context": "ordinary-damage",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 2,
      "nativeSample": 14,
      "point": {
        "x": 15.63333445,
        "y": -13.300003949999997
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "captured_hit",
      "context": "ordinary-damage",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 3,
      "nativeSample": 20,
      "point": {
        "x": 6.30000045,
        "y": -5.366670049999996
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "cargo_recipient_carried",
      "context": "cargo-held",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 0,
      "nativeSample": 1,
      "point": {
        "x": 2.648,
        "y": -21.386
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "cargo_recipient_carried",
      "context": "cargo-held",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 1,
      "nativeSample": 9,
      "point": {
        "x": 2.358,
        "y": -21.243
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "cargo_recipient_carried",
      "context": "cargo-held",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 2,
      "nativeSample": 17,
      "point": {
        "x": 2.023,
        "y": -21.132
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "cargo_recipient_carried",
      "context": "cargo-held",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 3,
      "nativeSample": 25,
      "point": {
        "x": 2.02,
        "y": -21.31
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "cargo_recipient_carried",
      "context": "cargo-held",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 4,
      "nativeSample": 33,
      "point": {
        "x": 2.202,
        "y": -21.449
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "cargo_recipient_carried",
      "context": "cargo-held",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 5,
      "nativeSample": 41,
      "point": {
        "x": 2.319,
        "y": -21.385
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "cargo_recipient_carried",
      "context": "cargo-held",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 6,
      "nativeSample": 48,
      "point": {
        "x": 2.379,
        "y": -21.417
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "cargo_recipient_carried",
      "context": "cargo-held",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 7,
      "nativeSample": 56,
      "point": {
        "x": 2.25,
        "y": -21.416
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "cargo_recipient_carried",
      "context": "cargo-held",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 8,
      "nativeSample": 64,
      "point": {
        "x": 2.346,
        "y": -21.411
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "cargo_recipient_carried",
      "context": "cargo-held",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 9,
      "nativeSample": 72,
      "point": {
        "x": 2.566,
        "y": -21.432
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "cargo_recipient_carried",
      "context": "cargo-held",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 10,
      "nativeSample": 80,
      "point": {
        "x": 2.675,
        "y": -21.4
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "cargo_recipient_fthrow",
      "context": "cargo-throw",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 0,
      "nativeSample": 1,
      "point": {
        "x": -1.414,
        "y": -27.334
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "cargo_recipient_fthrow",
      "context": "cargo-throw",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 1,
      "nativeSample": 5,
      "point": {
        "x": -1.926,
        "y": -27.694
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "cargo_recipient_fthrow",
      "context": "cargo-throw",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 2,
      "nativeSample": 9,
      "point": {
        "x": -1.774,
        "y": -27.628
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "cargo_recipient_fthrow",
      "context": "cargo-throw",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 3,
      "nativeSample": 13,
      "point": {
        "x": 2.374,
        "y": -26.056
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "cargo_recipient_fthrow",
      "context": "cargo-throw",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 4,
      "nativeSample": 15,
      "point": {
        "x": 2.605,
        "y": -25.256
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "cargo_recipient_bthrow",
      "context": "cargo-throw",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 0,
      "nativeSample": 1,
      "point": {
        "x": 13.718,
        "y": -25.224
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "cargo_recipient_bthrow",
      "context": "cargo-throw",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 1,
      "nativeSample": 5,
      "point": {
        "x": 26.153,
        "y": -30.031
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "cargo_recipient_bthrow",
      "context": "cargo-throw",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 2,
      "nativeSample": 9,
      "point": {
        "x": 22.306,
        "y": -18.96
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "cargo_recipient_bthrow",
      "context": "cargo-throw",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 3,
      "nativeSample": 13,
      "point": {
        "x": -22.792,
        "y": -30.019
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "cargo_recipient_bthrow",
      "context": "cargo-throw",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 4,
      "nativeSample": 16,
      "point": {
        "x": -23.15,
        "y": -29.964
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "cargo_recipient_uthrow",
      "context": "cargo-throw",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 0,
      "nativeSample": 1,
      "point": {
        "x": 1.011,
        "y": -26.735
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "cargo_recipient_uthrow",
      "context": "cargo-throw",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 1,
      "nativeSample": 5,
      "point": {
        "x": -0.262,
        "y": -24.672
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "cargo_recipient_uthrow",
      "context": "cargo-throw",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 2,
      "nativeSample": 9,
      "point": {
        "x": -0.953,
        "y": -24.155
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "cargo_recipient_uthrow",
      "context": "cargo-throw",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 3,
      "nativeSample": 13,
      "point": {
        "x": 1.363,
        "y": -25.515
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "cargo_recipient_uthrow",
      "context": "cargo-throw",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 4,
      "nativeSample": 15,
      "point": {
        "x": -0.479,
        "y": -21.505
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "cargo_recipient_dthrow",
      "context": "cargo-throw",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 0,
      "nativeSample": 1,
      "point": {
        "x": -2.994,
        "y": -21.274
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "cargo_recipient_dthrow",
      "context": "cargo-throw",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 1,
      "nativeSample": 5,
      "point": {
        "x": -7.921,
        "y": -22.866
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "cargo_recipient_dthrow",
      "context": "cargo-throw",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 2,
      "nativeSample": 9,
      "point": {
        "x": -8.534,
        "y": -23.316
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "cargo_recipient_dthrow",
      "context": "cargo-throw",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 3,
      "nativeSample": 13,
      "point": {
        "x": -8.218,
        "y": -23.576
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "cargo_recipient_dthrow",
      "context": "cargo-throw",
      "profileKey": "dk-ordinary-grab-target-v1",
      "dimensions": {
        "width": 60,
        "height": 84
      },
      "artFrameIndex": 4,
      "nativeSample": 17,
      "point": {
        "x": -5.027,
        "y": -15.31
      },
      "provenance": "authored-reviewed-target"
    }
  ],
  "supportingFloor": {
    "reviewKey": "6a1c7e74e08656983ae8853b1470205cbc6c948eb83e5b3346d0f7f944d7b031",
    "recipientReviewedBottom": 42.0,
    "clearance": 0.55
  }
};
const pikachuOwnAnchors = {
  "profileKey": "pikachu-ordinary-captured-target-v1",
  "revision": "b1dd4021d9f2d2e39663ea93c5b3a05bef4f53ff9c5a157dcce1d1026bc5f638",
  "anchors": [
    {
      "poseKey": "captured",
      "context": "ordinary-held",
      "profileKey": "pikachu-ordinary-captured-target-v1",
      "dimensions": {
        "width": 40,
        "height": 50
      },
      "artFrameIndex": 0,
      "nativeSample": null,
      "point": {
        "x": 22.633333333333333,
        "y": 0.966666666666665
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "captured",
      "context": "ordinary-held",
      "profileKey": "pikachu-ordinary-captured-target-v1",
      "dimensions": {
        "width": 40,
        "height": 50
      },
      "artFrameIndex": 1,
      "nativeSample": null,
      "point": {
        "x": 13.3,
        "y": -2.3000000000000007
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "captured",
      "context": "ordinary-held",
      "profileKey": "pikachu-ordinary-captured-target-v1",
      "dimensions": {
        "width": 40,
        "height": 50
      },
      "artFrameIndex": 2,
      "nativeSample": null,
      "point": {
        "x": 17.033333333333335,
        "y": 1.4333333333333336
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "captured",
      "context": "ordinary-held",
      "profileKey": "pikachu-ordinary-captured-target-v1",
      "dimensions": {
        "width": 40,
        "height": 50
      },
      "artFrameIndex": 3,
      "nativeSample": null,
      "point": {
        "x": 16.1,
        "y": 1.4333333333333336
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "captured_hit",
      "context": "ordinary-damage",
      "profileKey": "pikachu-ordinary-captured-target-v1",
      "dimensions": {
        "width": 40,
        "height": 50
      },
      "artFrameIndex": 0,
      "nativeSample": null,
      "point": {
        "x": 21.7,
        "y": 0.03333333333333144
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "captured_hit",
      "context": "ordinary-damage",
      "profileKey": "pikachu-ordinary-captured-target-v1",
      "dimensions": {
        "width": 40,
        "height": 50
      },
      "artFrameIndex": 1,
      "nativeSample": null,
      "point": {
        "x": 13.766666666666667,
        "y": 1.4333333333333336
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "captured_hit",
      "context": "ordinary-damage",
      "profileKey": "pikachu-ordinary-captured-target-v1",
      "dimensions": {
        "width": 40,
        "height": 50
      },
      "artFrameIndex": 2,
      "nativeSample": null,
      "point": {
        "x": 14.233333333333334,
        "y": 0.03333333333333144
      },
      "provenance": "authored-reviewed-target"
    },
    {
      "poseKey": "captured_hit",
      "context": "ordinary-damage",
      "profileKey": "pikachu-ordinary-captured-target-v1",
      "dimensions": {
        "width": 40,
        "height": 50
      },
      "artFrameIndex": 3,
      "nativeSample": null,
      "point": {
        "x": 25.433333333333334,
        "y": -0.9000000000000021
      },
      "provenance": "authored-reviewed-target"
    }
  ],
  "supportingFloor": {
    "reviewKey": "05de170b8d91588c4b0be340ae3a226471ef2fc179890294fa7d7cad7ad7be76",
    "recipientReviewedBottom": 35.733333333333334,
    "clearance": 0.55
  }
};

/** Fresh owned copies for direct constructors, normal factory and Lab defaults. */
export function getDefaultCaptureAttachmentCalibration(id: string): CaptureAttachmentCalibration | null {
  if (id === 'donkeykong') return parseCaptureAttachmentCalibration(donkeykongIdentity, 'defaultDonkeyKongCaptureAttachment');
  if (id === 'pikachu') return parseCaptureAttachmentCalibration(pikachuOwnAnchors, 'defaultPikachuCaptureAttachment');
  return null;
}
