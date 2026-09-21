/** Entry point for `node --import ./eval/register.mjs ...`. */
import { register } from "node:module";
register("./resolve-hook.mjs", import.meta.url);
