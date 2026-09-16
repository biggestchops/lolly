# 3D Studio

3D Studio turns SVG icons, logos and imported meshes into still images and turntables. Start with **Guided** controls, then choose **Expert** to edit the same scene in more detail.

## Make a first image

1. Open **3D Studio** and try the two-colour sample badge.
2. Under **Start**, choose **SVG artwork** or **A 3D model**. Use the asset picker to select or upload an SVG, GLB or STL. Uploads are stored on this device for reuse.
3. Under **Look**, choose a lighting studio. Keep the source materials, or apply a colour pair and choose a finish for each colour.
4. Choose **Fit object**, drag the preview to orbit, or use the arrow keys while it has focus. Shift moves in larger steps. **Reset camera** restores the starting camera; undo and redo recover each action.
5. For SVG artwork, adjust **Depth** and **Bevel** under **Shape**. Small details need a smaller bevel.
6. Choose the image contents under **Output**, then export.

Use **Object with transparent shadow** and PNG for an object you can place over another background. **Object only** removes the cast shadow too. JPEG has no transparency.

## Light, materials and depth

The lighting studios include soft, dramatic, cool and warm starting points. Contrast changes the balance between key and fill light. Shadow softness changes the apparent source size. Exposure adjusts the final image brightness.

An SVG keeps each visible solid colour as a separate material slot. Its paint order is resolved before extrusion so overlapping paths do not flicker. The two finish controls alternate across those slots. Enable **Separate face, bevel and side finishes** to give each colour region a matte face, polished bevel or metallic side. Each surface can inherit its region finish. These assignments apply to SVG artwork and the sample badge; imported meshes keep their authored surface layout. A GLB in **Keep source materials** mode retains its authored materials and textures.

Turn on **Depth of field** to soften objects away from the camera's focus distance. **Foreground and background forms** adds opaque forms at different sizes and distances in front of and behind the subject. This is a camera effect on real geometry. Higher render sample counts make the blur and shadows smoother. With depth of field enabled, choose **Pick focus** and click the subject. A missed click keeps the current focus; Escape cancels picking. **Auto focus** follows the camera target again. Expert mode also accepts a numerical focus distance.

Under **Stage**, choose a background colour, gradient or image. A PNG made with Backdrop can supply the visible background. A background image does not become a lighting environment. Reflection strength and rotation have their own expert controls.

## Shape quality and framing

The studio keeps the SVG outline at the sidewall and contracts the faces for an inward bevel. It checks the cap triangles throughout that contraction. A bevel that folds or erases a thin detail is reduced until it passes; bevel thickness is also limited to half the extrusion depth. **Source notes** reports the requested and applied sizes with correction guidance. The saved requested size stays intact, so changing the source or depth re-evaluates it.

**Fit object** centres the current transformed subject with a margin at the current image aspect ratio. It preserves the viewing angle and perspective field of view. The camera's target offsets record that framing relative to the expert camera target. Fit again after changing the output proportions or object pose. Camera gestures, fit, reset and focus picking use the normal undo history and saved session values.

## Expert controls

Expert mode exposes object transforms, perspective or orthographic projection, camera target and focus distance, individual light strengths and colours, reflection settings, and export sample count. Switching back to Guided preserves those values.

Choose **Custom lights** to build a rig with up to eight directional, point, spot or rectangular area lights. Up to four lights can cast shadows. Lights aim toward the centre of the studio. Rectangular area lights provide illumination and reflections; the other light types provide cast shadows.

Choose **Override selected slots** to set colour, roughness, metalness and clear coat for individual materials. Open **Material slots and source notes** on the preview to find their names or numbers. A colour override replaces that slot's colour texture. Unselected GLB materials stay intact.

In colour-pair mode, **Material A slot** and **Material B slot** bind those finishes to exact source names or numbers. Leave both empty to alternate the pair across source slots. With explicit bindings, other slots keep their original materials. A missing slot or two roles pointing at the same slot produces an error.

