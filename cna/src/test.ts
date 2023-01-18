import { LogLevels, Scribe } from "@lorekeepers-of-bellithriel/scribe";
import skata from "main";

const scribe = new Scribe({ level: LogLevels.All });

scribe.inspect("kappa", skata.skata);
