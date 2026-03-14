#!/usr/bin/env node

import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { createInterface } from "readline";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PACKAGE_JSON_PATH = resolve(__dirname, "../packages/extension/package.json");

const arg = process.argv[2] ?? "minor";
const validBumps = ["major", "minor", "patch"];
const isExplicitVersion = /^\d+\.\d+\.\d+$/.test(arg);

if (!isExplicitVersion && !validBumps.includes(arg)) {
	console.error(`Invalid argument "${arg}". Must be one of: ${validBumps.join(", ")}, or an explicit version like "1.2.3".`);
	process.exit(1);
}

function exec(cmd) {
	try {
		return execSync(cmd, { encoding: "utf8" }).trim();
	} catch (err) {
		const msg = (err.stderr ?? err.stdout ?? err.message ?? String(err)).trim();
		console.error(`Error running: ${cmd}\n${msg}`);
		process.exit(1);
	}
}

const branch = exec("git rev-parse --abbrev-ref HEAD");
if (branch !== "main") {
	console.error(`Must be on main branch to release (currently on "${branch}").`);
	process.exit(1);
}

const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8"));
const [major, minor, patch] = pkg.version.split(".").map(Number);

let newVersion;
if (isExplicitVersion) {
	newVersion = arg;
} else if (arg === "major") {
	newVersion = `${major + 1}.0.0`;
} else if (arg === "minor") {
	newVersion = `${major}.${minor + 1}.0`;
} else {
	newVersion = `${major}.${minor}.${patch + 1}`;
}

const rl = createInterface({ input: process.stdin, output: process.stdout });

const bumpLabel = isExplicitVersion ? "explicit" : arg;
rl.question(
	`Release v${newVersion} (${bumpLabel} bump from v${pkg.version})? [y/N] `,
	(answer) => {
		rl.close();

		if (answer.toLowerCase() !== "y") {
			console.log("Aborted.");
			process.exit(0);
		}

		pkg.version = newVersion;
		writeFileSync(PACKAGE_JSON_PATH, JSON.stringify(pkg, null, "\t") + "\n");
		console.log(`Updated package.json to v${newVersion}`);

		exec(`git add "${PACKAGE_JSON_PATH}"`);
		exec(`git commit -m "Update version to ${newVersion}"`);
		exec(`git tag v${newVersion}`);
		exec("git push origin main");
		exec(`git push origin v${newVersion}`);

		console.log(`Released v${newVersion}`);
	}
);
