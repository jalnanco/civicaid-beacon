#!/usr/bin/env node
/**
 * Generates MIT NANDA / A2A /.well-known/agent-card.json and .well-known/nsdeploy/site.json
 * with genuine WebCrypto ECDSA P-256 signatures over canonical manifest & network SHA-256 digests.
 * Ephemeral private keys remain strictly in memory and are never written to disk.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  canonicalJson,
  sha256Sri,
  sha256Hex,
  bytesToBase64Url,
  buildSigningPayload,
  verifyNandaAgentCard,
} from "../docs/kit/nanda-verifier.mjs";

const encoder = new TextEncoder();

async function signSiteCard({
  docsDir,
  cardUrl,
  siteName,
  description,
  version,
  networkName,
  networkFile,
  did,
  skills,
}) {
  const manifestPath = resolve(docsDir, "agent-manifest.json");
  const networkPath = resolve(docsDir, networkFile);
  const manifestRaw = readFileSync(manifestPath, "utf8");
  const networkRaw = readFileSync(networkPath, "utf8");

  const manifestCanonical = canonicalJson(JSON.parse(manifestRaw));
  const networkCanonical = canonicalJson(JSON.parse(networkRaw));

  const manifestSri = await sha256Sri(manifestCanonical);
  const networkSri = await sha256Sri(networkCanonical);

  const keyPair = await globalThis.crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );

  const publicJwk = await globalThis.crypto.subtle.exportKey("jwk", keyPair.publicKey);
  delete publicJwk.d;
  publicJwk.key_ops = ["verify"];
  publicJwk.ext = true;

  const keyFingerprint = `nanda-p256-${(await sha256Hex(canonicalJson(publicJwk))).slice(0, 16)}`;
  const payload = buildSigningPayload({
    cardUrl,
    version,
    networkName,
    manifestSri,
    networkSri,
  });

  const sigBuffer = await globalThis.crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keyPair.privateKey,
    encoder.encode(payload)
  );
  const signatureB64Url = bytesToBase64Url(new Uint8Array(sigBuffer));

  const agentCard = {
    "@context": [
      "https://schema.org",
      "https://a2aproject.github.io/A2A/schema/v1",
      "https://nandaindex.org/ns/agentfacts/v1"
    ],
    "@type": "SoftwareApplication",
    protocol: "open-agentic-web-mvp-0.2+nanda-agentfacts-v1",
    name: siteName,
    description,
    url: cardUrl,
    version,
    license: "https://opensource.org/licenses/MIT",
    provider: {
      organization: "CivicAid Open Humanitarian Mesh",
      url: "https://github.com/jalnanco/civicaid-beacon"
    },
    capabilities: {
      browserExecution: true,
      declarativeNetworkJson: true,
      pluggableByokRouter: true,
      crossOriginPeerComposition: true,
      denyByDefaultSlyData: true,
      humanConfirmedWrites: true,
      webCryptoSignatureVerification: true
    },
    entrypoints: {
      manifest: `${cardUrl}agent-manifest.json`,
      network: `${cardUrl}${networkFile}`,
      links: `${cardUrl}links.json`,
      actionBridge: `${cardUrl}bridge/action-bridge.html`
    },
    authentication: {
      schemes: ["none-public-artifacts", "visitor-byok-bearer-local-only"]
    },
    skills,
    nanda_identity: {
      did,
      algorithm: "ECDSA-P256-SHA256",
      key_id: keyFingerprint,
      network_name: networkName,
      manifest_sha256_sri: manifestSri,
      network_sha256_sri: networkSri,
      signed_at: "2026-11-24T09:30:00Z",
      public_key_jwk: publicJwk,
      signature_b64url: signatureB64Url
    }
  };

  const check = await verifyNandaAgentCard(agentCard, manifestRaw, networkRaw);
  if (!check.valid) {
    throw new Error(`Self-verification failed for ${siteName}: ${check.reason}`);
  }

  const cardPath = resolve(docsDir, ".well-known/agent-card.json");
  writeFileSync(cardPath, JSON.stringify(agentCard, null, 2) + "\n", "utf8");

  const nsdeployMetaPath = resolve(docsDir, ".well-known/nsdeploy/site.json");
  writeFileSync(
    nsdeployMetaPath,
    JSON.stringify(
      {
        profile: "worldwide-agentic-web-mvp-0.2",
        site_url: cardUrl,
        exported_networks: [networkName],
        agent_card: `${cardUrl}.well-known/agent-card.json`,
        manifest_sha256_sri: manifestSri,
        network_sha256_sri: networkSri
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  console.log(`[OK] Signed ${cardPath} (key=${keyFingerprint}, verify=${check.elapsedMs}ms)`);
}

await signSiteCard({
  docsDir: "/Users/conan/contest/dp-cognizant-agenticweb/civicaid-beacon/docs",
  cardUrl: "https://jalnanco.github.io/civicaid-beacon/",
  siteName: "CivicAid Beacon — Decentralized Disaster Shelter & Triage Hub",
  description:
    "Browser-executed multi-agent humanitarian shelter coordinator with deny-by-default sly_data clinical privacy, MIT NANDA ECDSA verification, and cross-origin medical depot composition.",
  version: "0.2.0",
  networkName: "civicaid_shelter_hub",
  networkFile: "civicaid_shelter_hub.network.json",
  did: "did:web:jalnanco.github.io:civicaid-beacon",
  skills: [
    {
      id: "accessible_shelter_matching",
      name: "ADA Step-Free & Solar Microgrid Shelter Triage",
      description: "Matches household size, wheelchair access, sensory rooms, and 2-8C biologic refrigeration against live shelter bays."
    },
    {
      id: "zero_leak_sly_guard",
      name: "Deny-by-Default Clinical sly_data Audit",
      description: "Evaluates sensitive medical needs locally in the visitor's browser without transmitting PII to peer sites."
    },
    {
      id: "cross_origin_depot_composition",
      name: "Consent-Gated Cross-Origin Medical Depot Composition",
      description: "Loads and runs external humanitarian medical supply networks locally in the caller's browser after visitor approval."
    }
  ]
});

await signSiteCard({
  docsDir: "/Users/conan/contest/dp-cognizant-agenticweb/medsupply-depot-peer/docs",
  cardUrl: "https://jalnanco.github.io/medsupply-depot-peer/",
  siteName: "MedSupply Cold-Chain Relief Depot (Peer Node)",
  description:
    "Independent open agentic website publishing regional insulin cold-chain, portable dialysis, oxygen, and pediatric relief stock for peer shelter hubs.",
  version: "0.2.0",
  networkName: "medsupply_depot",
  networkFile: "medsupply_depot.network.json",
  did: "did:web:jalnanco.github.io:medsupply-depot-peer",
  skills: [
    {
      id: "cold_chain_biologics_stock",
      name: "2-8C Solar Cold-Chain Biologics Telemetry",
      description: "Reports live insulin pen, peritoneal dialysis kit, and oxygen concentrator counts with battery autonomy hours."
    }
  ]
});
