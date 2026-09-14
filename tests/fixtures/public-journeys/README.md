# Public-user journey fixtures

These synthetic inputs belong to plan 248. Northstar is a fictional brand; the files contain no company assets or personal information.

- QR destination: `https://example.org/welcome`.
- Brand name: Northstar. Primary blue: `#0067B1`. Secondary yellow: `#FFC72C`. Ink: `#172B4D`. Paper: `#FFFFFF`.
- `brand.tokens.json`: minimal tokens for the import journey.
- `welcome.svg`: editable text and shapes. Change the headline to `Northstar open day`.
- `welcome.png`: small raster copy for image-picker checks.
- Project folder: `Northstar launch`. Template: `Northstar announcement`. Second creation: `Northstar next event`.

For the known-colours journey, provide only the brand name and colour values above. Do not import either fixture or supply a `.lolly` file. Enter both supplied colours exactly, create an asset, then close and reopen the app to check that the setup survives. A generated complementary colour is not a substitute for the supplied secondary colour.

Run against an isolated `lolly-start` process with no private brand pack or prior Lolly state. Reviewer walkthroughs and automated checks are not external-user observations.

Use [the participant sheet](PARTICIPANT.md) for uncoached observation and [the reviewer record](REVIEW.md) for findings and remaining checks.
