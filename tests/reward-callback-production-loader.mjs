import fs from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const sourceRoot = path.join(root, "src");
const dbShim = pathToFileURL(path.join(import.meta.dirname, "reward-callback-test-db.mjs")).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default undefined" };
    }
    if (specifier === "@/lib/db") {
      return { shortCircuit: true, url: dbShim };
    }
    if (specifier === "next/server") {
      return { shortCircuit: true, url: pathToFileURL(path.join(root, "node_modules", "next", "server.js")).href };
    }
    if (specifier.startsWith("@/")) {
      const relative = specifier.slice(2);
      for (const extension of [".ts", ".tsx", ".js", ".mjs"]) {
        const candidate = path.join(sourceRoot, relative + extension);
        if (fs.existsSync(candidate)) {
          return { shortCircuit: true, url: pathToFileURL(candidate).href };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
