# 3D Studio

3D Studio turns SVG icons, logos and imported meshes into still images and turntables. Start with **Guided** controls, then choose **Expert** to edit the same scene in more detail.

## Make a first image

1. Open **3D Studio** and try the two-colour sample badge.
2. Under **Start**, choose **SVG artwork**, **A 3D model** or **Words in the brand font**. Use the asset picker to select or upload an SVG, GLB or STL. Uploads are stored on this device for reuse.
3. Under **Look**, choose a lighting studio. Keep the source materials, or apply a colour pair and choose a finish for each colour.
4. Choose **Fit object**, drag the preview to orbit, or use the arrow keys while it has focus. Shift moves in larger steps. **Reset camera** restores the starting camera; undo and redo recover each action.
5. For SVG artwork, adjust **Depth** and **Bevel** under **Shape**. Small details need a smaller bevel.
6. Choose the image contents under **Output**, then export.

Use **Object with transparent shadow** and PNG for an object you can place over another background. **Object only** removes the cast shadow too. JPEG has no transparency. The export panel's size, scale and DPI settings render the scene again at that pixel size, up to 4096 pixels per side and 12 million pixels, so a large export carries real detail rather than an enlarged preview. A video or GIF frame takes **Clip samples** (16 by default) rather than the still's render samples, because motion hides sampling noise and a clip is hundreds of frames; raise it for a smoother depth of field at the cost of export time.

## Light, materials and depth

The lighting studios include soft, dramatic, cool and warm starting points. Contrast changes the balance between key and fill light. Shadow softness changes the apparent source size. Exposure adjusts the final image brightness.

Finishes go beyond matte, satin, enamel and metal: **Chrome** is a mirror; **Clay** is a soft dead matte; **Velvet** adds the fuzz of fabric at grazing angles; **Glow** and **Neon** light a region in its own colour, Neon more strongly; **Glass** and **Frosted glass** let light through, so they belong in a complete scene, and a transparent output shows them as solid crystal and says so in the notes; **Pearl** and **Iridescent** shift colour with the viewing angle. Every finish is available per region, per face, bevel and side, and as a named finish on a material override.

An SVG keeps each visible solid colour as a separate material slot. Its paint order is resolved before extrusion so overlapping paths do not flicker. The two finish controls alternate across those slots. Enable **Separate face, bevel and side finishes** to give each colour region a matte face, polished bevel or metallic side. Each surface can inherit its region finish. These assignments apply to SVG artwork and the sample badge; imported meshes keep their authored surface layout. A GLB in **Keep source materials** mode retains its authored materials and textures.

Turn on **Depth of field** to soften objects away from the camera's focus distance. **Foreground and background forms** adds opaque forms at different sizes and distances in front of and behind the subject. **Depth forms** chooses what they are: copies of the subject, which reuse its geometry, materials and colours at other sizes and angles, or soft spheres in the brand colours. **Depth spread** keeps them near the subject at 0 and pushes them far in front of and behind it at 1; Expert mode also sets the number of forms. The arrangement follows the saved seed, so it reproduces exactly, and the forms appear in scene images only. This is a camera effect on real geometry. Higher render sample counts make the blur and shadows smoother. With depth of field enabled, choose **Pick focus** and click the subject. A missed click keeps the current focus; Escape cancels picking. **Auto focus** follows the camera target again. Expert mode also accepts a numerical focus distance.

Under **Stage**, choose a background colour, gradient or image. A PNG made with Backdrop can supply the visible background. A background image does not become a lighting environment.

## Promotional backdrops

The quickest route to an animated backdrop is a template: **Wordmark backdrop** sets your words in the brand font, **Icon backdrop** starts from an icon (swap in your own SVG under Start), and a SUSE install adds the SUSE wordmark and icon versions. Each combines the dramatic studio, copies of the subject drifting in depth, orbiting lights and a slow looping camera move, so the first export as video or GIF is already a finished loop. Change the words or the icon, adjust the depth spread and the camera keys, then export.

## Words in the brand font

Choose **Words in the brand font** under **Start with** and type the words, up to eight lines. **Font** offers the brand roles, brand sans, display and mono, plus any font added under Brand fonts; **Weight** picks the instance, and Expert mode adds letter spacing, line height and alignment. Words face the camera by default, because a wordmark reads best square to the lens; **Pose** applies the object rotation from Camera instead. The letters are shaped on this device by the same engine that outlines text in exports, so ligatures and kerning are the font's own, and the outlines are extruded and bevelled exactly like artwork. Words are one material region and take colour A. A role the brand does not define falls back to its main face, and a font that is not available on this device says so rather than substituting silently.

In an arrangement, a **Words** row sets its own text and shares the scene's font settings, so a title and an icon cluster sit together under one light.

## Move the camera

A still image holds the view you compose. For motion, orbit to a first view and choose **Add camera key** on the preview, then orbit to the next view and add another. Two keys make a move; up to twelve make a path. **Play path** plays it in the preview, and the export panel offers the clip as video or GIF at the loop length. Choose **Hold the current view** (or Play path again) to compose the next key while the picture stands still; the saved keys stay.

