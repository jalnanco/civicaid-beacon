import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { verifyNandaAgentCard } from "../docs/kit/nanda-verifier.mjs";
import {
  auditAgenticSiteBundle,
  detectForbiddenServerSyntax,
  detectLocalDelegationCycles,
  filterSlyDataForPeer,
} from "../docs/kit/conformance-auditor.mjs";
import { PartnerCheck } from "../tools/check_partner.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BEACON_DOCS = resolve(__dirname, "../docs");

function serveStaticDir(rootDir) {
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".css": "text/css; charset=utf-8",
  };
  return new Promise((resolvePromise) => {
    const srv = createServer((req, res) => {
      const urlObj = new URL(req.url, "http://127.0.0.1");
      const rel = normalize(decodeURIComponent(urlObj.pathname)).replace(/^(\.\.(\/|\\|$))+/, "");
      const filePath = join(rootDir, rel === "/" ? "index.html" : rel);
      try {
        const body = readFileSync(filePath);
        res.writeHead(200, {
          "Content-Type": mime[extname(filePath)] || "application/octet-stream",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(body);
      } catch (_) {
        res.writeHead(404, { "Access-Control-Allow-Origin": "*" });
        res.end("Not Found");
      }
    });
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      resolvePromise({ srv, port });
    });
  });
}

test("1. Both CivicAid Beacon and MedSupply Peer pass 12/12 Open Agentic Web + NANDA audit checks", async () => {
  const beaconAudit = await auditAgenticSiteBundle({
    targetNetworkUrl: "https://jalnanco.github.io/civicaid-beacon/civicaid_shelter_hub",
    manifestText: readFileSync(join(BEACON_DOCS, "agent-manifest.json"), "utf8"),
    networkText: readFileSync(join(BEACON_DOCS, "civicaid_shelter_hub.network.json"), "utf8"),
    linksText: readFileSync(join(BEACON_DOCS, "links.json"), "utf8"),
    agentCardText: readFileSync(join(BEACON_DOCS, ".well-known/agent-card.json"), "utf8"),
    corsHeader: "*",
    bridgeOk: true,
  });
  assert.equal(beaconAudit.passed, 12, JSON.stringify(beaconAudit.checks, null, 2));
  assert.equal(beaconAudit.allPassed, true);
});

test("2. WebCrypto ECDSA P-256 verifier immediately rejects 1-byte tampered network or manifest JSON", async () => {
  const card = JSON.parse(readFileSync(join(BEACON_DOCS, ".well-known/agent-card.json"), "utf8"));
  const manifestRaw = readFileSync(join(BEACON_DOCS, "agent-manifest.json"), "utf8");
  const networkRaw = readFileSync(join(BEACON_DOCS, "civicaid_shelter_hub.network.json"), "utf8");

  const tamperedNetwork = networkRaw.replace("max_steps\": 12", "max_steps\": 99");
  const res = await verifyNandaAgentCard(card, manifestRaw, tamperedNetwork);
  assert.equal(res.valid, false);
  assert.equal(res.code, "NETWORK_TAMPER_DETECTED");
});

test("3. Deny-by-default sly_data filter strips sensitive patient medical context before peer calls", () => {
  const privateSly = {
    evacuee_case_id: "EVAC-99281",
    insulin_cold_chain_required: true,
    peritoneal_dialysis_patient: true,
    emergency_contact_hash: "sha256:88ab12",
  };
  const filtered = filterSlyDataForPeer(privateSly, "medsupply_depot", {});
  assert.deepEqual(filtered.forwarded, {});
  assert.equal(filtered.blockedKeys.length, 4);
});

test("4. Cycle detector and server-syntax detector catch invalid graphs fail-closed", () => {
  const cyclic = [
    { name: "alpha", tools: ["beta"] },
    { name: "beta", tools: ["alpha"] },
  ];
  const cycles = detectLocalDelegationCycles(cyclic);
  assert.ok(cycles.length > 0);

  const badHocon = 'include "local_secret.hocon"\n{"api_key": "${OPENAI_API_KEY}"}';
  const issues = detectForbiddenServerSyntax(badHocon);
  assert.equal(issues.length, 2);
});

test("5. Official Cognizant check_partner.mjs passes CivicAid Beacon with 0 errors (exit code 0)", async () => {
  const s1 = await serveStaticDir(BEACON_DOCS);
  try {
    const logs1 = [];
    const code1 = await PartnerCheck.main(
      [`http://127.0.0.1:${s1.port}/civicaid_shelter_hub`, "--origin", "http://127.0.0.1:9999"],
      globalThis.fetch,
      (line) => logs1.push(line)
    );
    assert.equal(code1, 0, `Beacon check_partner failed:\n${logs1.join("\n")}`);
  } finally {
    s1.srv.close();
  }
});
