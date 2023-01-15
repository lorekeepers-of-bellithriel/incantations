import { LogLevels, Scribe } from "@lorekeepers-of-bellithriel/scribe";
import skata from "../dev_cache/dist/main.cjs";

const scribe = new Scribe({ level: LogLevels.All });

scribe.inspect("kappa", skata.kappa);