Under **Motion**, each key lists the moment it is reached as a percentage of the loop, its angle, field of view, zoom, target and focus distance, so every value can be typed. Keys are spaced evenly when added. **Camera easing** slows into and out of each move, flows through every key with continuous speed, or keeps a constant speed. **Return to the first key** closes the loop for a GIF. A camera path, a turntable and animated lights combine over the same loop seconds.

## Place the lights

Choose **Move lights** on the preview to see each studio light as a coloured handle with a line to the subject. Drag a handle to orbit that light around the subject at its current distance. With the preview focused, the arrow keys turn the selected light, plus and minus bring it closer or push it further away, and the square brackets select the previous or next light. Shift makes larger turns. Each step is one undo entry. Escape returns the preview to camera orbiting.

A preset studio remembers moved lights as **Key light position**, **Fill light position** and **Rim light position** under Lighting in Expert mode; the key reflection card follows the key light. A custom rig writes the moved light's own row. Handles appear in the preview only and never in an export.

## Lighting environments

Under **Lighting**, the **Lighting environment** supplies soft illumination and reflections. The generated environments are built on this device and need no file: **Studio room**, **Photo studio**, **White gallery**, **Soft box** and **Window light** for product work; **Warehouse** for a daylit industrial space with a brand-tinted accent wall; **Main stage** for coloured spotlights in colour A and colour B with an accent-coloured screen behind; **Desert chrome** for the classic blue sky and sand reflection; and **Synthwave chrome** for a neon grid in colour A under a striped sun in colour B. Change the brand colours and the coloured environments rebuild. **Environment brightness** scales the environment's effect on illumination and reflections together, and **Environment rotation** turns it to place highlights. This renderer does not split illumination from reflections. **Show the environment behind the scene** works for every environment; a painted one shows crisp at zero **Background blur**.

Choose **Imported radiance map** to light the scene with your own equirectangular panorama. Upload a Radiance `.hdr` or OpenEXR `.exr` file through the asset picker. The file is checked by its bytes: a PNG or JPEG is a display image and is refused, because it cannot light a scene. The map is decoded as linear radiance, filtered once for reflections, and exposure is applied only at delivery. **Show the map behind the scene** draws the same map, softened by **Background blur**, behind a scene image; transparent outputs keep the map for lighting and reflections and never draw it. The uploaded bytes stay on the asset rail, so an editable `.lolly` file carries them to another device.

Radiance maps are limited to 64 MB and 8192 by 4096 pixels. Maps narrower than 512 pixels are replicated pixel for pixel before filtering. Image-based light does not cast shadows of its own: the studio's directional and spot lights remain the shadow sources.

## Colour and alpha

Colour A and colour B are material colours, not output pixels. Lighting, finish and exposure all change how they render, so a lit face in colour A comes out lighter or darker than its swatch. A colour A edit reaches words and STL models straight away, without reloading the source.

The stage background is part of the scene. A solid, gradient or image background passes through the same tone mapping and exposure as the subject, so it does not export as its exact swatch. At the default exposure of 1.1, a solid `#30ba78` background renders as `#61c992`; Chromium's software renderer (SwiftShader) and Metal on an Apple M4 both gave that value. The background also tints a soft fill light from below, with colour A from above, so changing the background changes the subject's shading slightly.

**Object only** and **Object with transparent shadow** keep their transparency in PNG, WebP and AVIF. The other formats fill the transparent areas:

- JPEG has no alpha channel.
- TIFF flattens them onto white.
- WebM and MP4 flatten every frame onto white.
- GIF, with the default settings, turns them black, so a black transparent shadow disappears. For a GIF, choose **Complete scene** under Output with the background you want.

## Shape quality and framing

The studio keeps the SVG outline at the sidewall and contracts the faces for an inward bevel. Before it builds the bevel, it follows the contracted outline and holes through every bevel step and checks three things: no edge reverses, no outline or hole collapses and no two edges touch or cross, which includes a hole growing past its outline. A requested size that fails is halved until it passes; bevel thickness is also limited to half the extrusion depth. Rings, letter counters and other shapes with curved holes keep their full bevel wherever the geometry allows it; a bevel is reduced only where a narrow or sharp detail would really fold. The one exception is a shape that would pass one million triangles once bevelled: it is extruded without a bevel. **Source notes** reports every reduction with the requested and applied sizes and correction guidance. The saved requested size stays intact, so changing the source or depth re-evaluates it.

**Fit object** centres the current transformed subject with a margin at the current image aspect ratio. It preserves the viewing angle and perspective field of view. The camera's target offsets record that framing relative to the expert camera target. Fit again after changing the output proportions or object pose. Camera gestures, fit, reset and focus picking use the normal undo history and saved session values.

## Expert controls

Expert mode exposes object transforms, perspective or orthographic projection, camera target and focus distance, individual light strengths and colours, reflection settings, and export sample count. Switching back to Guided preserves those values.

Choose **Custom lights** to build a rig with up to eight directional, point, spot or rectangular area lights. Up to four lights can cast shadows. Lights aim toward the centre of the studio. Rectangular area lights provide illumination and reflections; the other light types provide cast shadows. **Move lights** on the preview places any of them by dragging.

