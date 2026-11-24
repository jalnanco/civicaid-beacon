/**
 * @civicaid/beacon-kit — MIT NANDA & A2A Cryptographic Agent Card Verifier
 * Zero-dependency ES module running identically in standard browsers and Node.js >=20 via WebCrypto.
 * License: MIT
 */

const encoder = new TextEncoder();

export function sortKeysDeep(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeysDeep(value[key]);
    }
    return out;
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(sortKeysDeep(value));
}

export function bytesToBase64(bytes) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64UrlToBytes(b64url) {
  const padded = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(padded, "base64"));
  }
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function sha256Sri(text) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(text));
  return `sha256-${bytesToBase64(new Uint8Array(digest))}`;
}

export async function sha256Hex(text) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function buildSigningPayload({ cardUrl, version, networkName, manifestSri, networkSri }) {
  return `nanda-agentfacts-v1|${cardUrl}|${version}|${networkName}|${manifestSri}|${networkSri}`;
}

/**
 * Verifies a /.well-known/agent-card.json document against fetched manifest & network JSON texts
 * using standard WebCrypto ECDSA P-256 + SHA-256.
 */
export async function verifyNandaAgentCard(agentCard, manifestText, networkText) {
  const t0 = performance.now();
  if (!agentCard || typeof agentCard !== "object") {
    return { valid: false, reason: "Missing or non-object agent-card.json", elapsedMs: 0 };
  }

  const identity = agentCard.nanda_identity;
  if (!identity || !identity.public_key_jwk || !identity.signature_b64url) {
    return {
      valid: false,
      reason: "agent-card.json lacks nanda_identity.public_key_jwk or signature_b64url",
      elapsedMs: Number((performance.now() - t0).toFixed(2)),
    };
  }

  let manifestCanonical;
  let networkCanonical;
  try {
    manifestCanonical = canonicalJson(JSON.parse(manifestText));
    networkCanonical = canonicalJson(JSON.parse(networkText));
  } catch (err) {
    return {
      valid: false,
      reason: `Artifact JSON parse failed before digest check: ${err.message}`,
      elapsedMs: Number((performance.now() - t0).toFixed(2)),
    };
  }

  const computedManifestSri = await sha256Sri(manifestCanonical);
  const computedNetworkSri = await sha256Sri(networkCanonical);

  if (computedManifestSri !== identity.manifest_sha256_sri) {
    return {
      valid: false,
      code: "MANIFEST_TAMPER_DETECTED",
      reason: `Manifest digest mismatch: expected ${identity.manifest_sha256_sri}, got ${computedManifestSri}`,
      computedManifestSri,
      computedNetworkSri,
      elapsedMs: Number((performance.now() - t0).toFixed(2)),
    };
  }

  if (computedNetworkSri !== identity.network_sha256_sri) {
    return {
      valid: false,
      code: "NETWORK_TAMPER_DETECTED",
      reason: `Network graph digest mismatch: expected ${identity.network_sha256_sri}, got ${computedNetworkSri}`,
      computedManifestSri,
      computedNetworkSri,
      elapsedMs: Number((performance.now() - t0).toFixed(2)),
    };
  }

  const payload = buildSigningPayload({
    cardUrl: agentCard.url,
    version: agentCard.version,
    networkName: identity.network_name,
    manifestSri: computedManifestSri,
    networkSri: computedNetworkSri,
  });

  try {
    const cryptoKey = await globalThis.crypto.subtle.importKey(
      "jwk",
      identity.public_key_jwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
    const sigBytes = base64UrlToBytes(identity.signature_b64url);
    const verified = await globalThis.crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      cryptoKey,
      sigBytes,
      encoder.encode(payload)
    );

    return {
      valid: verified,
      code: verified ? "VERIFIED_ECDSA_P256" : "INVALID_ECDSA_SIGNATURE",
      reason: verified
        ? "ECDSA P-256 signature & SHA-256 artifact digests verified via WebCrypto"
        : "ECDSA P-256 cryptographic signature check failed",
      did: identity.did,
      keyFingerprint: identity.key_id,
      computedManifestSri,
      computedNetworkSri,
      elapsedMs: Number((performance.now() - t0).toFixed(2)),
    };
  } catch (err) {
    return {
      valid: false,
      code: "WEBCRYPTO_ERROR",
      reason: `WebCrypto verification error: ${err.message}`,
      elapsedMs: Number((performance.now() - t0).toFixed(2)),
    };
  }
}
