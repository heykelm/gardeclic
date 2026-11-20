/** IPv4 helpers. Google Ads IP exclusions are IPv4-only. */

export function ipv4ToInt(ip) {
  if (typeof ip !== "string" || ip.includes(":")) return null;
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    n = (n << 8) + octet;
  }
  return n >>> 0;
}

export function ipInCidr(ip, cidr) {
  const [base, bitsRaw] = String(cidr).split("/");
  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt == null || baseInt == null) return false;
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

export function ipInAnyCidr(ip, cidrs) {
  return cidrs.some((cidr) => ipInCidr(ip, cidr));
}
