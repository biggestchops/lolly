# HDR editing implementation

The current user contract, formats, precision and limits are documented in [Wide colour and HDR editing](../docs/hdr-editing.md).

The `deep-*` engine modules own bounded original-byte decode, transfer functions, linear composition and output encoding. Platform codecs and byte access are injected by `deep-codec-api.ts`. The web shell owns DOM plate capture, original video-plane access and the float canvas adapter. Tools hand real float frames to the ordinary export pipeline through `exportStill`; metadata and credentials remain the shell's responsibility.
