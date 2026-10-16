/** Entry point for `node --import ./tools/register.mjs ...`.
 *  Shared by the eval harness and the data-layer tests: both run lib/*.js in
 *  plain Node, and neither should own the other's loader. */
import { register } from "node:module";
register("./esm-compat.mjs", import.meta.url);
