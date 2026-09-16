# Authoring Tools

A tool is a manifest, a template and optional hooks or assets. The same inputs and render path work across Lolly’s shells. This overview helps you choose the part of authoring you need.


## Choose a guide

| Task | Guide |
| --- | --- |
| Declare identity, rendering, examples and a short walkthrough. | [Tool manifests](/info/tool-manifest.html) |
| Choose input types, visibility, profile prefills and common meanings. | [Tool inputs](/info/tool-inputs.html) |
| Build repeating groups, editor canvases and bounded image framing. | [Structured inputs and canvas controls](/info/tool-structured-inputs.html) |
| Accept library assets or local files and return transformed output. | [Assets and file utilities](/info/tool-files.html) |
| Write templates and styles that work across vector, canvas and data exports. | [Templates and rendering](/info/tool-rendering.html) |
| Provide curated starting points, saved templates and Design motion. | [Tool templates and presets](/info/tool-starters.html) |
| Add portable behavior, live media, recording, speech and allowed network access. | [Tool hooks and host capabilities](/info/tool-hooks.html) |
| Compose tools and resolve brand-specific logos and overlays. | [Composition and brand overlays](/info/tool-composition.html) |
| Validate, distribute, test and translate a reusable tool. | [Publish and localize a tool](/info/tool-publishing.html) |

## Start from a design you already have

Use [Share with rules](/info/create-a-tool.html) to turn a Design document into a constrained tool without writing a manifest. Choose editable inputs, approved options and layouts, then share one portable `.lolly`. Start from the active design system’s tokens and components, or import existing artwork and review its appearance.

A saved Design template is a starting point under Design. A tool made with Share with rules exposes only its declared inputs. Keep the master separately for revisions.

## Authoring with AI Agents

Give an agent the intended output, representative input values, the design system and source artwork. Ask it to build ordinary tool data against the manifest and host contracts, then validate and render the result. The guides below explain those contracts so you can review what it produced.

## Anatomy

```
community/your-tool-id/
├── tool.json           # required - declares inputs, outputs, identity
├── template.html       # required - Handlebars-flavoured markup
├── styles.css          # optional - auto-scoped to #tool-canvas
├── hooks.js            # optional - imperative escape hatch
├── thumb.png           # optional - gallery thumbnail (recommended)
├── templates/          # optional - curated starting points (see Tool templates and presets)
├── i18n/               # optional - <lang>.json string overlays (see Publish and localize a tool)
└── assets/             # optional - tool-local images, fonts, etc.
```

## Generate a tool from Design

Designers can author portable tools through [Share with rules](/info/create-a-tool.html) without editing a manifest. Generated tools use the normal engine and strict sideload runtime. See [Design tool contract](/info/design-tool-contract.html) for compilation, dependencies and revision semantics.
