# One-call OCR review

After local OCR, the operator can mark logos, inspect the local preview and explicitly request an API review. One request sends the flattened masked image bundle and bounded weld/BOM candidates to the selected configured provider. The result is shown as suggestions on the sheet; neither OCR data nor the register is changed automatically. The separate full extraction workflow remains available.

The review uses one provider invocation instead of the full extraction's multiple passes and does not automatically retry on a 502 or 504. Actual token usage and cost depend on the images, response, model and provider; no savings or accuracy rate has been measured. The full image and all prepared tiles are sent, so this is not a text-only workflow. Users must mark every logo: detection is manual and direct API clients are responsible for their own masks. Other drawing information and OCR candidates can be sent externally.

The server bounds candidate fields, requires complete JSON with valid normalized coordinates, and refuses truncated or invalid replies. The model can still miss marks or put a valid coordinate in the wrong location. Suggestions are not engineering decisions, and the engineer must verify them. API access, usage accounting and project limits use the existing extraction route. No migration is needed.