Orthographic projection keeps parallel edges parallel and does not use photographic depth of field. For consistent icon sets, keep the camera, scale, lighting and material assignments together as one saved starting point.

## Build and review a collection

Choose **A collection** under **Start with**. The sample badge, sphere and box provide a starting set. Replace them or add SVG artwork and GLB/STL models under **Collection items**, and give each a useful name. A collection holds up to 24 items.

Lighting, colours, finishes, background and camera settings are shared. **Preview item** chooses the object on the main canvas. Dragging that preview records a framing override for that item. Its row then exposes its own camera numbers and target offsets. Fit and Reset also affect only that item. Focus picking records a separate per-item focus override; turn off **Own focus distance** to use the shared focus again. **Use shared framing** removes the override. In Expert mode, each row can also map its source slots to the shared material pair.

Open **Review collection** to see a contact sheet. Its controls edit the same shared studio and refresh the previews. **Edit** opens one item on the main canvas. Failed sources are identified by item and must be fixed before exporting from the review.

**Export PNG set** renders every item at **Collection image size** and the saved render sample count. It captures a snapshot of the current settings, so edits during the job apply to the next export. Numbered names keep repeated or unusual item names distinct. The existing batch job provides progress, cancellation and download recovery; cancellation stops subsequent items after the current render settles.

The contact sheet shows the start of the animation loop at reduced quality. PNG-set delivery renders that same starting moment. Export the selected item as video for motion.

## SUSE models

The SUSE brand pack adds Geeko, Geeko on a branch and Geeko sitting to the model library. Open their studio templates or **Geeko model collection** to review all three with shared lighting. The models retain their original materials by default. They are available when the SUSE brand pack is installed.

## Save and reuse

Save the scene as a session to reopen it, or use **Save as a template** for a reusable starting point. Asset selections refer to stored files. A share link carries settings and asset references; use an editable `.lolly` file when another device also needs your uploaded assets.

Lolly's batch workflow renders the same studio. Create rows with the same lighting, material and camera values, varying `artwork` or `modelAsset`. Save separate framing overrides where an object's shape needs them. A template provides a common starting point; later edits to it do not automatically change existing sessions.

Use **Make variants** for side-by-side editing. Its shared controls change the selected sessions together. Activate a cell to orbit its scene; the other cells retain still previews.

## Animate objects and lights

Set **Motion** to **Turntable** for a rotating object. **Light motion** independently animates the studio: **Orbit the studio** sweeps the rig around the object and back; **Gently breathe** varies its intensity. Moving sources affect illumination, reflections and cast shadows. Brand light colours stay intact.

**Light motion amount** controls the sweep or intensity range. **Loop seconds** controls both object and light timing and supplies the initial clip length. The export panel lets you override how much to record. The lights return to their starting position and intensity at each loop boundary. A turntable closes its object pose only when its turn angle is a whole number of rotations.

## Current limits

- SVG: up to 1 MB, 128 paths and 16 solid colours. Convert text, linked content, filters, masks, gradients and transformed or dashed strokes to plain filled paths first. Very narrow or acute features may need a smaller bevel or no bevel.
- Models: self-contained glTF 2.0 GLB or STL, up to 32 MB and one million triangles. Export GLB without Draco, Meshopt or KTX2 compression. Embedded textures may be up to 8192 pixels per side. Model animation clips are not played.
- STL supplies a visual mesh. The studio normalizes its size for photography and does not infer print units or certify a printable object. Native CAD documents must first be exported as a supported mesh.
- Output: SDR rendering, up to 4096 pixels per side and 12 million pixels total. Preview uses fewer samples than export. A WebGL2 device with float render targets is required.
- One primary object per scene. Object arrangements, separate render passes, imported HDR lighting environments and editable mesh export are not yet available.

Lighting is rasterized with sampled shadows and a reflection environment. It does not simulate full path-traced light transport. Transparent shadows retain the saved camera and ground plane; they do not relight another image after export.