Choose **Override selected slots** to set colour, roughness, metalness and clear coat for individual materials. Open **Material slots and source notes** on the preview to find their names or numbers. A colour override replaces that slot's colour texture. Unselected GLB materials stay intact.

In colour-pair mode, **Material A slot** and **Material B slot** bind those finishes to exact source names or numbers. Leave both empty to alternate the pair across source slots. With explicit bindings, other slots keep their original materials. A missing slot or two roles pointing at the same slot produces an error.

Orthographic projection keeps parallel edges parallel and does not use photographic depth of field. For consistent icon sets, keep the camera, scale, lighting and material assignments together as one saved starting point.

## Arrange several objects in one scene

Choose **Several objects together** under **Start with** to photograph a group: an icon cluster, a product lineup, or a hero object with supporting pieces. The quickest way in is **Add objects** on the preview: the library opens and stays open, every SVG icon, logo or 3D model you choose becomes an object, and when you select Done the group is framed. Dropping SVG, GLB or STL files onto the **Objects** list, or using its choose-files button, does the same from your own files. Each newcomer is named after its file, sized like the objects already there, and placed in the next free spot beside them. **Add object** adds one row of a chosen kind; an artwork or model row shows its own file picker and waits, without disturbing the scene, until a file is chosen. Each row is one SVG, GLB, STL or sample shape with its own position, rotation, scale, **Rest on the stage** and **Visible** switches. Lighting, colours, finishes, extrusion, stage and camera are shared, so the group reads as one photograph. An arrangement holds up to 16 objects and one million visible triangles in total; objects that name the same file share its loaded geometry.

The preview toolbar groups its controls: **Orbit**, **Move objects** and **Move lights** choose what a drag does; **Frame all**, **Fit selected** and **Reset camera** frame the picture; the focus controls appear when depth of field is on. A plain click on an object selects it in any mode, and the selection reads in the status pill. **Selected object** in the sidebar names the same row. In **Move objects** a drag moves the selection across the stage, the arrow keys nudge it, comma and full stop turn it, and the square brackets select the previous or next object. Shift makes larger steps. Every drag and key press is one step in the normal undo history and has a numerical equivalent in the row. Escape returns to Orbit. **Frame all** fits the whole group; **Fit selected** fits one object.

Objects rest on the stage by default; turn **Rest on the stage** off to keep an object centred on its own pivot so it can float or sink, and use **Lift Y** in both cases. **Source notes** reports the visible object count, the triangle total, the selected object's material slots and any pair of objects whose volumes overlap by more than a small margin, so an intersection is never a surprise. A turntable turns the whole group about the centre of its footprint. Focus picking and the transparent shadow work across every object, and a broken file names the object it belongs to.

In Expert mode each row can bind its own material A and B slots and carry a **Stable id**, which survives reordering for automation and saved overrides. Object transforms under **Camera** apply to single-object scenes only; an arrangement carries them per row.

## Build and review a collection

Choose **A collection** under **Start with**. The sample badge, sphere and box provide a starting set. Replace them, drop several SVG or model files onto **Collection items** to add them at once, or use **Add item**, and give each a useful name. A collection holds up to 24 items.

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

Set **Motion** to **Turntable** for a rotating object, and see Move the camera above for camera paths. **Light motion** independently animates the studio: **Orbit the studio** sweeps the rig around the object and back; **Gently breathe** varies its intensity. Moving sources affect illumination, reflections and cast shadows. Brand light colours stay intact.

**Light motion amount** controls the sweep or intensity range. **Loop seconds** controls both object and light timing and supplies the initial clip length. The export panel lets you override how much to record. The lights return to their starting position and intensity at each loop boundary. A turntable closes its object pose only when its turn angle is a whole number of rotations.

## Current limits

- SVG: up to 1 MB, 128 paths and 16 solid colours. Convert text, linked content, filters, masks, gradients and transformed or dashed strokes to plain filled paths first. Very narrow or acute features may need a smaller bevel or no bevel.
- Models: self-contained glTF 2.0 GLB or STL, up to 32 MB and one million triangles. Export GLB without Draco, Meshopt or KTX2 compression. Embedded textures may be up to 8192 pixels per side. Model animation clips are not played.
- STL supplies a visual mesh. The studio normalizes its size for photography and does not infer print units or certify a printable object. Native CAD documents must first be exported as a supported mesh.
- Output: SDR rendering, up to 4096 pixels per side and 12 million pixels total. Preview uses fewer samples than export. A WebGL2 device with float render targets is required.
- Arrangements: up to 16 objects and one million visible triangles. Objects share one extrusion depth and bevel. Separate render passes and editable mesh export are not yet available.
- Environments: Radiance `.hdr` and OpenEXR `.exr` up to 64 MB and 8192 by 4096 pixels. Illumination and reflections share one strength, and image-based light casts no shadows of its own.

Lighting is rasterized with sampled shadows and a reflection environment. It does not simulate full path-traced light transport. Transparent shadows retain the saved camera and ground plane; they do not relight another image after export.
