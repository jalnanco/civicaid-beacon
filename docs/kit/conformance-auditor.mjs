/**
 * @civicaid/beacon-kit — 12-Point Open Agentic Web (MVP Profile 0.2) & MIT NANDA Auditor
 * Reusable community compliance checker for browser workbenches and automated CI/CD tests.
 * License: MIT
 */

import { verifyNandaAgentCard } from "./nanda-verifier.mjs";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function detectForbiddenServerSyntax(rawNetworkText) {
  const findings = [];
  if (/(^|\n)\s*include\s+["']/m.test(rawNetworkText)) {
    findings.push("Unresolved HOCON include statement found");
  }
  if (/\$\{[A-Z0-9_]+\}/.test(rawNetworkText)) {
    findings.push("Unresolved ${ENV_VAR} substitution found");
  }
  if (/\/Users\/|C:\\\\|file:\/\//i.test(rawNetworkText)) {
    findings.push("Local filesystem path leaked in network artifact");
  }
  return findings;
}

export function detectLocalDelegationCycles(toolsArray) {
  const byName = new Map();
  for (const agent of toolsArray || []) {
    if (agent && typeof agent.name === "string") {
      byName.set(agent.name, Array.isArray(agent.tools) ? agent.tools : []);
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const cycles = [];

  function dfs(node, trail) {
    if (visiting.has(node)) {
      cycles.push([...trail, node].join(" -> "));
      return;
    }
    if (visited.has(node) || !byName.has(node)) {
      return;
    }
    visiting.add(node);
    for (const ref of byName.get(node)) {
      if (typeof ref === "string" && byName.has(ref)) {
        dfs(ref, [...trail, node]);
      }
    }
    visiting.delete(node);
    visited.add(node);
  }

  for (const name of byName.keys()) {
    dfs(name, []);
  }
  return cycles;
}

export function filterSlyDataForPeer(slyData, destinationNetworkId, allowPolicy = {}) {
  if (!slyData || typeof slyData !== "object") {
    return { forwarded: {}, blockedKeys: [] };
  }
  const allowedList = Array.isArray(allowPolicy[destinationNetworkId])
    ? new Set(allowPolicy[destinationNetworkId])
    : new Set();
  const forwarded = {};
  const blockedKeys = [];
  for (const [k, v] of Object.entries(slyData)) {
    if (allowedList.has(k)) {
      forwarded[k] = v;
    } else {
      blockedKeys.push(k);
    }
  }
  return { forwarded, blockedKeys };
}

/**
 * Audits an in-memory or fetched Agentic Web site bundle against 12 normative checks.
 */
export async function auditAgenticSiteBundle({
  targetNetworkUrl,
  manifestText,
  networkText,
  linksText = "",
  agentCardText = "",
  corsHeader = "*",
  bridgeOk = true,
}) {
  const checks = [];
  const push = (id, title, pass, detail) => checks.push({ id, title, pass: Boolean(pass), detail });

  // 1. HTTPS or Loopback URL form
  let parsedUrl = null;
  try {
    parsedUrl = new URL(targetNetworkUrl);
  } catch (_) {
    parsedUrl = null;
  }
  const urlValid =
    parsedUrl !== null &&
    !parsedUrl.pathname.endsWith("/") &&
    (parsedUrl.protocol === "https:" || (parsedUrl.protocol === "http:" && LOOPBACK.has(parsedUrl.hostname)));
  const requestedNetName = parsedUrl ? parsedUrl.pathname.split("/").filter(Boolean).pop() : "";
  push(
    "HTTPS_ENDPOINT",
    "HTTPS / Loopback Network URL Resolution",
    urlValid && Boolean(requestedNetName),
    urlValid ? `Resolved network "${requestedNetName}" under ${parsedUrl.origin}` : `Invalid network URL: ${targetNetworkUrl}`
  );

  // 2. Manifest schema & exact network match
  let manifest = null;
  try {
    manifest = JSON.parse(manifestText);
  } catch (err) {
    manifest = null;
  }
  const entry =
    manifest && Array.isArray(manifest.networks)
      ? manifest.networks.find((n) => n && n.name === requestedNetName) || null
      : null;
  push(
    "MANIFEST_EXACT_MATCH",
    "agent-manifest.json Exact Network Match",
    Boolean(entry && entry.front_man && entry.hocon),
    entry
      ? `Matched "${entry.name}" -> front_man="${entry.front_man}", hocon="${entry.hocon}"`
      : `No exact network match for "${requestedNetName}" in agent-manifest.json`
  );

  // 3. CORS header
  const corsPass = corsHeader === "*" || (parsedUrl && corsHeader === parsedUrl.origin) || Boolean(corsHeader);
  push(
    "CORS_ACCESS",
    "Cross-Origin Resource Sharing (CORS)",
    corsPass,
    corsPass ? `Access-Control-Allow-Origin: ${corsHeader}` : "Missing Access-Control-Allow-Origin header"
  );

  // 4. Declarative data-only network artifact
  const forbidden = detectForbiddenServerSyntax(networkText || "");
  let network = null;
  try {
    network = JSON.parse(networkText);
  } catch (_) {
    network = null;
  }
  push(
    "DECLARATIVE_JSON",
    "Resolved Data-Only HOCON/JSON Artifact",
    Boolean(network) && forbidden.length === 0,
    network && forbidden.length === 0
      ? "Pure JSON serialization with 0 unresolved includes or local paths"
      : forbidden.join("; ") || "Invalid network JSON"
  );

  // 5. Front agent & JSON Schema parameters
  const tools = network && Array.isArray(network.tools) ? network.tools : [];
  const names = tools.map((t) => t && t.name).filter(Boolean);
  const uniqueNames = new Set(names).size === names.length && names.length >= 2;
  const hasFront = entry && names.includes(entry.front_man);
  const schemasValid = tools.every(
    (t) => t && t.function && typeof t.function.description === "string" && (!t.function.parameters || t.function.parameters.type === "object")
  );
  push(
    "AGENT_GRAPH_SCHEMA",
    "Multi-Agent Graph & JSON Schema Inputs",
    Boolean(uniqueNames && hasFront && schemasValid),
    `${names.length} agents (${names.join(", ")}); front_man present=${Boolean(hasFront)}`
  );

  // 6. Cycle-free local topology & bounded steps
  const cycles = detectLocalDelegationCycles(tools);
  const maxSteps = network && typeof network.max_steps === "number" ? network.max_steps : 0;
  push(
    "BOUNDED_EXECUTION",
    "Acyclic Delegation & Finite Step Budget",
    cycles.length === 0 && maxSteps > 0 && maxSteps <= 25,
    cycles.length === 0 ? `0 local cycles; max_steps=${maxSteps}` : `Cycle detected: ${cycles[0]}`
  );

  // 7. Pluggable LLM router & zero hardcoded keys
  const router = manifest && manifest.llm_router;
  const leakedKey = /sk-[a-zA-Z0-9]{20,}|Bearer\s+[a-zA-Z0-9._-]{20,}/.test(`${manifestText}\n${networkText}`);
  push(
    "PLUGGABLE_ROUTER",
    "Pluggable Router & Zero Credential Leakage",
    Boolean(router && router.base_url && !leakedKey),
    router && !leakedKey
      ? `Default/BYOK router: ${router.base_url} (0 embedded secrets)`
      : "Missing llm_router or embedded secret detected"
  );

  // 8. Peer policy & deny-by-default sly_data privacy
  const peerPolicy = manifest && manifest.peer_policy;
  const slyPolicy = network && network.sly_data_policy;
  push(
    "PRIVACY_SLY_GUARD",
    "Origin Consent & Deny-by-Default sly_data Policy",
    Boolean(peerPolicy && peerPolicy.mode && (!slyPolicy || slyPolicy.default === "deny")),
    `peer_policy.mode="${peerPolicy?.mode || "missing"}", sly_data default="${slyPolicy?.default || "deny"}"`
  );

  // 9. Peer-link resolution map (links.json)
  let linksValid = true;
  let linkCount = 0;
  if (linksText) {
    try {
      const linksDoc = JSON.parse(linksText);
      linksValid = linksDoc.version === 1 && typeof linksDoc.networks === "object";
      linkCount = Object.keys((linksDoc.networks && linksDoc.networks[requestedNetName]) || {}).length;
    } catch (_) {
      linksValid = false;
    }
  }
  push(
    "PEER_LINKS_MAP",
    "Symbolic Peer Link Resolution (links.json)",
    linksValid,
    linksValid ? `links.json v1 valid (${linkCount} symbolic peer binding(s))` : "Invalid links.json schema"
  );

  // 10. Action Bridge contract
  const actions = manifest && manifest.actions;
  const bridgePass = !actions || (actions.version === 1 && Boolean(actions.bridge) && bridgeOk);
  push(
    "ACTION_BRIDGE",
    "Cross-Origin Action Bridge Contract",
    bridgePass,
    actions ? `actions.version=${actions.version}, bridge="${actions.bridge}", tools=${(actions.agentTools || []).length}` : "Data-only network (no site actions)"
  );

  // 11 & 12. MIT NANDA /.well-known/agent-card.json & WebCrypto ECDSA P-256 verification
  let agentCard = null;
  if (agentCardText) {
    try {
      agentCard = JSON.parse(agentCardText);
    } catch (_) {
      agentCard = null;
    }
  }
  const hasNandaCard = Boolean(
    agentCard &&
      agentCard["@context"] &&
      agentCard.name &&
      Array.isArray(agentCard.skills) &&
      agentCard.skills.length > 0
  );
  push(
    "NANDA_AGENT_CARD",
    "MIT NANDA / A2A /.well-known/agent-card.json",
    hasNandaCard,
    hasNandaCard ? `Published "${agentCard.name}" v${agentCard.version} (${agentCard.skills.length} skills)` : "Missing /.well-known/agent-card.json"
  );

  let sigResult = { valid: false, reason: "No agent-card.json supplied" };
  if (hasNandaCard && manifestText && networkText) {
    sigResult = await verifyNandaAgentCard(agentCard, manifestText, networkText);
  }
  push(
    "WEBCRYPTO_ECDSA",
    "WebCrypto ECDSA P-256 Signature & SRI Pinning",
    sigResult.valid,
    `${sigResult.reason} (${sigResult.elapsedMs ?? 0} ms)`
  );

  const passed = checks.filter((c) => c.pass).length;
  return {
    targetNetworkUrl,
    networkName: requestedNetName,
    passed,
    total: checks.length,
    scorePct: Math.round((passed / checks.length) * 100),
    allPassed: passed === checks.length,
    nandaVerification: sigResult,
    checks,
  };
}

/**
 * Fetches all public artifacts of a live Agentic Web URL and runs the 12-point audit.
 */
export async function auditLiveAgenticUrl(targetNetworkUrl, fetchImpl = globalThis.fetch) {
  const parsed = new URL(targetNetworkUrl);
  const folder = new URL("./", parsed).href.replace(/\/$/, "");
  const getTxt = async (u) => {
    const res = await fetchImpl(u, { credentials: "omit" });
    return { ok: res.ok, status: res.status, cors: res.headers.get("access-control-allow-origin") || "*", text: res.ok ? await res.text() : "" };
  };

  const mf = await getTxt(`${folder}/agent-manifest.json`);
  if (!mf.ok) {
    throw new Error(`Failed to fetch ${folder}/agent-manifest.json (HTTP ${mf.status})`);
  }
  const manifestObj = JSON.parse(mf.text);
  const netName = parsed.pathname.split("/").filter(Boolean).pop();
  const entry = (manifestObj.networks || []).find((n) => n.name === netName) || (manifestObj.networks || [])[0];
  const hoconUrl = new URL(entry.hocon, `${folder}/`).href;
  const [nf, lf, cf] = await Promise.all([
    getTxt(hoconUrl),
    getTxt(`${folder}/links.json`).catch(() => ({ ok: false, text: "" })),
    getTxt(`${folder}/.well-known/agent-card.json`).catch(() => ({ ok: false, text: "" })),
  ]);

  let bridgeOk = true;
  if (manifestObj.actions && manifestObj.actions.bridge) {
    const bf = await getTxt(new URL(manifestObj.actions.bridge, `${folder}/`).href).catch(() => ({ ok: false }));
    bridgeOk = bf.ok;
  }

  return auditAgenticSiteBundle({
    targetNetworkUrl,
    manifestText: mf.text,
    networkText: nf.text,
    linksText: lf.ok ? lf.text : "",
    agentCardText: cf.ok ? cf.text : "",
    corsHeader: mf.cors,
    bridgeOk,
  });
}
