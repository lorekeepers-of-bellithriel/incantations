import { Scribe, LogLevels } from "@lorekeepers-of-bellithriel/scribe";
import { build } from "esbuild";

const scribe = new Scribe({ level: LogLevels.All });

scribe.inspect("skata", process.argv);

try {
    const res = await build({
        entryPoints: ["dev_cache/main.ts"],
        outfile: "dev_cache/main.js",
    });
    scribe.inspect("res", res);
} catch (err) {
    scribe.error("build error", err);
} finally {
    scribe.info("noice!");
}
