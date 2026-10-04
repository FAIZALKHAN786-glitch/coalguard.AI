import fs from "node:fs";
import path from "node:path";

// Only the server determines this policy; request bodies cannot enable providers.
export function aiPolicy(demo) {
  if (demo)
    return {
      allowExternal: false,
      reason:
        "External AI is disabled in demonstration workspaces. Configure it only in a private, non-demo deployment.",
    };
  if (process.env.AI_ENABLED !== "true")
    return {
      allowExternal: false,
      reason:
        "External AI is disabled. A deployment administrator must explicitly set AI_ENABLED=true after configuring private secrets.",
    };
  return { allowExternal: true, reason: null };
}

export function readProviderKey(type) {
  const inline = process.env[`AI_${type}_API_KEY`]?.trim();
  const file = process.env[`AI_${type}_API_KEY_FILE`]?.trim();
  // Avoid ambiguous rotation/configuration: exactly one source is permitted.
  if (inline && file)
    throw new Error(
      `${type} has conflicting credential sources. Configure either a secret file or an environment key, not both.`,
    );
  let value = inline;
  if (file) {
    let fd;
    try {
      if (!path.isAbsolute(file)) throw new Error();
      fd = fs.openSync(file, "r");
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > 8192) throw new Error();
      value = fs.readFileSync(fd, "utf8").trim();
    } catch {
      // Never expose a credential, raw filesystem error, or secret mount path.
      throw new Error(
        `${type} credential is unavailable. Check the private secret configuration.`,
      );
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }
  if (!value || value.length > 8192 || /\s/.test(value))
    throw new Error(`${type} credential is missing or invalid.`);
  return value;
}

export function providerUrl(base, endpoint) {
  let url;
  try {
    url = new URL(base.replace(/\/$/, "") + endpoint);
  } catch {
    throw new Error("AI provider URL is invalid.");
  }
  if (url.protocol !== "https:") throw new Error("AI provider must use HTTPS");
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.port && url.port !== "443")
  )
    throw new Error(
      "AI provider URL must not contain credentials, query parameters, fragments, or non-HTTPS ports.",
    );
  const hosts = (
    process.env.AI_ALLOWED_HOSTS ??
    "openrouter.ai,api.openai.com,api.cohere.com"
  )
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  if (!hosts.includes(url.hostname.toLowerCase()))
    throw new Error("AI provider host is not approved in AI_ALLOWED_HOSTS.");
  return url;
}
