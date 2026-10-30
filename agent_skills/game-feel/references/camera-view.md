# Fixed camera views for code video pairs

Use this contract when an agent generates scene code plus a camera configuration
for a batch of rendered videos. Each video uses the same fields and conventions.
The scene can animate; the camera is fixed for the whole clip. An interactive
tuning UI, follow response, orbit animation and gameplay action director are not
required production inputs. Keep playable-camera behavior in the main skill.

## Author the same camera format for every scene

Validate `camera_view.json` against
[`camera-view.schema.json`](../assets/camera_view/camera-view.schema.json).
Use the executable reference
[`camera-view.mjs`](../assets/camera_view/camera-view.mjs) with the scene's own
Three.js module; it does not import another engine or the playable framework.

```json
{
  "schema_version": "1.0",
  "coordinate_system": "Y_UP_RIGHT_HANDED",
  "projection": {
    "type": "perspective",
    "fov_y_deg": 40,
    "near": 0.1,
    "far": 200
  },
  "pose": {
    "target": [0, 1, 0],
    "azimuth_deg": 45,
    "elevation_deg": 30,
    "distance": 20
  },
  "framing": {
    "required_targets": ["actor"],
    "safe_margin": 0.05
  }
}
```

The numbers are an example, not universal scene defaults. Choose a target and
distance from the scene's scale and motion bounds. `target` is a fixed world
point; `required_targets` are named scene objects checked for framing, not
objects that the camera automatically follows. Omitted `framing` resolves to an
empty target list and a 0.05 margin; archive that resolved configuration.

Conventions:

- Right-handed world coordinates, Y up; all distances use scene world units,
  without assuming meters. Convert other axis conventions in an engine adapter.
- Angles are degrees. Azimuth 0 places the camera on the target's +Z side;
  +90 places it on the +X side. Positive elevation places it above the target.
- Perspective `fov_y_deg` is vertical FOV. For `orthographic`, replace that field
  with positive `vertical_size`; horizontal size is `vertical_size * aspect`.
  Do not include both lens fields.
- `near < far`; perspective near must be positive, orthographic near may be zero.
  Values must be finite. Reject unknown fields and unsupported schema versions.
- `safe_margin` is the fraction reserved at each edge, e.g. 0.05 means 5% on all
  four sides. Changing aspect ratio requires checking framing again.

The runtime computes position from the target, distance and spherical angles,
sets world up to `[0,1,0]`, then calls `lookAt(target)`. Store the resolved view
before recording. If a preparation step estimates distance from sampled bounds,
write the resulting distance into the config; do not hide a moving auto-fit
controller behind the fixed-view contract.

## Keep scene generation separate from camera application

Have scene code export `createScene()` returning `{ scene, update(t) }`, where
`t` is seconds and the scene can reproduce a requested time. An existing scene
may also return a camera; use the camera built from the independent view config
for recording, so scene-specific camera code cannot override the batch setting.

```js
import { buildCamera } from './camera-view.mjs';

const { scene, update } = createScene();
const { camera, view } = buildCamera(THREE, cameraConfig, width / height);
for (let i = 0; i < durationSeconds * fps; i++) {
  update(i / fps);
  scene.updateMatrixWorld(true);
  renderer.render(scene, camera);
  // Capture this frame; do not update the camera pose in the loop.
}
```

Settle async scene assets before recording. Preserve scene simulation, lighting,
materials and seed when comparing two camera configs. If scene updates are
history-dependent, reset and replay at a fixed step rather than claiming direct
seeking is deterministic.

## Batch task boundary

Use one JSONL row per video. The accompanying
[`render-job.schema.json`](../assets/camera_view/render-job.schema.json) describes
the task boundary: `sample_id`, `scene_entry`, `three_entry`, `camera_view`,
`render` and `output_dir`. Paths are relative to the batch project root.

`render` contains width, height, fps and duration_sec. Require an integer
`duration_sec * fps`; sample `i / fps` for `i = 0 ... frame_count - 1`, with no
duplicate endpoint frame. These are video settings, not camera parameters.
The supplied schema caps the initial runner at 1920x1080, 120 fps and 60 seconds;
change those runner limits explicitly when the production environment requires it.

Resolve paths inside the intended workspace, keep output directories separate
from source directories, reject duplicate sample IDs/output paths in a batch,
and report failures per sample. Validate configurations before starting expensive
rendering. Do not silently replace invalid views with an arbitrary default.

## Evidence and archive

Check the final camera matrix is constant across the clip, scene matrices are
finite, encoded dimensions/fps/frame count match the task, and repeated renders
at the same time agree in the same rendering environment. Cross-machine video
byte identity is not a default requirement.

Use [`framing.mjs`](../assets/camera_view/framing.mjs) for conservative world-AABB
projection checks. Update world matrices first. Confirm the selected objects
exist, test all recorded frames and inspect actual images for occlusion. Being
inside the frustum or having a larger projected box does not establish readable
silhouettes, better visibility or comfort. Physical bridge/tree occlusion and
trajectories beyond the scene boundary may require a scene change.

Keep the scene sources and all imported code/assets, dependency versions and
licenses, original generation provenance when available, the resolved view,
render settings, video and hashes. Record scene-source changes separately from
camera changes. Do not present a hand-adjusted camera as unchanged raw output.

Keep temporary frames/logs/cache outside the observed source workspace and final
pair package. Preserve necessary audit evidence separately. Content-addressed
storage deduplicates identical bytes, but different versions of a growing log or
validation image are distinct blobs; restrict observation scope rather than
deleting the only evidence. Verify that a materialized pair runs without the
original source workspace. CLI completion alone does not prove a valid pair or
complete agent trajectory capture.

The reference camera runtime has been exercised on two local Three.js r186
scenes with 192-frame fixed-view clips, configuration rejection and perspective
pose round trips. Orthographic construction is covered by a synthetic test.
This evidence does not establish large-scale Claude Code collection reliability
or a general visual improvement across generated scenes.
